/* Service Worker — 静的シェルのみキャッシュ。API呼び出しは常にネットワーク。 */
const CACHE = 'noialert-v2';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './config.js',
  './icon.svg',
  './manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
    )),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // GET 以外、および /api/ はキャッシュせずネットワークへ
  if (req.method !== 'GET' || req.url.includes('/api/')) return;
  // 同一オリジンの静的アセットのみ cache-first
  if (new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html'))),
  );
});
