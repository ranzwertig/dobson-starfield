// Builds the website into dist/:
//   /            landing page (site/index.html) with a star chart drawn from the catalogue
//   /privacy/    privacy policy, /imprint/ legal notice, /404.html
//   /accessories/  guide for a phone mount, with configurators for the printable parts (JSCAD designs src/finder-adapter.js, src/mirror-holder.js)
//   /app/        the app: an HTML page with a start screen, and Astronomy Engine, satellite.js, catalogue + solver and the app
//                code as separate content-named scripts (loaded with defer),
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
// SGP4 satellite propagation (ISS and bright satellites): satellite.js, MIT
const satDir = path.dirname(require.resolve('satellite.js/package.json'));
const satPkg = JSON.parse(readFileSync(path.join(satDir, 'package.json'), 'utf8'));
const satjs = `/*! satellite.js ${satPkg.version} (c) Shashwat Kandadai and contributors, MIT License, https://github.com/shashwatak/satellite-js */\n`
  + readFileSync(path.join(satDir, 'dist', 'satellite.min.js'), 'utf8');
const data = read('src/data.js');
const core = ('/* Star catalogue: d3-celestial data (c) Olaf Frohn, BSD-3-Clause */\n' + data + read('src/solver.js'))
  .replace("if (typeof module !== 'undefined') module.exports = Solver;", '');
for (const chunk of [astronomy, core, satjs]) if (/<\/script/i.test(chunk)) throw new Error('Inline script contains </script');

// The scripts are served as separate files (named by their content), loaded with defer: the page with its start screen
// paints at once, and the browser compiles the scripts in the background instead of blocking on one huge inline script.
let page = read('src/app.html').replace('/*__FONTS__*/', () => fontCss);
const mainOpen = '<script id="main">', mi = page.indexOf(mainOpen), me = page.lastIndexOf('</script>');
if (mi < 0 || me < mi) throw new Error('main script not found');
const mainJs = page.slice(mi + mainOpen.length, me);
const hashOf = s => createHash('sha256').update(s).digest('hex').slice(0, 10);
const jsFiles = {};
const jsFile = (name, src) => { const f = `${name}.${hashOf(src)}.js`; jsFiles[f] = src; return f; };
const fAstro = jsFile('astronomy', astronomy), fSat = jsFile('satellite', satjs), fCore = jsFile('core', core), fMain = jsFile('app', mainJs);
page = page.slice(0, mi) + `<script id="main" src="${fMain}" defer></script>` + page.slice(me + '</script>'.length);
page = page.replace('<script>/*__ASTRONOMY__*/</script>', `<script src="${fAstro}" defer></script>`)
  .replace('<script>/*__SATELLITE__*/</script>', `<script src="${fSat}" defer></script>`)
  .replace('<script id="core">/*__CORE__*/</script>', `<script id="core" src="${fCore}" defer></script>`);
if (/__ASTRONOMY__|__SATELLITE__|__CORE__/.test(page)) throw new Error('script marker left in the page');
// start screen: drawn by the HTML alone, before any script runs; red light is applied right away
const logoSvg = read('public/app/logo.svg').replace(/<\?xml[^>]*>/, '').trim();
const splash = '<div id="splash" aria-hidden="true">' + logoSvg.replace('<svg', '<svg class="splogo"') + '<b>zeni<i>go</i></b><div class="sp"></div></div>'
  + '<script>setTimeout(function(){var s=document.getElementById("splash");if(s)s.classList.add("gone")},10000)</script>';
const splashCss = '#splash{position:fixed;inset:0;z-index:1000;display:grid;place-content:center;justify-items:center;gap:16px;background:#0a0c0f;color:#e8ecf2;'
  + 'font:600 30px/1 "Saira Semi Condensed","Arial Narrow",system-ui,sans-serif;letter-spacing:.3px;transition:opacity .4s}'
  + '#splash.gone{opacity:0;pointer-events:none}#splash .splogo{width:88px;height:88px;border-radius:22px}#splash b i{font-style:normal;color:#f0a845}'
  + '#splash .sp{margin-top:6px;width:24px;height:24px;border-radius:50%;border:2px solid #262d3a;border-top-color:#f0a845;animation:spl 1s linear infinite}'
  + '@keyframes spl{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){#splash .sp{animation:none}#splash{transition:none}}'
  + 'html.red{filter:grayscale(1) sepia(1) saturate(7) hue-rotate(-38deg) brightness(.72)}';
const redEarly = '<script>try{if((JSON.parse(localStorage.getItem("dobson-lotse")||"{}")||{}).red)document.documentElement.classList.add("red")}catch(e){}</script>';
const html = '<!doctype html><html lang="en"><head><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">'
  + '<meta name="robots" content="noindex">'
  + '<meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes">'
  + '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="Zenigo">'
  + '<link rel="manifest" href="manifest.webmanifest"><link rel="icon" href="logo.svg" type="image/svg+xml"><link rel="icon" href="icons/icon-192.png" type="image/png" sizes="192x192">'
  + '<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">'
  + '<style>body{margin:0;background:#0a0c0f}' + splashCss + '</style>' + redEarly + '</head><body>' + splash + page + '</body></html>';

