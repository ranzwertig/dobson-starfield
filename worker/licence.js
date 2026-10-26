// Zenigo Pro licence keys: made from Paddle's webhook, handed to the buyer's browser on the welcome page.
//
//   POST /api/pro/webhook        Paddle notifications. Checked with PADDLE_WEBHOOK_SECRET (Paddle-Signature header,
//                                HMAC-SHA256 over "<ts>:<raw body>") before anything else; 401 when it doesn't match, so
//                                Paddle retries. Handled, all idempotent (deliveries come at least once, in any order):
//                                  transaction.completed   a paid Zenigo Pro price → a signed key for 12 months
//                                  adjustment.created/.updated   approved full refund or chargeback → key revoked;
//                                                          chargeback reversed → active again
//                                Anything else (other prices, other events) is answered 200 and ignored.
//   GET  /api/pro/licence?txn=…  the key for a transaction: 200 { licence, ends, status } | 404 { status: 'pending' }
//                                (the welcome page asks again until the webhook has arrived)
//
// Secrets (npx wrangler secret put …, or the dashboard → Settings → Variables and Secrets, type Secret):
//   PADDLE_WEBHOOK_SECRET  the signing secret of the notification destination in Paddle (pdl_ntfset_…), not the API key
//   PRO_SIGNING_KEY        the private key that signs licences (JWK JSON with "d"); the app has the public key
//                          (src/licence.js). Never in the repository.
// Renewal: the Pro page sends the buyer's current key id as custom data { renew: <id> }; the new 12 months then start
// when that licence ends (if it is still running), otherwise at the purchase.
// Stored per licence (table licences in SYNC_DB, created on first use): transaction, key id, the key, purchase, start
// and end, which licence it renews, sandbox or not, status. No name, no email address.
import ZLicence from '../src/licence.js';

const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const SCHEMA = `CREATE TABLE IF NOT EXISTS licences (
  txn TEXT PRIMARY KEY,
  key_id TEXT NOT NULL UNIQUE,
  licence TEXT NOT NULL,
  purchased TEXT NOT NULL,
  starts TEXT NOT NULL,
  ends TEXT NOT NULL,
  renews TEXT,
  sandbox INTEGER NOT NULL,
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;
const TOLERANCE = 15 * 60;   // seconds between Paddle signing a delivery and us receiving it
const ready = new WeakMap();   // per database binding: the table is created once
const table = db => { if (!ready.has(db)) ready.set(db, db.prepare(SCHEMA).run().catch(e => { ready.delete(db); throw e; })); return ready.get(db); };

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
function sameHex(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

// Paddle-Signature: "ts=1671552777;h1=eb4d…" (several h1 while a secret is being rotated)
export async function paddleSignatureOk(raw, header, secret, now = Date.now()) {
  if (!header || !secret) return false;
  const parts = {}; const h1 = [];
  for (const kv of header.split(';')) { const [k, v] = kv.split('='); if (k === 'h1') h1.push((v || '').trim()); else if (k) parts[k.trim()] = (v || '').trim(); }
  const ts = Number(parts.ts);
  if (!Number.isFinite(ts) || !h1.length || Math.abs(now / 1000 - ts) > TOLERANCE) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${parts.ts}:${raw}`)));
  return h1.some(h => sameHex(h, mac));
}

const newId = () => ZLicence.b64u.enc(crypto.getRandomValues(new Uint8Array(9)));   // 12 characters

