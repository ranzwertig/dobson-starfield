// Zenigo Worker: serves the static site (dist/) and a small API.
//   /api/tle      current orbital elements (TLE) of the space stations and about 150 bright satellites, from CelesTrak.
//   /api/sync/v1  sync between devices: stores end-to-end encrypted copies (worker/sync.js).
//   /api/pro/config  what the Zenigo Pro page needs for Paddle: environment, client token, price, country (worker/pro.js).
// The app only contacts its own server; the Worker fetches CelesTrak at most twice a day for everyone
// and keeps the last good copy for when CelesTrak can't be reached.
import { handleSync } from './sync.js';
import { proConfig } from './pro.js';

const GROUPS = ['stations', 'visual'];
const FRESH = 12 * 3600e3;           // fetch new data twice a day
const KEEP = 4 * 86400;              // keep the last copy 4 days (stale fallback)
const CACHE_KEY = 'https://zenigo.internal/api/tle-v1';

async function fetchCelestrak() {
  const seen = new Set(), sats = [];
  for (const g of GROUPS) {
    const r = await fetch(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${g}&FORMAT=tle`, { headers: { 'User-Agent': 'Zenigo (https://zenigo.app)' } });
    if (!r.ok) throw new Error('CelesTrak ' + g + ': ' + r.status);
    const lines = (await r.text()).split(/\r?\n/).map(l => l.trimEnd()).filter(Boolean);
    for (let i = 0; i + 2 < lines.length; i += 3) {
      const [name, l1, l2] = [lines[i], lines[i + 1], lines[i + 2]];
      if (!l1 || !l2 || !l1.startsWith('1 ') || !l2.startsWith('2 ')) continue;
      const id = l1.slice(2, 7).trim();
      if (seen.has(id)) continue;
      seen.add(id); sats.push({ name: name.trim(), l1, l2 });
    }
  }
  if (!sats.length) throw new Error('CelesTrak: no data');
  return sats;
}

async function tle(ctx) {
  const cache = caches.default, key = new Request(CACHE_KEY);
  const hit = await cache.match(key);
  let old = null;
  if (hit) { old = await hit.json(); if (Date.now() - old.fetched < FRESH) return old; }
  try {
    const data = { fetched: Date.now(), source: 'CelesTrak', sats: await fetchCelestrak() };
    ctx.waitUntil(cache.put(key, new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${KEEP}` } })));
    return data;
  } catch (e) {
    if (old) return old;
    throw e;
  }
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === '/api/tle') {
      try {
        const data = await tle(ctx);
        return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 502, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
      }
    }
    if (url.pathname === '/api/sync/v1' || url.pathname.startsWith('/api/sync/v1/')) {
      try { return await handleSync(req, env, url); }
      catch (e) { return new Response(JSON.stringify({ error: 'server error' }), { status: 500, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }); }
    }
    if (url.pathname === '/api/pro/config' && req.method === 'GET') return proConfig(req, env);
    return env.ASSETS.fetch(req);
  },
};
