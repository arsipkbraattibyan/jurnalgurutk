// Service worker Jurnal Guru: cangkang aplikasi disimpan agar bisa dipasang dan terbuka cepat.
// Permintaan ke Google Apps Script (data jurnal) TIDAK pernah disimpan.
const V = 'jurnal-guru-v3';
const CANGKANG = ['./', 'index.html', 'manifest.json', './icon-192.png', './icon-512.png', './apple-touch-icon.png', 'laporan-baru.js', 'offline.js', './favicon-64.png', './icon-maskable-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(V)
      .then(c => Promise.all(CANGKANG.map(u => c.add(u).catch(() => {})))) // satu file gagal tidak membatalkan pemasangan
      .then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== V).map(x => caches.delete(x)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(r).then(res => {
    if (res.ok) { const c = res.clone(); caches.open(V).then(x => x.put(r, c)); }
    return res;
  }).catch(() => caches.match(r, { ignoreSearch: true }).then(m => m || caches.match('index.html'))));
});
