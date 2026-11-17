import { ctx } from './context.js';
import { sameYear } from './match.js';

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Nuvio on iOS closes the QuickJS runtime as soon as getStreams settles (or after its 60 s timeout); a fetch still
// in flight at that moment aborts the whole app. So every request goes through send(), and provider() only
// answers once none is running. After DEADLINE_MS no new request starts, to stay clear of Nuvio's timeout.
// Nuvio TV's fetch blocks, so a plugin's requests run one after the other and cannot be aborted, and it runs ten
// plugins at a time: a slow one holds a slot the others wait for. The budget is what keeps that short.
const DEADLINE_MS = 25000;
let running = 0, idle = [], deadline = Infinity;

export function send(url, opts) {
    if (Date.now() > deadline) return Promise.reject(new Error(`deadline reached, skipped ${url}`));
    running++;
    const done = () => { if (--running === 0) idle.splice(0).forEach(resolve => resolve()); };
    return fetch(url, opts).then(res => { done(); return res; }, err => { done(); throw err; });
}

// Run fn over items with at most `limit` requests in flight; a failing item yields null instead of aborting the batch.
export function mapLimit(items, limit, fn) {
    const list = items || [];
    const out = new Array(list.length);
    let next = 0;
    const worker = async () => {
        while (next < list.length) {
            const i = next++;
            try {
                out[i] = await fn(list[i], i);
            } catch (e) {
                out[i] = null;
            }
        }
    };
    const workers = [];
    for (let i = 0; i < Math.min(limit || 1, list.length); i++) workers.push(worker());
    return Promise.all(workers).then(() => out);
}

// Only real http(s) URLs may reach the player, and header values must not smuggle line breaks into the request.
export function safeUrl(url) {
    return typeof url === 'string' && /^https?:\/\/[^\s]+$/i.test(url) ? url : null;
}

export function safeHeaders(headers) {
    if (!headers || typeof headers !== 'object') return undefined;
    const out = {};
    for (const k of Object.keys(headers)) {
        const v = headers[k];
        if (/^[A-Za-z0-9-]+$/.test(k) && typeof v === 'string' && v && !/[\r\n]/.test(v)) out[k] = v;
    }
    return Object.keys(out).length ? out : undefined;
}

// Nuvio mobile/desktop show only `name` and `quality` (not `title`), Nuvio TV shows `name - quality` plus `title`,
// so the language and the title/year Nuvio asked for go into the name and 'auto' becomes the stream format.
const SUBBED = [[/ger(man)?[\s._-]*sub|untertitel deutsch/i, 'Original, dt. UT'], [/eng(lish)?[\s._-]*sub|untertitel englisch/i, 'Original, engl. UT']];
const LANGS = [[/japanisch, dt\. ut/i, 'Japanisch, dt. UT'], [/japanisch, engl\. ut/i, 'Japanisch, engl. UT']].concat(SUBBED, [
    [/\bomu\b/i, 'OmU'], [/\bov\b/i, 'OV'], [/englisch|\ben\b/i, 'Englisch'], [/franz|\bfr\b/i, 'Französisch'], [/spanisch/i, 'Spanisch'],
    [/japanisch/i, 'Japanisch'], [/deutsch|\bde\b/i, 'Deutsch']]);

// stream URL -> the hoster's file name, where the hoster shows one. Sites like huhu.to file "…GerSub.720p…" under plain
// German, so a file name that says "subbed" beats a title that only says German.
export const fileNames = {};

function resolution(q) {
    const m = String(q || '').match(/(\d{3,4})p/i);
    return m ? Number(m[1]) : 0;
}

// 'auto' is what a master playlist reports: it adapts to the connection, so it must not be sorted below a fixed 720p.
function qualityOf(s) {
    if (s.quality && s.quality !== 'auto') return String(s.quality);
    const m = String(s.url || '').match(/[^\d](\d{3,4})p/i);
    if (m) return m[1] + 'p';
    if (/\.m3u8|\/hls|master/i.test(s.url || '')) return 'HLS';
    if (/\.mp4/i.test(s.url || '')) return 'MP4';
    return 'auto';
}

const qualityRank = q => resolution(q) || (/hls|m3u8|auto/i.test(q) ? 800 : 0);

