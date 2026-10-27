// The extended catalogue of Zenigo Pro: downloaded once per device by the app (only with Pro), kept apart from the
// app's offline cache. Writes (committed; the build serves them under content-named file names):
//   public/app/ext/dso.json   NGC and IC objects that the free catalogue lacks, from OpenNGC (Mattia Verga, CC-BY-SA-4.0,
//                             https://github.com/mattiaverga/OpenNGC). Row: [id, ra, dec, mag | null, class, size arcmin | null,
//                             name, type, major axis, minor axis, position angle] (the shape only for galaxies with axes)
//   public/app/ext/stars.bin  stars fainter than the free catalogue down to magnitude 11, from AT-HYG v3.2 (Tycho-2 and
//                             Hipparcos with Gaia DR3 positions; David Nash, CC BY-SA 4.0, https://codeberg.org/astronexus/athyg),
//                             in the format of deep-stars.bin: 7 bytes per star, brightest first
//   node scripts/extended.mjs path/to/OpenNGC/NGC.csv path/to/athyg_32_reduced_m11.csv.gz
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = new URL('../', import.meta.url), require = createRequire(import.meta.url);
const [ngcCsv, athyg] = process.argv.slice(2);
if (!ngcCsv || !athyg) { console.error('node scripts/extended.mjs NGC.csv athyg_32_reduced_m11.csv.gz'); process.exit(2); }
mkdirSync(new URL('public/app/ext/', root), { recursive: true });

// ---------- deep-sky objects ----------
const dso = JSON.parse(readFileSync(new URL('public/app/dso.json', root), 'utf8'));
const lists = JSON.parse(readFileSync(new URL('public/app/lists.json', root), 'utf8'));
const MESSIER = JSON.parse(readFileSync(new URL('src/data.js', root), 'utf8').match(/const MESSIER=(\[.*?\]);/s)[1]);
const have = new Set(dso.map(d => d[0]).concat(lists.extra.map(d => d[0])));
MESSIER.forEach(r => String(r[6] || '').split(/[,/]/).map(s => s.trim()).filter(Boolean).forEach(d => have.add(d)));
const csv = readFileSync(ngcCsv, 'utf8').split('\n').filter(Boolean);
const head = csv[0].split(';'), col = n => head.indexOf(n);
const hms = s => { const [h, m, x] = s.split(':').map(Number); return (h + m / 60 + x / 3600) * 15; };
const dms = s => { const sg = s[0] === '-' ? -1 : 1, [d, m, x] = s.replace(/^[+-]/, '').split(':').map(Number); return sg * (d + m / 60 + x / 3600); };
const CLS = { G: 'gal', GPair: 'gal', GTrpl: 'gal', GGroup: 'gal', OCl: 'open', '*Ass': 'open', GCl: 'glob', PN: 'pn', HII: 'neb', EmN: 'neb', RfN: 'neb', Neb: 'neb', SNR: 'neb', 'Cl+N': 'neb' };
const TYPE = { OCl: 'Open cluster', '*Ass': 'Stellar association', GCl: 'Globular cluster', PN: 'Planetary nebula', HII: 'Emission nebula', EmN: 'Emission nebula',
  RfN: 'Reflection nebula', Neb: 'Nebula', SNR: 'Supernova remnant', 'Cl+N': 'Cluster with nebula', GPair: 'Galaxy pair', GTrpl: 'Galaxy triplet', GGroup: 'Galaxy group' };
