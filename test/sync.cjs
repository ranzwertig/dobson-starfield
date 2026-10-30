// Unit tests for src/sync.js: data model, merge, compatibility between versions, encryption. Run with `npm run test:sync`.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const Z = require("../src/sync.js");
const fx = n => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", n), "utf8"));
const results = [];
async function t(name, fn) { try { await fn(); results.push([name, true]); } catch (e) { results.push([name, false]); console.log("  ✗ " + name + "\n    " + (e.stack || e).toString().split("\n").slice(0, 3).join("\n    ")); } }
const freshObs = () => Z.migrateObs({ list: [], starred: [], log: [], exportedAt: 0 });
const inst = (id, o = {}, extra = {}) => ({ id, name: "Telescope " + id, type: "dob", mount: "altaz", o: { scope: 1200, eps: [{ f: 25, a: 52 }], ...o }, u: 0, ...extra });
const site = (id, extra = {}) => ({ id, name: "Place " + id, lat: 48.18, lon: 10.08, loc: { src: "gps" }, sky: null, u: 0, ...extra });
const cfgOf = (o = {}) => ({ lat: 48.18, lon: 10.08, mount: "altaz", show: { stars: true }, optics: { scope: 1200, eps: [{ f: 25, a: 52 }], ep: 0, ring: true }, instruments: [inst("i1")], instrumentId: "i1", sites: [site("p1")], siteId: "p1", tele: { x: 0, y: 0 }, ...o });
const entry = (uid, obj, t, extra = {}) => ({ uid, obj, name: obj, t, result: "easy", note: "", ...extra });

