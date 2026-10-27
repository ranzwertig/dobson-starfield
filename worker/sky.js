// Night sky this week (scripts/sky.mjs): /sky/ and /de/sky/ always show the week of the day, without a new build.
// The build writes each published week's copy for those addresses to /sky-now/<lang>/<friday> (canonical /sky/, its
// language versions); this serves the copy of the Friday on or before today (UTC), or of the latest week before it.
// /sky-now/ itself is not public (and disallowed in robots.txt).
const PATHS = { '/sky/': 'en', '/sky': 'en', '/de/sky/': 'de', '/de/sky': 'de' };
const fridayOf = d => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 2) % 7)); return x; };

export function isSky(path) { return path in PATHS || path.startsWith('/sky-now/'); }

export async function handleSky(req, env, url, now = new Date()) {
  if (url.pathname.startsWith('/sky-now/')) return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
  const lang = PATHS[url.pathname];
  if (!url.pathname.endsWith('/')) return Response.redirect(url.origin + url.pathname + '/' + url.search, 301);
  // this week, or the latest of the 8 weeks before (a week that wasn't published yet)
  for (let i = 0, d = fridayOf(now); i < 9; i++, d = new Date(d.getTime() - 7 * 864e5)) {
    const r = await env.ASSETS.fetch(new Request(url.origin + '/sky-now/' + lang + '/' + d.toISOString().slice(0, 10), { method: req.method === 'HEAD' ? 'HEAD' : 'GET', headers: req.headers }));
    if (r.status === 200) {
      const h = new Headers(r.headers); h.set('Cache-Control', 'public, max-age=600');
      return new Response(r.body, { status: 200, headers: h });
    }
  }
  return env.ASSETS.fetch(req);   // the build's copy (the week of the build)
}
