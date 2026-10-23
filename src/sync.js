// Zenigo sync core: the data model shared by sync and backups (versions, change times, deletion marks), the merge of
// two copies, and the end-to-end encryption. No DOM and no network: the app does that. Runs in the browser and in Node
// (test/sync.cjs).
//
// Compatibility rules (they are what lets an old phone and a new tablet share one sync group):
//  - Every layer has its own version: the encrypted envelope (first byte), the content (schema major.minor), the local
//    lists (obs.v), the backup file (version) and the server API (/api/sync/v1).
//  - schema minor: additive changes only (new fields, new kinds of entries, new settings). Older apps keep syncing and
//    pass everything they don't know through unchanged: entries are stored whole, unknown top-level keys and unknown
//    settings stay in the copy that is written back.
//  - schema major: a real break. An older app that sees a newer major stops writing and asks for an update; on its own
//    device it keeps working.
//  - Missing fields always mean their default: an entry without a change time "u" counts as 0 (older than any change).
//  - Backups keep their old top-level shape (list, starred, log, settings), so older app versions can still import them.
const ZSync = (() => {
  const SCHEMA = { major: 1, minor: 0 };
  const ENV_V = 1;                // envelope: [version][compression][12 bytes IV][AES-GCM ciphertext]
  const OBS_V = 2;                // local lists: 1 = no change times, 2 = change times "u" and deletion marks "del"
  const BACKUP_V = 4;             // backup file: 3 = lists and settings, 4 = adds change times, deletion marks and setting times
  // Settings that travel between devices (paths into the settings). Everything else belongs to the device: the eyepiece
  // point and pointing (they depend on how the phone sits on the telescope), camera and field of view, compass
  // correction, red light, display and layout.
  const SETTINGS = ["lat", "lon", "loc", "mount", "show",
    "optics.scope", "optics.ap", "optics.barlow", "optics.useB", "optics.finder", "optics.finderType", "optics.finderOrient",
    "optics.eps", "optics.telrad", "optics.ring", "optics.orient", "optics.rot"];
  const KINDS = { list: x => "l:" + x.id, starred: x => "s:" + x.id, log: x => "g:" + x.uid };
  const KNOWN = new Set(["app", "schema", "list", "starred", "log", "del", "settings", "devices"]);

  // JSON with sorted keys: equal data gives an equal string, whatever the order the fields were written in
  const stable = v => JSON.stringify(v, (k, x) => x && typeof x === "object" && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, key) => (o[key] = x[key], o), {}) : x);
  const body = r => { const { u, ...rest } = r; return stable(rest); };
  const valid = (kind, r) => r && typeof r === "object" && (kind === "log" ? r.uid && r.obj && r.t : r.id);
  const getP = (o, p) => p.split(".").reduce((x, k) => x == null ? undefined : x[k], o);
  const setP = (o, p, v) => { const ks = p.split("."), last = ks.pop(); let x = o; ks.forEach(k => { if (!x[k] || typeof x[k] !== "object") x[k] = {}; x = x[k]; }); x[last] = v; };
  const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));

  /* ---------- local lists: migration, change times, deletion marks ---------- */
  function migrateObs(obs) {
    if (!obs || typeof obs !== "object") obs = {};
    ["list", "starred", "log"].forEach(k => { if (!Array.isArray(obs[k])) obs[k] = []; });
    if (!obs.del || typeof obs.del !== "object") obs.del = {};
    if (!(obs.v >= OBS_V)) obs.v = OBS_V;     // nothing to rewrite: entries without "u" simply count as 0
    return obs;
  }
  // what the lists looked like at the last save (key -> content without the change time)
  function snapObs(obs) {
    const m = new Map();
    Object.keys(KINDS).forEach(kind => (obs[kind] || []).forEach(r => { if (valid(kind, r)) m.set(KINDS[kind](r), body(r)); }));
    return m;
  }
  // Called on every save: new or changed entries get u = now, entries that are gone get a deletion mark.
  // Works for every place in the app that edits the lists, without them knowing about sync. Returns the new snapshot.
  function stampObs(obs, prev, now) {
    const cur = snapObs(obs);
    Object.keys(KINDS).forEach(kind => (obs[kind] || []).forEach(r => {
      if (!valid(kind, r)) return;
      const k = KINDS[kind](r);
      if (prev.get(k) !== cur.get(k)) { r.u = now; delete obs.del[k]; }
    }));
    prev.forEach((_, k) => { if (!cur.has(k)) obs.del[k] = now; });
    return cur;
  }

  /* ---------- settings: change times per synced setting ---------- */
  function snapSettings(cfg) { const m = new Map(); SETTINGS.forEach(p => m.set(p, stable(getP(cfg, p)))); return m; }
  function stampSettings(cfg, prev, now) {
    const cur = snapSettings(cfg);
    if (!cfg.syncT || typeof cfg.syncT !== "object") cfg.syncT = {};
    cur.forEach((v, p) => { if (prev.has(p) && prev.get(p) !== v) cfg.syncT[p] = now; });
    return cur;
  }

  /* ---------- the shared copy ("payload") ---------- */
  function fromLocal(obs, cfg, devices) {
    const v = {}, t = {};
    SETTINGS.forEach(p => { const x = getP(cfg, p); if (x !== undefined) { v[p] = clone(x); t[p] = (cfg.syncT && cfg.syncT[p]) || 0; } });
    return { app: "Zenigo", schema: { ...SCHEMA }, list: clone(obs.list), starred: clone(obs.starred), log: clone(obs.log),
      del: { ...obs.del }, settings: { v, t }, devices: clone(devices || {}) };
  }
  const newer = s => !!s && s.major > SCHEMA.major;
  const pick = (a, b, ta, tb) => ta !== tb ? (ta > tb ? a : b) : stable(a) >= stable(b) ? a : b;   // same time: the same choice on every device
  // Merge two copies: per entry and per setting the newer change wins; deletion marks win over older entries.
  // Starts from the remote copy, so whatever this app version doesn't know stays in it.
  // opts.settings: "remote" takes the remote settings as they are (joining a group and choosing the other device's settings).
  function merge(remote, local, opts = {}) {
    if (!remote) return clone(local);
    if (newer(remote.schema)) { const e = new Error("newer"); e.code = "newer"; throw e; }
    const out = clone(remote);
    const del = { ...(remote.del || {}) };
    Object.entries(local.del || {}).forEach(([k, t]) => { if (!(del[k] >= t)) del[k] = t; });
    out.del = del;
    Object.keys(KINDS).forEach(kind => {
      const m = new Map(), order = [];
      [remote[kind], local[kind]].forEach(arr => (arr || []).forEach(r => {
        if (!valid(kind, r)) return;
        const k = KINDS[kind](r), had = m.get(k);
        if (!had) { m.set(k, r); order.push(k); }
        else m.set(k, pick(had, r, had.u || 0, r.u || 0));
      }));
      out[kind] = order.filter(k => !(del[k] >= (m.get(k).u || 0))).map(k => clone(m.get(k)));
      if (kind === "log") out[kind].sort((a, b) => a.t < b.t ? -1 : a.t > b.t ? 1 : 0);
    });
    const rs = remote.settings || { v: {}, t: {} }, ls = local.settings || { v: {}, t: {} };
    const v = { ...(rs.v || {}) }, t = { ...(rs.t || {}) };
    if (opts.settings !== "remote") Object.keys(ls.v || {}).forEach(p => {
      if (!(p in v)) { v[p] = ls.v[p]; t[p] = ls.t[p] || 0; return; }
      const lt = ls.t[p] || 0, rt = t[p] || 0, w = pick({ x: v[p] }, { x: ls.v[p] }, rt, lt);
      v[p] = clone(w.x); t[p] = Math.max(lt, rt);
    });
    else Object.keys(ls.v || {}).forEach(p => { if (!(p in v)) { v[p] = ls.v[p]; t[p] = ls.t[p] || 0; } });
    out.settings = { ...rs, v, t };
    const dv = { ...(remote.devices || {}) };
    Object.entries(local.devices || {}).forEach(([id, d]) => { if (!dv[id] || (d.at || 0) >= (dv[id].at || 0)) dv[id] = d; });
    out.devices = dv;
    if (!out.schema || out.schema.major < SCHEMA.major || (out.schema.major === SCHEMA.major && out.schema.minor < SCHEMA.minor)) out.schema = { ...SCHEMA };
    out.app = "Zenigo";
    return out;
  }
  // Do the settings of two copies differ (only the ones this app syncs)?
  function settingsDiffer(a, b) {
    const av = (a && a.settings && a.settings.v) || {}, bv = (b && b.settings && b.settings.v) || {};
    return SETTINGS.some(p => p in av && p in bv && stable(av[p]) !== stable(bv[p]));
  }
  // Put a merged copy into the local lists and settings. Returns whether any synced setting changed.
  function apply(payload, obs, cfg) {
    ["list", "starred", "log"].forEach(k => { obs[k] = clone(payload[k] || []); });
    obs.del = { ...(payload.del || {}) };
    let changed = false;
    const s = payload.settings || { v: {}, t: {} };
    if (!cfg.syncT || typeof cfg.syncT !== "object") cfg.syncT = {};
    SETTINGS.forEach(p => {
      if (!(p in (s.v || {}))) return;
      if (stable(getP(cfg, p)) !== stable(s.v[p])) { setP(cfg, p, clone(s.v[p])); changed = true; }
      cfg.syncT[p] = s.t[p] || 0;
    });
    return changed;
  }
  const same = (a, b) => stable(a) === stable(b);

  /* ---------- backups: every version in, version 4 out ---------- */
  function makeBackup(obs, cfg, all) {
    const d = { app: "Zenigo", version: BACKUP_V, kind: all ? "all" : "lists", exportedAt: new Date().toISOString(),
      list: obs.list, starred: obs.starred, log: obs.log, del: obs.del };
    if (all) d.settings = cfg;
    return d;
  }
  // A backup file (version 1 to 4, or newer: unknown fields are ignored) as a copy for merge(); null if it isn't one.
  function readBackup(d) {
    if (!d || typeof d !== "object" || (!Array.isArray(d.log) && !d.settings)) return null;
    const p = { app: "Zenigo", schema: { ...SCHEMA }, list: Array.isArray(d.list) ? d.list : [], starred: Array.isArray(d.starred) ? d.starred : [],
      log: Array.isArray(d.log) ? d.log : [], del: d.del && typeof d.del === "object" ? d.del : {}, settings: { v: {}, t: {} }, devices: {} };
    return p;
  }

  /* ---------- encryption ---------- */
  const C = globalThis.crypto, enc = new TextEncoder(), dec = new TextDecoder();
  const b64u = bytes => { let s = ""; bytes.forEach(b => s += String.fromCharCode(b)); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
  const unb64u = s => { const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)); return Uint8Array.from(b, c => c.charCodeAt(0)); };
  const CODE_RE = /^[A-Za-z0-9_-]{43}$/;
  const newCode = () => b64u(C.getRandomValues(new Uint8Array(32)));
  // From the sync code: the group's address on the server, the password for the server and the key that never leaves the device
  async function keys(code) {
    if (!CODE_RE.test(code)) throw new Error("bad code");
    const base = await C.subtle.importKey("raw", unb64u(code), "HKDF", false, ["deriveBits", "deriveKey"]);
    const hk = info => ({ name: "HKDF", hash: "SHA-256", salt: enc.encode("zenigo-sync"), info: enc.encode(info) });
    const id = b64u(new Uint8Array(await C.subtle.deriveBits(hk("zenigo-sync-v1 id"), base, 128)));
    const token = b64u(new Uint8Array(await C.subtle.deriveBits(hk("zenigo-sync-v1 auth"), base, 256)));
    const key = await C.subtle.deriveKey(hk("zenigo-sync-v1 enc"), base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    return { id, token, key };
  }
  async function pipe(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }
  const aad = id => enc.encode("zenigo-sync/" + ENV_V + "/" + id);
  async function seal(k, payload) {
    let data = enc.encode(JSON.stringify(payload)), z = 0;
    if (typeof CompressionStream === "function") { data = await pipe(data, new CompressionStream("gzip")); z = 1; }
    const iv = C.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await C.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(k.id) }, k.key, data));
    const out = new Uint8Array(14 + ct.length); out[0] = ENV_V; out[1] = z; out.set(iv, 2); out.set(ct, 14);
    return out;
  }
  async function open(k, bytes) {
    bytes = new Uint8Array(bytes);
    if (bytes[0] > ENV_V) { const e = new Error("newer"); e.code = "newer"; throw e; }
    if (bytes[0] !== 1 || bytes.length < 30) throw new Error("bad data");
    let data = new Uint8Array(await C.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(2, 14), additionalData: aad(k.id) }, k.key, bytes.slice(14)));
    if (bytes[1] === 1) data = await pipe(data, new DecompressionStream("gzip"));
    else if (bytes[1] !== 0) throw new Error("bad data");
    return JSON.parse(dec.decode(data));
  }
  // The link in the QR code: the code is in the #fragment, which browsers never send to a server
  const joinLink = (origin, code) => origin.replace(/\/$/, "") + "/app/#join=" + code;
  function parseJoin(text) {
    const s = String(text || "").trim(), m = s.match(/[#&?]join=([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/);
    if (m) return m[1];
    return CODE_RE.test(s) ? s : null;
  }

  return { SCHEMA, ENV_V, OBS_V, BACKUP_V, SETTINGS, KNOWN, stable, migrateObs, snapObs, stampObs, snapSettings, stampSettings,
    fromLocal, merge, settingsDiffer, apply, same, makeBackup, readBackup, newCode, keys, seal, open, joinLink, parseJoin, b64u };
})();
if (typeof module !== "undefined") module.exports = ZSync;
