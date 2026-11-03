// Service worker Jurnal Guru. Naikkan VERSI setiap kali index.html diperbarui agar HP/komputer mengambil versi baru.
const VERSI = 'jurnal-guru-v1';
const INTI = ['./', './index.html', './manifest.json', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/favicon-64.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSI).then(c => c.addAll(INTI)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSI).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return; // API Apps Script, font, dan pustaka luar tidak disentuh
  if (r.mode === 'navigate') { // halaman: ambil terbaru dulu, jika offline pakai salinan
    e.respondWith(fetch(r).then(res => { const cp = res.clone(); caches.open(VERSI).then(c => c.put('./index.html', cp)); return res; })
      .catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(r).then(c => c || fetch(r).then(res => { const cp = res.clone(); caches.open(VERSI).then(x => x.put(r, cp)); return res; })));
});
