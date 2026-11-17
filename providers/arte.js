var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

// shared/context.js
var ctx = { meta: null };

// shared/match.js
function norm(s) {
  s = String(s || "").toLowerCase();
  if (s.normalize) s = s.normalize("NFD").replace(/[̀-ͯ]/g, "");
  return s.replace(/ß/g, "ss").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}
function cleanTitle(s) {
  return String(s || "").replace(/\b(19\d\d|20\d\d)\b/g, "").replace(/[\(\)\[\]\{\}]/g, " ").replace(/\s+/g, " ").trim();
}
function extractYear(title, hint) {
  if (hint && /^(19\d\d|20\d\d)$/.test(String(hint))) return Number(hint);
  const m = String(title || "").match(/\b(19\d\d|20\d\d)\b/);
  return m ? Number(m[1]) : null;
}
function score(title, year, meta) {
  const rawNorm = norm(title);
  const cleanNorm = norm(cleanTitle(title));
  if (!rawNorm && !cleanNorm) return 0;
  const y = extractYear(title, year);
  let s = 0;
  for (const m of (meta.titles || []).map(norm)) {
    if (!m) continue;
    if (rawNorm === m || cleanNorm === m) {
      s = Math.max(s, 3);
    } else if (m.length > 3 && (rawNorm.includes(m) || cleanNorm.includes(m) || m.includes(rawNorm) || m.includes(cleanNorm))) {
      s = Math.max(s, 1);
    }
  }
  if (y && meta.year) {
    const d = Math.abs(Number(y) - Number(meta.year));
    s += d === 0 ? 3 : d === 1 ? 1 : -3;
  }
  return s;
}
function sameYear(a, b, tolerance = 1) {
  if (!a || !b) return false;
  return Math.abs(Number(a) - Number(b)) <= tolerance;
}
function pickBest(items, meta) {
  let best = null, bestScore = 2, bestYear = null;
  for (const it of items) {
    if (!it) continue;
    const imdb = it.imdb || it.imdbId;
    if (meta.imdbId && imdb) {
      if (imdb === meta.imdbId) return it;
      continue;
    }
    const title = it.title || it.name;
    const year = it.year || it.date || extractYear(it.href || it.url);
    const s = score(title, year, meta);
    if (s > bestScore) {
      best = it;
      bestScore = s;
      bestYear = year;
    } else if (s === bestScore && s > 0 && best && year && meta.year && (!bestYear || Math.abs(Number(year) - Number(meta.year)) < Math.abs(Number(bestYear) - Number(meta.year)))) {
      best = it;
      bestYear = year;
    }
  }
  return best;
}

