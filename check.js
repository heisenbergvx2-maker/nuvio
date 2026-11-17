#!/usr/bin/env node
// Offline self-check of the logic that has no live-network test: node check.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const cache = 'node_modules/.cache/check';
fs.mkdirSync(cache, { recursive: true });

// One bundle for all shared modules, so getMeta()/provider()/the episode resolver share the same module state.
const entry = path.join(cache, 'api-entry.js');
fs.writeFileSync(entry, [
    "export * from '../../../shared/http.js';",
    "export * from '../../../shared/tmdb.js';",
    "export * from '../../../shared/episodes.js';",
    "export * from '../../../shared/match.js';",
].join('\n'));
const build = (entryPoints, outfile) => esbuild.buildSync({
    entryPoints: [entryPoints],
    outfile,
    bundle: true,
    format: 'cjs',
    platform: 'neutral',
    external: ['cheerio', 'crypto-js'],
    logLevel: 'error',
});
build(entry, path.join(cache, 'api.js'));
build('shared/extractors/util.js', path.join(cache, 'util.js'));
build('shared/extractors/index.js', path.join(cache, 'extractors.js'));

const api = require('./node_modules/.cache/check/api.js');
const { unpack, jwplayer } = require('./node_modules/.cache/check/util.js');
const { resolveEmbed } = require('./node_modules/.cache/check/extractors.js');
const { provider, getMeta, findEpisodeCandidates, splitSeasonPath, pickBest, safeUrl, safeHeaders } = api;

globalThis.TMDB_API_KEY = 'test-key';

// every bundle must load and expose getStreams - a broken bundle is what the app would see
for (const id of fs.readdirSync('src').filter(d => fs.existsSync(path.join('src', d, 'index.js')))) {
    const file = path.join('providers', id + '.js');
    assert.ok(fs.existsSync(file), `missing bundle ${file} - run node build.js first`);
    const mod = require('./' + file);
    assert.strictEqual(typeof mod.getStreams, 'function', `${id} does not export getStreams`);
}

const json = obj => ({ ok: true, status: 200, text: async () => JSON.stringify(obj), headers: { get: () => 'application/json' } });
const html = body => ({ ok: true, status: 200, text: async () => body, headers: { get: () => 'text/html' } });
const missing = () => ({ ok: false, status: 404, text: async () => '' });

// one row of the season table both sites render
const row = (link, season, n, de, orig) =>
    `<tr itemprop="episode"><td class="seasonEpisodeTitle"><a href="${link}/staffel-${season}/episode-${n}"><strong>${de}</strong> - <span>${orig || ''}</span></a></td></tr>`;
const rows = (link, season, list) =>
    `<table class="seasonEpisodesList"><tbody>${list.map(([n, de, orig]) => row(link, season, n, de, orig)).join('')}</tbody></table>`;
const tmdbSeason = n => ({ episodes: Array.from({ length: n }, (_, i) => ({ episode_number: i + 1, name: `Folge ${i + 1}`, original_name: `Episode ${i + 1}`, air_date: '' })) });

// --- P.A.C.K.E.R. + JWPlayer (CloudStream ports) ---
const packed = `<script>eval(function(p,a,c,k,e,d){while(c--)if(k[c])p=p.replace(new RegExp('\\\\b'+c.toString(a)+'\\\\b','g'),k[c]);return p}('0 1=\\'2\\';3.4({5:[{6:"7://8.9/a.b"}]})',12,12,'var|x|h\\u00e9llo|jwplayer|setup|sources|file|https|cdn|example|master|m3u8'.split('|'),0,{}))</script>`;
const code = unpack(packed);
assert.ok(code.startsWith("var x='"), code);
assert.deepStrictEqual(jwplayer(code, 'https://host.tld/e/1'), [{ url: 'https://cdn.example/master.m3u8', quality: 'auto' }]);
assert.deepStrictEqual(jwplayer('sources: [{file:"/v.mp4",label:"720p"}]', 'https://h.tld/x'), [{ url: 'https://h.tld/v.mp4', quality: '720p' }]);

// --- security helpers ---
assert.strictEqual(safeUrl('javascript:alert(1)'), null);
assert.strictEqual(safeUrl('https://cdn.example/a.m3u8'), 'https://cdn.example/a.m3u8');
assert.deepStrictEqual(safeHeaders({ 'X-Ok': '1', 'Bad\nKey': 'x', 'Y-Drop': 'a\r\nb', 'Z-Empty': '' }), { 'X-Ok': '1' });

