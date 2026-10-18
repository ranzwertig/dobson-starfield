// Erzeugt src/data.js aus den Daten von d3-celestial (BSD-3-Clause), installiert über npm.
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

// Sterne bis 6 mag, hellste zuerst, flach als [ra, dec, mag, ...]
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
// Bezeichnungen für antippbare Sterne bis 5,5 mag: [Eigenname, Bayer, Flamsteed, Sternbild]
const info = {};
rows.forEach(([a, d, m, hid], i) => {
  stars.push(a, d, m);
  const n = names[hid];
  if (!n) return;
  if (m <= 5.5 && (n.name || n.bayer || n.flam) && /^[A-Z][a-zA-Z]{2}$/.test(n.c)) info[i] = [n.name || '', n.bayer || '', n.flam || '', n.c];
  if (n.name && m < 4.5) labels[i] = n.name;
  else if (n.bayer && m < 3.6) labels[i] = n.bayer + ' ' + n.c;
});

// Messier-Objekte mit deutschen Namen und Typen
const GER = { M1: 'Krebsnebel', M8: 'Lagunennebel', M13: 'Herkules-Kugelsternhaufen', M16: 'Adlernebel', M17: 'Omeganebel',
  M20: 'Trifidnebel', M27: 'Hantelnebel', M31: 'Andromedagalaxie', M33: 'Dreiecksgalaxie', M42: 'Orionnebel',
  M44: 'Krippe (Praesepe)', M45: 'Plejaden (Siebengestirn)', M51: 'Whirlpool-Galaxie', M57: 'Ringnebel', M64: 'Black-Eye-Galaxie',
  M81: 'Bodes Galaxie', M82: 'Zigarrengalaxie', M97: 'Eulennebel', M101: 'Feuerradgalaxie', M104: 'Sombrerogalaxie', M11: 'Wildentenhaufen',
  M6: 'Schmetterlingshaufen', M7: 'Ptolemäus-Haufen', M24: 'Sagittarius-Sternwolke', M35: 'Offener Sternhaufen in den Zwillingen',
  M3: 'Kugelsternhaufen', M92: 'Kugelsternhaufen', M15: 'Kugelsternhaufen', M2: 'Kugelsternhaufen', M5: 'Kugelsternhaufen', M22: 'Kugelsternhaufen' };
const TYPES = { s: 'Spiralgalaxie', e: 'Elliptische Galaxie', i: 'Irreguläre Galaxie', sfr: 'Sternentstehungsgebiet', gc: 'Kugelsternhaufen',
  oc: 'Offener Haufen', pn: 'Planetarischer Nebel', en: 'Emissionsnebel', rn: 'Reflexionsnebel', snr: 'Supernova-Rest', pos: 'Sternfeld' };
const messier = ld('messier.json').features.map(f => {
  const p = f.properties, [lon, lat] = f.geometry.coordinates;
  return [p.name, rnd(ra(lon), 3), rnd(lat, 3), p.mag ?? null, GER[p.name] || p.alt || '', TYPES[p.type] || p.type || '', p.desig || ''];
});

// Sternbildlinien als flache [ra, dec, ...]-Züge
const lines = [];
for (const f of ld('constellations.lines.json').features)
  for (const seg of f.geometry.coordinates) lines.push(seg.flatMap(([lon, lat]) => [rnd(ra(lon), 2), rnd(lat, 2)]));

const js = `const STARS=${JSON.stringify(stars)};\nconst STARLABELS=${JSON.stringify(labels)};\nconst STARINFO=${JSON.stringify(info)};\nconst MESSIER=${JSON.stringify(messier)};\nconst CLINES=${JSON.stringify(lines)};\n`;
writeFileSync(OUT, js);
console.log(`src/data.js: ${rows.length} Sterne, ${Object.keys(labels).length} Namen, ${Object.keys(info).length} Bezeichnungen, ${messier.length} Messier, ${lines.length} Linienzüge, ${js.length >> 10} KB`);
