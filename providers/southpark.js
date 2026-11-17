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
function sameYear(a, b, tolerance = 1) {
  if (!a || !b) return false;
  return Math.abs(Number(a) - Number(b)) <= tolerance;
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
  const m = `${s.url || ""} ${fileNames[s.url] || ""}`.match(/[^\d](\d{3,4})p/i);
  if (m) return m[1] + "p";
  if (/\.m3u8|\/hls|master/i.test(s.url || "")) return "HLS";
  if (/\.mp4/i.test(s.url || "")) return "MP4";
  return "auto";
}
var AUDIO = [[/dd[p]?[\s._-]?5[\s._-]?1|dolby|ac3|eac3|dts|\b5\.1\b/i, 2], [/aac|\b2\.0\b|stereo/i, 1]];
var audioRank = (url, title) => {
  const hay = fileNames[url] || title || "";
  const hit = AUDIO.find(([re]) => re.test(hay));
  return hit ? hit[1] : 0;
};
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
          ranked.push({ lang: d.lang, rank: qualityRank(d.stream.quality), audio: audioRank(d.stream.url, d.stream.title), i, stream: d.stream });
        });
        const langRank = (lang) => lang === "Deutsch" ? 0 : /dt\. UT|OmU/.test(lang) ? 1 : 2;
        ranked.sort((a, b) => langRank(a.lang) - langRank(b.lang) || b.rank - a.rank || b.audio - a.audio || a.i - b.i);
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

// src/southpark/index.js
var BASE = "https://www.southpark.de";
var TOPAZ = "https://topaz.paramount.tech/topaz/api";
function getStreams(tmdbId, mediaType, season, episode) {
  return __async(this, null, function* () {
    if (String(tmdbId) !== "2190" || mediaType !== "tv" || !season) return [];
    try {
      let path = "/seasons/south-park";
      if (season !== 1) {
        const m = (yield getText(BASE + path)).match(new RegExp(`/seasons/south-park/[a-z0-9]+/staffel-${season}"`));
        if (!m) return [];
        path = m[0].slice(0, -1);
      }
      const mgid = (yield getText(BASE + path)).match(/mgid:arc:season:southpark\.intl:[0-9a-f-]+/);
      if (!mgid) return [];
      const items = (yield getJson(`${BASE}/api/context/${encodeURIComponent(mgid[0])}/episode/1/100`)).items || [];
      const ep = items.find((i) => {
        const h = i.meta.header.title;
        const m = String(h && h.text || h).match(/S(\d+)\D+(\d+)/);
        return m && Number(m[1]) === season && Number(m[2]) === episode;
      });
      if (!ep) return [];
      const streams = [];
      for (const [ns, lang] of [["de", "Deutsch"], ["en", "Englisch"]]) {
        const res = yield getJson(`${TOPAZ}/mgid:arc:episode:shared.southpark.gsa.${ns}:${ep.id}/mica.json?clientPlatform=mobile`);
        const src = res.stitchedstream && res.stitchedstream.source;
        if (src) streams.push({ name: "South Park", title: `S${season}E${episode} ${ep.meta.subHeader || ""} \xB7 ${lang} \xB7 HLS`, url: src, quality: "auto", mediaTitle: "South Park" });
      }
      return streams;
    } catch (e) {
      console.error(`[South Park] ${e.message}`);
    }
    return [];
  });
}
module.exports = provider(getStreams);
