// Milky Way outlines for the map (filter → Milky Way): converts d3-celestial's mw.json (Milky Way Outline Catalog,
// Jose R. Vieira, http://www.skymap.com/milkyway_cat.htm; d3-celestial (c) Olaf Frohn, BSD-3-Clause) into
// public/app/milkyway.json: five brightness levels, each a list of rings [ra, dec, ra, dec, …] in tenths of a degree,
// simplified to about 0.12° (far below what the map can show).
//   node scripts/milkyway.mjs path/to/mw.json
import { readFileSync, writeFileSync } from 'node:fs';
const src = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const TOL = 0.12;
function simplify(pts) {   // Douglas–Peucker on (ra·cos dec, dec), RA unwrapped along the ring
  const P = []; let off = 0, prev = null;
  for (const [ra, dec] of pts) { let r = ra + off; if (prev != null) { while (r - prev > 180) { off -= 360; r -= 360; } while (r - prev < -180) { off += 360; r += 360; } } P.push([r, dec]); prev = r; }
  const keep = new Uint8Array(P.length); keep[0] = keep[P.length - 1] = 1;
  const xy = ([r, d]) => [r * Math.cos(d * Math.PI / 180), d];
  // a closed ring starts and ends at the same point: split it at the point farthest from the start first
  const [sx, sy] = xy(P[0]); let far = 1, fd = -1;
  P.forEach((q, i) => { const [x, y] = xy(q), d = Math.hypot(x - sx, y - sy); if (d > fd) { fd = d; far = i; } });
  keep[far] = 1;
  const stack = [[0, far], [far, P.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); if (b <= a + 1) continue;
    const [ax, ay] = xy(P[a]), [bx, by] = xy(P[b]), dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-9;
    let best = -1, bd = 0;
    for (let i = a + 1; i < b; i++) { const [x, y] = xy(P[i]); const d = Math.abs(dy * (x - ax) - dx * (y - ay)) / L; if (d > bd) { bd = d; best = i; } }
    if (bd > TOL) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  const out = [];
  P.forEach(([r, d], i) => { if (keep[i]) out.push(Math.round((((r % 360) + 360) % 360) * 10), Math.round(d * 10)); });
  return out;
}
const levels = src.features.sort((a, b) => a.id.localeCompare(b.id)).map(f => f.geometry.coordinates.flatMap(poly => poly.map(simplify)).filter(r => r.length >= 6));
const n = levels.flat().reduce((s, r) => s + r.length / 2, 0);
writeFileSync(new URL('../public/app/milkyway.json', import.meta.url), JSON.stringify({ source: 'Milky Way Outline Catalog, Jose R. Vieira, via d3-celestial (c) Olaf Frohn, BSD-3-Clause', levels }));
console.log('levels', levels.map(l => l.length), 'points', n);