(async () => {
  await t("migration: old lists get version and deletion marks, entries stay as they are", () => {
    const o = Z.migrateObs({ list: [{ id: "M13", name: "M13", added: 1 }], log: [entry("a", "M31", "2025-01-01T20:00:00Z")], exportedAt: 5 });
    assert.equal(o.v, Z.OBS_V); assert.deepEqual(o.del, {}); assert.deepEqual(o.starred, []);
    assert.equal(o.list[0].u, undefined); assert.equal(o.exportedAt, 5);
  });
  await t("stamping: new, changed and deleted entries", () => {
    const o = freshObs(); let snap = Z.snapObs(o);
    o.list.push({ id: "M13", name: "M13", added: 1 }); o.log.push(entry("a", "M31", "2025-01-01T20:00:00Z"));
    snap = Z.stampObs(o, snap, 100);
    assert.equal(o.list[0].u, 100); assert.equal(o.log[0].u, 100);
    snap = Z.stampObs(o, snap, 150); assert.equal(o.list[0].u, 100, "unchanged entry keeps its time");
    o.log[0].note = "nice"; snap = Z.stampObs(o, snap, 200); assert.equal(o.log[0].u, 200); assert.equal(o.list[0].u, 100);
    o.list = o.list.filter(x => x.id !== "M13"); snap = Z.stampObs(o, snap, 300); assert.equal(o.del["l:M13"], 300);
    o.list.push({ id: "M13", name: "M13", added: 2 }); snap = Z.stampObs(o, snap, 400);
    assert.equal(o.del["l:M13"], undefined, "planned again: mark removed"); assert.equal(o.list[0].u, 400);
  });
  await t("settings: only synced settings get a time, only when changed", () => {
    const c = cfgOf(); let s = Z.snapSettings(c);
    c.show = { stars: false }; c.lat = 47.5; c.siteId = "p2"; c.tele = { x: 1, y: 1 }; c.optics.ep = 1; c.optics.scope = 1000; c.instrumentId = "i2";
    s = Z.stampSettings(c, s, 500);
    assert.deepEqual(c.syncT, { show: 500 }, "the instrument and location in use, the eyepiece chosen and the working copies belong to the device");
    c.instruments[0].o.scope = 1000; c.sites[0].name = "Garden"; s = Z.stampSettings(c, s, 600);
    assert.deepEqual(c.syncT, { show: 500, instruments: 600, sites: 600 });
  });
  await t("merge: union of both devices, newer change wins, deletions win over older entries", () => {
    const A = freshObs(), B = freshObs();
    A.log = [entry("a", "M31", "2025-01-01T20:00:00Z", { u: 10 }), entry("b", "M57", "2025-01-02T20:00:00Z", { u: 10 })];
    B.log = [entry("a", "M31", "2025-01-01T20:00:00Z", { u: 20, note: "edited on B" }), entry("c", "M27", "2025-01-03T20:00:00Z", { u: 15 })];
    A.list = [{ id: "M13", name: "M13", added: 1, u: 5 }]; B.del = { "l:M13": 7, "g:b": 30 };
    const m = Z.merge(Z.fromLocal(A, cfgOf()), Z.fromLocal(B, cfgOf()));
    assert.deepEqual(m.log.map(e => e.uid), ["a", "c"]);
    assert.equal(m.log[0].note, "edited on B"); assert.deepEqual(m.list, []);
    assert.equal(m.del["l:M13"], 7);
    const m2 = Z.merge(Z.fromLocal(B, cfgOf()), Z.fromLocal(A, cfgOf()));
    assert.ok(Z.same(m.log, m2.log) && Z.same(m.list, m2.list) && Z.same(m.del, m2.del), "same result in both directions");
  });
  await t("merge: entries planned again after a deletion survive", () => {
    const A = freshObs(), B = freshObs();
    A.del = { "l:M13": 50 }; B.list = [{ id: "M13", name: "M13", added: 60, u: 60 }];
    assert.equal(Z.merge(Z.fromLocal(A, cfgOf()), Z.fromLocal(B, cfgOf())).list.length, 1);
  });
  await t("merge: old entries without change time lose against a deletion", () => {
    const A = freshObs(), B = freshObs();
    A.log = [entry("a", "M31", "2025-01-01T20:00:00Z")]; B.del = { "g:a": 1 };
    assert.equal(Z.merge(Z.fromLocal(A, cfgOf()), Z.fromLocal(B, cfgOf())).log.length, 0);
  });
  await t("merge: settings per setting, the newer one wins, equal times decide the same way everywhere", () => {
    const ca = cfgOf({ optics: { ...cfgOf().optics, ring: false }, syncT: { "optics.ring": 100, show: 5 } }), cb = cfgOf({ show: { stars: false }, syncT: { "optics.ring": 50, show: 10 } });
    const m = Z.merge(Z.fromLocal(freshObs(), ca), Z.fromLocal(freshObs(), cb));
    assert.equal(m.settings.v["optics.ring"], false); assert.equal(m.settings.v.show.stars, false);
    const x = cfgOf({ show: { stars: 1 } }), y = cfgOf({ show: { stars: 2 } });
    const r1 = Z.merge(Z.fromLocal(freshObs(), x), Z.fromLocal(freshObs(), y)).settings.v.show.stars;
    const r2 = Z.merge(Z.fromLocal(freshObs(), y), Z.fromLocal(freshObs(), x)).settings.v.show.stars;
    assert.equal(r1, r2);
  });
  await t("merge: choosing the other device's settings when joining", () => {
    const mine = cfgOf({ show: { stars: false }, syncT: { show: 999 } }), theirs = cfgOf({ show: { stars: true, dso: false }, syncT: { show: 1 } });
    const m = Z.merge(Z.fromLocal(freshObs(), theirs), Z.fromLocal(freshObs(), mine), { settings: "remote" });
    assert.deepEqual(m.settings.v.show, { stars: true, dso: false });
    assert.ok(Z.settingsDiffer(Z.fromLocal(freshObs(), mine), Z.fromLocal(freshObs(), theirs)));
    assert.ok(!Z.settingsDiffer(Z.fromLocal(freshObs(), mine), Z.fromLocal(freshObs(), cfgOf({ show: { stars: false }, lat: 12, siteId: "x", tele: { x: 9, y: 9 } }))));
  });
  await t("collisions: an entry edited on both devices keeps both edits (field by field, with the last synced version)", () => {
    const base = entry("a", "M31", "2025-01-01T20:00:00Z", { u: 5, note: "", result: "easy", seeing: 3 });
    const onA = { ...base, note: "dust lane", u: 10 }, onB = { ...base, result: "hard", seeing: 2, u: 20 };
    const A = freshObs(), B = freshObs(); A.log = [onA]; B.log = [onB];
    const b = { log: [base] };
    const m1 = Z.merge(Z.fromLocal(B, cfgOf()), Z.fromLocal(A, cfgOf()), { base: b });
    const m2 = Z.merge(Z.fromLocal(A, cfgOf()), Z.fromLocal(B, cfgOf()), { base: b });
    const e = m1.log[0];
    assert.equal(e.note, "dust lane"); assert.equal(e.result, "hard"); assert.equal(e.seeing, 2); assert.equal(e.u, 21);
    assert.ok(Z.same(m1.log, m2.log), "same result on both devices");
    // the device that wrote the later edit gets the combination too, also when it has no base (the combination is newer)
    assert.equal(Z.merge(m1, Z.fromLocal(B, cfgOf())).log[0].note, "dust lane");
  });
  await t("collisions: the same field edited on both devices: the later edit wins that field only", () => {
    const base = entry("a", "M31", "2025-01-01T20:00:00Z", { u: 5, note: "", ep: "25 mm" });
    const A = freshObs(), B = freshObs();
    A.log = [{ ...base, note: "from A", ep: "10 mm", u: 30 }]; B.log = [{ ...base, note: "from B", u: 20 }];
    const e = Z.merge(Z.fromLocal(B, cfgOf()), Z.fromLocal(A, cfgOf()), { base: { log: [base] } }).log[0];
    assert.equal(e.note, "from A"); assert.equal(e.ep, "10 mm");
    const f = Z.merge(Z.fromLocal(A, cfgOf()), Z.fromLocal({ ...B, log: [{ ...base, note: "from B", seeing: 4, u: 40 }] }, cfgOf()), { base: { log: [base] } }).log[0];
    assert.equal(f.note, "from B"); assert.equal(f.ep, "10 mm"); assert.equal(f.seeing, 4);
  });
  await t("collisions: without the last synced version the newer entry wins as a whole (as before)", () => {
    const base = entry("a", "M31", "2025-01-01T20:00:00Z", { u: 5, note: "" });
    const A = freshObs(), B = freshObs(); A.log = [{ ...base, note: "A", u: 10 }]; B.log = [{ ...base, result: "hard", u: 20 }];
    const e = Z.merge(Z.fromLocal(A, cfgOf()), Z.fromLocal(B, cfgOf())).log[0];
    assert.equal(e.note, ""); assert.equal(e.result, "hard");
  });
  await t("instruments: added, edited and deleted on two devices are combined record by record", () => {
    const d = inst("i1"), e = inst("i2", { scope: 600 }, { type: "refr" }), b = { id: "b1", name: "Binoculars 10×50", type: "bino", bino: { mag: 10, ap: 50, fov: 6.5 }, u: 0 };
    const base = { settings: { v: { instruments: [d, e] } } };
    // A: adds binoculars and gives the Dobson a 6 mm; B: adds an ED 80 and deletes the refractor
    const A = cfgOf({ instruments: [{ ...d, o: { ...d.o, eps: [...d.o.eps, { f: 6, a: 60 }] }, u: 10 }, e, b] });
    const ed = inst("i3", { scope: 480 }, { name: "ED 80", type: "refr", u: 12 });
    const B = cfgOf({ instruments: [d, ed] });
    for (const [r, l] of [[A, B], [B, A]]) {
      const v = Z.merge(Z.fromLocal(freshObs(), r), Z.fromLocal(freshObs(), l), { base }).settings.v.instruments;
      assert.deepEqual(v.map(i => i.id).sort(), ["b1", "i1", "i3"], "the refractor is gone, the new ones are in");
      assert.deepEqual(v.find(i => i.id === "i1").o.eps.map(x => x.f), [25, 6], "the Dobson keeps the new eyepiece");
    }
    // the same instrument changed on both: the newer change wins
    const C = cfgOf({ instruments: [{ ...d, name: "Dobson 8", u: 30 }, e] }), D = cfgOf({ instruments: [{ ...d, name: "My Dob", u: 20 }, e] });
    assert.equal(Z.merge(Z.fromLocal(freshObs(), C), Z.fromLocal(freshObs(), D), { base }).settings.v.instruments[0].name, "Dobson 8");
    assert.equal(Z.merge(Z.fromLocal(freshObs(), D), Z.fromLocal(freshObs(), C), { base }).settings.v.instruments[0].name, "Dobson 8");
    // eyepieces added to the same telescope on each device, and its name changed on one: all of it on both
    const P = cfgOf({ instruments: [{ ...d, o: { ...d.o, eps: [...d.o.eps, { f: 6, a: 60 }] }, u: 50 }, e] });
    const Q = cfgOf({ instruments: [{ ...d, name: "Dobson 8″", o: { ...d.o, eps: [...d.o.eps, { f: 32, a: 50 }] }, u: 40 }, e] });
    for (const [r, l] of [[P, Q], [Q, P]]) {
      const x = Z.merge(Z.fromLocal(freshObs(), r), Z.fromLocal(freshObs(), l), { base }).settings.v.instruments[0];
      assert.deepEqual(x.o.eps.map(y => y.f).sort((p, q) => p - q), [6, 25, 32]); assert.equal(x.name, "Dobson 8″"); assert.equal(x.u, 51);
    }
    // deleted on one device, changed on the other since: it stays
    const E = cfgOf({ instruments: [d] }), F = cfgOf({ instruments: [d, { ...e, name: "Refractor 102", u: 40 }] });
    assert.equal(Z.merge(Z.fromLocal(freshObs(), E), Z.fromLocal(freshObs(), F), { base }).settings.v.instruments.length, 2);
    // without the last synced version (joining a group): all instruments of both devices
    const G = cfgOf({ instruments: [d] }), H = cfgOf({ instruments: [ed] });
    assert.deepEqual(Z.merge(Z.fromLocal(freshObs(), G), Z.fromLocal(freshObs(), H)).settings.v.instruments.map(i => i.id), ["i1", "i3"]);
  });
  await t("instruments: the single telescope of schema 1.0 stays in the shared copy for older apps", () => {
    const remote = Z.fromLocal(freshObs(), cfgOf()); remote.schema = { major: 1, minor: 0 };
    remote.settings.v["optics.eps"] = [{ f: 9, a: 60 }]; remote.settings.v.mount = "eq"; remote.settings.t["optics.eps"] = 5;
    const m = Z.merge(remote, Z.fromLocal(freshObs(), cfgOf()));
    assert.deepEqual(m.settings.v["optics.eps"], [{ f: 9, a: 60 }]); assert.equal(m.settings.v.mount, "eq");
    const c = cfgOf(); Z.apply(m, freshObs(), c);
    assert.equal(c.mount, "altaz"); assert.deepEqual(c.optics.eps, [{ f: 25, a: 52 }], "not applied: the instruments carry them now");
  });
  await t("locations: added, edited and deleted on two devices are combined record by record", () => {
    const g = site("p1", { name: "Garden" }), f = site("p2", { name: "Field", lat: 48.2 }), base = { settings: { v: { sites: [g, f] } } };
    const hz = { v: 1, alt: "AAAA", at: "2026-10-28T16:40:00Z", how: "camera" };
    // A records a horizon for the garden; B renames the field and adds a holiday flat
    const A = cfgOf({ sites: [{ ...g, horizon: hz, u: 10 }, f] }), B = cfgOf({ sites: [g, { ...f, name: "Field track", u: 12 }, site("s9", { name: "Allgäu", u: 12 })] });
    for (const [r, l] of [[A, B], [B, A]]) {
      const v = Z.merge(Z.fromLocal(freshObs(), r), Z.fromLocal(freshObs(), l), { base }).settings.v.sites;
      assert.deepEqual(v.map(x => x.id).sort(), ["p1", "p2", "s9"]);
      assert.deepEqual(v.find(x => x.id === "p1").horizon, hz); assert.equal(v.find(x => x.id === "p2").name, "Field track");
    }
    // deleted on one, unchanged on the other: gone
    const C = cfgOf({ sites: [g] }), D = cfgOf({ sites: [g, f] });
    assert.deepEqual(Z.merge(Z.fromLocal(freshObs(), C), Z.fromLocal(freshObs(), D), { base }).settings.v.sites.map(x => x.id), ["p1"]);
    // the same name and place on two devices that never synced (the place of an earlier version): one record
    const E = cfgOf({ sites: [site("p_x", { name: "My location" })] }), F = cfgOf({ sites: [site("p_x", { name: "My location" })] });
    assert.equal(Z.merge(Z.fromLocal(freshObs(), E), Z.fromLocal(freshObs(), F)).settings.v.sites.length, 1);
  });
  await t("locations: the place of schema 1.1 stays in the shared copy for older apps, and doesn't move this device", () => {
    const remote = Z.fromLocal(freshObs(), cfgOf()); remote.schema = { major: 1, minor: 1 };
    Object.assign(remote.settings.v, { lat: 52.5, lon: 13.4, loc: { src: "manual" }, sky: "city" }); remote.settings.t.lat = 99;
    const m = Z.merge(remote, Z.fromLocal(freshObs(), cfgOf()));
    assert.equal(m.settings.v.lat, 52.5); assert.equal(m.settings.v.sky, "city"); assert.deepEqual(m.schema, Z.SCHEMA);
    const c = cfgOf(); Z.apply(m, freshObs(), c);
    assert.equal(c.lat, 48.18); assert.equal(c.sky, undefined, "not applied: the locations carry the place now");
  });
  await t("apply: merged copy into lists and settings; device settings untouched", () => {
    const o = freshObs(), c = cfgOf({ tele: { x: 3, y: 4 } });
    const p = Z.fromLocal(freshObs(), cfgOf({ sites: [site("p1", { lat: 40 })], siteId: "other", instruments: [inst("i1", { scope: 900, eps: [{ f: 9, a: 60 }] })], instrumentId: "other" }));
    p.log = [entry("z", "M42", "2025-02-01T20:00:00Z", { u: 3 })]; p.settings.t.sites = 77;
    assert.equal(Z.apply(p, o, c), true);
    assert.equal(c.sites[0].lat, 40); assert.equal(c.lat, 48.18, "the working copy follows the location in use (done by the app)"); assert.equal(c.instruments[0].o.scope, 900); assert.deepEqual(c.tele, { x: 3, y: 4 }); assert.equal(c.optics.ep, 0);
    assert.equal(c.instrumentId, "i1", "which instrument the device uses stays"); assert.equal(c.siteId, "p1", "and which location");
    assert.equal(c.syncT.sites, 77); assert.equal(o.log[0].uid, "z");
    assert.equal(Z.apply(p, o, c), false, "nothing changed the second time");
  });
  await t("compatibility: a newer minor version passes through what this app doesn't know", () => {
    const remote = Z.fromLocal(freshObs(), cfgOf());
    remote.schema = { major: 1, minor: 7 }; remote.photos = [{ id: "p1" }];
    remote.log = [entry("a", "M31", "2025-01-01T20:00:00Z", { u: 10, sketch: "data:…", rating: 5 })];
    remote.settings.v["optics.filters"] = ["UHC"]; remote.settings.t["optics.filters"] = 8; remote.settings.extra = 1;
    remote.devices = { d1: { name: "Tablet", at: 1, os: "x" } };
    const local = Z.fromLocal(freshObs(), cfgOf()); local.list = [{ id: "M13", name: "M13", added: 1, u: 2 }];
    const m = Z.merge(remote, local);
    assert.deepEqual(m.schema, { major: 1, minor: 7 }); assert.deepEqual(m.photos, [{ id: "p1" }]);
    assert.equal(m.log[0].sketch, "data:…"); assert.equal(m.log[0].rating, 5);
    assert.deepEqual(m.settings.v["optics.filters"], ["UHC"]); assert.equal(m.settings.extra, 1); assert.equal(m.devices.d1.os, "x");
    // the entry survives a round through this app's local lists, also when edited here
    const o = freshObs(), c = cfgOf(); Z.apply(m, o, c); let snap = Z.snapObs(o);
    o.log[0].note = "edited by the old app"; snap = Z.stampObs(o, snap, 50);
    const m2 = Z.merge(m, Z.fromLocal(o, c));
    assert.equal(m2.log[0].sketch, "data:…"); assert.equal(m2.log[0].note, "edited by the old app");
  });
  await t("compatibility: a newer major version is refused, not overwritten", () => {
    const remote = Z.fromLocal(freshObs(), cfgOf()); remote.schema = { major: 2, minor: 0 };
    assert.throws(() => Z.merge(remote, Z.fromLocal(freshObs(), cfgOf())), e => e.code === "newer");
  });
  await t("compatibility: older copies (lower minor) are lifted to this version", () => {
    const remote = Z.fromLocal(freshObs(), cfgOf()); remote.schema = { major: 1, minor: 0 }; delete remote.devices; delete remote.del;
    const m = Z.merge(remote, Z.fromLocal(freshObs(), cfgOf()));
    assert.deepEqual(m.schema, Z.SCHEMA); assert.deepEqual(m.devices, {}); assert.deepEqual(m.del, {});
  });
  await t("backups: versions 1, 2 and 3 can still be read", () => {
    for (const [f, nl, ns, ng] of [["backup-v1.json", 1, 0, 1], ["backup-v2.json", 1, 1, 2], ["backup-v3.json", 1, 1, 1]]) {
      const p = Z.readBackup(fx(f)); assert.ok(p, f);
      const m = Z.merge(Z.fromLocal(freshObs(), cfgOf()), p);
      assert.equal(m.list.length, nl, f); assert.equal(m.starred.length, ns, f); assert.equal(m.log.length, ng, f);
    }
    assert.equal(Z.readBackup({ foo: 1 }), null);
  });
  await t("backups: version 5 keeps the old shape, so the import of older app versions still reads it", () => {
    const o = freshObs(); o.log = [entry("a", "M31", "2025-01-01T20:00:00Z", { u: 3 })]; o.del = { "g:x": 2 };
    o.lists = [{ id: "l1", name: "Spring galaxies", added: 1, u: 2 }]; o.items = [{ id: "M51", list: "l1", name: "M51", added: 1, u: 2 }];
    const d = JSON.parse(JSON.stringify(Z.makeBackup(o, cfgOf(), true)));
    assert.equal(d.version, 5); assert.equal(d.app, "Zenigo");
    assert.equal(Z.readBackup(d).lists[0].name, "Spring galaxies"); assert.equal(Z.readBackup(d).items[0].list, "l1");
    // the import of version 3 apps: an array "log" or an object "settings"; entries need uid, obj and t; lists need id
    assert.ok(Array.isArray(d.log) && Array.isArray(d.list) && Array.isArray(d.starred) && typeof d.settings === "object");
    assert.ok(d.log.every(e => e.uid && e.obj && e.t));
    assert.deepEqual(Z.readBackup(d).del, { "g:x": 2 });
  });
  await t("own lists: added to, renamed and moved between on two devices, merged record by record", () => {
    const A = freshObs(); A.lists = [{ id: "l1", name: "Spring", added: 1 }, { id: "l2", name: "Club night", added: 2 }];
    A.items = [{ id: "M51", list: "l1", name: "M51", added: 1 }, { id: "M101", list: "l1", name: "M101", added: 1 }];
    Z.stampObs(A, new Map(), 10);
    const base = Z.fromLocal(A, cfgOf()), B = JSON.parse(JSON.stringify(A));
    // A renames the list and moves M51 to the club night; B adds M104 to the first list
    let sa = Z.snapObs(A); A.lists[0].name = "Spring galaxies"; A.items = A.items.filter(x => x.id !== "M51"); A.items.push({ id: "M51", list: "l2", name: "M51", added: 20 }); Z.stampObs(A, sa, 20);
    let sb = Z.snapObs(B); B.items.push({ id: "M104", list: "l1", name: "M104", added: 21 }); Z.stampObs(B, sb, 21);
    const m = Z.merge(Z.fromLocal(A, cfgOf()), Z.fromLocal(B, cfgOf()), { base });
    assert.equal(m.lists.find(l => l.id === "l1").name, "Spring galaxies");
    const where = id => m.items.filter(x => x.id === id).map(x => x.list).sort().join(",");
    assert.equal(where("M51"), "l2", "moved: gone from the first list, in the second"); assert.equal(where("M104"), "l1"); assert.equal(where("M101"), "l1");
    // a list deleted on one device (with its objects) goes everywhere
    sa = Z.snapObs(A); A.lists = A.lists.filter(l => l.id !== "l2"); A.items = A.items.filter(x => x.list !== "l2"); Z.stampObs(A, sa, 30);
    const m2 = Z.merge(m, Z.fromLocal(A, cfgOf()));
    assert.deepEqual(m2.lists.map(l => l.id), ["l1"]); assert.ok(!m2.items.some(x => x.list === "l2"));
    const o = freshObs(); Z.apply(m2, o, cfgOf()); assert.equal(o.lists.length, 1); assert.equal(o.items.length, 2);
  });
  await t("own lists: a copy without them (an older app) keeps them when merged", () => {
    const A = freshObs(); A.lists = [{ id: "l1", name: "Kids", added: 1, u: 5 }]; A.items = [{ id: "M42", list: "l1", name: "M42", added: 1, u: 5 }];
    const old = Z.fromLocal(freshObs(), cfgOf()); delete old.lists; delete old.items; old.schema = { major: 1, minor: 2 };
    const m = Z.merge(old, Z.fromLocal(A, cfgOf()));
    assert.equal(m.lists.length, 1); assert.equal(m.items.length, 1); assert.deepEqual(m.schema, Z.SCHEMA);
    assert.ok(Z.KNOWN.has("lists") && Z.KNOWN.has("items"));
  });
  await t("encryption: round trip, address and password come from the code, the server learns nothing", async () => {
    const code = Z.newCode(); assert.match(code, /^[A-Za-z0-9_-]{43}$/);
    const k1 = await Z.keys(code), k2 = await Z.keys(code);
    assert.equal(k1.id, k2.id); assert.equal(k1.token, k2.token); assert.match(k1.id, /^[A-Za-z0-9_-]{22}$/); assert.notEqual(k1.id, k1.token.slice(0, 22));
    const o = freshObs(); o.log = [entry("a", "M31", "2025-01-01T20:00:00Z", { note: "secret note", lat: 48.123 })];
    const p = Z.fromLocal(o, cfgOf()), box = await Z.seal(k1, p);
    assert.equal(box[0], 1);
    const txt = Buffer.from(box).toString("latin1"); assert.ok(!txt.includes("secret") && !txt.includes("48.1"), "nothing readable in the stored bytes");
    assert.deepEqual(await Z.open(k2, box), p);
    const other = await Z.keys(Z.newCode()); await assert.rejects(Z.open(other, box));
    const moved = { ...other, key: k1.key }; await assert.rejects(Z.open(moved, box), "bound to its group's address");
    const future = box.slice(); future[0] = 2; await assert.rejects(Z.open(k1, future), e => e.code === "newer");
  });
  await t("join link: the code sits in the #fragment; links and bare codes are recognised", () => {
    const code = Z.newCode(), l = Z.joinLink("https://zenigo.app", code);
    assert.equal(l, "https://zenigo.app/app/#join=" + code);
    assert.equal(Z.parseJoin(l), code); assert.equal(Z.parseJoin("  " + code + "\n"), code);
    assert.equal(Z.parseJoin("https://zenigo.app/app/#join=abc"), null); assert.equal(Z.parseJoin(""), null);
  });

  const failed = results.filter(r => !r[1]).length;
  console.log((results.length - failed) + "/" + results.length + " sync tests passed");
  process.exit(failed ? 1 : 0);
})();
