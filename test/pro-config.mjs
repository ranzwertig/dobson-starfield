// Unit tests for worker/pro.js (GET /api/pro/config). Run with `npm run test:pro`.
import assert from 'node:assert/strict';
import { proConfig } from '../worker/pro.js';

const SANDBOX = { PADDLE_ENV: 'sandbox', PADDLE_CLIENT_TOKEN: 'test_abc', PADDLE_PRICE_ID: 'pri_123' };
const req = (cf, headers = {}) => ({ cf, headers: new Headers(headers) });
const call = async (r, env) => { const res = proConfig(r, env); return [res.status, await res.json(), res.headers.get('Cache-Control')]; };
const results = [];
const t = async (name, fn) => { try { await fn(); results.push(true); } catch (e) { results.push(false); console.log('  ✗ ' + name + '\n    ' + String(e.message).split('\n')[0]); } };

await t('sandbox values and the country from Cloudflare', async () => {
  const [s, j, cc] = await call(req({ country: 'DE' }), SANDBOX);
  assert.equal(s, 200); assert.deepEqual(j, { environment: 'sandbox', clientToken: 'test_abc', priceId: 'pri_123', country: 'DE' }); assert.equal(cc, 'no-store');
});
await t('the CF-IPCountry header when request.cf has no country', async () => {
  assert.equal((await call(req(undefined, { 'CF-IPCountry': 'gb' }), SANDBOX))[1].country, 'GB');
});
await t('unknown (XX), Tor (T1) or missing country: no country at all', async () => {
  for (const r of [req({ country: 'XX' }), req({ country: 'T1' }), req(undefined), req({ country: 'OTHERS' })]) {
    const [s, j] = await call(r, SANDBOX); assert.equal(s, 200); assert.equal('country' in j, false);
  }
});
await t('no PADDLE_ENV: an error, no fallback', async () => {
  const [s, j] = await call(req({ country: 'DE' }), { ...SANDBOX, PADDLE_ENV: undefined });
  assert.equal(s, 503); assert.match(j.error, /PADDLE_ENV/); assert.equal(j.clientToken, undefined);
});
await t('an unknown environment or a token for the other environment: an error', async () => {
  assert.equal((await call(req(), { ...SANDBOX, PADDLE_ENV: 'live' }))[0], 503);
  assert.equal((await call(req(), { ...SANDBOX, PADDLE_ENV: 'production' }))[0], 503);
  assert.equal((await call(req(), { ...SANDBOX, PADDLE_CLIENT_TOKEN: 'live_abc' }))[0], 503);
  assert.equal((await call(req(), { ...SANDBOX, PADDLE_PRICE_ID: '' }))[0], 503);
});
await t('production with a live token', async () => {
  const [s, j] = await call(req({ country: 'US' }), { PADDLE_ENV: 'production', PADDLE_CLIENT_TOKEN: 'live_x', PADDLE_PRICE_ID: 'pri_9' });
  assert.equal(s, 200); assert.equal(j.environment, 'production');
});
await t('never returns other variables such as an API key', async () => {
  const [, j] = await call(req({ country: 'DE' }), { ...SANDBOX, PADDLE_API_KEY: 'pdl_sdbx_apikey_secret' });
  assert.equal(JSON.stringify(j).includes('apikey'), false);
});

const failed = results.filter(x => !x).length;
console.log(failed ? `${failed} of ${results.length} failed` : `All ${results.length} passed`);
process.exit(failed ? 1 : 0);
