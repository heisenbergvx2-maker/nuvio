import { getText } from './http.js';
import { getSeasonEpisodes } from './tmdb.js';
import { load } from './dom.js';
import { cached } from './cache.js';
import { matchEpisodeTitle } from './match.js';

// One resolver for serienstream (s.to) and aniworld: both render the same season table, one <tr itemprop="episode">
// per episode with the German title in <strong> and the original one in <span> (aniworld appends "[Episode 154]").
const ROW_TTL = 5 * 60 * 1000;
const MAX_SEASON = 40;

export function parseEpisodeRows(html) {
    if (!html) return [];
    const $ = load(html);
    const seen = {};
    const rows = [];
    $('tr[itemprop="episode"], table.seasonEpisodesList tbody tr').each((_, el) => {
        const row = $(el);
        const link = row.find('.seasonEpisodeTitle a').first();
        const anyLink = row.find('a[href*="/episode-"]').first();
        const href = (link.length ? link.attr('href') : anyLink.attr('href')) || '';
        if (!href) return;
        if (seen[href]) return;
        seen[href] = true;
        const num = Number((href.match(/episode-(\d+)/) || [])[1])
            || Number(row.find('meta[itemprop="episodeNumber"]').attr('content')) || null;
        rows.push({
            href,
            epNum: num,
            deTitle: (row.find('.seasonEpisodeTitle strong').text() || '').replace(/\s+/g, ' ').trim(),
            origTitle: (row.find('.seasonEpisodeTitle span').text() || '').replace(/\s+/g, ' ').trim(),
        });
    });
    return rows;
}

export function seasonRows(base, link, season) {
    const url = `${base}${link}/staffel-${season}`;
    return cached(`rows:${url}`, ROW_TTL, async () => {
        const html = await getText(url).catch(() => '');
        return parseEpisodeRows(html);
    });
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

// Candidate episode paths, best first. Every candidate is tried in order until one yields hoster links, so a wrong
// guess costs one request instead of returning nothing.
export async function findEpisodeCandidates(base, link, season, episode, meta) {
    const sn = Number(season) || 1;
    const ep = Number(episode) || 1;
    const out = [];
    const add = (row, score, why) => {
        if (!row || !row.href) return;
        if (out.some(c => c.href === row.href)) return;
        out.push({ href: row.href, score, why });
    };

    const rows = await seasonRows(base, link, sn);
    const titles = ((meta && meta.episodeTitles) || []).slice();

    // 1) the normal case: the episode title identifies the row
    const local = bestRow(rows, titles);
    if (local && local.score >= 10) return [{ href: local.row.href, score: local.score, why: 'title' }];
    if (local) add(local.row, local.score, 'title-fuzzy');

    // 2) TMDB's numbering and the site's numbering drift apart; the full TMDB season tells us by how much and
    //    whether the site's season carries extra entries at the front (Columbo's two pilot films are episodes 1-2
    //    there, TMDB starts the regular series with them as season 1 episode 2)
    const info = await getSeasonEpisodes(meta && meta.tmdbId, sn).catch(() => []);
    const infoEp = info.find(e => e.number === ep) || info[ep - 1] || null;
    const allTitles = titles.concat(infoEp ? [infoEp.name, infoEp.originalName] : []).filter((t, i, a) => t && a.indexOf(t) === i);
    if ((!local || local.score < 10) && allTitles.length !== titles.length) {
        const retry = bestRow(rows, allTitles);
        if (retry && retry.score >= 10) return [{ href: retry.row.href, score: retry.score, why: 'title' }];
        if (retry) add(retry.row, retry.score, 'title-fuzzy');
    }
    // 3) offset: the site lists more episodes in this season than TMDB does, so the requested episode sits further down
    const siteMax = maxNum(rows);
    if (rows.length && info.length && siteMax === rows.length) {
        const offset = rows.length - info.length;
        if (offset > 0 && offset < 10) {
            const row = rows.find(r => r.epNum === ep + offset);
            if (row) add(row, rows.length > info.length + 1 ? 7 : 6, 'offset');
        }
    }

    // 4) neighbouring seasons: aniworld/s.to split long anime differently (Black Clover: TMDB 4 seasons, site 5;
    //    Re:Zero: TMDB one season with absolute numbers, site four)
    if (!out.length || out[0].score < 10) {
        const around = [];
        for (let s = sn + 1; s <= Math.min(sn + 3, MAX_SEASON); s++) around.push(s);
        for (let s = sn - 1; s >= Math.max(1, sn - 3); s--) around.push(s);
        const pages = await Promise.all(around.map(s => seasonRows(base, link, s)));
        let found = null;
        pages.forEach((pageRows, i) => {
            const hit = bestRow(pageRows, allTitles);
            if (hit && (!found || hit.score > found.score)) found = { row: hit.row, score: hit.score, season: around[i] };
        });
        if (found && found.score >= 10) return [{ href: found.row.href, score: found.score, why: `title-season-${found.season}` }];
        if (found && found.score >= 5) add(found.row, found.score, 'title-other-season');
    }

    // 5) absolute numbering inside one TMDB season (episode 78 of a 85 episode "season 1" is season 4 episode 12)
    if (sn === 1 && ep > (siteMax || 0)) {
        let rest = ep;
        for (let s = 1; s <= Math.min(MAX_SEASON, ep); s++) {
            const pageRows = await seasonRows(base, link, s);
            const max = maxNum(pageRows);
            if (!max) break;
            if (rest <= max) {
                const row = pageRows.find(r => r.epNum === rest);
                if (row) {
                    add(row, 6, 'absolute');
                    break;
                }
                break;
            }
            rest -= max;
        }
    }

    // 6) plain episode number, then the URL guess the old code used unconditionally
    add(rows.find(r => r.epNum === ep), 1, 'number');
    add({ href: `${link}/staffel-${sn}/episode-${ep}` }, 0, 'guess');

    return out.sort((a, b) => b.score - a.score);
}

// Kept for compatibility: the single best candidate.
export async function findEpisodePath(base, link, season, episode, meta) {
    const candidates = await findEpisodeCandidates(base, link, season, episode, meta);
    return candidates.length ? candidates[0].href : null;
}

// TMDB lists many anime as one season with absolute numbering (Re:ZERO S1 E78) where both sites split them into
// seasons (staffel-4/episode-12): walk the season pages from the requested one and subtract their episode counts.
// null when the episode is in the requested season after all, or past the last season.
export async function splitSeasonPath(base, link, season, episode) {
    let remaining = Number(episode) || 1;
    const sn = Number(season) || 1;
    for (let s = sn; s <= MAX_SEASON; s++) {
        const rows = await seasonRows(base, link, s);
        const max = maxNum(rows);
        if (!max) return null;
        if (s === sn && remaining <= max) return null;
        if (remaining <= max) {
            const row = rows.find(r => r.epNum === remaining);
            return row ? row.href : `${link}/staffel-${s}/episode-${remaining}`;
        }
        remaining -= max;
    }
    return null;
}