// static files (robots.txt, app manifest and icons)
if (existsSync(new URL('public/', root))) cpSync(new URL('public/', root), new URL('dist/', root), { recursive: true });
write('dist/app/index.html', html);
for (const [f, src] of Object.entries(jsFiles)) write('dist/app/' + f, src);
// service worker for offline use; the version changes with the page (which names the scripts by their content)
const version = createHash('sha256').update(html).digest('hex').slice(0, 12);
write('dist/app/sw.js', read('src/sw.js').replace('__VERSION__', version).replace('/*__FONTS__*/', fontFiles.map(f => `'${f}'`).join(', '))
  .replace('/*__JS__*/', Object.keys(jsFiles).map(f => `'${f}'`).join(', ')));
// the old service worker at the root retires itself (see the file)
write('dist/sw.js', read('src/sw-root.js'));

// ---------- website ----------
const ctx = {}; vm.createContext(ctx); vm.runInContext(data.replace(/^const (\w+)=/gm, 'globalThis.$1='), ctx);
const hero = heroSvg(ctx);
const year = new Date().getFullYear();
// accessories: JSCAD modelling library (MIT), the design and the page script, named by their content
const jscadDir = path.dirname(require.resolve('@jscad/modeling/package.json'));
const jscadPkg = JSON.parse(readFileSync(path.join(jscadDir, 'package.json'), 'utf8'));
const jscadLib = `/*! JSCAD modeling ${jscadPkg.version} (c) JSCAD Organization, MIT License, https://github.com/jscad/OpenJSCAD.org */\n`
  + readFileSync(path.join(jscadDir, 'dist', 'jscad-modeling.min.js'), 'utf8');
const accFiles = {};
const accFile = (name, src) => { const f = `${name}.${hashOf(src)}.js`; accFiles[f] = src; return f; };
const accScripts = [accFile('jscad-modeling', jscadLib), accFile('finder-adapter', read('src/finder-adapter.js')),
  accFile('mirror-holder', read('src/mirror-holder.js')), accFile('accessories', read('src/accessories.js'))]
  .map(f => `<script src="/accessories/${f}" defer></script>`).join('\n');
for (const [f, src] of Object.entries(accFiles)) write('dist/accessories/' + f, src);
// the designs under stable names, to open in the JSCAD web app
write('dist/accessories/finder-adapter.jscad.js', read('src/finder-adapter.js'));
write('dist/accessories/mirror-holder.jscad.js', read('src/mirror-holder.js'));

const pages = { 'index.html': 'dist/index.html', 'getting-started.html': 'dist/getting-started/index.html', 'help.html': 'dist/help/index.html',
  'accessories.html': 'dist/accessories/index.html',
  'privacy.html': 'dist/privacy/index.html', 'imprint.html': 'dist/imprint/index.html', '404.html': 'dist/404.html' };
const header = read('site/_header.html'), footer = read('site/_footer.html');
// Search engines: canonical address per page and a sitemap (the app itself at /app/ is excluded in robots.txt)
const SITE = 'https://zenigo.app';
const urlOf = dst => dst === 'dist/404.html' ? null : SITE + dst.replace(/^dist/, '').replace(/index\.html$/, '');
const today = new Date().toISOString().slice(0, 10);
const sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
  + Object.values(pages).map(urlOf).filter(Boolean).map(u => `  <url><loc>${u}</loc><lastmod>${today}</lastmod></url>`).join('\n') + '\n</urlset>\n';
write('dist/sitemap.xml', sitemap);
for (const [src, dst] of Object.entries(pages)) {
  const url = urlOf(dst);
  const seo = url ? `<link rel="canonical" href="${url}"><meta property="og:url" content="${url}">` : '';   // the 404 page carries its own noindex
  // the header marks the current page in its navigation
  const here = url && url.slice(SITE.length), hdr = here && here !== "/" ? header.replace(`<a href="${here}">`, `<a href="${here}" aria-current="page">`) : header;
  write(dst, read('site/' + src).replace('<!--FONTS-->', () => seo + '\n<!--FONTS-->').replace('<!--HEADER-->', () => hdr).replace('<!--FOOTER-->', () => footer).replace('<!--FONTS-->', () => `<style>${fontCss}</style>`).replace('<!--HERO-->', () => hero).replaceAll('<!--YEAR-->', String(year)).replace('<!--ACCESSORIES_SCRIPTS-->', () => accScripts));
}
for (const f of readdirSync(new URL('site/', root))) if (!f.endsWith('.html')) cpSync(new URL('site/' + f, root), new URL('dist/' + f, root));

console.log(`sitemap: ${Object.values(pages).map(urlOf).filter(Boolean).length} pages; dist/app/index.html ${Buffer.byteLength(html) >> 10} KB, sw.js ${version}; website: ${Object.values(pages).join(', ')}`);