// shared/http.js
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
var DEADLINE_MS = 25e3;
var running = 0;
var idle = [];
var deadline = Infinity;
function send(url, opts) {
  if (Date.now() > deadline) return Promise.reject(new Error(`deadline reached, skipped ${url}`));
  running++;
  const done = () => {
    if (--running === 0) idle.splice(0).forEach((resolve) => resolve());
  };
  return fetch(url, opts).then((res) => {
    done();
    return res;
  }, (err) => {
    done();
    throw err;
  });
}
function safeUrl(url) {
  return typeof url === "string" && /^https?:\/\/[^\s]+$/i.test(url) ? url : null;
}
function safeHeaders(headers) {
  if (!headers || typeof headers !== "object") return void 0;
  const out = {};
  for (const k of Object.keys(headers)) {
    const v = headers[k];
    if (/^[A-Za-z0-9-]+$/.test(k) && typeof v === "string" && v && !/[\r\n]/.test(v)) out[k] = v;
  }
  return Object.keys(out).length ? out : void 0;
}
var SUBBED = [[/ger(man)?[\s._-]*sub|untertitel deutsch/i, "Original, dt. UT"], [/eng(lish)?[\s._-]*sub|untertitel englisch/i, "Original, engl. UT"]];
var LANGS = [[/japanisch, dt\. ut/i, "Japanisch, dt. UT"], [/japanisch, engl\. ut/i, "Japanisch, engl. UT"]].concat(SUBBED, [
  [/\bomu\b/i, "OmU"],
  [/\bov\b/i, "OV"],
  [/englisch|\ben\b/i, "Englisch"],
  [/franz|\bfr\b/i, "Franz\xF6sisch"],
  [/spanisch/i, "Spanisch"],
  [/japanisch/i, "Japanisch"],
  [/deutsch|\bde\b/i, "Deutsch"]
]);
var fileNames = {};
function resolution(q) {
  const m = String(q || "").match(/(\d{3,4})p/i);
  return m ? Number(m[1]) : 0;
}
function qualityOf(s) {
  if (s.quality && s.quality !== "auto") return String(s.quality);
  const m = String(s.url || "").match(/[^\d](\d{3,4})p/i);
  if (m) return m[1] + "p";
  if (/\.m3u8|\/hls|master/i.test(s.url || "")) return "HLS";
  if (/\.mp4/i.test(s.url || "")) return "MP4";
  return "auto";
}
var qualityRank = (q) => resolution(q) || (/hls|m3u8|auto/i.test(q) ? 800 : 0);
function decorate(s) {
  const url = safeUrl(s.url);
  if (!url) return null;
  const meta = ctx.meta;
  if (meta) {
    if (s.imdbId && meta.imdbId && s.imdbId !== meta.imdbId) return null;
    if (s.year && meta.year && !sameYear(s.year, meta.year, 2)) {
      console.error(`[provider] dropped "${s.mediaTitle || ""}" (${s.year}): Nuvio asked for ${meta.title} (${meta.year})`);
      return null;
    }
  }
  const hit = LANGS.find(([re]) => re.test(s.title || ""));
  let lang = hit ? hit[1] : "Deutsch", title = s.title;
  const sub = SUBBED.find(([re]) => re.test(fileNames[url] || ""));
  if (sub && !/UT|OmU/.test(lang)) {
    lang = sub[1];
    title = hit ? title.replace(hit[0], lang) : [title, lang].filter(Boolean).join(" \xB7 ");
  }
  const quality = qualityOf(s);
  const host = ((s.title || "").split(" \xB7 ")[0].match(/^[\w-]+\.[a-z]{2,}$/) || [])[0];
  const media = s.mediaTitle ? `${s.mediaTitle}${s.year ? ` (${s.year})` : ""}` : "";
  return {
    lang,
    stream: Object.assign({}, s, {
      url,
      name: [s.name, media, lang, host].filter(Boolean).join(" \xB7 "),
      title,
      quality,
      headers: safeHeaders(s.headers)
    })
  };
}
function provider(getStreams2) {
  return {
    getStreams(tmdbId, mediaType, season, episode) {
      return __async(this, null, function* () {
        deadline = Date.now() + DEADLINE_MS;
        ctx.meta = null;
        if (mediaType !== "movie") mediaType = "tv";
        let streams = [];
        try {
          streams = (yield getStreams2(tmdbId, mediaType, season, episode)) || [];
        } catch (e) {
          console.error(e.message);
        }
        if (running) yield new Promise((resolve) => idle.push(resolve));
        const seen = {};
        const ranked = [];
        streams.forEach((s, i) => {
          if (!s) return;
          const d = decorate(s);
          if (!d || seen[d.stream.url]) return;
          seen[d.stream.url] = true;
          ranked.push({ lang: d.lang, rank: qualityRank(d.stream.quality), i, stream: d.stream });
        });
        const langRank = (lang) => lang === "Deutsch" ? 0 : /dt\. UT|OmU/.test(lang) ? 1 : 2;
        ranked.sort((a, b) => langRank(a.lang) - langRank(b.lang) || b.rank - a.rank || a.i - b.i);
        return ranked.map((r) => r.stream);
      });
    }
  };
}
function request(_0) {
  return __async(this, arguments, function* (url, opts = {}) {
    if (!safeUrl(url)) throw new Error(`invalid url ${url}`);
    const headers = Object.assign({ "User-Agent": UA }, safeHeaders(opts.headers));
    const res = yield send(url, Object.assign({}, opts, { headers }));
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return res;
  });
}
var getText = (url, opts) => __async(null, null, function* () {
  return (yield request(url, opts)).text();
});
var getJson = (url, opts) => __async(null, null, function* () {
  return JSON.parse(yield getText(url, opts));
});

