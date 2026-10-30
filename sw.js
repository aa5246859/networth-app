// Retire the old GitHub Pages PWA worker and its app shell after the move.
self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('wealth-tracker-') || key.startsWith('qwjh-')).map(key => caches.delete(key)));
    await self.registration.unregister();
    await self.clients.claim();
  })());
});
