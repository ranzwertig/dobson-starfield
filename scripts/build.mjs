// Builds the website into dist/:
//   /            landing page (site/index.html) with a star chart drawn from the catalogue
//   /privacy/    privacy policy, /imprint/ legal notice, /404.html
//   /diy-accessories/  DIY guide for a phone holder with the finder shoe adapter configurator (JSCAD design src/finder-adapter.js);
//                      /diy-accessories/mirror-holder/ is unlisted (mirror holder configurator, src/mirror-holder.js)
//   /app/        the app: an HTML page with a start screen, and Astronomy Engine, satellite.js, catalogue + solver and the app
//                code as separate content-named scripts (loaded with defer),
//                plus service worker, manifest and icons
//   /fonts/      self-hosted fonts (no requests to third parties)
//   npm run build
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, rmSync, readdirSync, statSync } from 'node:fs';
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
// Sync between devices: QR code generator (qrcode-generator, MIT) and the sync core (data model, merge, encryption)
const qrDir = path.dirname(require.resolve('qrcode-generator'));
const qrPkg = JSON.parse(readFileSync(path.join(qrDir, '..', 'package.json'), 'utf8'));
const syncJs = `/*! qrcode-generator ${qrPkg.version} (c) Kazuhiko Arase, MIT License, https://github.com/kazuhikoarase/qrcode-generator */\n`
  + readFileSync(path.join(qrDir, 'qrcode.js'), 'utf8').replace(/^\(function \(factory\) \{[\s\S]*$/m, '') + '\n' + read('src/sync.js').replace('if (typeof module !== "undefined") module.exports = ZSync;', '')
  + '\n' + licenceJs();
// Zenigo Pro licence check (src/licence.js), in the same script. The UI tests build with PRO_TEST_KEY=1, which adds the
// public key of test/fixtures/pro-test-key.json so they can make licences; deploys never set it.
function licenceJs() {
  let js = read('src/licence.js').replace("if (typeof module !== 'undefined') module.exports = ZLicence;", '');
  if (process.env.PRO_TEST_KEY === '1') js = js.replace('/*__PRO_TEST_KEY__*/', JSON.stringify(JSON.parse(read('test/fixtures/pro-test-key.json')).pub) + ',');
  return js;
}
// QR code reader for browsers without BarcodeDetector (Safari): jsQR (Apache-2.0), loaded only when a code is scanned
// and not kept for offline use (joining a sync group needs the network anyway)
const jsqrSrc = readFileSync(require.resolve('jsqr'), 'utf8');
let jsqr = jsqrSrc;
try { jsqr = (await import('esbuild')).transformSync(jsqrSrc, { minify: true }).code; } catch (e) {}
jsqr = '/*! jsQR 1.4.0 (c) Cosmo Wolfe, Apache License 2.0, https://github.com/cozmo/jsQR */\n' + jsqr;
for (const chunk of [astronomy, core, satjs, syncJs]) if (/<\/script/i.test(chunk)) throw new Error('Inline script contains </script');

// The scripts are served as separate files (named by their content), loaded with defer: the page with its start screen
// paints at once, and the browser compiles the scripts in the background instead of blocking on one huge inline script.
// Zenigo Pro as described in site/pro.json: the website's Pro page (below) and the app's Pro sheet (what Pro adds)
const PRO = JSON.parse(read('site/pro.json'));
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const proSoon = PRO.features.filter(f => f.coming).map(f => f.title);
const proIncl = PRO.features.filter(f => !f.coming).map(f => `<li><b>${esc(f.title)}</b><span>${esc(f.text)}</span></li>`).join('');
const proSoonText = proSoon.length ? esc('Planned, and included if ' + (proSoon.length > 1 ? 'they arrive' : 'it arrives') + ' during your licence: ' + (proSoon.length > 1 ? proSoon.slice(0, -1).join(', ') + ' and ' + proSoon.at(-1) : proSoon[0]) + '.') : '';
let page = read('src/app.html').replace('/*__FONTS__*/', () => fontCss).replace('<!--PRO-INCL-->', () => proIncl).replace('<!--PRO-SOON-->', () => proSoonText);
const mainOpen = '<script id="main">', mi = page.indexOf(mainOpen), me = page.lastIndexOf('</script>');
if (mi < 0 || me < mi) throw new Error('main script not found');
const fJsqr = `jsqr.${createHash('sha256').update(jsqr).digest('hex').slice(0, 10)}.js`;
// Extended catalogue of Zenigo Pro (scripts/extended.mjs, public/app/ext/): served under content-named files, not
// precached; the app downloads them only with Pro and keeps them in their own cache
let extInfo = 'null';
if (existsSync(new URL('public/app/ext/dso.json', root))) {
  const d = readFileSync(new URL('public/app/ext/dso.json', root)), s = readFileSync(new URL('public/app/ext/stars.bin', root));
  const dso = `ext-dso.${createHash('sha256').update(d).digest('hex').slice(0, 10)}.json`, stars = `ext-stars.${createHash('sha256').update(s).digest('hex').slice(0, 10)}.bin`;
  extInfo = JSON.stringify({ dso, stars, dsoBytes: d.length, starsBytes: s.length, bytes: d.length + s.length, nDso: JSON.parse(d).length, nStars: Math.floor(s.length / 7) });
  globalThis.__extFiles = [[dso, d], [stars, s]];
}
const mainJs = page.slice(mi + mainOpen.length, me).replace('__JSQR_FILE__', fJsqr).replace('/*__EXT__*/ null', () => extInfo);
const hashOf = s => createHash('sha256').update(s).digest('hex').slice(0, 10);
const jsFiles = {};
const jsFile = (name, src) => { const f = `${name}.${hashOf(src)}.js`; jsFiles[f] = src; return f; };
const fAstro = jsFile('astronomy', astronomy), fSat = jsFile('satellite', satjs), fCore = jsFile('core', core), fSync = jsFile('sync', syncJs), fMain = jsFile('app', mainJs);
page = page.slice(0, mi) + `<script id="main" src="${fMain}" defer></script>` + page.slice(me + '</script>'.length);
page = page.replace('<script>/*__ASTRONOMY__*/</script>', `<script src="${fAstro}" defer></script>`)
  .replace('<script>/*__SATELLITE__*/</script>', `<script src="${fSat}" defer></script>`)
  .replace('<script id="core">/*__CORE__*/</script>', `<script id="core" src="${fCore}" defer></script>`)
  .replace('<script>/*__SYNC__*/</script>', `<script src="${fSync}" defer></script>`);
if (/__ASTRONOMY__|__SATELLITE__|__CORE__|__SYNC__/.test(page)) throw new Error('script marker left in the page');
// start screen: drawn by the HTML alone, before any script runs; red light is applied right away
const logoSvg = read('public/app/logo.svg').replace(/<\?xml[^>]*>/, '').trim();
const splash = '<div id="splash" aria-hidden="true"><span class="zl">' + logoSvg.replace('<svg', '<svg class="splogo"') + '<i class="propill">Pro</i></span><b>zeni<i>go</i></b><div class="sp"></div></div>'
  + '<script>setTimeout(function(){var s=document.getElementById("splash");if(s)s.classList.add("gone")},10000)</script>';
const splashCss = '#splash{position:fixed;inset:0;z-index:1000;display:grid;place-content:center;justify-items:center;gap:16px;background:#0a0c0f;color:#e8ecf2;'
  + 'font:600 30px/1 "Saira Semi Condensed","Arial Narrow",system-ui,sans-serif;letter-spacing:.3px;transition:opacity .4s}'
  + '#splash.gone{opacity:0;pointer-events:none}#splash .splogo{width:88px;height:88px;border-radius:22px;display:block}#splash b i{font-style:normal;color:#f0a845}'
  + '#splash .zl{position:relative}#splash .propill{display:none;position:absolute;right:-12px;bottom:-8px;font-style:normal;font-weight:600;font-size:15px;line-height:1;letter-spacing:.08em;text-transform:uppercase;'
  + 'color:#1b1206;background:#f0a845;border-radius:99px;padding:4px 8px 3px;box-shadow:0 0 0 3px #0a0c0f}html.pro #splash .propill{display:block}'
  + '#splash .sp{margin-top:6px;width:24px;height:24px;border-radius:50%;border:2px solid #262d3a;border-top-color:#f0a845;animation:spl 1s linear infinite}'
  + '@keyframes spl{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){#splash .sp{animation:none}#splash{transition:none}}'
  + 'html.red{filter:grayscale(1) sepia(1) saturate(7) hue-rotate(-38deg) brightness(.72)}';
// red light, and Zenigo Pro as last checked (the "Pro" on the start screen's logo), before anything is drawn
const redEarly = '<script>try{if((JSON.parse(localStorage.getItem("dobson-lotse")||"{}")||{}).red)document.documentElement.classList.add("red")}catch(e){}'
  + 'try{var zp=JSON.parse(localStorage.getItem("zenigo-pro-state")||"null");if(zp&&zp.until>Date.now())document.documentElement.classList.add("pro")}catch(e){}</script>';
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
rmSync(new URL('dist/app/ext/', root), { recursive: true, force: true });
for (const [f, data] of globalThis.__extFiles || []) writeFileSync(new URL('dist/app/' + f, root), data);
write('dist/app/index.html', html);
for (const [f, src] of Object.entries(jsFiles)) write('dist/app/' + f, src);
write('dist/app/' + fJsqr, jsqr);
// for getting synced data back without the app (help: #sync-recovery)
write('dist/help/sync-recover.py', read('scripts/sync-recover.py'));
// service worker for offline use; the version changes with the page (which names the scripts by their content)
// the constellation figures (public/app/figures, see scripts/figures.mjs) are precached too; they count for the version
const figFiles = existsSync(new URL('public/app/figures/', root)) ? readdirSync(new URL('public/app/figures/', root)).filter(f => /\.(webp|json)$/.test(f)).sort() : [];
const figSum = figFiles.map(f => f + ':' + statSync(new URL('public/app/figures/' + f, root)).size).join('|');
const version = createHash('sha256').update(html + figSum).digest('hex').slice(0, 12);
write('dist/app/sw.js', read('src/sw.js').replace('__VERSION__', version).replace('/*__FONTS__*/', fontFiles.map(f => `'${f}'`).join(', '))
  .replace('/*__JS__*/', Object.keys(jsFiles).map(f => `'${f}'`).join(', ')).replace('/*__FIGURES__*/', figFiles.map(f => `'figures/${f}'`).join(', ')));
// the old service worker at the root retires itself (see the file)
write('dist/sw.js', read('src/sw-root.js'));

// ---------- website ----------
const ctx = {}; vm.createContext(ctx); vm.runInContext(data.replace(/^const (\w+)=/gm, 'globalThis.$1='), ctx);
const hero = heroSvg(ctx);
const year = new Date().getFullYear();
// DIY accessories: JSCAD modelling library (MIT), the designs and the configurator script, named by their content.
// The phone holder guide is a normal page; the mirror holder page is reachable only by its address
// (not linked, not in the sitemap, noindex, disallowed in robots.txt).
const jscadDir = path.dirname(require.resolve('@jscad/modeling/package.json'));
const jscadPkg = JSON.parse(readFileSync(path.join(jscadDir, 'package.json'), 'utf8'));
const jscadLib = `/*! JSCAD modeling ${jscadPkg.version} (c) JSCAD Organization, MIT License, https://github.com/jscad/OpenJSCAD.org */\n`
  + readFileSync(path.join(jscadDir, 'dist', 'jscad-modeling.min.js'), 'utf8');
const diyFile = (name, src) => { const f = `${name}.${hashOf(src)}.js`; write('dist/diy-accessories/' + f, src); return f; };
const fJscad = diyFile('jscad-modeling', jscadLib), fCfg = diyFile('configurator', read('src/accessories.js'));
const fAdapter = diyFile('finder-adapter', read('src/finder-adapter.js')), fMirror = diyFile('mirror-holder', read('src/mirror-holder.js'));
const tags = files => files.map(f => `<script src="/diy-accessories/${f}" defer></script>`).join('\n');
const pageScripts = { 'diy-accessories.html': tags([fJscad, fAdapter, fCfg]), 'diy-mirror-holder.html': tags([fJscad, fMirror, fCfg]) };
// the designs under stable names, to open in the JSCAD web app
write('dist/diy-accessories/finder-adapter.jscad.js', read('src/finder-adapter.js'));
write('dist/diy-accessories/mirror-holder/mirror-holder.jscad.js', read('src/mirror-holder.js'));
const hidden = new Set(['diy-mirror-holder.html', 'pro-welcome.html']);

const pages = { 'index.html': 'dist/index.html', 'features.html': 'dist/features/index.html', 'star-finder.html': 'dist/star-finder/index.html', 'telescopes.html': 'dist/telescopes/index.html', 'faq.html': 'dist/faq/index.html', 'compare.html': 'dist/compare/index.html', 'getting-started.html': 'dist/getting-started/index.html', 'help.html': 'dist/help/index.html',
  'diy-accessories.html': 'dist/diy-accessories/index.html', 'diy-mirror-holder.html': 'dist/diy-accessories/mirror-holder/index.html',
  'pro.html': 'dist/pro/index.html', 'pro-welcome.html': 'dist/pro/welcome/index.html', 'licence.html': 'dist/licence/index.html',
  'privacy.html': 'dist/privacy/index.html', 'imprint.html': 'dist/imprint/index.html', '404.html': 'dist/404.html' };
const header = read('site/_header.html'), footer = read('site/_footer.html');
// Search engines: canonical address per page and a sitemap (the app itself at /app/ is excluded in robots.txt)
const SITE = 'https://zenigo.app';
const urlOf = dst => dst === 'dist/404.html' ? null : SITE + dst.replace(/^dist/, '').replace(/index\.html$/, '');
const today = new Date().toISOString().slice(0, 10);
const sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
  + Object.entries(pages).filter(([src]) => !hidden.has(src)).map(([, dst]) => urlOf(dst)).filter(Boolean).map(u => `  <url><loc>${u}</loc><lastmod>${today}</lastmod></url>`).join('\n') + '\n</urlset>\n';
write('dist/sitemap.xml', sitemap);
// The FAQ page also as structured data (schema.org FAQPage), taken from its questions and answers
const plain = h => h.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
function faqLd(html) {
  const qa = [...html.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/g)].map(([, q, a]) => ({ '@type': 'Question', name: plain(q), acceptedAnswer: { '@type': 'Answer', text: plain(a) } }));
  return `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: qa }).replace(/</g, '\\u003c')}</script>`;
}
// Zenigo Pro: what it includes and what stays free, from site/pro.json (one place to edit), into site/pro.html; the
// home page's structured data gets the Pro offer from the same file. The page shows that base price (EU, VAT included)
// until Paddle's price for the visitor's country has loaded, so the price is there without Paddle too.
const proPrice = new Intl.NumberFormat('en', { style: 'currency', currency: PRO.structuredData.currency }).format(Number(PRO.structuredData.price));
const proHtml = html => html.replaceAll('<!--PRO-NAME-->', esc(PRO.name)).replaceAll('<!--PRO-TAGLINE-->', esc(PRO.tagline)).replaceAll('<!--PRO-TERMS-->', esc(PRO.terms)).replaceAll('<!--PRO-PRICE-->', esc(proPrice))
  .replace('<!--PRO-COMING-NOTE-->', () => proSoon.length ? '    <p class="muted">Features marked “coming” are planned and not part of what you buy today. If they arrive during your 12 months, they are included.</p>' : '')
  .replace('<!--PRO-FEATURES-->', PRO.features.map(f => `      <dt${f.coming ? ' class="coming"' : ''}>${f.href ? `<a href="${esc(f.href)}">${esc(f.title)}</a>` : esc(f.title)}${f.coming ? ' <span class="ptag soon">coming</span>' : ''}</dt>\n      <dd>${esc(f.text)}</dd>`).join('\n'))
  .replace('<!--PRO-FREE-->', PRO.freeFeatures.map(f => `      <li>${esc(f)}</li>`).join('\n'));
const proLd = JSON.stringify([{ '@type': 'Offer', name: 'Zenigo', price: '0', priceCurrency: 'EUR' },
  { '@type': 'Offer', name: PRO.name + ' – ' + PRO.terms, price: PRO.structuredData.price, priceCurrency: PRO.structuredData.currency, url: SITE + '/pro/' }]);
for (const [src, dst] of Object.entries(pages)) {
  const url = hidden.has(src) ? null : urlOf(dst);
  const seo = url ? `<link rel="canonical" href="${url}"><meta property="og:url" content="${url}">` : '';
  const ld = src === 'faq.html' ? faqLd(read('site/' + src)) : '';   // the 404 page carries its own noindex
  // the header marks the current page in its navigation
  const here = url && url.slice(SITE.length), hdr = here && here !== "/" ? header.replaceAll(`href="${here}">`, `href="${here}" aria-current="page">`) : header;
  write(dst, read('site/' + src).replace('<!--FONTS-->', () => seo + ld + '\n<!--FONTS-->').replace('<!--HEADER-->', () => hdr).replace('<!--FOOTER-->', () => footer).replace('<!--FONTS-->', () => `<style>${fontCss}</style>`).replace('<!--HERO-->', () => hero).replaceAll('<!--YEAR-->', String(year)).replace('<!--SCRIPTS-->', () => pageScripts[src] || '').replace(/<!--PRO-[A-Z]+-->/g, m => proHtml(m)).replace('"offers": "<!--OFFERS-->"', () => '"offers": ' + proLd));
}
for (const f of readdirSync(new URL('site/', root))) if (!f.endsWith('.html') && f !== 'pro.json') cpSync(new URL('site/' + f, root), new URL('dist/' + f, root));

console.log(`sitemap: ${Object.keys(pages).filter(p => !hidden.has(p) && p !== '404.html').length} pages; dist/app/index.html ${Buffer.byteLength(html) >> 10} KB, sw.js ${version}; website: ${Object.values(pages).join(', ')}`);
