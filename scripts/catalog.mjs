// Generates src/data.js from the d3-celestial data (BSD-3-Clause), installed via npm.
//   npm run catalog
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const DATA = path.join(path.dirname(require.resolve('d3-celestial/package.json')), 'data');
const OUT = new URL('../src/data.js', import.meta.url);
const ld = f => JSON.parse(readFileSync(path.join(DATA, f), 'utf8'));
const ra = lon => (lon < 0 ? lon + 360 : lon);
const rnd = (x, d) => Number(x.toFixed(d));

// Stars down to mag 6, brightest first, flat as [ra, dec, mag, ...]
const names = ld('starnames.json');
const rows = [];
for (const f of ld('stars.6.json').features) {
  const m = f.properties.mag;
  if (m == null || m > 6.0) continue;
  const [lon, lat] = f.geometry.coordinates;
  rows.push([rnd(ra(lon), 3), rnd(lat, 3), rnd(m, 2), String(f.id)]);
}
rows.sort((a, b) => a[2] - b[2]);
const stars = [], labels = {};
// Designations for tappable stars down to mag 5.5: [proper name, Bayer, Flamsteed, constellation, HIP]
const info = {};
rows.forEach(([a, d, m, hid], i) => {
  stars.push(a, d, m);
  const n = names[hid];
  if (!n) return;
  if (m <= 5.5 && (n.name || n.bayer || n.flam) && /^[A-Z][a-zA-Z]{2}$/.test(n.c)) info[i] = [n.name || '', n.bayer || '', n.flam || '', n.c, +hid];   // + Hipparcos number
  if (n.name && m < 4.5) labels[i] = n.name;
  else if (n.bayer && m < 3.6) labels[i] = n.bayer + ' ' + n.c;
});

// Messier objects with common English names and types
const NAMES = { M1: 'Crab Nebula', M8: 'Lagoon Nebula', M11: 'Wild Duck Cluster', M13: 'Great Hercules Cluster', M16: 'Eagle Nebula', M17: 'Omega Nebula',
  M20: 'Trifid Nebula', M24: 'Sagittarius Star Cloud', M27: 'Dumbbell Nebula', M31: 'Andromeda Galaxy', M33: 'Triangulum Galaxy', M42: 'Orion Nebula',
  M44: 'Beehive Cluster (Praesepe)', M45: 'Pleiades', M51: 'Whirlpool Galaxy', M57: 'Ring Nebula', M64: 'Black Eye Galaxy', M6: 'Butterfly Cluster',
  M7: 'Ptolemy Cluster', M81: "Bode's Galaxy", M82: 'Cigar Galaxy', M97: 'Owl Nebula', M101: 'Pinwheel Galaxy', M104: 'Sombrero Galaxy' };
const TYPES = { s: 'Spiral galaxy', e: 'Elliptical galaxy', i: 'Irregular galaxy', sfr: 'Star-forming region', gc: 'Globular cluster',
  oc: 'Open cluster', pn: 'Planetary nebula', en: 'Emission nebula', rn: 'Reflection nebula', snr: 'Supernova remnant', pos: 'Star field' };
const messier = ld('messier.json').features.map(f => {
  const p = f.properties, [lon, lat] = f.geometry.coordinates;
  return [p.name, rnd(ra(lon), 3), rnd(lat, 3), p.mag ?? null, NAMES[p.name] || p.alt || '', TYPES[p.type] || p.type || '', p.desig || ''];
});

// Constellation lines as flat [ra, dec, ...] polylines
const lines = [];
for (const f of ld('constellations.lines.json').features)
  for (const seg of f.geometry.coordinates) lines.push(seg.flatMap(([lon, lat]) => [rnd(ra(lon), 2), rnd(lat, 2)]));

const js = `const STARS=${JSON.stringify(stars)};\nconst STARLABELS=${JSON.stringify(labels)};\nconst STARINFO=${JSON.stringify(info)};\nconst MESSIER=${JSON.stringify(messier)};\nconst CLINES=${JSON.stringify(lines)};\n`;
writeFileSync(OUT, js);
console.log(`src/data.js: ${rows.length} stars, ${Object.keys(labels).length} names, ${Object.keys(info).length} designations, ${messier.length} Messier, ${lines.length} line strips, ${js.length >> 10} KB`);
