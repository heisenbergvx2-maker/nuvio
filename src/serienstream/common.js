import { getText, UA, send, mapLimit } from '../../shared/http.js';
import { score, matchEpisodeTitle } from '../../shared/match.js';
import { getSeasonEpisodes } from '../../shared/tmdb.js';
import { seasonRows, parseEpisodeRows } from '../../shared/episodes.js';

// Aniworld and Serienstream hide hosters behind a 30x redirect. Let the client follow it and take the final URL:
// aniworld sends that 301 with "content-encoding: gzip" and an empty body, which OkHttp (Nuvio desktop/Android)
// can only survive by not reading it, and Nuvio strips any Accept-Encoding a plugin sets (iOS ignores manual
// redirects anyway).
export async function followRedirect(url, referer) {
    const res = await send(url, { headers: { 'User-Agent': UA, Referer: referer } });
    return res.url && res.url !== url ? res.url : null;
}

const attachYear = (hit, meta) => Object.assign({}, hit.item, { year: hit.year || (meta && meta.year) });

// How many of the site's season 1 episodes a candidate shares with TMDB's season 1 — this is what tells two series
// of the same name apart when neither page carries an IMDb id (e.g. "Kingdom" 2014 US vs 2019 KR).
async function episodeOverlap(base, link, tmdbNames) {
    const rows = await seasonRows(base, link, 1);
    if (!rows.length) return 0;
    const titles = [].concat.apply([], tmdbNames.map(e => [e.name, e.originalName])).filter(Boolean);
    let hits = 0;
    for (const row of rows.slice(0, 12)) {
        if (matchEpisodeTitle(row.deTitle, row.origTitle, titles) >= 6) hits++;
    }
    return hits;
}

// exact title matches only; several (remakes, same-name shows) -> the one whose page links the TMDB IMDb id, else
// the one whose episode titles match TMDB's season 1
export async function pickSeries(items, meta, base) {
    if (!items || !items.length) return null;
    const scored = items.map(it => {
        const title = String(it.title || '');
        const year = (title.match(/\b(19\d\d|20\d\d)\b/) || (it.link && it.link.match(/-(19\d\d|20\d\d)$/)) || [])[1];
        return { item: it, score: score(title, year, meta), year };
    });
    let exact = scored.filter(x => x.score >= 3);
    if (!exact.length) return null;
    if (exact.length === 1) return attachYear(exact[0], meta);

    // one page request per candidate instead of one after the other, so the disambiguation stays inside the budget
    if (meta.imdbId) {
        const pages = await mapLimit(exact, 4, async h => {
            const html = await getText(base + h.item.link).catch(() => '');
            return html && html.includes(meta.imdbId) ? h : null;
        });
        const hit = pages.find(Boolean);
        if (hit) return attachYear(hit, meta);
    }

    const tmdbNames = await getSeasonEpisodes(meta.tmdbId, 1).catch(() => []);
    if (tmdbNames.length) {
        const overlaps = await mapLimit(exact, 3, h => episodeOverlap(base, h.item.link, tmdbNames));
        let best = null;
        overlaps.forEach((n, i) => { if (n && (!best || n > best.n)) best = { n, h: exact[i] }; });
        if (best) return attachYear(best.h, meta);
    }

    exact.sort((a, b) => b.score - a.score);
    return attachYear(exact[0], meta);
}

export const parseEpisodes = parseEpisodeRows;

// both sites' search misses many exact titles (s.to has "Dark" only on result page 3), so guess the slug and verify via IMDb id
export async function bySlug(base, prefix, meta) {
    if (!meta.imdbId) return null;
    for (const t of meta.titles) {
        const baseSlug = t.toLowerCase().replace(/['’]/g, '').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
            .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const slugs = [baseSlug];
        if (meta.year) slugs.push(`${baseSlug}-${meta.year}`);
        const pages = await mapLimit(slugs, 2, async slug => {
            const link = prefix + slug;
            const html = await getText(base + link).catch(() => '');
            return html && html.includes(meta.imdbId) ? { link, title: t, year: meta.year } : null;
        });
        const hit = pages.find(Boolean);
        if (hit) return hit;
    }
    return null;
}

export { findEpisodePath, findEpisodeCandidates, splitSeasonPath } from '../../shared/episodes.js';
