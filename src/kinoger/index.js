import { getText, provider } from '../../shared/http.js';
import { getMeta } from '../../shared/tmdb.js';
import { pickBest, score, imdbFromHtml, extractYear } from '../../shared/match.js';
import { load, all } from '../../shared/dom.js';
import { resolveAll } from '../../shared/extractors/index.js';

// Port of Bnyro/GermanProviders' Kinoger. DLE site: the search lives on the index page, the player embed URLs sit in
// the scripts of the "container-video" blocks. The CloudStream original also reads the season/episode arrays of the
// script payload; that part is not ported (the layout of those arrays cannot be verified from here), so this provider
// handles films - for series the page has no reliable single-episode assignment.
const BASE = 'https://kinoger.com';
const HEADERS = { Referer: `${BASE}/` };

async function search(q) {
    const $ = load(await getText(`${BASE}/?do=search&subaction=search&titleonly=3&story=${encodeURIComponent(q)}&x=0&y=0&submit=submit`, { headers: HEADERS }));
    return all($, 'div#dle-content div.titlecontrol').map(d => {
        const a = $('a', d).first();
        const title = ($('a', d).first().text() || $('img', d).attr('alt') || '').replace(/\s*Film\s*$/i, '').trim();
        return { href: a.attr('href'), title };
    }).filter(i => i.href && i.title && !/kinoger/i.test(i.title));
}

// player URLs live inside the scripts of the video containers
function playerLinks(html, $) {
    const block = all($, 'div[id^="container-video"]').map(d => d.html() || '').join('\n');
    const source = block || all($, 'div[id^="container-video"], section[id^="content"]').map(d => d.html() || '').join('\n');
    const urls = (source.match(/https?:\\?\/\\?\/[^"'\\\s,]+/g) || []).map(u => u.replace(/\\\//g, '/'));
    return urls.filter((u, i, a) => a.indexOf(u) === i);
}

async function getStreams(tmdbId, mediaType) {
    if (mediaType !== 'movie') return [];
    try {
        const meta = await getMeta(tmdbId, mediaType);
        let hit = null;
        for (const q of meta.titles) {
            const items = await search(q);
            hit = pickBest(items, meta);
            if (hit) break;
        }
        if (!hit) return [];

        const html = await getText(hit.href, { headers: HEADERS });
        const $ = load(html);
        const pageTitle = $('#news-title').text().trim() || hit.title;
        const year = extractYear(pageTitle) || extractYear(hit.title) || meta.year;
        const imdb = imdbFromHtml(html);
        // never return a different film: the page must carry the IMDb id or a matching title/year
        if (meta.imdbId && imdb && imdb !== meta.imdbId) return [];
        if (!(imdb && imdb === meta.imdbId) && score(pageTitle, year, meta) < 3) return [];

        const links = playerLinks(html, $);
        if (!links.length) return [];
        const streams = await resolveAll(links, hit.href);
        return streams.map(s => ({
            name: 'Kinoger',
            title: `${s.host} · Deutsch${s.quality !== 'auto' ? ' · ' + s.quality : ''}`,
            url: s.url,
            quality: s.quality,
            headers: s.headers,
            mediaTitle: pageTitle,
            year,
        }));
    } catch (e) {
        console.error(`[Kinoger] ${e.message}`);
    }
    return [];
}

module.exports = provider(getStreams);