const galType = h => /^S0|^E-S0/.test(h) ? 'Lenticular galaxy' : /^S/.test(h) ? 'Spiral galaxy' : /^E/.test(h) ? 'Elliptical galaxy' : /^I/.test(h) ? 'Irregular galaxy' : 'Galaxy';
const r1 = x => Math.round(x * 10) / 10, r3 = x => Math.round(x * 1000) / 1000;
const ext = [];
for (const line of csv.slice(1)) {
  const f = line.split(';'), m = /^(NGC|IC)0*(\d+)\s*([A-Z]?)$/.exec(f[col('Name')]); if (!m) continue;
  const id = m[1] + ' ' + m[2] + m[3], t = f[col('Type')], cls = CLS[t];
  if (!cls || have.has(id) || f[col('M')]) continue;   // stars, duplicates, non-existent; Messier and the free catalogue
  const B = parseFloat(f[col('B-Mag')]), V = parseFloat(f[col('V-Mag')]);
  // V where known; from B, galaxies are about 0.8 mag brighter in V, clusters and nebulae a little
  const mag = !isNaN(V) ? V : !isNaN(B) ? B - (cls === 'gal' ? 0.8 : 0.3) : null;
  const maj = parseFloat(f[col('MajAx')]), min = parseFloat(f[col('MinAx')]), pa = parseFloat(f[col('PosAng')]);
  const name = (f[col('Common names')] || '').split(',')[0].trim();
  const row = [id, r3(hms(f[col('RA')])), r3(dms(f[col('Dec')])), mag == null ? null : r1(mag), cls, isNaN(maj) ? null : r1(maj), name,
    t === 'G' ? galType(f[col('Hubble')] || '') : TYPE[t] || 'Nebula'];
  if (cls === 'gal' && maj > 0 && min > 0) row.push(r1(maj), r1(min), isNaN(pa) ? 0 : Math.round(pa));
  ext.push(row);
}
ext.sort((a, b) => (a[3] ?? 99) - (b[3] ?? 99));
writeFileSync(new URL('public/app/ext/dso.json', root), JSON.stringify(ext));

// ---------- stars ----------
// The free deep catalogue has the Hipparcos stars 6–9 mag (d3-celestial, id = HIP); here everything else down to 11 mag
const D3 = path.join(path.dirname(require.resolve('d3-celestial/package.json')), 'data');
const hip = new Set(JSON.parse(readFileSync(path.join(D3, 'stars.14.json'), 'utf8')).features.filter(f => f.properties.mag <= 9.0).map(f => +f.id));
const lines = gunzipSync(readFileSync(athyg)).toString('utf8').split('\n');
const h = lines[0].split(',').map(s => s.replace(/"/g, '')), c = n => h.indexOf(n);
const iRa = c('ra'), iDec = c('dec'), iMag = c('mag'), iHip = c('hip');
const stars = [];
for (let i = 1; i < lines.length; i++) {
  const f = lines[i].split(','); if (f.length < h.length) continue;
  const mag = parseFloat(f[iMag]), H = f[iHip] ? +f[iHip] : 0;
  if (!(mag > 6.0 && mag <= 11.0) || (H && hip.has(H))) continue;
  stars.push([parseFloat(f[iRa]) * 15, parseFloat(f[iDec]), mag]);
}
stars.sort((a, b) => a[2] - b[2]);
const buf = Buffer.alloc(stars.length * 7), U24 = 16777215;
stars.forEach(([a, d, m], i) => {
  const o = i * 7, A = Math.round(((a % 360) + 360) % 360 / 360 * U24) % (U24 + 1), D = Math.round((d + 90) / 180 * U24);
  buf.writeUIntLE(A, o, 3); buf.writeUIntLE(D, o + 3, 3); buf.writeUInt8(Math.max(0, Math.min(255, Math.round((m + 2) * 20))), o + 6);
});
writeFileSync(new URL('public/app/ext/stars.bin', root), buf);
const byCls = ext.reduce((s, r) => (s[r[4]] = (s[r[4]] || 0) + 1, s), {});
console.log(`public/app/ext/dso.json: ${ext.length} objects ${JSON.stringify(byCls)}, ${JSON.stringify(ext).length >> 10} KB; public/app/ext/stars.bin: ${stars.length} stars, ${buf.length >> 10} KB`);
