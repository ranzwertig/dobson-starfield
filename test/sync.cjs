// Unit tests for src/sync.js: data model, merge, compatibility between versions, encryption. Run with `npm run test:sync`.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const Z = require("../src/sync.js");
const fx = n => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", n), "utf8"));
const results = [];
async function t(name, fn) { try { await fn(); results.push([name, true]); } catch (e) { results.push([name, false]); console.log("  ✗ " + name + "\n    " + (e.stack || e).toString().split("\n").slice(0, 3).join("\n    ")); } }
const freshObs = () => Z.migrateObs({ list: [], starred: [], log: [], exportedAt: 0 });
const cfgOf = (o = {}) => ({ lat: 48.18, lon: 10.08, mount: "altaz", show: { stars: true }, optics: { scope: 1200, eps: [{ f: 25, a: 52 }], ep: 0 }, tele: { x: 0, y: 0 }, ...o });
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
    c.lat = 47.5; c.tele = { x: 1, y: 1 }; c.optics.ep = 1; c.optics.scope = 1000;
    s = Z.stampSettings(c, s, 500);
    assert.deepEqual(c.syncT, { lat: 500, "optics.scope": 500 });
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
    const ca = cfgOf({ lat: 47, syncT: { lat: 100, mount: 5 } }), cb = cfgOf({ lat: 46, mount: "eq", syncT: { lat: 50, mount: 10 } });
    const m = Z.merge(Z.fromLocal(freshObs(), ca), Z.fromLocal(freshObs(), cb));
    assert.equal(m.settings.v.lat, 47); assert.equal(m.settings.v.mount, "eq");
    const x = cfgOf({ lat: 1 }), y = cfgOf({ lat: 2 });
    const r1 = Z.merge(Z.fromLocal(freshObs(), x), Z.fromLocal(freshObs(), y)).settings.v.lat;
    const r2 = Z.merge(Z.fromLocal(freshObs(), y), Z.fromLocal(freshObs(), x)).settings.v.lat;
    assert.equal(r1, r2);
  });
  await t("merge: choosing the other device's settings when joining", () => {
    const mine = cfgOf({ lat: 47, syncT: { lat: 999 } }), theirs = cfgOf({ lat: 52, syncT: { lat: 1 } });
    const m = Z.merge(Z.fromLocal(freshObs(), theirs), Z.fromLocal(freshObs(), mine), { settings: "remote" });
    assert.equal(m.settings.v.lat, 52);
    assert.ok(Z.settingsDiffer(Z.fromLocal(freshObs(), mine), Z.fromLocal(freshObs(), theirs)));
    assert.ok(!Z.settingsDiffer(Z.fromLocal(freshObs(), mine), Z.fromLocal(freshObs(), cfgOf({ lat: 47, tele: { x: 9, y: 9 } }))));
  });
  await t("apply: merged copy into lists and settings; device settings untouched", () => {
    const o = freshObs(), c = cfgOf({ tele: { x: 3, y: 4 } });
    const p = Z.fromLocal(freshObs(), cfgOf({ lat: 40, optics: { scope: 900, eps: [{ f: 9, a: 60 }], ep: 0 } }));
    p.log = [entry("z", "M42", "2025-02-01T20:00:00Z", { u: 3 })]; p.settings.t.lat = 77;
    assert.equal(Z.apply(p, o, c), true);
    assert.equal(c.lat, 40); assert.equal(c.optics.scope, 900); assert.deepEqual(c.tele, { x: 3, y: 4 }); assert.equal(c.optics.ep, 0);
    assert.equal(c.syncT.lat, 77); assert.equal(o.log[0].uid, "z");
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
  await t("backups: version 4 keeps the old shape, so the import of older app versions still reads it", () => {
    const o = freshObs(); o.log = [entry("a", "M31", "2025-01-01T20:00:00Z", { u: 3 })]; o.del = { "g:x": 2 };
    const d = JSON.parse(JSON.stringify(Z.makeBackup(o, cfgOf(), true)));
    assert.equal(d.version, 4); assert.equal(d.app, "Zenigo");
    // the import of version 3 apps: an array "log" or an object "settings"; entries need uid, obj and t; lists need id
    assert.ok(Array.isArray(d.log) && Array.isArray(d.list) && Array.isArray(d.starred) && typeof d.settings === "object");
    assert.ok(d.log.every(e => e.uid && e.obj && e.t));
    assert.deepEqual(Z.readBackup(d).del, { "g:x": 2 });
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
