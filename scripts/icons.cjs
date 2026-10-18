// Renders the PNG app icons from public/app/logo.svg (needs Playwright with Chromium):
//   node scripts/icons.cjs
// The PNGs are checked in, so this only has to run after the logo changes.
const fs = require('fs'), path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const dir = path.join(__dirname, '..', 'public', 'app');
const svg = fs.readFileSync(path.join(dir, 'logo.svg'), 'utf8');
// full-bleed variant (maskable / Apple): square background, artwork scaled into the safe zone
const bleed = k => svg.replace(/rx="112"/, 'rx="0"').replace('<g transform="translate(-22 6)">', `<g transform="translate(256 256) scale(${k}) translate(-256 -256) translate(-22 6)">`)
  .replace(/<g fill="#9fb4ff">/, `<g fill="#9fb4ff" transform="translate(256 256) scale(${k}) translate(-256 -256)">`);
const out = [['icons/icon-192.png', 192, svg, true], ['icons/icon-512.png', 512, svg, true], ['icons/maskable-512.png', 512, bleed(0.78), false], ['icons/apple-touch-icon.png', 180, bleed(0.9), false]];
(async () => {
  const b = await chromium.launch();
  for (const [file, n, s, transparent] of out) {
    const p = await b.newPage({ viewport: { width: n, height: n } });
    await p.setContent(`<style>html,body{margin:0;background:transparent}</style>${s.replace('<svg ', `<svg width="${n}" height="${n}" `)}`);
    await p.screenshot({ path: path.join(dir, file), omitBackground: transparent });
    await p.close();
    console.log(file);
  }
  await b.close();
})();