(async () => {
    // a provider that fails early while a request is still running must not answer before that request is done
    let finished = false;
    globalThis.fetch = () => new Promise(resolve => setTimeout(() => { finished = true; resolve({ ok: true }); }, 50));
    const errorLog = console.error;
    console.error = () => {};
    const streams = await provider(async () => { api.send('https://slow.example'); throw new Error('early'); }).getStreams('1', 'movie');
    console.error = errorLog;
    assert.deepStrictEqual(streams, []);
    assert.ok(finished, 'getStreams answered while a request was still running');

    // German dub first, then German subtitles, then the rest
    const named = await provider(async () => [
        { name: 'X', title: 'voe.sx · Ger-Sub', url: 'https://v/1' },
        { name: 'X', title: 'voe.sx · DE', url: 'https://v/2' },
        { name: 'X', title: 'voe.sx · Japanisch, dt. UT', url: 'https://v/3' },
        { name: 'X', title: 'voe.sx · Englisch', url: 'https://v/4' },
        { name: 'X', title: 'voe.sx · Deutsch', url: 'https://v/5' },
    ]).getStreams('1', 'tv', 1, 1);
    assert.deepStrictEqual(named.map(s => s.name), ['X · Deutsch · voe.sx', 'X · Deutsch · voe.sx', 'X · Original, dt. UT · voe.sx',
        'X · Japanisch, dt. UT · voe.sx', 'X · Englisch · voe.sx']);
    assert.deepStrictEqual(named.map(s => s.url.slice(-1)), ['2', '5', '1', '3', '4']);

    // huhu.to files "…GerSub.720p…" under plain German: the file name wins over the title, and gives the quality
    api.fileNames['https://v/1'] = 'KonoSuba E01 GerSub AC3 720p BluRay x264-Fuuko';
    const sub = await provider(async () => [{ name: 'X', title: 'voe.sx · Deutsch', url: 'https://v/1' }]).getStreams('1', 'tv', 1, 1);
    assert.strictEqual(sub[0].name, 'X · Original, dt. UT · voe.sx');
    assert.strictEqual(sub[0].title, 'voe.sx · Original, dt. UT');
    assert.strictEqual(sub[0].quality, '720p');

    // Dood only ever answers with a Cloudflare challenge, so it must not cost a request
    let asked = 0;
    globalThis.fetch = async () => { asked++; return { ok: false, status: 403 }; };
    assert.deepStrictEqual(await resolveEmbed('https://dood.to/e/abc', 'https://x.example/'), []);
    assert.deepStrictEqual(await resolveEmbed('//playmogo.com/e/abc', 'https://x.example/'), []);
    assert.strictEqual(asked, 0);

    // --- Columbo: s.to keeps the two pilot films as episodes 1-2, so the site's "Death Lends a Hand" is episode 4
    // while it is TMDB season 1 episode 2. No title matches, only the offset does.
    globalThis.fetch = async url => {
        const u = String(url);
        if (u.includes('api.themoviedb.org/3/tv/99/season/1')) return json(tmdbSeason(7));
        if (u.endsWith('/staffel-1')) return html(rows('/serie/x', 1, [
            [1, 'Mord nach Rezept', ''], [2, 'Lösegeld für einen Toten', ''], [3, 'Die Hand des Todes', ''],
            [4, 'Tödliche Feder', ''], [5, 'Tote Last', ''], [6, 'Ein teuflischer Plan', ''], [7, 'Der Schlafwandler', ''],
            [8, 'Ein Spurenleser', ''], [9, 'Alte Liebe rostet nicht', ''],
        ]));
        return missing();
    };
    const columbo = { tmdbId: '99', type: 'tv', title: 'Columbo', year: 1971, titles: ['Columbo'], episodeTitles: ['Death Lends a Hand'] };
    const columboCandidates = await findEpisodeCandidates('https://s.example', '/serie/x', 1, 2, columbo);
    assert.strictEqual(columboCandidates[0].href, '/serie/x/staffel-1/episode-4', JSON.stringify(columboCandidates));
    assert.strictEqual(columboCandidates[0].why, 'offset');

    // --- Black Clover: TMDB season 2 episode 1 lives in the site's season 5 (both split the show differently)
    globalThis.fetch = async url => {
        const u = String(url);
        if (u.includes('api.themoviedb.org/3/tv/55/season/2')) return json(tmdbSeason(51));
        if (u.endsWith('/staffel-2')) return html(rows('/anime/stream/x', 2, Array.from({ length: 51 }, (_, i) => [i + 1, `Andere Folge ${i + 1}`, ''])));
        if (u.endsWith('/staffel-5')) return html(rows('/anime/stream/x', 5, [[1, 'Kriegsbeginn', 'The Battle Begins']]));
        return html('');
    };
    const blackClover = { tmdbId: '55', type: 'tv', title: 'Black Clover', year: 2017, titles: ['Black Clover'], episodeTitles: ['Kriegsbeginn', 'The Battle Begins'] };
    const bcCandidates = await findEpisodeCandidates('https://a.example', '/anime/stream/x', 2, 1, blackClover);
    assert.strictEqual(bcCandidates[0].href, '/anime/stream/x/staffel-5/episode-1', JSON.stringify(bcCandidates));
    assert.strictEqual(bcCandidates[0].why, 'title-season-5');

    // --- absolute numbering: TMDB one season with 85 episodes, the site four seasons of 25/25/16/19
    globalThis.fetch = async url => {
        const m = String(url).match(/staffel-(\d+)$/);
        if (!m) return missing();
        const count = [25, 25, 16, 19][Number(m[1]) - 1] || 0;
        return html(rows('/anime/stream/x', m[1], Array.from({ length: count }, (_, i) => [i + 1, `T${i + 1}`, ''])));
    };
    assert.strictEqual(await splitSeasonPath('https://b.example', '/anime/stream/x', 1, 78), '/anime/stream/x/staffel-4/episode-12');
    assert.strictEqual(await splitSeasonPath('https://b.example', '/anime/stream/x', 2, 26), '/anime/stream/x/staffel-3/episode-1');
    assert.strictEqual(await splitSeasonPath('https://b.example', '/anime/stream/x', 1, 5), null);
    assert.strictEqual(await splitSeasonPath('https://b.example', '/anime/stream/x', 1, 999), null);

    // --- the title/year Nuvio asked for is shown, wrong productions are dropped, best resolution first
    globalThis.fetch = async url => {
        const u = String(url);
        if (u.includes('api.themoviedb.org/3/tv/500')) return json({
            name: 'Kingdom', original_name: '킹덤', first_air_date: '2019-01-25', external_ids: { imdb_id: 'tt8010022' },
            translations: { translations: [{ iso_639_1: 'en', iso_3166_1: 'US', data: { name: 'Kingdom' } }] },
        });
        return missing();
    };
    const labelled = await provider(async (tmdbId, mediaType) => {
        const meta = await getMeta(tmdbId, mediaType);
        api.fileNames['https://cdn.example/e.mp4'] = 'Kingdom S01E01 1080p AAC';
        api.fileNames['https://cdn.example/f.mp4'] = 'Kingdom S01E01 1080p AC3';
        return [
            { name: 'Serienstream', title: 'voe.sx · Deutsch', url: 'https://cdn.example/a.m3u8', quality: 'auto', mediaTitle: meta.title, year: 2019 },
            { name: 'Serienstream', title: 'voe.sx · Deutsch', url: 'https://cdn.example/b.mp4', quality: '1080p', mediaTitle: meta.title, year: 2019 },
            { name: 'Serienstream', title: 'voe.sx · Deutsch', url: 'https://cdn.example/c.mp4', quality: '720p', mediaTitle: 'Kingdom', year: 2014 },
            { name: 'Serienstream', title: 'voe.sx · Englisch', url: 'https://cdn.example/d.mp4', quality: '720p', mediaTitle: meta.title, year: 2019, headers: { 'X-Ok': '1', 'Bad\nKey': 'x' } },
            { name: 'Serienstream', title: 'voe.sx · Deutsch', url: 'javascript:alert(1)', mediaTitle: meta.title, year: 2019 },
            { name: 'Serienstream', title: 'voe.sx · Deutsch', url: 'https://cdn.example/e.mp4', quality: 'auto', mediaTitle: meta.title, year: 2019 },
            { name: 'Serienstream', title: 'voe.sx · Deutsch', url: 'https://cdn.example/f.mp4', quality: 'auto', mediaTitle: meta.title, year: 2019 },
        ];
    }).getStreams('500', 'tv', 1, 1);
    // best resolution first, then the better audio (the hoster file name says 1080p AC3, the URL only "auto")
    assert.deepStrictEqual(labelled.map(s => s.url.split('/').pop()), ['f.mp4', 'e.mp4', 'b.mp4', 'a.m3u8', 'd.mp4']);
    assert.deepStrictEqual(labelled.map(s => s.quality), ['1080p', '1080p', '1080p', 'HLS', '720p']);
    assert.strictEqual(labelled[0].name, 'Serienstream · Kingdom (2019) · Deutsch · voe.sx');
    assert.deepStrictEqual(labelled[4].headers, { 'X-Ok': '1' });

    // --- same title, different production: the IMDb id and the year decide
    const kingdom = { titles: ['Kingdom'], year: 2019, imdbId: 'tt8010022' };
    assert.strictEqual(pickBest([{ title: 'Kingdom', year: 2014, imdb: 'tt3715776' }, { title: 'Kingdom', year: 2019 }], kingdom).year, 2019);
    assert.strictEqual(pickBest([{ title: 'Kingdom', year: 2019 }, { title: 'Kingdom', year: 2014 }], kingdom).year, 2019);

    console.log('check ok');
})().catch(e => {
    process.stderr.write(String((e && e.stack) || e) + '\n');
    process.exitCode = 1;
});
