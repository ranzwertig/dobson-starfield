// Retired root service worker. Until October 2026 the app lived at "/" with its service worker at
// "/sw.js". The app now lives at "/app/" and "/" is the website. Browsers that still run the old
// worker fetch this file as its update: it clears the old caches, unregisters itself and reloads
// the open pages, which then come straight from the network.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('message', e => { if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (!k.startsWith('zenigo-app-')) await caches.delete(k);
  await self.registration.unregister();
  for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url);
})()));
