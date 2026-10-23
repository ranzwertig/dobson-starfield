// Sync between devices: the server side. It stores one encrypted copy per sync group and never sees what's inside:
// the app encrypts on the device with a key derived from the sync code, which never reaches the server.
//
//   GET    /api/sync/v1          200 when sync is available here, 503 when not (no database bound)
//   GET    /api/sync/v1/:id      the encrypted copy (application/octet-stream), its version in X-Sync-Version; 404 if none
//   PUT    /api/sync/v1/:id      store a new copy. If-Match: the version it was based on (0 to create the group).
//                                200 {version} | 409 {version} someone wrote in between: fetch, merge, try again
//   DELETE /api/sync/v1/:id      delete the group and its copy
//
// Every call except the status needs "Authorization: Bearer <token>". The server keeps only the SHA-256 of the token.
// Nothing is logged. Groups are never deleted automatically: created_at and updated_at show when a group was last
// written, so old ones can be removed by hand, e.g. in the Cloudflare dashboard (D1 › zenigo-sync › Console):
//   SELECT id, size, created_at, updated_at FROM sync_spaces ORDER BY updated_at;
//   DELETE FROM sync_spaces WHERE updated_at < '2027-01-01';
// The table is created on first use. The database itself is bound in wrangler.jsonc as SYNC_DB (see there).

const MAX = 1024 * 1024;                       // 1 MB per group (encrypted and compressed: thousands of logbook entries)
const ID_RE = /^[A-Za-z0-9_-]{22}$/, TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const SCHEMA = `CREATE TABLE IF NOT EXISTS sync_spaces (
  id TEXT PRIMARY KEY,
  auth_hash TEXT NOT NULL,
  version INTEGER NOT NULL,
  blob BLOB NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;
let ready = null;

const json = (status, data, extra = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra } });
async function sha256(s) { const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join(''); }

export async function handleSync(req, env, url) {
  const db = env.SYNC_DB;
  if (!db) return json(503, { error: 'Sync is not available on this server.' });
  const rest = url.pathname.slice('/api/sync/v1'.length);
  if (rest === '' || rest === '/') return req.method === 'GET' ? json(200, { ok: true, max: MAX }) : json(405, { error: 'method' });
  const id = rest.replace(/^\//, '');
  if (!ID_RE.test(id)) return json(404, { error: 'not found' });
  if (env.SYNC_LIMIT) {
    const { success } = await env.SYNC_LIMIT.limit({ key: req.headers.get('CF-Connecting-IP') || 'local' });
    if (!success) return json(429, { error: 'Too many requests. Try again in a minute.' }, { 'Retry-After': '60' });
  }
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!TOKEN_RE.test(token)) return json(401, { error: 'unauthorized' });
  const auth = await sha256(token);
  if (!ready) ready = db.prepare(SCHEMA).run().catch(e => { ready = null; throw e; });
  await ready;
  const row = () => db.prepare('SELECT version, auth_hash FROM sync_spaces WHERE id = ?').bind(id).first();

  if (req.method === 'GET') {
    const r = await db.prepare('SELECT version, auth_hash, blob FROM sync_spaces WHERE id = ?').bind(id).first();
    if (!r) return json(404, { error: 'not found' });
    if (r.auth_hash !== auth) return json(401, { error: 'unauthorized' });
    return new Response(new Uint8Array(r.blob), { headers: { 'Content-Type': 'application/octet-stream', 'X-Sync-Version': String(r.version), 'Cache-Control': 'no-store' } });
  }
  if (req.method === 'PUT') {
    const im = req.headers.get('If-Match'), base = im == null || im.trim() === '' ? NaN : Number(im);
    if (!Number.isInteger(base) || base < 0) return json(428, { error: 'If-Match with the version is required' });
    if (Number(req.headers.get('Content-Length') || 0) > MAX) return json(413, { error: 'too large', max: MAX });
    const blob = new Uint8Array(await req.arrayBuffer());
    if (blob.length > MAX) return json(413, { error: 'too large', max: MAX });
    if (blob.length < 30) return json(400, { error: 'empty' });
    const now = new Date().toISOString();
    if (base === 0) {
      const r = await db.prepare('INSERT INTO sync_spaces (id, auth_hash, version, blob, size, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING')
        .bind(id, auth, blob, blob.length, now, now).run();
      if (r.meta && r.meta.changes) return json(200, { version: 1 });
    } else {
      const r = await db.prepare('UPDATE sync_spaces SET blob = ?, size = ?, version = version + 1, updated_at = ? WHERE id = ? AND auth_hash = ? AND version = ? RETURNING version')
        .bind(blob, blob.length, now, id, auth, base).first();
      if (r) return json(200, { version: r.version });
    }
    const cur = await row();
    if (!cur) return json(404, { error: 'not found' });
    if (cur.auth_hash !== auth) return json(401, { error: 'unauthorized' });
    return json(409, { version: cur.version });
  }
  if (req.method === 'DELETE') {
    const cur = await row();
    if (!cur) return new Response(null, { status: 204 });
    if (cur.auth_hash !== auth) return json(401, { error: 'unauthorized' });
    await db.prepare('DELETE FROM sync_spaces WHERE id = ? AND auth_hash = ?').bind(id, auth).run();
    return new Response(null, { status: 204 });
  }
  return json(405, { error: 'method' });
}
