// Draws the website's hero chart from the app's own catalogue: the sky around Andromeda and
// Cassiopeia as the app shows it, with the telescope crosshair, the target ring on M31 and the arrow.
// Gnomonic projection, north up, east left (as seen in the sky).
const D2R = Math.PI / 180;

export function heroSvg({ STARS, STARLABELS, MESSIER, CLINES }) {
  const W = 1000, H = 760, ra0 = 22 * D2R, de0 = 46 * D2R, f = (W / 2) / Math.tan(27 * D2R);
  const proj = (raDeg, deDeg) => {
    const ra = raDeg * D2R, de = deDeg * D2R, dra = ra - ra0;
    const cosc = Math.sin(de0) * Math.sin(de) + Math.cos(de0) * Math.cos(de) * Math.cos(dra);
    if (cosc < 0.2) return null;
    const xi = Math.cos(de) * Math.sin(dra) / cosc;
    const eta = (Math.cos(de0) * Math.sin(de) - Math.sin(de0) * Math.cos(de) * Math.cos(dra)) / cosc;
    return [W / 2 - xi * f, H / 2 - eta * f];
  };
  const inside = (p, m = 0) => p && p[0] > -m && p[1] > -m && p[0] < W + m && p[1] < H + m;
  const r1 = v => Math.round(v * 10) / 10;
  const out = [];

  // telescope crosshair and target first: labels keep clear of them
  const m31 = MESSIER.find(m => m[0] === 'M31'), tp = proj(m31[1], m31[2]);
  const cx = Math.round(W * 0.43), cy = Math.round(H * 0.42);
  const near = (x, y, d) => Math.hypot(x - cx, y - cy) < d || Math.hypot(x - tp[0], y - tp[1]) < d
    || distSeg(x, y, cx, cy, tp[0], tp[1]) < d * 0.6;
  function distSeg(x, y, x1, y1, x2, y2) { const vx = x2 - x1, vy = y2 - y1, t = Math.max(0, Math.min(1, ((x - x1) * vx + (y - y1) * vy) / (vx * vx + vy * vy))); return Math.hypot(x - x1 - t * vx, y - y1 - t * vy); }

  // constellation lines
  const seg = [];
  for (const L of CLINES) {
    let prev = null;
    for (let i = 0; i < L.length; i += 2) {
      const p = proj(L[i], L[i + 1]);
      if (p && prev && (inside(p, 200) || inside(prev, 200))) seg.push(`M${r1(prev[0])} ${r1(prev[1])}L${r1(p[0])} ${r1(p[1])}`);
      prev = p;
    }
  }
  out.push(`<path class="cl" d="${seg.join('')}"/>`);

  // stars, brightest last so they sit on top
  const stars = [];
  for (let k = 0; k < STARS.length / 3; k++) {
    const m = STARS[3 * k + 2]; if (m > 5.6) break;
    const p = proj(STARS[3 * k], STARS[3 * k + 1]); if (!inside(p, 4)) continue;
    stars.push(`<circle cx="${r1(p[0])}" cy="${r1(p[1])}" r="${r1(Math.max(1, (6.3 - m) * 1.15))}"${m > 4.5 ? ' class="f"' : ''}/>`);
  }
  out.push(`<g class="st">${stars.reverse().join('')}</g>`);

  // a few names
  const names = [];
  for (const [i, nm] of Object.entries(STARLABELS)) {
    const k = +i; if (STARS[3 * k + 2] > 2.9 || /\s/.test(nm) && nm.length < 4) continue;
    const p = proj(STARS[3 * k], STARS[3 * k + 1]); if (!inside(p, -60) || near(p[0], p[1], 80)) continue;
    names.push(`<text x="${r1(p[0] + 14)}" y="${r1(p[1] + 8)}">${nm}</text>`);
  }
  out.push(`<g class="nm">${names.join('')}</g>`);

  // Messier objects nearby (dashed), the target M31 as a ring
  const dsos = [];
  for (const [id, ra, de] of MESSIER) {
    if (id === 'M31' || id === 'M32' || id === 'M110') continue;
    const p = proj(ra, de); if (!inside(p, -40) || near(p[0], p[1], 70)) continue;
    dsos.push(`<circle cx="${r1(p[0])}" cy="${r1(p[1])}" r="11"/><text x="${r1(p[0] + 15)}" y="${r1(p[1] - 12)}">${id}</text>`);
  }
  out.push(`<g class="dso">${dsos.join('')}</g>`);

  // arrow from the crosshair to the target
  const dx = tp[0] - cx, dy = tp[1] - cy, d = Math.hypot(dx, dy), ux = dx / d, uy = dy / d;
  const ax = cx + ux * 34, ay = cy + uy * 34, bx = tp[0] - ux * 40, by = tp[1] - uy * 40, a = Math.atan2(dy, dx);
  const head = [[bx, by], [bx - 24 * Math.cos(a - 0.45), by - 24 * Math.sin(a - 0.45)], [bx - 24 * Math.cos(a + 0.45), by - 24 * Math.sin(a + 0.45)]];
  out.push(`<g class="tg"><circle cx="${r1(tp[0])}" cy="${r1(tp[1])}" r="30"/><text x="${r1(tp[0] + 38)}" y="${r1(tp[1] - 22)}">M31</text>`
    + `<path d="M${r1(ax)} ${r1(ay)}L${r1(bx)} ${r1(by)}"/><path class="hd" d="M${head.map(p => r1(p[0]) + ' ' + r1(p[1])).join('L')}Z"/></g>`);
  out.push(`<g class="cr"><circle cx="${cx}" cy="${cy}" r="26"/><path d="M${cx} ${cy - 40}V${cy - 15}M${cx} ${cy + 15}V${cy + 40}M${cx - 40} ${cy}H${cx - 15}M${cx + 15} ${cy}H${cx + 40}"/></g>`);

  return `<svg class="sky" viewBox="0 0 ${W} ${H}" role="img" aria-label="Star chart around the Andromeda Galaxy with the telescope crosshair and an arrow to the target">${out.join('')}</svg>`;
}
