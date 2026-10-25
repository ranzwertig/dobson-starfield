// Constellation figures for the map: drawings by Johan Meuris from Stellarium's "western" sky culture
// (https://github.com/Stellarium/stellarium-skycultures, illustrations under the Free Art License 1.3).
// Copies the images to public/app/figures/ and writes figures.json: per figure the image size and its three anchor
// stars as image pixel + RA/Dec (J2000, from the Hipparcos positions in d3-celestial). Run once after updating:
//   git clone --depth 1 https://github.com/Stellarium/stellarium-skycultures /tmp/sc
//   node scripts/figures.mjs /tmp/sc/western
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
const src = process.argv[2];
if (!src) { console.error('usage: node scripts/figures.mjs <stellarium-skycultures>/western'); process.exit(2); }
const idx = JSON.parse(readFileSync(path.join(src, 'index.json'), 'utf8'));
const pos = {};
for (const f of ['stars.6.json', 'stars.8.json']) for (const s of JSON.parse(readFileSync(new URL('../node_modules/d3-celestial/data/' + f, import.meta.url))).features) pos[s.id] = s.geometry.coordinates;
const out = new URL('../public/app/figures/', import.meta.url);
mkdirSync(out, { recursive: true });
const list = [];
for (const c of idx.constellations) {
  if (!c.image) continue;
  const a = c.image.anchors.map(x => { const p = pos[x.hip]; if (!p) throw new Error('no position for HIP ' + x.hip); return [x.pos[0], x.pos[1], +((p[0] + 360) % 360).toFixed(4), +p[1].toFixed(4)]; });
  const file = path.basename(c.image.file);
  copyFileSync(path.join(src, c.image.file), new URL(file, out));
  list.push({ id: c.iau, file, w: c.image.size[0], h: c.image.size[1], a });
}
writeFileSync(new URL('figures.json', out), JSON.stringify(list));
writeFileSync(new URL('LICENSE.txt', out), `Constellation figures by Johan Meuris, from Stellarium (https://stellarium.org),
sky culture "western": https://github.com/Stellarium/stellarium-skycultures
Licensed under the Free Art License 1.3: https://artlibre.org/licence/lal/en/
The images are used unchanged; figures.json (anchor stars) is derived from Stellarium's index.json.
`);
console.log(list.length + ' figures');
