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
    await ev(p, () => { $('listSheet').querySelector('.inner').scrollTop = 300; }); await wait(p, 100);
    const id = await ev(p, () => [...document.querySelectorAll('#listBody .orow')][6].dataset.id);
    await p.tap(`#listBody .orow[data-id="${id}"] .omain`); await wait(p, 500);
    ok(await ev(p, () => !$('infoBack').hidden), 'details from the list have a back arrow');
    await p.tap('#infoBack'); await wait(p, 600);
    const back = await ev(p, () => [!$('listSheet').hidden, listTab.v, $('listSheet').querySelector('.inner').scrollTop]);
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
