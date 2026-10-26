// Unit tests for Zenigo Pro licences: src/licence.js (keys) and worker/licence.js (Paddle webhook, lookup, sync check),
// with an in-memory SQLite standing in for D1. Run with `npm run test:pro`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { handleWebhook, handleLicence, licenceActive, paddleSignatureOk } from '../worker/licence.js';
import worker from '../worker/index.js';
const require = createRequire(import.meta.url);
const ZLicence = require('../src/licence.js');
const TEST = JSON.parse(readFileSync(new URL('./fixtures/pro-test-key.json', import.meta.url), 'utf8'));

function fakeD1() {
  const db = new DatabaseSync(':memory:');
  return { prepare(sql) { const st = db.prepare(sql); let args = []; return { bind(...a) { args = a; return this; },
    async first() { const r = st.get(...args); return r ? { ...r } : null; }, async run() { const r = st.run(...args); return { meta: { changes: Number(r.changes) } }; } }; } };
}
const SECRET = 'pdl_ntfset_test_secret';
const envOf = (o = {}) => ({ SYNC_DB: fakeD1(), PADDLE_WEBHOOK_SECRET: SECRET, PRO_SIGNING_KEY: JSON.stringify(TEST.priv), PADDLE_ENV: 'sandbox', PADDLE_PRICE_ID: 'pri_pro', ...o });
async function signed(body, { secret = SECRET, ts = Math.floor(Date.now() / 1000) } = {}) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const h = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ts}:${body}`)))].map(b => b.toString(16).padStart(2, '0')).join('');
  return `ts=${ts};h1=${h}`;
}
async function hook(env, ev, opt) {
  const body = typeof ev === 'string' ? ev : JSON.stringify(ev);
  const res = await handleWebhook(new Request('https://zenigo.app/api/pro/webhook', { method: 'POST', body, headers: { 'Paddle-Signature': opt && opt.header !== undefined ? opt.header : await signed(body, opt) } }), env);
  return [res.status, await res.json()];
}
const paid = (txn, o = {}) => ({ event_type: 'transaction.completed', data: { id: txn, status: 'completed', billed_at: '2026-11-01T20:00:00Z', items: [{ price: { id: 'pri_pro' }, quantity: 1 }], ...o } });
const adj = (txn, o) => ({ event_type: 'adjustment.created', data: { id: 'adj_1', transaction_id: txn, ...o } });
async function lookup(env, txn) { const res = await handleLicence(new Request('https://zenigo.app/api/pro/licence?txn=' + txn), env, new URL('https://zenigo.app/api/pro/licence?txn=' + txn)); return [res.status, await res.json()]; }

const results = [];
const t = async (name, fn) => { try { await fn(); results.push(true); } catch (e) { results.push(false); console.log('  ✗ ' + name + '\n    ' + String(e.stack || e).split('\n').slice(0, 3).join('\n    ')); } };

await t('keys: sign, verify with the public key, reject changes and other keys', async () => {
  const k = await ZLicence.sign({ v: 1, id: 'abc', o: 'txn_1', p: '2026-11-01', s: '2026-11-01T00:00:00.000Z', e: '2027-11-01T00:00:00.000Z' }, TEST.priv);
  assert.match(k, /^ZP1\.[\w-]+\.[\w-]+$/);
  const p = await ZLicence.verify(k, [TEST.pub]); assert.equal(p.id, 'abc'); assert.equal(p.key, k);
  assert.equal((await ZLicence.verify(' ' + k.slice(0, 20) + '\n' + k.slice(20) + ' ', [TEST.pub])).id, 'abc', 'spaces and line breaks from an email');
  const [h, b, s] = k.split('.'), forged = h + '.' + ZLicence.b64u.enc(new TextEncoder().encode(JSON.stringify({ v: 1, id: 'abc', o: 'txn_1', p: '2026-11-01', s: '2026-11-01T00:00:00.000Z', e: '2099-01-01T00:00:00.000Z' }))) + '.' + s;
  assert.equal(await ZLicence.verify(forged, [TEST.pub]), null, 'a longer end date breaks the signature');
  assert.equal(await ZLicence.verify(k), null, 'the production key does not accept a test signature');
  assert.equal(await ZLicence.verify('nonsense', [TEST.pub]), null);
});
await t('keys: state and 12 months', () => {
  assert.equal(ZLicence.endOf('2026-11-01T20:00:00.000Z'), '2027-11-01T20:00:00.000Z');
  const p = { s: '2026-11-01T00:00:00Z', e: '2027-11-01T00:00:00Z' };
  assert.equal(ZLicence.state(p, Date.parse('2027-06-01')).active, true);
  assert.equal(ZLicence.state(p, Date.parse('2027-11-02')).active, false);
  assert.equal(ZLicence.state(p, Date.parse('2027-10-02T00:00:00Z')).daysLeft, 30);
  assert.equal(ZLicence.state(p, Date.parse('2026-10-01')).active, false, 'a renewal that starts later is not active yet');
});
await t('Paddle signature: right secret, wrong secret, old timestamp, several h1', async () => {
  const body = '{"a":1}', now = Date.now();
  assert.equal(await paddleSignatureOk(body, await signed(body), SECRET), true);
  assert.equal(await paddleSignatureOk(body, await signed(body, { secret: 'other' }), SECRET), false);
  assert.equal(await paddleSignatureOk(body + ' ', await signed(body), SECRET), false, 'the raw body, byte for byte');
  assert.equal(await paddleSignatureOk(body, await signed(body, { ts: Math.floor(now / 1000) - 3600 }), SECRET), false);
  const good = await signed(body);
  assert.equal(await paddleSignatureOk(body, good.replace('h1=', 'h1=00;h1='), SECRET), true);
  assert.equal(await paddleSignatureOk(body, '', SECRET), false);
});
await t('webhook: not set up → 503, bad signature → 401 (Paddle retries), no licence made', async () => {
  assert.equal((await hook(envOf({ PADDLE_WEBHOOK_SECRET: undefined }), paid('txn_01aaaaaaaaaa')))[0], 503);
  const env = envOf();
  assert.equal((await hook(env, paid('txn_01aaaaaaaaaa'), { secret: 'wrong' }))[0], 401);
  assert.equal((await hook(env, paid('txn_01aaaaaaaaaa'), { header: '' }))[0], 401);
  assert.equal((await lookup(env, 'txn_01aaaaaaaaaa'))[0], 404);
});
await t('purchase → a sandbox key for 12 months; delivered twice → the same key; other products ignored', async () => {
  const env = envOf();
  assert.deepEqual(await hook(env, paid('txn_01bbbbbbbbbb')), [200, { result: 'created' }]);
  const [s, j] = await lookup(env, 'txn_01bbbbbbbbbb'); assert.equal(s, 200);
  const p = await ZLicence.verify(j.licence, [TEST.pub]);
  assert.equal(p.o, 'txn_01bbbbbbbbbb'); assert.equal(p.s, '2026-11-01T20:00:00.000Z'); assert.equal(p.e, '2027-11-01T20:00:00.000Z'); assert.equal(p.sb, 1); assert.equal(p.p, '2026-11-01');
  assert.deepEqual(await hook(env, paid('txn_01bbbbbbbbbb')), [200, { result: 'exists' }]);
  assert.equal((await lookup(env, 'txn_01bbbbbbbbbb'))[1].licence, j.licence);
  assert.deepEqual(await hook(env, paid('txn_01cccccccccc', { items: [{ price: { id: 'pri_other' } }] })), [200, { result: 'other product' }]);
  assert.deepEqual(await hook(env, { event_type: 'subscription.created', data: {} }), [200, { result: 'ignored' }]);
  const live = envOf({ PADDLE_ENV: 'production' }); await hook(live, paid('txn_01dddddddddd'));
  assert.equal((await ZLicence.verify((await lookup(live, 'txn_01dddddddddd'))[1].licence, [TEST.pub])).sb, undefined, 'production keys carry no sandbox mark');
  assert.equal((await lookup(env, 'bad'))[0], 400);
});
await t('renewal before the end: the new year starts when the current one ends; after the end: at the purchase', async () => {
  const env = envOf();
  await hook(env, paid('txn_01eeeeeeeeee'));
  const first = await ZLicence.verify((await lookup(env, 'txn_01eeeeeeeeee'))[1].licence, [TEST.pub]);
  await hook(env, paid('txn_01ffffffffff', { billed_at: '2027-10-15T10:00:00Z', custom_data: { renew: first.id } }));
  const second = await ZLicence.verify((await lookup(env, 'txn_01ffffffffff'))[1].licence, [TEST.pub]);
  assert.equal(second.s, first.e); assert.equal(second.e, '2028-11-01T20:00:00.000Z');
  await hook(env, paid('txn_01gggggggggg', { billed_at: '2029-01-10T10:00:00Z', custom_data: { renew: second.id } }));
  assert.equal((await ZLicence.verify((await lookup(env, 'txn_01gggggggggg'))[1].licence, [TEST.pub])).s, '2029-01-10T10:00:00.000Z');
  await hook(env, paid('txn_01hhhhhhhhhh', { custom_data: { renew: 'unknown' } }));
  assert.equal((await ZLicence.verify((await lookup(env, 'txn_01hhhhhhhhhh'))[1].licence, [TEST.pub])).s, '2026-11-01T20:00:00.000Z', 'an unknown key id changes nothing');
});
await t('refunds and chargebacks', async () => {
  const env = envOf();
  await hook(env, paid('txn_01iiiiiiiiii'));
  assert.deepEqual(await hook(env, adj('txn_01iiiiiiiiii', { action: 'refund', status: 'pending_approval', type: 'full' })), [200, { result: 'ignored' }]);
  assert.deepEqual(await hook(env, adj('txn_01iiiiiiiiii', { action: 'refund', status: 'approved', type: 'partial' })), [200, { result: 'ignored' }], 'partial refunds keep the licence');
  assert.equal((await lookup(env, 'txn_01iiiiiiiiii'))[0], 200);
  assert.deepEqual(await hook(env, { ...adj('txn_01iiiiiiiiii', { action: 'refund', status: 'approved', type: 'full' }), event_type: 'adjustment.updated' }), [200, { result: 'refunded' }]);
  assert.deepEqual(await lookup(env, 'txn_01iiiiiiiiii'), [410, { status: 'refunded' }]);
  await hook(env, paid('txn_01jjjjjjjjjj'));
  await hook(env, adj('txn_01jjjjjjjjjj', { action: 'chargeback', status: 'approved', type: 'full' }));
  assert.equal((await lookup(env, 'txn_01jjjjjjjjjj'))[0], 410);
  await hook(env, adj('txn_01jjjjjjjjjj', { action: 'chargeback_reverse', status: 'approved', type: 'full' }));
  assert.equal((await lookup(env, 'txn_01jjjjjjjjjj'))[0], 200);
  assert.deepEqual(await hook(env, adj('txn_01kkkkkkkkkk', { action: 'refund', status: 'approved', type: 'full' })), [409, { result: 'retry' }], 'a refund before its purchase: Paddle retries it later');
});
await t('sync check: running, refunded, ended, sandbox key on a live server, forged', async () => {
  const env = envOf();
  await hook(env, paid('txn_01llllllllll', { billed_at: new Date().toISOString() }));
  const key = (await lookup(env, 'txn_01llllllllll'))[1].licence;
  assert.equal(await licenceActive(env, key), true);
  assert.equal(await licenceActive(env, key, Date.now() + 400 * 86400e3), false);
  assert.equal(await licenceActive({ ...env, PADDLE_ENV: 'production' }, key), false);
  assert.equal(await licenceActive(env, key.slice(0, -4) + 'AAAA'), false);
  await hook(env, adj('txn_01llllllllll', { action: 'refund', status: 'approved', type: 'full' }));
  assert.equal(await licenceActive(env, key), false);
});
await t('the Worker: sync needs Pro when SYNC_NEEDS_PRO is set, deleting never does', async () => {
  const env = { ...envOf(), SYNC_NEEDS_PRO: 'true', ASSETS: { fetch: () => new Response('asset') } };
  await hook(env, paid('txn_01mmmmmmmmmm', { billed_at: new Date().toISOString() }));
  const key = (await lookup(env, 'txn_01mmmmmmmmmm'))[1].licence;
  const id = 'A'.repeat(22), auth = { Authorization: 'Bearer ' + 'b'.repeat(43) };
  const call = (method, h = {}) => worker.fetch(new Request('https://zenigo.app/api/sync/v1/' + id, { method, headers: { ...auth, ...h } }), env, {});
  assert.equal((await call('GET')).status, 402);
  assert.equal((await call('GET', { 'X-Zenigo-Licence': 'ZP1.x.y' })).status, 402);
  assert.equal((await call('GET', { 'X-Zenigo-Licence': key })).status, 404, 'with a running licence: on to sync (no group yet)');
  assert.notEqual((await call('DELETE')).status, 402);
  assert.equal((await worker.fetch(new Request('https://zenigo.app/api/sync/v1'), env, {})).status, 200, 'the status check stays open');
  const off = { ...env, SYNC_NEEDS_PRO: undefined };
  assert.equal((await worker.fetch(new Request('https://zenigo.app/api/sync/v1/' + id, { headers: auth }), off, {})).status, 404);
});

const failed = results.filter(x => !x).length;
console.log(failed ? `${failed} of ${results.length} failed` : `All ${results.length} passed`);
process.exit(failed ? 1 : 0);
