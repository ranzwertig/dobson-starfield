// Night sky this week: one file per week in content/sky/<friday>.json (the weeks run Friday to Thursday, the file and
// the address are named by the Friday). The file holds what can't be calculated: which events, and the words about
// them in English and German, with times in UTC only. Everything else is calculated here with Astronomy Engine
// (the Moon's phases, the planets) and on the page in the reader's own time zone.
//
//   pages (built by scripts/build.mjs with buildSky):
//     /sky/<friday>/  and  /de/sky/<friday>/    the week, in English and German, linked as language versions
//     /sky/archive/   and  /de/sky/archive/     all weeks
//     /sky/           and  /de/sky/             this week: the Worker (worker/sky.js) serves the week of the day
//                                                from /sky-now/<lang>/<friday>, the copy for that address; the files here
//                                                are the week of the build, for a plain static server
//   Only weeks with "status": "published" are built. Preview builds of other branches (Workers Builds sets
//   WORKERS_CI_BRANCH) and SKY_DRAFTS=1 build drafts too, marked as drafts and noindex.
//
//   node scripts/sky.mjs validate                checks every file (npm run sky:validate)
//   node scripts/sky.mjs candidates 2026-11-06   the calculated events of that week, as a start for its file
//                                                (npm run sky:candidates -- 2026-11-06)
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const A = require('astronomy-engine');
const ZEvents = require('../src/events.js');
const ROOT = new URL('../', import.meta.url);
const DAY = 864e5;
export const LANGS = ['en', 'de'];

// ---------- the week files ----------
const TYPES = ['moon-phase', 'conjunction', 'occultation', 'opposition', 'elongation', 'meteor-shower', 'lunar-eclipse', 'solar-eclipse', 'comet', 'deep-sky', 'iss', 'other'];
const EQUIPMENT = ['naked-eye', 'binoculars', 'telescope'];
const HEMI = ['north', 'south', 'both'];
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?Z$/, DATE = /^\d{4}-\d\d-\d\d$/;
export const weekStart = slug => new Date(slug + 'T00:00:00Z');
// the Friday on or before a day (UTC)
export const fridayOf = d => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 2) % 7)); return x.toISOString().slice(0, 10); };

