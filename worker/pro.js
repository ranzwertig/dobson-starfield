// Zenigo Pro: what the pricing page (/pro/) needs to show the price and open Paddle Checkout.
//   GET /api/pro/config → { environment, clientToken, priceId, country? }
// All three values are public (a Paddle client-side token is meant for the browser); they come from Worker vars:
//   PADDLE_ENV           "sandbox" or "production". There is no default: without it the page shows "Checkout unavailable",
//                        so the site never runs against the wrong Paddle account by accident.
//   PADDLE_CLIENT_TOKEN  client-side token, test_… for sandbox, live_… for production
//   PADDLE_PRICE_ID      the price of "Zenigo Pro – 12-month licence" (pri_…), different in sandbox and production
// The Paddle API key is never needed here and must never be returned.
// country: the visitor's country as Cloudflare sees it, for localized prices. Unknown (XX), Tor (T1) or missing → left
// out, and Paddle.js works it out from the visitor's IP address itself.
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const PREFIX = { sandbox: 'test_', production: 'live_' };

export function proConfig(req, env) {
  const environment = env.PADDLE_ENV, clientToken = env.PADDLE_CLIENT_TOKEN, priceId = env.PADDLE_PRICE_ID;
  if (!environment) return json({ error: 'PADDLE_ENV is not set' }, 503);
  if (!PREFIX[environment]) return json({ error: 'PADDLE_ENV must be "sandbox" or "production"' }, 503);
  if (!clientToken || !clientToken.startsWith(PREFIX[environment])) return json({ error: `PADDLE_CLIENT_TOKEN is missing or not a ${environment} token` }, 503);
  if (!priceId || !priceId.startsWith('pri_')) return json({ error: 'PADDLE_PRICE_ID is missing' }, 503);
  const c = String((req.cf && req.cf.country) || req.headers.get('CF-IPCountry') || '').toUpperCase();
  const country = /^[A-Z]{2}$/.test(c) && c !== 'XX' && c !== 'T1' ? c : undefined;
  return json(country ? { environment, clientToken, priceId, country } : { environment, clientToken, priceId });
}
