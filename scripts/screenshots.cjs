// Screenshots of the app for the website (help and features pages).
//   npm run build && node scripts/screenshots.cjs [name …]
// Serves dist/, drives the app with Playwright on a fixed night, and writes WebP files to public/img/screens/
// (committed; the build copies them to /img/screens/). The app shows its Pro features with a test licence, so build with
// PRO_TEST_KEY=1 first (as the UI tests do): PRO_TEST_KEY=1 npm run build && node scripts/screenshots.cjs. The live camera is a synthetic image of the real sky drawn
// from the star catalogue, so Locate solves it for real. Needs Playwright (see test/ui.cjs) and Python 3 with Pillow.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), { execFileSync } = require('node:child_process');
let chromium;
for (const p of [process.env.PLAYWRIGHT_PATH, 'playwright', '/opt/npm-tools/node_modules/playwright'].filter(Boolean)) { try { ({ chromium } = require(p)); break; } catch (e) {} }
if (!chromium) { console.error('Playwright not found (see test/ui.cjs).'); process.exit(2); }

const ROOT = path.join(__dirname, '..'), DIST = path.join(ROOT, 'dist'), OUT = path.join(ROOT, 'public', 'img', 'screens');
const TMP = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'zenigo-shots-'));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.bin': 'application/octet-stream' };
function serve() {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.startsWith('/api/')) { res.writeHead(503); return res.end('{}'); }
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(DIST, path.normalize(p));
    if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => srv.listen(0, () => r(srv)));
}

const NIGHT = new Date('2026-10-17T21:30:00+02:00');   // Moon a few days old, low in the west; Saturn up, M31 and Cassiopeia high
const PHONE = { w: 390, h: 844, mobile: true }, TABLET = { w: 1180, h: 820, mobile: false };
let browser, base;

