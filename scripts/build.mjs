// Builds the website into dist/:
//   /            landing page (site/index.html) with a star chart drawn from the catalogue
//   /privacy/    privacy policy, /imprint/ legal notice, /404.html
//   /app/        the app: one self-contained HTML file with Astronomy Engine, catalogue and solver inlined,
//                plus service worker, manifest and icons
//   /fonts/      self-hosted fonts (no requests to third parties)
//   npm run build
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import path from 'node:path';
import { heroSvg } from './hero.mjs';

const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const write = (p, s) => { const u = new URL(p, root); mkdirSync(new URL('./', u), { recursive: true }); writeFileSync(u, s); };
rmSync(new URL('dist/', root), { recursive: true, force: true });
mkdirSync(new URL('dist/', root), { recursive: true });

// ---------- fonts ----------
const FONTS = [
  ['Saira Semi Condensed', '@fontsource/saira-semi-condensed', 'saira-semi-condensed', [400, 500, 600, 700]],
  ['IBM Plex Mono', '@fontsource/ibm-plex-mono', 'ibm-plex-mono', [400, 500]],
];
const fontFiles = [];
let fontCss = '';
for (const [family, pkg, base, weights] of FONTS) {
  const dir = path.join(path.dirname(require.resolve(pkg + '/package.json')), 'files');
  for (const w of weights) {
    const file = `${base}-latin-${w}-normal.woff2`;
    cpSync(path.join(dir, file), new URL('dist/fonts/' + file, root));
    fontFiles.push('/fonts/' + file);
    fontCss += `@font-face{font-family:"${family}";font-style:normal;font-weight:${w};font-display:swap;src:url(/fonts/${file}) format("woff2")}\n`;
  }
}

// ---------- app ----------
// the package only exports its Node entry point, so go through its folder
const aeDir = path.dirname(require.resolve('astronomy-engine'));
const aePkg = JSON.parse(readFileSync(path.join(aeDir, 'package.json'), 'utf8'));
const astronomy = `/*! Astronomy Engine ${aePkg.version} (c) Don Cross, MIT License, https://github.com/cosinekitty/astronomy */\n`
  + readFileSync(path.join(aeDir, 'astronomy.browser.min.js'), 'utf8');
const data = read('src/data.js');
const core = ('/* Star catalogue: d3-celestial data (c) Olaf Frohn, BSD-3-Clause */\n' + data + read('src/solver.js'))
  .replace("if (typeof module !== 'undefined') module.exports = Solver;", '');
for (const chunk of [astronomy, core]) if (/<\/script/i.test(chunk)) throw new Error('Inline script contains </script');

const page = read('src/app.html').replace('/*__FONTS__*/', () => fontCss).replace('/*__ASTRONOMY__*/', () => astronomy).replace('/*__CORE__*/', () => core);
const html = '<!doctype html><html lang="en"><head><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">'
  + '<meta name="robots" content="noindex">'
  + '<meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes">'
  + '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="Zenigo">'
  + '<link rel="manifest" href="manifest.webmanifest"><link rel="icon" href="logo.svg" type="image/svg+xml"><link rel="icon" href="icons/icon-192.png" type="image/png" sizes="192x192">'
  + '<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">'
  + '<style>body{margin:0}</style></head><body>' + page + '</body></html>';

// static files (robots.txt, app manifest and icons)
if (existsSync(new URL('public/', root))) cpSync(new URL('public/', root), new URL('dist/', root), { recursive: true });
write('dist/app/index.html', html);
// service worker for offline use; the version changes with the page so clients pick up new builds
const version = createHash('sha256').update(html).digest('hex').slice(0, 12);
write('dist/app/sw.js', read('src/sw.js').replace('__VERSION__', version).replace('/*__FONTS__*/', fontFiles.map(f => `'${f}'`).join(', ')));
// the old service worker at the root retires itself (see the file)
write('dist/sw.js', read('src/sw-root.js'));

// ---------- website ----------
const ctx = {}; vm.createContext(ctx); vm.runInContext(data.replace(/^const (\w+)=/gm, 'globalThis.$1='), ctx);
const hero = heroSvg(ctx);
const year = new Date().getFullYear();
const pages = { 'index.html': 'dist/index.html', 'getting-started.html': 'dist/getting-started/index.html', 'help.html': 'dist/help/index.html',
  'privacy.html': 'dist/privacy/index.html', 'imprint.html': 'dist/imprint/index.html', '404.html': 'dist/404.html' };
const header = read('site/_header.html'), footer = read('site/_footer.html');
for (const [src, dst] of Object.entries(pages)) {
  write(dst, read('site/' + src).replace('<!--HEADER-->', () => header).replace('<!--FOOTER-->', () => footer).replace('<!--FONTS-->', () => `<style>${fontCss}</style>`).replace('<!--HERO-->', () => hero).replaceAll('<!--YEAR-->', String(year)));
}
for (const f of readdirSync(new URL('site/', root))) if (!f.endsWith('.html')) cpSync(new URL('site/' + f, root), new URL('dist/' + f, root));

console.log(`dist/app/index.html ${Buffer.byteLength(html) >> 10} KB, sw.js ${version}; website: ${Object.values(pages).join(', ')}`);
