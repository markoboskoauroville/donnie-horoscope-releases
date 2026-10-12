// Offline use: the app's files are kept in the browser's cache. Online, the newest files are
// fetched first (so updates show at once); offline, the cached copies are used.
const CACHE = 'donnie-web-23';
const FILES = ['./', 'index.html', 'app.js', 'map.js', 'zip.js', 'donnie.js', 'manifest.webmanifest',
  'fonts/NotoSansSymbols.ttf', 'atlas/cities.tsv', 'atlas/countries.bin', 'img/donnie.jpg', 'img/icon-192.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
