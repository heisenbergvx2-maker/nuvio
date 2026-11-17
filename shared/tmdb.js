import { getJson } from './http.js';
import { cached } from './cache.js';
import { ctx } from './context.js';

// Nuvio injects TMDB_API_KEY as a global; test.js sets it from the environment.
const TTL = 10 * 60 * 1000;

const api = (path, extra) => {
    if (!globalThis.TMDB_API_KEY) return Promise.reject(new Error('TMDB_API_KEY missing'));
    return getJson(`https://api.themoviedb.org/3/${path}?api_key=${globalThis.TMDB_API_KEY}${extra || ''}`);
};

const english = translations => (translations || []).find(t => t.iso_639_1 === 'en' && t.iso_3166_1 === 'US') || (translations || []).find(t => t.iso_639_1 === 'en');

// Full TMDB episode list of a season with the German and the original title. Season numbering on the sites often
// differs (aniworld splits Black Clover into 5 seasons where TMDB has 4, s.to keeps Columbo's pilot films as
// episodes 1-2), so this is what episode matching and the offset detection work on.
export async function getSeasonEpisodes(tmdbId, season) {
    if (season == null) return [];
    return cached(`season:${tmdbId}:${season}`, TTL, async () => {
        const d = await api(`tv/${tmdbId}/season/${season}`, '&language=de-DE');
        return (d.episodes || []).map(e => ({
            number: Number(e.episode_number) || 0,
            name: e.name || '',
            originalName: e.original_name || '',
            airDate: e.air_date || '',
        }));
    });
}

export async function getEpisodeMeta(tmdbId, season, episode) {
    if (!globalThis.TMDB_API_KEY || season == null || episode == null) return null;
    try {
        const epDe = await cached(`episode:${tmdbId}:${season}:${episode}`, TTL,
            () => api(`tv/${tmdbId}/season/${season}/episode/${episode}`, '&language=de-DE&append_to_response=translations,external_ids'));
        const en = english(((epDe.translations || {}).translations));
        const deTitle = epDe.name || '';
        const enTitle = (en && en.data && en.data.name) || epDe.original_name || '';
        const titles = [deTitle, enTitle].filter((t, i, a) => t && a.indexOf(t) === i);
        return {
            name: deTitle,
            englishName: enTitle,
            titles,
            season: Number(season),
            episode: Number(episode),
            airDate: epDe.air_date || '',
            imdbId: (epDe.external_ids || {}).imdb_id || null,
        };
    } catch (e) {
        return null;
    }
}

export async function getMeta(tmdbId, mediaType, season, episode) {
    const type = mediaType === 'tv' ? 'tv' : 'movie';
    const mainPromise = cached(`main:${type}:${tmdbId}`, TTL,
        () => api(`${type}/${tmdbId}`, '&language=de-DE&append_to_response=external_ids,translations,alternative_titles'));
    const epPromise = (type === 'tv' && season != null && episode != null)
        ? getEpisodeMeta(tmdbId, season, episode)
        : Promise.resolve(null);
    const [d, epMeta] = await Promise.all([mainPromise, epPromise]);
    const tr = ((d.translations || {}).translations || []);
    const en = english(tr);
    const alts = ((d.alternative_titles || {}).titles || (d.alternative_titles || {}).results || [])
        .filter(a => a.iso_3166_1 === 'DE' || a.iso_3166_1 === 'AT').map(a => a.title);
    const title = d.title || d.name;
    const originalTitle = d.original_title || d.original_name;
    const englishTitle = en && (en.data.title || en.data.name);
    const date = d.release_date || d.first_air_date || '';
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
        episodeImdbId: epMeta ? epMeta.imdbId : null,
    };
    ctx.meta = meta;
    return meta;
}
