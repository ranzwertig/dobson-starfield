// Generates src/data.js from the d3-celestial data (BSD-3-Clause), installed via npm.
//   npm run catalog
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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
const dimMax = d => { const v = String(d || '').split(/x/i).map(Number).filter(x => x > 0); return v.length ? rnd(Math.max(...v), 1) : null; };   // arcmin
const messier = ld('messier.json').features.map(f => {
  const p = f.properties, [lon, lat] = f.geometry.coordinates;
  return [p.name, rnd(ra(lon), 3), rnd(lat, 3), p.mag ?? null, NAMES[p.name] || p.alt || '', TYPES[p.type] || p.type || '', p.desig || '', dimMax(p.dim)];
});

// Constellation lines as flat [ra, dec, ...] polylines
// Constellation names at their label positions: [name, ra, dec, rank] (rank 1 = prominent, 3 = faint/small)
const cfeat = ld('constellations.json').features;
const cnames = cfeat.map(f => { const [lon, lat] = f.geometry.coordinates; return [f.properties.name, rnd(ra(lon), 2), rnd(lat, 2), +f.properties.rank || 3]; });
// Constellation lines; CLCON gives each line's constellation (index into CNAMES), for the list of what is in a photo
const lines = [], lineCon = [], conIdx = new Map(cfeat.map((f, i) => [f.id, i]));
for (const f of ld('constellations.lines.json').features)
  for (const seg of f.geometry.coordinates) { lines.push(seg.flatMap(([lon, lat]) => [rnd(ra(lon), 2), rnd(lat, 2)])); lineCon.push(conIdx.get(f.id) ?? -1); }

const js = `const STARS=${JSON.stringify(stars)};\nconst STARLABELS=${JSON.stringify(labels)};\nconst STARINFO=${JSON.stringify(info)};\nconst MESSIER=${JSON.stringify(messier)};\nconst CLINES=${JSON.stringify(lines)};\nconst CNAMES=${JSON.stringify(cnames)};\nconst CLCON=${JSON.stringify(lineCon)};\n`;
writeFileSync(OUT, js);

// ---------- Deep catalogue, loaded by the app after start (map zoomed in, eyepiece view, search) ----------
// Stars fainter than 6 down to 9 mag (Hipparcos, via d3-celestial), binary, brightest first:
// per star 7 bytes: RA as uint24 (0..360°), Dec as uint24 (-90..90°), magnitude as uint8 ((m + 2) * 20)
mkdirSync(new URL('../public/app/', import.meta.url), { recursive: true });
const deep = ld('stars.14.json').features.filter(f => f.properties.mag > 6.0 && f.properties.mag <= 9.0)
  .map(f => [ra(f.geometry.coordinates[0]), f.geometry.coordinates[1], f.properties.mag]).sort((a, b) => a[2] - b[2]);
const buf = Buffer.alloc(deep.length * 7), U24 = 16777215;
deep.forEach(([a, d, m], i) => {
  const o = i * 7, A = Math.round(a / 360 * U24) % (U24 + 1), D = Math.round((d + 90) / 180 * U24);
  buf.writeUIntLE(A, o, 3); buf.writeUIntLE(D, o + 3, 3); buf.writeUInt8(Math.max(0, Math.min(255, Math.round((m + 2) * 20))), o + 6);
});
writeFileSync(new URL('../public/app/deep-stars.bin', import.meta.url), buf);
// Deep-sky objects beyond Messier: NGC, IC and other catalogues; galaxies to 12 mag, everything else to 11.5 mag.
// Objects that are Messier objects (by NGC/IC number) are left out. Row: [id, ra, dec, mag, class, size arcmin, name, type]
const DTYPES = { s: 'Spiral galaxy', s0: 'Lenticular galaxy', e: 'Elliptical galaxy', i: 'Irregular galaxy', g: 'Galaxy', gg: 'Galaxy group',
  gc: 'Globular cluster', oc: 'Open cluster', pn: 'Planetary nebula', bn: 'Bright nebula', rn: 'Reflection nebula', en: 'Emission nebula',
  sfr: 'Star-forming region', snr: 'Supernova remnant' };
const CLS = { s: 'gal', s0: 'gal', e: 'gal', i: 'gal', g: 'gal', gg: 'gal', gc: 'glob', oc: 'open', pn: 'pn', bn: 'neb', rn: 'neb', en: 'neb', sfr: 'neb', snr: 'neb' };
const inMessier = new Set(messier.flatMap(m => String(m[6]).split(/[\/,]/).map(x => x.trim()).filter(Boolean)));
const dnames = ld('dsonames.json');
const dso = ld('dsos.14.json').features.filter(f => {
  const p = f.properties, m = parseFloat(p.mag);
  return CLS[p.type] && m > 0 && !/^M /.test(f.id) && !inMessier.has(f.id) && m <= (CLS[p.type] === 'gal' ? 12 : 11.5);
}).map(f => {
  const p = f.properties, [lon, lat] = f.geometry.coordinates;
  return [f.id, rnd(ra(lon), 3), rnd(lat, 3), rnd(parseFloat(p.mag), 1), CLS[p.type], dimMax(p.dim), (dnames[f.id] && dnames[f.id].name) || '', DTYPES[p.type]];
}).sort((a, b) => a[3] - b[3]);
writeFileSync(new URL('../public/app/dso.json', import.meta.url), JSON.stringify(dso));
console.log(`public/app/deep-stars.bin: ${deep.length} stars to 9 mag, ${buf.length >> 10} KB; public/app/dso.json: ${dso.length} deep-sky objects`);
console.log(`src/data.js: ${rows.length} stars, ${Object.keys(labels).length} names, ${Object.keys(info).length} designations, ${messier.length} Messier, ${lines.length} line strips, ${js.length >> 10} KB`);
