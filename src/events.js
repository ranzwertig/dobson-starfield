// Sky events, calculated with Astronomy Engine. The same code runs in the app (Tonight › Coming up), in the website
// build (night sky this week, scripts/sky.mjs) and on the website's pages. It returns plain data (dates, bodies,
// numbers); whoever shows the events writes the words.
//
//   ZEvents.search(A, { from, to, obs, days, skip })
//     A     the Astronomy Engine module
//     from  start (Date, default now)
//     to    end (Date); without it each kind looks ahead its own number of days (ZEvents.DAYS, or opts.days)
//     obs   an Astronomy Engine Observer: events as seen from there (only what is above the horizon, topocentric
//           closest approach of Moon and planets, local solar eclipses). Without it: for the whole Earth
//           (geocentric, global solar eclipses, nothing left out for the horizon).
//     skip  kinds to leave out, e.g. ["moon-phase"]
//
// Each event: { type, peak: Date, ... }
//   lunar-eclipse   kind ("penumbral", "partial", "total"), alt (Moon's altitude at the peak, with obs)
//   solar-eclipse   kind, obscuration and alt (with obs), or lat/lon of the peak (without)
//   conjunction     bodies [a, b], sep (degrees); with the Moon: alt, dark (Sun below −6°) with obs;
//                   between planets: visibility ("morning" / "evening") of the first
//   occultation     the Moon covers a planet (with obs; without obs a conjunction closer than 1.2° may be one somewhere)
//   opposition      bodies [planet]
//   elongation      bodies [Mercury | Venus], elongation (degrees), visibility
//   meteor-shower   name, moon (fraction lit at the peak), ra (hours), dec (degrees), zhr
//   moon-phase      quarter: 0 new, 1 first quarter, 2 full, 3 last quarter
const ZEvents = (() => {
  const DAY = 864e5, R2D = 180 / Math.PI;
  // peak (month 0–11, day of the morning after the peak night), radiant (J2000) and rate at the zenith (IMO)
  const METEORS = [
    { name: "Quadrantids", month: 0, day: 3, ra: 15.33, dec: 49, zhr: 110 },
    { name: "Lyrids", month: 3, day: 22, ra: 18.07, dec: 34, zhr: 18 },
    { name: "Eta Aquariids", month: 4, day: 6, ra: 22.53, dec: -1, zhr: 50 },
    { name: "Perseids", month: 7, day: 12, ra: 3.2, dec: 58, zhr: 100 },
    { name: "Orionids", month: 9, day: 21, ra: 6.33, dec: 16, zhr: 20 },
    { name: "Leonids", month: 10, day: 17, ra: 10.2, dec: 22, zhr: 15 },
    { name: "Geminids", month: 11, day: 14, ra: 7.47, dec: 32, zhr: 150 },
  ];
  const DAYS = { "lunar-eclipse": 365, "solar-eclipse": 730, "moon-planet": 30, "planet-planet": 60, opposition: 120, elongation: 120, "meteor-shower": 60, "moon-phase": 30 };
  const PL = ["Mercury", "Venus", "Mars", "Jupiter", "Saturn"];
  const v3 = v => [v.x, v.y, v.z], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const unit = a => { const n = Math.hypot(...a) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };
  const sep = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * R2D;
  const minimum = (f, t0, t1, step) => { let best = null; for (let t = t0; t <= t1; t += step) { const v = f(new Date(t)); if (!best || v < best.v) best = { t, v }; } return best; };

  function search(A, opts) {
    const o = opts || {}, from = o.from || new Date(), obs = o.obs || null, skip = new Set(o.skip || []);
    const days = Object.assign({}, DAYS, o.days || {}), t0 = from.getTime();
    const until = k => o.to ? o.to.getTime() : t0 + days[k] * DAY;
    const T = d => A.MakeTime(d), out = [];
    const altOf = (body, d) => { const e = A.Equator(A.Body[body], T(d), obs, true, true); return A.Horizon(T(d), obs, e.ra, e.dec, "normal").altitude; };
    const geo = (b, d) => unit(v3(A.GeoVector(A.Body[b], T(d), true)));
    const topo = (b, d) => { const e = A.Equator(A.Body[b], T(d), obs, true, true); return unit(v3(e.vec)); };
    const safe = (k, f) => { if (!skip.has(k)) try { f(); } catch (e) {} };

    // lunar eclipses (seen from obs: only while the Moon is up there)
    safe("lunar-eclipse", () => {
      let e = A.SearchLunarEclipse(T(from));
      for (let i = 0; i < 8 && e.peak.date.getTime() <= until("lunar-eclipse"); i++, e = A.NextLunarEclipse(e.peak)) {
        if (!obs) { out.push({ type: "lunar-eclipse", peak: e.peak.date, kind: e.kind }); continue; }
        const a = altOf("Moon", e.peak.date); if (a > 0) out.push({ type: "lunar-eclipse", peak: e.peak.date, kind: e.kind, alt: a });
      }
    });
    // solar eclipses: the next one seen from obs, or every one on Earth
    safe("solar-eclipse", () => {
      if (obs) {
        const e = A.SearchLocalSolarEclipse(T(from), obs);
        if (e.peak.time.date.getTime() <= until("solar-eclipse") && e.peak.altitude > 0)
          out.push({ type: "solar-eclipse", peak: e.peak.time.date, kind: e.kind, obscuration: e.obscuration, alt: e.peak.altitude });
        return;
      }
      let e = A.SearchGlobalSolarEclipse(T(from));
      for (let i = 0; i < 8 && e.peak.date.getTime() <= until("solar-eclipse"); i++, e = A.NextGlobalSolarEclipse(e.peak))
        out.push({ type: "solar-eclipse", peak: e.peak.date, kind: e.kind, lat: e.latitude, lon: e.longitude });
    });
    // the Moon passing planets (closer than 3°; seen from obs: covering them when closer than its radius, only while
    // the Moon is up, and in darkness unless the planet is Venus or Jupiter)
    safe("moon-planet", () => {
      const step = 2 * 3600e3, end = until("moon-planet");
      PL.forEach(b => {
        let prev2 = null, prev = null;
        for (let t = t0; t <= end + step; t += step) {
          const d = new Date(t), v = sep(geo("Moon", d), geo(b, d));
          if (prev && prev2 && prev.v < prev2.v && prev.v <= v && prev.v < 4) {
            const m = obs ? minimum(x => sep(topo("Moon", x), topo(b, x)), prev.t - step, prev.t + step, 5 * 60e3)
              : minimum(x => sep(geo("Moon", x), geo(b, x)), prev.t - step, prev.t + step, 5 * 60e3);
            const d0 = new Date(m.t);
            if (m.v < 3 && m.t >= t0 && m.t <= end) {
              if (!obs) out.push({ type: "conjunction", peak: d0, bodies: ["Moon", b], sep: m.v });
              else {
                const ma = altOf("Moon", d0), dark = altOf("Sun", d0) < -6, R = 0.26;
                if (ma > 0 && (dark || b === "Venus" || b === "Jupiter")) out.push({ type: m.v < R ? "occultation" : "conjunction", peak: d0, bodies: ["Moon", b], sep: m.v, alt: ma, dark });
              }
            }
          }
          prev2 = prev; prev = { t, v };
        }
      });
    });
    // planets meeting (closer than 2°, away from the Sun)
    safe("planet-planet", () => {
      const end = until("planet-planet");
      for (let i = 0; i < PL.length; i++) for (let j = i + 1; j < PL.length; j++) {
        const a = PL[i], b = PL[j]; let prev2 = null, prev = null;
        for (let t = t0; t <= end + DAY; t += DAY) {
          const d = new Date(t), v = sep(geo(a, d), geo(b, d));
          if (prev && prev2 && prev.v < prev2.v && prev.v <= v && prev.v < 2.5) {
            const m = minimum(x => sep(geo(a, x), geo(b, x)), prev.t - DAY, prev.t + DAY, 3600e3), d0 = new Date(m.t);
            if (m.v < 2 && m.t >= t0 && m.t <= end && A.AngleFromSun(A.Body[a], T(d0)) > 15)
              out.push({ type: "conjunction", peak: d0, bodies: [a, b], sep: m.v, visibility: A.Elongation(A.Body[a], T(d0)).visibility });
          }
          prev2 = prev; prev = { t, v };
        }
      }
    });
    // oppositions and greatest elongations
    safe("opposition", () => ["Mars", "Jupiter", "Saturn", "Uranus", "Neptune"].forEach(b => {
      const x = A.SearchRelativeLongitude(A.Body[b], 0, T(from)); if (x.date.getTime() <= until("opposition")) out.push({ type: "opposition", peak: x.date, bodies: [b] });
    }));
    safe("elongation", () => ["Mercury", "Venus"].forEach(b => {
      let x = A.SearchMaxElongation(A.Body[b], T(from));
      for (let i = 0; i < 12 && x.time.date.getTime() <= until("elongation"); i++) {
        out.push({ type: "elongation", peak: x.time.date, bodies: [b], elongation: x.elongation, visibility: x.visibility });
        if (!o.to) break;
        x = A.SearchMaxElongation(A.Body[b], A.MakeTime(new Date(x.time.date.getTime() + 10 * DAY)));
      }
    }));
    // meteor shower peaks, with the Moon's light. Seen from obs: 2 am local time (the device's clock) of the morning
    // after the peak night; for the whole Earth: that morning, 0 h UTC.
    safe("meteor-shower", () => METEORS.forEach(s => {
      const end = until("meteor-shower");
      for (const y of [from.getFullYear() - 1, from.getFullYear(), from.getFullYear() + 1]) {
        const d = obs ? new Date(y, s.month, s.day, 2) : new Date(Date.UTC(y, s.month, s.day));
        if (d.getTime() < t0 - DAY || d.getTime() > end) continue;
        let k = 0; try { k = A.Illumination(A.Body.Moon, T(d)).phase_fraction; } catch (e) {}
        out.push({ type: "meteor-shower", peak: d, name: s.name, moon: k, ra: s.ra, dec: s.dec, zhr: s.zhr });
      }
    }));
    // the Moon's phases
    safe("moon-phase", () => {
      let q = A.SearchMoonQuarter(T(from));
      for (let i = 0; i < 60 && q.time.date.getTime() <= until("moon-phase"); i++, q = A.NextMoonQuarter(q)) out.push({ type: "moon-phase", peak: q.time.date, quarter: q.quarter });
    });
    out.sort((a, b) => a.peak - b.peak);
    return out;
  }
  return { search, METEORS, DAYS, PLANETS: PL };
})();
if (typeof module !== "undefined") module.exports = ZEvents;
