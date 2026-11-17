export function norm(s) {
    s = String(s || '').toLowerCase();
    if (s.normalize) s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return s.replace(/ß/g, 'ss').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
}

export function cleanTitle(s) {
    return String(s || '')
        .replace(/\b(19\d\d|20\d\d)\b/g, '')
        .replace(/[\(\)\[\]\{\}]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function extractYear(title, hint) {
    if (hint && /^(19\d\d|20\d\d)$/.test(String(hint))) return Number(hint);
    const m = String(title || '').match(/\b(19\d\d|20\d\d)\b/);
    return m ? Number(m[1]) : null;
}

export function score(title, year, meta) {
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

// Two releases of the same name ("Kingdom" 2014 US vs 2019 KR) are only told apart by year or IMDb id.
export function sameYear(a, b, tolerance = 1) {
    if (!a || !b) return false;
    return Math.abs(Number(a) - Number(b)) <= tolerance;
}

export function imdbFromHtml(html) {
    return ((String(html || '').match(/imdb\.com\/title\/(tt\d{7,10})/) || [])[1]) || null;
}

// items: [{title, year?, imdb?}] -> best item scoring >= 3, else null. A known but different IMDb id disqualifies an
// item, and if two items score the same the one whose year is closer to TMDB's wins.
export function pickBest(items, meta) {
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

export function cleanEpTitle(s) {
    return String(s || '')
        .replace(/\[Episode\s*\d+[^\]]*\]/gi, '')
        .replace(/\((Staffel|Season)\s*\d+[^)]*\)/gi, '')
        .replace(/\[[^\]]*\]/g, '')
        .trim();
}

// how much of the shorter title's words the other one contains (0..1)
export function titleAffinity(a, b) {
    const wa = new Set(norm(cleanEpTitle(a)).split(' ').filter(w => w.length > 3));
    const wb = new Set(norm(cleanEpTitle(b)).split(' ').filter(w => w.length > 3));
    if (!wa.size || !wb.size) return 0;
    let common = 0;
    wa.forEach(w => { if (wb.has(w)) common++; });
    return common / Math.min(wa.size, wb.size);
}

export function sharedWords(a, b) {
    const wa = new Set(norm(cleanEpTitle(a)).split(' ').filter(w => w.length > 3));
    return norm(cleanEpTitle(b)).split(' ').filter(w => w.length > 3 && wa.has(w)).length;
}

// 10 = same title, 6 = one title carries the other (site adds "- Part 1", TMDB keeps a subtitle), 5 = same words
// in a different order. A lone word ("Titel") must not identify an episode, so short matches are ignored.
export function matchEpisodeTitle(rowDe, rowOrig, targetTitles) {
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
        if ((sharedWords(rowDe, target) >= 2 && titleAffinity(rowDe, target) >= 0.6)
            || (sharedWords(rowOrig, target) >= 2 && titleAffinity(rowOrig, target) >= 0.6)) best = Math.max(best, 5);
    }
    return best;
}
