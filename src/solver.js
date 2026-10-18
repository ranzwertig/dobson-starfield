/* ===== Star detection + plate solver (lost-in-space, triangle matching) ===== */
const Solver = (() => {
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;

  function radec2v(ra, dec) {
    const a = ra * D2R, d = dec * D2R, cd = Math.cos(d);
    return [cd * Math.cos(a), cd * Math.sin(a), Math.sin(d)];
  }
  function v2radec(v) {
    const n = Math.hypot(v[0], v[1], v[2]);
    let ra = Math.atan2(v[1], v[0]) * R2D; if (ra < 0) ra += 360;
    return { ra, dec: Math.asin(Math.max(-1, Math.min(1, v[2] / n))) * R2D };
  }
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const angDeg = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * R2D;
  const det3 = (a, b, c) => a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  // R (3x3, row-major array of rows) * v
  const mul = (R, v) => [R[0][0] * v[0] + R[0][1] * v[1] + R[0][2] * v[2], R[1][0] * v[0] + R[1][1] * v[1] + R[1][2] * v[2], R[2][0] * v[0] + R[2][1] * v[1] + R[2][2] * v[2]];
  const mulT = (R, v) => [R[0][0] * v[0] + R[1][0] * v[1] + R[2][0] * v[2], R[0][1] * v[0] + R[1][1] * v[1] + R[2][1] * v[2], R[0][2] * v[0] + R[1][2] * v[1] + R[2][2] * v[2]];

  /* ---------- Rotation from vector pairs (Horn, quaternion) ---------- */
  function jacobiMaxEig(A) {
    const n = 4, a = A.map(r => r.slice()), V = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
    for (let sweep = 0; sweep < 50; sweep++) {
      let off = 0;
      for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
      if (off < 1e-22) break;
      for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-30) continue;
        const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
        for (let k = 0; k < n; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
        for (let k = 0; k < n; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
      }
    }
    let bi = 0; for (let i = 1; i < 4; i++) if (a[i][i] > a[bi][bi]) bi = i;
    return [V[0][bi], V[1][bi], V[2][bi], V[3][bi]];
  }
  // finds R with tgt ≈ R * src
  function fitRotation(src, tgt, w) {
    let Sxx = 0, Sxy = 0, Sxz = 0, Syx = 0, Syy = 0, Syz = 0, Szx = 0, Szy = 0, Szz = 0;
    for (let i = 0; i < src.length; i++) {
      const a = src[i], b = tgt[i], k = w ? w[i] : 1;
      Sxx += k * a[0] * b[0]; Sxy += k * a[0] * b[1]; Sxz += k * a[0] * b[2];
      Syx += k * a[1] * b[0]; Syy += k * a[1] * b[1]; Syz += k * a[1] * b[2];
      Szx += k * a[2] * b[0]; Szy += k * a[2] * b[1]; Szz += k * a[2] * b[2];
    }
    const N = [
      [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
      [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
      [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
      [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz]];
    const [q0, qx, qy, qz] = jacobiMaxEig(N);
    return [
      [q0 * q0 + qx * qx - qy * qy - qz * qz, 2 * (qx * qy - q0 * qz), 2 * (qx * qz + q0 * qy)],
      [2 * (qy * qx + q0 * qz), q0 * q0 - qx * qx + qy * qy - qz * qz, 2 * (qy * qz - q0 * qx)],
      [2 * (qz * qx - q0 * qy), 2 * (qz * qy + q0 * qx), q0 * q0 - qx * qx - qy * qy + qz * qz]];
  }

  /* ---------- Catalog + index ---------- */
  let CAT = null;            // {n, ra, dec, mag, v:[[x,y,z]]}
  const indexCache = {};
  function setCatalog(flat) {
    const n = flat.length / 3, v = new Array(n), ra = new Float32Array(n), dec = new Float32Array(n), mag = new Float32Array(n);
    for (let i = 0; i < n; i++) { ra[i] = flat[3 * i]; dec[i] = flat[3 * i + 1]; mag[i] = flat[3 * i + 2]; v[i] = radec2v(ra[i], dec[i]); }
    CAT = { n, ra, dec, mag, v };
    // grid hash of all stars for fast neighbor lookup
    const cell = 0.035, grid = new Map();
    const key = (x, y, z) => ((x + 40) * 6400 + (y + 40) * 80 + (z + 40));
    for (let i = 0; i < n; i++) {
      const p = v[i], k = key(Math.floor(p[0] / cell), Math.floor(p[1] / cell), Math.floor(p[2] / cell));
      let b = grid.get(k); if (!b) grid.set(k, b = []); b.push(i);
    }
    for (const b of grid.values()) b.sort((p, q) => mag[p] - mag[q]);   // bright first -> stop early
    CAT.grid = grid; CAT.cell = cell; CAT.key = key;
  }
  // nearest catalog star (mag<=maxMag) within rad (degrees, < ~2°)
  function nearest(p, radDeg, maxMag) {
    const c = CAT.cell, ix = Math.floor(p[0] / c), iy = Math.floor(p[1] / c), iz = Math.floor(p[2] / c);
    const cosR = Math.cos(radDeg * D2R); let best = -1, bd = cosR;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const b = CAT.grid.get(CAT.key(ix + dx, iy + dy, iz + dz)); if (!b) continue;
      for (const i of b) { if (CAT.mag[i] > maxMag) break; const d = dot(p, CAT.v[i]); if (d > bd) { bd = d; best = i; } }
    }
    return best;
  }
  function getIndex(maxMag, maxSep) {
    const k = maxMag + '|' + maxSep; if (indexCache[k]) return indexCache[k];
    const ids = []; for (let i = 0; i < CAT.n; i++) if (CAT.mag[i] <= maxMag) ids.push(i);
    const cosMax = Math.cos(maxSep * D2R), nb = ids.map(() => []), pairs = [];
    for (let a = 0; a < ids.length; a++) {
      const va = CAT.v[ids[a]];
      for (let b = a + 1; b < ids.length; b++) {
        const d = dot(va, CAT.v[ids[b]]); if (d < cosMax) continue;
        const s = Math.acos(Math.min(1, d)) * R2D;
        pairs.push([s, ids[a], ids[b]]); nb[a].push([s, ids[b]]); nb[b].push([s, ids[a]]);
      }
    }
    pairs.sort((x, y) => x[0] - y[0]);
    const P = { s: Float32Array.from(pairs, p => p[0]), a: Int32Array.from(pairs, p => p[1]), b: Int32Array.from(pairs, p => p[2]) };
    const NB = new Map();
    ids.forEach((id, j) => { const L = nb[j].sort((x, y) => x[0] - y[0]); NB.set(id, { s: Float32Array.from(L, x => x[0]), id: Int32Array.from(L, x => x[1]) }); });
    return (indexCache[k] = { P, NB, maxMag, maxSep });
  }
  function lowerBound(arr, x) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < x) lo = m + 1; else hi = m; } return lo; }

  /* ---------- Star detection ---------- */
  // gray: Float32Array (w*h), returns [{x,y,flux,peak}]
  // Detect bright, uniform borders (white mats) and fill them with the adjacent image content,
  // so they don't disturb background estimation and star search near the edge.
  function trimFrame(gray, w, h) {
    // a row/column counts as border if almost all pixels share the same value (robust against single outliers)
    const flat = (get, n) => {
      const v = []; for (let i = 0; i < n; i += 3) v.push(get(i));
      const srt = v.slice().sort((a, b) => a - b), med = srt[srt.length >> 1];
      // only bright borders (mats); a uniformly dark sky must not count as a border
      if (med < 200) return false;
      let off = 0; for (const x of v) if (Math.abs(x - med) > 12) off++;
      return off < 0.03 * v.length;
    };
    const row = y => flat(x => gray[y * w + x], w), col = x => flat(y => gray[y * w + x], h);
    let t = 0, b = 0, l = 0, r = 0;
    while (t < h * 0.2 && row(t)) t++;
    while (b < h * 0.2 && row(h - 1 - b)) b++;
    while (l < w * 0.2 && col(l)) l++;
    while (r < w * 0.2 && col(w - 1 - r)) r++;
    if (!(t || b || l || r)) return { gray, box: [0, 0, w, h] };
    // a few pixels of safety margin for the border edge
    const pad = 3; t = t ? t + pad : 0; b = b ? b + pad : 0; l = l ? l + pad : 0; r = r ? r + pad : 0;
    const g = new Float32Array(gray);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const yy = Math.min(h - 1 - b, Math.max(t, y)), xx = Math.min(w - 1 - r, Math.max(l, x));
      if (yy !== y || xx !== x) g[y * w + x] = gray[yy * w + xx];
    }
    return { gray: g, box: [l, t, w - r, h - b] };
  }

  function detectStars(gray0, w, h, opts = {}) {
    const B = opts.block || 32, k = opts.sigma || 5, maxStars = opts.maxStars || 80;
    const { gray, box } = trimFrame(gray0, w, h);
    const bw = Math.ceil(w / B), bh = Math.ceil(h / B), bgB = new Float32Array(bw * bh), sdB = new Float32Array(bw * bh);
    const tmp = [];
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      tmp.length = 0;
      for (let y = by * B; y < Math.min(h, by * B + B); y += 2) for (let x = bx * B; x < Math.min(w, bx * B + B); x += 2) tmp.push(gray[y * w + x]);
      tmp.sort((a, b) => a - b);
      const med = tmp[tmp.length >> 1];
      for (let i = 0; i < tmp.length; i++) tmp[i] = Math.abs(tmp[i] - med);
      tmp.sort((a, b) => a - b);
      bgB[by * bw + bx] = med; sdB[by * bw + bx] = Math.max(0.5, 1.4826 * tmp[tmp.length >> 1]);
    }
    // bilinearly interpolated background
    const bgAt = (x, y, arr) => {
      const fx = Math.max(0, Math.min(bw - 1.001, x / B - 0.5)), fy = Math.max(0, Math.min(bh - 1.001, y / B - 0.5));
      const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0, x1 = Math.min(bw - 1, x0 + 1), y1 = Math.min(bh - 1, y0 + 1);
      return (arr[y0 * bw + x0] * (1 - tx) + arr[y0 * bw + x1] * tx) * (1 - ty) + (arr[y1 * bw + x0] * (1 - tx) + arr[y1 * bw + x1] * tx) * ty;
    };
    const res = new Float32Array(w * h), sig = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; res[i] = gray[i] - bgAt(x, y, bgB); sig[i] = bgAt(x, y, sdB); }
    // Find connected blobs above the threshold (including large, saturated stars)
    const lab = new Int32Array(w * h), cand = [], stack = [], m = 3;
    // Sky noise: median over all blocks. Blocks with much more structure (trees, houses) are foreground.
    const sdSorted = Array.from(sdB).sort((a, b) => a - b), skySd = sdSorted[sdSorted.length >> 1];
    const thr = i => k * sig[i];
    let nextLab = 0;
    for (let y = m; y < h - m; y++) for (let x = m; x < w - m; x++) {
      const i0 = y * w + x; if (lab[i0] || res[i0] < thr(i0)) continue;
      const L = ++nextLab; lab[i0] = L; stack.length = 0; stack.push(i0);
      let area = 0, sf = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, peak = 0, minx = x, maxx = x, miny = y, maxy = y, touches = false, big = false;
      while (stack.length) {
        const i = stack.pop(), px = i % w, py = (i - px) / w, v = res[i];
        area++; if (area > 900) big = true;
        const u = v; sf += u; sx += u * px; sy += u * py; sxx += u * px * px; syy += u * py * py; sxy += u * px * py;
        if (v > peak) peak = v;
        if (px < minx) minx = px; if (px > maxx) maxx = px; if (py < miny) miny = py; if (py > maxy) maxy = py;
        if (px <= box[0] + m || py <= box[1] + m || px >= box[2] - m - 1 || py >= box[3] - m - 1) touches = true;
        const nb = [i - 1, i + 1, i - w, i + w];
        for (const j of nb) if (!lab[j] && res[j] >= thr(j)) { lab[j] = L; stack.push(j); }
      }
      if (big || touches || area < 3) continue;                       // areas, edge, hot pixels
      if (sig[i0] > 2.5 * skySd) continue;                              // in structured foreground (gaps in foliage)
      // Stars are brighter than the surrounding sky. Sky gaps in dark trees are at most as bright as the sky.
      {
        const bxI = Math.min(bw - 1, Math.floor(x / B)), byI = Math.min(bh - 1, Math.floor(y / B)), rB = 3;
        let skyMax = -Infinity;
        for (let yy = Math.max(0, byI - rB); yy <= Math.min(bh - 1, byI + rB); yy++) for (let xx = Math.max(0, bxI - rB); xx <= Math.min(bw - 1, bxI + rB); xx++) { const q = yy * bw + xx; if (sdB[q] <= 2.5 * skySd && bgB[q] > skyMax) skyMax = bgB[q]; }
        let peakAbs = 0; for (let yy = miny; yy <= maxy; yy++) for (let xx = minx; xx <= maxx; xx++) if (gray[yy * w + xx] > peakAbs) peakAbs = gray[yy * w + xx];
        if (peakAbs < skyMax + 4 * skySd) continue;
      }
      const bw2 = maxx - minx + 1, bh2 = maxy - miny + 1;
      if (area < 0.35 * bw2 * bh2 && area > 12) continue;              // ragged (branches)
      const cxp = sx / sf, cyp = sy / sf, vx = sxx / sf - cxp * cxp, vy = syy / sf - cyp * cyp, vxy = sxy / sf - cxp * cyp;
      const tr = vx + vy, dt = Math.sqrt(Math.max(0, (vx - vy) * (vx - vy) / 4 + vxy * vxy));
      const l1 = tr / 2 + dt, l2 = Math.max(1e-3, tr / 2 - dt);
      if (l1 / l2 > 6 && area > 6) continue;                            // elongated (edges, star trails)
      // flux incl. halo (ring up to 2 px around the blob) – size counts too for saturated stars
      cand.push({ x: cxp + 0.5, y: cyp + 0.5, flux: sf + area * k * 0.5 * sig[i0], peak, snr: peak / sig[i0], area });
    }
    cand.sort((a, b) => b.flux - a.flux);
    const out = [];
    for (const c of cand) { if (out.some(o => Math.hypot(o.x - c.x, o.y - c.y) < 6)) continue; out.push(c); if (out.length >= maxStars) break; }
    return out;
  }

  /* ---------- Plate solve ---------- */
  // stars: [{x,y}] sorted by brightness. opts: {w,h, fov (horizontal, degrees) | fovMin, fovMax, timeBudget}
  function solve(stars, opts) {
    if (!CAT) throw new Error('Catalogue missing');
    const t0 = performance.now(), w = opts.w, h = opts.h, cx = w / 2, cy = h / 2;
    const budget = opts.timeBudget || 6000;
    if (stars.length < 4) return { ok: false, reason: 'Too few stars detected (' + stars.length + ')' };
    let fovs;
    if (opts.fov) fovs = [opts.fov];
    else {
      const lo = opts.fovMin || 25, hi = opts.fovMax || 85, start = opts.fovGuess || 62; fovs = [start];
      for (let i = 1; i < 80; i++) { const a = start * Math.pow(1.025, i), b = start / Math.pow(1.025, i); if (a <= hi) fovs.push(a); if (b >= lo) fovs.push(b); if (a > hi && b < lo) break; }
    }
    const known = !!opts.fov;
    let tried = 0, lastReason = 'No match found';
    const cands = [];
    // refine candidate and verify strictly; returns solution or null (reason in lastReason)
    const rejected = [];
    const validate = best => {
      const bc = mul(best.R, [0, 0, 1]);
      if (rejected.some(v => dot(v, bc) > 0.9998)) return null;     // already checked and rejected
      const ref = refine(stars, best, w, h, cx, cy);
      rejected.push(bc);
      const pxDeg = ref.fov / w;
      const M40 = Math.min(stars.length, 40), md = { cx, cy, f: ref.f, k1: ref.k1, poly: ref.poly };
      const cvS = stars.slice(0, M40).map(s => camVecModel(s, md));
      // Cross-check: test the brightest image stars against the catalog with a tight radius
      ref.strict = verify(ref.R, cvS, Math.max(3 * pxDeg, 2.5 * ref.rms), Math.max(best.vMag || 5, 4.5) + 0.5).score;
      // Brightness rank correlation: brighter image points should be brighter catalog stars
      ref.rho = rankCorr(ref.matches.map(mm => stars.find(q => q.x === mm.x && q.y === mm.y).flux), ref.matches.map(mm => -CAT.mag[mm.cat]));
      // Real solutions fit to about 1 pixel; chance matches in star-rich regions are clearly worse
      const rmsMax = Math.max(0.02, 1.6 * pxDeg);
      if (opts.debug) opts.debug(ref, best);
      // Without a known field of view there are many more chances for false matches -> require more stars
      if (!known && (ref.nMatch < 10 || ref.strict < 8)) { lastReason = 'Too few reliable stars (' + ref.nMatch + ')'; return null; }
      if (ref.strict < Math.max(6, Math.ceil(0.25 * M40))) { lastReason = 'Uncertain solution rejected (' + ref.strict + ' stars)'; return null; }
      if (ref.rho < 0.15 && ref.nMatch < 30) { lastReason = 'Uncertain solution rejected (brightness mismatch)'; return null; }
      if (ref.nMatch < 5 || ref.rms > rmsMax) { lastReason = 'Uncertain solution rejected (rms ' + ref.rms.toFixed(2) + '°)'; return null; }
      return ref;
    };
    const done = ref => { ref.ms = performance.now() - t0; ref.tried = tried; ref.ok = true; return ref; };
    // Unknown field of view: scale-free search in a few bands first (fast), then the step-by-step search as a fallback
    if (!known && !opts.noBands) {
      const lo = opts.fovMin || 25, hi = opts.fovMax || 85, guess = Math.min(hi, Math.max(lo, opts.fovGuess || 62));
      const bands = [], ratio = 1.45;
      for (let a = lo; a < hi; a *= ratio) bands.push([a, Math.min(hi, a * ratio * 1.04)]);
      bands.sort((p, q) => Math.abs(Math.log(Math.sqrt(p[0] * p[1]) / guess)) - Math.abs(Math.log(Math.sqrt(q[0] * q[1]) / guess)));
      for (let bi = 0; bi < bands.length * 2; bi++) {
        if (performance.now() - t0 > budget) break;
        const band = bands[bi % bands.length], cap = bi < bands.length ? 4000 : 8000;
        if (opts.onProgress) opts.onProgress({ fov: Math.sqrt(band[0] * band[1]), step: bi + 1, of: bands.length * 2 });
        const r = trySolveBand(stars, w, h, cx, cy, band[0], band[1], t0, budget, performance.now() + cap);
        tried++;
        if (!r || !r.accepted) continue;
        if (r.confident) { const ok = validate(r); if (ok) return done(ok); }
        else cands.push(r);
      }
      cands.sort((p, q) => q.score - p.score);
      for (const c of cands.splice(0, 3)) { const ok = validate(c); if (ok) return done(ok); }
    }
    // With unknown field of view: first a quick pass with little time per step, then a thorough one
    const passes = known ? [Infinity] : [120, 600, Infinity];
    for (let pi = 0; pi < passes.length; pi++) {
      for (let fi = 0; fi < fovs.length; fi++) {
        const fov = fovs[fi];
        if (performance.now() - t0 > budget) break;
        const f = (w / 2) / Math.tan(fov / 2 * D2R);
        if (opts.onProgress) opts.onProgress({ fov, step: pi * fovs.length + fi + 1, of: passes.length * fovs.length });
        const r = trySolve(stars, w, h, cx, cy, f, fov, known, t0, budget, performance.now() + passes[pi]);
        tried++;
        if (!r || !r.accepted) continue;
        if (r.confident) { const ok = validate(r); if (ok) return done(ok); }
        else cands.push(r);
      }
    }
    // No confident candidate: still check the best uncertain ones
    cands.sort((p, q) => q.score - p.score);
    for (const c of cands.slice(0, 4)) { const ok = validate(c); if (ok) return done(ok); }
    return { ok: false, reason: lastReason, tried, ms: performance.now() - t0 };
  }

  function camVec(s, cx, cy, f, k1) {
    let x = (s.x - cx) / f, y = (s.y - cy) / f;
    if (k1) { const q = 1 + k1 * (x * x + y * y); x *= q; y *= q; }
    const n = Math.hypot(x, y, 1); return [x / n, y / n, 1 / n];
  }

  function trySolve(stars, w, h, cx, cy, f, fov, known, t0, budget, stepEnd) {
    const diag = 2 * Math.atan(Math.hypot(w, h) / 2 / f) * R2D;
    const N = Math.min(stars.length, known ? 10 : 8), M = Math.min(stars.length, 40);
    // Index matching the field of view: bright enough that about 3·N catalog stars fall in the field, pairs up to the image diagonal
    const fieldArea = fov * 2 * Math.atan(h / 2 / f) * R2D;
    let triMag = 3.5; while (triMag < 6.0 && countBrighter(triMag) * fieldArea / 41253 < 3 * N) triMag += 0.25;
    const sepSteps = [20, 30, 45, 65, 90, 120]; const maxSepQ = sepSteps.find(x => x >= diag) || 120;
    const idx = getIndex(triMag, maxSepQ);
    const cv = stars.slice(0, M).map(s => camVec(s, cx, cy, f));
    const pxDeg = fov / w;
    const tightR = Math.max(0.15, 5 * pxDeg);
    const matchR = known ? Math.max(0.12, 4 * pxDeg) : Math.max(0.35, 0.012 * fov);
    // Choose limiting magnitude so the field holds about 1.3x as many catalog stars as image stars
    const area = fov * 2 * Math.atan(h / 2 / f) * R2D;
    let vMag = 3.0; while (vMag < 6.5 && countBrighter(vMag) * area / 41253 < 1.3 * M) vMag += 0.25;
    const minSep = Math.max(0.5, fov * 0.03);
    let best = null;
    const tris = [];
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) for (let k = j + 1; k < N; k++) tris.push([i, j, k]);
    tris.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
    let hyp = 0;
    for (const [i, j, k] of tris) {
      const now = performance.now(); if (now - t0 > budget || now > stepEnd) break;
      const dij = angDeg(cv[i], cv[j]), dik = angDeg(cv[i], cv[k]), djk = angDeg(cv[j], cv[k]);
      if (dij < minSep || dik < minSep || djk < minSep || Math.max(dij, dik, djk) > idx.maxSep) continue;
      const tol = d => known ? 0.08 + 0.009 * d : 0.1 + 0.016 * d;
      const chir = Math.sign(det3(cv[i], cv[j], cv[k]));
      const lo = lowerBound(idx.P.s, dij - tol(dij)), hiS = dij + tol(dij);
      const tk = tol(dik), tjk = tol(djk);
      for (let p = lo; p < idx.P.s.length && idx.P.s[p] <= hiS; p++) {
        for (let o = 0; o < 2; o++) {
          const A = o ? idx.P.b[p] : idx.P.a[p], Bs = o ? idx.P.a[p] : idx.P.b[p];
          const L = idx.NB.get(A); if (!L) continue;
          for (let q = lowerBound(L.s, dik - tk); q < L.s.length && L.s[q] <= dik + tk; q++) {
            const C = L.id[q]; if (C === Bs) continue;
            if (Math.abs(angDeg(CAT.v[Bs], CAT.v[C]) - djk) > tjk) continue;
            if (Math.sign(det3(CAT.v[A], CAT.v[Bs], CAT.v[C])) !== chir) continue;
            hyp++;
            const R = fitRotation([cv[i], cv[j], cv[k]], [CAT.v[A], CAT.v[Bs], CAT.v[C]]);
            const minSc = known ? 5 : Math.min(7, 4 + (M >> 3));
            let sc = verify(R, cv, matchR, vMag, Math.max(minSc, best ? Math.min(best.score, minSc + 4) : 0));
            if (sc.score < minSc) continue;
            let RR = R, ff = f;
            if (!known) {   // refine focal length + rotation on the loose matches, then verify strictly
              const q = quickFit(stars, sc.matches, cx, cy, f);
              RR = q.R; ff = q.f;
              const cv2 = stars.slice(0, M).map(s => camVec(s, cx, cy, ff));
              sc = verify(RR, cv2, tightR, vMag);
            }
            if (!best || sc.score > best.score) best = { R: RR, f: ff, fov: 2 * Math.atan(w / 2 / ff) * R2D, score: sc.score, matches: sc.matches };
          }
        }
      }
      if (best && best.score >= Math.max(8, Math.min(14, 0.45 * M))) { best.confident = true; break; }
    }
    if (best) {
      const need = M >= 12 ? 6 : Math.max(4, Math.ceil(M * 0.5));
      best.accepted = best.score >= need;
      if (best.score >= Math.max(need + 2, Math.ceil(0.3 * M))) best.confident = true;
      best.hyp = hyp; best.vMag = vMag;
    }
    return best;
  }

  // Scale-free search over a band of fields of view [fovLo, fovHi]: image triangles are compared by the
  // RATIOS of their sides, so a single pass covers the whole band instead of one pass per field-of-view step.
  function trySolveBand(stars, w, h, cx, cy, fovLo, fovHi, t0, budget, stepEnd) {
    const fovMid = Math.sqrt(fovLo * fovHi), fMid = (w / 2) / Math.tan(fovMid / 2 * D2R);
    const diagHi = 2 * Math.atan(Math.hypot(w, h) / 2 / ((w / 2) / Math.tan(fovHi / 2 * D2R))) * R2D;
    const N = Math.min(stars.length, 8), M = Math.min(stars.length, 40);
    const fieldArea = fovMid * fovMid * h / w;
    let triMag = 3.5; while (triMag < 6.0 && countBrighter(triMag) * fieldArea / 41253 < 3 * N) triMag += 0.25;
    const sepSteps = [20, 30, 45, 65, 90, 120]; const maxSepQ = sepSteps.find(x => x >= diagHi) || 120;
    const idx = getIndex(triMag, maxSepQ);
    const cvMid = stars.slice(0, M).map(s => camVec(s, cx, cy, fMid));
    const kLo = Math.tan(fovLo / 2 * D2R) / Math.tan(fovMid / 2 * D2R), kHi = Math.tan(fovHi / 2 * D2R) / Math.tan(fovMid / 2 * D2R);
    const tris = [];
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) for (let k = j + 1; k < N; k++) tris.push([i, j, k]);
    tris.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
    const extra = [...Array(Math.min(stars.length, N + 4)).keys()];   // candidates for the 4th/5th star
    const need4 = stars.length >= 7 ? 2 : 1;
    const vMagFor = fov => { const area = fov * fov * h / w; let m = 3.0; while (m < 6.5 && countBrighter(m) * area / 41253 < 1.3 * M) m += 0.25; return m; };
    let best = null, hyp = 0;
    for (const [i, j, k] of tris) {
      const now = performance.now(); if (now - t0 > budget || now > stepEnd) break;
      // longest side first, so the ratios are well conditioned
      let a = i, b = j, c = k; const sides = () => [angDeg(cvMid[a], cvMid[b]), angDeg(cvMid[a], cvMid[c]), angDeg(cvMid[b], cvMid[c])];
      let [dab, dac, dbc] = sides();
      if (dac > dab && dac >= dbc) { [b, c] = [c, b]; [dab, dac, dbc] = sides(); }
      else if (dbc > dab && dbc > dac) { [a, c] = [c, a]; [dab, dac, dbc] = sides(); }
      if (dac < 0.12 * dab || dbc < 0.12 * dab) continue;           // too flat / degenerate
      const rac = dac / dab, rbc = dbc / dab, chir = Math.sign(det3(cvMid[a], cvMid[b], cvMid[c]));
      const sLo = dab * kLo * 0.97, sHi = Math.min(idx.maxSep, dab * kHi * 1.03);
      if (sLo > idx.maxSep) continue;
      for (let p = lowerBound(idx.P.s, sLo); p < idx.P.s.length && idx.P.s[p] <= sHi; p++) {
        const sAB = idx.P.s[p], tol = 0.018 * sAB + 0.06, eAC = sAB * rac, eBC = sAB * rbc;
        const cBClo = Math.cos(Math.max(0, eBC - tol) * D2R), cBChi = Math.cos(Math.min(180, eBC + tol) * D2R);
        for (let o = 0; o < 2; o++) {
          const A = o ? idx.P.b[p] : idx.P.a[p], B = o ? idx.P.a[p] : idx.P.b[p], vB = CAT.v[B];
          const L = idx.NB.get(A); if (!L) continue;
          for (let q = lowerBound(L.s, eAC - tol); q < L.s.length && L.s[q] <= eAC + tol; q++) {
            const C = L.id[q]; if (C === B) continue;
            const dBC = dot(vB, CAT.v[C]); if (dBC > cBClo || dBC < cBChi) continue;   // same as |angle(B,C) - eBC| <= tol, without acos
            if (Math.sign(det3(CAT.v[A], CAT.v[B], CAT.v[C])) !== chir) continue;
            // 4th star as a cheap filter: one of the next bright image stars must also have a partner at the right distances
            let found = 0, tried4 = 0;
            for (const d of extra) {
              if (d === a || d === b || d === c) continue;
              if (++tried4 > 4) break;
              const eAD = sAB * angDeg(cvMid[a], cvMid[d]) / dab, eBD = sAB * angDeg(cvMid[b], cvMid[d]) / dab, t4 = 0.022 * sAB + 0.08;
              for (let u = lowerBound(L.s, eAD - t4); u < L.s.length && L.s[u] <= eAD + t4; u++) {
                const D = L.id[u]; if (D === B || D === C) continue;
                if (Math.abs(angDeg(CAT.v[B], CAT.v[D]) - eBD) <= t4) { found++; break; }
              }
              if (found >= need4) break;
            }
            if (found < need4) continue;
            hyp++;
            // scale -> focal length estimate for this hypothesis
            const fEst = fMid * dab / sAB, fovEst = 2 * Math.atan(w / 2 / fEst) * R2D;
            if (fovEst < fovLo * 0.95 || fovEst > fovHi * 1.05) continue;
            const cv = stars.slice(0, M).map(s => camVec(s, cx, cy, fEst));
            const R = fitRotation([cv[a], cv[b], cv[c]], [CAT.v[A], CAT.v[B], CAT.v[C]]);
            const vMag = vMagFor(fovEst), minSc = Math.min(7, 4 + (M >> 3));
            let sc = verify(R, cv, Math.max(0.35, 0.012 * fovEst), vMag, Math.max(minSc, best ? Math.min(best.score, minSc + 4) : 0));
            if (sc.score < minSc) continue;
            const qf = quickFit(stars, sc.matches, cx, cy, fEst);
            const cv2 = stars.slice(0, M).map(s => camVec(s, cx, cy, qf.f));
            const fov2 = 2 * Math.atan(w / 2 / qf.f) * R2D;
            sc = verify(qf.R, cv2, Math.max(0.15, 5 * fov2 / w), vMag);
            if (!best || sc.score > best.score) best = { R: qf.R, f: qf.f, fov: fov2, score: sc.score, matches: sc.matches, vMag };
          }
        }
      }
      if (best && best.score >= Math.max(8, Math.min(14, 0.45 * M))) { best.confident = true; break; }
    }
    if (best) {
      const need = M >= 12 ? 6 : Math.max(4, Math.ceil(M * 0.5));
      best.accepted = best.score >= need;
      if (best.score >= Math.max(need + 2, Math.ceil(0.3 * M))) best.confident = true;
      best.hyp = hyp;
    }
    return best;
  }

  function countBrighter(m) {
    if (!CAT.cum) { CAT.cum = []; for (let k = 0; k <= 70; k++) CAT.cum.push(0); for (let i = 0; i < CAT.n; i++) for (let k = Math.max(0, Math.ceil(CAT.mag[i] * 10)); k <= 70; k++) CAT.cum[k]++; }
    return CAT.cum[Math.max(0, Math.min(70, Math.round(m * 10)))];
  }
  function quickFit(stars, matches, cx, cy, f0) {
    const tgt = matches.map(([, c]) => CAT.v[c]);
    const ev = ff => { const src = matches.map(([m]) => camVec(stars[m], cx, cy, ff)); const R = fitRotation(src, tgt); let e = 0; for (let i = 0; i < src.length; i++) { const d = 1 - dot(mul(R, src[i]), tgt[i]); e += d; } return { R, e }; };
    let a = f0 * 0.9, b = f0 * 1.1; const g = 0.618;
    for (let k = 0; k < 18; k++) { const c1 = b - g * (b - a), c2 = a + g * (b - a); if (ev(c1).e < ev(c2).e) b = c2; else a = c1; }
    const f = (a + b) / 2; return { f, R: ev(f).R };
  }
  function rankCorr(a, b) {
    const n = a.length; if (n < 4) return 0;
    const rk = v => { const idx = v.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]), r = new Array(n); idx.forEach(([, i], k) => r[i] = k); return r; };
    const ra = rk(a), rb = rk(b); let d2 = 0; for (let i = 0; i < n; i++) d2 += (ra[i] - rb[i]) ** 2;
    return 1 - 6 * d2 / (n * (n * n - 1));
  }
  function verify(R, cv, matchR, maxMag, need) {
    const used = new Set(), matches = [];
    for (let m = 0; m < cv.length; m++) {
      if (need && matches.length + (cv.length - m) < need) break;
      const s = mul(R, cv[m]); const c = nearest(s, matchR, maxMag);
      if (c >= 0 && !used.has(c)) { used.add(c); matches.push([m, c]); }
    }
    return { score: matches.length, matches };
  }

  /* ---------- Polynomial correction (like SIP): distortion, cropping, residuals ---------- */
  function polyTerms(x, y, order) {
    const t = [1, x, y];
    if (order >= 2) t.push(x * x, x * y, y * y);
    if (order >= 3) t.push(x * x * x, x * x * y, x * y * y, y * y * y);
    return t;
  }
  function polyEval(P, x, y) { const t = polyTerms(x, y, P.order); let u = 0, v = 0; for (let i = 0; i < t.length; i++) { u += P.A[i] * t[i]; v += P.B[i] * t[i]; } return [u, v]; }
  function lstsq(rows, rhs) {
    const n = rows[0].length, M = Array.from({ length: n }, () => new Float64Array(n + 1));
    for (let r = 0; r < rows.length; r++) { const a = rows[r]; for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) M[i][j] += a[i] * a[j]; M[i][n] += a[i] * rhs[r]; } }
    for (let i = 0; i < n; i++) M[i][i] += 1e-12;
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      [M[c], M[p]] = [M[p], M[c]];
      const d = M[c][c]; if (Math.abs(d) < 1e-18) return null;
      for (let r = 0; r < n; r++) { if (r === c) continue; const q = M[r][c] / d; if (!q) continue; for (let k = c; k <= n; k++) M[r][k] -= q * M[c][k]; }
    }
    return Array.from({ length: n }, (_, i) => M[i][n] / M[i][i]);
  }
  // image coordinate -> ideal tangent plane of the camera
  function camVecModel(s, md) {
    let x = (s.x - md.cx) / md.f, y = (s.y - md.cy) / md.f;
    if (md.poly) [x, y] = polyEval(md.poly, x, y);
    else if (md.k1) { const q = 1 + md.k1 * (x * x + y * y); x *= q; y *= q; }
    const n = Math.hypot(x, y, 1); return [x / n, y / n, 1 / n];
  }
  function fitPoly(stars, matches, R, md, order) {
    const rows = [], U = [], V = [];
    for (const [m, c] of matches) {
      const cc = mulT(R, CAT.v[c]); if (cc[2] <= 0) continue;
      rows.push(polyTerms((stars[m].x - md.cx) / md.f, (stars[m].y - md.cy) / md.f, order)); U.push(cc[0] / cc[2]); V.push(cc[1] / cc[2]);
    }
    const A = lstsq(rows, U), B = lstsq(rows, V);
    return A && B ? { order, A, B } : null;
  }

  function refine(stars, sol, w, h, cx, cy) {
    let f = sol.f, R = sol.R, matches = sol.matches, k1 = 0;
    const M = Math.min(stars.length, 80);
    const fitWith = (ff, kk, mm) => {
      const src = mm.map(([m]) => camVec(stars[m], cx, cy, ff, kk)), tgt = mm.map(([, c]) => CAT.v[c]);
      const RR = fitRotation(src, tgt);
      let e = 0; for (let i = 0; i < src.length; i++) { const d = angDeg(mul(RR, src[i]), tgt[i]); e += d * d; }
      return { R: RR, rms: Math.sqrt(e / src.length) };
    };
    const golden = (fn, a, b, n) => { const g = 0.618; for (let q = 0; q < n; q++) { const c1 = b - g * (b - a), c2 = a + g * (b - a); if (fn(c1) < fn(c2)) b = c2; else a = c1; } return (a + b) / 2; };
    const resid = (RR, ff, kk, mm) => mm.map(([m, c]) => angDeg(mul(RR, camVec(stars[m], cx, cy, ff, kk)), CAT.v[c]));
    const med = arr => { const t = arr.slice().sort((x, y) => x - y); return t[t.length >> 1] || 0; };
    for (let it = 0; it < 6; it++) {
      f = golden(ff => fitWith(ff, k1, matches).rms, f * 0.93, f * 1.07, 28);
      if (matches.length >= 15) k1 = golden(kk => fitWith(f, kk, matches).rms, -0.3, 0.3, 24);   // lens distortion
      R = fitWith(f, k1, matches).R;
      const fov = 2 * Math.atan(w / 2 / f) * R2D, px = fov / w;
      // robust: drop outliers, derive search radius from the median error
      const sg = Math.max(1.5 * px, 1.4826 * med(resid(R, f, k1, matches)));
      const keep = matches.filter((mc, i) => resid(R, f, k1, [mc])[0] < 3 * sg);
      if (keep.length >= 6 && keep.length < matches.length) { matches = keep; R = fitWith(f, k1, matches).R; }
      const cv = stars.slice(0, M).map(s => camVec(s, cx, cy, f, k1));
      const mr = Math.min(0.35, Math.max(2.5 * px, 3.5 * sg));
      const nm = verify(R, cv, mr, Math.max(sol.vMag || 6, 5.5)).matches;
      if (nm.length < 3) break;
      const r2 = resid(R, f, k1, nm), sg2 = Math.max(1.5 * px, 1.4826 * med(r2));
      const nk = nm.filter((_, i) => r2[i] < 3 * sg2);
      matches = nk.length >= 6 ? nk : nm;
    }
    let fin = fitWith(f, k1, matches);
    R = fin.R;
    // Fine correction with polynomial when there are enough stars (cropped photos, wide angle, crops)
    let poly = null;
    if (matches.length >= 18) {
      const md = { cx, cy, f };
      const px = 2 * Math.atan(w / 2 / f) * R2D / w;
      for (let it = 0; it < 6; it++) {
        const order = matches.length >= 35 ? 3 : 2;
        const P = fitPoly(stars, matches, R, md, order); if (!P) break;
        md.poly = P; poly = P;
        const src = matches.map(([m]) => camVecModel(stars[m], md)), tgt = matches.map(([, c]) => CAT.v[c]);
        R = fitRotation(src, tgt);
        const rs = matches.map(([m, c]) => angDeg(mul(R, camVecModel(stars[m], md)), CAT.v[c]));
        const sg = Math.max(1.5 * px, 1.4826 * rs.slice().sort((x, y) => x - y)[rs.length >> 1]);
        const cv = stars.slice(0, M).map(s => camVecModel(s, md));
        const nm = verify(R, cv, Math.min(0.5, Math.max(2.5 * px, 3.5 * sg)), Math.max(sol.vMag || 6, 5.5)).matches;
        const r2 = nm.map(([m, c]) => angDeg(mul(R, cv[m]), CAT.v[c])), sg2 = Math.max(1.5 * px, 1.4826 * r2.slice().sort((x, y) => x - y)[r2.length >> 1]);
        const nk = nm.filter((_, i) => r2[i] < 3 * sg2);
        if (nk.length < 18) break;
        matches = nk;
      }
      if (poly) {
        const md2 = { cx, cy, f, poly };
        const src = matches.map(([m]) => camVecModel(stars[m], md2)), tgt = matches.map(([, c]) => CAT.v[c]);
        R = fitRotation(src, tgt);
        let e = 0; for (let i = 0; i < src.length; i++) { const d = angDeg(mul(R, src[i]), tgt[i]); e += d * d; }
        fin = { R, rms: Math.sqrt(e / src.length) };
        k1 = 0;
      }
    }
    const fov = 2 * Math.atan(w / 2 / f) * R2D;
    const center = v2radec(mul(R, camVecModel({ x: cx, y: cy }, { cx, cy, f, poly, k1 })));
    return { R, f, k1, poly, fov, fovV: 2 * Math.atan(h / 2 / f) * R2D, w, h, cx, cy, center, rms: fin.rms, nMatch: matches.length, matches: matches.map(([m, c]) => ({ x: stars[m].x, y: stars[m].y, cat: c })) };
  }

  /* ---------- Fast continuous mode: verify a predicted orientation instead of searching ---------- */
  // prior: a previous solution (same camera, same image size) with R replaced by the predicted orientation.
  // Matches the detected stars with shrinking radii; camera model (f, distortion) stays fixed.
  function solveNear(stars, prior, opts = {}) {
    if (!CAT) throw new Error('Catalogue missing');
    const t0 = performance.now();
    const fail = reason => ({ ok: false, reason, near: true, ms: performance.now() - t0 });
    if (!prior || !prior.R || !prior.f) return fail('No previous solution');
    if (stars.length < 5) return fail('Too few stars detected (' + stars.length + ')');
    const { w, h, cx, cy, f } = prior, md = { cx, cy, f, k1: prior.k1 || 0, poly: prior.poly || null };
    const pxDeg = prior.fov / w, M = Math.min(stars.length, 60);
    const cv = stars.slice(0, M).map(s => camVecModel(s, md));
    const maxMag = Math.min(6, Math.max(4.5, opts.maxMag || 5.5));
    const med = a => { const t = a.slice().sort((x, y) => x - y); return t[t.length >> 1] || 0; };
    let R = prior.R, matches = [];
    const start = Math.min(1.9, Math.max(0.3, opts.radius || 1.9));
    const radii = [start, start * 0.45, Math.max(0.12, start * 0.2), Math.max(3 * pxDeg, 0.04)];
    for (const r of radii) {
      for (let it = 0; it < 3; it++) {
        const nm = verify(R, cv, r, maxMag).matches;
        if (nm.length < 4) return fail('Too few stars near the prediction (' + nm.length + ')');
        let mm = nm;
        // drop outliers relative to the median error before fitting
        const res = nm.map(([m, c]) => angDeg(mul(R, cv[m]), CAT.v[c])), lim = Math.max(2 * pxDeg, 3 * med(res));
        const keep = nm.filter((_, i) => res[i] <= lim); if (keep.length >= 4) mm = keep;
        R = fitRotation(mm.map(([m]) => cv[m]), mm.map(([, c]) => CAT.v[c]));
        const same = matches.length === mm.length && mm.every((x, i) => x[0] === matches[i][0] && x[1] === matches[i][1]);
        matches = mm; if (same) break;
      }
    }
    let e = 0; for (const [m, c] of matches) { const d = angDeg(mul(R, cv[m]), CAT.v[c]); e += d * d; }
    const rms = Math.sqrt(e / matches.length);
    const need = Math.max(6, Math.ceil(0.2 * Math.min(M, 40)));
    if (matches.length < need) return fail('Too few matching stars (' + matches.length + ')');
    if (rms > Math.max(0.02, 2 * pxDeg)) return fail('Prediction did not fit (rms ' + rms.toFixed(2) + '°)');
    const center = v2radec(mul(R, camVecModel({ x: cx, y: cy }, md)));
    return {
      ok: true, near: true, R, f, k1: md.k1, poly: md.poly, fov: prior.fov, fovV: prior.fovV, w, h, cx, cy, center, rms,
      nMatch: matches.length, strict: matches.length, matches: matches.map(([m, c]) => ({ x: stars[m].x, y: stars[m].y, cat: c })),
      tried: 1, ms: performance.now() - t0
    };
  }

  /* ---------- Projection sky <-> image for a solution ---------- */
  function skyToPix(sol, v) {
    const c = mulT(sol.R, v); if (c[2] <= 0.05) return null;
    let x = c[0] / c[2], y = c[1] / c[2];
    const outside = (u, v) => { const X = sol.cx + sol.f * u, Y = sol.cy + sol.f * v; return X < -0.15 * sol.w || Y < -0.15 * sol.h || X > 1.15 * sol.w || Y > 1.15 * sol.h; };
    if (sol.poly && outside(x, y)) {   // polynomial only valid inside the image – outside, plain pinhole model
    } else if (sol.poly) {   // invert polynomial numerically
      const U = x, V = y;
      for (let q = 0; q < 12; q++) { const [pu, pv] = polyEval(sol.poly, x, y); x += U - pu; y += V - pv; }
      const [pu, pv] = polyEval(sol.poly, x, y); if (Math.abs(pu - U) + Math.abs(pv - V) > 1e-3) return null;
    } else if (sol.k1) { const ru = Math.hypot(x, y); let rd = ru; for (let q = 0; q < 8; q++) rd = ru / (1 + sol.k1 * rd * rd); const sc = ru > 0 ? rd / ru : 1; if (!(sc > 0.2 && sc < 5)) return null; x *= sc; y *= sc; }
    return { x: sol.cx + sol.f * x, y: sol.cy + sol.f * y, z: c[2] };
  }
  function pixToSky(sol, x, y) { return mul(sol.R, camVecModel({ x, y }, sol)); }

  return { setCatalog, detectStars, solve, solveNear, skyToPix, pixToSky, radec2v, v2radec, angDeg, fitRotation, mul, mulT, get cat() { return CAT; } };
})();
if (typeof module !== 'undefined') module.exports = Solver;
