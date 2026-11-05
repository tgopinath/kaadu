// App shell works offline; iNaturalist photos are cached as they are seen.
const SHELL = 'kd-shell-v5', IMG = 'kd-img-v1';
const FILES = ['./', 'index.html', 'kolam/tokens.css', 'kolam/kolam.css', 'styles.css', 'app.js', 'data.js', 'data-ta.js', 'ids.js', 'i18n.js', 'manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => e.waitUntil(caches.keys()
  .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== IMG).map(k => caches.delete(k))))
  .then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if (u.origin === location.origin || /fonts\.(googleapis|gstatic)\.com/.test(u.host)) {
    e.respondWith(fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(SHELL).then(s => s.put(e.request, c)); } return r; }).catch(() => caches.match(e.request)));
  } else if (/inaturalist-open-data|static\.inaturalist/.test(u.host)) {
    e.respondWith(caches.open(IMG).then(async c => (await c.match(e.request)) || fetch(e.request).then(r => { if (r.ok || r.type === 'opaque') c.put(e.request, r.clone()); return r; })));
  }
});
