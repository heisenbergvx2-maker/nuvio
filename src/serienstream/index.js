import { getText, provider } from '../../shared/http.js';
import { getMeta } from '../../shared/tmdb.js';
import { load, all } from '../../shared/dom.js';
import { resolveEmbed } from '../../shared/extractors/index.js';
import { bySlug, followRedirect, pickSeries, findEpisodeCandidates } from './common.js';

const BASES = ['https://serienstream.to', 'https://serienstream.sx'];

async function getStreams(tmdbId, mediaType, season, episode) {
    if (mediaType !== 'tv' || season == null || episode == null) return [];
    try {
        const meta = await getMeta(tmdbId, mediaType, season, episode);

        for (const BASE of BASES) {
            try {
                let series = null;
                for (const q of meta.titles) {
                    const $ = load(await getText(`${BASE}/suche?term=${encodeURIComponent(q)}&tab=shows`, { headers: { Referer: `${BASE}/suche` } }));
                    const items = all($, 'a.show-cover').map(a => ({ link: a.attr('href'), title: $('img', a).attr('alt') }));
                    if ((series = await pickSeries(items, meta, BASE))) break;
                }
                series = series || await bySlug(BASE, '/serie/', meta);
                if (!series) continue;

                const episodePage = async path => {
                    const epUrl = BASE + path;
                    const $ = load(await getText(epUrl).catch(() => ''));
                    const links = all($, '.link-wrapper button').filter(b => b.attr('data-provider-name') !== 'Provider').map(b => ({
                        url: b.attr('data-play-url'), lang: b.attr('data-language-label'), langId: b.attr('data-language-id'),
                    }));
                    return { epUrl, links };
                };

                const epPath = await findEpisodeCandidates(BASE, series.link, season, episode, meta);
                // Try the candidates in order of confidence: the title match, then the numbering offset, then the
                // plain number. A page without hosters means "wrong pick, try the next one" instead of "no streams".
                let page = null;
                for (const cand of epPath.slice(0, 4)) {
                    const p = await episodePage(cand.href).catch(() => ({ links: [] }));
                    if (p.links.length) { page = p; break; }
                }
                if (!page) continue;
                const { epUrl, links } = page;
                if (!links.length) continue;

                for (const langId of ['1', '3', '2']) {
                    const out = await Promise.all(links.filter(l => l.langId === langId).map(async l => {
                        const embed = await followRedirect(BASE + l.url, epUrl).catch(() => null);
                        return (await resolveEmbed(embed, epUrl)).map(s => ({
                            name: 'Serienstream',
                            title: `${s.host} · ${l.lang}`,
                            url: s.url,
                            quality: s.quality,
                            headers: s.headers,
                            mediaTitle: series.title,
                            year: series.year || meta.year,
                        }));
                    }));
                    const streams = [].concat(...out);
                    if (streams.length) return streams;
                }
            } catch (err) {
                // Try next mirror if network or DNS failed
                continue;
            }
        }
    } catch (e) {
        console.error(`[Serienstream] ${e.message}`);
    }
    return [];
}

module.exports = provider(getStreams);
