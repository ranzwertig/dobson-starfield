// Service worker: makes Zenigo work offline (in the field there is often no signal).
// The page is served from the cache; a new build installs in the background and waits until
// the user taps "Update" in the app. Fonts are cached when first used. VERSION is set by the build.
const VERSION = '__VERSION__';
const PREFIX = 'zenigo-';
const CACHE = PREFIX + VERSION;
const CORE = ['./', 'manifest.webmanifest', 'logo.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  // bypass the HTTP cache so the new version really gets the new files
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE.map(u => new Request(u, { cache: 'reload' })))));
});
self.addEventListener('message', e => { if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => (k.startsWith(PREFIX) || k.startsWith('dobson-pilot-')) && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Page: from the cache of this version (updates arrive via a new service worker), network as fallback
  if (req.mode === 'navigate') {
    e.respondWith(caches.open(CACHE).then(async c => (await c.match('./')) || fetch(req)));
    return;
  }
  // Google Fonts and own static files: cache first, refresh in the background
  if (url.origin === location.origin || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(CACHE).then(async c => {
      const hit = await c.match(req, { ignoreSearch: url.origin === location.origin });
      const net = fetch(req).then(res => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
  }
});