function decorate(s) {
    const url = safeUrl(s.url);
    if (!url) return null;
    // drop streams that clearly belong to a different production (same name, other series/film)
    const meta = ctx.meta;
    if (meta) {
        if (s.imdbId && meta.imdbId && s.imdbId !== meta.imdbId) return null;
        if (s.year && meta.year && !sameYear(s.year, meta.year, 2)) {
            console.error(`[provider] dropped "${s.mediaTitle || ''}" (${s.year}): Nuvio asked for ${meta.title} (${meta.year})`);
            return null;
        }
    }
    const hit = LANGS.find(([re]) => re.test(s.title || ''));
    let lang = hit ? hit[1] : 'Deutsch', title = s.title;
    const sub = SUBBED.find(([re]) => re.test(fileNames[url] || ''));
    if (sub && !/UT|OmU/.test(lang)) {
        lang = sub[1];
        // Nuvio TV shows the title under the name, so it must not keep saying "Deutsch"
        title = hit ? title.replace(hit[0], lang) : [title, lang].filter(Boolean).join(' · ');
    }
    const quality = qualityOf(s);
    const host = ((s.title || '').split(' · ')[0].match(/^[\w-]+\.[a-z]{2,}$/) || [])[0];
    // the title/year Nuvio asked for, so the user can tell what is actually playing (Nuvio mobile only shows the name)
    const media = s.mediaTitle ? `${s.mediaTitle}${s.year ? ` (${s.year})` : ''}` : '';
    return {
        lang,
        stream: Object.assign({}, s, {
            url,
            name: [s.name, media, lang, host].filter(Boolean).join(' · '),
            title,
            quality,
            headers: safeHeaders(s.headers),
        }),
    };
}

export function provider(getStreams) {
    return {
        async getStreams(tmdbId, mediaType, season, episode) {
            deadline = Date.now() + DEADLINE_MS;
            ctx.meta = null;
            // Nuvio's "Test provider" passes 'series' where playback passes 'tv'
            if (mediaType !== 'movie') mediaType = 'tv';
            let streams = [];
            try {
                streams = (await getStreams(tmdbId, mediaType, season, episode)) || [];
            } catch (e) {
                console.error(e.message);
            }
            if (running) await new Promise(resolve => idle.push(resolve));
            // German dub first, then German subtitles, then the rest; within a group the best resolution first, and
            // the provider's own order breaks ties.
            const seen = {};
            const ranked = [];
            streams.forEach((s, i) => {
                if (!s) return;
                const d = decorate(s);
                if (!d || seen[d.stream.url]) return;
                seen[d.stream.url] = true;
                ranked.push({ lang: d.lang, rank: qualityRank(d.stream.quality), i, stream: d.stream });
            });
            const langRank = lang => (lang === 'Deutsch' ? 0 : /dt\. UT|OmU/.test(lang) ? 1 : 2);
            ranked.sort((a, b) => langRank(a.lang) - langRank(b.lang) || b.rank - a.rank || a.i - b.i);
            return ranked.map(r => r.stream);
        },
    };
}

export async function request(url, opts = {}) {
    if (!safeUrl(url)) throw new Error(`invalid url ${url}`);
    const headers = Object.assign({ 'User-Agent': UA }, safeHeaders(opts.headers));
    const res = await send(url, Object.assign({}, opts, { headers }));
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return res;
}

export const getText = async (url, opts) => (await request(url, opts)).text();

export const getJson = async (url, opts) => JSON.parse(await getText(url, opts));

export const postJson = (url, body, opts = {}) => getJson(url, Object.assign({}, opts, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: Object.assign({ 'Content-Type': 'application/json' }, opts.headers),
}));

export const postForm = (url, form, opts = {}) => getText(url, Object.assign({}, opts, {
    method: 'POST',
    body: Object.keys(form).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(form[k])).join('&'),
    headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded' }, opts.headers),
}));

export function absolute(url, base) {
    if (!url) return url;
    if (url.startsWith('//')) return 'https:' + url;
    if (/^https?:/.test(url)) return url;
    const origin = base.match(/^https?:\/\/[^/]+/)[0];
    return url.startsWith('/') ? origin + url : base.replace(/[^/]*$/, '') + url;
}