// The synthetic camera: a portrait 720×1280 image of the catalogue stars (to 5.8 mag) around window.__cam
// (R and f, set from the page), with sky glow, noise and a row of trees at the bottom.
function fakeCamera() {
  const W = 720, H = 1280;
  navigator.mediaDevices.getUserMedia = async () => {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
    let still = null, key = null;
    const render = () => {
      const cam = window.__cam;
      if (!cam || typeof Solver === 'undefined' || !Solver.cat) { g.fillStyle = '#05070b'; g.fillRect(0, 0, W, H); return; }
      if (key === cam) { g.drawImage(still, 0, 0); return; }
      key = cam; still = document.createElement('canvas'); still.width = W; still.height = H; const s = still.getContext('2d');
      const bg = s.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#0a0d16'); bg.addColorStop(1, '#1c1a22'); s.fillStyle = bg; s.fillRect(0, 0, W, H);
      const img = s.getImageData(0, 0, W, H), d = img.data;
      let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < d.length; i += 4) { const n = (rnd() + rnd() + rnd() - 1.5) * 5; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
      s.putImageData(img, 0, 0);
      const sol = { R: cam.R, f: cam.f, cx: W / 2, cy: H / 2, w: W, h: H, k1: 0, poly: null };
      s.globalCompositeOperation = 'lighter';
      for (let i = 0; i < Solver.cat.n; i++) {
        const m = Solver.cat.mag[i]; if (m > 5.8) continue;
        const p = Solver.skyToPix(sol, Solver.cat.v[i]); if (!p || p.x < -10 || p.y < -10 || p.x > W + 10 || p.y > H + 10) continue;
        const a = Math.min(1, Math.pow(10, -0.4 * (m - 1.2))), r = 1.6 + 3.2 * Math.max(0, (4.5 - m) / 5.5);
        const gr = s.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.4);
        gr.addColorStop(0, `rgba(255,250,240,${0.35 + 0.65 * a})`); gr.addColorStop(0.4, `rgba(220,225,255,${0.25 * a + 0.08})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
        s.fillStyle = gr; s.beginPath(); s.arc(p.x, p.y, r * 2.4, 0, 7); s.fill();
      }
      s.globalCompositeOperation = 'source-over'; s.fillStyle = '#020203';
      s.beginPath(); s.moveTo(0, H);
      for (let x = 0; x <= W; x += 6) s.lineTo(x, H - 70 - 40 * Math.abs(Math.sin(x / 47)) - 25 * Math.abs(Math.sin(x / 13 + 1)));
      s.lineTo(W, H); s.fill();
      g.drawImage(still, 0, 0);
    };
    render(); setInterval(render, 66);
    const stream = cv.captureStream(15);
    const tr = stream.getVideoTracks()[0], gs = tr.getSettings.bind(tr);
    tr.getSettings = () => Object.assign(gs(), { facingMode: 'environment', width: W, height: H });   // like a phone's back camera
    return stream;
  };
}

async function page(dev = PHONE, { time = NIGHT, cam = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: dev.w, height: dev.h }, isMobile: dev.mobile, hasTouch: dev.mobile, deviceScaleFactor: 2,
    timezoneId: 'Europe/Berlin', locale: 'en-GB', permissions: cam ? ['camera'] : [] });
  const p = await ctx.newPage(); p.errors = []; p.on('pageerror', e => p.errors.push(String(e)));
  await p.clock.install({ time });
  await p.addInitScript(k => { try { if (!localStorage.getItem('zenigo-pro')) localStorage.setItem('zenigo-pro', JSON.stringify([k])); } catch (e) {} }, PRO_KEY);
  if (cam) await p.addInitScript(fakeCamera);
  await p.goto(base + '/app/');
  await p.waitForFunction(() => !document.getElementById('splash') && typeof st !== 'undefined' && !!st.sol, null, { timeout: 20000 });
  // a set-up telescope: 8" Dobson f/6, three eyepieces, a 9×50 finder, pointing down to 12°
  await p.evaluate(() => {
    Object.assign(cfg.optics, { scope: 1200, ap: 200, eps: [{ f: 32, a: 52 }, { f: 15, a: 66 }, { f: 9, a: 66 }], ep: 0, finder: 5.6, finderType: '9x50', telrad: false, ring: true, altMin: 12, altMax: 90 });
    cfg.fov.video = 70; cfg.teleSetAt = Date.now(); cfg.target = null; st.wizSkip = true; save();
    hint(null);
  });
  return p;
}
const ev = (p, fn, arg) => p.evaluate(fn, arg);
const wait = (p, ms = 500) => p.waitForTimeout(ms);
const quiet = p => ev(p, () => { hint(null); document.querySelectorAll('.toast, .hint').forEach(e => e.hidden = true); });

// Point the synthetic camera (and so the telescope) at altitude/azimuth, image up = towards the zenith
async function aim(p, az, alt) {
  await ev(p, ([az, alt]) => {
    const s = mapSolCompute(skyNow().M, 720, 1280, { az, alt, fov: 0 });
    window.__cam = { R: s.R, f: 640 / Math.tan(35 * D2R) };
  }, [az, alt]);
}
async function locate(p) {
  await ev(p, () => startCamera()); await wait(p, 1200);
  await ev(p, () => solveNow());
  await p.waitForFunction(() => !st.busy, null, { timeout: 60000 });
  return ev(p, () => ({ ok: !!st.sol && st.solMode === 'solve', status: $('statusText').textContent }));
}
async function snap(p, name, widths) {
  await quiet(p); await wait(p, 350);
  const png = path.join(TMP, name + '.png'); await p.screenshot({ path: png });
  for (const w of widths) {
    const out = path.join(OUT, `${name}-${w}.webp`);
    execFileSync('python3', ['-c', `import sys\nfrom PIL import Image\nim=Image.open(sys.argv[1]).convert('RGB')\nw=int(sys.argv[3])\nim=im.resize((w,round(im.height*w/im.width)),Image.LANCZOS)\nim.save(sys.argv[2],'WEBP',quality=82,method=6)`, png, out, String(w)]);
  }
  console.log('  ' + name + ' ' + widths.join('/') + (p.errors.length ? '  page errors: ' + p.errors.join('; ') : ''));
}

// numbered badges over parts of the screen (for the help page); points in CSS pixels
async function badges(p, pts) {
  await ev(p, pts => {
    document.querySelectorAll('.shotbadge').forEach(e => e.remove());
    pts.forEach(([n, x, y]) => {
      const b = document.createElement('div'); b.className = 'shotbadge'; b.textContent = n;
      Object.assign(b.style, { position: 'fixed', left: x - 13 + 'px', top: y - 13 + 'px', width: '26px', height: '26px', borderRadius: '50%', zIndex: 99,
        background: '#5ad1ff', color: '#04121a', font: '700 15px/26px system-ui, sans-serif', textAlign: 'center', boxShadow: '0 0 0 2px #04121a, 0 2px 8px rgba(0,0,0,.6)' });
      document.body.append(b);
    });
  }, pts);
}
// where something is on the screen, in CSS pixels
const rect = (p, sel) => ev(p, sel => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; }, sel);
const skyPt = (p, id) => ev(p, id => { const t = skyNow().t, q = Solver.skyToPix(st.sol, targetById(id).vec(t)), [x, y] = P(q.x, q.y), d = fit.dpr; return { x: x / d, y: y / d }; }, id);
const crossPt = p => ev(p, () => { const d = fit.dpr, tp = st.solMode === 'map' ? { x: st.sol.cx, y: st.sol.cy } : telePix(st.sol), [x, y] = P(tp.x, tp.y); return { x: x / d, y: y / d }; });
const targetHoriz = (p, id) => ev(p, id => { const t = skyNow().t; return horiz(targetById(id).vec(t), t); }, id);
// a camera image located near a target (offsets in degrees of azimuth and altitude)
async function located(dev, id, dAz, dAlt, opts = {}) {
  const p = await page(dev, { cam: true, ...opts });
  const h = await targetHoriz(p, id);
  await aim(p, h.az + dAz, h.alt + dAlt);
  const r = await locate(p); if (!r.ok) console.log('  locate failed: ' + r.status);
  await ev(p, id => { selectTarget(id, true); hint(null); }, id);
  return p;
}
const plan = (p, ids, extra) => ev(p, ([ids, extra]) => { obs.list = ids.filter(id => targetById(id)).map((id, i) => ({ id, name: targetById(id).name, added: Date.now() - 864e5 - (ids.length - i) * 6e4 })); Object.assign(cfg, extra || {}); saveObs(); save(); }, [ids, extra]);

const noScope = p => ev(p, () => {
  cfg.optics = JSON.parse(JSON.stringify(OPT_DEF)); cfg.optics.ring = false; cfg.fabLabels = false; cfg.conNames = true;
  setShow(withExtras(PRESETS.eye.show)); clearTarget(); save(); syncSettings(); updateGuide(); lastSig = [];
});

// Pro: the extended catalogue is downloaded by itself with a licence; wait for it (and its message)
const extReady = p => p.waitForFunction(() => !ext.busy && ext.loaded, null, { timeout: 60000 }).catch(() => console.log('  extended catalogue not loaded')).then(() => ev(p, () => hint(null)));
// Pro: a location "Garden" with a recorded horizon: houses to the east, trees elsewhere
const garden = (p, mask = true) => ev(p, mask => {
  const s = addSite(); s.name = 'Garden'; cfg.sky = 'suburb';
  const a = new Float32Array(360);
  for (let i = 0; i < 360; i++) a[i] = 7 + 4 * Math.abs(Math.sin(i / 9)) + 3 * Math.abs(Math.sin(i / 3.1));
  for (let i = 55; i <= 125; i++) a[i] = i < 62 || i > 118 ? 14 : (i > 78 && i < 96 ? 31 : 24);   // the neighbours' roofs
  for (let i = 200; i <= 235; i++) a[i] = Math.max(a[i], 20 + 6 * Math.sin((i - 200) / 35 * Math.PI));   // a tree
  s.horizon = { v: 1, alt: hzEncode(a), at: new Date().toISOString(), how: 'camera' };
  cfg.hzMask = mask; storeSite(); save(); siteChanged(); hint(null);
}, mask);
// Pro: a year of logbook entries with two instruments
const seedLog = p => ev(p, () => {
  const ids = ['M31', 'M57', 'M27', 'M13', 'M92', 'M15', 'M2', 'M33', 'NGC 869', 'NGC 884', 'M45', 'M42', 'M1', 'M35', 'M36', 'M37', 'M38', 'M44', 'M81', 'M82', 'M51', 'M101', 'M3', 'M5', 'M8', 'M20', 'M17', 'M11', 'M22', 'M71', 'NGC 7662', 'NGC 6826', 'NGC 457', 'M52', 'M103', 'NGC 7789', 'M29', 'M39', 'Jupiter', 'Saturn', 'NGC 6543', 'M97', 'M108', 'M65', 'M66'];
  const nights = ['2025-11-14', '2025-11-22', '2025-12-19', '2026-01-17', '2026-02-13', '2026-03-14', '2026-03-21', '2026-04-18', '2026-05-16', '2026-06-12', '2026-07-17', '2026-08-08', '2026-08-15', '2026-09-11', '2026-09-19', '2026-10-09'];
  const insts = ['Dobson 8″', 'Dobson 8″', 'Dobson 8″', 'Binoculars 10×50'];
  let k = 0; obs.log = [];
  nights.forEach((n, ni) => {
    const many = 3 + (ni * 7) % 6;
    for (let j = 0; j < many; j++) {
      const id = ids[(k * 7 + ni) % ids.length], o = targetById(id); k++; if (!o) continue;
      const inst = insts[(ni + j) % insts.length];
      obs.log.push({ uid: 'e' + k, obj: id, name: o.name, t: n + 'T' + String(20 + Math.floor(j / 2)).padStart(2, '0') + ':' + String((j * 23) % 60).padStart(2, '0') + ':00.000Z', inst, ...(inst.startsWith('Bino') ? { ik: 'bino' } : {}),
        seeing: 2 + (ni + j) % 4, result: j % 9 === 8 ? 'miss' : j % 4 === 3 ? 'hard' : 'easy', moon: (ni * 13) % 100 });
    }
  });
  saveObs();
  cfg.instruments = [{ id: 'd8', name: 'Dobson 8″', type: 'dob', mount: 'altaz', o: { ...cfg.optics }, u: 1 },
    { id: 'b1', name: 'Binoculars 10×50', type: 'bino', bino: { mag: 10, ap: 50, fov: 6.5, hold: 'hand' }, u: 1 },
    { id: 'r4', name: 'Refractor 102', type: 'refr', mount: 'altaz', o: { ...cfg.optics, scope: 660, ap: 102, eps: [{ f: 24, a: 68 }, { f: 8, a: 60 }], finder: 0, finderType: 'none' }, u: 1 }];
  cfg.instrumentId = 'd8'; save(); afterSyncedSettings();
});
const SHOTS = {
  // Help: the screen, with numbered parts
  async screen() {
    const p = await located(PHONE, 'M31', -14, 9);
    await wait(p, 600);
    const c = await crossPt(p), t = await skyPt(p, 'M31');
    const dir = await rect(p, '#guide'), menu = await rect(p, '#btnMenu'), fabs = await rect(p, '#fabQuick'), pill = await rect(p, '#tgtChip'), stat = await rect(p, '#statusText'), solve = await rect(p, '#btnSolve');
    await badges(p, [[1, dir.x + 8, dir.y + dir.h + 4], [2, menu.cx, menu.y + menu.h + 6], [3, c.x - 34, c.y - 34], [4, t.x + 30, t.y + 26], [5, fabs.x - 10, fabs.y + 4], [6, pill.x + pill.w + 14, pill.cy], [7, stat.x + stat.w + 18, stat.cy], [8, solve.x - 6, solve.y + 4]]);
    await snap(p, 'screen', [780, 390]);
    await p.context().close();
  },
  // Features: located, without the button labels
  async locate() {
    const p = await located(PHONE, 'M31', -14, 9);
    await ev(p, () => { cfg.fabLabels = false; cfg.optics.telrad = true; save(); syncSettings(); });
    await snap(p, 'locate', [780, 390]);
    await p.context().close();
  },
  // the target in the eyepiece: located close to it, eyepiece view on
  async eyepiece() {
    const p = await located(PHONE, 'M31', -0.15, 0.1);
    await ev(p, () => { cfg.fabLabels = false; cfg.optics.view = true; cfg.optics.telrad = true; save(); zoom.z = 3.2; lastSig = []; updateGuide(); });
    await snap(p, 'eyepiece', [780, 390]);
    await p.context().close();
  },
  async find() {
    const p = await page();
    await ev(p, () => { cfg.searchCats = ['scope', 'now']; save(); $('fabSearch').click(); $('q').blur(); });
    await snap(p, 'find', [780, 390]);
    await p.context().close();
  },
  async details() {
    const p = await page();
    await ev(p, () => { showInfo(targetById('M57')); });
    await wait(p, 600);
    await ev(p, () => { const b = document.querySelector('#infoSheet .nightbox, #infoSheet .nbar'); if (b) b.scrollIntoView({ block: 'center' }); });
    await snap(p, 'details', [780, 390]);
    await p.context().close();
  },
  async tonight() {
    const p = await page();
    await ev(p, () => $('btnTonight').click());
    await snap(p, 'tonight', [780, 390]);
    await p.context().close();
  },
  async list() {
    const p = await page();
    await plan(p, ['M57', 'M27', 'M31', 'NGC 869', 'M15', 'M2', 'Saturn', 'M33'], { listOrder: 'route' });
    await ev(p, () => $('fabList').click());
    await snap(p, 'list', [780, 390]);
    await p.context().close();
  },
  async jupiter() {
    const p = await page();
    await ev(p, () => showInfo(targetById('Jupiter')));
    await wait(p, 600);
    await ev(p, () => { const b = document.querySelector('#infoSheet canvas, #infoSheet svg.moons'); if (b) b.scrollIntoView({ block: 'center' }); });
    await snap(p, 'jupiter', [780, 390]);
    await p.context().close();
  },
  async quick() {
    const p = await page();
    await ev(p, () => $('fabQuick').click());
    await snap(p, 'quick', [780, 390]);
    await p.context().close();
  },
  async red() {
    const p = await located(PHONE, 'M31', -14, 9);
    await ev(p, () => { cfg.fabLabels = false; cfg.red = true; save(); syncSettings(); });
    await snap(p, 'red', [780, 390]);
    await p.context().close();
  },
  async liverole() {
    const p = await page();
    await ev(p, () => { cfg.liveRole = 'scope'; save(); liveSettings(); });
    await wait(p, 500);
    await ev(p, () => $('liveStepRoleHd').scrollIntoView({ block: 'start' }));
    await snap(p, 'live-role', [780, 390]);
    await p.context().close();
  },
  // Tablet following the telescope's phone, with its camera image
  async livefollow() {
    const A = await located(PHONE, 'M31', -14, 9);
    const B = await page(TABLET);
    await ev(A, () => { cfg.liveRole = 'scope'; cfg.liveVideo = true; cfg.fabLabels = false; save(); syncSettings(); });
    await ev(B, () => { cfg.liveRole = 'follow'; cfg.liveShowCam = true; save(); });
    const code = await ev(A, () => liveStart({ noScan: true }));
    const ans = await ev(B, c => liveJoin(c), code);
    await ev(A, async a => liveAnswer(await liveDecode(a)), ans);
    await B.waitForFunction(() => st.solMode === 'remote' && !!st.sol, null, { timeout: 20000 }).catch(() => console.log('  no camera image on the tablet'));
    await ev(B, () => { selectTarget('M31', true); });
    await wait(B, 1200);
    await snap(B, 'live-follow', [1600, 800]);
    await snap(A, 'live-scope', [780, 390]);
    await A.context().close(); await B.context().close();
  },
  // Star finder (no telescope): the camera image named after a Locate, the naked-eye map, a star's details
  // (the telescope settings as after installing, no rings, the naked-eye filter, no target)
  async sfcamera() {
    const p = await page(PHONE, { cam: true });
    const h = await ev(p, () => { const t = skyNow().t, a = horiz(TARGETS.find(x => x.name === 'Deneb').vec(t), t), b = horiz(TARGETS.find(x => x.name === 'Altair').vec(t), t); return { az: (a.az + b.az) / 2, alt: (a.alt + b.alt) / 2 }; });
    await aim(p, h.az, h.alt);
    const r = await locate(p); if (!r.ok) console.log('  locate failed: ' + r.status);
    await noScope(p);
    await snap(p, 'sf-camera', [780, 390]);
    await p.context().close();
  },
  async sfmap() {
    const p = await page();
    await noScope(p);
    await ev(p, () => { st.mapView = { az: 225, alt: 50, fov: 100 }; st.sol = mapSol(); lastSig = []; });
    await snap(p, 'sf-map', [780, 390]);
    await p.context().close();
  },
  async sfstar() {
    const p = await page();
    await noScope(p);
    await ev(p, () => showInfo(TARGETS.find(x => x.name === 'Vega')));
    await wait(p, 600);
    await snap(p, 'sf-star', [780, 390]);
    await p.context().close();
  },
  // a labelled night photo (the test photo: the catalogue sky around Andromeda, with EXIF time and place), and its list
  async photo() {
    const { withExif } = require(path.join(ROOT, 'test', 'exif.cjs'));
    const jpg = withExif(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'sky-andromeda.jpg')), { date: '2026:10:17 21:40:00', offset: '+02:00', lat: 48.18, lon: 10.08, f35: 26 });
    const p = await page();
    await ev(p, b64 => { st.wizSkip = true; obs.log = [{ uid: 'a', obj: 'M31', name: 'M31 · Andromeda Galaxy', t: '2026-09-20T21:00:00Z', result: 'easy' }]; saveObs();
      const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); return loadPhoto(new File([bin], 'IMG_2041.jpg', { type: 'image/jpeg' }), false); }, jpg.toString('base64'));
    await p.waitForFunction(() => ph.on && !st.busy && !!st.photoSol, null, { timeout: 60000 });
    await wait(p, 800);
    await snap(p, 'photo', [780, 390]);
    await p.tap('#phInPhoto'); await wait(p, 800);
    await snap(p, 'photo-list', [780, 390]);
    await p.context().close();
  },
  // planning on a tablet: map with the details panel at the side
  async tablet() {
    const p = await page(TABLET);
    await plan(p, ['M57', 'M27', 'M31', 'NGC 869', 'M15', 'Saturn']);
    await ev(p, () => { showOnMap(targetById('M27')); showInfo(targetById('M27')); });
    await wait(p, 800);
    await snap(p, 'tablet', [1600, 800]);
    await p.context().close();
  },
  // Pro page: each Pro feature
  async prohorizon() {
    const p = await page();
    await extReady(p);
    await garden(p);
    const h = await targetHoriz(p, 'M45');
    await ev(p, h => { cfg.fabLabels = false; save(); syncSettings(); selectTarget('M45', true); st.mapView = { az: h.az + 8, alt: 26, fov: 95 }; st.sol = mapSol(); lastSig = []; hint(null); }, h);
    await wait(p, 600);
    await snap(p, 'pro-horizon', [780, 390]);
    await p.context().close();
  },
  async profree() {
    const p = await page();
    await extReady(p);
    await garden(p);
    await ev(p, () => { cfg.searchCats = ['scope', 'tonight']; save(); $('fabSearch').click(); $('q').blur(); });
    await p.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 60000 });
    await wait(p, 400);
    await snap(p, 'pro-free', [780, 390]);
    await p.context().close();
  },
  async procoming() {
    const p = await page();
    await extReady(p);
    await ev(p, () => $('btnTonight').click());
    await wait(p, 2500);
    await ev(p, () => { const h = [...document.querySelectorAll('#tonightSheet h3, .tn-sec h3')].find(e => /Coming up/.test(e.textContent)); if (h) { const sc = scroller($('tonightSheet')); sc.scrollTop += h.getBoundingClientRect().top - sc.getBoundingClientRect().top - 84; } });
    await snap(p, 'pro-coming', [780, 390]);
    await p.context().close();
  },
  async probest() {
    const p = await page();
    await extReady(p);
    await ev(p, () => { showInfo(targetById('M27')); });
    await wait(p, 600);
    await ev(p, () => { const b = $('infoEp'); if (b) b.scrollIntoView({ block: 'center' }); });
    await snap(p, 'pro-best', [780, 390]);
    await p.context().close();
  },
  async proext() {
    const p = await page();
    await extReady(p);
    const h = await targetHoriz(p, 'NGC 1275');
    await ev(p, ([h, f]) => { clearTarget(); cfg.fabLabels = false; save(); syncSettings(); st.mapView = { az: h.az, alt: h.alt, fov: f }; st.sol = mapSol(); lastSig = []; hint(null); }, [h, 1.6]);
    await wait(p, 900);
    await ev(p, () => { clearTarget(); lastSig = []; });   // the galaxy cluster in Perseus in the 32 mm field
    await snap(p, 'pro-extended', [780, 390]);
    await p.context().close();
  },
  async proprog() {
    const p = await page();
    await extReady(p);
    await seedLog(p);
    await ev(p, () => openProgs('h400'));
    await wait(p, 900);
    await snap(p, 'pro-programmes', [780, 390]);
    await p.context().close();
  },
  async proinst() {
    const p = await page();
    await extReady(p);
    await seedLog(p);
    await ev(p, () => { syncSettings(); openSheet('sheet'); setSetTab('scope'); });
    await wait(p, 600);
    await snap(p, 'pro-instruments', [780, 390]);
    await p.context().close();
  },
  async prostats() {
    const p = await page();
    await extReady(p);
    await seedLog(p);
    await ev(p, () => { openLog(null); setLogTab('stats'); });
    await wait(p, 900);
    await snap(p, 'pro-stats', [780, 390]);
    await p.context().close();
  },
};

// a Zenigo Pro licence signed with the test key (accepted only by a build with PRO_TEST_KEY=1)
let PRO_KEY = null;
(async () => {
  const ZLicence = require('../src/licence.js'), T = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'pro-test-key.json'), 'utf8'));
  PRO_KEY = await ZLicence.sign({ v: 1, id: 'screens', o: 'txn_screens', p: '2026-01-01', s: '2026-01-01T00:00:00.000Z', e: '2030-01-01T00:00:00.000Z' }, T.priv);
  const only = process.argv.slice(2);
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve(); base = 'http://localhost:' + srv.address().port;
  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  for (const [name, fn] of Object.entries(SHOTS)) {
    if (only.length && !only.includes(name)) continue;
    console.log('• ' + name);
    try { await fn(); } catch (e) { console.log('  failed: ' + String(e).split('\n')[0]); }
  }
  await browser.close(); srv.close(); fs.rmSync(TMP, { recursive: true, force: true });
})();
