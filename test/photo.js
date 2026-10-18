// Echtes Foto lösen: erst mit scripts/image_to_f32.py umwandeln, dann
//   python3 scripts/image_to_f32.py foto.jpg /tmp/foto && node test/photo.js /tmp/foto
const fs = require('fs'), path = require('path');
const src = path.join(__dirname, '..', 'src');
eval(fs.readFileSync(path.join(src, 'data.js'), 'utf8').replace(/^const (\w+)=/gm, 'global.$1='));
const S = require(path.join(src, 'solver.js')); S.setCatalog(STARS);
const base = process.argv[2] || '/tmp/foto';
const [w, h] = fs.readFileSync(base + '.dim', 'utf8').split(' ').map(Number);
const buf = fs.readFileSync(base + '.f32'); const g = new Float32Array(buf.buffer, buf.byteOffset, w * h);
let t = Date.now(); const st = S.detectStars(g, w, h, { sigma: 5 });
console.log('Lichtpunkte', st.length, Date.now() - t, 'ms');
const conv = fl => { const L = Math.max(w, h), f = (L / 2) / Math.tan(fl / 2 * Math.PI / 180); return 2 * Math.atan(w / 2 / f) * 180 / Math.PI; };
t = Date.now();
const r = S.solve(st, { w, h, fovMin: conv(12), fovMax: conv(90), fovGuess: conv(66), timeBudget: 120000,
  debug: (ref) => console.log('  Kandidat', JSON.stringify(ref.center), 'n', ref.nMatch, 'rms', ref.rms.toFixed(3), 'rho', ref.rho.toFixed(2), 'strict', ref.strict) });
console.log(r.ok ? 'GELÖST' : 'NICHT GELÖST', r.reason || '', r.center ? JSON.stringify(r.center) : '', r.ok ? 'Bildfeld ' + r.fov.toFixed(1) + '° · ' + r.nMatch + ' Sterne · rms ' + r.rms.toFixed(3) + '°' : '', Date.now() - t, 'ms');
