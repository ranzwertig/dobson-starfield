// Night sky this week: the week files' check, the calculated parts, the pages and the Worker that serves this week.
//   node test/sky.mjs   (npm run test:sky)
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { validateWeek, loadWeeks, fridayOf, rangeText, weekSky, buildSky, goLink } from '../scripts/sky.mjs';
import { handleSky, isSky } from '../worker/sky.js';

const require = createRequire(import.meta.url);
const A = require('astronomy-engine'), ZEvents = require('../src/events.js');
let n = 0, bad = 0;
const ok = (c, what, info) => { n++; if (!c) { bad++; console.log('  ✗ ' + what + (info !== undefined ? ' — ' + JSON.stringify(info) : '')); } };

// the real files are valid
const { weeks, errors } = loadWeeks();
ok(!errors.length && weeks.length >= 1, 'content/sky: every file passes', errors);

// the check
const week = JSON.parse(readFileSync(new URL('../content/sky/2026-11-06.json', import.meta.url), 'utf8'));
ok(validateWeek(week, '2026-11-06.json').length === 0, 'the first week passes');
const bend = f => { const w = structuredClone(week); f(w); return validateWeek(w, '2026-11-06.json'); };
ok(bend(w => { w.week = '2026-11-07'; }).some(e => /Friday/.test(e)), 'the week has to start on a Friday');
ok(bend(w => { w.events[0].peak = '2026-11-07 10:40'; }).some(e => /UTC/.test(e)), 'times have to be UTC (…Z)');
ok(bend(w => { w.events[0].peak = '2026-11-20T10:00:00Z'; }).some(e => /falls in the week/.test(e)), 'an event outside the week is refused');
ok(bend(w => { w.events[2].peak = '2026-11-20T10:00:00Z'; }).length === 0, 'a peak after the week is fine when the window is in it');
ok(bend(w => { delete w.events[0].title.de; }).some(e => /title\.de/.test(e)), 'German and English are both needed');
ok(bend(w => { w.events[1].id = w.events[0].id; }).some(e => /twice/.test(e)), 'ids are unique');
ok(bend(w => { w.events[0].target = { ra: 25, dec: 0 }; }).some(e => /target/.test(e)), 'a target is an id or a position');
ok(bend(w => { w.status = 'live'; }).some(e => /status/.test(e)), 'status is draft or published');
ok(bend(w => { w.sources = ['http://x']; }).some(e => /https/.test(e)), 'sources are https addresses');

// the week: Friday to Thursday
ok(fridayOf(new Date('2026-11-06T00:00:00Z')) === '2026-11-06' && fridayOf(new Date('2026-11-12T23:59:00Z')) === '2026-11-06' && fridayOf(new Date('2026-11-13T00:01:00Z')) === '2026-11-13', 'the week of a day starts on the Friday before it');
ok(rangeText('2026-11-06', 'en') === '6–12 November 2026' && rangeText('2026-11-06', 'de') === '6.–12. November 2026', 'the week in words');
ok(rangeText('2026-10-30', 'en') === '30 October – 5 November 2026' && rangeText('2026-10-30', 'de') === '30. Oktober – 5. November 2026' && rangeText('2026-12-25', 'de') === '25.–31. Dezember 2026', 'across months', [rangeText('2026-10-30', 'en'), rangeText('2026-10-30', 'de'), rangeText('2026-12-25', 'de')]);
ok(rangeText('2027-12-31', 'en') === '31 December 2027 – 6 January 2028', 'across the new year', rangeText('2027-12-31', 'en'));

