// ZTransit (src/transit.js): satellite transits in front of the Sun, the Moon and the planets. Checks the geometry
// against itself and against an independent calculation (satellite.js look angles, Astronomy Engine horizon):
//   node test/transit.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const A = require('astronomy-engine'), S = require('satellite.js'), Z = require('../src/transit.js');
let fails = 0, n = 0;
const ok = (c, msg, extra) => { n++; if (!c) fails++; console.log((c ? '  ✓ ' : '  ✗ ') + msg + (extra != null ? '  ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : '')); };
// an ISS-like orbit (51.6°, 420 km) with its epoch at the start
const rec = S.twoline2satrec('1 25544U 98067A   26301.50000000  .00016717  00000-0  10270-3 0  9001', '2 25544  51.6400 120.0000 0003000  90.0000 270.0000 15.50000000 10001');
const sats = [{ name: 'ISS', rec }], from = Date.UTC(2026, 9, 28, 12), HOME = { lat: 48.18, lon: 10.08 };
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const fmt = e => `${e.body} ${new Date(e.t).toISOString().slice(5, 19)} sep ${e.sep.toFixed(3)}° rho ${e.rho.toFixed(3)}° D ${e.D.toFixed(1)} km W ${e.W.toFixed(2)} km`;

console.log('• search');
let t0 = performance.now();
const all = Z.search(A, S, { sats, ...HOME, from, days: 3, maxKm: 1e9 });
const ms = performance.now() - t0;
ok(all.events.length > 10, `3 days, every close approach (within 5°): ${all.events.length} in ${Math.round(ms)} ms`);
ok(all.events.every((e, i, a) => !i || a[i - 1].t <= e.t), 'sorted by time');
ok(all.events.every(e => e.alt >= 0 && e.sep < 5 && e.rho > 0 && e.W > 0 && e.rate > 0.05 && e.rate < 3), 'above the horizon, closer than 5°, sensible sizes and speeds');
const near = await Z.searchAsync(A, S, { sats, ...HOME, from, days: 3 });
ok(near.events.every(e => e.edge <= 25) && (!near.closest || near.closest.edge > 25), 'maxKm: only strips within 25 km, the closest of the rest apart', near.events.length + ' near');

// independent: the separation at the closest moment from satellite.js look angles and Astronomy Engine's horizon
console.log('• independent check of the separation');
const obsA = new A.Observer(HOME.lat, HOME.lon, 300), gd = { latitude: HOME.lat * D2R, longitude: HOME.lon * D2R, height: 0.3 };
const hv = (az, alt) => [Math.cos(alt * D2R) * Math.sin(az * D2R), Math.cos(alt * D2R) * Math.cos(az * D2R), Math.sin(alt * D2R)];
const sepIndep = (e, ms) => {
  const d = new Date(ms), pv = S.propagate(rec, d), la = S.ecfToLookAngles(gd, S.eciToEcf(pv.position, S.gstime(d)));
  const t = A.MakeTime(d), eq = A.Equator(A.Body[e.body], t, obsA, true, true), h = A.Horizon(t, obsA, eq.ra, eq.dec);
  const a = hv(la.azimuth * R2D, la.elevation * R2D), b = hv(h.azimuth, h.altitude);
  return Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])) * R2D;
};
let worst = 0; all.events.forEach(e => { worst = Math.max(worst, Math.abs(sepIndep(e, e.t) - e.sep)); });
ok(worst < 0.003, 'separation at the closest moment matches within 0.003° (11″)', worst.toFixed(5) + '°');
let notMin = 0; all.events.forEach(e => { if (sepIndep(e, e.t - 300) < e.sep - 1e-4 || sepIndep(e, e.t + 300) < e.sep - 1e-4) notMin++; });
ok(notMin === 0, 'it is the closest moment (0.3 s before and after are farther)', notMin);

// self-consistency: from the centre line it crosses the middle; at 0.9 and 1.1 half widths inside and outside
console.log('• the strip');
const pick = all.events.filter(e => e.body === 'Moon' || e.body === 'Sun').sort((a, b) => a.D - b.D)[0] || all.events[0];
console.log('  using ' + fmt(pick));
const win = { from: pick.t - 600e3, days: 1200e3 / 864e5, maxKm: 1e9, bodies: [pick.body] };
const at = (lat, lon) => Z.search(A, S, { sats, lat, lon, ...win }).events.find(e => Math.abs(e.t - pick.t) < 60e3);
const c = at(pick.cl[0], pick.cl[1]);
ok(c && c.D < 0.3 && c.sep < 0.04 * c.rho && c.inDisc, 'on the centre line: through the middle of the disc', c && fmt(c));
ok(c && Math.abs(c.dur - c.durC) / c.durC < 0.05 && c.t1 < c.t && c.t2 > c.t, 'there the time in front of it is the full width', c && [c.dur.toFixed(3), c.durC.toFixed(3)]);
ok(c && Math.abs(c.W - pick.W) / pick.W < 0.05, 'the half width is the same from both places', c && [c.W.toFixed(3), pick.W.toFixed(3)]);
// a point at a given distance across the strip from the centre line point
const across = (km) => { const p = c.cl[0] * D2R, r = (c.runs + 90) * D2R; return [c.cl[0] + km * Math.cos(r) / 111.2, c.cl[1] + km * Math.sin(r) / (111.2 * Math.cos(p))]; };
const inS = at(...across(0.9 * c.W)), outS = at(...across(1.1 * c.W));
ok(inS && inS.inDisc && inS.edge < 0 && Math.abs(inS.sep / inS.rho - 0.9) < 0.05, '0.9 half widths off: inside, near the edge of the disc', inS && fmt(inS));
ok(outS && !outS.inDisc && outS.edge > 0 && Math.abs(outS.sep / outS.rho - 1.1) < 0.05, '1.1 half widths off: just outside', outS && fmt(outS));
ok(inS && Math.abs(inS.D - 0.9 * c.W) < 0.08 * c.W && Math.abs(((inS.bear - (c.runs + 270)) % 360 + 540) % 360 - 180) < 10, 'its distance and direction back to the centre line', inS && [inS.D.toFixed(2), Math.round(inS.bear), Math.round((c.runs + 270) % 360)]);
ok(c && c.path.length >= 10 && c.path.every(p => Math.abs(Math.hypot(p[1], p[2], p[3]) - 1) < 1e-9), 'the way across the disc: unit directions before and after');
if (c && c.body === 'Moon') ok(c.lit >= 0 && c.lit <= 1, 'Moon: share of the way over its lit part', c.lit.toFixed(2));

console.log(fails ? `\n${fails} of ${n} checks failed` : `\nAll ${n} checks passed`);
process.exit(fails ? 1 : 0);
