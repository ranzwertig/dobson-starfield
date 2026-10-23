// Tests the sync API of a running Worker. Locally: a wrangler config with a D1 binding SYNC_DB, `wrangler dev --local`,
// then SYNC_URL=http://localhost:8787 node test/sync-api.cjs. Against the live site: SYNC_URL=https://zenigo.app (it creates
// a throwaway group and deletes it again).
const Z = require('../src/sync.js'), B = (process.env.SYNC_URL || 'http://localhost:8787').replace(/\/$/, '') + '/api/sync/v1/';
const assert = require('node:assert/strict');
(async () => {
  const k = await Z.keys(Z.newCode()), h = (v, x = {}) => ({ Authorization: 'Bearer ' + k.token, ...(v != null ? { 'If-Match': String(v) } : {}), ...x });
  let r = await fetch(B + k.id, { headers: h() }); assert.equal(r.status, 404);
  const p = Z.fromLocal(Z.migrateObs({}), { lat: 1, lon: 2 }), box = await Z.seal(k, p);
  r = await fetch(B + k.id, { method: 'PUT', headers: h(0), body: box }); assert.equal(r.status, 200); assert.deepEqual(await r.json(), { version: 1 });
  r = await fetch(B + k.id, { method: 'PUT', headers: h(0), body: box }); assert.equal(r.status, 409); assert.deepEqual(await r.json(), { version: 1 });
  r = await fetch(B + k.id, { headers: h() }); assert.equal(r.status, 200); assert.equal(r.headers.get('x-sync-version'), '1');
  assert.deepEqual(await Z.open(k, await r.arrayBuffer()), p);
  r = await fetch(B + k.id, { method: 'PUT', headers: h(1), body: box }); assert.deepEqual(await r.json(), { version: 2 });
  r = await fetch(B + k.id, { method: 'PUT', headers: h(1), body: box }); assert.equal(r.status, 409);
  const wrong = { Authorization: 'Bearer ' + (await Z.keys(Z.newCode())).token };
  r = await fetch(B + k.id, { headers: wrong }); assert.equal(r.status, 401);
  r = await fetch(B + k.id, { method: 'PUT', headers: { ...wrong, 'If-Match': '2' }, body: box }); assert.equal(r.status, 401);
  r = await fetch(B + k.id, { method: 'DELETE', headers: wrong }); assert.equal(r.status, 401);
  r = await fetch(B + k.id, { method: 'PUT', headers: h(2), body: new Uint8Array(1024 * 1024 + 1) }); assert.equal(r.status, 413);
  r = await fetch(B + k.id, { method: 'PUT', headers: h(null), body: box }); assert.equal(r.status, 428);
  r = await fetch(B + 'bad', { headers: h() }); assert.equal(r.status, 404);
  r = await fetch(B + k.id, { headers: {} }); assert.equal(r.status, 401);
  r = await fetch(B + k.id, { method: 'DELETE', headers: h() }); assert.equal(r.status, 204);
  r = await fetch(B + k.id, { headers: h() }); assert.equal(r.status, 404);
  console.log('worker API ok');
})().catch(e => { console.error(e); process.exit(1); });