// calculated: the new Moon on 9 November, Venus in the morning, Uranus all night
const sky = weekSky('2026-11-06');
ok(sky.phases.length === 1 && sky.phases[0].quarter === 0 && sky.phases[0].peak.toISOString().slice(0, 13) === '2026-11-09T07', 'new Moon on 9 November', sky.phases);
ok(sky.days.length === 7 && sky.days.every(d => d.k < 0.15), 'a dark week: the Moon under 15 % every evening');
const pl = Object.fromEntries(sky.planets.map(p => [p.b, p]));
ok(pl.Venus.vis === 'morning' && pl.Mercury.elong < 15 && pl.Uranus.elong > 150 && pl.Jupiter.con === 'Leo', 'the planets', sky.planets.map(p => p.b + ' ' + p.vis + ' ' + Math.round(p.elong)));

// the event search for the whole Earth finds the week's Moon and Venus; with a place, what the app shows
const g = ZEvents.search(A, { from: new Date('2026-11-06T00:00:00Z'), to: new Date('2026-11-13T00:00:00Z') });
ok(g.some(e => e.type === 'conjunction' && e.bodies.join() === 'Moon,Venus' && e.sep < 1.5) && g.some(e => e.type === 'moon-phase' && e.quarter === 0), 'events of the week, for the whole Earth', g.map(e => e.type));
const here = ZEvents.search(A, { from: new Date('2026-10-27T20:00:00Z'), obs: new A.Observer(48.2, 10.1, 400), skip: ['moon-phase'] });
ok(here.some(e => e.type === 'meteor-shower' && e.name === 'Geminids') && here.some(e => e.type === 'opposition' && e.bodies[0] === 'Uranus') && !here.some(e => e.type === 'moon-phase'), 'events seen from a place (Coming up in the app)');
ok(goLink({ id: 'NGC 891' }, 'week') === '/app/#go=NGC%20891&src=week' && goLink({ ra: 3, dec: 22 }, 'week') === null, 'links into the app');

// pages: published only, unless drafts; a draft is noindex and not in the sitemap
const tmp = mkdtempSync(path.join(tmpdir(), 'sky-')), dir = path.join(tmp, 'content') + '/';
mkdirSync(dir);
const pub = structuredClone(week); pub.status = 'published'; writeFileSync(dir + '2026-11-06.json', JSON.stringify(pub));
const draft = structuredClone(week); draft.week = '2026-11-13'; draft.status = 'draft'; draft.events = draft.events.slice(4, 5); draft.events[0].peak = '2026-11-14T00:00:00Z'; draft.events[0].window = { from: '2026-11-13', to: '2026-11-14' };
writeFileSync(dir + '2026-11-13.json', JSON.stringify(draft));
const out = {};
const write = (f, s) => { out[f] = s; };
const ctx = { write, header: '<header class="sitehead"><a href="/sky/">Night sky this week</a></header>', footer: '<footer>©<!--YEAR--></footer>', fontCss: '', SITE: 'https://zenigo.app', year: 2026, dir: pathToFileURL(dir), now: new Date('2026-11-14T12:00:00Z') };
const r1 = buildSky(ctx);
ok(r1.weeks.join() === '2026-11-06' && !out['dist/sky/2026-11-13/index.html'], 'drafts are not built', r1.weeks);
ok(r1.urls.map(u => u.loc).join() === 'https://zenigo.app/sky/2026-11-06/,https://zenigo.app/sky/,https://zenigo.app/sky/archive/' && r1.urls[0].alt.de === '/de/sky/2026-11-06/', 'sitemap: the week, /sky/ and the archive, with the German versions', r1.urls);
const pg = out['dist/sky/2026-11-06/index.html'], now = out['dist/sky-now/en/2026-11-06.html'];
ok(/<link rel="canonical" href="https:\/\/zenigo.app\/sky\/2026-11-06\/">/.test(pg) && /hreflang="de" href="https:\/\/zenigo.app\/de\/sky\/2026-11-06\/"/.test(pg) && !/noindex/.test(pg) && /©2026/.test(pg), 'a published week: canonical, language versions, indexable');
ok(/<link rel="canonical" href="https:\/\/zenigo.app\/sky\/">/.test(now) && /hreflang="de" href="https:\/\/zenigo.app\/de\/sky\/"/.test(now), 'its copy for /sky/: canonical /sky/');
ok(/aria-current="page"/.test(out['dist/sky/index.html']) && out['dist/sky/index.html'].includes('6–12 November'), '/sky/ of the build: the latest published week up to the day');
ok(!/[0-2]\d:\d\d UTC/.test(pub.events.map(e => e.text.en + e.text.de).join()), 'the texts carry no clock times (the page shows them)');
Object.keys(out).forEach(k => delete out[k]);
const r2 = buildSky({ ...ctx, drafts: true });
ok(r2.weeks.join() === '2026-11-06,2026-11-13' && /noindex/.test(out['dist/sky/2026-11-13/index.html']) && /Draft/.test(out['dist/sky/2026-11-13/index.html']) && r2.urls.length === 3, 'with drafts: built, marked, noindex, not in the sitemap');
ok(out['dist/sky/index.html'].includes('13–19 November') && out['dist/sky/2026-11-06/index.html'].includes('href="/sky/2026-11-13/"'), 'with drafts: /sky/ and the next-week link include them');
rmSync(tmp, { recursive: true, force: true });
let threw = false; try { const t2 = mkdtempSync(path.join(tmpdir(), 'sky-')) + '/'; writeFileSync(t2 + '2026-11-06.json', '{"week":"2026-11-06"}'); buildSky({ ...ctx, dir: pathToFileURL(t2) }); } catch (e) { threw = /content\/sky/.test(e.message); }
ok(threw, 'the build stops on a broken file');

