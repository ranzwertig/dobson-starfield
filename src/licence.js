// Zenigo Pro licence keys, shared by the app (checks them offline) and the Worker (signs them, worker/licence.js).
//
// A key is "ZP1.<payload>.<signature>", both parts base64url. The payload is JSON:
//   { v: 1, id: key id (random), o: Paddle transaction (txn_…), p: purchase date, s: start, e: end (ISO), sb: 1 for sandbox }
// The signature is ECDSA P-256 / SHA-256 (IEEE P1363, 64 bytes) over "ZP1.<payload>", made by the Worker with the private
// key in the secret PRO_SIGNING_KEY. The app knows only the public key below; no server is asked.
// Sandbox keys (sb: 1) come from Paddle's test environment and are refused on zenigo.app itself.
const ZLicence = (() => {
  // public keys that may sign licences (the build adds a test key for the UI tests only)
  const KEYS = [
    { kty: 'EC', crv: 'P-256', x: 'QpRpvLI1_x-vbr1r87X7YjaVUvPi2QT2sdD9RgABO9w', y: 'DILCQl5Wb5CuxkY8AFYhko4NPbJ0xjAgvaabXXS5syM' },
    /*__PRO_TEST_KEY__*/
  ];
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64u = {
    enc(bytes) { let s = ''; for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
    dec(str) { const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4)); return Uint8Array.from(s, c => c.charCodeAt(0)); },
  };
  const ALG = { name: 'ECDSA', namedCurve: 'P-256' }, SIG = { name: 'ECDSA', hash: 'SHA-256' };
  const pub = j => ({ kty: j.kty, crv: j.crv, x: j.x, y: j.y });

  // Reads a key without checking it (also accepts it with spaces or line breaks, as pasted from an email)
  function parse(str) {
    const m = /^ZP1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(str || '').replace(/\s+/g, ''));
    if (!m) return null;
    try {
      const p = JSON.parse(dec.decode(b64u.dec(m[1])));
      if (p.v !== 1 || typeof p.id !== 'string' || !Date.parse(p.s) || !Date.parse(p.e)) return null;
      return { p, key: m[0], body: m[1], sig: m[2] };
    } catch (e) { return null; }
  }
  // The payload if the key is genuine (signed by one of the keys), else null. Says nothing about the dates.
  async function verify(str, keys = KEYS) {
    const k = parse(str);
    if (!k || !globalThis.crypto || !crypto.subtle) return null;
    let sig; try { sig = b64u.dec(k.sig); } catch (e) { return null; }
    for (const jwk of keys) {
      try {
        const key = await crypto.subtle.importKey('jwk', pub(jwk), ALG, false, ['verify']);
        if (await crypto.subtle.verify(SIG, key, sig, enc.encode('ZP1.' + k.body))) return { ...k.p, key: k.key };
      } catch (e) {}
    }
    return null;
  }
  // Signs a payload with a private key (JWK with d): the Worker only
  async function sign(payload, privJwk) {
    const body = b64u.enc(enc.encode(JSON.stringify(payload)));
    const key = await crypto.subtle.importKey('jwk', { kty: privJwk.kty, crv: privJwk.crv, x: privJwk.x, y: privJwk.y, d: privJwk.d }, ALG, false, ['sign']);
    return 'ZP1.' + body + '.' + b64u.enc(await crypto.subtle.sign(SIG, key, enc.encode('ZP1.' + body)));
  }
  // Where a (verified) licence stands at a given time
  function state(p, now = Date.now()) {
    const start = Date.parse(p.s), end = Date.parse(p.e);
    return { active: now >= start - 86400e3 && now < end, ended: now >= end, start, end, daysLeft: Math.max(0, Math.ceil((end - now) / 86400e3)) };
  }
  // The end of a licence that starts at `start`: 12 calendar months later (31 Jan → 31 Jan next year)
  function endOf(start) { const d = new Date(start); d.setUTCFullYear(d.getUTCFullYear() + 1); return d.toISOString(); }
  return { parse, verify, sign, state, endOf, b64u, KEYS };
})();
if (typeof module !== 'undefined') module.exports = ZLicence;
