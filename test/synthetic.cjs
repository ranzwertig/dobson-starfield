// Solve and verify synthetic star fields (noise, hot pixels, planet, missing stars).
// node test/synthetic.cjs [seed] [count per case]
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'src');
eval(fs.readFileSync(path.join(dir, 'data.js'), 'utf8').replace(/^const (\w+)=/gm, 'global.$1='));
const S = require(path.join(dir, 'solver.js'));
S.setCatalog(STARS);
let seed = Number(process.argv[2] || 1);
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());

function render(R, fov, w, h, limMag, opts = {}) {
  const f = (w / 2) / Math.tan(fov / 2 * Math.PI / 180), img = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img[y * w + x] = 30 + 25 * (y / h) + 10 * (x / w) + gauss() * 3;
  const sol = { R, f, cx: w / 2, cy: h / 2 };
  const put = (px, py, flux, sg) => {
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
      const X = Math.round(px) + dx, Y = Math.round(py) + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
      const r2 = (X + 0.5 - px) ** 2 + (Y + 0.5 - py) ** 2; img[Y * w + X] += flux * Math.exp(-r2 / (2 * sg * sg)) / (2 * Math.PI * sg * sg);
    }
  };
  let n = 0;
  for (let i = 0; i < S.cat.n; i++) {
    if (S.cat.mag[i] > limMag) continue;
    const p = S.skyToPix(sol, S.cat.v[i]); if (!p || p.x < 0 || p.y < 0 || p.x >= w || p.y >= h) continue;
    // Extinction/clouds: 10% randomly missing, brightness errors
    if (rnd() < (opts.drop || 0.1)) continue;
    put(p.x + gauss() * 0.3, p.y + gauss() * 0.3, 40 * Math.pow(10, -0.4 * (S.cat.mag[i] - limMag)) * 30 * (1 + 0.3 * gauss()), 1.4); n++;
  }
  put(w * 0.3, h * 0.6, 40 * 30 * 300, 1.6);         // "Jupiter" - not in the catalog
  put(w * 0.7, h * 0.2, 40 * 30 * 20, 1.4);           // plane/satellite
  for (let k = 0; k < 30; k++) img[Math.floor(rnd() * w * h)] += 200;  // hot pixels
  for (let i = 0; i < img.length; i++) img[i] = Math.min(255, img[i]);
  return { img, n };
}
function randRot() {
  // random rotation about a random axis
  const ra = rnd() * 360, dec = Math.asin(2 * rnd() - 1) * 180 / Math.PI, roll = rnd() * 2 * Math.PI;
  const z = S.radec2v(ra, dec), up = Math.abs(z[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  let x = [up[1] * z[2] - up[2] * z[1], up[2] * z[0] - up[0] * z[2], up[0] * z[1] - up[1] * z[0]]; const nx = Math.hypot(...x); x = x.map(a => a / nx);
  let y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  const c = Math.cos(roll), s = Math.sin(roll), X = x.map((a, i) => c * a + s * y[i]), Y = y.map((a, i) => -s * x[i] + c * a);
  return { R: [[X[0], Y[0], z[0]], [X[1], Y[1], z[1]], [X[2], Y[2], z[2]]], ra, dec };
}
const cases = [
  { fov: 65, w: 1280, h: 720, lim: 4.5, known: false },
  { fov: 65, w: 1280, h: 720, lim: 3.8, known: false },
  { fov: 52, w: 1280, h: 960, lim: 5.0, known: false },
  { fov: 65, w: 1280, h: 720, lim: 4.5, known: true },
  { fov: 20, w: 1280, h: 720, lim: 6.0, known: true },
  { fov: 78, w: 1280, h: 720, lim: 4.0, known: false },
];
const N = Number(process.argv[3] || 6);
for (const cs of cases) {
  let ok = 0, err = [], ms = [], fails = [];
  for (let t = 0; t < N; t++) {
    const { R, ra, dec } = randRot();
    const { img, n } = render(R, cs.fov, cs.w, cs.h, cs.lim);
    const t0 = Date.now();
    const st = S.detectStars(img, cs.w, cs.h);
    const td = Date.now() - t0;
    const r = S.solve(st, { w: cs.w, h: cs.h, fov: cs.known ? cs.fov * (1 + 0.004 * gauss()) : null, timeBudget: 120000 });
    ms.push(Date.now() - t0 + '(' + td + ')');
    if (r.ok) {
      const e = S.angDeg(S.radec2v(ra, dec), S.radec2v(r.center.ra, r.center.dec));
      if (e < 0.5) { ok++; err.push(e.toFixed(3) + '/' + r.fov.toFixed(1) + '/' + r.nMatch); } else fails.push('WRONG e=' + e.toFixed(1) + ' n=' + r.nMatch + ' stars=' + n);
    } else fails.push(r.reason + ' det=' + st.length + ' inField=' + n);
  }
  console.log(JSON.stringify(cs), `${ok}/${N}`, '\n  ok:', err.join(' '), '\n  ms:', ms.join(' '), '\n  fail:', fails.join(' | '));
}