// the Worker: /sky/ serves this week's copy, or the latest week before it; /sky-now/ itself is not public
const files = { '/sky-now/en/2026-11-06': 'week 6', '/sky-now/de/2026-11-06': 'Woche 6', '/sky-now/en/2026-11-13': 'week 13', '/sky/index.html': 'build' };
const env = { ASSETS: { fetch: async req => { const p = new URL(req.url).pathname; const f = files[p] || (p === '/sky/' ? files['/sky/index.html'] : null); return new Response(f || 'nf', { status: f ? 200 : 404 }); } } };
const get = async (p, d) => { const u = new URL('https://zenigo.app' + p); const r = await handleSky(new Request(u), env, u, new Date(d)); return [r.status, r.status === 301 ? r.headers.get('location') : await r.text()]; };
ok((await get('/sky/', '2026-11-08T10:00:00Z')).join() === '200,week 6', '/sky/ on Sunday: that week');
ok((await get('/sky/', '2026-11-13T00:30:00Z')).join() === '200,week 13', '/sky/ from Friday: the new week');
ok((await get('/sky/', '2026-11-21T00:30:00Z')).join() === '200,week 13', 'a week not published: the latest before it');
ok((await get('/de/sky/', '2026-11-14T12:00:00Z')).join() === '200,Woche 6', '/de/sky/: the German copy (its latest week)');
ok((await get('/sky/', '2026-01-01T00:00:00Z')).join() === '200,build', 'nothing in the last weeks: the build’s page');
ok((await get('/sky', '2026-11-08T10:00:00Z')).join() === '301,https://zenigo.app/sky/', '/sky → /sky/');
ok((await get('/sky-now/en/2026-11-06', '2026-11-08T10:00:00Z'))[0] === 404 && isSky('/sky-now/x') && isSky('/de/sky/') && !isSky('/sky/2026-11-06/'), '/sky-now/ is not public; the dated weeks are plain files');
// the Worker's config sends those addresses to it
const wr = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
ok(['"/sky"', '"/sky/"', '"/de/sky"', '"/de/sky/"', '"/sky-now/*"'].every(p => wr.includes(p)), 'wrangler.jsonc: the Worker runs first for them');

console.log(`${n - bad}/${n} night sky checks passed`);
if (bad) process.exit(1);