// shared/cache.js
var MAX_ENTRIES = 200;
var entries = /* @__PURE__ */ new Map();
function cached(key, ttlMs, fn) {
  const now = Date.now();
  const hit = entries.get(key);
  if (hit && now - hit.at < ttlMs) return hit.value;
  if (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value);
  const value = Promise.resolve().then(fn);
  entries.set(key, { at: now, value });
  value.catch(() => {
    const e = entries.get(key);
    if (e && e.value === value) entries.delete(key);
  });
  return value;
}

// shared/tmdb.js
var TTL = 10 * 60 * 1e3;
var api = (path, extra) => {
  if (!globalThis.TMDB_API_KEY) return Promise.reject(new Error("TMDB_API_KEY missing"));
  return getJson(`https://api.themoviedb.org/3/${path}?api_key=${globalThis.TMDB_API_KEY}${extra || ""}`);
};
var english = (translations) => (translations || []).find((t) => t.iso_639_1 === "en" && t.iso_3166_1 === "US") || (translations || []).find((t) => t.iso_639_1 === "en");
function getEpisodeMeta(tmdbId, season, episode) {
  return __async(this, null, function* () {
    if (!globalThis.TMDB_API_KEY || season == null || episode == null) return null;
    try {
      const epDe = yield cached(
        `episode:${tmdbId}:${season}:${episode}`,
        TTL,
        () => api(`tv/${tmdbId}/season/${season}/episode/${episode}`, "&language=de-DE&append_to_response=translations,external_ids")
      );
      const en = english((epDe.translations || {}).translations);
      const deTitle = epDe.name || "";
      const enTitle = en && en.data && en.data.name || epDe.original_name || "";
      const titles = [deTitle, enTitle].filter((t, i, a) => t && a.indexOf(t) === i);
      return {
        name: deTitle,
        englishName: enTitle,
        titles,
        season: Number(season),
        episode: Number(episode),
        airDate: epDe.air_date || "",
        imdbId: (epDe.external_ids || {}).imdb_id || null
      };
    } catch (e) {
      return null;
    }
  });
}
function getMeta(tmdbId, mediaType, season, episode) {
  return __async(this, null, function* () {
    const type = mediaType === "tv" ? "tv" : "movie";
    const mainPromise = cached(
      `main:${type}:${tmdbId}`,
      TTL,
      () => api(`${type}/${tmdbId}`, "&language=de-DE&append_to_response=external_ids,translations,alternative_titles")
    );
    const epPromise = type === "tv" && season != null && episode != null ? getEpisodeMeta(tmdbId, season, episode) : Promise.resolve(null);
    const [d, epMeta] = yield Promise.all([mainPromise, epPromise]);
    const tr = (d.translations || {}).translations || [];
    const en = english(tr);
    const alts = ((d.alternative_titles || {}).titles || (d.alternative_titles || {}).results || []).filter((a) => a.iso_3166_1 === "DE" || a.iso_3166_1 === "AT").map((a) => a.title);
    const title = d.title || d.name;
    const originalTitle = d.original_title || d.original_name;
    const englishTitle = en && (en.data.title || en.data.name);
    const date = d.release_date || d.first_air_date || "";
    const meta = {
      tmdbId: String(tmdbId),
      type,
      title,
      originalTitle,
      englishTitle,
      year: date ? Number(date.slice(0, 4)) : null,
      imdbId: (d.external_ids || {}).imdb_id || d.imdb_id || null,
      titles: [title, originalTitle, englishTitle].concat(alts).filter((t, i, a) => t && a.indexOf(t) === i),
      episode: epMeta,
      episodeTitles: epMeta ? epMeta.titles : [],
      episodeImdbId: epMeta ? epMeta.imdbId : null
    };
    ctx.meta = meta;
    return meta;
  });
}

