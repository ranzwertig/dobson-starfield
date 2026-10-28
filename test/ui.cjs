// UI tests: the built app in a real browser (Playwright, Chromium). Run with `npm run test:ui`.
// They build the site, serve dist/ on a free port and go through the main flows on a phone and a desktop viewport.
// Playwright is not a dependency of the project (the deploy build shouldn't download browsers): install it once with
//   npm i --no-save playwright && npx playwright install chromium
// or point PLAYWRIGHT_PATH at an existing installation.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');

function loadPlaywright() {
  for (const p of [process.env.PLAYWRIGHT_PATH, 'playwright', '/opt/npm-tools/node_modules/playwright'].filter(Boolean)) {
    try { return require(p); } catch (e) {}
  }
  console.error('Playwright not found: npm i --no-save playwright && npx playwright install chromium (or set PLAYWRIGHT_PATH).');
  process.exit(2);
}
const { chromium } = loadPlaywright();

// ---------- the sync API (worker/sync.js) as an in-memory stand-in, same answers ----------
const syncStore = new Map(); let syncOn = true, extOn = false;
function syncApi(req, res, p) {
  const send = (status, data, h = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...h }); res.end(data === undefined ? '' : JSON.stringify(data)); };
  if (!syncOn) return send(503, { error: 'off' });
  const id = p.slice('/api/sync/v1'.length).replace(/^\//, '');
  if (!id) return send(200, { ok: true });
  const tok = (req.headers.authorization || '').replace(/^Bearer /, ''), auth = require('node:crypto').createHash('sha256').update(tok).digest('hex');
  if (!/^[A-Za-z0-9_-]{43}$/.test(tok)) return send(401, { error: 'unauthorized' });
  const row = syncStore.get(id);
  if (req.method === 'GET') {
    if (!row) return send(404, { error: 'not found' });
    if (row.auth !== auth) return send(401, { error: 'unauthorized' });
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'x-sync-version': String(row.version) }); return res.end(row.blob);
  }
  if (req.method === 'DELETE') { if (row && row.auth !== auth) return send(401, {}); syncStore.delete(id); res.writeHead(204); return res.end(); }
  const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
    const blob = Buffer.concat(chunks), base = Number(req.headers['if-match']);
    if (!row) { if (base !== 0) return send(404, {}); syncStore.set(id, { auth, version: 1, blob, updated: Date.now() }); return send(200, { version: 1 }); }
    if (row.auth !== auth) return send(401, {});
    if (row.version !== base) return send(409, { version: row.version });
    row.version++; row.blob = blob; row.updated = Date.now(); send(200, { version: row.version });
  });
}

// ---------- static server for dist/ ----------
const DIST = path.join(__dirname, '..', 'dist');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.bin': 'application/octet-stream', '.txt': 'text/plain' };
function serve() {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.startsWith('/api/sync/v1')) return syncApi(req, res, p);
    if (p.startsWith('/api/')) { res.writeHead(503); return res.end('{}'); }   // no satellites in tests
    if (/\/ext-(dso|stars)\./.test(p) && !extOn) { res.writeHead(404); return res.end(); }   // the extended catalogue only in its own test
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(DIST, path.normalize(p));
    if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => srv.listen(0, () => r(srv)));   // all interfaces: the app registers its service worker only on localhost (or https)
}

// ---------- tiny test runner ----------
const results = []; let current = '';
const ok = (cond, what, info) => { results.push({ test: current, what, pass: !!cond, info }); if (!cond) console.log('    ✗ ' + what + (info !== undefined ? ' — ' + JSON.stringify(info) : '')); };
const NIGHT = new Date('2026-10-20T22:30:00+02:00');   // a fixed night in Germany: M13, M31, M45 up, Jupiter rising later
let browser, base;
// Zenigo Pro: the build for these tests (PRO_TEST_KEY=1) also accepts keys signed with test/fixtures/pro-test-key.json.
// Every page gets a running licence unless { pro: false }; the "pro" test makes its own.
const ZLicence = require('../src/licence.js'), PRO_TEST = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pro-test-key.json'), 'utf8'));
const proKey = (s, e, extra = {}) => ZLicence.sign({ v: 1, id: 'test' + Math.random().toString(36).slice(2, 8), o: 'txn_01test', p: s.slice(0, 10), s, e, ...extra }, PRO_TEST.priv);
let PRO_KEY = null;
async function page({ w = 390, h = 844, mobile = true, time = NIGHT, perms = [], init, pro = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2,
    timezoneId: 'Europe/Berlin', acceptDownloads: true, permissions: perms });
  const p = await ctx.newPage(); p.errors = [];
  p.on('pageerror', e => p.errors.push(String(e)));
  if (time) await p.clock.install({ time });
  if (pro) await p.addInitScript(k => { try { if (!localStorage.getItem('zenigo-pro')) localStorage.setItem('zenigo-pro', JSON.stringify([k])); } catch (e) {} }, PRO_KEY);
  if (init) await p.addInitScript(init);
  await p.goto(base + '/app/'); await p.waitForFunction(() => !document.getElementById('splash') && typeof st !== 'undefined' && !!st.sol, null, { timeout: 15000 });
  await p.evaluate(() => hint(null));
  return p;
}
const ev = (p, fn, arg) => p.evaluate(fn, arg);
const wait = (p, ms = 400) => p.waitForTimeout(ms);
const openSheets = p => ev(p, () => SHEETS.filter(x => !x.hidden && x.classList.contains('open')).map(x => x.id).sort().join('+'));
// screenshots for a look at new screens: SHOTS=<folder> node test/ui.cjs <test>
const shot = (p, name) => process.env.SHOTS ? p.screenshot({ path: path.join(process.env.SHOTS, name + '.png') }).catch(() => {}) : null;
async function done(p) { ok(p.errors.length === 0, 'no page errors', p.errors); await p.context().close(); }

