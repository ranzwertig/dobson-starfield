// Baut dist/index.html: eine einzige, eigenständige HTML-Datei (außer Google Fonts).
// Fügt Astronomy Engine (npm), Sternkatalog und Solver inline ein.
//   npm run build
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
// das Paket exportiert nur seinen Node-Einstieg, deshalb über dessen Ordner gehen
const aeDir = path.dirname(require.resolve('astronomy-engine'));
const aePkg = JSON.parse(readFileSync(path.join(aeDir, 'package.json'), 'utf8'));

const astronomy = `/*! Astronomy Engine ${aePkg.version} (c) Don Cross, MIT License, https://github.com/cosinekitty/astronomy */\n`
  + readFileSync(path.join(aeDir, 'astronomy.browser.min.js'), 'utf8');
const core = ('/* Sternkatalog: d3-celestial data (c) Olaf Frohn, BSD-3-Clause */\n' + read('src/data.js') + read('src/solver.js'))
  .replace("if (typeof module !== 'undefined') module.exports = Solver;", '');
for (const chunk of [astronomy, core]) if (/<\/script/i.test(chunk)) throw new Error('Inline-Skript enthält </script');

const page = read('src/app.html').replace('/*__ASTRONOMY__*/', () => astronomy).replace('/*__CORE__*/', () => core);
const html = '<!doctype html><html lang="de"><head><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
  + '<style>body{margin:0}</style></head><body>' + page + '</body></html>';
mkdirSync(new URL('dist/', root), { recursive: true });
// statische Zusatzdateien (robots.txt …) unverändert mitnehmen
if (existsSync(new URL('public/', root))) cpSync(new URL('public/', root), new URL('dist/', root), { recursive: true });
writeFileSync(new URL('dist/index.html', root), html);
console.log(`dist/index.html ${Buffer.byteLength(html) >> 10} KB`);
