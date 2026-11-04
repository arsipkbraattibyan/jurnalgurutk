// Service worker Jurnal Guru: cangkang aplikasi disimpan agar bisa dipasang dan terbuka cepat.
// Permintaan ke Google Apps Script (data jurnal) TIDAK pernah disimpan.
const V = 'jurnal-guru-v1';
const CANGKANG = ['./', 'index.html', 'manifest.json', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(CANGKANG)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== V).map(x => caches.delete(x)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return; // API dan font dibiarkan lewat jaringan
  // jaringan dulu (selalu versi terbaru), cadangan dari cache jika offline
  e.respondWith(fetch(r).then(res => {
    if (res.ok) { const c = res.clone(); caches.open(V).then(x => x.put(r, c)); }
    return res;
  }).catch(() => caches.match(r).then(m => m || caches.match('index.html'))));
});
