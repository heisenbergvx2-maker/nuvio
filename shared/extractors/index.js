import * as h from './hosters.js';
import { mapLimit, safeUrl, timeLeft } from '../http.js';

// host (without www.) -> decoder; mirrors from GermanProviders' extractor registrations + CloudStream core
const HOSTS = [
    [h.voe, ['voe.sx', 'goofy-banana.com', 'urochsunloath.com', 'donaldlineelse.com', 'charlestoughrace.com', 'tubelessceliolymph.com', 'simpulumlamerop.com', 'nathanfromsubject.com', 'yip.su', 'metagnathtuggers.com']],
    [h.vidstack, ['moflix.upns.xyz', 'moflix.rpmplay.xyz']],
    [h.supervideo, ['supervideo', 'dropload', 'abstream.to', 'dr0pstream.com']],
    [h.vidhidepro, ['vidhide', 'filelions', 'ryderjet.com', 'moflix-stream.click', 'smoothpre.com', 'dhtpre.com', 'peytonepre.com']],
    [h.streamwish, ['streamwish', 'luluvdo.com', 'streamruby.com', 'savefiles.com', 'wishembed', 'swdyu.com', 'strwish']],
    [h.lulustream, ['lulustream.com', 'luluvdoo.com']],
    [h.mixdrop, ['mixdrop', 'mixdrp', 'mxdrop', 'mdy48tn97.com']],
    [h.filemoon, ['filemoon']],
    [h.vidoza, ['vidoza.net', 'videzz.net']],
    [h.streamtape, ['streamtape', 'watchadsontape.com', 'shavetape.cash']],
];

// Dood answers every non-browser client with a Cloudflare challenge on all of these domains, so asking only costs a
// request, and Nuvio TV runs a plugin's requests one after the other. Unknown Dood mirrors still go through sniff().
const BLOCKED = ['dood', 'd000d.com', 'vide0.net', 'dsvplay.com', 'dooodster.com', 'doods.pro', 'playmogo.com', 'd0000d.com', 'ds2play.com', 'doodstream.com', 'do7go.com'];

const hostOf = url => (url.match(/^https?:\/\/(?:www\.)?([^/:?#]+)/i) || [])[1] || '';
const listed = (host, names) => names.some(n => host === n || (!n.includes('.') && host.includes(n)));

export function decoderFor(url) {
    const hit = HOSTS.find(([, names]) => listed(hostOf(url), names));
    return hit ? hit[0] : h.sniff;
}

// embed URL -> [{url, quality, headers, host}], never throws
export async function resolveEmbed(url, referer) {
    if (!url) return [];
    if (url.startsWith('//')) url = 'https:' + url;
    if (!safeUrl(url)) return [];
    if (listed(hostOf(url), BLOCKED)) return [];
    try {
        const host = url.split('/')[2].replace(/^www\./, '');
        const found = await decoderFor(url)(url, referer);
        // a decoder may hand back anything it scraped: only real http(s) URLs reach the player
        return (found || [])
            .filter(s => s && safeUrl(s.url))
            .map(s => Object.assign({}, s, { url: safeUrl(s.url), host }));
    } catch (e) {
        console.error(`[extractor] ${url}: ${e.message}`);
        return [];
    }
}

// roughly how fast a hoster answers, quickest first: VOE's CDN is usually the fastest and most 1080p source,
// Filemoon/MixDrop the slowest. Used to resolve the promising mirrors first instead of in page order.
const SPEED = ['voe', 'vidmoly', 'streamtape', 'vidoza', 'streamwish', 'vidhide', 'lulustream', 'filemoon', 'mixdrop'];
export function hostRank(url) {
    const host = hostOf(url);
    for (let i = 0; i < SPEED.length; i++) if (host.includes(SPEED[i])) return i;
    return SPEED.length;
}

// bounded, quickest hosters first; when the 25 s budget is nearly used up no further mirror is started, so one dead
// hoster cannot hold the whole answer until Nuvio's timeout
export const resolveAll = (urls, referer) => {
    const list = (urls || []).filter(Boolean).slice().sort((a, b) => hostRank(a) - hostRank(b));
    return mapLimit(list, 5, u => (timeLeft() > 7000 ? resolveEmbed(u, referer) : []))
        .then(lists => [].concat.apply([], lists.filter(Boolean)));
};
