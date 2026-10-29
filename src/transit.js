// Transits of a satellite (the ISS, Tiangong) in front of the Sun, the Moon or a planet, as seen from one place.
// Calculated with satellite.js (SGP4) and Astronomy Engine; the same code runs in the app (Pro: Tonight › ISS transits,
// the countdown on the map) and in test/transit.mjs. It returns plain data; the app writes the words.
//
//   ZTransit.search(A, S, { sats, lat, lon, height, from, days, bodies, maxKm })   (searchAsync: the same as a Promise, in slices)
//     A       the Astronomy Engine module, S the satellite.js module
//     sats    [{ name, rec }] with rec from S.twoline2satrec
//     lat, lon, height (km)   the observer
//     from    start (Date or ms, default now), days (default 3)
//     bodies  default ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"]
//     maxKm   keep a pass when its strip comes this close (default 25 km); the closest of the rest is returned too
//   → { events: [...], closest: event | null }
//
// Each event: sat, body, t (ms, closest approach seen from the observer), sep (degrees between the satellite and the
// body's centre then), rho (the body's apparent radius, degrees), rate (degrees per second, relative), inDisc, t1, t2
// (in front of the disc from … to, ms, when inDisc), dur (seconds here), durC (seconds on the centre line), D (km from
// the observer to the centre line), bear (degrees, direction from the observer to it), W (half width of the strip, km),
// edge (km to the strip's edge, ≤ 0 inside), runs (degrees, direction the strip runs), cl ([lat, lon] of its nearest point), alt / az (the body's, apparent),
// range (km to the satellite), sunAlt, lit (Moon: share of the satellite's way over the disc that crosses its lit part),
// path [[seconds from t, east, north, up], …] (the satellite's direction from the observer, for the map and the disc).
//
// How: the satellite is followed every 30 s for the times it is above the horizon, then every second, and wherever it
// comes within 5° of a body the closest approach is found to the millisecond. The centre line is where the line from the
// body through the satellite reaches the ground (the body's direction from the observer: within tens of km the Moon's
// parallax changes it by under 2 % of its radius); the separation grows in proportion to the distance from it, which
// gives the half width of the strip. Positions are geometric (no refraction), as SGP4's; the times are good to what the
// orbital elements allow (a day-old ISS orbit: a few tenths of a second, a few hundred metres).
const ZTransit = (() => {
  const D2R = Math.PI / 180, R2D = 180 / Math.PI, AU = 149597870.7, AE = 6378.137, BE = 6356.7523;
  const RADII = { Sun: 696000, Moon: 1737.4, Mercury: 2439.7, Venus: 6051.8, Mars: 3396.2, Jupiter: 71492, Saturn: 60268 };
  const BODIES = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const nrm = a => { const n = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };
  const ang = (a, b) => { const c = Math.max(-1, Math.min(1, dot(a, b))); return Math.acos(c) * R2D; };
  const lerp = (a, b, f) => nrm([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);

  // the observer: position (km, Earth-fixed) and its east, north, up directions
  function site(S, lat, lon, h) {
    const p = lat * D2R, l = lon * D2R, o = S.geodeticToEcf({ latitude: p, longitude: l, height: h });
    return { lat, lon, h, o: [o.x, o.y, o.z],
      E: [-Math.sin(l), Math.cos(l), 0], N: [-Math.sin(p) * Math.cos(l), -Math.sin(p) * Math.sin(l), Math.cos(p)], U: [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)] };
  }
  const toEnu = (s, v) => [dot(v, s.E), dot(v, s.N), dot(v, s.U)];
  const fromEnu = (s, e) => [e[0] * s.E[0] + e[1] * s.N[0] + e[2] * s.U[0], e[0] * s.E[1] + e[1] * s.N[1] + e[2] * s.U[1], e[0] * s.E[2] + e[1] * s.N[2] + e[2] * s.U[2]];
  // the satellite, Earth-fixed (km), or null
  function satPos(S, rec, ms) {
    const d = new Date(ms), pv = S.propagate(rec, d), r = pv && pv.position;
    if (!r || typeof r === "boolean") return null;
    const f = S.eciToEcf(r, S.gstime(d)); return [f.x, f.y, f.z];
  }
  // a body seen from the observer: direction (Earth-fixed unit vector, no refraction), apparent altitude and azimuth, distance (km)
  function bodyAt(A, s, obs, body, ms) {
    const t = A.MakeTime(new Date(ms)), eq = A.Equator(A.Body[body], t, obs, true, true);
    const h = A.Horizon(t, obs, eq.ra, eq.dec), ha = A.Horizon(t, obs, eq.ra, eq.dec, "normal");
    const a = h.altitude * D2R, z = h.azimuth * D2R;
    return { u: fromEnu(s, [Math.cos(a) * Math.sin(z), Math.cos(a) * Math.cos(z), Math.sin(a)]), alt: ha.altitude, az: ha.azimuth, dist: eq.dist * AU, ms };
  }
  // where the line from the body through the satellite reaches the ground (WGS84), or null
  function ground(r, u) {
    const R = [r[0] / AE, r[1] / AE, r[2] / BE], U = [u[0] / AE, u[1] / AE, u[2] / BE];
    const a = dot(U, U), b = dot(R, U), c = dot(R, R) - 1, q = b * b - a * c;
    if (q < 0) return null;
    const k = (b - Math.sqrt(q)) / a; if (k < 0) return null;
    return [r[0] - k * u[0], r[1] - k * u[1], r[2] - k * u[2]];
  }
  // golden-section search for the minimum of f on [a, b]
  function gold(f, a, b, tol) {
    const g = (Math.sqrt(5) - 1) / 2; let c = b - g * (b - a), d = a + g * (b - a), fc = f(c), fd = f(d);
    while (b - a > tol) { if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = f(c); } else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = f(d); } }
    const x = (a + b) / 2; return { x, f: f(x) };
  }

  // the search as a generator: it yields now and then, so the app can spread it over several frames (searchAsync)
  function* run(A, S, opts) {
    const from = +(opts.from || Date.now()), days = opts.days || 3, to = from + days * 864e5;
    const bodies = opts.bodies || BODIES, maxKm = opts.maxKm == null ? 25 : opts.maxKm;
    const s = site(S, opts.lat, opts.lon, opts.height || 0.3), obs = new A.Observer(opts.lat, opts.lon, (opts.height || 0.3) * 1000);
    const satDir = (rec, ms, o = s.o) => { const r = satPos(S, rec, ms); return r ? nrm(sub(r, o)) : null; };
    const events = []; let closest = null;
    for (const sat of opts.sats || []) {
      // 1. the times it is above the horizon (every 30 s), with half a minute to spare on either side
      const wins = []; let w = null;
      for (let ms = from, i = 0; ms <= to; ms += 30000, i++) {
        if (i % 600 === 599) yield;
        const d = satDir(sat.rec, ms), up = d && dot(d, s.U) > -0.035;
        if (up && !w) w = [ms - 30000, ms]; else if (up) w[1] = ms; else if (w) { wins.push([w[0], ms]); w = null; }
      }
      if (w) wins.push([w[0], to]);
      for (const [a, b] of wins) {
        yield;
        const sec = []; for (let ms = a; ms <= b + 1000; ms += 1000) sec.push(satDir(sat.rec, ms));   // every second, for all bodies
        // 2. the bodies above the horizon then (their directions every 2 minutes, in between interpolated)
        const n = Math.max(1, Math.ceil((b - a) / 120000)), ts = Array.from({ length: n + 1 }, (_, i) => a + (b - a) * i / n);
        for (const body of bodies) {
          yield;
          const bs = ts.map(ms => bodyAt(A, s, obs, body, ms));
          if (bs.every(q => q.alt < 0)) continue;
          // the body's direction at a time, from the observer or (with o) from another place: the Moon's parallax counts
          const uAt = (ms, o) => {
            const f = Math.min(n - 1e-9, Math.max(0, (ms - a) / (b - a) * n)), i = Math.floor(f), u = lerp(bs[i].u, bs[i + 1].u, f - i);
            if (!o) return u;
            const dist = bs[i].dist; return nrm([s.o[0] + dist * u[0] - o[0], s.o[1] + dist * u[1] - o[1], s.o[2] + dist * u[2] - o[2]]);
          };
          const sepAt = (ms, o) => { const d = satDir(sat.rec, ms, o); return d ? ang(d, uAt(ms, o)) : 180; };
          // 3. every second: where it comes closest
          let p2 = 180, p1 = 180;
          for (let i = 0, ms = a; i < sec.length; i++, ms += 1000) {
            const v = sec[i] ? ang(sec[i], uAt(ms)) : 180;
            if (p1 < 5 && p1 <= p2 && p1 < v) {
              const m = gold(x => sepAt(x), ms - 2000, ms, 1), ev = describe(A, S, s, obs, sat, body, m.x, m.f, uAt, sepAt, bs);
              if (ev) { if (ev.edge <= maxKm) events.push(ev); else if (!closest || ev.edge < closest.edge) closest = ev; }
            }
            p2 = p1; p1 = v;
          }
        }
      }
    }
    events.sort((x, y) => x.t - y.t);
    return { events, closest };
  }
  function search(A, S, opts = {}) { const g = run(A, S, opts); for (;;) { const r = g.next(); if (r.done) return r.value; } }
  // the same, giving way to the page about every 12 ms
  function searchAsync(A, S, opts = {}) {
    const g = run(A, S, opts);
    return new Promise((ok, fail) => {
      const step = () => { try { const t0 = Date.now(); for (;;) { const r = g.next(); if (r.done) return ok(r.value); if (Date.now() - t0 > 12) break; } setTimeout(step, 0); } catch (e) { fail(e); } };
      step();
    });
  }

  // everything about one closest approach
  function describe(A, S, s, obs, sat, body, tc, sep, uAt, sepAt, bs) {
    const b = bodyAt(A, s, obs, body, tc); if (b.alt < 0) return null;
    const rho = Math.asin(Math.min(1, RADII[body] / b.dist)) * R2D;
    const r = satPos(S, sat.rec, tc); if (!r) return null;
    const range = Math.hypot(...sub(r, s.o));
    // relative motion: how fast the satellite moves across the body
    const q1 = satPos(S, sat.rec, tc - 100), q2 = satPos(S, sat.rec, tc + 100); if (!q1 || !q2) return null;
    const d1 = nrm(sub(q1, s.o)), d2 = nrm(sub(q2, s.o));
    const rate = Math.max(1e-6, ang(d1, d2) / 0.2);
    const inDisc = sep < rho, half = inDisc ? Math.sqrt(rho * rho - sep * sep) / rate : 0;
    // the centre line: nearest point to the observer
    const gAt = ms => {   // seen from the ground point itself (twice: the Moon's direction depends on where that is)
      const q = satPos(S, sat.rec, ms); if (!q) return null;
      let g = ground(q, uAt(ms)); if (g) g = ground(q, uAt(ms, g)); if (g) g = ground(q, uAt(ms, g)); return g;
    };
    const horiz = g => { const e = toEnu(s, sub(g, s.o)); return { d: Math.hypot(e[0], e[1]), bear: (Math.atan2(e[0], e[1]) * R2D + 360) % 360 }; };
    const distAt = ms => { const g = gAt(ms); return g ? horiz(g).d : 1e9; };
    let best = tc, bd = 1e9;
    for (let ms = tc - 30000; ms <= tc + 30000; ms += 500) { const v = distAt(ms); if (v < bd) { bd = v; best = ms; } }
    if (bd > 5e8) return null;
    const gm = gold(distAt, best - 500, best + 500, 0.5), gc = gAt(gm.x); if (!gc) return null;
    const hz = horiz(gc), D = hz.d, ga = gAt(gm.x - 500), gb = gAt(gm.x + 500); if (!ga || !gb) return null;
    const tr = toEnu(s, sub(gb, ga)), runs = (Math.atan2(tr[0], tr[1]) * R2D + 360) % 360;
    // the half width: the separation grows with the distance from the centre line, measured 1.5 km either side of it
    const perp = nrm(fromEnu(s, [Math.cos(runs * D2R), -Math.sin(runs * D2R), 0]));
    const kAt = km => { const o2 = [gc[0] + km * perp[0], gc[1] + km * perp[1], gc[2] + km * perp[2]]; return gold(x => sepAt(x, o2), gm.x - 3000, gm.x + 3000, 1).f; };
    const k = (kAt(1.5) + kAt(-1.5)) / 3;
    let W = rho / Math.max(1e-9, k);
    if (inDisc && D > W) W = D; else if (!inDisc && D < W) W = D;   // right at the edge: what is seen from here decides
    // the way across the disc, seen from the observer (east, north, up), from before to after
    const span = Math.max(2.6 * rho / rate, 0.6), path = [];
    for (let i = 0; i <= 12; i++) { const dt = -span + 2 * span * i / 12, q = satPos(S, sat.rec, tc + dt * 1000); if (q) path.push([+dt.toFixed(3), ...toEnu(s, nrm(sub(q, s.o)))]); }
    // the Sun's altitude, and for the Moon how much of the way crosses its lit part (only there the silhouette shows)
    const sun = body === "Sun" ? b : bodyAt(A, s, obs, "Sun", tc);
    let lit = 1;
    if (body === "Moon") {
      const k2 = A.Illumination(A.Body.Moon, A.MakeTime(new Date(tc))).phase_fraction, u = b.u;
      const l = nrm(sub(sun.u, u.map(x => x * dot(sun.u, u)))), m2 = nrm([u[1] * l[2] - u[2] * l[1], u[2] * l[0] - u[0] * l[2], u[0] * l[1] - u[1] * l[0]]);
      let n = 0, on = 0;
      for (let i = 0; i <= 20; i++) {
        const ms = inDisc ? tc + (-half + 2 * half * i / 20) * 1000 : tc, q = satPos(S, sat.rec, ms); if (!q) continue;
        const d = nrm(sub(q, s.o)), x = dot(d, l) * R2D / rho, y = dot(d, m2) * R2D / rho;
        if (x * x + y * y > 1.0001 && inDisc) continue;
        n++; if (x >= (1 - 2 * k2) * Math.sqrt(Math.max(0, 1 - y * y))) on++;
      }
      lit = n ? on / n : 0;
    }
    const gd = S.eciToGeodetic({ x: gc[0], y: gc[1], z: gc[2] }, 0), cl = [+(gd.latitude * R2D).toFixed(5), +((gd.longitude * R2D + 540) % 360 - 180).toFixed(5)];
    return { sat: sat.name, body, t: Math.round(tc), sep, rho, rate, inDisc, t1: inDisc ? Math.round(tc - half * 1000) : null, t2: inDisc ? Math.round(tc + half * 1000) : null,
      dur: 2 * half, durC: 2 * rho / rate, D, bear: hz.bear, W, edge: D - W, runs, cl, alt: b.alt, az: b.az, range, sunAlt: sun.alt, lit, path };
  }
  return { search, searchAsync, RADII, BODIES, _: { site, satPos, bodyAt, ground } };
})();
if (typeof module !== "undefined") module.exports = ZTransit;