const TESTS = {
  // start screen, worker, search focus
  async startup() {
    const p = await page();
    ok(await ev(p, () => !document.getElementById('splash')), 'start screen removed once the map is drawn');
    await p.waitForFunction(() => !!worker, null, { timeout: 5000 }).catch(() => {});
    ok(await ev(p, () => !!worker), 'solver worker running (core script fetched)');
    ok(await ev(p, () => Solver.cat.n > 4000), 'star catalogue loaded');
    await p.tap('#fabSearch'); await wait(p);
    ok(await ev(p, () => document.activeElement.id) === 'q', 'search field has the focus when Find target opens');
    await p.keyboard.type('m13'); await wait(p, 200);
    ok(await ev(p, () => $('results').querySelector('b')?.textContent) === 'M13', 'typing finds M13');
    await done(p);
  },

  // list → details → back, close, target panel (was back.cjs)
  async navigation() {
    const p = await page();
    await ev(p, () => { obs.starred = ['M1', 'M2', 'M3', 'M5', 'M10', 'M11', 'M12', 'M13', 'M15', 'M27', 'M31', 'M33', 'M57', 'M92'].map(id => ({ id, name: id, added: 0 }));
      obs.log = [{ uid: 'a', obj: 'M45', name: 'M45', t: new Date().toISOString(), result: 'easy' }]; saveObs(); });
    await p.tap('#fabList'); await wait(p); await p.tap('[data-ltab="starred"]'); await wait(p, 300);
    await ev(p, () => { scroller($('listSheet')).scrollTop = 300; }); await wait(p, 100);
    const id = await ev(p, () => [...document.querySelectorAll('#listBody .orow')][6].dataset.id);
    await p.tap(`#listBody .orow[data-id="${id}"] .omain`); await wait(p, 500);
    ok(await ev(p, () => !$('infoBack').hidden), 'details from the list have a back arrow');
    await p.tap('#infoBack'); await wait(p, 600);
    const back = await ev(p, () => [!$('listSheet').hidden, listTab.v, scroller($('listSheet')).scrollTop]);
    ok(back[0] && back[1] === 'starred' && back[2] > 100, 'back returns to the same tab and scroll position', back);
    await p.tap('[data-ltab="seen"]'); await wait(p, 300); await p.tap('#listBody .orow .omain'); await wait(p, 500);
    await p.tap('#infoSheet [data-close]'); await wait(p, 600);
    ok(await ev(p, () => $('listSheet').hidden && $('infoSheet').hidden), '✕ on details opened from the list closes them (back is the arrow)');
    await p.tap('#fabList'); await wait(p, 500);
    await p.tap('[data-ltab="starred"]'); await wait(p, 300); await p.tap('#listBody .orow .omain'); await wait(p, 500);
    const tid = await ev(p, () => st.picked.id); await p.tap('#infoTarget'); await wait(p, 600);
    ok(await ev(p, t => cfg.target === t && $('infoSheet').hidden && $('listSheet').hidden, tid), 'Set as target on a phone closes and shows the map');
    await ev(p, () => showInfo(objById('M42'))); await wait(p);
    ok(await ev(p, () => $('infoBack').hidden), 'details opened from the map have no back arrow');
    await ev(p, () => closeSheet('infoSheet')); await wait(p);
    await p.tap('#fabList'); await wait(p); await p.tap('[data-ltab="todo"]'); await wait(p, 300);
    await p.tap('#listBody .otarget'); await wait(p, 500);
    ok(await ev(p, () => !$('targetSheet').hidden && !$('tgtBack').hidden), 'target card in the list opens the target panel with a back arrow');
    await p.tap('#tgtBack'); await wait(p, 600);
    ok(await ev(p, () => !$('listSheet').hidden), 'back from the target panel returns to the list');
    await ev(p, () => closeSheet('listSheet')); await wait(p); await p.tap('#fabTarget'); await wait(p);
    ok(await ev(p, () => !$('targetSheet').hidden && $('tgtBack').hidden), 'target panel from its button has no back arrow');
    await done(p);
  },

  // plan, Seen, Save next, logbook, delete, backup and CSV (was obs.cjs)
  async logbook() {
    const p = await page();
    await p.tap('#fabList'); await wait(p);
    await p.tap('#listBody .btn.primary'); await wait(p);
    const n = await ev(p, () => obs.list.length);
    ok(n > 3, 'Plan tonight’s best objects fills the plan', n);
    ok(await ev(p, () => $('listBadge').textContent) === String(n), 'list button shows how many are planned');
    await p.tap('#listBody .orow .omain'); await wait(p);
    const first = await ev(p, () => cfg.target);
    ok(!!first && await ev(p, () => !$('hudNext').hidden), 'a planned row becomes the target, Next appears');
    await ev(p, () => showInfo(objById(cfg.target))); await wait(p, 500);
    await p.tap('#infoSeen'); await wait(p, 500);
    await p.tap('#seenSee button:nth-child(3)'); await p.tap('#seenTr button:nth-child(4)'); await p.fill('#seenNote', 'Core resolved.');
    await p.tap('#seenSaveNext'); await wait(p, 500);
    const e = await ev(p, () => obs.log[0]);
    ok(e && e.seeing === 3 && e.transp === 4 && e.note === 'Core resolved.', 'Seen saves seeing, transparency and note', e);
    ok(await ev(p, f => cfg.target !== f, first), 'Save, next moves on to the next planned object');
    await ev(p, () => openSeen(objById(cfg.target))); await wait(p); await p.tap('[data-res="miss"]'); await p.tap('#seenSave'); await wait(p);
    ok(await ev(p, () => obs.log.length) === 2, 'a “not found” entry is logged too');
    await ev(p, () => showInfo(objById(obs.log[0].obj))); await wait(p);
    ok(/Seen 1×/.test(await ev(p, () => $('infoHist').textContent)), 'details show the history');
    await ev(p, () => closeSheet('infoSheet')); await wait(p);
    await p.tap('#btnMenu'); await wait(p); await p.tap('#btnLog'); await wait(p, 500);
    ok(await openSheets(p) === 'logSheet', 'logbook opens from the menu');
    ok(await ev(p, () => document.querySelectorAll('.lrow').length) === 2, 'logbook lists both entries');
    await p.tap('#logMenu'); await wait(p, 500);
    ok(await openSheets(p) === 'menu', '← in the logbook goes back to the menu');
    await p.tap('#btnLog'); await wait(p, 500);
    await p.tap('.lrow'); await wait(p, 500);
    ok(await ev(p, () => !$('seenDelete').hidden), 'an opened entry can be deleted');
    await p.tap('#seenDelete'); await wait(p, 200);
    ok(await ev(p, () => $('seenDelete').classList.contains('armed') && $('seenDelete').textContent === 'Yes, delete' && $('seenSave').hidden && !!$('seenActs').querySelector('.armcancel') && !$('seenSheet').hidden && $('confirmSheet').hidden),
      'Delete asks in place: a red “Yes, delete” with Cancel, no dialog');
    await p.tap('#seenDelete'); await wait(p, 500);
    ok(await ev(p, () => obs.log.length) === 1, 'Delete removes the entry');
    // backup and restore in Settings → General
    await ev(p, () => { SHEETS.forEach(x => closeSheet(x.id)); syncSettings(); openSheet('sheet'); setSetTab('general'); }); await wait(p, 500);
    const [dl] = await Promise.all([p.waitForEvent('download'), p.evaluate(() => $('bkLists').click())]);
    const file = await dl.path(), json = JSON.parse(fs.readFileSync(file, 'utf8'));
    ok(json && Array.isArray(json.log || (json.obs && json.obs.log)), 'Back up lists saves a JSON file');
    await ev(p, () => { obs.log = []; saveObs(); });
    await p.setInputFiles('#bkFile', file); await wait(p, 800);
    if (await ev(p, () => !$('confirmSheet').hidden)) { await p.tap('#confirmOk'); await wait(p, 500); }
    ok(await ev(p, () => obs.log.length) === 1, 'Restore from a backup brings the entry back');
    const [dc] = await Promise.all([p.waitForEvent('download'), p.evaluate(() => $('bkCsv').click())]);
    ok(/^.*date.*object/i.test(fs.readFileSync(await dc.path(), 'utf8').split('\n')[0]), 'logbook CSV has a header line');
    await done(p);
  },

  // choosing another camera (was cam.cjs; uses the browser's fake camera)
  async camera() {
    const ctxP = await page({ perms: ['camera'] });
    await ev(ctxP, () => { cfg.fov.video = 66; save(); });
    await ev(ctxP, () => startCamera()); await wait(ctxP, 1200);
    ok(await ev(ctxP, () => !!st.stream), 'live camera starts');
    await ev(ctxP, () => { syncSettings(); listCameras(); openSheet('sheet'); setSetTab('cam'); }); await wait(ctxP, 800);
    const opts = await ev(ctxP, () => [...$('camSel').options].map(o => o.value));
    ok(opts.length >= 2, 'camera list offers the cameras the browser sees', opts);
    if (opts.length >= 2) {
      await ctxP.selectOption('#camSel', opts[1]); await wait(ctxP, 1200);
      ok(await ev(ctxP, () => !!cfg.camId && !!st.stream), 'choosing a camera switches to it');
      await ctxP.selectOption('#camSel', ''); await wait(ctxP, 1200);
      ok(await ev(ctxP, () => !cfg.camId && !!st.stream), 'back to the automatic back camera');
    }
    await ev(ctxP, () => stopCamera()); await done(ctxP);
  },

  // eyepieces, aperture, Barlow, best eyepiece
  async eyepieces() {
    const p = await page();
    await ev(p, () => { cfg.optics.eps = [{ f: 25, a: 52 }, { f: 10, a: 52 }]; setOptics({ ep: 0, ap: null, barlow: 0, useB: false }); });
    await ev(p, () => showInfo(objById('M13'))); await wait(p);
    ok(/aperture/.test(await ev(p, () => $('infoEp').textContent)), 'without the aperture the details point to the telescope settings');
    await ev(p, () => { closeSheet('infoSheet'); setOptics({ ap: 203 }); }); await wait(p);
    await ev(p, () => showInfo(objById('M13'))); await wait(p);
    ok(/^10 mm/.test(await ev(p, () => $('infoEp').querySelector('.eb b').textContent)), 'M13: the 10 mm is the best eyepiece');
    await ev(p, () => { closeSheet('infoSheet'); setOptics({ barlow: 2 }); }); await wait(p);
    ok(await ev(p, () => [...$('qEp').options].some(o => o.textContent.startsWith('10 mm + 2×'))), 'with a 2× Barlow each eyepiece is also offered with it');
    await ev(p, () => showInfo(objById('M57'))); await wait(p);
    ok(/^10 mm \+ 2×/.test(await ev(p, () => $('infoEp').querySelector('.eb b').textContent)), 'M57: 10 mm with Barlow is best');
    await p.tap('#infoEp .eb .btn'); await wait(p, 300);
    ok(await ev(p, () => curEpKey()) === '1:2', 'Use it selects the eyepiece with the Barlow');
    await ev(p, () => { closeSheet('infoSheet'); syncSettings(); openSheet('sheet'); setSetTab('scope'); }); await wait(p, 500);
    await p.tap('#oEps .eprow button'); await wait(p, 300);
    ok(await ev(p, () => document.querySelectorAll('#oEps .eprow').length === 1 && cfg.optics.eps[0].f === 10), 'removing an eyepiece updates the list at once');
    await done(p);
  },

  // seeing tonight: set in Quick settings or with a logbook entry (the newer counts), it caps the magnification the
  // eyepiece advice suggests; a tap on the seeing line in the details goes to Quick settings
  async seeing() {
    const p = await page();
    await ev(p, () => { cfg.optics.eps = [{ f: 32, a: 50 }, { f: 25, a: 52 }, { f: 15, a: 52 }, { f: 10, a: 52 }, { f: 6, a: 60 }]; setOptics({ ep: 0, ap: 203, scope: 1200, barlow: 0, useB: false }); });
    const best = () => ev(p, () => { closeSheet('infoSheet'); showInfo(targetById('Jupiter')); const b = $('infoEp').querySelector('.eb b').textContent, l = $('infoEp').querySelector('.seelnk'); return { b, mag: +b.match(/(\d+)×/)[1], lnk: l && l.textContent, why: $('infoEp').querySelector('.eb small').textContent }; });
    let r = await best();
    ok(r.mag >= 180 && /Set tonight’s seeing/.test(r.lnk), 'without seeing: Jupiter at about 200×, and a link to set the seeing', r);
    await ev(p, () => { closeSheet('infoSheet'); openSheet('quickSheet'); syncQuick(); }); await wait(p, 400);
    await p.tap('#qSee button:nth-child(2)'); await wait(p, 200);
    if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, 'see-quick.png') });
    ok(await ev(p, () => seeingTonight() === 2 && /^2: restless · sharp to about 100×/.test($('qSeeTxt').textContent) && $('qSee').children[1].getAttribute('aria-pressed') === 'true'), 'Quick settings: seeing 2 for tonight');
    r = await best();
    if (process.env.SHOTS) { await wait(p, 500); await ev(p, () => $('infoEp').scrollIntoView({ block: 'center' })); await wait(p, 200); await p.screenshot({ path: path.join(process.env.SHOTS, 'see-info.png') }); }
    ok(r.mag <= 100 && /Seeing 2 tonight · sharp to about 100×/.test(r.lnk) && /seeing 2 tonight/i.test(r.why), 'seeing 2: the advice stays at about 100× and says why', r);
    await ev(p, () => { closeSheet('infoSheet'); openSeen(objById('M13')); }); await wait(p, 300);
    ok(await ev(p, () => seenState.see === 2), 'a new logbook entry starts with tonight’s seeing');
    await ev(p, () => { seenState.see = 4; $('seenSave').click(); }); await wait(p, 300);
    ok(await ev(p, () => seeingTonight() === 4), 'an entry with seeing 4 made later counts');
    r = await best();
    ok(r.mag > 150 && r.mag <= 200, 'seeing 4: up to about 200×', r);
    await ev(p, () => { closeSheet('infoSheet'); openSheet('quickSheet'); syncQuick(); }); await wait(p, 400);
    await p.tap('#qSee button:nth-child(4)'); await wait(p, 200);
    ok(await ev(p, () => seeingTonight() === null && /how steady the air is/.test($('qSeeTxt').textContent)), 'tapping the selected value again clears it');
    await done(p);
  },

  // more in the eyepiece advice: the object's surface brightness, how low it stands (the air blurs it), and the Moon
  // lighting the sky
  async advice() {
    const p = await page();
    const r = await ev(p, () => {
      cfg.optics.eps = [{ f: 32, a: 50 }, { f: 25, a: 52 }, { f: 15, a: 52 }, { f: 10, a: 52 }, { f: 6, a: 60 }]; setOptics({ ep: 0, ap: 203, scope: 1200, barlow: 0, useB: false });
      const at = d => A.MakeTime(d), altOf = (id, d) => horiz(targetById(id).vec(at(d)), at(d)).alt;
      const t0 = skyDate().getTime(), times = Array.from({ length: 144 }, (_, i) => new Date(t0 - 12 * 3600e3 + i * 600e3));
      // surface brightness: the faint, spread-out M33 gets a wider exit pupil than the small, bright M32
      const sbFaint = epAdvice(objById('M33'), at(times[72])), sbBright = epAdvice(objById('M32'), at(times[72]));
      // Jupiter low (about 20°) and high (over 45°), the low one in the dark
      const dark = d => horiz(targetById('Sun').vec(at(d)), at(d)).alt < -12;
      const lowT = times.find(d => dark(d) && Math.abs(altOf('Jupiter', d) - 20) < 3), highT = times.find(d => altOf('Jupiter', d) > 40);
      const jl = lowT && epAdvice(targetById('Jupiter'), at(lowT)), jh = highT && epAdvice(targetById('Jupiter'), at(highT));
      // the Moon: up and bright, or down, for M101 above the horizon
      const ill = d => A.Illumination(A.Body.Moon, at(d)).phase_fraction;
      const moonUp = times.find(d => altOf('Moon', d) > 10 && ill(d) > 0.4 && altOf('M101', d) > 10), moonDown = times.find(d => altOf('Moon', d) < -5 && altOf('M101', d) > 10);
      const m1 = moonUp && epAdvice(objById('M101'), at(moonUp)), m2 = moonDown && epAdvice(objById('M101'), at(moonDown));
      return { faintP: sbFaint.best.pupil, brightP: sbBright.best.pupil, faintWhy: sbFaint.best.why,
        low: jl && { mag: jl.best.mag, why: jl.best.why }, high: jh && { mag: jh.best.mag }, m1: m1 && m1.best.why, m2: m2 && m2.best.why, m1p: m1 && m1.best.pupil, m2p: m2 && m2.best.pupil };
    });
    ok(r.faintP > r.brightP && /Faint and spread out/.test(r.faintWhy), 'surface brightness: a wider exit pupil for the faint, spread-out M33 than for M32', r);
    ok(r.low && r.high && r.low.mag < r.high.mag && /Low in the sky \(\d+°\)/.test(r.low.why), 'Jupiter low in the sky: less magnification, and why', r);
    ok(r.m1 && r.m2 && /The Moon brightens the sky/.test(r.m1) && !/The Moon/.test(r.m2) && r.m1p <= r.m2p, 'the Moon up and bright: a smaller exit pupil for a galaxy, and why', r);
    await done(p);
  },

  // object recommendations: unseen first and mixed kinds in Tonight, the Moon by its light and distance, tonight's
  // seeing and transparency, the best time, another try for what wasn't found, started programmes, the sky at the place
  async recommend() {
    const p = await page();
    const r = await ev(p, () => {
      setOptics({ ap: 203, scope: 1200 });
      const E = (uid, obj, t, extra = {}) => ({ uid, obj, name: obj, t, result: 'easy', note: '', lat: 48.18, lon: 10.08, ...extra });
      obs.log = ['M31', 'M13', 'M45', 'M42', 'M57', 'M27', 'M92', 'M15', 'M2', 'M39', 'M52', 'M103'].map((id, i) => E('s' + i, id, '2025-09-0' + (1 + i % 9) + 'T21:00:00Z'));
      obs.log.push(E('c1', 'NGC 7000', '2025-09-02T21:00:00Z'));   // Caldwell 20: the Caldwell programme is started
      saveObs(); planCache.t = null;
      const tn = nightPlan(), picks = tn.dso.map(x => ({ id: x.id, cls: x.cls, why: x.why.join(' ') }));
      // the Moon (71 %, up at this night)
      const t = skyNow().t, gal = TARGETS.filter(T => T.kind === 'dso' && dsoCls(T.id) === 'gal' && /^M\d+$/.test(T.id) && horiz(T.vec(t), t).alt > 20);
      const washed = gal.filter(T => /washes it out/.test(nowFit(T).why.join(' '))), moonOk = TARGETS.filter(T => T.kind === 'dso' && /^M\d+$/.test(T.id) && /A good target with the Moon up/.test(nowFit(T).why.join(' ')));
      // the best time: something low and rising
      const later = TARGETS.filter(T => T.kind === 'dso' && /^M\d+$/.test(T.id)).find(T => /Better later/.test(nowFit(T).why.join(' ')));
      return { picks, washed: washed.map(T => [T.id, nowFit(T).ok]), moonOk: moonOk.map(T => T.id), later: later && later.id, act: activeProgIds().get('NGC 869') || activeProgIds().get('NGC 7243') || [...activeProgIds().values()][0] };
    });
    const seen = ['M31', 'M13', 'M45', 'M42', 'M57', 'M27', 'M92', 'M15', 'M2', 'M39', 'M52', 'M103'];
    if (process.env.SHOTS) { await ev(p, () => $('btnTonight') ? $('btnTonight').click() : openTonight()); await wait(p, 900); await ev(p, () => { const h = [...document.querySelectorAll('#tonightSheet h3')].find(x => /deep-sky/.test(x.textContent)); h && h.scrollIntoView(); }); await wait(p, 300); await p.screenshot({ path: path.join(process.env.SHOTS, 'rec-tonight.png') }); await ev(p, () => SHEETS.forEach(x => closeSheet(x.id))); await wait(p, 400); }
    ok(r.picks.length >= 6 && r.picks.slice(0, 4).every(x => !seen.includes(x.id) && /new for you|try again/.test(x.why)), 'Tonight: what you haven’t seen comes first, and says so', r.picks.slice(0, 5));
    ok(new Set(r.picks.slice(0, 6).map(x => x.cls)).size >= 3, 'Tonight: a mix of kinds', r.picks.map(x => x.cls));
    ok(r.picks.some(x => /Caldwell/.test(x.why)), 'Tonight: objects of a started programme are marked', r.picks.map(x => x.why));
    ok(r.washed.every(([, okk]) => !okk) && r.moonOk.length > 0, 'the Moon: galaxies close to it wash out, clusters are good targets with the Moon up', r);
    ok(!!r.later, 'the best time: “Better later” for something still low and rising', r.later);
    // seeing and transparency tonight
    const air = await ev(p, () => { setSeeing(4); const j = nowFit(targetById('Jupiter')).why.join(' '); setSeeing(2); const j2 = nowFit(targetById('Jupiter')).why.join(' '); setSeeing(0);
      obs.log.push({ uid: 'tr', obj: 'M45', name: 'M45', t: new Date().toISOString(), result: 'easy', transp: 2 }); saveObs();
      const g = TARGETS.find(T => T.kind === 'dso' && dsoCls(T.id) === 'gal' && /^M\d+$/.test(T.id)); return { j, j2, g: nowFit(g).why.join(' ') }; });
    ok(/Steady air tonight \(seeing 4\)/.test(air.j) && /Restless air tonight \(seeing 2\)/.test(air.j2) && /Hazy tonight \(transparency 2\)/.test(air.g), 'seeing and transparency of tonight count', air);
    // another try: not found before when it stood low, now high
    const retry = await ev(p, () => { const t = skyNow().t, T = TARGETS.find(x => x.kind === 'dso' && /^M\d+$/.test(x.id) && !sets().seen.has(x.id) && horiz(x.vec(t), t).alt > 45);
      obs.log.push({ uid: 'm1', obj: T.id, name: T.id, t: '2026-03-01T20:00:00Z', result: 'miss', alt: 12, moon: '90 %, up' }); saveObs(); return { id: T.id, why: nowFit(T).why.join(' ') }; });
    ok(/Not found on Mar 1; now it stands higher: try again\./.test(retry.why), 'not found before: try again when it stands higher', retry);
    // the sky at the place
    const sky = await ev(p, () => { const T = targetById('M101'); cfg.sky = 'dark'; st.opticsVer++; const a = scopeFit(T); cfg.sky = 'city'; st.opticsVer++; const b = scopeFit(T); cfg.sky = null; st.opticsVer++; return { a: a.ok, b: b.ok, why: b.why.join(' ') }; });
    ok(sky.a && !sky.b && /under your city sky/.test(sky.why), 'the sky at the place: M101 in a dark sky yes, under a city sky no', sky);
    await ev(p, () => { syncSettings(); openSheet('sheet'); setSetTab('general'); }); await wait(p, 400);
    await p.selectOption('#skyQ', 'suburb'); await wait(p, 200);
    ok(await ev(p, () => cfg.sky === 'suburb'), 'Settings › General: the sky at this place');
    await done(p);
  },

  // finder types
  async finder() {
    const p = await page();
    await ev(p, () => { cfg.optics.eps = [{ f: 25, a: 52 }]; setOptics({ ep: 0, telrad: false, view: true }); syncSettings(); });
    const set = t => ev(p, t => { $('oFinderType').value = t; $('oFinderType').onchange(); setOptics({ src: 'finder' }); }, t);
    await set('reddot'); await wait(p, 300);
    { const t = await ev(p, () => $('epSrc').textContent); ok(t === 'Red-dot finder · naked eye', 'red-dot finder: naked-eye finder view', t); }
    await set('telrad'); ok(await ev(p, () => cfg.optics.telrad), 'Telrad turns its rings on');
    await set('reddot'); ok(await ev(p, () => !cfg.optics.telrad), 'another finder turns the Telrad rings off again');
    await set('8x50'); ok(await ev(p, () => finderFov()) === 6, '8×50 finder: 6° field');
    await done(p);
  },

  // tablet / desktop: menu, logbook and settings on the left, the rest on the right
  async panels() {
    const p = await page({ w: 1440, h: 900, mobile: false });
    await ev(p, () => showInfo(objById('M13'))); await wait(p, 500);
    await p.click('#btnMenu'); await wait(p, 500);
    ok(await openSheets(p) === 'infoSheet+menu', 'menu opens on the left, the details stay on the right');
    await p.click('#btnSettings'); await p.waitForFunction(() => $('sheet').classList.contains('open') && $('menu').hidden, null, { timeout: 4000 }).catch(() => {});
    { const os = await openSheets(p); ok(os === 'infoSheet+sheet', 'settings replace the menu on the left', os); }
    ok(await ev(p, () => $('sheet').querySelector('.inner').getBoundingClientRect().left) < 5, 'settings sit on the left');
    await p.click('#setMenu'); await wait(p, 500);
    await p.click('#menu [data-close]'); await wait(p, 500);
    await p.click('#infoTarget'); await wait(p, 500);
    ok(await ev(p, () => cfg.target === 'M13' && $('infoSheet').classList.contains('open')), 'Set as target keeps the details open');
    await p.click('#infoShowMap'); await wait(p, 500);
    const c = await ev(p, () => { const q = Solver.skyToPix(st.sol, objById('M13').vec(skyNow().t)), [x, y] = P(q.x, q.y); return [Math.abs(x - viewCx()), Math.abs(y - view.height / 2), st.mapView.fov]; });
    ok(c[0] < 5 && c[1] < 5 && c[2] >= 20 && c[2] <= 40, 'Show on map centres the object (in the free part of the map) at 20–40°', c);
    await done(p);
  },

  // sound guidance: one axis after the other
  async sound() {
    const p = await page();
    await ev(p, () => clearTarget());
    ok(await ev(p, () => $('fabSound').hidden), 'sound button hidden without a target');
    await ev(p, () => selectTarget('M13'));
    ok(await ev(p, () => !$('fabSound').hidden), 'sound button shown with a target');
    await ev(p, () => { window.__log = []; const orig = tone; tone = (k, a) => { __log.push(k + (a > 0 ? '+' : a < 0 ? '-' : '')); orig(k, a); };
      const t = skyNow().t, th = horiz(vecNow(targetById('M13')), t); window.__aim = { az: th.az - 30, alt: th.alt - 10 };
      teleVec = () => Solver.mul(horToEqj(skyNow().t), hv(__aim.az, __aim.alt)); });
    await p.tap('#fabSound'); await wait(p, 100);
    const run = async (fn, ms) => { await ev(p, fn); await ev(p, () => { __log.length = 0; }); await wait(p, ms); return ev(p, () => [...new Set(__log)].join(',')); };
    const aim = 'const th = horiz(vecNow(targetById("M13")), skyNow().t);';
    ok(await run(new Function(aim + '__aim.az = th.az - 30;'), 2000) === 'tick+', 'far to the left of it: high ticks (turn right)');
    ok(await run(new Function(aim + '__aim.az = th.az + 3;'), 1500) === 'tick-', 'to the right of it: low tocks (turn left)');
    ok(await run(new Function(aim + '__aim.az = th.az;'), 2000) === 'chirp+', 'azimuth right, too low: rising chirps');
    ok(await run(new Function(aim + '__aim.alt = th.alt + 1.5;'), 1500) === 'chirp-', 'too high: falling chirps');
    ok(await run(new Function(aim + '__aim.alt = th.alt; __aim.az = th.az;'), 1500) === 'chord', 'on target: one chord, then quiet');
    await ev(p, () => clearTarget());
    ok(await ev(p, () => !sound.on), 'clearing the target switches the sound off');
    await done(p);
  },

  // a satellite as target: drawn also below the horizon, next pass (an ISS-like orbit with epoch on the test night)
  async satellite() {
    const cks = l => { let s = 0; for (const ch of l.slice(0, 68)) s += ch === '-' ? 1 : /\d/.test(ch) ? +ch : 0; return l.slice(0, 68) + (s % 10); };
    const l1 = cks('1 25544U 98067A   26293.50000000  .00016717  00000-0  10270-3 0  9990'), l2 = cks('2 25544  51.6400 100.0000 0005000  90.0000 270.0000 15.50000000400000');
    const p = await page({ time: new Date('2026-10-20T17:16:00+02:00'), init: `window.__tle = ${JSON.stringify({ sats: [{ name: 'ISS (ZARYA)', l1, l2 }] })};
      const f0 = window.fetch; window.fetch = (u, o) => String(u).includes('/api/tle') ? Promise.resolve(new Response(JSON.stringify(window.__tle), { headers: { 'content-type': 'application/json' } })) : f0(u, o);` });
    await p.waitForFunction(() => SAT.ok, null, { timeout: 10000 });
    await ev(p, () => { selectTarget('SAT25544'); cfg.show.sats = false; st.filterVer++; const t = skyNow().t, h = horiz(vecNow(targetById('SAT25544')), t); st.mapView = { az: h.az, alt: h.alt, fov: 60 }; lastSig = []; updateGuide(); });
    await wait(p, 600);
    ok(await ev(p, () => st.drawnSats.length) === 1, 'the target satellite is drawn below the horizon, with satellites filtered out');
    const sub = await ev(p, () => $('tgtChipState').textContent);
    ok(/next pass \d/.test(sub), 'the target pill gives the next pass', sub);
    // not the target: details and Show on map still draw it, below the horizon too
    await ev(p, () => { selectTarget('M31'); showInfo(objById('SAT25544')); }); await wait(p, 400);
    await p.tap('#infoShowMap'); await wait(p, 600);
    const off = await ev(p, () => { const s = st.drawnSats.find(q => q.x.norad === 25544); if (!s) return null; const q = Solver.skyToPix(st.sol, s.v), [x, y] = P(q.x, q.y); return Math.hypot(x - view.width / 2, y - view.height / 2); });
    ok(off != null && off < 30, 'Show on map draws the satellite in its ring, also when it isn’t the target', off);
    await done(p);
  },

  // locate with a fake camera of a star field, diagnostics
  async diagnostics() {
    const p = await page({ perms: ['camera'], init: () => {
      navigator.mediaDevices.getUserMedia = async () => {
        const W = 960, H = 540, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
        const rnd = (s => () => (s = (s * 16807) % 2147483647) / 2147483647)(7), stars = [];
        for (let i = 0; i < 120; i++) stars.push([rnd() * W, rnd() * H, 0.8 + rnd() * rnd() * 12]);
        const img = g.createImageData(W, H);
        setInterval(() => { const d = img.data;
          for (let i = 0; i < W * H; i++) { const v = 18 + (Math.random() + Math.random() + Math.random() - 1.5) * 1.6; d[4 * i] = d[4 * i + 1] = d[4 * i + 2] = v; d[4 * i + 3] = 255; }
          for (const [x, y, a] of stars) for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const xx = Math.round(x) + dx, yy = Math.round(y) + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const j = 4 * (yy * W + xx); d[j] = d[j + 1] = d[j + 2] = Math.min(255, d[j] + a * Math.exp(-(dx * dx + dy * dy) / 2.2)); }
          g.putImageData(img, 0, 0); }, 33);
        return cv.captureStream(30);
      };
    } });
    await ev(p, () => { cfg.fov.video = 66; cfg.diag = true; save(); syncSettings(); });
    await ev(p, () => startCamera()); await wait(p, 2500);
    await ev(p, () => solveNow()); await p.waitForFunction(() => !st.busy && !!diag.last, null, { timeout: 60000 });
    ok(await ev(p, () => diag.last.stars.length) > 30, 'locate finds the points of light', await ev(p, () => diag.last.stars.length));
    await ev(p, () => openDiag()); await wait(p, 500);
    ok(await ev(p, () => !document.querySelector('#diagLayers [data-layer=single]').hidden), 'live capture offers “One frame”');
    ok(/Gradient/.test(await ev(p, () => $('diagFacts').textContent)), 'diagnostics show the sky gradient');
    await ev(p, () => { navigator.canShare = undefined; });
    await p.tap('#diagLayers [data-layer=mask]');
    const [d] = await Promise.all([p.waitForEvent('download'), p.evaluate(() => $('diagSave').click())]);
    ok(/detection/.test(d.suggestedFilename()), 'Save keeps the selected layer', d.suggestedFilename());
    await ev(p, () => stopCamera()); await done(p);
  },

  // target pill, removing the compass correction, stars across the whole screen with the eyepiece point far off the axis
  async compass() {
    const p = await page();
    await ev(p, () => { cfg.target = 'M45'; save(); updateGuide(); }); await wait(p, 200);
    ok(await ev(p, () => !$('tgtChip').hidden && /M45|Pleiades/.test($('tgtChipName').textContent) && /high|horizon/.test($('tgtChipState').textContent)), 'the target shows as a pill bottom left, with where it stands', await ev(p, () => $('tgtChipTxt').textContent));
    ok(await ev(p, () => !document.querySelector('#guide .htotal')), 'no target line under the directions any more');
    await p.tap('#tgtChipTxt'); await wait(p);
    ok((await openSheets(p)).includes('targetSheet'), 'tapping the pill opens the target panel', await openSheets(p));
    await ev(p, () => SHEETS.forEach(x => !x.hidden && closeSheet(x.id))); await wait(p);
    await p.tap('#btnTgtOff'); await wait(p, 200);
    ok(await ev(p, () => !cfg.target && $('tgtChip').hidden), '✕ on the pill clears the target');
    // aligned on the map in compass mode: compass correction plus a changed eyepiece point; ✕ undoes both
    await ev(p, () => { cfg.calTeleBak = { tele: { x: 0, y: 0 }, teleTop: null }; cfg.tele = { x: 0, y: -0.4 }; save(); setCompassCal(6.5); });
    ok(await ev(p, () => !$('calChip').hidden && /Aligned on the map/.test($('calChipTxt').textContent)), 'the pill names the map alignment', await ev(p, () => $('calChipTxt').textContent));
    await p.tap('#btnCalOff'); await wait(p, 200);
    ok(await ev(p, () => !+cfg.compassCal && !cfg.calTeleBak && Math.abs(cfg.tele.y) < 1e-9 && $('calChip').hidden), 'removing it restores the compass and the eyepiece point', await ev(p, () => [cfg.compassCal, cfg.tele]));
    // the map growing without a window resize (iPhone app filling the screen) resizes the canvas: circles stay round
    const sz = await ev(p, async () => { document.documentElement.style.setProperty('--app-h', (innerHeight + 64) + 'px'); await new Promise(r => setTimeout(r, 300));
      const v = $('view'), r = v.getBoundingClientRect(), k = v.height / r.height; document.documentElement.style.removeProperty('--app-h'); return [k, v.width / r.width]; });
    ok(Math.abs(sz[0] - sz[1]) < 0.01, 'the map canvas follows a size change without a resize event', sz);
    // an eyepiece point far off the centre (set before the map alignment kept a backup) shows its own pill; ✕ resets it
    await ev(p, () => { cfg.tele = { x: 0, y: -0.8 }; save(); }); await wait(p, 400);
    ok(await ev(p, () => !$('teleChip').hidden && /39° off/.test($('teleChipTxt').textContent)), 'an eyepiece point far off the centre shows a pill', await ev(p, () => $('teleChipTxt').textContent));
    await p.tap('#btnTeleOff'); await wait(p, 400);
    ok(await ev(p, () => Math.hypot(cfg.tele.x, cfg.tele.y) < 1e-9 && $('teleChip').hidden), '✕ resets the eyepiece point to the image centre');
    // compass mode with the eyepiece point 50° off the camera axis: the view is shifted, stars must still fill the screen
    const halves = await ev(p, async () => {
      const v = $('view'), sol = mapSolCompute(skyNow().M, v.width, v.height, { az: 200, alt: 35, fov: 60 });
      st.sensor = true; st.solMode = 'compass'; st.sol = sol; cfg.tele = { x: 0, y: Math.tan(50 * D2R) }; lastSig = [];
      await new Promise(r => setTimeout(r, 300));
      // bright catalogue stars that land in the lower third: each must have its dot drawn
      const g = v.getContext('2d'), W = v.width, H = v.height; let want = 0, seen = 0;
      for (let k = 0; k < Solver.cat.n && STARS[3 * k + 2] < 4.5; k++) {
        const q = Solver.skyToPix(sol, Solver.cat.v[k]); if (!q || q.z < 0.05) continue;
        const [x, y] = P(q.x, q.y); if (x < 20 || x > W * 0.7 || y < H * 2 / 3 || y > H - 20) continue;
        want++; const d = g.getImageData(Math.round(x) - 1, Math.round(y) - 1, 3, 3).data; let hit = false;
        for (let i = 0; i < d.length; i += 4) if (d[i] > 120 && d[i + 2] > 150) hit = true;
        if (hit) seen++;
      }
      return [seen, want];
    });
    ok(halves[1] > 0 && halves[0] >= 0.8 * halves[1], 'with the view shifted, stars are drawn down to the bottom of the screen', halves);
    // switching Align off: the free map stays where it was (direction of the screen centre and the field)
    const kept = await ev(p, async () => {
      cfg.tele = { x: 0, y: 0 }; st.mapView = { az: 0, alt: 0, fov: 50 }; const v = $('view'); st.sol = mapSolCompute(skyNow().M, v.width, v.height, { az: 200, alt: 35, fov: 50 }); st.sensor = true; st.solMode = 'compass'; lastSig = [];
      await new Promise(r => setTimeout(r, 300)); await setSensor(false); return st.mapView; });
    ok(Math.abs(((kept.az - 200) + 540) % 360 - 180) < 0.5 && Math.abs(kept.alt - 35) < 0.5 && Math.abs(kept.fov - 50) < 0.5, 'switching Align off keeps the view on the map', kept);
    await done(p);
  },

  // Milky Way and satellites: extras, off by default, outside the presets
  async milkyway() {
    const p = await page({ w: 1000, h: 700, mobile: false });
    await ev(p, () => { cfg.figures = false; lastSig = []; });   // measures the band's light: no figures on top
    ok(await ev(p, () => !cfg.show.mw && !cfg.show.sats), 'Milky Way and satellites are off by default');
    const fill = () => ev(p, async () => { const t = skyNow().t, h = horiz(Solver.radec2v(308, 41), t); st.mapView = { az: h.az, alt: h.alt, fov: 60 }; cfg.show.stars = false; st.filterVer++; lastSig = [];
      await new Promise(r => setTimeout(r, 500)); const v = $('view'), q = Solver.skyToPix(st.sol, Solver.radec2v(308, 41)), [x, y] = P(q.x, q.y); return v.getContext('2d').getImageData(x | 0, (y | 0) + 25, 1, 1).data[2]; });
    const off = await fill();
    await ev(p, () => { syncFilter(); openSheet('filterSheet'); }); await wait(p);
    await p.click('[data-show=mw]'); await wait(p, 900);
    const on = await fill();
    ok(on > off + 5, 'switching it on fills the band in Cygnus', [off, on]);
    ok(await ev(p, () => { cfg.show.stars = true; syncFilter(); return cfg.show.mw && $('filterChip').hidden && presetOf(cfg.show) === 'all'; }), 'the Milky Way is an extra: the filter still counts as Everything');
    // random views: the galactic pole never filled, the band always (only the Milky Way drawn)
    await ev(p, () => closeSheet('filterSheet')); await wait(p, 500);   // the same full-width view as before the map moved beside panels
    const bad = await ev(p, async () => {
      cfg.show = { ...cfg.show, stars: false, solar: false, gal: false, glob: false, open: false, neb: false, pn: false, ngc: false }; cfg.conLines = false; cfg.target = null; st.filterVer++;
      cfg.optics.ring = false; cfg.optics.telrad = false; st.opticsVer = (st.opticsVer || 0) + 1;   // only the Milky Way: no rings around the middle
      const gp = Solver.radec2v(192.86, 27.13), pts = [[gp, false], [gp.map(x => -x), false], [Solver.radec2v(266.4, -28.9), true], [Solver.radec2v(10, 61), true]], out = [];
      let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let k = 0; k < 120; k++) {
        st.mapView = { az: rnd() * 360, alt: rnd() * 180 - 90, fov: 40 + rnd() * 100 }; lastSig = [];
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const v = $('view'), g = v.getContext('2d');
        for (const [w, want] of pts) {
          const q = Solver.skyToPix(st.sol, w); if (!q) continue; const [x, y] = P(q.x, q.y); if (x < 40 || y < 40 || x > v.width - 260 || y > v.height - 120) continue;
          const b = g.getImageData(x | 0, y | 0, 1, 1).data[2]; if ((b > 4) !== want) out.push([k, want, b]);
        }
      }
      return out; });
    ok(bad.length === 0, 'in 120 random views the band is filled and the galactic poles are not', bad.slice(0, 5));
    await done(p);
  },

  // many search results: the panel scrolls with a finger (the list used to be cut off at the bottom)
  async searchScroll() {
    const p = await page();
    await ev(p, () => openSearch()); await wait(p, 500); await p.fill('#q', 'm'); await wait(p, 400);
    const sz = await ev(p, () => { const i = scroller($('searchSheet')); return [i.scrollHeight, i.clientHeight, $('results').children.length]; });
    ok(sz[0] > sz[1] + 200, 'all results are there to scroll to', sz);
    // the way Safari treated the box (squeezed to the panel): the rows must still keep their full height
    const saf = await ev(p, async () => { const r = $('results'), b = scroller($('searchSheet')); r.style.overflow = 'hidden'; r.style.minHeight = 'auto';
      await new Promise(x => setTimeout(x, 50)); const v = [b.scrollHeight, b.clientHeight]; r.style.overflow = r.style.minHeight = ''; return v; });
    ok(saf[0] > saf[1] + 200, 'the results keep their height even where the box could be squeezed', saf);
    const cdp = await p.context().newCDPSession(p);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 700 }] });
    for (let k = 1; k <= 12; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y: 700 - 400 * k / 12 }] }); await wait(p, 16); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await wait(p, 500);
    ok(await ev(p, () => scroller($('searchSheet')).scrollTop) > 200, 'a swipe up scrolls the results');
    await done(p);
  },

  // categories under the search field: conditions together, lists and kinds either way; "Suits you?" in the details
  // the telescope's reach (lowest and highest altitude): suggestions, plans, the target line and the map keep to it
  async reach() {
    const p = await page();
    await ev(p, () => { syncSettings(); openSheet('sheet'); setSetTab('scope'); }); await wait(p, 400);
    ok(await ev(p, () => $('oAltMin').value === '0' && $('oAltMax').value === '90'), 'by default the whole sky: 0° to 90°');
    await p.fill('#oAltMin', '30'); await p.fill('#oAltMax', '60'); await ev(p, () => $('oAltMax').dispatchEvent(new Event('change'))); await wait(p, 300);
    ok(await ev(p, () => opt().altMin === 30 && opt().altMax === 60 && reach().limited), 'the range is stored');
    const r = await ev(p, () => {
      const t = skyNow().t, M31 = targetById('M31'), alt = horiz(M31.vec(t), t).alt;
      const fit = nowFit(M31), plan = planFor(M31, nightPlan());
      selectTarget('M31', true); updateGuide();
      const tn = nightPlan(), wc = wizCandidates();
      closeSheet('sheet'); openSheet('searchSheet'); $('q').value = ''; showResults();
      const shown = [...document.querySelectorAll('#results .alt')].map(x => parseFloat(x.textContent)).filter(x => !isNaN(x));
      return { alt, fit, sub: plan.sub, pill: $('tgtChipState').textContent, warn: $('tgtChip').classList.contains('warn'),
        dso: tn.dso.map(x => x.b.alt), wiz: wc.map(c => c.alt), shown, grp: (document.querySelector('#results .grp') || {}).textContent || '' };
    });
    ok(r.alt > 60, 'M31 is above 60° on the test night', r.alt);
    ok(!r.fit.ok && r.fit.why.some(w => /Too high for your telescope/.test(w)), '“Suits you?” says it is too high', r.fit.why);
    ok(/too high now/.test(r.sub), 'its plan says too high now', r.sub);
    ok(/too high for your telescope/.test(r.pill) && r.warn, 'the target line warns', r.pill);
    ok(r.dso.length > 0 && r.dso.every(a => a >= 30 && a <= 60), 'Tonight’s objects are best within the range', r.dso);
    ok(r.wiz.every(a => a >= 30 && a <= 60), 'the setup assistant suggests stars within the range', r.wiz);
    ok(r.shown.length > 0 && r.shown.every(a => a >= 30 && a <= 60) && /30–60°/.test(r.grp), 'Find target: well placed now = within the range', [r.shown, r.grp]);
    // categories: My telescope doesn't depend on the time (the altitude says where an object is now), Good now does
    const c = await ev(p, () => {
      setOptics({ ap: 200 }); cfg.searchCats = ['scope']; $('q').value = ''; showResults();
      const rows = [...document.querySelectorAll('#results .alt')].map(a => a.textContent);
      cfg.searchCats = ['scope', 'now']; showResults();
      const good = [...document.querySelectorAll('#results .alt')].map(a => parseFloat(a.textContent));
      setOptics({ altMin: 60, altMax: 90 }); reachChanged();
      const southIn = n => catList(n, TARGETS).filter(T => { const v = T.vec(skyNow().t); return Math.asin(v[2]) * R2D < 10; }).length;
      const south = southIn(['scope', 'reach']), southAll = southIn(['scope']);
      setOptics({ altMin: 30, altMax: 60 }); reachChanged(); cfg.searchCats = []; save();
      return { n: rows.length, out: rows.filter(r => /too low|too high|below hor/.test(r)).length, good, south, southAll };
    });
    ok(c.n > 0 && c.out > 0, 'My telescope also lists objects out of reach now, saying so next to the altitude', c);
    ok(c.good.length > 0 && c.good.every(a => a >= 30 && a <= 60), 'with Good now only what is in reach now', c.good);
    ok(c.south === 0 && c.southAll > 0, 'In reach leaves out objects that never climb above the lowest altitude; My telescope alone keeps them', [c.south, c.southAll]);
    // details: the night bar shows the times of the green part, the reach marks and a legend
    const d = await ev(p, async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms)), get = () => { const b = $('infoTonight') || document.querySelector('#infoSheet .ttonight'); return { times: [...b.querySelectorAll('.ntime')].filter(e => !e.hidden).map(e => e.textContent), marks: [...b.querySelectorAll('.nmark')].map(e => e.textContent), legend: b.querySelector('.nlegend') ? b.querySelector('.nlegend').textContent : '' }; };
      setOptics({ altMin: 25, altMax: 60 }); reachChanged(); showInfo(objById('M57')); await wait(400); const a = get();
      setOptics({ altMin: 0, altMax: 90 }); reachChanged(); showInfo(objById('M57')); await wait(400); const b = get();
      obs.list.push({ id: 'M57', name: 'M57', added: Date.now() }); saveObs(); showInfo(objById('M57'));
      const planned = $('infoPlan').innerHTML.includes('<rect'); obs.list = obs.list.filter(x => x.id !== 'M57'); saveObs(); showInfo(objById('M57'));
      return { a, b, planned, plan: !$('infoPlan').innerHTML.includes('<rect') };
    });
    ok(d.a.times.length >= 2 && d.a.marks.some(m => /^in /.test(m)) && d.a.marks.some(m => /^out /.test(m)) && /reach \(25–60°\)/.test(d.a.legend), 'details: green times, in/out marks for the reach, legend', d.a);
    ok(d.b.times.length >= 2 && d.b.marks.length === 0 && !/reach \(/.test(d.b.legend) && /well placed/.test(d.b.legend), 'without a set reach: no marks', d.b);
    ok(d.planned && d.plan, 'Planned has its own solid icon, Plan the outline');
    await wait(p, 300);
    await done(p);
  },

  // the middle of the map: Show on map and the crosshair sit in the middle of the part not covered by panels
  async centre() {
    for (const [w, h, mob] of [[390, 844, true], [1440, 900, false]]) {
      const p = await page({ w, h, mobile: mob });
      const r = await ev(p, async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms)), at = o => { const q = Solver.skyToPix(st.sol, o.vec(skyNow().t)), [x, y] = P(q.x, q.y); return [x, y]; };
        const free = () => { const sr = view.getBoundingClientRect(); let L = 0, R = sr.width; if (sidePanels()) SHEETS.forEach(x => { if (x.hidden) return; const b = x.querySelector('.inner').getBoundingClientRect(); if (sheetSide(x.id) === 'L') L = Math.max(L, b.right - sr.left); else R = Math.min(R, b.left - sr.left); }); return (L + R) / 2 * view.width / sr.width; };
        const o = objById('M57'); showInfo(o); await wait(600); showOnMap(o); await wait(900);
        const a = at(o), fa = free();
        let b = null, fb = null;
        if (sidePanels()) { $('btnMenu').click(); await wait(900); b = at(o); fb = free(); }
        // tracking (as with Align): the crosshair, where the telescope points, is in the middle too
        st.sol = Object.assign({}, mapSol(), { approx: false }); st.solMode = 'track'; st.source = 'map'; st.sensor = true; lastSig = []; await wait(300);
        const tp = telePix(st.sol), [tx] = P(tp.x, tp.y), ft = free();
        st.sensor = false; st.solMode = 'map';
        return { W: view.width, H: view.height, a, fa, b, fb, tx, ft };
      });
      const near = (x, y) => Math.abs(x - y) < 3;
      ok(near(r.a[0], r.fa) && near(r.a[1], r.H / 2), (mob ? 'phone' : 'desktop') + ': Show on map puts the object in the middle of the free map', r);
      if (r.b) ok(near(r.b[0], r.fb) && r.fb > r.fa, 'desktop: with the menu open too, it moves to the middle between the panels', [r.b, r.fb]);
      ok(near(r.tx, r.ft), (mob ? 'phone' : 'desktop') + ': the crosshair sits in the middle of the free map', [r.tx, r.ft]);
      await done(p);
    }
  },

  // live connection: two devices, codes exchanged as text (the QR step is the same text), then pointing and target live
  async live() {
    const A = await page(), B = await page({ w: 1280, h: 800, mobile: false, perms: ['camera'] });
    await ev(A, () => { cfg.liveRole = 'scope'; save(); }); await ev(B, () => { cfg.liveRole = 'follow'; save(); });
    // the settings in steps: first the role, then its options and Connect (the telescope side shows the first code)
    await ev(B, () => liveSettings()); await wait(B, 300);
    ok(await ev(B, () => !$('liveStepRole').hidden && $('liveStepGo').hidden && $('liveCamBox').hidden && $('liveStatus').hidden && document.querySelector('.rolecard.on input').value === 'follow'), 'Live settings start with the role, with this device’s role chosen');
    await ev(B, () => { document.querySelector('input[name=liveRole][value=scope]').click(); }); await wait(B, 100);
    ok(await ev(B, () => cfg.liveRole === 'scope' && document.querySelector('.rolecard.on input').value === 'scope'), 'tapping a card chooses that role');
    await ev(B, () => { document.querySelector('input[name=liveRole][value=follow]').click(); $('liveNext').click(); }); await wait(B, 100);
    const st2 = await ev(B, () => ({ role: $('liveStepRole').hidden, go: !$('liveStepGo').hidden, name: $('liveRoleName').textContent, follow: $('liveCamFollow').offsetHeight > 0, scope: $('liveCamScope').offsetHeight > 0 }));
    ok(st2.role && st2.go && st2.name === 'Follow' && st2.follow && !st2.scope, 'Next: step 2 with only the options of that role and Connect', st2);
    const which = await ev(B, () => { const a = liveStart, b = liveJoin, r = []; liveStart = () => r.push('start'); liveJoin = () => r.push('join'); $('liveConnect').click(); cfg.liveRole = 'scope'; $('liveConnect').click(); cfg.liveRole = 'follow'; liveStart = a; liveJoin = b; return r.join(); });
    ok(which === 'join,start', 'Connect: the follower scans, the telescope side shows the first code', which);
    await ev(B, () => $('liveBackRole').click());
    ok(await ev(B, () => !$('liveStepRole').hidden), 'Back returns to the role'); await ev(B, () => closeSheet('sheet', true));
    const code = await ev(A, () => liveStart({ noScan: true }));
    ok(/^zenigo-live:1:o[rd]:/.test(code || '') && code.length < 1200, 'device A shows a code (offer) small enough for a QR code', code && code.length);
    ok(await ev(A, () => !$('liveSheet').hidden && !$('liveQrBox').hidden), 'the code is shown as a QR code');
    const ans = await ev(B, c => liveJoin(c), code);
    ok(/^zenigo-live:1:a[rd]:/.test(ans || ''), 'device B answers with its own code', ans && ans.length);
    await ev(A, async a => liveAnswer(await liveDecode(a)), ans);
    await A.waitForFunction(() => live.state === 'connected', null, { timeout: 15000 }).catch(() => {});
    await B.waitForFunction(() => live.state === 'connected' && !!live.peer, null, { timeout: 15000 }).catch(() => {});
    ok(await ev(A, () => live.state === 'connected') && await ev(B, () => live.state === 'connected'), 'both are connected (directly, no server)');
    ok(await ev(B, () => /Following/.test($('liveStatus').textContent)) && await ev(A, () => /This device is the telescope/.test($('liveStatus').textContent)), 'the settings say who is the telescope and who follows');
    ok(await ev(B, () => $('liveStepRole').hidden && !$('liveOn').hidden && !$('liveCamBox').hidden && !$('liveStatus').hidden), 'connected: the overview with Disconnect, Change role and the camera image option');
    ok(await ev(B, () => !$('liveChip').hidden && $('liveChipTxt').textContent === 'Following the telescope' && $('liveChipL').hidden), 'following: the pill bottom right says “Following the telescope”');
    ok(await ev(A, () => $('liveChip').hidden && !$('liveChipL').hidden && /follows/.test($('liveChipLTxt').textContent)), 'the telescope side: its pill is with the pills on the left');
    ok(await ev(B, () => ['btnCam', 'btnSolve', 'btnSensor', 'btnAuto', 'btnTele', 'qNight', 'qGallery'].every(id => $(id).getAttribute('aria-disabled') === 'true')), 'following: camera, Locate, Align, Continuous, eyepiece point and photos are off');
    ok(await ev(B, () => /following/.test($('liveState').textContent) && !$('btnLive').hidden), 'the menu entry shows it too');
    // A points somewhere (as with Align): B follows it, its directions use A's telescope
    await ev(A, () => { const t = skyNow().t, v = targetById('M13').vec(t), h = horiz(v, t); st.mapView = { az: h.az, alt: h.alt, fov: 30 }; st.sol = Object.assign({}, mapSol(), { approx: false }); st.solMode = 'track'; st.sensor = true; cfg.tele = { x: 0, y: 0 }; });
    await B.waitForFunction(() => !!liveVec(), null, { timeout: 5000 }).catch(() => {});
    const f = await ev(B, () => { const v = liveVec(), m13 = targetById('M13').vec(skyNow().t); return { sep: v ? Solver.angDeg(v, m13) : null, tag: $('srcTag').textContent, map: st.mapView }; });
    ok(f.sep != null && f.sep < 0.5, 'B receives where A’s telescope points', f.sep);
    ok(/Live/.test(f.tag), 'B’s map follows it and says so', f.tag);
    // turning B's map by hand pauses following; the telescope's crosshair stays, "follow again" turns back
    const az0 = await ev(B, () => st.mapView.az);
    await ev(B, () => mapRotate(300, 0)); await wait(B, 400);
    const pz = await ev(B, () => ({ paused: live.paused, chip: !$('liveFollowChip').hidden, az: st.mapView.az, guide: !$('guide').classList.contains('idle') }));
    ok(pz.paused && pz.chip && Math.abs(pz.az - az0) > 1, 'dragging the map pauses following and offers “follow again”', pz);
    await ev(A, () => { st.mapView.az = (st.mapView.az + 0.5) % 360; st.sol = Object.assign({}, mapSol(), { approx: false }); }); await wait(B, 500);
    ok(await ev(B, a => Math.abs(st.mapView.az - a) < 0.01, pz.az), 'while paused, the map stays where it was');
    await ev(B, () => $('liveFollowTxt').click()); await wait(B, 400);
    ok(await ev(B, () => !live.paused && $('liveFollowChip').hidden && Solver.angDeg(liveVec(), Solver.pixToSky(st.sol, st.sol.cx, st.sol.cy)) < 0.3), '“follow again” turns the map back to the telescope');
    // a target chosen on B becomes A's target; directions on B are from A's telescope
    await ev(B, () => selectTarget('M92', true)); await wait(A, 600);
    ok(await ev(A, () => cfg.target === 'M92'), 'a target chosen on B is the target on A');
    ok(await ev(B, () => !$('guide').classList.contains('idle') && /\d/.test($('azV').textContent)), 'B shows the directions from A’s telescope to the target');
    await ev(A, () => clearTarget()); await wait(B, 600);
    ok(await ev(B, () => !cfg.target), 'clearing it on A clears it on B');
    // a telescope device that scans another telescope device's first code offers to follow it
    const sw = await ev(A, async () => { const c = { kind: 'o', sdp: 'v=0' }, r = liveOtherCode(c, 'a'); return { r, btn: !!$('liveSwitch'), again: liveOtherCode(c, 'a'), mine: liveOtherCode({ kind: 'a', sdp: 'x' }, 'a') }; });
    ok(sw.r && sw.btn && sw.again && !sw.mine, 'scanning another first code while at the telescope: “Follow it instead”', sw);
    await ev(A, () => { $('liveScanMsg').textContent = ''; closeSheet('liveSheet', true); });
    // the same role on both: the settings say so
    await ev(B, () => { cfg.liveRole = 'scope'; save(); liveHello(); renderLive(); }); await wait(A, 500);
    ok(await ev(A, () => /Both devices are set to/.test($('liveStatus').textContent)), 'both on the telescope: a warning to switch one');
    await ev(B, () => { cfg.liveRole = 'follow'; save(); liveHello(); renderLive(); }); await wait(A, 500);
    // ending on one side ends it on both (the ✕ in the pill asks first)
    await ev(A, () => $('liveChipOff').click()); await wait(A, 500); await ev(A, () => $('confirmOk').click()); await wait(B, 800);
    ok(await ev(B, () => live.state !== 'connected' && !liveVec() && $('liveChip').hidden), 'Disconnect ends it on both devices');
    await done(A); await done(B);
  },

  // live connection with the telescope's camera image: video over the same connection, overlay from the sent solution
  async livecam() {
    const A = await page({ perms: ['camera'] }), B = await page({ w: 1280, h: 800, mobile: false, perms: ['camera'] });
    await ev(A, () => { cfg.liveRole = 'scope'; cfg.liveVideo = false; save(); }); await ev(B, () => { cfg.liveRole = 'follow'; cfg.liveShowCam = true; save(); });
    const code = await ev(A, () => liveStart({ noScan: true }));
    const ans = await ev(B, c => liveJoin(c), code);
    await ev(A, async a => liveAnswer(await liveDecode(a)), ans);
    await A.waitForFunction(() => live.state === 'connected', null, { timeout: 15000 }).catch(() => {});
    await B.waitForFunction(() => live.state === 'connected' && live.peerVid, null, { timeout: 15000 }).catch(() => {});
    ok(await ev(A, () => live.peerVid && live.peerWants), 'the telescope side knows the other device can show and wants the camera image');
    // the camera runs on A, the setting is still off: nothing is sent
    await ev(A, async () => { await startCamera(); await new Promise(r => setTimeout(r, 600)); const vw = video.videoWidth, vh = video.videoHeight;
      st.sol = Object.assign({}, mapSol(), { w: vw, h: vh, cx: vw / 2, cy: vh / 2, f: vw * 1.2, approx: false }); st.solMode = 'solve'; st.solAt = Date.now(); cfg.tele = { x: 0.05, y: -0.03 }; });
    await wait(A, 600);
    ok(await ev(A, () => !!st.stream && !live.sender) && await ev(B, () => !live.peerCam && $('liveChipCam').hidden && st.solMode !== 'remote'), 'with “Send the camera image” off, no video goes out');
    ok(await ev(B, () => /isn’t coming/.test($('liveStatus').textContent)), 'the following side says why the image isn’t coming');
    // on: one renegotiation over the data channel, then the image and the overlay on B
    await ev(A, () => { $('liveVideoOn').click(); });
    await B.waitForFunction(() => st.solMode === 'remote' && !!st.sol, null, { timeout: 15000 }).catch(() => {}); await wait(B, 300);
    const r = await ev(B, () => { const v = $('liveCamIn'); return { vw: v.videoWidth, mode: st.solMode, tag: $('srcTag').textContent, chip: !$('liveChipCam').hidden && $('liveChipCam').classList.contains('on'), tv: teleVec(), tele: curTele() }; });
    ok(r.vw > 0 && r.mode === 'remote', 'the following side gets the camera image and shows it instead of the map', r.vw + ' ' + r.mode);
    ok(/camera/.test(r.tag) && r.chip, 'it says so, and the camera button in the pill is on', r.tag);
    const at = await ev(A, () => teleVec());
    const sep = r.tv && at ? await ev(B, ([a, b]) => Solver.angDeg(a, b), [r.tv, at]) : null;
    ok(sep != null && sep < 0.05, 'its crosshair is where the telescope’s camera has it (same solution, same eyepiece point)', { sep, tele: r.tele });
    const enc = await ev(A, () => { const p = live.sender.getParameters(); return p.encodings && p.encodings[0]; });
    ok(enc && enc.maxFramerate === 15 && enc.maxBitrate === 1500000, 'the video is limited (15 frames a second, 1.5 Mbit/s, about 540 lines)', enc);
    ok(await ev(A, () => /camera image is being sent/.test($('liveStatus').textContent)), 'the telescope side says it sends the image');
    // the map again: no frames are sent; back to the camera without a new negotiation
    await ev(B, () => $('liveChipCam').click()); await wait(A, 700);
    ok(await ev(B, () => st.solMode === 'map' && !cfg.liveShowCam) && await ev(A, () => !!live.sender && !live.sender.track), 'the map again: the telescope side stops sending frames');
    await ev(B, () => $('liveChipCam').click());
    await B.waitForFunction(() => st.solMode === 'remote', null, { timeout: 8000 }).catch(() => {});
    ok(await ev(B, () => st.solMode === 'remote') && await ev(A, () => !!live.sender.track), 'and the camera image again');
    // Show on map pauses it like the map; "follow again" brings the image back
    await ev(B, () => showOnMap(targetById('M13'))); await wait(B, 300);
    ok(await ev(B, () => live.paused && st.solMode === 'map' && !$('liveFollowChip').hidden), 'Show on map switches to the map and pauses following');
    await ev(B, () => $('liveFollowTxt').click()); await wait(B, 400);
    ok(await ev(B, () => !live.paused && st.solMode === 'remote'), '“Follow the telescope again” returns to the camera image');
    // the camera stops on A: B goes back to the map
    await ev(A, () => stopCamera()); await wait(B, 800);
    ok(await ev(B, () => st.solMode === 'map' && !live.peerCam && $('liveChipCam').hidden), 'the telescope’s camera stops: the map again');
    await ev(A, () => liveStop()); await wait(B, 600);
    ok(await ev(B, () => live.state !== 'connected' && !$('liveCamIn').srcObject), 'disconnecting ends the video too');
    await done(A); await done(B);
  },

  // the camera starts even when the browser refuses the first request (AbortError, as seen on an iPad)
  async camretry() {
    const p = await page({ perms: ['camera'] });
    const r = await ev(p, async () => {
      const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); let n = 0, asked = [];
      navigator.mediaDevices.getUserMedia = c => { asked.push(JSON.stringify(c.video)); if (n++ < 2) return Promise.reject(Object.assign(new Error('Starting videoinput failed'), { name: 'AbortError' })); return real(c); };
      cfg.camId = null; await startCamera(); await new Promise(r => setTimeout(r, 800));
      const ok = !!st.stream && st.source === 'video'; stopCamera(); navigator.mediaDevices.getUserMedia = real;
      return { ok, n, asked };
    });
    ok(r.ok && r.n === 3, 'after two refused requests the third, simpler one starts the camera', r);
    await done(p);
  },

  async categories() {
    const p = await page();
    await ev(p, () => { setOptics({ scope: 1200, ap: 203 }); cfg.searchCats = []; }); await p.waitForFunction(() => LISTS.ok && NGC.length > 1000, null, { timeout: 10000 });
    await ev(p, () => openSearch()); await wait(p, 400);
    const chips = await ev(p, () => [...document.querySelectorAll('#chips .chip')].map(b => b.textContent));
    ok(chips.includes('My telescope') && chips.includes('Good now') && chips.includes('Popular') && chips.includes('Herschel 400'), 'the chips are categories now', chips);
    const tap = async label => { await p.locator('#chips .chip', { hasText: label }).first().tap(); await wait(p, 300); };
    await tap('Popular'); const nPop = await ev(p, () => $('results').querySelectorAll('.rrow').length);
    ok(nPop > 40 && nPop <= 62, 'Popular lists the curated showpieces', nPop);
    await tap('My telescope'); await tap('Good now');
    const r = await ev(p, () => { const ids = [...$('results').querySelectorAll('.rrow b')].map(b => b.textContent);
      return { n: ids.length, bad: ids.filter(id => { const T = targetById(id); return !(LISTS.pop.has(T.id) && scopeFit(T).ok && nowFit(T).ok); }) }; });
    ok(r.n > 5 && r.bad.length === 0, 'Popular + My telescope + Good now: only objects that meet all three', r);
    await tap('Popular'); await tap('Galaxies');
    const g = await ev(p, () => [...$('results').querySelectorAll('.rrow b')].map(b => targetById(b.textContent)).every(T => catKind(T) === 'gal'));
    ok(g, 'a kind narrows them down to galaxies');
    ok(await ev(p, () => cfg.searchCats.join()) === 'scope,now,gal', 'the categories are remembered');
    await ev(p, () => { closeSheet('searchSheet'); showInfo(messierObj(MESSIER.find(r => r[0] === 'M27'))); }); await wait(p, 500);
    ok(await ev(p, () => !$('infoFit').hidden && /Popular · Messier/.test($('infoFit').textContent) && /Telescope/.test($('infoFit').textContent)), 'the details say why it suits you', await ev(p, () => $('infoFit').textContent));
    await done(p);
  },

  // setup assistant: opens on Locate before the setup is done, switches things on, walks to the eyepiece point
  async assistant() {
    const p = await page({ perms: ['camera'] });
    await ev(p, () => { cfg.fov.video = 66; delete cfg.teleSetAt; cfg.tele = { x: 0, y: 0 }; save(); });
    await p.tap('#btnSolve'); await wait(p, 300);
    ok(await ev(p, () => !$('wiz').hidden && /Phone on the telescope/.test($('wizTitle').textContent)), 'Locate before the setup opens the assistant');
    ok(await ev(p, () => !st.busy), 'it doesn’t start locating by itself');
    await p.locator('#wizBtns .btn.primary').tap(); await wait(p, 300);
    ok(await ev(p, () => /Sensors and camera/.test($('wizTitle').textContent)), 'next: sensors and camera');
    await p.locator('#wizBtns .btn.primary').tap(); await wait(p, 2500);
    ok(await ev(p, () => st.sensor && !!st.stream && /Centre a bright star/.test($('wizTitle').textContent)), 'it turns on Align and the camera, then asks for a bright star', await ev(p, () => [st.sensor, !!st.stream, $('wizTitle').textContent]));
    ok(await ev(p, () => !!wiz.star && $('wizBody').textContent.includes(wiz.star.name)), 'it suggests a bright star by name', await ev(p, () => $('wizBody').textContent));
    await ev(p, () => closeSheet('permSheet')); await wait(p, 400);   // headless Chromium has no motion sensors
    // the fake camera shows no stars: not located, with a way on
    await p.locator('#wizBtns .btn.primary').tap(); await p.waitForFunction(() => wiz.step === 'fail' || wiz.step === 'tap', null, { timeout: 30000 }).catch(() => {});
    ok(await ev(p, () => wiz.step === 'fail' && /Not located/.test($('wizTitle').textContent)), 'without stars it says so and offers a night photo', await ev(p, () => wiz.step));
    // as if the star was tapped: on to the check, then done, then the search
    await ev(p, () => { wiz.step = 'tap'; cfg.teleSetAt = Date.now(); wizTele(wiz.star.name); }); await wait(p, 200);
    ok(await ev(p, () => wiz.step === 'check' && /Check it/.test($('wizTitle').textContent) && wiz.star2 && wiz.star2.name !== wiz.star.name), 'after the eyepiece point: a check on a second star');
    await p.locator('#wizBtns .lnk').tap(); await wait(p, 200);
    ok(await ev(p, () => wiz.step === 'done'), 'the check can be skipped');
    await p.locator('#wizBtns .btn.primary').tap(); await wait(p, 500);
    ok(await ev(p, () => $('wiz').hidden && !$('searchSheet').hidden), '“Choose a target” closes it and opens the search');
    ok(await ev(p, () => !wizNeeded()), 'set up: Locate locates directly again');
    await ev(p, () => stopCamera()); await done(p);
  },

  // a fuller screen: messages close with ✕, the pills bottom left hide behind a tab at the edge
  async declutter() {
    const p = await page();
    await ev(p, () => hint('Test message', 20000)); await wait(p, 200);
    await p.tap('#hint .hx'); await wait(p, 200);
    ok(await ev(p, () => $('hint').hidden), 'a message closes with its ✕');
    await ev(p, () => { cfg.infoHints = false; hint('Filter off: the map shows everything again.', 5000); }); await wait(p, 100);
    ok(await ev(p, () => $('hint').hidden), 'with info messages off, a confirmation isn’t shown');
    await ev(p, () => hint('No camera found. Check that a camera is connected.', 5000)); await wait(p, 100);
    ok(await ev(p, () => !$('hint').hidden), '… but a warning still is');
    await ev(p, () => { hint(null); cfg.infoHints = true; });
    await ev(p, () => { cfg.target = 'M45'; updateGuide(); }); await p.tap('#cornerHide'); await wait(p, 400);
    ok(await ev(p, () => $('corner').classList.contains('away') && !$('cornerTab').hidden && $('cornerTab').classList.contains('tgt')), 'the pills hide, a tab with a target dot stays at the edge');
    ok(await ev(p, () => cfg.cornerAway === true), 'hidden pills are remembered');
    await p.tap('#cornerTab'); await wait(p, 400);
    ok(await ev(p, () => !$('corner').classList.contains('away') && $('cornerTab').hidden), 'the tab brings them back');
    await done(p);
  },

  // where the telescope points: shown without a target, and with one after a tap on the boxes
  async pointing() {
    const p = await page();
    const set = () => ev(p, () => { const v = $('view'); st.mapView = { az: 0, alt: 0, fov: 50 }; st.sol = mapSolCompute(skyNow().M, v.width, v.height, { az: 135, alt: 30, fov: 50 }); st.sensor = true; st.solMode = 'compass'; cfg.tele = { x: 0, y: 0 }; });
    await ev(p, () => { cfg.target = null; cfg.hudAbs = false; }); await set(); await ev(p, () => updateGuide()); await wait(p, 200);
    const a = await ev(p, () => [!$('guide').classList.contains('idle'), $('azV').textContent, $('azW').textContent, $('altV').textContent]);
    ok(a[0] && /^135\.0°$/.test(a[1]) && /SE/.test(a[2]) && /^30\.0°$/.test(a[3]), 'without a target the boxes show where the telescope points', a);
    await ev(p, () => { cfg.target = 'M31'; }); await set(); await ev(p, () => updateGuide()); await wait(p, 200);
    ok(await ev(p, () => /turn|azimuth on/.test($('azW').textContent)), 'with a target: the way to it');
    await p.tap('#guide .hcell'); await set(); await ev(p, () => updateGuide()); await wait(p, 200);
    ok(await ev(p, () => cfg.hudAbs && /^135\.0°$/.test($('azV').textContent) && $('guide').classList.contains('abs')), 'a tap switches to where the telescope points', await ev(p, () => $('azV').textContent));
    await p.tap('#guide .hcell'); await set(); await ev(p, () => updateGuide()); await wait(p, 200);
    ok(await ev(p, () => !cfg.hudAbs && /turn|on target/.test($('azW').textContent)), 'another tap switches back');
    await ev(p, () => { st.sensor = false; }); await done(p);
  },

  // details opened from Tonight go back to Tonight
  async tonightBack() {
    const p = await page();
    await ev(p, () => { showTonight(); openSheet('tonightSheet'); }); await wait(p, 900);
    const rows = await ev(p, () => document.querySelectorAll('#tonightSheet .tn-row').length);
    ok(rows > 0, 'Tonight lists objects', rows);
    await ev(p, () => { const r = [...document.querySelectorAll('#tonightSheet .tn-row')].find(b => b.onclick); r.scrollIntoView(); r.click(); }); await wait(p, 700);
    ok(await ev(p, () => !$('infoSheet').hidden && !$('infoBack').hidden && /Tonight/.test($('infoBack').getAttribute('aria-label'))), 'the details show a back button to Tonight');
    await p.tap('#infoBack'); await wait(p, 700);
    ok(await ev(p, () => !$('tonightSheet').hidden && $('tonightSheet').classList.contains('open') && $('infoSheet').hidden), 'back returns to Tonight', await openSheets(p));
    await done(p);
  },

  // names on the map can be tapped: they open the object they belong to
  // constellation figures: on at first, pinned to their anchor stars, off stays off
  async figures() {
    const p = await page({ w: 1000, h: 700, mobile: false });
    await ev(p, () => { st.mapView = { az: 150, alt: 40, fov: 90 }; st.sol = mapSol(); lastSig = []; });
    await p.waitForFunction(() => FIG.list && FIG.drawn > 0, null, { timeout: 10000 }).catch(() => {});
    const r = await ev(p, () => ({ on: figOn(), n: FIG.list && FIG.list.length, drawn: FIG.drawn, opt: $('optFigures').checked,
      err: FIG.list ? Math.max(...FIG.list.flatMap(f => f.a.map(([x, y, ra, dec]) => Solver.angDeg(f.sky(x, y), Solver.radec2v(ra, dec))))) : null }));
    ok(r.on && r.opt && r.n >= 80, 'constellation figures are on at first', r);
    ok(r.drawn > 3, 'the figures in view are drawn', r.drawn);
    ok(r.err != null && r.err < 0.001, 'each figure sits on its three anchor stars', r.err);
    await ev(p, () => { $('optFigures').click(); }); await wait(p, 300);
    ok(await ev(p, () => cfg.figures === false && FIG.drawn === 0), 'switched off: no figures');
    await p.reload(); await p.waitForFunction(() => !document.getElementById('splash') && typeof st !== 'undefined' && !!st.sol, null, { timeout: 15000 });
    ok(await ev(p, () => !figOn() && (syncSettings(), !$('optFigures').checked) && (syncQuick(), !$('qFigures').checked)), 'and they stay off after a restart');
    await done(p);
  },

  async labels() {
    const p = await page({ w: 1000, h: 700, mobile: false });
    await wait(p, 600);
    const h = await ev(p, () => { const W = view.width; const ok = labelHits.filter(q => q.r[2] - q.r[0] > 40 && q.r[0] > 80 && q.r[2] < W - 300 && q.r[1] > 120);
      const q = ok.find(q => Math.hypot((q.r[0] + q.r[2]) / 2 - q.at[0], (q.r[1] + q.r[3]) / 2 - q.at[1]) > 25) || ok[0]; if (!q) return null;
      const want = pickNear(q.at[0], q.at[1], 3).make().name, dpr = view.width / view.clientWidth;
      return { x: ((q.r[0] + q.r[2]) / 2 + Math.min(10, (q.r[2] - q.r[0]) / 4)) / dpr, y: (q.r[1] + q.r[3]) / 2 / dpr, want }; });
    ok(!!h, 'the map has names to tap');
    if (h) {
      const box = await p.locator('#view').boundingBox(); await p.mouse.click(box.x + h.x, box.y + h.y); await wait(p, 600);
      const title = await ev(p, () => $('infoSheet').hidden ? '' : $('infoTitle').textContent);
      ok(title.includes(h.want), 'tapping a name opens its object', [title, h.want]);
    }
    await done(p);
  },

  // sync between devices: set up, add a second device, changes both ways, deletions, versions, delete from the server
  // photo mode: a gallery photo (synthetic: the catalogue sky around Andromeda and Cassiopeia, 50° × 64°) with EXIF
  // time and place; labels, the list, logging, the copy to save; without EXIF it asks for the time
  async photo() {
    const { withExif } = require('./exif.cjs');
    const raw = fs.readFileSync(path.join(__dirname, 'fixtures', 'sky-andromeda.jpg'));
    const p = await page();
    await ev(p, () => { st.wizSkip = true; obs.log = []; obs.starred = []; saveObs(); });
    await p.tap('#btnMenu'); await wait(p, 500);
    const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.tap('#btnPhoto')]);
    await chooser.setFiles({ name: 'IMG_2041.jpg', mimeType: 'image/jpeg', buffer: withExif(raw, { date: '2026:10:21 22:14:00', offset: '+02:00', lat: 48.18, lon: 10.08, f35: 26 }) });
    await p.waitForFunction(() => ph.on && !st.busy, null, { timeout: 90000 }); await wait(p, 600);
    ok(await ev(p, () => !!st.photoSol && document.querySelector('.app').classList.contains('photo-mode')), 'Label a night photo: the photo is solved and shown in photo mode', await ev(p, () => $('statusText').textContent));
    ok(await ev(p, () => $('fabs').offsetParent === null && $('btnMenu').offsetParent === null && !$('phBar').hidden), 'the map’s buttons step aside for the photo’s bar and tools');
    ok(await ev(p, () => skyDate().toISOString().slice(0, 16) === '2026-10-21T20:14' && ph.exact && ph.loc && Math.abs(ph.loc.lat - 48.18) < 0.01), 'time (with its time zone) and place come from the EXIF data', await ev(p, () => skyDate().toISOString()));
    ok(await ev(p, () => /Andromeda/.test($('phTitle').textContent) && /21 Oct 2026|Oct 21, 2026/.test($('phWhen').textContent) && /from the photo/.test($('phTime').textContent)), 'the bar names the photo and when it was taken', await ev(p, () => [$('phTitle').textContent, $('phWhen').textContent, $('phTime').textContent]));
    const O = await ev(p, () => { const O = phObjs(); return { dso: O.dso.filter(d => d.lvl <= 2).map(d => d.id), stars: O.stars.map(s => s.name), cons: O.cons.map(c => c.name), m31: O.dso.find(d => d.id === 'M31').ell }; });
    ok(['M31', 'M33', 'M34', 'M52', 'M103'].every(id => O.dso.includes(id)) && !O.dso.some(id => /^(VdB|LDN|Ced) /.test(id)), 'the brighter Messier objects are labelled, minor catalogues only with more labels', O.dso);
    ok(['Mirfak', 'Algol', 'Almach', 'Mirach'].every(n => O.stars.includes(n)) && ['Andromeda', 'Cassiopeia', 'Perseus', 'Triangulum'].every(n => O.cons.includes(n)), 'named stars and the constellations in it are found');
    ok(O.m31 && O.m31.a > O.m31.b * 2, 'M31 is outlined as a long ellipse (its shape from OpenNGC)', O.m31);
    // a tap on a label opens its details
    const m31 = await ev(p, () => { const q = phObjs().dso.find(d => d.id === 'M31'), [x, y] = P(q.x, q.y), d = fit.dpr; return { x: x / d, y: y / d }; });
    await ev(p, m => { const r = view.getBoundingClientRect(); handleTap({ clientX: r.left + m.x, clientY: r.top + m.y }); }, m31); await wait(p, 600);   // (the test clock stands still: a real tap would count as a double tap)
    ok(await ev(p, () => !$('infoSheet').hidden && st.picked && st.picked.id === 'M31'), 'tapping M31 on the photo opens its details');
    await ev(p, () => closeSheet('infoSheet')); await wait(p, 500);
    // layers: fewer labels, the Atlas style
    await p.tap('#phLayers'); await wait(p, 500);
    const n2 = await ev(p, () => phObjs().labelled);
    await ev(p, () => { $('phLevel').value = 1; $('phLevel').oninput(); });
    ok(await ev(p, n => phObjs().labelled < n && /of/.test($('phLevelTxt').textContent), n2), 'the amount slider shows fewer labels');
    await p.tap('[data-phstyle="atlas"]'); await wait(p, 300);
    ok(await ev(p, () => cfg.photo.figures && cfg.photo.grid && $('[data-phstyle="atlas"]') === null || document.querySelector('[data-phstyle="atlas"]').getAttribute('aria-checked') === 'true'), 'Atlas turns on figures and the grid');
    await ev(p, () => { Object.assign(cfg.photo, PH_STYLES.labelled, { style: 'labelled', level: 2 }); phChanged(); closeSheet('phLayersSheet'); }); await wait(p, 500);
    // the list, logging with the photo's date
    await p.tap('#phInPhoto'); await wait(p, 600);
    ok(await ev(p, () => $('phList').querySelectorAll('button canvas').length >= 5 && /Deep sky/.test($('phTabs').textContent)), 'In this photo lists the objects with cut-outs of the photo');
    await p.tap('#phLogAll'); await wait(p, 300);
    ok(await ev(p, () => obs.log.length >= 5 && obs.log.every(e => e.t.startsWith('2026-10-21T20:14') && e.ep === 'Photo')), 'Log as seen logs them for the night of the photo', await ev(p, () => obs.log.slice(0, 2)));
    await ev(p, () => closeSheet('phListSheet')); await wait(p, 500);
    // the copy: labelled, with a caption, no GPS
    const out = await ev(p, async () => { cfg.photo.size = 'post'; const b = await phBlob(); const u = new Uint8Array(await b.arrayBuffer()); const im = await createImageBitmap(b); return { type: b.type, w: im.width, h: im.height, gps: readExif(u.buffer) }; });
    ok(out.type === 'image/jpeg' && Math.max(out.w, out.h) >= 1080 && out.h > out.w * 1.34 && !out.gps, 'the saved copy is a JPEG with the caption below and without EXIF/GPS', out);
    // leaving: the time comes back
    await p.tap('#phBack'); await wait(p, 500);
    ok(await ev(p, () => !ph.on && st.tOff === 0 && st.source === 'map' && $('fabs').offsetParent !== null), 'back closes the photo; the map is at the current time again');
    // a photo without EXIF: asks for the time, planets wait for it
    await ev(p, async b64 => { const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); await loadPhoto(new File([bin], 'sky.jpg', { type: 'image/jpeg' }), false); }, raw.toString('base64'));
    await p.waitForFunction(() => ph.on && !st.busy, null, { timeout: 90000 }); await wait(p, 300);
    ok(await ev(p, () => !!st.photoSol && $('phTime').classList.contains('ask') && st.tOff === 0), 'without EXIF the time chip asks when it was taken');
    await ev(p, () => { cfg.photo.caption = true; cfg.photo.place = true; syncPhShare(); });
    ok(await ev(p, () => !$('phPlace').disabled && $('phPlace').checked && /your location in Zenigo/.test($('phPlaceNote').textContent)), 'a photo without a place: the caption can show the location set in Zenigo', await ev(p, () => $('phPlaceNote').textContent));
    if (process.env.SHOTS) { await ev(p, () => openSheet('phShareSheet')); await wait(p, 900); await p.screenshot({ path: path.join(process.env.SHOTS, 'photo-share.png') }); await ev(p, () => closeSheet('phShareSheet')); await wait(p, 400);
      const png = await ev(p, async () => { const cv = await photoRender('post'), c = document.createElement('canvas'); c.width = 420; c.height = 200; c.getContext('2d').drawImage(cv, cv.width - 420, cv.height - 200, 420, 200, 0, 0, 420, 200); return c.toDataURL(); });
      fs.writeFileSync(path.join(process.env.SHOTS, 'caption.png'), Buffer.from(png.split(',')[1], 'base64'));
      await ev(p, () => { SHEETS.forEach(x => closeSheet(x.id)); $('updateBar').hidden = false; }); await wait(p, 600); await p.screenshot({ path: path.join(process.env.SHOTS, 'update.png'), clip: { x: 0, y: 0, width: 390, height: 160 } }); await ev(p, () => { $('updateBar').hidden = true; }); }
    await ev(p, () => { obs.log = []; saveObs(); }); await p.tap('#phInPhoto'); await wait(p, 500); await p.tap('#phLogAll'); await wait(p, 500);
    ok(await ev(p, () => obs.log.length === 0 && !$('timeSheet').hidden), 'logging asks for the time first');
    await done(p);
  },

  async sync() {
    const A = await page(), B = await page({ w: 1280, h: 800, mobile: false });
    // device A: a planned object, a logbook entry, its own telescope; then "Set up sync"
    await ev(A, () => { obs.list.push({ id: 'M13', name: 'M13', added: Date.now() }); obs.log.push({ uid: 'a1', obj: 'M31', name: 'Andromeda Galaxy', t: '2026-10-19T20:00:00.000Z', result: 'easy', note: 'dust lane seen', ep: '25 mm' }); saveObs(); setOptics({ scope: 1000 }); cfg.tele = { x: 0.05, y: 0.02 }; save(); });
    // the menu entry: not set up yet, it opens the Sync tab of the settings
    await ev(A, () => { SHEETS.forEach(x => closeSheet(x.id)); syncSettings(); openSheet('menu'); }); await wait(A, 600);
    ok(await ev(A, () => !$('btnSync').hidden && $('syncState').textContent === 'set up'), 'the menu offers sync when the server does');
    await A.tap('#btnSync'); await wait(A, 700);
    ok(await ev(A, () => !$('sheet').hidden && cfg.setTab === 'sync' && !$('setTabSync').hidden && !$('syncOff').hidden), 'it opens the Sync tab of the settings');
    await A.tap('#syncSetup'); await wait(A, 1200);
    const code = await ev(A, () => syncS.code);
    ok(/^[A-Za-z0-9_-]{43}$/.test(code || ''), 'a sync code is made on the device');
    ok(await ev(A, () => !$('syncSheet').hidden && !$('syncShowBox').hidden && $('syncQr').width > 100), 'the QR code to add a device is shown');
    // the QR code holds the join link: read it back with the app's own reader
    const qr = await ev(A, async () => { await loadJsQR(); const c = $('syncQr'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height); const big = document.createElement('canvas'); big.width = big.height = c.width + 80; const x = big.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, big.width, big.height); x.putImageData(d, 40, 40); const im = x.getImageData(0, 0, big.width, big.height); const r = jsQR(im.data, im.width, im.height); return r && r.data; });
    ok(qr === base + '/app/#join=' + code, 'the QR code reads back as the join link', qr);
    // the code can be saved: as a text file with link and code, and as a picture of the QR code
    let dlp = A.waitForEvent('download'); await A.tap('#syncSaveTxt'); let dlf = await dlp;
    const txt = fs.readFileSync(await dlf.path(), 'utf8');
    ok(/\.txt$/.test(dlf.suggestedFilename()) && txt.includes('#join=' + code) && txt.includes('Code: ' + code), 'Save as text: link and code in a text file');
    dlp = A.waitForEvent('download'); await A.tap('#syncSaveImg'); dlf = await dlp;
    const png = fs.readFileSync(await dlf.path());
    ok(/\.png$/.test(dlf.suggestedFilename()) && png.slice(1, 4).toString() === 'PNG' && png.length > 5000, 'Save as image: a PNG of the QR code', png.length);
    ok(syncStore.size === 1, 'one group on the server');
    const blob = [...syncStore.values()][0].blob.toString('latin1');
    ok(!/M31|dust lane|Andromeda|1000/.test(blob), 'the server stores nothing readable');
    // device B joins with the link (as from the camera app); it has its own entry and other telescope settings
    await ev(B, () => { obs.log.push({ uid: 'b1', obj: 'M57', name: 'Ring Nebula', t: '2026-10-19T21:00:00.000Z', result: 'easy', note: '', ep: '10 mm' }); saveObs(); setOptics({ scope: 1500 }); cfg.tele = { x: -0.03, y: 0 }; save(); });
    await B.goto('about:blank'); await B.goto(base + '/app/#join=' + code); await B.waitForFunction(() => !document.getElementById('splash') && typeof st !== 'undefined' && !!st.sol, null, { timeout: 15000 });
    ok(!(await B.evaluate(() => location.hash)), 'the code is taken out of the address at once');
    await B.waitForFunction(() => !$('confirmSheet').hidden, null, { timeout: 5000 }).catch(() => {});
    ok(await ev(B, () => $('confirmTitleTxt').textContent.includes('Join')), 'joining asks first');
    await B.click('#confirmOk'); await wait(B, 900);
    ok(await ev(B, () => $('confirmTitleTxt').textContent.includes('settings') && !$('confirmSheet').hidden), 'different telescope settings: it asks which ones to use');
    await B.click('#confirmOk'); await wait(B, 1200);
    const b = await ev(B, () => ({ code: syncS.code, log: obs.log.map(e => e.uid).sort(), list: obs.list.map(x => x.id), scope: opt().scope, tele: cfg.tele, devs: Object.values(syncS.devs || {}).length }));
    ok(b.code === code, 'B is in the group');
    ok(b.log.join() === 'a1,b1' && b.list.join() === 'M13', 'lists and logbook of both devices are combined', b);
    ok(b.scope === 1000 && b.tele.x === -0.03, 'B took the group’s telescope; its eyepiece point stays its own', b);
    ok(b.devs === 2, 'the group knows both devices', b.devs);
    // a change on B arrives on A; a deletion on A arrives on B
    await ev(B, () => { const e = obs.log.find(x => x.uid === 'a1'); e.note = 'edited on the desktop'; saveObs(); return syncNow(); });
    await ev(A, () => syncNow());
    const a = await ev(A, () => ({ note: (obs.log.find(x => x.uid === 'a1') || {}).note, n: obs.log.length, scope: opt().scope, tele: cfg.tele }));
    ok(a.note === 'edited on the desktop' && a.n === 2, 'a change made on B shows on A', a);
    ok(a.tele.x === 0.05, 'A keeps its own eyepiece point', a.tele);
    await ev(A, () => { obs.list = []; saveObs(); setOptics({ scope: 1200 }); return syncNow(); });
    await ev(B, () => syncNow());
    ok(await ev(B, () => obs.list.length === 0 && opt().scope === 1200), 'a deletion and a new focal length on A arrive on B');
    // both devices change the same entry and the eyepieces before syncing: both changes survive on both
    await ev(A, () => { const e = obs.log.find(x => x.uid === 'b1'); e.note = 'faint ring'; saveObs(); setOptics({ eps: [...opt().eps, { f: 6, a: 60 }] }); });
    await ev(B, () => { const e = obs.log.find(x => x.uid === 'b1'); e.seeing = 4; saveObs(); setOptics({ eps: [...opt().eps, { f: 32, a: 50 }] }); });
    await ev(A, () => syncNow()); await ev(B, () => syncNow()); await ev(A, () => syncNow());
    const both = await Promise.all([A, B].map(p => ev(p, () => ({ e: obs.log.find(x => x.uid === 'b1'), eps: opt().eps.map(x => x.f).sort((a, b) => a - b).join() }))));
    ok(both.every(x => x.e.note === 'faint ring' && x.e.seeing === 4), 'an entry edited on both devices keeps both edits', both.map(x => x.e));
    ok(both.every(x => x.eps === both[0].eps) && both[0].eps.includes('6') && both[0].eps.includes('32'), 'eyepieces added on each device: both on both', both.map(x => x.eps));
    // the settings show the group
    await ev(A, () => { SHEETS.forEach(x => closeSheet(x.id)); syncSettings(); openSheet('sheet'); setSetTab('sync'); }); await wait(A, 400);
    ok(await ev(A, () => !$('syncOn').hidden && /Synced/.test($('syncStatus').textContent) && $('syncDevs').children.length === 2), 'the settings show the status and both devices');
    // set up: the menu entry syncs at once and says when it last did
    await ev(A, () => { SHEETS.forEach(x => closeSheet(x.id)); syncSettings(); openSheet('menu'); }); await wait(A, 600);
    const v0 = [...syncStore.values()][0].version; await ev(B, () => { obs.starred.push({ id: 'M101', name: 'M101', added: Date.now() }); saveObs(); return syncNow(); });
    await A.tap('#btnSync'); await wait(A, 900);
    ok(await ev(A, () => $('menu').classList.contains('open') && obs.starred.some(x => x.id === 'M101') && /^synced/.test($('syncState').textContent)), 'the menu entry syncs at once, the menu stays open', v0);
    await ev(A, () => { closeSheet('menu'); syncSettings(); openSheet('sheet'); setSetTab('sync'); }); await wait(A, 400);
    // an old backup (version 1) can still be restored, and its entries reach the group
    await ev(A, () => { obs.log = obs.log.filter(e => e.uid !== 'mgx1a2b3'); saveObs(true); });
    await ev(A, () => setSetTab('general')); await wait(A, 300);
    await A.setInputFiles('#bkFile', path.join(__dirname, 'fixtures', 'backup-v1.json')); await wait(A, 700);
    ok(await ev(A, () => obs.log.some(e => e.uid === 'mgx1a2b3') && obs.list.some(x => x.id === 'M13')), 'a version 1 backup is restored');
    await ev(A, () => syncNow()); await ev(B, () => syncNow());
    ok(await ev(B, () => obs.log.some(e => e.uid === 'mgx1a2b3')), 'restored entries reach the other device');
    // a backup made now has the old shape plus change times (older app versions can import it)
    const dl = A.waitForEvent('download'); await A.tap('#bkAll'); const f = await (await dl).path(); const bk = JSON.parse(fs.readFileSync(f, 'utf8'));
    ok(bk.version === 4 && Array.isArray(bk.log) && Array.isArray(bk.list) && Array.isArray(bk.starred) && typeof bk.settings === 'object' && bk.log.every(e => e.u > 0 || e.uid === 'mgx1a2b3'), 'backup version 4 keeps the shape of version 3', bk.version);
    // another device with a newer app (major version 2) wrote the group: this app stops writing instead of breaking it
    const before = [...syncStore.values()][0].version;
    await ev(B, async () => { const k = await syncKeys(); const g = await syncGet(k); const d = { ...g.data, schema: { major: 2, minor: 0 } }; await syncPut(k, g.ver, d); });
    const v2 = [...syncStore.values()][0].version;
    await ev(A, () => { obs.list.push({ id: 'M27', name: 'M27', added: Date.now() }); saveObs(); return syncNow(); });
    ok(await ev(A, () => syncS.err === 'newer'), 'data from a newer major version: A reports it and stops');
    ok([...syncStore.values()][0].version === v2 && v2 === before + 1, 'and doesn’t overwrite it');
    // delete from the server: every device stops syncing, their data stays
    await ev(B, async () => { const k = await syncKeys(); const g = await syncGet(k); await syncPut(k, g.ver, { ...g.data, schema: { major: 1, minor: 0 } }); });
    await ev(A, () => { SHEETS.forEach(x => closeSheet(x.id)); syncSettings(); openSheet('sheet'); setSetTab('sync'); }); await wait(A, 400);
    await ev(A, () => { $('syncBox').querySelector('details').open = true; }); await A.tap('#syncDelete'); await wait(A, 200); await A.tap('#syncDelete'); await wait(A, 800);
    ok(syncStore.size === 0 && await ev(A, () => !syncS.code && obs.log.length >= 2), 'Delete removes the group from the server; the lists stay');
    await ev(B, () => syncNow());
    ok(await ev(B, () => !syncS.code && obs.log.length >= 2 && /Sync stopped/.test($('hint').textContent)), 'the other device notices, stops syncing and says so');
    await done(A); await done(B);
  },

  // Observing programmes: progress from the logbook, Messier free and the others with Pro, tonight's order, planning,
  // progress after a first sighting, back from the details, the programme logbook as CSV
  async programs() {
    const p = await page({ pro: false });
    await ev(p, () => { const t = new Date(Date.now() - 86400e3 * 3).toISOString();
      obs.log.push({ uid: 'p1', obj: 'M13', name: 'M13', t, result: 'easy', ep: '25 mm', lat: 48.2, lon: 10.1 }, { uid: 'p2', obj: 'M31', name: 'M31', t, result: 'hard' }, { uid: 'p3', obj: 'M57', name: 'M57', t, result: 'miss' }); saveObs(); });
    await ev(p, () => openProgs(null)); await wait(p, 300);
    const cards = await ev(p, () => [...document.querySelectorAll('.pgcard')].map(c => ({ name: c.querySelector('b').textContent, n: c.querySelector('.pgn').textContent, pro: !!c.querySelector('.protag') })));
    ok(cards.length === 6 && cards[0].name === 'Messier' && /^2 \/ 110/.test(cards[0].n) && !cards[0].pro && cards.slice(1).every(c => c.pro), 'overview: Messier 2 of 110 (a “Not found” doesn’t count), the others marked Pro', cards);
    ok(cards[1].name.startsWith('Binocular Messier') && /^0 \/ 50/.test(cards[1].n) && /^\d+ \/ 108/.test(cards[2].n) && /^0 \/ 400/.test(cards[4].n), 'Binocular Messier: 0 of 50 (telescope entries don’t count); Caldwell 108 (without the Coalsack); Herschel II 400', cards);
    await ev(p, () => openProgs('caldwell')); await wait(p, 300);
    ok(await ev(p, () => !$('proSheet').hidden && /Caldwell is an observing programme of Zenigo Pro/.test($('proWhy').textContent)), 'Caldwell without Pro: the Pro sheet');
    await ev(p, () => { closeSheet('proSheet'); openProgs('messier'); }); await wait(p, 400);
    ok(await ev(p, () => /2 of 110 seen/.test($('progBody').textContent) && /Open · 108/.test($('progBody').textContent) && document.querySelectorAll('#progBody .orow').length === 108), 'Messier: the open ones listed (108)');
    ok(await ev(p, () => { const r = [...document.querySelectorAll('#progBody .orow')]; const i = r.findIndex(x => x.classList.contains('later')); return i > 0 && r.slice(0, i).every(x => !x.classList.contains('later')); }), 'well placed tonight first, the later ones after');
    const before = await ev(p, () => obs.list.length);
    await ev(p, () => [...document.querySelectorAll('#progBody .pgacts .btn')].find(b => /well placed tonight/.test(b.textContent)).click()); await wait(p, 300);
    const planned = await ev(p, () => obs.list.length);
    ok(planned > before && planned - before <= 15, 'one tap plans the well placed ones (at most 15)', [before, planned]);
    // details from the programme and back
    await ev(p, () => document.querySelector('#progBody .orow .omain').click()); await wait(p, 400);
    ok(await ev(p, () => !$('infoSheet').hidden && $('infoBack').getAttribute('aria-label') === 'Back to the programme'), 'a row opens the details, with a way back');
    await p.click('#infoBack'); await wait(p, 400);
    ok(await ev(p, () => !$('progSheet').hidden && $('progTitleTxt').textContent === 'Messier'), 'back to the programme');
    // a first sighting: the progress in the hint
    await ev(p, () => { openSeen(objById('M27')); seenState.res = 'easy'; }); await wait(p, 300); await ev(p, () => $('seenSave').click()); await wait(p, 300);
    ok(await ev(p, () => /Messier: 3 of 110/.test($('hint').textContent)), 'after a first sighting: “Messier: 3 of 110”', await ev(p, () => $('hint').textContent));
    ok(await ev(p, () => { const e = obs.log.find(x => x.obj === 'M27'); return e.inst === curInst().name && e.ik === 'scope' && e.ep; }), 'the entry keeps the instrument (the one in use) and the eyepiece', await ev(p, () => obs.log.find(x => x.obj === 'M27')));
    // with binoculars: the eyepiece field goes, the entry says so
    await ev(p, () => { openSeen(objById('M45')); seenState.res = 'easy'; $('seenInst').value = 'Binoculars'; $('seenInst').onchange(); }); await wait(p, 200);
    ok(await ev(p, () => $('seenEpL').hidden), 'binoculars: no eyepiece to choose');
    await ev(p, () => $('seenSave').click()); await wait(p, 300);
    ok(await ev(p, () => { const e = obs.log.find(x => x.obj === 'M45'); return e.inst === 'Binoculars' && e.ep === '' && instKind(e) === 'bino' && progStats(PROGRAMS[1]).done === 1; }), 'logged with binoculars: counts for Binocular Messier');
    // the programme logbook
    await ev(p, () => { progState.tab = 'seen'; openProgs('messier'); progState.tab = 'seen'; renderProgs(); }); await wait(p, 300);
    ok(await ev(p, () => document.querySelectorAll('#progBody .orow').length === 4), 'seen: four objects');
    const dl = p.waitForEvent('download'); await ev(p, () => [...document.querySelectorAll('#progBody .pgacts .btn')].find(b => /CSV/.test(b.textContent)).click());
    const csv = fs.readFileSync(await (await dl).path(), 'utf8');
    ok(/^\ufeff?Object,Name,Type,Date,Time,"Place \(lat, lon\)",Instrument,Eyepiece/.test(csv) && /M13,.*25 mm/.test(csv) && /M27,.*My telescope/.test(csv) && /M45,.*Binoculars/.test(csv) && !/M57/.test(csv) && csv.split('\r\n').length === 5, 'CSV: one row per seen object with its first sighting and instrument', csv.slice(0, 400));
    await done(p);
    // with Pro: Herschel II opens; objects only the extended catalogue has are marked
    const q = await page();
    await ev(q, () => openProgs('h2')); await wait(q, 600);
    ok(await ev(q, () => $('proSheet').hidden && /0 of 400 seen/.test($('progBody').textContent) && /objects of this programme come with the extended catalogue/.test($('progBody').textContent)
      && /in the extended catalogue/.test($('progBody').textContent)), 'Herschel II with Pro, without the extended catalogue: says so');
    await ev(q, () => openProgs('caldwell')); await wait(q, 400);
    ok(await ev(q, () => /^C\d+ · /.test(document.querySelector('#progBody .orow b').textContent)), 'Caldwell rows carry their number (C…)');
    await done(q);
  },

  // Extended catalogue (Pro): downloaded right after Pro is there, merged into the map, search and eyepiece view,
  // kept in its own cache, put away when Pro ends, removable
  async extcat() {
    extOn = true;
    const p = await page();
    await p.waitForFunction(() => ext.loaded, null, { timeout: 30000 }).catch(() => {});
    const info = await ev(p, () => ({ loaded: ext.loaded, n: DEEP.n, base: DEEP_BASE.n, ngc: NGC.filter(o => o.ext).length, EXT, t: !!targetById('NGC 1499') }));
    ok(info.loaded && info.ngc === info.EXT.nDso && info.n === info.base + info.EXT.nStars, 'downloaded and merged: all objects and stars', info);
    ok(info.t, 'an object of the extended catalogue can be found (NGC 1499)');
    ok(await ev(p, () => { for (let i = 1; i < DEEP.n; i++) if (DEEP.m[i] < DEEP.m[i - 1]) return false; return DEEP.m[DEEP.n - 1] <= 11.01; }), 'the stars stay sorted by brightness, down to 11 mag');
    ok(await ev(p, async () => { const c = await caches.open('zenigo-ext'); return (await c.keys()).length === 2; }), 'kept in its own cache (two files)');
    ok(await ev(p, () => { syncFilter(); return /to 11 mag/.test($('magV').textContent); }), 'the filter says “all (to 11 mag …)”');
    // zoomed in on a field: the map draws stars fainter than 9 mag
    ok(await ev(p, () => { let k = 0; deepNear(targetById('NGC 1499').vec(), 1, 11, i => { if (DEEP.m[i] > 9) k++; }); return k > 5; }), 'faint stars around a target, from the extended catalogue');
    ok(await ev(p, () => /On this device and in use/.test($('extState').textContent) && !$('extDel').hidden), 'settings: in use, with Remove');
    // a new start: loaded from the cache, nothing downloaded again
    let fetched = 0; p.on('request', r => { if (/ext-(dso|stars)/.test(r.url())) fetched++; });
    await p.reload(); await p.waitForFunction(() => typeof ext !== 'undefined' && ext.loaded, null, { timeout: 30000 }).catch(() => {});
    ok(await ev(p, () => ext.loaded) && fetched === 0, 'next start: from its cache, no download', fetched);
    // Pro ends: put away, data stays on the device
    await p.clock.setSystemTime(new Date('2028-01-05T20:00:00Z')); await ev(p, () => proCheck()); await wait(p, 300);
    ok(await ev(p, () => !ext.loaded && DEEP.n === DEEP_BASE.n && !NGC.some(o => o.ext) && !targetById('NGC 1499') && ext.have), 'Pro ended: put away (still on the device)');
    // Remove
    await p.clock.setSystemTime(new Date('2026-10-21T20:00:00Z')); await ev(p, () => proCheck()); await p.waitForFunction(() => ext.loaded, null, { timeout: 30000 }).catch(() => {});
    await ev(p, () => extRemove()); await wait(p, 300);
    ok(await ev(p, async () => !ext.loaded && !ext.have && cfg.extAuto === false && !(await caches.keys()).includes('zenigo-ext')), 'Remove deletes it and stops the automatic download');
    await done(p);
    extOn = false;
  },

  // Zenigo Pro in the app: without a licence the Pro features ask for it, a pasted key turns them on, a renewal that
  // starts later counts on, the end turns them off again, forged and sandbox-on-zenigo.app keys are refused
  async proapp() {
    const p = await page({ pro: false });
    ok(await ev(p, () => pro.checked && !pro.on && $('proMenuState').textContent === ''), 'no licence: Pro is off');
    const pills = () => ev(p, () => ['#btnMenu', '#menuTitle', '#updateBar'].map(s => getComputedStyle(document.querySelector(s + ' .propill')).display !== 'none'));
    ok((await pills()).every(x => !x), 'no “Pro” on the logos without Pro', await pills());
    const proFeat = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'site', 'pro.json'), 'utf8')).features;
    await ev(p, () => proNeed('')); await wait(p, 300);
    const incl = await ev(p, () => ({ shown: !$('proIncl').hidden && $('proIncl').offsetHeight > 0, items: [...document.querySelectorAll('#proIncl li b')].map(b => b.textContent), note: $('proIncl').querySelector('.note').textContent }));
    ok(incl.shown && JSON.stringify(incl.items) === JSON.stringify(proFeat.filter(f => !f.coming).map(f => f.title)) && proFeat.filter(f => f.coming).every(f => incl.note.includes(f.title)) && !/<!--/.test(incl.note),
      'without a licence the Pro sheet lists what Pro adds (from pro.json), planned features in the note', incl);
    await ev(p, () => closeSheet('proSheet'));
    const tagged = () => ev(p, () => ['#btnSync', '#setTabSync', '#qView', '#oView', 'input[value="scope"]', 'input[data-show="sats"]'].map(q => {
      const e = document.querySelector(q), box = e.closest('label, button, .qrow, .row') || e.parentElement; const t = (box.closest('.qrow') || box).querySelector('.protag') || box.querySelector('.protag');
      return !!t && getComputedStyle(t).display !== 'none'; }));
    ok((await tagged()).every(Boolean), 'without Pro: sync, eyepiece view, the telescope role and satellites carry a “Pro” tag', await tagged());
    ok(await ev(p, () => /part of Zenigo Pro/.test($('satState').textContent)), 'the satellite switch says it is part of Pro');
    await ev(p, () => setShow({ ...cfg.show, sats: true })); await wait(p, 300);
    ok(await ev(p, () => !cfg.show.sats && !$('proSheet').hidden && /Satellites/.test($('proWhy').textContent)), 'satellites: the Pro sheet says why, the filter stays off');
    await ev(p, () => closeSheet('proSheet'));
    await ev(p, () => { $('qView').checked = true; $('qView').onchange(); }); await wait(p, 300);
    ok(await ev(p, () => !cfg.optics.view && !$('qView').checked && !$('proSheet').hidden), 'eyepiece view: asks for Pro, stays off');
    await ev(p, () => closeSheet('proSheet'));
    ok(await ev(p, () => { cfg.optics.view = true; return $('epView').hidden; }), 'an eyepiece view switched on before is not drawn without Pro');
    await ev(p, () => { cfg.optics.view = false; });
    ok(await ev(p, async () => { const r = await liveStart({ noScan: true }); const s = !$('proSheet').hidden; closeSheet('proSheet'); return r === null && s && live.state !== 'offer'; }), 'live connection from the telescope: asks for Pro');
    await ev(p, () => { syncRt.avail = true; renderSync(); $('syncSetup').onclick(); }); await wait(p, 300);
    ok(await ev(p, () => !syncS.code && !$('proSheet').hidden), 'sync: setting it up asks for Pro');
    await ev(p, () => closeSheet('proSheet'));
    await ev(p, () => { showTonight(); openSheet('tonightSheet'); }); await wait(p, 300);
    ok(await ev(p, () => /part of Zenigo Pro/.test($('tonightBody').textContent) && !/Calculating/.test($('tonightBody').textContent)), 'Tonight: Coming up says it is part of Pro');
    await ev(p, () => closeSheet('tonightSheet'));
    await ev(p, () => { obs.list = ['M13', 'M57', 'M27', 'M31'].map(id => ({ id, name: id, added: 1 })); cfg.listOrder = 'route'; saveObs(); openSheet('listSheet'); renderList(); }); await wait(p, 300);
    ok(await ev(p, () => !!document.querySelector('[data-lorder="route"] .protag') && document.querySelector('[data-lorder="time"]').classList.contains('on')), 'list: Short route marked Pro, the list stays by time');
    await ev(p, () => closeSheet('listSheet'));
    // keys: forged, then a running one pasted in the sheet
    const k = await proKey('2026-09-01T00:00:00.000Z', '2027-09-01T00:00:00.000Z', { sb: 1 });
    const forged = k.replace(/\.[\w-]{6}/, '.AAAAAA');
    await ev(p, () => proNeed('')); await p.tap('#proEnter'); await p.fill('#proKeyIn', forged); await p.tap('#proKeyAdd'); await wait(p, 300);
    ok(await ev(p, () => !pro.on && /not a Zenigo Pro licence key/.test($('proKeyMsg').textContent)), 'a changed key is refused');
    await p.fill('#proKeyIn', k.slice(0, 40) + '\n' + k.slice(40)); await p.tap('#proKeyAdd'); await wait(p, 300);
    ok(await ev(p, () => pro.on && /active until/i.test($('proKeyMsg').textContent) && /until/.test($('proMenuState').textContent)), 'a pasted key (with a line break) turns Pro on', await ev(p, () => $('proKeyMsg').textContent));
    ok((await pills()).every(Boolean), 'with Pro: a “Pro” on every logo (menu button, menu, update notice)', await pills());
    ok(await ev(p, () => $('proIncl').hidden), 'with Pro running the list of what Pro adds is hidden');
    ok(await ev(p, () => { const l = document.querySelector('#btnMenu img').getBoundingClientRect(), t = document.querySelector('#btnMenu .propill').getBoundingClientRect(), b = $('btnMenu').getBoundingClientRect();
      return t.left + t.width / 2 > l.left + l.width / 2 && t.top + t.height / 2 > l.top + l.height / 2 && t.right <= b.right && t.bottom <= b.bottom; }), 'the “Pro” sits at the logo’s lower right, inside the menu button');
    ok(await ev(p, () => satsOn !== undefined && (setShow({ ...cfg.show, sats: true }), cfg.show.sats)), 'satellites can be switched on now');
    ok((await tagged()).every(x => !x) && await ev(p, () => getComputedStyle(document.querySelector('.rolecard .nopro')).display === 'none'), 'with Pro the tags are gone', await tagged());
    // a renewal bought before the end: starts later, and Pro runs until its end
    const r2 = await proKey('2027-09-01T00:00:00.000Z', '2028-09-01T00:00:00.000Z', { sb: 1 });
    await ev(p, k => proAdd(k), r2);
    ok(await ev(p, () => pro.on && new Date(pro.until).getUTCFullYear() === 2028 && $('proKeys').children.length === 2 && /starts later/.test($('proKeys').textContent)), 'a renewal that starts later extends Pro to its end');
    // getting the key back after deleting the app: an email to themselves, and backups
    const mail = await ev(p, () => !$('proMailRow').hidden && decodeURIComponent($('proMail').href));
    ok(mail && mail.startsWith('mailto:?subject=') && mail.includes(k) && mail.includes(r2) && mail.includes('/app/#pro=') && mail.includes('/pro/welcome/?txn=txn_01test'), '“Email my key to me”: both keys, the app link and the welcome page link', mail && mail.slice(0, 120));
    await ev(p, () => setSetTab('general'));
    const [bdl] = await Promise.all([p.waitForEvent('download'), p.evaluate(() => $('bkLists').click())]);
    const bkFile = await bdl.path(), bkPro = JSON.parse(fs.readFileSync(bkFile, 'utf8'));
    ok(Array.isArray(bkPro.licences) && bkPro.licences.includes(k) && bkPro.licences.includes(r2), 'a backup holds the licence keys', bkPro.licences);
    await ev(p, () => { localStorage.setItem('zenigo-pro', '[]'); return proCheck(); });
    ok(await ev(p, () => !pro.on), 'app deleted (keys gone): Pro is off');
    await p.setInputFiles('#bkFile', bkFile); await wait(p, 800);
    ok(await ev(p, () => pro.on && new Date(pro.until).getUTCFullYear() === 2028 && /Zenigo Pro is back/.test($('hint').textContent)), 'restoring the backup brings both keys and Pro back', await ev(p, () => $('hint').textContent));
    // 30 days before the end: a reminder
    await p.clock.setSystemTime(new Date('2028-08-15T20:00:00Z')); await ev(p, () => { cfg.proRemindAt = 0; return proCheck().then(proRemind); });
    ok(await ev(p, () => /Zenigo Pro ends in 17 days/.test($('hint').textContent)), 'a reminder 30 days before the end', await ev(p, () => $('hint').textContent));
    // the end: Pro goes off, data stays, the app says so once
    await p.clock.setSystemTime(new Date('2028-09-02T20:00:00Z')); await ev(p, () => proCheck());
    ok(await ev(p, () => !pro.on && !satsOn() && /has ended/.test($('hint').textContent) && $('proMenuState').textContent === 'ended'), 'after the end: Pro is off and the app says so');
    ok((await pills()).every(x => !x), 'and the “Pro” on the logos is gone', await pills());
    // a link with a key (#pro=…) adds it; a sandbox key is refused on zenigo.app
    const k3 = await proKey('2028-08-01T00:00:00.000Z', '2029-08-01T00:00:00.000Z', { sb: 1 });
    await p.goto(base + '/app/#pro=' + encodeURIComponent(k3)); await p.waitForFunction(() => typeof pro !== 'undefined' && pro.on, null, { timeout: 8000 }).catch(() => {});
    ok(await ev(p, () => pro.on && !/pro=/.test(location.hash)), 'a #pro= link adds the key and leaves the address', await ev(p, () => [typeof pro !== 'undefined' && pro, location.hash.slice(0, 20), Date()]));
    await wait(p, 300);
    ok(await ev(p, () => !$('proSheet').hidden && $('proKeyBox').hidden && /Active until/.test($('proStatus').textContent) && /active until/i.test($('hint').textContent)), 'from the welcome page: the Pro sheet shows Pro running, without the key field', await ev(p, () => [$('proKeyBox').hidden, $('proStatus').textContent, $('hint').textContent]));
    await ev(p, () => closeSheet('proSheet'));
    await p.goto(base + '/app/#pro=' + encodeURIComponent(k3.slice(0, -4) + 'AAAA')); await wait(p, 1500);
    ok(await ev(p, () => !$('proSheet').hidden && !$('proKeyBox').hidden && /not a Zenigo Pro licence key/.test($('proKeyMsg').textContent)), 'a broken key in a link: the key field, with the reason', await ev(p, () => $('proKeyMsg').textContent));
    ok(await ev(p, async () => { const h = location.hostname; return h !== 'zenigo.app'; }) && await ev(p, async k => { const p0 = await ZLicence.verify(k); return !!(p0 && p0.sb); }, k3), 'test keys are sandbox keys (refused on zenigo.app itself)');
    await done(p);
  },

  // Zenigo Pro page: without a configuration "Checkout unavailable"; with one (Paddle.js replaced by a stand-in) the price
  // as Paddle formats it, the overlay checkout for the configured price and the redirect to the welcome page
  async pro() {
    const open = async (cfg, w = 390, stored) => {
      const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, isMobile: w < 600, hasTouch: w < 600 });
      const p = await ctx.newPage(); p.errors = []; p.on('pageerror', e => p.errors.push(String(e))); p.paddle = [];
      if (stored) await p.addInitScript(k => localStorage.setItem('zenigo-pro', JSON.stringify([k])), stored);
      let asked = 0;
      await p.route('**/api/pro/licence*', r => ++asked < 2 ? r.fulfill({ status: 404, contentType: 'application/json', body: '{"status":"pending"}' })
        : r.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'active', licence: 'ZP1.eyJ2IjoxfQ.c2ln', starts: '2026-10-26T20:00:00.000Z', ends: '2027-10-26T20:00:00.000Z' }) }));
      p.on('request', r => { if (r.url().includes('paddle.com')) p.paddle.push(r.url()); });
      if (cfg) await p.route('**/api/pro/config', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cfg) }));
      await p.route('https://cdn.paddle.com/**', r => r.fulfill({ contentType: 'text/javascript', body: `window.__pd = { calls: [] };
        window.Paddle = { Environment: { set: e => __pd.calls.push(['env', e]) },
          Initialize: o => { __pd.calls.push(['init', o.token]); __pd.cb = o.eventCallback; },
          PricePreview: r => { __pd.calls.push(['preview', r]); return Promise.resolve({ data: { currencyCode: 'EUR', details: { lineItems: [{ formattedTotals: { subtotal: '€16.80', tax: '€3.19', total: '€19.99' } }] } } }); },
          Checkout: { open: o => { __pd.calls.push(['open', o]); setTimeout(() => __pd.cb({ name: 'checkout.completed', data: { transaction_id: 'txn_01test' } }), 50); } } };` }));
      await p.goto(base + '/pro/'); await wait(p, 600);
      return p;
    };
    const p = await open(null);
    ok(await p.isVisible('#proBuy') && await p.isDisabled('#proBuy'), 'the page renders with its Buy button, disabled without a configuration');
    ok(/Checkout unavailable/.test(await p.textContent('#proState')) && await p.isVisible('#proState'), 'the config endpoint fails: “Checkout unavailable”');
    ok(p.paddle.length === 0, 'and nothing is loaded from Paddle', p.paddle);
    ok(await ev(p, () => getComputedStyle(document.querySelector('.brand .propill')).display === 'none'), 'no Pro in this browser: no “Pro” on the logo');
    const proJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'site', 'pro.json'), 'utf8')).structuredData;
    ok(await p.textContent('#proPrice') === new Intl.NumberFormat('en', { style: 'currency', currency: proJson.currency }).format(Number(proJson.price)) && /in the EU, including VAT/i.test(await p.textContent('#proTax')), 'without Paddle the EU base price from pro.json is shown, with its tax note');
    ok(await ev(p, () => ['.menumeta', 'footer nav'].every(s => !!document.querySelector(s + ' a[href="/licence/"]') && !!document.querySelector(s + ' a[href="/pro/#refunds"]') && !!document.querySelector(s + ' a[href="/privacy/"]'))), 'licence terms, refund policy and privacy in the menu and the footer');
    ok(await ev(p, PROSOON => document.querySelectorAll('.profeat dt').length >= 6 && document.querySelectorAll('.profeat .ptag.soon').length === PROSOON && (PROSOON > 0) === /marked “coming”/.test(document.body.textContent) && /Labelling your night photos/.test(document.querySelector('.freelist').textContent), JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'site', 'pro.json'), 'utf8')).features.filter(f => f.coming).length), 'features from pro.json, planned ones marked coming (with the note only then), night photos listed as free');
    ok(await ev(p, () => [...document.querySelectorAll('.buybox, #proBuy')].every(e => /12-month licence, paid once, no automatic renewal/.test(e.textContent)) && !!document.querySelector('.buybox a[href="/licence/"]') && !!document.querySelector('.buybox a[href="#refunds"]')), 'the terms beside the price and on the button; licence and refunds linked');
    ok(await ev(p, () => document.documentElement.scrollWidth <= innerWidth), 'no sideways scrolling on a phone');
    await done(p);
    const q = await open({ environment: 'sandbox', clientToken: 'test_abc', priceId: 'pri_test', country: 'DE' }, 1280);
    const calls = await ev(q, () => __pd.calls);
    ok(calls.some(c => c[0] === 'env' && c[1] === 'sandbox') && calls.some(c => c[0] === 'init' && c[1] === 'test_abc'), 'sandbox environment and the client token from the configuration');
    const pv = calls.find(c => c[0] === 'preview');
    ok(pv && pv[1].items[0].priceId === 'pri_test' && pv[1].address && pv[1].address.countryCode === 'DE', 'the price preview for that price and the visitor’s country', pv);
    ok(await q.textContent('#proPrice') === '€19.99' && /for your country/.test(await q.textContent('#proTax')) && await q.isVisible('#proSandbox') && await q.isEnabled('#proBuy'), 'Paddle’s formatted total is shown as it is, as the price for the visitor’s country; sandbox note; button enabled');
    await q.click('#proBuy'); await q.waitForURL(/\/pro\/welcome\//, { timeout: 5000 }).catch(() => {});
    ok(/\/pro\/welcome\/\?txn=txn_01test$/.test(q.url()), 'checkout completed: on to the welcome page with the transaction ID', q.url());
    ok(await q.isVisible('#txnRow') && await q.textContent('#txn') === 'txn_01test', 'the welcome page shows the order reference');
    await q.waitForSelector('#keyReady', { state: 'visible', timeout: 8000 }).catch(() => {});
    ok(await ev(q, () => JSON.parse(localStorage.getItem('zenigo-pro') || '[]').includes('ZP1.eyJ2IjoxfQ.c2ln') && /#pro=ZP1/.test(document.getElementById('keyOpen').href) && /until 26 October 2027/.test(document.getElementById('keyState').textContent)),
      'the welcome page waits for the key, keeps it for the app, links it into the app', await ev(q, () => document.getElementById('keyState').textContent));
    ok(await ev(q, () => getComputedStyle(document.querySelector('.brand .propill')).display !== 'none'), 'the welcome page puts “Pro” on the logo once the key is there');
    const wmail = await ev(q, () => decodeURIComponent(document.getElementById('keyMail').href));
    ok(wmail.startsWith('mailto:?subject=') && wmail.includes('ZP1.eyJ2IjoxfQ.c2ln') && wmail.includes('/pro/welcome/?txn=txn_01test') && wmail.includes('/app/#pro='), '“Email it to me”: the key, the app link and this page’s link', wmail.slice(0, 120));
    await done(q);
    const r = await open({ environment: 'production', clientToken: 'live_abc', priceId: 'pri_live' }, 390, PRO_KEY);
    const c2 = await ev(r, () => __pd.calls);
    ok(!c2.some(c => c[0] === 'env') && !('address' in c2.find(c => c[0] === 'preview')[1]) && await r.isHidden('#proSandbox'), 'production: no sandbox switch; no country → none passed to Paddle');
    await r.click('#proBuy');
    const o = (await ev(r, () => __pd.calls)).find(c => c[0] === 'open');
    ok(o && o[1].settings.displayMode === 'overlay' && o[1].settings.variant === 'one-page' && o[1].items[0].priceId === 'pri_live' && o[1].items[0].quantity === 1, 'Buy opens the one-page overlay for that price', o);
    const mineId = (await ZLicence.verify(PRO_KEY, [PRO_TEST.pub])).id;
    ok(await ev(r, () => getComputedStyle(document.querySelector('.brand .propill')).display !== 'none'), 'Pro in this browser: “Pro” on the logo in the header');
    ok(o && o[1].customData && o[1].customData.renew === mineId && /until 31 December 2027/.test(await r.textContent('#proHave')) && /Renew/.test(await r.textContent('#proBuy')), 'Pro already in this browser: shown, and the purchase renews it', o && o[1].customData);
    await done(r);
  },

  // offline: the service worker keeps page and scripts
  // Instruments: the telescope of earlier versions becomes the first one; adding (kind, data, eyepieces), switching
  // (each keeps its eyepieces, the eyepiece chosen and its eyepiece point), binoculars, editing another one, the
  // logbook, deleting; without Pro one instrument and the offer to replace it
  async instruments() {
    const old = { lat: 48.18, lon: 10.08, mount: 'eq', optics: { scope: 1200, ap: 203, eps: [{ f: 25, a: 52 }, { f: 10, a: 52 }, { f: 6, a: 60 }], ep: 1, src: 'ep', finderType: '8x50' }, tele: { x: 0.04, y: -0.01 }, teleSetAt: 5 };
    const F = await page({ pro: false, init: `if (!localStorage.getItem('dobson-lotse')) localStorage.setItem('dobson-lotse', ${JSON.stringify(JSON.stringify(old))});` });
    const m = await ev(F, () => ({ n: cfg.instruments.length, i: cfg.instruments[0], cur: curInst().id === cfg.instrumentId, ep: opt().ep, scope: opt().scope, mount: cfg.mount }));
    ok(m.n === 1 && m.i.name === 'Telescope 203 mm f/5.9' && m.i.mount === 'eq' && m.i.o.eps.length === 3 && m.cur && m.ep === 1 && m.mount === 'eq', 'the telescope of an earlier version becomes the first instrument, named as the logbook named it, eyepiece kept', m);
    await ev(F, () => { syncSettings(); openSheet('sheet'); setSetTab('scope'); }); await wait(F, 400);
    shot(F, 'equipment-free');
    ok(await ev(F, () => document.querySelectorAll('#eqList .eqcard').length === 1 && !!$('eqList').querySelector('.inuse') && $('oLegend').textContent === 'Telescope 203 mm f/5.9' && $('oDel').hidden && !$('oReplace').hidden),
      'Settings › Equipment: the one instrument in use, its settings below, Replace instead of Delete');
    await F.tap('#eqAdd'); await wait(F, 500);
    ok(await ev(F, () => !$('proSheet').hidden && /More than one instrument/.test($('proWhy').textContent) && !$('proAltRow').hidden && /Replace Telescope 203 mm f\/5\.9/.test($('proAlt').textContent)), 'without Pro: a second instrument asks for Pro and offers to replace the one there is');
    shot(F, 'progate');
    await F.tap('#proAlt'); await wait(F, 600);
    ok(await ev(F, () => !$('addInstSheet').hidden && /^Replace/.test($('aiTitleTxt').textContent) && document.querySelectorAll('#aiBody .aitype').length === 6), 'Replace: step 1, the kind of instrument');
    await F.tap('.aitype[data-type="refr"]'); await wait(F, 300);
    await F.fill('#aiScope', '480'); await F.fill('#aiAp', '80'); await ev(F, () => { $('aiAp').dispatchEvent(new Event('change')); $('aiScope').dispatchEvent(new Event('change')); });
    await F.fill('#aiName', 'ED 80'); await ev(F, () => $('aiName').dispatchEvent(new Event('change')));
    await ev(F, () => [...document.querySelectorAll('#aiBtns .btn')].find(b => /eyepieces/.test(b.textContent)).click()); await wait(F, 300);
    ok(await ev(F, () => [...document.querySelectorAll('#aiBtns .btn')].map(b => b.textContent).join('|')) === 'Back|Add and use ED 80', 'without Pro, replacing: no “Add only”');
    await ev(F, () => [...document.querySelectorAll('#aiBtns .btn')].pop().click()); await wait(F, 900);
    const r = await ev(F, () => ({ n: cfg.instruments.length, name: curInst().name, type: curInst().type, scope: opt().scope, ap: opt().ap, orient: opt().orient, tele: cfg.tele, log: $('addInstSheet').hidden }));
    ok(r.n === 1 && r.name === 'ED 80' && r.type === 'refr' && r.scope === 480 && r.ap === 80 && r.orient === 'mirror' && r.tele.x === 0 && r.log, 'replaced: one instrument, the refractor in use with a star diagonal view, its own eyepiece point', r);
    await done(F);

    const p = await page();
    shot(p, 'map');
    // adding with Pro: Dobsonian, 8″, eyepieces (one from the list, one typed)
    await ev(p, () => openSheet('quickSheet')); await wait(p, 400);
    ok(await ev(p, () => [...$('qInst').children].map(b => b.textContent).join('|') === 'My telescope|+ Add' && !!$('qInstManage').offsetParent), 'Quick settings: the instruments, “+ Add” and Manage');
    if (process.env.SHOTS) { await p.screenshot({ path: path.join(process.env.SHOTS, 'quick.png') }); await ev(p, () => { $('updateBar').hidden = false; }); await p.screenshot({ path: path.join(process.env.SHOTS, 'update.png'), clip: { x: 0, y: 0, width: 390, height: 140 } }); await ev(p, () => { $('updateBar').hidden = true; }); }
    await ev(p, () => [...$('qInst').children].pop().click()); await wait(p, 500);
    ok(await ev(p, () => !$('addInstSheet').hidden && $('proSheet').hidden), 'with Pro “+ Add” starts adding');
    shot(p, 'add-type');
    await p.tap('.aitype[data-type="dob"]'); await wait(p, 300);
    ok(await ev(p, () => $('aiName').value === 'Dobson 8″' && $('aiScope').value === '1200' && $('aiAp').value === '203' && $('aiMount').value === 'altaz' && $('aiFinder').value === '8x50'), 'a Dobsonian starts as 8″ f/6 with an 8×50 finder, alt-azimuth');
    await ev(p, () => [...document.querySelectorAll('#aiBody .chip')].find(b => b.textContent === '10″ f/5').click()); await wait(p, 200);
    ok(await ev(p, () => $('aiName').value === 'Dobson 10″' && $('aiScope').value === '1250' && /f\/4\.9 · stars to about magnitude 15/.test($('aiBody').textContent)), 'a size fills name, focal length and aperture');
    shot(p, 'add-data');
    await ev(p, () => [...document.querySelectorAll('#aiBtns .btn')].find(b => /eyepieces/.test(b.textContent)).click()); await wait(p, 300);
    ok(await ev(p, () => document.querySelectorAll('#aiBody .aiep').length === 2 && /From your other instruments/.test($('aiBody').textContent) === false), 'step 3: the usual 25 mm and 10 mm');
    await ev(p, () => [...document.querySelectorAll('#aiBody .chip')].find(b => b.textContent === '+ 32 mm').click()); await wait(p, 200);
    await p.fill('#aiEpF', '7'); await p.fill('#aiEpA', '82'); await ev(p, () => [...document.querySelectorAll('#aiBody .btn')].find(b => b.textContent === 'Add').click()); await wait(p, 200);
    ok(await ev(p, () => [...document.querySelectorAll('#aiBody .aiep b')].map(b => b.textContent).join('|')) === '32 mm · 50° · 1.25″|25 mm · 52° · 1.25″|10 mm · 52° · 1.25″|7 mm · 82° · 1.25″', 'eyepieces added by a tap and by typing, longest first, with their barrel');
    shot(p, 'add-eps');
    ok(await ev(p, () => [...document.querySelectorAll('#aiBody .chip')].some(b => b.textContent === '+ 30 mm 2″')), 'a 2″ focuser: 2″ eyepieces offered too');
    await ev(p, () => [...document.querySelectorAll('#aiBtns .btn')].pop().click()); await wait(p, 600);
    const d = await ev(p, () => ({ n: cfg.instruments.length, name: curInst().name, eps: opt().eps.length, scope: opt().scope, sel: [...$('qInst').children].map(b => b.getAttribute('aria-checked')).join() }));
    ok(d.n === 2 && d.name === 'Dobson 10″' && d.eps === 4 && d.scope === 1250, 'added and in use', d);
    // each instrument keeps its eyepiece choice and eyepiece point
    await ev(p, () => { setOptics({ ep: 3 }); cfg.tele = { x: 0.02, y: 0.03 }; save(); useInst(cfg.instruments[0].id); });
    let s = await ev(p, () => ({ name: curInst().name, eps: opt().eps.length, ep: opt().ep, tele: cfg.tele, view: !$('epInst').hidden }));
    ok(s.name === 'My telescope' && s.eps === 2 && s.ep === 0 && s.tele.x === 0, 'switched back: its own eyepieces and eyepiece point', s);
    await ev(p, () => useInst(cfg.instruments[1].id));
    s = await ev(p, () => ({ ep: opt().ep, tele: cfg.tele, label: epLabel(curEp()) }));
    ok(s.ep === 3 && s.tele.x === 0.02 && /^7 mm/.test(s.label), 'and again: the 7 mm and the eyepiece point of the Dobson', s);
    // the eyepiece view names the instrument; its sheet switches and picks an eyepiece
    await ev(p, () => setOptics({ view: true })); await wait(p, 400);
    ok(await ev(p, () => !$('epInst').hidden && $('epInst').textContent === 'Dobson 10″ ▾'), 'under the eyepiece view: the instrument in use');
    shot(p, 'map-eyepiece');
    await p.tap('#epInst'); await wait(p, 500);
    ok(await ev(p, () => !$('instSheet').hidden && document.querySelectorAll('#instList .eqcard').length === 2 && document.querySelectorAll('#instEps .chip').length === 5), 'its sheet: both instruments, the eyepieces and the finder');
    shot(p, 'switch');
    await ev(p, () => [...document.querySelectorAll('#instEps .chip')].find(b => /^25 mm/.test(b.textContent)).click()); await wait(p, 200);
    ok(await ev(p, () => opt().ep === 1 && opt().eps[1].f === 25 && $('instEps').querySelector('.sel').textContent.startsWith('25 mm')), 'an eyepiece chosen in the sheet');
    await ev(p, () => document.querySelector('#instList .eqcard:not(.inuse) .btn').click()); await wait(p, 300);
    ok(await ev(p, () => curInst().name === 'My telescope' && $('instList').querySelector('.inuse').parentElement.firstChild.querySelector('b').textContent === 'My telescope'), 'Use in the sheet switches');
    // binoculars: their own settings, the field on the map, the whole sky
    await ev(p, () => { closeSheet('instSheet'); openAddInst('quick'); }); await wait(p, 400);
    await p.tap('.aitype[data-type="bino"]'); await wait(p, 300);
    ok(await ev(p, () => $('aiName').value === 'Binoculars 10×50' && $('aiFov').value === '6.5'), 'binoculars start as 10×50 with 6.5°');
    await ev(p, () => [...document.querySelectorAll('#aiBody .chip')].find(b => b.textContent === '15×70').click()); await wait(p, 200);
    await wait(p, 600); shot(p, 'add-bino');
    await ev(p, () => [...document.querySelectorAll('#aiBtns .btn')].pop().click()); await wait(p, 500);
    const b = await ev(p, () => { const e = curEp(), dd = epData(e); return { name: curInst().name, mag: Math.round(dd.mag), fov: +dd.fov.toFixed(1), label: epLabel(e), pupil: +exitPupil(e).toFixed(1), reach: reach(), q: $('qEp').disabled, finder: finderFov() }; });
    ok(b.name === 'Binoculars 15×70' && b.mag === 15 && b.fov === 4.4 && b.label === '15×70 · 4.4°' && b.pupil === 4.7 && !b.reach.limited && b.finder === 0, 'binoculars in use: 15×, 4.4° field, no finder, the whole sky', b);
    await wait(p, 300);
    ok(await ev(p, () => $('epInst').textContent === 'Binoculars 15×70 ▾' && $('epSrc').textContent === '4.4° field'), 'under the eyepiece view: the binoculars and their field', await ev(p, () => $('epInst').textContent + ' | ' + $('epSrc').textContent));
    // the logbook: the instrument in use, no eyepiece for binoculars; Binocular Messier counts it
    await ev(p, () => { openSeen(objById('M45')); seenState.res = 'easy'; }); await wait(p, 300);
    ok(await ev(p, () => $('seenInst').value === 'Binoculars 15×70' && $('seenEpL').hidden && ![...$('seenInst').options].some(o => o.textContent === 'Binoculars')), 'logging: the binoculars in use, no eyepiece');
    await ev(p, () => { $('seenInst').value = 'Dobson 10″'; $('seenInst').onchange(); }); await wait(p, 100);
    ok(await ev(p, () => !$('seenEpL').hidden && [...$('seenEp').options].map(o => o.textContent).join('|') === '32 mm · 39×|25 mm · 50×|10 mm · 125×|7 mm · 179×|Finder'), 'another telescope: its own eyepieces');
    shot(p, 'seen');
    await ev(p, () => { $('seenInst').value = 'Binoculars 15×70'; $('seenInst').onchange(); $('seenSave').click(); }); await wait(p, 300);
    ok(await ev(p, () => { const e = obs.log.find(x => x.obj === 'M45'); return e.inst === 'Binoculars 15×70' && e.ik === 'bino' && e.ep === '' && progStats(PROGRAMS.find(x => x.id === 'bino')).done === 1; }), 'logged with the binoculars: counts for Binocular Messier');
    // Settings › Equipment: tapping another instrument shows its settings; changes go to it, not to the one in use
    await ev(p, () => { SHEETS.forEach(x => closeSheet(x.id)); syncSettings(); openSheet('sheet'); setSetTab('scope'); }); await wait(p, 400);
    ok(await ev(p, () => document.querySelectorAll('#eqList .eqcard').length === 3 && !$('oBinoBox').hidden && $('oScopeA').hidden && $('bMag').value === '15'), 'the binoculars’ own settings');
    shot(p, 'equipment');
    await ev(p, () => [...document.querySelectorAll('#eqList .eqmain')].find(b => b.querySelector('b').textContent === 'Dobson 10″').click()); await wait(p, 300);
    ok(await ev(p, () => !$('oOther').hidden && $('oLegend').textContent === 'Dobson 10″' && $('oScope').value === '1250' && document.querySelectorAll('#oEps .eprow').length === 4 && $('eqList').querySelector('.editing')), 'tapping the Dobson shows its settings, marked as not in use', await ev(p, () => ({ o: $('oOther').hidden, l: $('oLegend').textContent, s: $('oScope').value, n: document.querySelectorAll('#oEps .eprow').length, e: !!$('eqList').querySelector('.editing'), id: st.editId })));
    shot(p, 'edit-other');
    await p.fill('#oAp', '250'); await ev(p, () => $('oAp').dispatchEvent(new Event('change'))); await wait(p, 100);
    await ev(p, () => $('oEpAdd').click()); await wait(p, 100);
    const e = await ev(p, () => { const dd = cfg.instruments.find(i => i.name === 'Dobson 10″'); return { ap: dd.o.ap, n: dd.o.eps.length, cur: curInst().name, curAp: opt().ap, curN: opt().eps.length }; });
    await ev(p, () => { $('oFocuser').value = '1.25'; $('oFocuser').onchange(); const r = [...document.querySelectorAll('#oEps .eprow')].pop(); r.querySelector('select').value = '2'; r.querySelector('select').onchange(); }); await wait(p, 100);
    ok(await ev(p, () => { const r = [...document.querySelectorAll('#oEps .eprow')].pop(), dd = cfg.instruments.find(i => i.name === 'Dobson 10″'); return dd.o.focuser === 1.25 && dd.o.eps[dd.o.eps.length - 1].d === 2 && r.querySelector('small').classList.contains('nofit') && /^Doesn’t fit the 1\.25″ focuser/.test(r.querySelector('small').textContent); }), 'a 2″ eyepiece on a 1.25″ focuser: marked as not fitting');
    if (process.env.SHOTS) { await ev(p, () => $('oEps').scrollIntoView({ block: 'center' })); await wait(p, 200); await p.screenshot({ path: path.join(process.env.SHOTS, 'eps.png') }); }
    ok(e.ap === 250 && e.n === 5 && e.cur === 'Binoculars 15×70' && e.curAp === 70 && e.curN === 1, 'its aperture and a new eyepiece went to the Dobson; the binoculars stay in use', e);
    await p.fill('#oName', 'Big Dob'); await ev(p, () => $('oName').dispatchEvent(new Event('change'))); await wait(p, 100);
    ok(await ev(p, () => cfg.instruments.some(i => i.name === 'Big Dob') && /Big Dob/.test($('eqList').textContent)), 'renamed');
    await ev(p, () => $('oUse').click()); await wait(p, 300);
    ok(await ev(p, () => curInst().name === 'Big Dob' && opt().ap === 250 && opt().eps.length === 5 && $('oOther').hidden), '“Use it” makes it the one in use, with the changes');
    // delete the binoculars (not in use)
    await ev(p, () => [...document.querySelectorAll('#eqList .eqmain')].find(b => /Binoculars/.test(b.textContent)).click()); await wait(p, 300);
    await p.tap('#oDel'); await wait(p, 200);
    ok(await ev(p, () => $('oDel').textContent === 'Delete Binoculars 15×70' && $('oDel').classList.contains('armed') && /Logbook entries keep its name/.test($('optics').textContent) && cfg.instruments.length === 3), 'Delete: confirm in place');
    if (process.env.SHOTS) await ev(p, () => $('oDel').scrollIntoView({ block: 'center' })), await wait(p, 200), await p.screenshot({ path: path.join(process.env.SHOTS, 'armed.png') });
    await ev(p, () => $('optics').querySelector('.armcancel').click()); await wait(p, 100);
    ok(await ev(p, () => $('oDel').textContent === 'Delete this instrument' && !$('optics').querySelector('.armcancel, .armnote') && cfg.instruments.length === 3), 'Cancel puts it back');
    await p.tap('#oDel'); await wait(p, 200); await p.tap('#oDel'); await wait(p, 600);
    ok(await ev(p, () => cfg.instruments.length === 2 && curInst().name === 'Big Dob' && !$('sheet').hidden && obs.log.find(x => x.obj === 'M45').ik === 'bino'), 'deleted; the logbook entry keeps its name and kind');
    // another device brings its instruments: the placeholder of a new install goes, the one in use stays
    await ev(p, () => { cfg.instruments.push({ id: 'x1', name: 'Fresh', type: 'dob', mount: 'altaz', o: { scope: 1200, eps: [] }, fresh: true }); afterSyncedSettings(); });
    ok(await ev(p, () => cfg.instruments.length === 2 && !cfg.instruments.some(i => i.fresh) && curInst().name === 'Big Dob'), 'after syncing: a new install’s placeholder instrument goes');
    await done(p);
  },

  // Logbook statistics (Pro): period, kinds against the catalogue, instruments, constellations, records, seeing, the
  // Moon and not found; a tap filters the entries; export as CSV, OpenAstronomyLog (checked against the OAL 2.1 schema)
  // and the year in review; without Pro the overview and the offer
  async logstats() {
    const seed = () => {
      const E = (uid, obj, t, extra = {}) => ({ uid, obj, name: obj, t, result: 'easy', note: '', lat: 48.18, lon: 10.08, alt: 50, moon: '10 %, down', ...extra });
      obs.log = [
        E('a1', 'M31', '2026-08-18T22:40:00.000Z', { inst: 'Dobson 8″', ik: 'scope', ep: '32 mm · 38×', seeing: 4, transp: 4 }),
        E('a2', 'M33', '2026-08-18T23:10:00.000Z', { inst: 'Dobson 8″', ik: 'scope', ep: '25 mm · 48×', result: 'hard', seeing: 4, transp: 3 }),
        E('a3', 'M13', '2026-08-18T21:00:00.000Z', { inst: 'Binoculars 10×50', ik: 'bino', alt: 70 }),
        E('a4', 'M13', '2026-07-01T21:00:00.000Z', { inst: 'Dobson 8″', ik: 'scope', ep: '10 mm + 2× · 240×', moon: '80 %, up', seeing: 3 }),
        E('a5', 'NGC 7331', '2026-08-18T23:50:00.000Z', { inst: 'Dobson 8″', ik: 'scope', ep: '25 mm · 48×', result: 'miss' }),
        E('a6', 'Jupiter', '2025-11-20T20:00:00.000Z', { inst: 'Telescope 203 mm f/5.9', alt: 12, note: 'GRS <visible> & bands' }),
        E('a7', 'M45', '2025-11-20T20:30:00.000Z', { inst: 'Naked eye', ik: 'eye' }),
      ];
      saveObs();
      cfg.instruments = [{ id: 'd8', name: 'Dobson 8″', type: 'dob', mount: 'altaz', o: { ...cfg.instruments[0].o, scope: 1200, ap: 203, eps: [{ f: 32, a: 50 }, { f: 25, a: 52 }, { f: 10, a: 52 }], barlow: 2 }, u: 1 },
        { id: 'b1', name: 'Binoculars 10×50', type: 'bino', bino: { mag: 10, ap: 50, fov: 6.5, hold: 'hand' }, u: 1 }];
      cfg.instrumentId = 'd8'; save();
    };
    const p = await page();
    await ev(p, seed);
    await ev(p, () => { openLog(null); }); await wait(p, 500);
    ok(await ev(p, () => !$('logTabs').hidden && $('logEntriesBox').hidden === false && $('logStatsBox').hidden), 'the logbook opens on Entries, with the Statistics tab');
    await p.tap('#logTabs [data-ltab2="stats"]'); await wait(p, 400);
    const o = await ev(p, () => ({ tiles: [...document.querySelectorAll('#logStatsBox .ltiles .v')].map(v => v.textContent), per: [...document.querySelectorAll('#logStatsBox [data-per]')].map(b => b.textContent), line: document.querySelector('#logStatsBox .sline').textContent }));
    ok(o.tiles.join('|') === '5|3|3|86%' && o.per.join('|') === 'All time|Last 12 months|2026|2025' && /First light Nov 20, 2025 with Jupiter · 7 entries/.test(o.line) && /best night Aug 18, 2026, 3 objects/.test(o.line), 'overview: objects, nights, hours, found; periods; first light and best night', o);
    const k = await ev(p, () => ({ cls: [...document.querySelectorAll('#logStatsBox [data-cls]')].map(b => b.dataset.cls + ':' + b.querySelector('.sn').textContent.replace(/\/.*/, '')), inst: [...document.querySelectorAll('#logStatsBox [data-inst]')].map(b => b.dataset.inst + ':' + b.querySelector('.sn').textContent), con: [...document.querySelectorAll('#logStatsBox [data-con]')].map(b => b.dataset.con), recs: [...document.querySelectorAll('#logStatsBox .srec')].map(b => b.querySelector('.k').textContent + ':' + b.querySelector('b').textContent) }));
    ok(k.cls.join() === 'gal:2,open:1,glob:1,sol:1', 'by kind of object', k.cls);
    ok(k.inst[0] === 'Dobson 8″:3' && k.inst.includes('Binoculars 10×50:1') && k.inst.includes('Naked eye:1'), 'by instrument', k.inst);
    ok(k.con.includes('Andromeda') && k.con.includes('Hercules') && k.con.length === 4, 'by constellation (the planet has none)', k.con);
    ok(k.recs.map(r => r.replace(/ · .*/, '')).join() === 'Faintest:M13,Smallest:M13,Lowest:Jupiter,Most often:M13', 'records', k.recs);
    ok(await ev(p, () => /mostly 4/.test($('logStatsBox').textContent) && /Moon was up for 14%/.test($('logStatsBox').textContent) && /Not found yet/.test($('logStatsBox').textContent) && /NGC 7331/.test($('logStatsBox').textContent)), 'seeing, the Moon and not found yet');
    // a period
    await ev(p, () => document.querySelector('#logStatsBox [data-per="y2025"]').click()); await wait(p, 200);
    ok(await ev(p, () => [...document.querySelectorAll('#logStatsBox .ltiles .v')].map(v => v.textContent).join('|')) === '2|1|1|100%', 'a year: its numbers only');
    await ev(p, () => document.querySelector('#logStatsBox [data-per="all"]').click()); await wait(p, 200);
    // tap a kind: the entries filtered, as chips
    await ev(p, () => document.querySelector('#logStatsBox [data-cls="gal"]').click()); await wait(p, 300);
    const f = await ev(p, () => ({ tab: logState.tab, n: document.querySelectorAll('#logBody .lrow').length, chips: [...document.querySelectorAll('#logFilter .chip')].map(c => c.textContent), count: (document.querySelector('#logBody .lcount') || {}).textContent }));
    ok(f.tab === 'entries' && f.n === 3 && f.chips.join('|') === 'Galaxies|+ Filter' && /3 entries · 2 objects · 1 night/.test(f.count), 'a tap on Galaxies shows their entries, with the filter as a chip', f);
    await ev(p, () => { setLogTab('stats'); document.querySelector('#logStatsBox [data-inst="Dobson 8″"]').click(); }); await wait(p, 300);
    ok(await ev(p, () => document.querySelectorAll('#logBody .lrow').length === 3 && [...document.querySelectorAll('#logFilter .chip')].length === 3), 'filters add up: galaxies with the Dobson');
    await ev(p, () => document.querySelector('#logFilter .chip').click()); await wait(p, 200);
    ok(await ev(p, () => document.querySelectorAll('#logBody .lrow').length === 4 && !logState.f.cls), '✕ removes a filter');
    await ev(p, () => setLogFilter({ inst: null, nf: true })); await wait(p, 200);
    ok(await ev(p, () => document.querySelectorAll('#logBody .lrow').length === 1 && /Not found yet/.test($('logFilter').textContent)), 'not found yet: its entries');
    // export: the filtered entries as CSV, everything as OAL (valid against the OAL 2.1 schema)
    await ev(p, () => setLogFilter({ nf: null, cls: 'gal' })); await p.tap('#logExport'); await wait(p, 500);
    ok(await ev(p, () => !$('logExpSheet').hidden && [...document.querySelectorAll('[data-lxs]')].map(b => b.textContent).join('|') === 'All 7|Galaxies (3)' && document.querySelector('[data-lxs="filter"]').getAttribute('aria-checked') === 'true'), 'export: all entries or the filtered ones');
    let dl = p.waitForEvent('download'); await p.tap('#lxCsv'); const csv = fs.readFileSync(await (await dl).path(), 'utf8');
    ok(csv.trim().split('\r\n').length === 4 && /,M31,.*Galaxies,Andromeda,easy/.test(csv) && /kind,constellation/.test(csv), 'CSV of the filtered entries, with kind and constellation', csv.slice(0, 300));
    await ev(p, () => document.querySelector('[data-lxs="all"]').click());
    dl = p.waitForEvent('download'); await p.tap('#lxOal'); const xmlPath = await (await dl).path(), xml = fs.readFileSync(xmlPath, 'utf8');
    const { execFileSync } = require('node:child_process'); let valid = '';
    try { execFileSync('xmllint', ['--noout', '--schema', path.join(__dirname, 'fixtures', 'oal21', 'oal21.xsd'), xmlPath], { stdio: 'pipe' }); valid = 'ok'; } catch (e) { valid = e.code === 'ENOENT' ? 'ok' : String(e.stderr || e.message).slice(0, 600); }   // without xmllint the schema check is skipped
    ok(valid === 'ok', 'OAL export is valid OpenAstronomyLog 2.1', valid);
    ok((xml.match(/<observation /g) || []).length === 7 && (xml.match(/<session /g) || []).length === 3 && /xsi:type="oal:deepSkyGX"/.test(xml) && /PlanetTargetType/.test(xml) && /<seeing>2<\/seeing>/.test(xml)
      && /fixedMagnificationOpticsType"><model>Binoculars 10×50/.test(xml) && /<accessories>2× Barlow lens<\/accessories>/.test(xml) && /GRS &lt;visible&gt; &amp; bands/.test(xml) && /<rating>7<\/rating>/.test(xml), 'OAL: observations, nights, kinds, seeing on the Antoniadi scale, binoculars, Barlow, escaped notes, not found');
    // the year in review
    await p.tap('#lxYearBtn'); await wait(p, 600);
    const yr = await ev(p, () => { const c = $('lxYear'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let lit = 0; for (let i = 0; i < d.length; i += 4 * 97) if (d[i] > 120) lit++; return { w: c.width, h: c.height, lit }; });
    ok(yr.w === 1080 && yr.h === 1350 && yr.lit > 50, 'year in review: a 1080 × 1350 image', yr);
    if (process.env.SHOTS) { await p.screenshot({ path: path.join(process.env.SHOTS, 'ls-year.png') }); fs.writeFileSync(path.join(process.env.SHOTS, 'ls-year-full.png'), Buffer.from((await ev(p, () => $('lxYear').toDataURL())).split(',')[1], 'base64')); }
    dl = p.waitForEvent('download'); await p.tap('#lxYearSave'); const yf = await dl;
    ok(/zenigo-2026-in-review\.png$/.test(yf.suggestedFilename()), 'saved as an image');
    await p.tap('#lxBack'); await wait(p, 200); await p.tap('#lxBack'); await wait(p, 600);
    ok(await ev(p, () => !$('logSheet').hidden && $('logExpSheet').hidden), 'back to the logbook');
    if (process.env.SHOTS) { await ev(p, () => { logState.f = {}; setLogTab('stats'); }); await wait(p, 300); await p.screenshot({ path: path.join(process.env.SHOTS, 'ls-stats.png') });
      await ev(p, () => { scroller($('logSheet')).scrollTop = 700; }); await wait(p, 200); await p.screenshot({ path: path.join(process.env.SHOTS, 'ls-stats2.png') });
      await ev(p, () => { scroller($('logSheet')).scrollTop = 1500; }); await wait(p, 200); await p.screenshot({ path: path.join(process.env.SHOTS, 'ls-stats3.png') }); }
    await done(p);
    // without Pro: the overview and the offer; OAL and the year in review ask for Pro, CSV stays free
    const F = await page({ pro: false });
    await ev(F, seed); await ev(F, () => { openLog(null); setLogTab('stats'); }); await wait(F, 400);
    ok(await ev(F, () => document.querySelectorAll('#logStatsBox .ltiles .v').length === 4 && !!$('logStatsBox').querySelector('.slock') && !$('logStatsBox').querySelector('[data-cls], [data-per]')), 'without Pro: the overview, the rest offered');
    if (process.env.SHOTS) await F.screenshot({ path: path.join(process.env.SHOTS, 'ls-free.png') });
    await ev(F, () => openLogExport()); await wait(F, 400);
    await F.tap('#lxOal'); await wait(F, 400);
    ok(await ev(F, () => !$('proSheet').hidden && /OpenAstronomyLog/.test($('proWhy').textContent)), 'OAL asks for Pro');
    await ev(F, () => { closeSheet('proSheet'); openLogExport(); }); await wait(F, 400);
    dl = F.waitForEvent('download'); await F.tap('#lxCsv'); ok(/\.csv$/.test((await dl).suggestedFilename()), 'CSV stays free');
    await done(F);
  },

  async offline() {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const p = await ctx.newPage(); p.errors = []; p.on('pageerror', e => p.errors.push(String(e)));
    await p.goto(base + '/app/');
    const ready = await p.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise(r => setTimeout(() => r(false), 15000))]));
    ok(ready, 'service worker installed'); if (!ready) return done(p);
    await wait(p, 1500);
    const js = await p.evaluate(async () => { const k = (await caches.keys()).find(x => x.startsWith('zenigo-app-')); const c = await caches.open(k); return (await c.keys()).map(r => r.url).filter(u => u.endsWith('.js')).length; });
    ok(js >= 4, 'all four scripts are cached for offline use', js);
    await ctx.setOffline(true); await p.reload(); await p.waitForFunction(() => !document.getElementById('splash') && !!st.sol, null, { timeout: 15000 });
    ok(await p.evaluate(() => Solver.cat.n > 4000 && !!worker), 'the app starts offline, with catalogue and solver');
    await done(p);
  },

  // Night sky this week (scripts/sky.mjs, content/sky/2026-11-06.json; built with drafts for the tests): the week in
  // English and German as language versions, times in the reader's time zone, links that open the object in the app
  async sky() {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: 'Europe/Berlin', locale: 'de-DE' });
    const p = await ctx.newPage(); p.errors = []; p.on('pageerror', e => p.errors.push(String(e)));
    await p.goto(base + '/sky/2026-11-06/');
    const en = await ev(p, () => ({ h1: document.querySelector('h1').textContent, lang: document.documentElement.lang,
      alt: [...document.querySelectorAll('link[rel=alternate]')].map(l => l.hreflang + ' ' + new URL(l.href).pathname),
      draft: !!document.querySelector('.wk-draft'), noindex: !!document.querySelector('meta[name=robots][content=noindex]'), canon: (document.querySelector('link[rel=canonical]') || {}).href,
      evs: [...document.querySelectorAll('.wk-ev')].map(e => ({ id: e.id, hl: e.classList.contains('hl') })),
      t: document.querySelector('.wk-ev time[data-t]').textContent, tz: document.querySelector('.wk-tz').textContent,
      go: [...document.querySelectorAll('.wk-ev a.open')].map(a => a.getAttribute('href')), rel: [...document.querySelectorAll('.wk-ev a.open')].every(a => a.rel === 'nofollow'),
      moons: document.querySelectorAll('.wk-moons li').length, planets: document.querySelectorAll('.wk-planets tr').length,
      ld: JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent).map(x => x['@type']),
      wide: document.documentElement.scrollWidth > innerWidth }));
    ok(en.h1 === 'Night sky this week: 6–12 November 2026' && en.lang === 'en', 'the week, Friday to Thursday, in English', en.h1);
    ok(en.alt.join('|') === 'en /sky/2026-11-06/|de /de/sky/2026-11-06/|x-default /sky/2026-11-06/', 'language versions linked (hreflang, x-default English)', en.alt);
    ok(!en.draft && !en.noindex && /\/sky\/2026-11-06\/$/.test(en.canon || ''), 'published: no draft mark, indexable, its own canonical address', en);
    ok(en.evs.length === 6 && en.evs[0].hl && en.evs[1].hl && !en.evs[2].hl, 'six events, the highlights first', en.evs);
    ok(/^Sat, 7 Nov, 11:40$/.test(en.t) && /Europe\/Berlin/.test(en.tz), 'times in the reader’s time zone (UTC on the page)', [en.t, en.tz]);
    ok(en.go.includes('/app/#go=Venus&src=week') && en.go.includes('/app/#go=M31&src=week') && en.rel, 'Open in Zenigo: links to the object in the app (nofollow)', en.go);
    ok(en.moons === 7 && en.planets === 7, 'the Moon on each of the 7 evenings, the 7 planets', [en.moons, en.planets]);
    ok(en.ld.join() === 'Article,BreadcrumbList' && !en.wide, 'structured data; fits a phone', en.ld);
    await shot(p, 'sky-week');
    await p.click('.wk-lang'); await p.waitForURL('**/de/sky/2026-11-06/');
    const de = await ev(p, () => ({ h1: document.querySelector('h1').textContent, lang: document.documentElement.lang, head: document.querySelector('header.sitehead').lang, foot: document.querySelector('footer').lang,
      open: document.querySelector('.wk-ev a.open').textContent, planet: document.querySelector('.wk-planets th').textContent }));
    ok(de.h1 === 'Sternenhimmel diese Woche: 6.–12. November 2026' && de.lang === 'de' && de.head === 'en' && de.foot === 'en', 'German: its own page; the English header and footer marked as English', de);
    ok(de.open === 'In Zenigo öffnen' && de.planet === 'Merkur', 'German words', de);
    await p.goto(base + '/sky/archive/');
    const arch = await ev(p, () => [...document.querySelectorAll('.wk-archive a')].map(a => a.getAttribute('href')));
    ok(arch.includes('/sky/2026-11-06/') && arch.join() === [...arch].sort().reverse().join(), 'archive: every week, newest first', arch);
    await p.goto(base + '/sky/');
    ok(await ev(p, () => /^Night sky this week/.test(document.querySelector('h1').textContent) && new URL(document.querySelector('link[rel=alternate][hreflang=de]').href).pathname === '/de/sky/'), '/sky/ (the build’s week here; the Worker serves the week of the day): its own language versions');
    ok(await ev(p, () => !!document.querySelector('.sitemenu a[href="/sky/"]') && !!document.querySelector('footer a[href="/sky/"]')), 'linked from the menu and the footer');
    // the topic pages: Moon calendar, meteor showers, the calendar of the year, linked from the week
    await p.goto(base + '/sky/2026-11-06/'); await p.click('.sky-more a[href="/sky/meteor-showers/taurids/"]'); await p.waitForURL('**/sky/meteor-showers/taurids/');
    const sh = await ev(p, () => ({ h1: document.querySelector('h1').textContent, cur: document.querySelector('.sky-nav [aria-current]').textContent, years: document.querySelectorAll('.wk-planets tbody tr').length,
      t: document.querySelector('.sh-facts time[data-t]').textContent, wide: document.documentElement.scrollWidth > innerWidth }));
    ok(/^Taurids 20\d\d: peak, Moon and where to look$/.test(sh.h1) && sh.cur === 'Meteor showers' && !sh.wide, 'from the week to the Taurids: its page, marked in the navigation, fits a phone', sh);
    ok(!/UTC/.test(sh.t), 'its peak in the reader’s time zone', sh.t);
    await p.goto(base + '/de/sky/moon/2026/');
    const mo = await ev(p, () => { const n = document.querySelector('.sky-nav'), a = n.querySelector('[aria-current]'); return { cur: a.textContent, inView: a.offsetLeft - n.offsetLeft - n.scrollLeft >= 0 && a.offsetLeft - n.offsetLeft - n.scrollLeft + a.offsetWidth <= n.clientWidth + 1,
      months: document.querySelectorAll('h2[id]').length, fulls: [...document.querySelectorAll('.mc-list b')].filter(b => /^Vollmond/.test(b.textContent)).length, wide: document.documentElement.scrollWidth > innerWidth }; });
    ok(mo.cur === 'Mondkalender' && mo.inView && mo.months === 12 && mo.fulls === 13 && !mo.wide, 'Mondkalender 2026: 12 months, 13 full Moons; the navigation shows its item on a phone', mo);
    await shot(p, 'sky-moon');
    await p.goto(base + '/sky/calendar/2026/#2026-08-12-solar-eclipse');
    ok(await ev(p, () => (document.getElementById('2026-08-12-solar-eclipse') || {classList: {contains: () => false}}).classList.contains('hl') && document.querySelectorAll('.cal-hl li').length >= 8 && document.documentElement.scrollWidth <= innerWidth), 'calendar 2026: the eclipse as a highlight and an anchor, the highlights of the year');
    await shot(p, 'sky-calendar');
    ok(p.errors.length === 0, 'no page errors', p.errors); await ctx.close();
    // the app: #go= opens the object (cold start and while open), and is taken out of the address
    const a = await page();
    await ev(a, () => { location.hash = '#go=M31&src=week'; });
    ok(await a.waitForFunction(() => $('infoName').textContent === 'M31 · Andromeda Galaxy' && !location.hash, null, { timeout: 5000 }).then(() => true, () => false), 'open app: #go=M31 shows the Andromeda Galaxy');
    await ev(a, () => { location.hash = '#go=Nowhere'; });
    ok(await a.waitForFunction(() => /isn’t in Zenigo’s catalogue/.test($('hint').textContent), null, { timeout: 15000 }).then(() => true, () => false), 'an unknown object says so');
    const b = await a.context().newPage(); b.errors = []; b.on('pageerror', e => b.errors.push(String(e)));
    await b.goto(base + '/app/#go=Saturn');
    ok(await b.waitForFunction(() => typeof $ === 'function' && $('infoName') && $('infoName').textContent === 'Saturn' && !location.hash, null, { timeout: 15000 }).then(() => true, () => false), 'cold start with #go=Saturn: Saturn’s details');
    await shot(b, 'sky-golink');
    ok(b.errors.length === 0, 'no page errors (cold start)', b.errors);
    await done(a);
  },
};

(async () => {
  const only = process.argv.slice(2);
  const srv = await serve(); base = 'http://localhost:' + srv.address().port;
  PRO_KEY = await proKey('2026-01-01T00:00:00.000Z', '2027-12-31T00:00:00.000Z');
  browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  for (const [name, fn] of Object.entries(TESTS)) {
    if (only.length && !only.includes(name)) continue;
    current = name; const t0 = Date.now(); console.log('• ' + name);
    try { await fn(); } catch (e) { ok(false, 'ran without an exception', String(e).split('\n')[0]); }
    const r = results.filter(x => x.test === name); console.log(`  ${r.filter(x => x.pass).length}/${r.length} passed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }
  await browser.close(); srv.close();
  const failed = results.filter(r => !r.pass);
  console.log(failed.length ? `\n${failed.length} of ${results.length} checks failed` : `\nAll ${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})();