// src/arte/index.js
var API = "https://api.arte.tv/api/emac/v4/de/web";
var getPage = (url) => __async(null, null, function* () {
  return JSON.parse((yield getText(url)).replace(/\n\d{3} - [^\n]*\n/g, "null"));
});
function zoneItems(zone, query, maxPages) {
  return __async(this, null, function* () {
    const c = zone.content;
    if (c && (!c.pagination || c.pagination.pages <= 1 || maxPages === 1)) return c.data;
    let items = [];
    for (let page = 1, pages = 1; page <= pages && page <= maxPages; page++) {
      const r = yield getJson(`${API}/zones/${zone.id.split("_")[0]}/content?${query}&page=${page}`);
      items = items.concat(r.data || []);
      pages = (r.pagination || {}).pages || 1;
    }
    return items;
  });
}
function getStreams(tmdbId, mediaType, season, episode) {
  return __async(this, null, function* () {
    try {
      const meta = yield getMeta(tmdbId, mediaType);
      const isTv = mediaType === "tv";
      let hit;
      for (const q of meta.titles) {
        const query = `query=${encodeURIComponent(q)}`;
        const zones = (yield getPage(`${API}/pages/SEARCH/?page=1&${query}`)).zones || [];
        const listing = zones.find((z) => z.code === "listing_SEARCH") || zones[0];
        const items = listing ? (yield zoneItems(listing, `authorizedCountry=DE&${query}`, 1)).filter((i) => i.programId && i.programId.startsWith("RC-") === isTv && !["TOPIC", "TRAILER"].includes(i.kind.code)) : [];
        hit = pickBest(items, meta);
        if (hit) break;
      }
      if (!hit) return [];
      let programId = hit.programId;
      if (isTv) {
        const seasons = ((yield getPage(`${API}/collections/${programId}`)).zones || []).filter((z) => z.id.split("_").length === 3);
        const zone = seasons.find((z) => Number((z.slug || "").split("-").pop()) === season) || seasons.length === 1 && season === 1 && seasons[0];
        if (!zone) return [];
        const [, collectionId, subCollectionId] = zone.id.split("_");
        const eps = yield zoneItems(zone, `collectionId=${collectionId}&subCollectionId=${subCollectionId}`, 20);
        const ep = eps.find((e) => (e.episodeInfo || {}).episode === episode) || eps.find((e) => Number((e.title.match(/\((\d+)\/\d+\)$/) || [])[1]) === episode);
        if (!ep) return [];
        programId = ep.programId;
      }
      const attrs = (yield getJson(`https://api.arte.tv/api/player/v2/config/de/${programId}`)).data.attributes;
      return (attrs.streams || []).map((s) => ({ s, v: s.versions[0] || {} })).sort((a, b) => (b.v.audioLanguage === "de") - (a.v.audioLanguage === "de")).map(({ s, v }) => ({
        name: "Arte",
        title: `${attrs.metadata.title}${attrs.metadata.subtitle ? " - " + attrs.metadata.subtitle : ""} \xB7 ${v.audioLanguage === "de" ? "Deutsch" : v.shortLabel || v.label} \xB7 HLS`,
        url: s.url,
        quality: "auto",
        // multi-bitrate master, mainQuality understates it
        mediaTitle: meta.title,
        year: meta.year
      }));
    } catch (e) {
      console.error(`[Arte] ${e.message}`);
    }
    return [];
  });
}
module.exports = provider(getStreams);