async function completed(env, t) {
  const db = env.SYNC_DB, txn = t.id;
  if (!/^txn_[a-z0-9]+$/i.test(txn || '')) return 'ignored';
  if (!(t.items || []).some(i => (i.price && i.price.id) === env.PADDLE_PRICE_ID)) return 'other product';
  await table(db);
  if (await db.prepare('SELECT 1 FROM licences WHERE txn = ?').bind(txn).first()) return 'exists';
  const purchased = new Date(t.billed_at || t.updated_at || t.created_at || Date.now()).toISOString();
  const sandbox = env.PADDLE_ENV === 'sandbox';
  // renewal: the new year starts where the running licence ends
  let starts = purchased, renews = null;
  const want = t.custom_data && typeof t.custom_data.renew === 'string' ? t.custom_data.renew : null;
  if (want) {
    const prev = await db.prepare('SELECT key_id, ends, status, sandbox FROM licences WHERE key_id = ?').bind(want).first();
    if (prev && prev.status === 'active' && !!prev.sandbox === sandbox) {
      renews = prev.key_id;
      if (Date.parse(prev.ends) > Date.parse(purchased)) starts = prev.ends;
    }
  }
  const id = newId(), ends = ZLicence.endOf(starts);
  const payload = { v: 1, id, o: txn, p: purchased.slice(0, 10), s: starts, e: ends, ...(sandbox ? { sb: 1 } : {}) };
  const licence = await ZLicence.sign(payload, JSON.parse(env.PRO_SIGNING_KEY));
  // two deliveries at the same moment: the first insert wins, the second changes nothing
  await db.prepare('INSERT OR IGNORE INTO licences (txn, key_id, licence, purchased, starts, ends, renews, sandbox, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(txn, id, licence, purchased, starts, ends, renews, sandbox ? 1 : 0, 'active', new Date().toISOString()).run();
  return 'created';
}

async function adjusted(env, a) {
  const txn = a.transaction_id;
  if (!/^txn_[a-z0-9]+$/i.test(txn || '')) return 'ignored';
  let status = null;
  if (a.action === 'refund' && a.status === 'approved' && a.type !== 'partial') status = 'refunded';
  else if (a.action === 'chargeback') status = 'chargeback';
  else if (a.action === 'chargeback_reverse') status = 'active';
  if (!status) return 'ignored';   // partial refunds (e.g. the rest of a year when Zenigo ends), credits, pending ones
  await table(env.SYNC_DB);
  const r = await env.SYNC_DB.prepare('UPDATE licences SET status = ?, updated_at = ? WHERE txn = ?').bind(status, new Date().toISOString(), txn).run();
  // the refund arrived before the purchase: Paddle sends transaction.completed again until it is accepted, but a
  // licence made then would be active, so tell Paddle to retry this one later
  return r.meta && r.meta.changes === 0 ? 'retry' : status;
}

export async function handleWebhook(req, env) {
  if (req.method !== 'POST') return json(405, { error: 'method' });
  if (!env.PADDLE_WEBHOOK_SECRET || !env.PRO_SIGNING_KEY || !env.SYNC_DB) return json(503, { error: 'licences are not set up on this server' });
  const raw = await req.text();   // the exact bytes Paddle signed: never parse before checking
  if (!(await paddleSignatureOk(raw, req.headers.get('Paddle-Signature'), env.PADDLE_WEBHOOK_SECRET))) return json(401, { error: 'signature' });
  let ev; try { ev = JSON.parse(raw); } catch (e) { return json(400, { error: 'json' }); }
  let result = 'ignored';
  if (ev.event_type === 'transaction.completed') result = await completed(env, ev.data || {});
  else if (ev.event_type === 'adjustment.created' || ev.event_type === 'adjustment.updated') result = await adjusted(env, ev.data || {});
  if (result === 'retry') return json(409, { result });
  return json(200, { result });
}

export async function handleLicence(req, env, url) {
  if (req.method !== 'GET') return json(405, { error: 'method' });
  if (!env.SYNC_DB) return json(503, { error: 'licences are not set up on this server' });
  const txn = url.searchParams.get('txn') || '';
  if (!/^txn_[a-z0-9]{10,40}$/i.test(txn)) return json(400, { error: 'txn' });
  if (env.PRO_LIMIT) {
    const { success } = await env.PRO_LIMIT.limit({ key: req.headers.get('CF-Connecting-IP') || 'local' });
    if (!success) return json(429, { error: 'Too many requests. Try again in a minute.' });
  }
  await table(env.SYNC_DB);
  const r = await env.SYNC_DB.prepare('SELECT licence, starts, ends, status FROM licences WHERE txn = ?').bind(txn).first();
  if (!r) return json(404, { status: 'pending' });
  if (r.status !== 'active') return json(410, { status: r.status });
  return json(200, { status: 'active', licence: r.licence, starts: r.starts, ends: r.ends });
}

// For sync: a key that is genuine, running now, not refunded, and from the same Paddle environment as this server
export async function licenceActive(env, key, now = Date.now()) {
  const p = await ZLicence.verify(key, [JSON.parse(env.PRO_SIGNING_KEY)]);
  if (!p || !!p.sb !== (env.PADDLE_ENV === 'sandbox') || !ZLicence.state(p, now).active) return false;
  await table(env.SYNC_DB);
  const r = await env.SYNC_DB.prepare('SELECT status FROM licences WHERE key_id = ?').bind(p.id).first();
  return !r || r.status === 'active';
}
