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
const syncStore = new Map(); let syncOn = true;
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
  '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.bin': 'application/octet-stream', '.txt': 'text/plain' };
function serve() {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.startsWith('/api/sync/v1')) return syncApi(req, res, p);
    if (p.startsWith('/api/')) { res.writeHead(503); return res.end('{}'); }   // no satellites in tests
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
async function page({ w = 390, h = 844, mobile = true, time = NIGHT, perms = [], init } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2,
    timezoneId: 'Europe/Berlin', acceptDownloads: true, permissions: perms });
  const p = await ctx.newPage(); p.errors = [];
  p.on('pageerror', e => p.errors.push(String(e)));
  if (time) await p.clock.install({ time });
  if (init) await p.addInitScript(init);
  await p.goto(base + '/app/'); await p.waitForFunction(() => !document.getElementById('splash') && typeof st !== 'undefined' && !!st.sol, null, { timeout: 15000 });
  await p.evaluate(() => hint(null));
  return p;
}
const ev = (p, fn, arg) => p.evaluate(fn, arg);
const wait = (p, ms = 400) => p.waitForTimeout(ms);
const openSheets = p => ev(p, () => SHEETS.filter(x => !x.hidden && x.classList.contains('open')).map(x => x.id).sort().join('+'));
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
    ok(await ev(p, () => !$('listSheet').hidden && listTab.v === 'seen'), '✕ on details opened from the list returns to the list');
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
    await p.tap('#seenDelete'); await wait(p, 500); await p.tap('#confirmOk'); await wait(p, 500);
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

  // finder types
  async finder() {
    const p = await page();
    await ev(p, () => { cfg.optics.eps = [{ f: 25, a: 52 }]; setOptics({ ep: 0, telrad: false, view: true }); syncSettings(); });
    const set = t => ev(p, t => { $('oFinderType').value = t; $('oFinderType').onchange(); setOptics({ src: 'finder' }); }, t);
    await set('reddot'); await wait(p, 300);
    ok(await ev(p, () => $('epSrc').textContent) === 'Red-dot finder · naked eye', 'red-dot finder: naked-eye finder view');
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
    await p.click('#btnSettings'); await wait(p, 600);
    ok(await openSheets(p) === 'infoSheet+sheet', 'settings replace the menu on the left');
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
    const code = await ev(A, () => liveStart({ noScan: true }));
    ok(/^zenigo-live:1:o[rd]:/.test(code || '') && code.length < 1200, 'device A shows a code (offer) small enough for a QR code', code && code.length);
    ok(await ev(A, () => !$('liveSheet').hidden && !$('liveQrBox').hidden), 'the code is shown as a QR code');
    const ans = await ev(B, c => liveJoin(c), code);
    ok(/^zenigo-live:1:a[rd]:/.test(ans || ''), 'device B answers with its own code', ans && ans.length);
    await ev(A, async a => liveAnswer(await liveDecode(a)), ans);
    await A.waitForFunction(() => live.state === 'connected', null, { timeout: 15000 }).catch(() => {});
    await B.waitForFunction(() => live.state === 'connected' && !!live.peer, null, { timeout: 15000 }).catch(() => {});
    ok(await ev(A, () => live.state === 'connected') && await ev(B, () => live.state === 'connected'), 'both are connected (directly, no server)');
    ok(await ev(B, () => /Connected to/.test($('liveStatus').textContent)), 'the settings say so');
    // A points somewhere (as with Align): B follows it, its directions use A's telescope
    await ev(A, () => { const t = skyNow().t, v = targetById('M13').vec(t), h = horiz(v, t); st.mapView = { az: h.az, alt: h.alt, fov: 30 }; st.sol = Object.assign({}, mapSol(), { approx: false }); st.solMode = 'track'; st.sensor = true; cfg.tele = { x: 0, y: 0 }; });
    await B.waitForFunction(() => !!liveVec(), null, { timeout: 5000 }).catch(() => {});
    const f = await ev(B, () => { const v = liveVec(), m13 = targetById('M13').vec(skyNow().t); return { sep: v ? Solver.angDeg(v, m13) : null, tag: $('srcTag').textContent, map: st.mapView }; });
    ok(f.sep != null && f.sep < 0.5, 'B receives where A’s telescope points', f.sep);
    ok(/Live/.test(f.tag), 'B’s map follows it and says so', f.tag);
    // a target chosen on B becomes A's target; directions on B are from A's telescope
    await ev(B, () => selectTarget('M92', true)); await wait(A, 600);
    ok(await ev(A, () => cfg.target === 'M92'), 'a target chosen on B is the target on A');
    ok(await ev(B, () => !$('guide').classList.contains('idle') && /\d/.test($('azV').textContent)), 'B shows the directions from A’s telescope to the target');
    await ev(A, () => clearTarget()); await wait(B, 600);
    ok(await ev(B, () => !cfg.target), 'clearing it on A clears it on B');
    // ending on one side ends it on both
    await ev(A, () => liveStop()); await wait(B, 800);
    ok(await ev(B, () => live.state !== 'connected' && !liveVec()), 'Disconnect ends it on both devices');
    await done(A); await done(B);
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
    ok(await ev(B, () => $('confirmTitleTxt').textContent.includes('telescope settings') && !$('confirmSheet').hidden), 'different telescope settings: it asks which ones to use');
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
    await ev(A, () => { $('syncBox').querySelector('details').open = true; }); await A.tap('#syncDelete'); await wait(A, 500); await A.tap('#confirmOk'); await wait(A, 800);
    ok(syncStore.size === 0 && await ev(A, () => !syncS.code && obs.log.length >= 2), 'Delete removes the group from the server; the lists stay');
    await ev(B, () => syncNow());
    ok(await ev(B, () => !syncS.code && obs.log.length >= 2 && /Sync stopped/.test($('hint').textContent)), 'the other device notices, stops syncing and says so');
    await done(A); await done(B);
  },

  // offline: the service worker keeps page and scripts
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
};

(async () => {
  const only = process.argv.slice(2);
  const srv = await serve(); base = 'http://localhost:' + srv.address().port;
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
