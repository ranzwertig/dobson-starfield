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

// ---------- static server for dist/ ----------
const DIST = path.join(__dirname, '..', 'dist');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.bin': 'application/octet-stream', '.txt': 'text/plain' };
function serve() {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
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
    const c = await ev(p, () => { const q = Solver.skyToPix(st.sol, objById('M13').vec(skyNow().t)), [x, y] = P(q.x, q.y); return [Math.abs(x - view.width / 2), Math.abs(y - view.height / 2), st.mapView.fov]; });
    ok(c[0] < 5 && c[1] < 5 && c[2] >= 20 && c[2] <= 40, 'Show on map centres the object at 20–40°', c);
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
    const bad = await ev(p, async () => {
      cfg.show = { ...cfg.show, stars: false, solar: false, gal: false, glob: false, open: false, neb: false, pn: false, ngc: false }; cfg.conLines = false; cfg.target = null; st.filterVer++;
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
