// Service worker Jurnal Guru (PWA offline).
// - Cangkang aplikasi (HTML, JS, ikon, manifest) disimpan di cache dan dibuka walau offline.
// - Font Google dan pustaka CDN (PDF, Excel, Word) disimpan saat pertama dipakai.
// - Permintaan ke Google Apps Script (data jurnal) TIDAK pernah disimpan atau dicegat.
const V = 'jurnal-guru-v7';
const CANGKANG = ['./', 'index.html', 'manifest.json', './icon-192.png', './icon-512.png', './apple-touch-icon.png', 'laporan-baru.js', 'offline.js', './favicon-64.png', './icon-maskable-512.png'];
const HOST_LUAR = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com'];
const BATAS = 5000; // ms: jaringan lambat lebih dari ini, pakai salinan cache
const INDEX = new URL('index.html', self.registration.scope).href;
const AKAR = new URL('./', self.registration.scope).href;

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(V)
      .then(c => Promise.all(CANGKANG.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== V).map(x => caches.delete(x)))).then(() => self.clients.claim()));
});

const simpan = (r, res) => caches.open(V).then(c => c.put(r, res)).catch(() => {});
const cari = (r, nav) => caches.match(r, { ignoreSearch: true })
  .then(m => m || (nav ? caches.match(INDEX).then(x => x || caches.match(AKAR)) : undefined));
const mati = () => new Response('Anda sedang offline dan halaman ini belum tersimpan di perangkat.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

function jaringanDulu(r, nav) {
  return new Promise(ok => {
    let selesai = false;
    const beri = x => { if (!selesai) { selesai = true; ok(x); } };
    const t = setTimeout(() => cari(r, nav).then(m => { if (m) beri(m); }), BATAS);
    fetch(r).then(res => {
      clearTimeout(t);
      if (res.ok) {
        simpan(r, res.clone());
        if (nav) { simpan(INDEX, res.clone()); }
      }
      beri(res);
    }).catch(() => {
      clearTimeout(t);
      cari(r, nav).then(m => beri(m || mati()));
    });
  });
}
function cacheDulu(r) {
  return caches.match(r).then(m => {
    const net = fetch(r).then(res => { if (res.ok || res.type === 'opaque') simpan(r, res.clone()); return res; });
    if (m) { net.catch(() => {}); return m; }
    return net.catch(() => mati());
  });
}

self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET') return;
  if (u.origin === location.origin) return e.respondWith(jaringanDulu(r, r.mode === 'navigate'));
  if (HOST_LUAR.indexOf(u.hostname) >= 0) return e.respondWith(cacheDulu(r));
});
