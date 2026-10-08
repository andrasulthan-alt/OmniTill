// Service worker: keeps the app shell available offline. Database calls are never cached here
// (the app has its own offline queue); only same-origin static files are.
const VER = 'ot-v1';
const SHELL = ['./', 'index.html', 'css/app.css', 'manifest.webmanifest', 'vendor/supabase.js', 'icons/icon.svg',
  'js/app.js', 'js/api.js', 'js/calc.js', 'js/config.js', 'js/icons.js', 'js/lock.js', 'js/receipt.js', 'js/state.js', 'js/store.js', 'js/sync.js', 'js/util.js',
  'js/views/sell.js', 'js/views/hotel.js', 'js/views/stock.js', 'js/views/menu.js', 'js/views/reports.js', 'js/views/history.js', 'js/views/staff.js', 'js/views/settings.js',
  'vendor/fonts/doto-latin-400-normal.woff2', 'vendor/fonts/doto-latin-700-normal.woff2', 'vendor/fonts/doto-latin-900-normal.woff2',
  'vendor/fonts/space-mono-latin-400-normal.woff2', 'vendor/fonts/space-mono-latin-700-normal.woff2',
  'vendor/fonts/inter-latin-400-normal.woff2', 'vendor/fonts/inter-latin-500-normal.woff2', 'vendor/fonts/inter-latin-600-normal.woff2'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(VER).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VER).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // network first (so updates arrive), cache as the offline fallback
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(VER).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