export function validateWeek(w, file) {
  const err = [], at = p => (file ? file + ': ' : '') + p;
  const text = (v, p, need) => { if (v == null && !need) return; if (!v || typeof v !== 'object') return err.push(at(p + ' must be { en, de }')); for (const l of LANGS) if (typeof v[l] !== 'string' || !v[l].trim()) err.push(at(p + '.' + l + ' is missing')); };
  if (!w || typeof w !== 'object') return [at('not an object')];
  if (!DATE.test(w.week || '') || weekStart(w.week).getUTCDay() !== 5) err.push(at('week must be the Friday the week starts, YYYY-MM-DD'));
  if (file && w.week && !file.endsWith(w.week + '.json')) err.push(at('the file name must be the week, ' + w.week + '.json'));
  if (!['draft', 'published'].includes(w.status)) err.push(at('status must be "draft" or "published"'));
  if (!ISO.test(w.generatedAt || '')) err.push(at('generatedAt must be a UTC time (…Z)'));
  text(w.intro, 'intro', true);
  if (!Array.isArray(w.events) || !w.events.length) err.push(at('events must be a list with at least one event'));
  if (w.sources != null && (!Array.isArray(w.sources) || w.sources.some(s => !/^https:\/\//.test(s)))) err.push(at('sources must be https addresses'));
  const s = DATE.test(w.week || '') ? weekStart(w.week).getTime() : 0, e = s + 7 * DAY, ids = new Set();
  (Array.isArray(w.events) ? w.events : []).forEach((v, i) => {
    const p = 'events[' + i + ']' + (v && v.id ? ' (' + v.id + ')' : '');
    if (!v || typeof v !== 'object') return err.push(at(p + ' is not an object'));
    if (!/^[a-z0-9-]+$/.test(v.id || '')) err.push(at(p + ': id must be lowercase letters, digits and -'));
    else if (ids.has(v.id)) err.push(at(p + ': id used twice')); else ids.add(v.id);
    if (!TYPES.includes(v.type)) err.push(at(p + ': type must be one of ' + TYPES.join(', ')));
    if (!ISO.test(v.peak || '')) err.push(at(p + ': peak must be a UTC time (…Z)'));
    if (v.window != null && (!DATE.test(v.window.from || '') || !DATE.test(v.window.to || '') || v.window.from > v.window.to)) err.push(at(p + ': window must be { from, to } dates'));
    if (s && ISO.test(v.peak || '')) {
      const pk = Date.parse(v.peak), wf = v.window ? Date.parse(v.window.from) : pk, wt = v.window ? Date.parse(v.window.to) + DAY : pk;
      if (!((pk >= s && pk < e) || (wf < e && wt > s))) err.push(at(p + ': neither the peak nor the window falls in the week'));
    }
    if (v.target != null) {
      const t = v.target;
      if (!t || typeof t !== 'object' || !(typeof t.id === 'string' && t.id || (typeof t.ra === 'number' && t.ra >= 0 && t.ra < 24 && typeof t.dec === 'number' && Math.abs(t.dec) <= 90)))
        err.push(at(p + ': target must be { id } (an object of the app: Saturn, M31, NGC 891) or { ra (hours), dec (degrees) }'));
    }
    if (v.bodies != null && (!Array.isArray(v.bodies) || v.bodies.some(b => typeof b !== 'string'))) err.push(at(p + ': bodies must be a list of names'));
    if (v.magnitude != null && typeof v.magnitude !== 'number') err.push(at(p + ': magnitude must be a number'));
    if (!EQUIPMENT.includes(v.equipment)) err.push(at(p + ': equipment must be one of ' + EQUIPMENT.join(', ')));
    if (!HEMI.includes(v.hemisphere)) err.push(at(p + ': hemisphere must be one of ' + HEMI.join(', ')));
    if (v.highlight != null && typeof v.highlight !== 'boolean') err.push(at(p + ': highlight must be true or false'));
    if (v.eventPage != null && !/^[a-z0-9-]+$/.test(v.eventPage)) err.push(at(p + ': eventPage must be a slug'));
    text(v.title, p + '.title', true); text(v.text, p + '.text', true); text(v.tip, p + '.tip', false);
  });
  return err;
}

export function loadWeeks(dir = new URL('content/sky/', ROOT)) {
  if (!existsSync(dir)) return { weeks: [], errors: [] };
  const weeks = [], errors = [];
  for (const f of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
    let w; try { w = JSON.parse(readFileSync(new URL(f, dir), 'utf8')); } catch (e) { errors.push(f + ': ' + e.message); continue; }
    const er = validateWeek(w, f); if (er.length) errors.push(...er); else weeks.push(w);
  }
  return { weeks, errors };
}

// ---------- calculated parts ----------
const T = d => A.MakeTime(d);
const PLANETS = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'];
// The Moon in the evening (20 h UTC) of each day of the week, its phases, and the planets in the middle of the week
export function weekSky(slug) {
  const s = weekStart(slug), e = new Date(s.getTime() + 7 * DAY);
  const days = [...Array(7)].map((_, i) => { const d = new Date(s.getTime() + i * DAY + 20 * 3600e3); return { d, phase: A.MoonPhase(T(d)), k: A.Illumination(A.Body.Moon, T(d)).phase_fraction }; });
  const phases = ZEvents.search(A, { from: s, to: e, skip: ['lunar-eclipse', 'solar-eclipse', 'moon-planet', 'planet-planet', 'opposition', 'elongation', 'meteor-shower'] });
  const mid = new Date(s.getTime() + 3.5 * DAY), geo = new A.Observer(0, 0, 0);
  const planets = PLANETS.map(b => {
    const el = A.Elongation(A.Body[b], T(mid)), eq = A.Equator(A.Body[b], T(mid), geo, true, true);
    return { b, elong: el.elongation, vis: el.visibility, mag: A.Illumination(A.Body[b], T(mid)).mag, con: A.Constellation(eq.ra, eq.dec).name };
  });
  return { days, phases, planets };
}

// ---------- words ----------
const MONTH = { en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  de: ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'] };
const CON_DE = { Aries: 'Widder', Taurus: 'Stier', Gemini: 'Zwillinge', Cancer: 'Krebs', Leo: 'Löwe', Virgo: 'Jungfrau', Libra: 'Waage', Scorpius: 'Skorpion', Ophiuchus: 'Schlangenträger',
  Sagittarius: 'Schütze', Capricornus: 'Steinbock', Aquarius: 'Wassermann', Pisces: 'Fische', Cetus: 'Walfisch', Orion: 'Orion', Sextans: 'Sextant', Crater: 'Becher', Hydra: 'Wasserschlange',
  Pegasus: 'Pegasus', Auriga: 'Fuhrmann', Corvus: 'Rabe', 'Serpens Cauda': 'Schlange', Scutum: 'Schild' };
const PL_DE = { Mercury: 'Merkur', Venus: 'Venus', Mars: 'Mars', Jupiter: 'Jupiter', Saturn: 'Saturn', Uranus: 'Uranus', Neptune: 'Neptun', Moon: 'Mond' };
export const L = {
  en: {
    sky: 'Night sky', title: r => `Night sky this week: ${r}`, short: r => `Night sky ${r}`, thisWeek: 'This week', events: 'Events', moon: 'The Moon', planets: 'Planets',
    open: 'Open in Zenigo', highlight: 'Highlight', tip: 'Tip', archive: 'All weeks', prev: 'Previous week', next: 'Next week', other: 'Deutsch', draft: 'Draft: not published yet',
    utc: 'Times in UTC.', local: z => `Times in your time zone (${z}).`, until: 'to',
    peak: { conjunction: 'closest', occultation: 'closest', 'meteor-shower': 'peak', opposition: 'opposition', elongation: 'greatest elongation', 'lunar-eclipse': 'peak', 'solar-eclipse': 'peak', comet: 'brightest' },
    eq: { 'naked-eye': 'Naked eye', binoculars: 'Binoculars', telescope: 'Telescope' }, hemi: { north: 'Northern hemisphere', south: 'Southern hemisphere', both: '' },
    q: ['New Moon', 'First quarter', 'Full Moon', 'Last quarter'], lit: '% lit', moonNote: 'The Moon each evening (20:00 UTC). Without its light the sky is darkest: best for galaxies and nebulae.',
    pl: b => b, con: c => c, planetNote: 'In the middle of the week. Times of night depend on where you are; Zenigo shows them for your place.',
    vis: (p) => p.elong < 15 ? 'too close to the Sun' : p.b === 'Mercury' || p.b === 'Venus' ? (p.vis === 'morning' ? 'in the morning sky' : 'in the evening sky')
      : p.elong >= 150 ? 'all night' : p.vis === 'evening' ? (p.elong >= 90 ? 'evening and first half of the night' : 'in the evening') : (p.elong >= 90 ? 'second half of the night' : 'in the morning'),
    inCon: c => 'in ' + c, mag: 'mag', archiveTitle: 'Night sky: all weeks', archiveIntro: 'Every week the events worth seeing in the night sky, from Friday to Thursday.',
    desc: (r, ev) => `What to see in the night sky ${r}: ${ev}. With times for your place and a link to find each one with your telescope.`,
    calc: 'Times and positions calculated with Astronomy Engine.', appLine: 'Find them with your telescope: Zenigo shows where to push it.',
  },
  de: {
    sky: 'Sternenhimmel', title: r => `Sternenhimmel diese Woche: ${r}`, short: r => `Sternenhimmel ${r}`, thisWeek: 'Diese Woche', events: 'Ereignisse', moon: 'Der Mond', planets: 'Planeten',
    open: 'In Zenigo öffnen', highlight: 'Höhepunkt', tip: 'Tipp', archive: 'Alle Wochen', prev: 'Vorige Woche', next: 'Nächste Woche', other: 'English', draft: 'Entwurf: noch nicht veröffentlicht',
    utc: 'Zeiten in UTC.', local: z => `Zeiten in deiner Zeitzone (${z}).`, until: 'bis',
    peak: { conjunction: 'am engsten', occultation: 'am engsten', 'meteor-shower': 'Maximum', opposition: 'Opposition', elongation: 'größte Elongation', 'lunar-eclipse': 'Maximum', 'solar-eclipse': 'Maximum', comet: 'am hellsten' },
    eq: { 'naked-eye': 'Bloßes Auge', binoculars: 'Fernglas', telescope: 'Teleskop' }, hemi: { north: 'Nordhalbkugel', south: 'Südhalbkugel', both: '' },
    q: ['Neumond', 'Erstes Viertel', 'Vollmond', 'Letztes Viertel'], lit: ' % beleuchtet', moonNote: 'Der Mond an jedem Abend (20:00 UTC). Ohne sein Licht ist der Himmel am dunkelsten: am besten für Galaxien und Nebel.',
    pl: b => PL_DE[b] || b, con: c => CON_DE[c] || c, planetNote: 'In der Mitte der Woche. Die Uhrzeiten hängen von deinem Ort ab; Zenigo zeigt sie für deinen Standort.',
    vis: (p) => p.elong < 15 ? 'zu nah an der Sonne' : p.b === 'Mercury' || p.b === 'Venus' ? (p.vis === 'morning' ? 'am Morgenhimmel' : 'am Abendhimmel')
      : p.elong >= 150 ? 'die ganze Nacht' : p.vis === 'evening' ? (p.elong >= 90 ? 'abends und in der ersten Nachthälfte' : 'am Abend') : (p.elong >= 90 ? 'in der zweiten Nachthälfte' : 'am Morgen'),
    inCon: c => 'im Sternbild ' + c, mag: 'mag', archiveTitle: 'Sternenhimmel: alle Wochen', archiveIntro: 'Jede Woche die sehenswerten Ereignisse am Nachthimmel, von Freitag bis Donnerstag.',
    desc: (r, ev) => `Was am Sternenhimmel ${r} zu sehen ist: ${ev}. Mit Zeiten für deinen Ort und einem Link, um alles mit dem Teleskop zu finden.`,
    calc: 'Zeiten und Positionen berechnet mit Astronomy Engine.', appLine: 'Mit dem Teleskop finden: Zenigo zeigt, wohin du es schieben musst.',
  },
};
export function rangeText(slug, lang) {
  const s = weekStart(slug), e = new Date(s.getTime() + 6 * DAY), M = MONTH[lang];
  const [d1, m1, y1, d2, m2, y2] = [s.getUTCDate(), s.getUTCMonth(), s.getUTCFullYear(), e.getUTCDate(), e.getUTCMonth(), e.getUTCFullYear()];
  if (lang === 'de') return m1 === m2 ? `${d1}.–${d2}. ${M[m2]} ${y2}` : y1 === y2 ? `${d1}. ${M[m1]} – ${d2}. ${M[m2]} ${y2}` : `${d1}. ${M[m1]} ${y1} – ${d2}. ${M[m2]} ${y2}`;
  return m1 === m2 ? `${d1}–${d2} ${M[m2]} ${y2}` : y1 === y2 ? `${d1} ${M[m1]} – ${d2} ${M[m2]} ${y2}` : `${d1} ${M[m1]} ${y1} – ${d2} ${M[m2]} ${y2}`;
}
const fmtUtc = (d, lang, time) => new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', ...(time ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(d) + (time ? ' UTC' : '');

// ---------- pages ----------
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const weekPath = (lang, slug) => (lang === 'en' ? '' : '/' + lang) + '/sky/' + (slug ? slug + '/' : '');
export const archivePath = lang => weekPath(lang) + 'archive/';
// the app opens an object from #go=<id> (src/app.html)
export const goLink = (t, src) => t && t.id ? '/app/#go=' + encodeURIComponent(t.id) + '&src=' + src : null;

function moonSvg(phase, cls) {
  const r = 20, p = phase * Math.PI / 180, rx = Math.abs(Math.cos(p)) * r, wax = phase < 180, cres = Math.cos(p) > 0;
  const limb = wax ? `M0 ${-r}A${r} ${r} 0 0 1 0 ${r}` : `M0 ${-r}A${r} ${r} 0 0 0 0 ${r}`;
  const term = `A${rx.toFixed(2)} ${r} 0 0 ${wax ? (cres ? 0 : 1) : (cres ? 1 : 0)} 0 ${-r}Z`;
  return `<svg class="${cls}" viewBox="-22 -22 44 44" aria-hidden="true"><circle r="${r}" fill="#1a2140"/><path d="${limb}${term}" fill="#e9e4cc"/></svg>`;
}

function weekBody(w, lang, nav, draft) {
  const t = L[lang], sky = weekSky(w.week), range = rangeText(w.week, lang);
  // highlights first, then by the first day (the window's or the peak's)
  const start = v => v.window ? Date.parse(v.window.from) : Date.parse(v.peak);
  const evs = [...w.events].sort((a, b) => (b.highlight ? 1 : 0) - (a.highlight ? 1 : 0) || start(a) - start(b) || Date.parse(a.peak) - Date.parse(b.peak));
  const when = v => {
    // a peak at 00:00 UTC is a day (a meteor shower's morning after the peak night): shown as that day, not a time
    const pk = new Date(v.peak), tm = /T00:00(:00)?Z$/.test(v.peak) ? `<time datetime="${v.peak.slice(0, 10)}">${esc(fmtUtc(pk, lang))}</time>`
      : `<time datetime="${v.peak}" data-t="dt">${esc(fmtUtc(pk, lang, true))}</time>`;
    if (!v.window) return tm;
    // a window: the days, and the peak where the kind has one (closest, maximum, opposition), even after the week
    const days = `<time datetime="${v.window.from}">${esc(fmtUtc(new Date(v.window.from + 'T12:00:00Z'), lang))}</time> ${t.until} <time datetime="${v.window.to}">${esc(fmtUtc(new Date(v.window.to + 'T12:00:00Z'), lang))}</time>`;
    return t.peak[v.type] ? `${days} · ${esc(t.peak[v.type])} ${tm}` : days;
  };
  const ev = v => {
    const go = goLink(v.target, 'week'), meta = [when(v), esc(t.eq[v.equipment]), esc(t.hemi[v.hemisphere])].filter(Boolean).join(' · ');
    return `      <article class="wk-ev${v.highlight ? ' hl' : ''}" id="${esc(v.id)}">
        ${v.highlight ? `<span class="wk-tag">${esc(t.highlight)}</span>` : ''}<h3>${esc(v.title[lang])}</h3>
        <p class="wk-when">${meta}</p>
        <p>${esc(v.text[lang])}</p>${v.tip ? `\n        <p class="tip"><b>${esc(t.tip)}:</b> ${esc(v.tip[lang])}</p>` : ''}${go ? `\n        <p><a class="open ghost" rel="nofollow" href="${esc(go)}">${esc(t.open)}</a></p>` : ''}
      </article>`;
  };
  const moonDays = sky.days.map(x => `<li>${moonSvg(x.phase, 'wk-moon')}<b>${esc(new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric' }).format(x.d))}</b><small>${Math.round(x.k * 100)}${esc(t.lit)}</small></li>`).join('');
  const phases = sky.phases.map(q => `<li><b>${esc(t.q[q.quarter])}</b> <time datetime="${q.peak.toISOString()}" data-t="dt">${esc(fmtUtc(q.peak, lang, true))}</time></li>`).join('');
  const planets = sky.planets.map(p => `<tr${p.elong < 15 ? ' class="wk-off"' : ''}><th scope="row">${esc(t.pl(p.b))}</th><td>${esc(t.vis(p))}</td><td>${esc(t.inCon(t.con(p.con)))}</td><td class="num">${p.mag.toFixed(1)} ${t.mag}</td></tr>`).join('\n          ');
  return `<main class="wrap">
  <article class="doc full wk">
    ${draft ? `<p class="wk-draft">${esc(t.draft)}</p>\n    ` : ''}<nav class="wk-crumbs" aria-label="Breadcrumb"><a href="${archivePath(lang)}">${esc(t.sky)}</a> › <span>${esc(range)}</span><a class="wk-lang" href="${weekPath(lang === 'en' ? 'de' : 'en', w.week)}" hreflang="${lang === 'en' ? 'de' : 'en'}" lang="${lang === 'en' ? 'de' : 'en'}">${esc(t.other)}</a></nav>
    <h1>${esc(t.title(range))}</h1>
    <p class="intro">${esc(w.intro[lang])}</p>
    <p class="wk-tz muted" data-utc="${esc(t.utc)}" data-local="${esc(t.local('{z}'))}">${esc(t.utc)}</p>
    <h2>${esc(t.events)}</h2>
    <div class="wk-list">
${evs.map(ev).join('\n')}
    </div>
    <h2>${esc(t.moon)}</h2>
    <ul class="wk-moons">${moonDays}</ul>
    ${phases ? `<ul class="wk-phases">${phases}</ul>` : ''}
    <p class="muted">${esc(t.moonNote)}</p>
    <h2>${esc(t.planets)}</h2>
    <div class="wk-tablewrap"><table class="wk-planets">
      <tbody>
          ${planets}
      </tbody>
    </table></div>
    <p class="muted">${esc(t.planetNote)}</p>
    <p class="wk-app">${esc(t.appLine)} <a class="open" href="/app/">${lang === 'de' ? 'Zenigo öffnen' : 'Open Zenigo'}</a></p>
    <nav class="wk-nav" aria-label="${esc(t.sky)}">${nav.prev ? `<a href="${weekPath(lang, nav.prev)}">← ${esc(t.prev)}</a>` : '<span></span>'}<a href="${archivePath(lang)}">${esc(t.archive)}</a>${nav.next ? `<a href="${weekPath(lang, nav.next)}">${esc(t.next)} →</a>` : '<span></span>'}</nav>
    <p class="muted wk-small">${esc(t.calc)}</p>
  </article>
</main>
<script>
// times in the reader's own time zone (the page has them in UTC)
(() => {
  const l = document.documentElement.lang === "de" ? "de-DE" : "en-GB", tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!tz || tz === "UTC" || tz === "Etc/UTC") return;
  const f = new Intl.DateTimeFormat(l, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  document.querySelectorAll("time[data-t]").forEach(t => { t.title = t.textContent; t.textContent = f.format(new Date(t.dateTime)); });
  const n = document.querySelector(".wk-tz"); if (n) n.textContent = n.dataset.local.replace("{z}", tz.replace(/_/g, " "));
})();
</script>`;
}

function archiveBody(weeks, lang) {
  const t = L[lang];
  const rows = [...weeks].reverse().map(w => {
    const hl = w.events.filter(v => v.highlight).concat(w.events.filter(v => !v.highlight)).slice(0, 3).map(v => esc(v.title[lang])).join(' · ');
    return `      <li><a href="${weekPath(lang, w.week)}">${esc(rangeText(w.week, lang))}</a><small>${hl}</small></li>`;
  }).join('\n');
  return `<main class="wrap">
  <article class="doc full wk">
    <nav class="wk-crumbs" aria-label="Breadcrumb"><span>${esc(t.sky)}</span><a class="wk-lang" href="${archivePath(lang === 'en' ? 'de' : 'en')}" hreflang="${lang === 'en' ? 'de' : 'en'}" lang="${lang === 'en' ? 'de' : 'en'}">${esc(t.other)}</a></nav>
    <h1>${esc(t.archiveTitle)}</h1>
    <p class="intro">${esc(t.archiveIntro)}</p>
    <ul class="wk-archive">
${rows}
    </ul>
  </article>
</main>`;
}

// One page: the head with title, description, canonical address, language versions and structured data, then the
// site's header and footer around the body
function pageHtml({ lang, title, desc, url, alt, body, ld, noindex, header, footer, fontCss, SITE }) {
  const links = alt ? Object.entries(alt).map(([l, p]) => `<link rel="alternate" hreflang="${l}" href="${SITE + p}">`).join('') + `<link rel="alternate" hreflang="x-default" href="${SITE + alt.en}">` : '';
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Zenigo</title>
<meta name="description" content="${esc(desc)}">
${noindex ? '<meta name="robots" content="noindex">\n' : ''}<meta name="theme-color" content="#0c1124">
<link rel="icon" href="/app/logo.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/app/icons/apple-touch-icon.png">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="https://zenigo.app/img/screens/locate-780.webp">
<meta property="og:type" content="article">
<meta property="og:locale" content="${lang === 'de' ? 'de_DE' : 'en_GB'}">
<meta name="twitter:card" content="summary_large_image">
${url && !noindex ? `<link rel="canonical" href="${url}"><meta property="og:url" content="${url}">` : ''}${links}
${ld ? `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>\n` : ''}<style>${fontCss}</style>
<link rel="stylesheet" href="/site.css">
</head>
<body>
${header}
${body}
${footer}
</body>
</html>
`;
}

// Builds every page; returns the sitemap entries ({ loc, alt }) and the files written
export function buildSky({ write, header, footer, fontCss, SITE, year, drafts = false, now = new Date(), dir }) {
  const { weeks: all, errors } = loadWeeks(dir);
  if (errors.length) throw new Error('content/sky:\n  ' + errors.join('\n  '));
  const weeks = all.filter(w => w.status === 'published' || drafts);
  const urls = [], files = [];
  // the site's header and footer are in English; on German pages they say so
  const hdr = (lang, path) => { const h = header.replaceAll(`href="${path}">`, `href="${path}" aria-current="page">`); return lang === 'en' ? h : h.replace('<header class="sitehead"', '<header class="sitehead" lang="en"'); };
  const ftr = lang => lang === 'en' ? footer : footer.replace('<footer>', '<footer lang="en">');
  const put = (file, html) => { write(file, html.replaceAll('<!--YEAR-->', String(year))); files.push(file); };
  const thisWeek = fridayOf(now), current = [...weeks].reverse().find(w => w.week <= thisWeek) || weeks[0];
  weeks.forEach((w, i) => {
    const nav = { prev: weeks[i - 1] && weeks[i - 1].week, next: weeks[i + 1] && weeks[i + 1].week }, draft = w.status !== 'published';
    const alt = Object.fromEntries(LANGS.map(l => [l, weekPath(l, w.week)]));
    for (const lang of LANGS) {
      const t = L[lang], range = rangeText(w.week, lang), path = weekPath(lang, w.week), url = SITE + path;
      const top = [...w.events.filter(v => v.highlight), ...w.events.filter(v => !v.highlight)].slice(0, 2).map(v => v.title[lang]).join(', ');
      const ld = [{ '@context': 'https://schema.org', '@type': 'Article', headline: t.title(range), inLanguage: lang, datePublished: w.generatedAt, dateModified: w.generatedAt,
        author: { '@type': 'Organization', name: 'Zenigo', url: SITE + '/' }, publisher: { '@type': 'Organization', name: 'Zenigo', url: SITE + '/' }, mainEntityOfPage: url, description: w.intro[lang] },
        { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: t.sky, item: SITE + archivePath(lang) }, { '@type': 'ListItem', position: 2, name: range, item: url }] }];
      const page = (canon, p) => pageHtml({ lang, title: t.title(range), desc: t.desc(range, top), url: canon, alt, body: weekBody(w, lang, nav, draft), ld, noindex: draft, header: hdr(lang, p), footer: ftr(lang), fontCss, SITE });
      put('dist' + path + 'index.html', page(url, path));
      // the copy for /sky/ (this week, served by the Worker): canonical /sky/, the language versions of /sky/
      put(`dist/sky-now/${lang}/${w.week}.html`, pageHtml({ lang, title: t.title(range), desc: t.desc(range, top), url: SITE + weekPath(lang), alt: Object.fromEntries(LANGS.map(l => [l, weekPath(l)])), body: weekBody(w, lang, nav, draft), ld, noindex: draft, header: hdr(lang, weekPath(lang)), footer: ftr(lang), fontCss, SITE }));
      if (w === current) put('dist' + weekPath(lang) + 'index.html', pageHtml({ lang, title: t.title(range), desc: t.desc(range, top), url: SITE + weekPath(lang), alt: Object.fromEntries(LANGS.map(l => [l, weekPath(l)])), body: weekBody(w, lang, nav, draft), ld, noindex: draft, header: hdr(lang, weekPath(lang)), footer: ftr(lang), fontCss, SITE }));
    }
    if (!draft) urls.push({ loc: SITE + alt.en, alt, lastmod: w.generatedAt.slice(0, 10) });
  });
  if (weeks.length) {
    const alt = Object.fromEntries(LANGS.map(l => [l, archivePath(l)]));
    for (const lang of LANGS) put('dist' + archivePath(lang) + 'index.html', pageHtml({ lang, title: L[lang].archiveTitle, desc: L[lang].archiveIntro, url: SITE + archivePath(lang), alt, body: archiveBody(weeks, lang), noindex: !weeks.some(w => w.status === 'published'), header: hdr(lang, archivePath(lang)), footer: ftr(lang), fontCss, SITE }));
    const pub = weeks.filter(w => w.status === 'published');
    if (pub.length) {
      const last = pub.at(-1).generatedAt.slice(0, 10);
      urls.push({ loc: SITE + weekPath('en'), alt: Object.fromEntries(LANGS.map(l => [l, weekPath(l)])), lastmod: last });
      urls.push({ loc: SITE + archivePath('en'), alt, lastmod: last });
    }
  }
  return { urls, files, weeks: weeks.map(w => w.week) };
}

// ---------- command line ----------
function candidates(slug) {
  if (!DATE.test(slug || '') || weekStart(slug).getUTCDay() !== 5) { console.error('usage: node scripts/sky.mjs candidates <Friday, YYYY-MM-DD>'); process.exit(1); }
  const s = weekStart(slug), e = new Date(s.getTime() + 7 * DAY);
  const ev = ZEvents.search(A, { from: s, to: e, skip: ['moon-phase'] });
  const PLACES = [['Berlin', 52.5, 13.4], ['New York', 40.7, -74], ['Sydney', -33.9, 151.2]];
  const seen = (v, [, la, lo]) => {
    const obs = new A.Observer(la, lo, 0), body = v.bodies ? v.bodies[0] : null; if (!body) return '';
    const q = A.Equator(A.Body[body], T(v.peak), obs, true, true), h = A.Horizon(T(v.peak), obs, q.ra, q.dec, 'normal').altitude;
    const sq = A.Equator(A.Body.Sun, T(v.peak), obs, true, true), sh = A.Horizon(T(v.peak), obs, sq.ra, sq.dec, 'normal').altitude;
    return `${Math.round(h)}°${sh < -6 ? '' : sh < 0 ? ' twilight' : ' day'}`;
  };
  console.log(`Week ${slug} to ${new Date(e - DAY).toISOString().slice(0, 10)} (Friday to Thursday), calculated for the whole Earth:\n`);
  for (const v of ev) console.log(`${v.peak.toISOString().slice(0, 16)}Z  ${v.type}  ${v.bodies ? v.bodies.join(' + ') : v.name || v.kind}${v.sep != null ? '  ' + v.sep.toFixed(2) + '°' : ''}${v.moon != null ? '  Moon ' + Math.round(v.moon * 100) + ' %' : ''}${v.visibility ? '  ' + v.visibility : ''}`
    + (v.bodies ? '   at that moment: ' + PLACES.map(p => p[0] + ' ' + seen(v, p)).join(', ') : ''));
  const sky = weekSky(slug);
  console.log('\nMoon: ' + sky.phases.map(q => L.en.q[q.quarter] + ' ' + q.peak.toISOString().slice(0, 16) + 'Z').join(', ') + '; evenings ' + sky.days.map(d => Math.round(d.k * 100) + '%').join(' '));
  console.log('Planets (mid-week): ' + sky.planets.map(p => `${p.b} ${L.en.vis(p)}, ${p.con}, ${p.mag.toFixed(1)} mag`).join('; '));
  console.log('\nAlso check (not calculated): comets, novae and supernovae, minor meteor showers (Taurids, Draconids, …), occultations of bright stars, ISS.');
  const skel = { week: slug, status: 'draft', generatedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), intro: { en: '', de: '' },
    events: ev.map(v => ({ id: (v.peak.toISOString().slice(0, 10) + '-' + (v.bodies ? v.bodies.join('-') : v.name || v.type)).toLowerCase().replace(/[^a-z0-9]+/g, '-'), type: v.type, peak: v.peak.toISOString().replace(/\.\d+Z$/, 'Z'),
      ...(v.bodies ? { bodies: v.bodies, target: { id: v.bodies[v.bodies.length - 1] } } : {}), ...(v.ra != null ? { target: { ra: v.ra, dec: v.dec, label: v.name } } : {}),
      equipment: 'naked-eye', hemisphere: 'both', highlight: false, title: { en: '', de: '' }, text: { en: '', de: '' } })), sources: [] };
  console.log('\nStart of the file (content/sky/' + slug + '.json):\n' + JSON.stringify(skel, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'validate') {
    const { weeks, errors } = loadWeeks();
    if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
    console.log(`content/sky: ${weeks.length} week${weeks.length === 1 ? '' : 's'} fine (${weeks.filter(w => w.status === 'published').length} published)`);
  } else if (cmd === 'candidates') candidates(arg);
  else { console.error('usage: node scripts/sky.mjs validate | candidates <Friday>'); process.exit(1); }
}
