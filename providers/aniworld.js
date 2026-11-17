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
function cleanEpTitle(s) {
  return String(s || "").replace(/\[Episode\s*\d+[^\]]*\]/gi, "").replace(/\((Staffel|Season)\s*\d+[^)]*\)/gi, "").replace(/\[[^\]]*\]/g, "").trim();
}
function titleAffinity(a, b) {
  const wa = new Set(norm(cleanEpTitle(a)).split(" ").filter((w) => w.length > 3));
  const wb = new Set(norm(cleanEpTitle(b)).split(" ").filter((w) => w.length > 3));
  if (!wa.size || !wb.size) return 0;
  let common = 0;
  wa.forEach((w) => {
    if (wb.has(w)) common++;
  });
  return common / Math.min(wa.size, wb.size);
}
function sharedWords(a, b) {
  const wa = new Set(norm(cleanEpTitle(a)).split(" ").filter((w) => w.length > 3));
  return norm(cleanEpTitle(b)).split(" ").filter((w) => w.length > 3 && wa.has(w)).length;
}
function matchEpisodeTitle(rowDe, rowOrig, targetTitles) {
  if (!targetTitles || !targetTitles.length) return 0;
  const deNorm = norm(cleanEpTitle(rowDe));
  const origNorm = norm(cleanEpTitle(rowOrig));
  let best = 0;
  for (const target of targetTitles) {
    const tn = norm(cleanEpTitle(target));
    if (!tn || tn.length < 3) continue;
    if (deNorm === tn || origNorm === tn) return 10;
    if (tn.length > 8) {
      if (deNorm.length > 8 && deNorm.includes(tn)) best = Math.max(best, 6);
      if (origNorm.length > 8 && origNorm.includes(tn)) best = Math.max(best, 6);
      if (deNorm.length > 8 && tn.includes(deNorm) && sharedWords(deNorm, tn) >= 2) best = Math.max(best, 6);
      if (origNorm.length > 8 && tn.includes(origNorm) && sharedWords(origNorm, tn) >= 2) best = Math.max(best, 6);
    }
    if (sharedWords(rowDe, target) >= 2 && titleAffinity(rowDe, target) >= 0.6 || sharedWords(rowOrig, target) >= 2 && titleAffinity(rowOrig, target) >= 0.6) best = Math.max(best, 5);
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
function mapLimit(items, limit, fn) {
  const list = items || [];
  const out = new Array(list.length);
  let next = 0;
  const worker = () => __async(null, null, function* () {
    while (next < list.length) {
      const i = next++;
      try {
        out[i] = yield fn(list[i], i);
      } catch (e) {
        out[i] = null;
      }
    }
  });
  const workers = [];
  for (let i = 0; i < Math.min(limit || 1, list.length); i++) workers.push(worker());
  return Promise.all(workers).then(() => out);
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
  const quality2 = qualityOf(s);
  const host = ((s.title || "").split(" \xB7 ")[0].match(/^[\w-]+\.[a-z]{2,}$/) || [])[0];
  const media = s.mediaTitle ? `${s.mediaTitle}${s.year ? ` (${s.year})` : ""}` : "";
  return {
    lang,
    stream: Object.assign({}, s, {
      url,
      name: [s.name, media, lang, host].filter(Boolean).join(" \xB7 "),
      title,
      quality: quality2,
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
var postJson = (url, body, opts = {}) => getJson(url, Object.assign({}, opts, {
  method: "POST",
  body: JSON.stringify(body),
  headers: Object.assign({ "Content-Type": "application/json" }, opts.headers)
}));
var postForm = (url, form, opts = {}) => getText(url, Object.assign({}, opts, {
  method: "POST",
  body: Object.keys(form).map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(form[k])).join("&"),
  headers: Object.assign({ "Content-Type": "application/x-www-form-urlencoded" }, opts.headers)
}));

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
function getSeasonEpisodes(tmdbId, season) {
  return __async(this, null, function* () {
    if (season == null) return [];
    return cached(`season:${tmdbId}:${season}`, TTL, () => __async(null, null, function* () {
      const d = yield api(`tv/${tmdbId}/season/${season}`, "&language=de-DE");
      return (d.episodes || []).map((e) => ({
        number: Number(e.episode_number) || 0,
        name: e.name || "",
        originalName: e.original_name || "",
        airDate: e.air_date || ""
      }));
    }));
  });
}
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

// shared/dom.js
var cheerio = require("cheerio");
var load = (html) => cheerio.load(html);
var all = ($, sel, ctx2) => (ctx2 ? $(sel, ctx2) : $(sel)).toArray().map((e) => $(e));

// shared/extractors/util.js
var origin = (url) => url.match(/^https?:\/\/[^/]+/)[0];
var scripts = (html) => (html.match(/<script[^>]*>[\s\S]*?<\/script>/gi) || []).map((s) => s.replace(/^<script[^>]*>|<\/script>$/gi, ""));
var fetchPage = (url, headers = {}) => getText(url, { headers: Object.assign({ "User-Agent": UA }, headers) });
function quality(label) {
  const s = String(label || "");
  if (/\b(2160p|4k)\b/i.test(s)) return "2160p";
  if (/\b(1080p|fhd)\b/i.test(s)) return "1080p";
  if (/\b(720p|hd)\b/i.test(s)) return "720p";
  if (/\b(480p|sd)\b/i.test(s)) return "480p";
  if (/\b360p\b/i.test(s)) return "360p";
  const m = s.match(/(\d{3,4})p/i) || s.match(/^(\d{3,4})$/);
  return m ? `${m[1]}p` : "auto";
}
function unpack(text) {
  const packed = (text.match(/eval\(function\(p,a,c,k,e,[\s\S]*?\.split\('\|'\)[^)]*\)\)/) || [])[0];
  const m = packed && packed.match(/\}\s*\('([\s\S]*)',\s*(.*?),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/);
  if (!m) return null;
  const payload = m[1].replace(/\\'/g, "'");
  const radix = parseInt(m[2], 10) || 36;
  const symtab = m[4].split("|");
  if (symtab.length !== Number(m[3])) return null;
  const alphabet = radix > 36 ? (radix <= 62 ? "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ" : " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~").slice(0, radix) : null;
  const unbase = (w) => alphabet ? w.split("").reverse().reduce((n, ch, i) => n + Math.pow(radix, i) * alphabet.indexOf(ch), 0) : parseInt(w, radix);
  return payload.replace(/\b\w+\b/g, (w) => symtab[unbase(w)] || w);
}
function jwplayer(script, base) {
  const fix = (u) => {
    u = u.replace(/\\\//g, "/");
    return /^https?:/.test(u) ? u : u.startsWith("//") ? "https:" + u : u.startsWith("/") ? origin(base) + u : `${origin(base)}/${u}`;
  };
  const out = [];
  const re = /"?sources"?:\s*(\[.*?\])/g;
  let m;
  while (m = re.exec(script)) {
    try {
      const json = m[1].replace(/"?(file|label|type)"?\s*:/g, '"$1":').replace(/'/g, '"');
      for (const s of JSON.parse(json)) if (s.file) out.push({ url: fix(s.file), quality: quality(s.label) });
    } catch (e) {
    }
  }
  if (!out.length) {
    const urlRe = /[:=]\s*"([^"\s]+(\.m3u8|master\.txt)[^"\s]*)/g;
    while (m = urlRe.exec(script)) out.push({ url: fix(m[1]), quality: "auto" });
  }
  return out;
}

// shared/extractors/hosters.js
var CryptoJS = require("crypto-js");
function voe(url, referer) {
  return __async(this, null, function* () {
    let html = yield fetchPage(url, { Referer: referer || url });
    const redirect = html.match(/window\.location\.href\s*=\s*'([^']+)';/);
    if (redirect) {
      url = redirect[1];
      html = yield fetchPage(url, { Referer: referer || url });
    }
    const json = (html.match(/<script type="application\/json">([\s\S]*?)<\/script>/) || [])[1];
    if (!json) return [];
    let s = json.trim().replace(/^\["/, "").replace(/"\]$/, "");
    s = s.replace(/[a-zA-Z]/g, (c) => {
      const base = c <= "Z" ? 65 : 97;
      return String.fromCharCode((c.charCodeAt(0) - base + 13) % 26 + base);
    });
    for (const p of ["@$", "^^", "~@", "%?", "*~", "!!", "#&"]) s = s.split(p).join("_");
    s = atob(s.replace(/_/g, ""));
    s = s.split("").map((c) => String.fromCharCode(c.charCodeAt(0) - 3)).reverse().join("");
    const data = JSON.parse(atob(s));
    const headers = { Referer: origin(url) + "/", Origin: origin(url) };
    const out = [];
    const file = (html.match(/<title>Watch ([^<|]*)/) || [])[1];
    const q = quality(file);
    if (data.source) out.push({ url: data.source, quality: q, headers });
    if (data.direct_access_url) out.push({ url: data.direct_access_url, quality: q, headers: { Referer: url } });
    if (file) for (const item of out) fileNames[item.url] = file;
    return out;
  });
}
function dood(url) {
  return __async(this, null, function* () {
    const embed = url.replace("/d/", "/e/");
    const res = yield send(embed, { headers: { "User-Agent": UA } });
    const html = yield res.text();
    const host = origin(res.url || embed);
    const pass = (html.match(/\/pass_md5\/[^']*/) || [])[0];
    if (!pass) return [];
    const prefix = yield getText(host + pass, { headers: { Referer: res.url || embed } });
    let token = "";
    const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 10; i++) token += abc[Math.floor(Math.random() * abc.length)];
    const title = (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1];
    return [{ url: `${prefix}${token}?token=${pass.split("/").pop()}&expiry=${Date.now()}`, quality: quality(title), headers: { Referer: host + "/" } }];
  });
}
function aesDecrypt(cipherBytes, key, opts) {
  return CryptoJS.AES.decrypt(CryptoJS.lib.CipherParams.create({ ciphertext: cipherBytes }), key, opts);
}
function vidstack(url) {
  return __async(this, null, function* () {
    const hash = url.split("#").pop().split("/").pop();
    const enc = (yield getText(`${origin(url)}/api/v1/video?id=${hash}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0" }
    })).trim();
    const key = CryptoJS.enc.Utf8.parse("kiemtienmua911ca");
    for (const iv of ["1234567890oiuytr", "0123456789abcdef"]) {
      try {
        const text = aesDecrypt(CryptoJS.enc.Hex.parse(enc), key, { iv: CryptoJS.enc.Utf8.parse(iv), mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }).toString(CryptoJS.enc.Latin1);
        const src = (text.match(/"source":"(.*?)"/) || [])[1];
        if (src) return [{ url: src.replace(/\\\//g, "/"), quality: "auto", headers: { Referer: url, Origin: origin(url) } }];
      } catch (e) {
      }
    }
    return [];
  });
}
function supervideo(url) {
  return __async(this, null, function* () {
    const html = yield fetchPage(url);
    return jwplayer(unpack(html) || "", url).map((s) => Object.assign(s, { headers: { Referer: origin(url) + "/" } }));
  });
}
function vidhidepro(url, referer) {
  return __async(this, null, function* () {
    const embed = url.replace(/\/(d|download|file|f)\//, "/v/");
    const html = yield fetchPage(embed, { Referer: referer || embed });
    const script = unpack(html) || scripts(html).find((s) => s.includes("sources:")) || "";
    return jwplayer(script, embed).map((s) => Object.assign(s, { headers: { Referer: origin(embed) + "/", Origin: origin(embed) } }));
  });
}
function streamwish(url, referer) {
  return __async(this, null, function* () {
    const embed = url.replace(/\/[fe]\//, "/");
    const html = yield fetchPage(embed, { Referer: referer || embed });
    const script = unpack(html) || scripts(html).find((s) => s.includes('jwplayer("vplayer").setup(')) || scripts(html).find((s) => s.includes("sources:")) || "";
    return jwplayer(script, embed).map((s) => Object.assign(s, { headers: { Referer: origin(embed) + "/", Origin: origin(embed) } }));
  });
}
function mixdrop(url) {
  return __async(this, null, function* () {
    const html = yield fetchPage(url.replace("/f/", "/e/"));
    const link = ((unpack(html) || html).match(/wurl.*?=.*?"(.*?)";/) || [])[1];
    return link ? [{ url: link.startsWith("//") ? "https:" + link : link, quality: "auto", headers: { Referer: url, "User-Agent": UA } }] : [];
  });
}
function filemoon(url, referer) {
  return __async(this, null, function* () {
    const headers = { Referer: url, "Sec-Fetch-Dest": "iframe", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Site": "cross-site" };
    let html = yield fetchPage(url, headers);
    const iframe = (html.match(/<iframe[^>]+src="([^"]+)"/) || [])[1];
    if (iframe) html = yield fetchPage(iframe, Object.assign({}, headers, { "Accept-Language": "en-US,en;q=0.5" }));
    return jwplayer(unpack(html) || "", iframe || url).map((s) => Object.assign(s, { headers: { Referer: origin(iframe || url) + "/" } }));
  });
}
function vidoza(url) {
  return __async(this, null, function* () {
    const html = yield fetchPage(url);
    const line = (html.match(/sourcesCode:\s*(\[[^\n]*\])/) || [])[1];
    if (!line) return [];
    return JSON.parse(line.replace(/"?(src|type|label|res)"?\s*:/g, '"$1":')).map((s) => ({ url: s.src, quality: quality(s.res || s.label), headers: { Referer: url } }));
  });
}
function streamtape(url) {
  return __async(this, null, function* () {
    const html = yield fetchPage(url);
    const line = (html.match(/botlink'\)\.innerHTML\s*=\s*([^\n;]+)/) || [])[1];
    if (!line) return [];
    const value = line.split("+").map((part) => {
      let s = (part.match(/'([^']*)'/) || [])[1] || "";
      const re = /\.substring\((\d+)\)/g;
      let m;
      while (m = re.exec(part)) s = s.substring(Number(m[1]));
      return s;
    }).join("");
    return value ? [{ url: `https:${value}&stream=1`, quality: "auto", headers: { Referer: url } }] : [];
  });
}
function lulustream(url, referer) {
  return __async(this, null, function* () {
    const html = yield postForm(`${origin(url)}/dl`, { op: "embed", file_code: url.split("/").pop(), auto: "1", referer: referer || "" });
    const script = scripts(html).find((s) => s.includes("vplayer")) || "";
    return jwplayer(script, url).map((s) => Object.assign(s, { headers: { Referer: origin(url) + "/" } }));
  });
}
function sniff(url, referer) {
  return __async(this, null, function* () {
    const html = yield fetchPage(url, { Referer: referer || url });
    if (html.includes("/pass_md5/")) return dood(url);
    if (html.includes('"/api/stream"') && html.includes("filecode")) {
      const d = yield getJson(origin(url) + "/api/stream", { method: "POST", body: JSON.stringify({ filecode: url.split("/").filter(Boolean).pop(), device: "web" }), headers: { "Content-Type": "application/json", Referer: url } });
      return d.streaming_url ? [{ url: d.streaming_url, quality: "auto", headers: { Referer: origin(url) + "/" } }] : [];
    }
    const blob = (html.match(/id="token-blob"[^>]*>([^<]*)</) || [])[1];
    if (blob) {
      const d = yield postJson(`${origin(url)}/api/videos/${url.split("?")[0].split("/").pop()}/resolve`, { blob: blob.trim() }, { headers: { Referer: url } });
      return d.signedVideoUrl ? [{ url: d.signedVideoUrl, quality: "auto", headers: { Referer: origin(url) + "/", Origin: origin(url) } }] : [];
    }
    const hex = (html.match(/_0x1 = '([0-9a-f|]+)'/) || [])[1];
    if (hex) {
      const s = hex.split("|").join("").replace(/../g, (b) => String.fromCharCode(parseInt(b, 16)));
      return [{ url: s.split("").reverse().join(""), quality: "auto", headers: { Referer: origin(url) + "/" } }];
    }
    if (html.includes("application/json") && /window\.location\.href|voe/i.test(html)) return voe(url, referer);
    if (/window\.location\.href = 'https?:\/\/[^']+\/e\/\w+'/.test(html)) return voe(url, referer);
    if (html.includes("sourcesCode:")) return vidoza(url);
    if (html.includes("botlink').innerHTML")) return streamtape(url);
    let found = jwplayer(unpack(html) || "", url);
    if (!found.length) found = jwplayer(scripts(html).find((s) => s.includes("sources:")) || "", url);
    return found.map((s) => Object.assign(s, { headers: { Referer: origin(url) + "/", Origin: origin(url), "User-Agent": UA } }));
  });
}

// shared/extractors/index.js
var HOSTS = [
  [voe, ["voe.sx", "goofy-banana.com", "urochsunloath.com", "donaldlineelse.com", "charlestoughrace.com", "tubelessceliolymph.com", "simpulumlamerop.com", "nathanfromsubject.com", "yip.su", "metagnathtuggers.com"]],
  [vidstack, ["moflix.upns.xyz", "moflix.rpmplay.xyz"]],
  [supervideo, ["supervideo", "dropload", "abstream.to", "dr0pstream.com"]],
  [vidhidepro, ["vidhide", "filelions", "ryderjet.com", "moflix-stream.click", "smoothpre.com", "dhtpre.com", "peytonepre.com"]],
  [streamwish, ["streamwish", "luluvdo.com", "streamruby.com", "savefiles.com", "wishembed", "swdyu.com", "strwish"]],
  [lulustream, ["lulustream.com", "luluvdoo.com"]],
  [mixdrop, ["mixdrop", "mixdrp", "mxdrop", "mdy48tn97.com"]],
  [filemoon, ["filemoon"]],
  [vidoza, ["vidoza.net", "videzz.net"]],
  [streamtape, ["streamtape", "watchadsontape.com", "shavetape.cash"]]
];
var BLOCKED = ["dood", "d000d.com", "vide0.net", "dsvplay.com", "dooodster.com", "doods.pro", "playmogo.com", "d0000d.com", "ds2play.com", "doodstream.com", "do7go.com"];
var hostOf = (url) => (url.match(/^https?:\/\/(?:www\.)?([^/:?#]+)/i) || [])[1] || "";
var listed = (host, names) => names.some((n) => host === n || !n.includes(".") && host.includes(n));
function decoderFor(url) {
  const hit = HOSTS.find(([, names]) => listed(hostOf(url), names));
  return hit ? hit[0] : sniff;
}
function resolveEmbed(url, referer) {
  return __async(this, null, function* () {
    if (!url) return [];
    if (url.startsWith("//")) url = "https:" + url;
    if (!safeUrl(url)) return [];
    if (listed(hostOf(url), BLOCKED)) return [];
    try {
      const host = url.split("/")[2].replace(/^www\./, "");
      const found = yield decoderFor(url)(url, referer);
      return (found || []).filter((s) => s && safeUrl(s.url)).map((s) => Object.assign({}, s, { url: safeUrl(s.url), host }));
    } catch (e) {
      console.error(`[extractor] ${url}: ${e.message}`);
      return [];
    }
  });
}

// shared/episodes.js
var ROW_TTL = 5 * 60 * 1e3;
var MAX_SEASON = 40;
function parseEpisodeRows(html) {
  if (!html) return [];
  const $ = load(html);
  const seen = {};
  const rows = [];
  $('tr[itemprop="episode"], table.seasonEpisodesList tbody tr').each((_, el) => {
    const row = $(el);
    const link = row.find(".seasonEpisodeTitle a").first();
    const anyLink = row.find('a[href*="/episode-"]').first();
    const href = (link.length ? link.attr("href") : anyLink.attr("href")) || "";
    if (!href) return;
    if (seen[href]) return;
    seen[href] = true;
    const num = Number((href.match(/episode-(\d+)/) || [])[1]) || Number(row.find('meta[itemprop="episodeNumber"]').attr("content")) || null;
    rows.push({
      href,
      epNum: num,
      deTitle: (row.find(".seasonEpisodeTitle strong").text() || "").replace(/\s+/g, " ").trim(),
      origTitle: (row.find(".seasonEpisodeTitle span").text() || "").replace(/\s+/g, " ").trim()
    });
  });
  return rows;
}
function seasonRows(base, link, season) {
  const url = `${base}${link}/staffel-${season}`;
  return cached(`rows:${url}`, ROW_TTL, () => __async(null, null, function* () {
    const html = yield getText(url).catch(() => "");
    return parseEpisodeRows(html);
  }));
}
function bestRow(rows, targets) {
  let best = null;
  for (const row of rows) {
    const s = matchEpisodeTitle(row.deTitle, row.origTitle, targets);
    if (s && (!best || s > best.score)) best = { row, score: s };
  }
  return best;
}
function maxNum(rows) {
  let max = 0;
  for (const r of rows) if (r.epNum > max) max = r.epNum;
  return max;
}
function findEpisodeCandidates(base, link, season, episode, meta) {
  return __async(this, null, function* () {
    const sn = Number(season) || 1;
    const ep = Number(episode) || 1;
    const out = [];
    const add = (row, score2, why) => {
      if (!row || !row.href) return;
      if (out.some((c) => c.href === row.href)) return;
      out.push({ href: row.href, score: score2, why });
    };
    const rows = yield seasonRows(base, link, sn);
    const titles = (meta && meta.episodeTitles || []).slice();
    const local = bestRow(rows, titles);
    if (local && local.score >= 10) return [{ href: local.row.href, score: local.score, why: "title" }];
    if (local) add(local.row, local.score, "title-fuzzy");
    const info = yield getSeasonEpisodes(meta && meta.tmdbId, sn).catch(() => []);
    const infoEp = info.find((e) => e.number === ep) || info[ep - 1] || null;
    const allTitles = titles.concat(infoEp ? [infoEp.name, infoEp.originalName] : []).filter((t, i, a) => t && a.indexOf(t) === i);
    if ((!local || local.score < 10) && allTitles.length !== titles.length) {
      const retry = bestRow(rows, allTitles);
      if (retry && retry.score >= 10) return [{ href: retry.row.href, score: retry.score, why: "title" }];
      if (retry) add(retry.row, retry.score, "title-fuzzy");
    }
    const siteMax = maxNum(rows);
    if (rows.length && info.length && siteMax === rows.length) {
      const offset = rows.length - info.length;
      if (offset > 0 && offset < 10) {
        const row = rows.find((r) => r.epNum === ep + offset);
        if (row) add(row, rows.length > info.length + 1 ? 7 : 6, "offset");
      }
    }
    if (!out.length || out[0].score < 10) {
      const around = [];
      for (let s = sn + 1; s <= Math.min(sn + 3, MAX_SEASON); s++) around.push(s);
      for (let s = sn - 1; s >= Math.max(1, sn - 3); s--) around.push(s);
      const pages = yield Promise.all(around.map((s) => seasonRows(base, link, s)));
      let found = null;
      pages.forEach((pageRows, i) => {
        const hit = bestRow(pageRows, allTitles);
        if (hit && (!found || hit.score > found.score)) found = { row: hit.row, score: hit.score, season: around[i] };
      });
      if (found && found.score >= 10) return [{ href: found.row.href, score: found.score, why: `title-season-${found.season}` }];
      if (found && found.score >= 5) add(found.row, found.score, "title-other-season");
    }
    if (sn === 1 && ep > (siteMax || 0)) {
      let rest = ep;
      for (let s = 1; s <= Math.min(MAX_SEASON, ep); s++) {
        const pageRows = yield seasonRows(base, link, s);
        const max = maxNum(pageRows);
        if (!max) break;
        if (rest <= max) {
          const row = pageRows.find((r) => r.epNum === rest);
          if (row) {
            add(row, 6, "absolute");
            break;
          }
          break;
        }
        rest -= max;
      }
    }
    add(rows.find((r) => r.epNum === ep), 1, "number");
    add({ href: `${link}/staffel-${sn}/episode-${ep}` }, 0, "guess");
    return out.sort((a, b) => b.score - a.score);
  });
}

// src/serienstream/common.js
function followRedirect(url, referer) {
  return __async(this, null, function* () {
    const res = yield send(url, { headers: { "User-Agent": UA, Referer: referer } });
    return res.url && res.url !== url ? res.url : null;
  });
}
var attachYear = (hit, meta) => Object.assign({}, hit.item, { year: hit.year || meta && meta.year });
function episodeOverlap(base, link, tmdbNames) {
  return __async(this, null, function* () {
    const rows = yield seasonRows(base, link, 1);
    if (!rows.length) return 0;
    const titles = [].concat.apply([], tmdbNames.map((e) => [e.name, e.originalName])).filter(Boolean);
    let hits = 0;
    for (const row of rows.slice(0, 12)) {
      if (matchEpisodeTitle(row.deTitle, row.origTitle, titles) >= 6) hits++;
    }
    return hits;
  });
}
function pickSeries(items, meta, base) {
  return __async(this, null, function* () {
    if (!items || !items.length) return null;
    const scored = items.map((it) => {
      const title = String(it.title || "");
      const year = (title.match(/\b(19\d\d|20\d\d)\b/) || it.link && it.link.match(/-(19\d\d|20\d\d)$/) || [])[1];
      return { item: it, score: score(title, year, meta), year };
    });
    let exact = scored.filter((x) => x.score >= 3);
    if (!exact.length) return null;
    if (exact.length === 1) return attachYear(exact[0], meta);
    if (meta.imdbId) {
      const pages = yield mapLimit(exact, 4, (h) => __async(null, null, function* () {
        const html = yield getText(base + h.item.link).catch(() => "");
        return html && html.includes(meta.imdbId) ? h : null;
      }));
      const hit = pages.find(Boolean);
      if (hit) return attachYear(hit, meta);
    }
    const tmdbNames = yield getSeasonEpisodes(meta.tmdbId, 1).catch(() => []);
    if (tmdbNames.length) {
      const overlaps = yield mapLimit(exact, 3, (h) => episodeOverlap(base, h.item.link, tmdbNames));
      let best = null;
      overlaps.forEach((n, i) => {
        if (n && (!best || n > best.n)) best = { n, h: exact[i] };
      });
      if (best) return attachYear(best.h, meta);
    }
    exact.sort((a, b) => b.score - a.score);
    return attachYear(exact[0], meta);
  });
}
function bySlug(base, prefix, meta) {
  return __async(this, null, function* () {
    if (!meta.imdbId) return null;
    for (const t of meta.titles) {
      const baseSlug = t.toLowerCase().replace(/['’]/g, "").replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const slugs = [baseSlug];
      if (meta.year) slugs.push(`${baseSlug}-${meta.year}`);
      const pages = yield mapLimit(slugs, 2, (slug) => __async(null, null, function* () {
        const link = prefix + slug;
        const html = yield getText(base + link).catch(() => "");
        return html && html.includes(meta.imdbId) ? { link, title: t, year: meta.year } : null;
      }));
      const hit = pages.find(Boolean);
      if (hit) return hit;
    }
    return null;
  });
}

// src/aniworld/index.js
var BASE = "https://aniworld.to";
var LANG = { 1: "Deutsch", 2: "Japanisch, engl. UT", 3: "Japanisch, dt. UT" };
var ORDER = { 1: 0, 3: 1, 2: 2 };
var clean = (s) => String(s || "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').trim();
function search(q) {
  return __async(this, null, function* () {
    const text = yield postForm(`${BASE}/ajax/search`, { keyword: q }, { headers: { "X-Requested-With": "XMLHttpRequest", Referer: `${BASE}/search` } });
    return (JSON.parse(text || "[]") || []).map((i) => ({ link: i.link, title: clean(i.title) }));
  });
}
function findMovie(meta) {
  return __async(this, null, function* () {
    const queries = [].concat(...meta.titles.map((t) => [t, t.split(/\s[-–:]\s|:\s/).pop()])).filter((q, i, a) => q.length > 3 && a.indexOf(q) === i);
    for (const q of queries) {
      const items = yield search(q);
      const series = yield pickSeries(items.filter((i) => /^\/anime\/stream\/[^/]+$/.test(i.link)), meta, BASE);
      if (series) return series.link + "/staffel-1/episode-1";
      const film = items.find((i) => /\/staffel-0\/episode-\d+$/.test(i.link) && norm(i.title.split("]:")[0]).includes(norm(q)));
      if (film) return film.link;
    }
    return null;
  });
}
function episodePage(path) {
  return __async(this, null, function* () {
    const epUrl = BASE + path;
    const $ = load(yield getText(epUrl));
    const links = all($, ".hosterSiteVideo ul li").map((li) => ({
      url: li.attr("data-link-target"),
      lang: li.attr("data-lang-key")
    })).filter((l) => l.url).sort((x, y) => (ORDER[x.lang] || 0) - (ORDER[y.lang] || 0));
    return { epUrl, $, links };
  });
}
function getStreams(tmdbId, mediaType, season, episode) {
  return __async(this, null, function* () {
    try {
      const meta = yield getMeta(tmdbId, mediaType, season, episode);
      let candidates = [], series = null;
      if (mediaType === "movie") {
        const path = yield findMovie(meta);
        if (path) candidates = [{ href: path }];
      } else if (season != null && episode != null) {
        const queries = [].concat(...meta.titles.map((t) => [t, t.split(/\s[-–:]\s|:\s/)[0]])).filter((q, i, a) => q.length > 3 && a.indexOf(q) === i);
        for (const q of queries) {
          series = yield pickSeries((yield search(q)).filter((i) => /^\/anime\/stream\/[^/]+$/.test(i.link)), meta, BASE);
          if (series) break;
        }
        series = series || (yield bySlug(BASE, "/anime/stream/", meta));
        if (series) candidates = yield findEpisodeCandidates(BASE, series.link, season, episode, meta);
      }
      let page = null;
      for (const cand of candidates.slice(0, 4)) {
        const p = yield episodePage(cand.href).catch(() => ({ links: [] }));
        if (p.links.length) {
          page = p;
          break;
        }
      }
      if (!page) return [];
      const { epUrl, $, links } = page;
      const out = yield Promise.all(links.map((l) => __async(null, null, function* () {
        const embed = yield followRedirect(BASE + l.url, epUrl).catch(() => null);
        const lang = LANG[l.lang] || $(`.changeLanguageBox img[data-lang-key="${l.lang}"]`).attr("title") || "";
        return (yield resolveEmbed(embed, epUrl)).map((s) => ({
          name: "Aniworld",
          title: `${s.host} \xB7 ${lang}`,
          url: s.url,
          quality: s.quality,
          headers: s.headers,
          mediaTitle: series ? series.title : meta.title,
          year: series && series.year || meta.year
        }));
      })));
      return [].concat(...out);
    } catch (e) {
      console.error(`[Aniworld] ${e.message}`);
    }
    return [];
  });
}
module.exports = provider(getStreams);
