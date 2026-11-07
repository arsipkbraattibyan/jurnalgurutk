/**
 * OFFLINE.JS - Mode Offline dan Auto Sync, Jurnal Guru KB-RA At Tibyan
 *
 * Dipasang SETELAH script utama dan SEBELUM laporan-baru.js di index.html:
 *   <script src="offline.js"></script>
 *   <script src="laporan-baru.js"></script>
 *
 * Cara kerja (tanpa mengubah fitur lama):
 * - Membungkus fungsi api() milik index.html. Aksi baca (list, semua) diberi salinan lokal dan
 *   digabung dengan catatan yang masih mengantre. Aksi tulis (simpan, simpanBanyak, hapus) dan
 *   unggahLampiran dikirim seperti biasa; jika jaringan gagal, disimpan di antrean IndexedDB
 *   lalu dikirim otomatis saat internet kembali.
 * - Setiap catatan baru diberi ID dari perangkat (cid). Server (Code.gs) memakai ID itu, sehingga
 *   pengiriman ulang tidak membuat baris ganda.
 * - Foto yang diambil saat offline disimpan di IndexedDB dengan ID sementara "tmp_...",
 *   diunggah lebih dulu saat sinkron, lalu ID sementara diganti ID Drive.
 * - Aksi lain (login, ganti PIN, foto profil, logo, hapus 1 hari, simpan identitas, simpan data siswa)
 *   tetap butuh internet dan menampilkan pesan yang jelas.
 * - Antrean disimpan per guru. Keluar dari akun tidak menghapus antrean.
 *
 * AUTO SYNC (versi ini):
 * - Data lokal dihapus dari antrean HANYA setelah server membalas ok dan mengonfirmasi ID (simpan)
 *   atau jumlah yang sama dengan yang dikirim (simpanBanyak). Selain itu data tetap di IndexedDB.
 * - simpanBanyak dikirim per 50 catatan; catatan yang sudah dikonfirmasi langsung dibuang dari antrean.
 * - Gangguan jaringan / server sibuk: tetap mengantre, dicoba lagi otomatis (tiap menit, saat online, saat aplikasi dibuka).
 * - Ditolak server (mis. validasi): ditandai GAGAL, tetap tersimpan, dicoba lagi otomatis tiap 30 menit
 *   atau lewat tombol SINKRONKAN SEKARANG.
 * - Tombol SINKRONKAN SEKARANG (mengambang dan di panel) + hitungan berhasil / gagal / menunggu.
 *
 * FOTO OFFLINE (versi ini):
 * - Foto yang dipilih saat offline disimpan di IndexedDB (store "foto") dengan ID sementara "tmp_<16 hex>".
 * - Saat online, foto yang dipakai antrean diunggah LEBIH DULU ke Google Drive (dengan cid = bagian hex ID sementara,
 *   sehingga server tidak membuat berkas ganda bila unggahan diulang). ID Drive dicatat di salinan lokal (rec.real).
 * - Salinan lokal TIDAK dihapus sebelum unggahan berhasil, dan tidak dihapus selama masih dipakai data antrean.
 *   Hanya foto yang SUDAH terunggah, tidak dipakai antrean mana pun, dan berumur > 7 hari yang dibersihkan.
 * - ID Drive foto disimpan di kolom "foto" jurnal (tautan KBC ke Drive ada di kolom "fototautan" KBC_Jurnal).
 * - Status foto (menunggu / sudah di Drive / gagal) tampil di panel sinkronisasi, indikator, dan pesan sinkron.
 */
(function () {
'use strict';
if (typeof api !== 'function' || !window.indexedDB || !window.fetch) return; // peramban lama: aplikasi berjalan seperti sebelumnya

const apiAsli = window.api;
const DB_NAMA = 'jg_offline';
const BUTUH = {
  login: 'Masuk memerlukan internet.', gantiPin: 'Ganti PIN memerlukan internet.',
  hapusHari: 'Hapus 1 hari memerlukan internet.', simpanProfil: 'Menyimpan identitas memerlukan internet.',
  unggahFoto: 'Unggah foto profil memerlukan internet.', unggahLogo: 'Unggah logo memerlukan internet.',
  simpanSiswa: 'Menyimpan data siswa memerlukan internet.'
};

/* ---------- pembantu ---------- */
const gid = () => (S.guru && S.guru.id) ? String(S.guru.id) : '';
const online = () => navigator.onLine !== false;
const acak = n => { const a = new Uint8Array(n); crypto.getRandomValues(a); let s = ''; a.forEach(x => { s += ('0' + x.toString(16)).slice(-2); }); return s.slice(0, n); };
const baruId = () => 'j' + acak(12); // 13 karakter; server menerima 6-20 huruf/angka
const netErr = m => { const e = new Error(m || 'Tidak ada koneksi internet'); e.net = true; return e; };
const el = i => document.getElementById(i);

/* ---------- IndexedDB ---------- */
let _db = null;
function db() {
  return _db || (_db = new Promise((ok, no) => {
    const r = indexedDB.open(DB_NAMA, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('q', { keyPath: 'qid' });    // antrean tulis
      d.createObjectStore('snap', { keyPath: 'k' });   // salinan terakhir dari server: "guruId|jenis"
      d.createObjectStore('foto', { keyPath: 'id' });  // foto yang diambil saat offline
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => { _db = null; no(r.error || new Error('IndexedDB gagal')); };
    r.onblocked = () => { _db = null; no(new Error('IndexedDB terblokir')); };
  }));
}
function tx(store, mode, fn) {
  return db().then(d => new Promise((ok, no) => {
    const t = d.transaction(store, mode);
    let out;
    const rq = fn(t.objectStore(store));
    if (rq) rq.onsuccess = () => { out = rq.result; };
    t.oncomplete = () => ok(out);
    t.onerror = () => no(t.error);
    t.onabort = () => no(t.error || new Error('Transaksi dibatalkan'));
  }));
}
const idbGet = (s, k) => tx(s, 'readonly', o => o.get(k));
const idbPut = (s, v) => tx(s, 'readwrite', o => o.put(v));
const idbDel = (s, k) => tx(s, 'readwrite', o => o.delete(k));
const idbAll = s => tx(s, 'readonly', o => o.getAll());

/* ---------- permintaan ke server (dengan batas waktu, tanpa logout otomatis) ---------- */
async function kirim(action, p, token, ms) {
  const ac = new AbortController(), tm = setTimeout(() => ac.abort(), ms || 30000);
  let txt;
  try {
    const r = await fetch(API_URL, { method: 'POST', body: JSON.stringify(Object.assign({ action: action, token: token }, p || {})), signal: ac.signal });
    txt = await r.text();
  } catch (e) {
    throw netErr(e && e.name === 'AbortError' ? 'Koneksi terlalu lambat' : 'Tidak ada koneksi internet');
  } finally { clearTimeout(tm); }
  try { return JSON.parse(txt); } catch (e) { throw netErr('Respons server tidak terbaca'); }
}
// seperti api() asli: error server dilempar sebagai Error; sesi habis = logout, kecuali noLogout
async function core(action, p, ms, noLogout) {
  const j = await kirim(action, p, S.token, ms);
  if (!j.ok) {
    if (j.auth && !noLogout) keluar();
    const e = new Error(j.error || 'Terjadi kesalahan');
    e.auth = !!j.auth;
    throw e;
  }
  return j;
}

/* ---------- antrean (di memori + IndexedDB) ---------- */
const Q = new Map();
let Qgid = null, ready = Promise.resolve(), perluLogin = false, jalan = false;
function pastikan() {
  const g = gid();
  if (Qgid !== g) {
    Qgid = g; Q.clear(); perluLogin = false;
    ready = g ? idbAll('q').then(a => { if (Qgid === g) a.filter(x => x.gid === g).forEach(x => Q.set(x.qid, x)); }).catch(() => {}) : Promise.resolve();
  }
  return ready;
}
const urutQ = () => [...Q.values()].sort((a, b) => (a.t - b.t) || (a.qid < b.qid ? -1 : 1));
const simpanItem = it => idbPut('q', it);
const buangItem = it => { Q.delete(it.qid); return idbDel('q', it.qid); };
const penuh = () => new Error('Penyimpanan di perangkat penuh atau tidak bisa dipakai. Data belum tersimpan.');
async function tambahItem(o) {
  const it = Object.assign({ qid: Date.now().toString(36) + acak(4), gid: gid(), t: Date.now(), rev: 1, status: 'antri', tries: 0, err: '' }, o);
  Q.set(it.qid, it);
  try { await simpanItem(it); } catch (e) { Q.delete(it.qid); throw penuh(); }
  return it;
}

// catatan yang menunggu: ID -> status
function pend() {
  const m = new Map();
  Q.forEach(it => {
    if (it.type === 'hapus') return;
    (it.type === 'simpanBanyak' ? it.data.map(d => String(d.ID || d.cid)) : [String(it.id)]).forEach(id => m.set(id, it.status));
  });
  return m;
}
const bersih = d => { const o = Object.assign({}, d); delete o.kbc; delete o.pcobs; delete o.cid; return o; };
// gabungkan baris dari server dengan perubahan yang masih mengantre
function gabung(jenis, rows) {
  let out = (rows || []).slice();
  urutQ().forEach(it => {
    if (it.jenis !== jenis) return;
    if (it.type === 'hapus') { out = out.filter(r => String(r.ID) !== String(it.id)); return; }
    const ds = it.type === 'simpanBanyak' ? it.data : [Object.assign({}, it.data, { ID: it.id })];
    ds.forEach(d => {
      const id = String(it.type === 'simpanBanyak' ? (d.ID || d.cid) : it.id), i = out.findIndex(r => String(r.ID) === id);
      const row = Object.assign({}, i >= 0 ? out[i] : {}, bersih(d), { ID: id });
      if (i >= 0) out[i] = row; else out.push(row);
    });
  });
  return out;
}
// KBC / pengamatan Panca Cinta tidak tampil di form catatan yang masih mengantre; jangan sampai terhapus oleh isian kosong
function gabungData(lama, baru) {
  const o = Object.assign({}, lama, baru), k0 = lama.kbc, k1 = baru.kbc;
  if (k0 && k1 && (k0.nilai || []).length && !(k1.nilai || []).length && !k1.tujuan && !k1.aktivitas && !k1.catatan) o.kbc = k0;
  if (Array.isArray(lama.pcobs) && lama.pcobs.length && Array.isArray(baru.pcobs) && !baru.pcobs.length) o.pcobs = lama.pcobs;
  return o;
}

/* ---------- baca: salinan lokal + gabung antrean ---------- */
async function dariSnap(action, p, g) {
  const lokal = (typeof cGet === 'function' && cGet('semua')) || {};
  const ambil = async k => {
    const s = await idbGet('snap', g + '|' + k).catch(() => null);
    if (s && Array.isArray(s.rows)) return s.rows;
    return Array.isArray(lokal[k]) ? lokal[k] : null;
  };
  if (action === 'list') { const r = await ambil(p.jenis); return r ? { ok: true, rows: r, offline: true } : null; }
  const data = {};
  for (const k of KEYS) { const r = await ambil(k); if (!r) return null; data[k] = r; }
  return { ok: true, data: data, offline: true };
}
async function baca(action, p) {
  await pastikan();
  const g = gid();
  let res = null, err = null;
  if (online()) {
    try { res = await core(action, p, 20000); } catch (e) { if (!e.net) throw e; err = e; }
  } else err = netErr();
  if (res) {
    if (action === 'list') idbPut('snap', { k: g + '|' + p.jenis, rows: res.rows, t: Date.now() }).catch(() => {});
    else Object.keys(res.data || {}).forEach(k => idbPut('snap', { k: g + '|' + k, rows: res.data[k], t: Date.now() }).catch(() => {}));
  } else {
    res = await dariSnap(action, p, g);
    if (!res) throw err;
  }
  if (action === 'list') return Object.assign({}, res, { rows: gabung(p.jenis, res.rows) });
  const data = {};
  Object.keys(res.data || {}).forEach(k => { data[k] = gabung(k, res.data[k]); });
  return Object.assign({}, res, { data: data });
}

/* ---------- tulis: kirim langsung, atau antre jika jaringan gagal ---------- */
const pesanAntri = () => setTimeout(() => toast('📴 Tersimpan di perangkat. Akan dikirim otomatis saat internet tersedia.'), 350);
const picuSinkron = () => { statusBaru(); if (online()) setTimeout(sinkron, 800); };

async function tulisSimpan(p) {
  const jenis = p.jenis, d = Object.assign({}, p.data || {}), baru = !d.ID;
  if (baru) d.cid = d.cid || baruId();
  const id = String(d.ID || d.cid), key = jenis + '|' + id;
  const ada = urutQ().find(x => x.type === 'simpan' && x.key === key);
  if (ada) { // catatan ini sudah mengantre: perbarui isinya, jangan buat item baru
    ada.data = gabungData(ada.data, d); ada.rev++; ada.status = 'antri'; ada.tries = 0; ada.err = '';
    try { await simpanItem(ada); } catch (e) { throw penuh(); }
    pesanAntri(); picuSinkron();
    return { ok: true, ID: id, queued: true };
  }
  if (online()) {
    try { return await core('simpan', { jenis: jenis, data: d }, 45000, true); }
    catch (e) { if (!e.net && !e.auth) throw e; if (e.auth) perluLogin = true; }
  }
  await tambahItem({ type: 'simpan', jenis: jenis, key: key, id: id, baru: baru, data: d });
  pesanAntri(); statusBaru();
  return { ok: true, ID: id, queued: true };
}

async function tulisBanyak(p) {
  const jenis = p.jenis, arr = (p.data || []).map(x => x.ID ? x : Object.assign({}, x, { cid: x.cid || baruId() }));
  if (online()) {
    try { return await core('simpanBanyak', { jenis: jenis, data: arr }, 60000, true); }
    catch (e) { if (!e.net && !e.auth) throw e; if (e.auth) perluLogin = true; }
  }
  await tambahItem({ type: 'simpanBanyak', jenis: jenis, key: 'banyak|' + acak(6), data: arr });
  pesanAntri(); statusBaru();
  return { ok: true, n: arr.length, queued: true };
}

async function tulisHapus(p) {
  const jenis = p.jenis, id = String(p.id), key = jenis + '|' + id;
  for (const it of urutQ()) { // batalkan simpan yang masih mengantre untuk catatan ini
    if (it.jenis !== jenis) continue;
    if (it.type === 'simpan' && it.key === key) await buangItem(it).catch(() => {});
    else if (it.type === 'simpanBanyak') {
      const sisa = it.data.filter(d => String(d.ID || d.cid) !== id);
      if (sisa.length !== it.data.length) {
        if (!sisa.length) await buangItem(it).catch(() => {});
        else { it.data = sisa; it.rev++; await simpanItem(it).catch(() => {}); }
      }
    }
  }
  // hapus tetap dikirim: catatan yang pernah terkirim (respons hilang) ikut terhapus. "Tidak ditemukan" dianggap berhasil.
  if (online()) {
    try { return await core('hapus', { jenis: jenis, id: id }, 30000, true); }
    catch (e) {
      if (!e.net && !e.auth && /tidak ditemukan/i.test(e.message)) return { ok: true };
      if (!e.net && !e.auth) throw e;
      if (e.auth) perluLogin = true;
    }
  }
  if (!urutQ().some(x => x.type === 'hapus' && x.key === 'hapus|' + key)) await tambahItem({ type: 'hapus', jenis: jenis, key: 'hapus|' + key, id: id, data: null });
  setTimeout(() => toast('📴 Penghapusan tersimpan di perangkat dan akan dikirim saat internet tersedia.'), 350);
  statusBaru();
  return { ok: true, queued: true };
}

async function tulis(action, p) {
  await pastikan();
  if (!gid()) return apiAsli(action, p);
  if (action === 'hapus') return tulisHapus(p);
  if (action === 'simpanBanyak') return tulisBanyak(p);
  return tulisSimpan(p);
}

/* ---------- foto ---------- */
async function unggah(p) {
  await pastikan();
  const c = acak(16); // cid foto: unggahan yang diulang (respons hilang) tidak membuat berkas ganda di Drive
  if (online()) {
    try { return await core('unggahLampiran', Object.assign({}, p, { cid: c }), 60000, true); }
    catch (e) { if (!e.net && !e.auth) throw e; if (e.auth) perluLogin = true; }
  }
  const id = 'tmp_' + c;
  try { await idbPut('foto', { id: id, cid: c, gid: gid(), b64: p.b64, t: Date.now() }); } catch (e) { throw penuh(); }
  statusBaru();
  return { ok: true, id: id, queued: true };
}
async function fotoBaca(p) {
  const id = String(p.id || '');
  if (id.indexOf('tmp_') === 0) {
    const rec = await idbGet('foto', id).catch(() => null);
    if (!rec) throw new Error('Foto belum tersedia di perangkat ini.');
    return { ok: true, data: 'data:image/jpeg;base64,' + rec.b64 };
  }
  if (!online()) throw netErr();
  return apiAsli('fotoData', p);
}
// unggah satu foto lokal ke Drive; hasilnya (ID Drive) dicatat di salinan lokal, salinan TIDAK dihapus
async function naikFoto(rec) {
  if (rec.real) return rec.real;
  const j = await kirim('unggahLampiran', { b64: rec.b64, cid: rec.cid || String(rec.id).slice(4) }, S.token, 60000);
  if (!j.ok) { const e = new Error(j.error || 'Unggah foto gagal'); e.auth = !!j.auth; throw e; }
  if (!j.id) throw new Error('Server tidak mengonfirmasi foto tersimpan.');
  rec.real = j.id; rec.err = ''; rec.up = Date.now();
  await idbPut('foto', rec).catch(() => {}); // jika gagal dicatat, unggahan ulang aman (cid sama = berkas sama)
  return j.id;
}
let hilang = 0; // foto yang salinan lokalnya tidak ada lagi (hanya jika peramban menghapusnya)
// ganti ID sementara dengan ID Drive (unggah dulu jika belum)
async function petaFoto(str) {
  const out = [];
  for (const id of String(str || '').split(/\s+/).filter(Boolean)) {
    if (id.indexOf('tmp_') !== 0) { out.push(id); continue; }
    const rec = await idbGet('foto', id).catch(() => null);
    if (!rec) { hilang++; continue; } // salinan lokal hilang: catatan tetap dikirim tanpa foto itu, dan guru diberi tahu
    out.push(await naikFoto(rec));
  }
  return out.join(' ');
}
// ID foto sementara yang dipakai satu item antrean
const fotoItem = it => {
  const ds = !it || it.type === 'hapus' ? [] : it.type === 'simpanBanyak' ? it.data : [it.data];
  const o = [];
  ds.forEach(d => String((d && d.foto) || '').split(/\s+/).filter(x => x.indexOf('tmp_') === 0).forEach(x => o.push(x)));
  return o;
};
// langkah awal sinkron: unggah semua foto yang dipakai antrean (hanya melempar galat jaringan / sesi / gangguan server)
async function naikSemuaFoto(R, items) { // hanya foto milik item yang memang akan dikirim sekarang
  const ref = new Set(); items.forEach(it => fotoItem(it).forEach(x => ref.add(x)));
  for (const id of ref) {
    const rec = await idbGet('foto', id).catch(() => null);
    if (!rec || rec.real) continue;
    try { await naikFoto(rec); R.fotoOk++; }
    catch (e) {
      if (e.net || e.auth || TRANSIEN.test(e.message || '')) throw e;
      rec.err = e.message; rec.tries = (rec.tries || 0) + 1; // ditolak server: foto tetap di perangkat
      await idbPut('foto', rec).catch(() => {});
      R.fotoGagal++;
    }
  }
}
// status foto untuk tampilan: FM[id] = 'tunggu' | 'naik' | 'gagal' (hanya foto yang dipakai antrean guru ini)
let FS = { tunggu: 0, naik: 0, gagal: 0 }, FM = {}, fsKey = '';
async function segarFoto() {
  const g = gid(); if (!g) return;
  try {
    await pastikan();
    const ref = new Set(); Q.forEach(it => fotoItem(it).forEach(x => ref.add(x)));
    const f = { tunggu: 0, naik: 0, gagal: 0 }, m = {};
    (await idbAll('foto')).forEach(x => {
      if (x.gid !== g || !ref.has(x.id)) return;
      const k = x.real ? 'naik' : x.err ? 'gagal' : 'tunggu';
      f[k]++; m[x.id] = k;
    });
    const key = JSON.stringify([f, m]);
    if (key !== fsKey) { fsKey = key; FS = f; FM = m; gambar(); }
  } catch (e) {}
}
// hapus foto lokal milik item yang DIBUANG guru sendiri, hanya yang tidak dipakai item lain
async function hapusFotoYatim(ids) {
  const ref = new Set(); Q.forEach(it => fotoItem(it).forEach(x => ref.add(x)));
  for (const id of ids) if (!ref.has(id)) await idbDel('foto', id).catch(() => {});
}

/* ---------- sinkron ---------- */
async function payload(it) {
  if (it.type === 'hapus') return { jenis: it.jenis, id: it.id };
  const fix = async d => { const o = Object.assign({}, d); if (o.foto) o.foto = await petaFoto(o.foto); return o; };
  if (it.type === 'simpanBanyak') { const a = []; for (const d of it.data) a.push(await fix(d)); return { jenis: it.jenis, data: a }; }
  const o = await fix(it.data);
  if (it.baru) { delete o.ID; o.cid = it.id; } else { o.ID = it.id; delete o.cid; }
  return { jenis: it.jenis, data: o };
}
const UKURAN = 50; // catatan per pengiriman simpanBanyak (server menerima maksimal 60)
// gangguan sementara di sisi server: bukan kesalahan data, jadi tidak ditandai gagal, dicoba lagi nanti
const TRANSIEN = /lock|timed? ?out|waktu habis|too many times|try again|server error|exceeded|quota|bandwidth|sibuk/i;
const jml = it => it.type === 'simpanBanyak' ? it.data.length : 1;

// statistik sinkron terakhir, disimpan per guru di localStorage (bukan data jurnal)
const kStat = () => 'jg_sync_' + gid();
function bacaStat() { try { return JSON.parse(localStorage.getItem(kStat()) || '{}') || {}; } catch (e) { return {}; } }
function catatStat(R) {
  try {
    const s = bacaStat();
    s.t = Date.now(); s.ok = R.ok; s.gagal = R.gagal; s.dup = R.dup;
    s.tot = (s.tot || 0) + R.ok; s.totDup = (s.totDup || 0) + R.dup; s.fotoTot = (s.fotoTot || 0) + (R.fotoOk || 0);
    localStorage.setItem(kStat(), JSON.stringify(s));
  } catch (e) {}
}

// Ditolak server: data TETAP di perangkat, ditandai gagal, dicoba lagi otomatis tiap 30 menit atau lewat tombol sinkron
async function tandaiGagal(it, msg) {
  const baru = it.status !== 'gagal';
  it.tries = (it.tries || 0) + 1; it.err = msg; it.status = 'gagal'; it.next = Date.now() + 30 * 60000;
  if (baru) toast('Ada data yang ditolak server. Data tetap aman di perangkat. Ketuk indikator di kanan bawah untuk melihatnya.', true);
  await simpanItem(it).catch(() => {});
}

// simpanBanyak: kirim per UKURAN catatan. Catatan yang sudah DIKONFIRMASI server (n sama) langsung dibuang dari item,
// sisanya tetap tersimpan sehingga kegagalan di tengah jalan tidak mengirim ulang yang sudah masuk.
async function kirimBanyak(it, R) {
  while (it.data.length) {
    const potong = it.data.slice(0, UKURAN), fix = [];
    for (const d of potong) { const o = Object.assign({}, d); if (o.foto) o.foto = await petaFoto(o.foto); fix.push(o); }
    const j = await kirim('simpanBanyak', { jenis: it.jenis, data: fix }, S.token, 60000);
    if (!j.ok) return j;
    if (j.n !== potong.length) return { ok: false, error: 'Server hanya mengonfirmasi ' + j.n + ' dari ' + potong.length + ' data.' };
    if (j.kbcError) R.kbc = j.kbcError;
    R.ok += potong.length; R.dup += j.duplikat || 0; R.kena.add(it.jenis);
    const sudah = new Set(potong);
    it.data = it.data.filter(d => !sudah.has(d));
    if (it.data.length) await simpanItem(it).catch(() => {});
  }
  return { ok: true };
}
// kirim satu item antrean; mengembalikan { ok } atau { ok:false, error, auth }. Galat jaringan dilempar (e.net).
async function kirimSatu(it, R) {
  if (it.type === 'simpanBanyak') return kirimBanyak(it, R);
  const j = await kirim(it.type, await payload(it), S.token, 60000);
  if (!j.ok) {
    if (!j.auth && it.type === 'hapus' && /tidak ditemukan/i.test(j.error || '')) { R.ok++; R.kena.add(it.jenis); return { ok: true }; }
    return j;
  }
  // konfirmasi server: simpan harus mengembalikan ID baris yang tersimpan
  if (it.type === 'simpan' && !j.ID) return { ok: false, error: 'Server tidak mengonfirmasi data tersimpan.' };
  R.ok++; R.kena.add(it.jenis);
  if (j.duplikat) R.dup++;
  if (j.kbcError) R.kbc = j.kbcError;
  return { ok: true };
}

// paksa = dari tombol: abaikan jadwal tunggu data gagal
async function sinkron(paksa) {
  if (jalan) return null;
  await pastikan();
  if (!S.token || !gid() || !online()) return null;
  const now = Date.now();
  const items = urutQ().filter(x => x.status === 'antri' || (x.status === 'gagal' && (paksa || (x.next || 0) <= now)));
  const R = { ok: 0, gagal: 0, dup: 0, kbc: '', kena: new Set(), fotoOk: 0, fotoGagal: 0 };
  if (!items.length) return R;
  jalan = true; perluLogin = false; statusBaru();
  let ulang = false, putus = false;
  try {
    try { await naikSemuaFoto(R, items); } // foto diunggah lebih dulu, baru catatannya
    catch (e) { if (e.auth) perluLogin = true; else putus = true; }
    for (const it of items) {
      if (putus || perluLogin) break;
      if (!Q.has(it.qid)) continue; // dibuang saat sinkron berjalan
      const rev = it.rev, n0 = jml(it);
      let j;
      try { j = await kirimSatu(it, R); }
      catch (e) {
        if (e.net) { putus = true; break; }
        if (e.auth) { perluLogin = true; break; }
        j = { ok: false, error: e.message };
      }
      if (!j.ok) {
        if (j.auth) { perluLogin = true; break; }
        if (TRANSIEN.test(j.error || '')) { it.err = j.error; await simpanItem(it).catch(() => {}); putus = true; break; }
        R.gagal += jml(it); await tandaiGagal(it, j.error || 'Ditolak server'); continue;
      }
      const cur = Q.get(it.qid);
      if (cur && (it.type === 'simpanBanyak' ? !cur.data.length : cur.rev === rev)) await buangItem(cur).catch(() => {}); // dikonfirmasi server: baru boleh dibuang
      else if (cur) { ulang = true; cur.status = 'antri'; } // diubah saat sedang dikirim: kirim lagi versi terbaru
    }
  } finally { jalan = false; }
  if (R.ok || R.gagal || R.fotoOk) catatStat(R);
  statusBaru();
  const c = hitung();
  if (R.ok || R.gagal || paksa || R.fotoOk || R.fotoGagal) {
    let m = (R.gagal ? '⚠️ ' : '✅ ') + R.ok + ' berhasil · ' + R.gagal + ' gagal · ' + c.n + ' menunggu';
    if (R.dup) m += ' · ' + R.dup + ' sudah ada di server (tidak dobel)';
    if (R.fotoOk) m += ' · 📷 ' + R.fotoOk + ' foto terunggah ke Drive';
    if (R.fotoGagal) m += ' · ⚠️ ' + R.fotoGagal + ' foto gagal';
    if (putus && !R.ok && !R.gagal) m = '📴 Koneksi atau server bermasalah. Data tetap aman dan akan dicoba lagi otomatis.';
    if (perluLogin) m = '🔑 Sesi login berakhir. Masuk ulang, sinkron akan lanjut otomatis. Data tetap aman.';
    toast(m, !!R.gagal || putus || perluLogin);
  }
  if (R.ok) await segarkan([...R.kena]);
  if (R.kbc) toast('Jurnal tersimpan, tetapi bagian KBC belum tersimpan: ' + R.kbc, true);
  if (hilang) { toast('⚠️ ' + hilang + ' foto tidak ditemukan lagi di perangkat (dihapus peramban). Catatannya tetap terkirim tanpa foto itu.', true); hilang = 0; }
  if (ulang) setTimeout(sinkron, 1500);
  return R;
}
// tombol SINKRONKAN SEKARANG
async function sinkronSekarang() {
  await pastikan();
  if (!gid()) return;
  if (!online()) return toast('Belum ada internet. Data tetap aman di perangkat.', true);
  if (jalan) return toast('Sinkronisasi sedang berjalan...');
  if (!hitung().n && !hitung().g) { toast('✅ Semua data sudah tersinkron'); return statusBaru(); }
  const R = await sinkron(true);
  if (R && !R.ok && !R.gagal && !hitung().n && !hitung().g) toast('✅ Semua data sudah tersinkron');
}
// muat ulang data jurnal yang baru tersinkron (tanpa mengganggu form yang sedang terbuka)
async function segarkan(ks) {
  for (const k of ks) {
    if (!J[k]) continue;
    try { const r = await window.api('list', { jenis: k }); ROWS[k] = urut(r.rows); cRows(k); } catch (e) {}
  }
  try { KBDT = 0; } catch (e) {}
  if (document.querySelector('.md:not(#ofp)')) return;
  try {
    if (KEYS.indexOf(S.view) >= 0 && el('ls') && el('bln')) tampil(S.view);
    else if (S.view === 'beranda') gambarBeranda();
  } catch (e) {}
}

/* ---------- indikator dan panel ---------- */
function buatPil() {
  if (el('ofl')) return;
  const b = document.createElement('button');
  b.id = 'ofl'; b.type = 'button'; b.className = 'noprint';
  b.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:15;border:0;border-radius:99px;padding:6px 14px;font:700 12px/1.4 Nunito,system-ui,sans-serif;box-shadow:0 4px 14px #0003;cursor:pointer;display:none';
  b.onclick = bukaPanel;
  document.body.appendChild(b);
  // tombol SINKRONKAN SEKARANG: muncul hanya jika ada data yang menunggu atau gagal
  const t = document.createElement('button');
  t.id = 'ofs'; t.type = 'button'; t.className = 'noprint';
  t.style.cssText = 'position:fixed;right:12px;bottom:50px;z-index:15;border:0;border-radius:99px;padding:8px 16px;font:800 12px/1.4 Nunito,system-ui,sans-serif;background:#1e88e5;color:#fff;box-shadow:0 4px 14px #0004;cursor:pointer;display:none';
  t.textContent = '🔄 SINKRONKAN SEKARANG';
  t.onclick = () => { sinkronSekarang(); };
  document.body.appendChild(t);
}
// jumlah DATA (bukan jumlah item antrean): n = menunggu, g = gagal
function hitung() {
  let n = 0, g = 0;
  Q.forEach(x => { if (x.status === 'gagal') g += jml(x); else n += jml(x); });
  return { n: n, g: g };
}
function statusBaru() { gambar(); segarFoto(); }
function gambar() {
  const b = el('ofl');
  if (!b) return;
  const c = hitung(), off = !online();
  let t, bg, fg;
  if (jalan) { t = '🔄 Menyinkronkan...'; bg = '#e3f2fd'; fg = '#1565c0'; }
  else if (perluLogin && (c.n || c.g)) { t = '🔑 Masuk ulang untuk sinkron (' + (c.n + c.g) + ')'; bg = '#ffe0e6'; fg = '#b4233f'; }
  else if (c.g) { t = '⚠️ ' + c.g + ' gagal sinkron' + (c.n ? ', ' + c.n + ' menunggu' : ''); bg = '#ffe0e6'; fg = '#b4233f'; }
  else if (off) { t = '📴 Offline' + (c.n ? ' · ' + c.n + ' MENUNGGU SINKRONISASI' : ''); bg = '#fff3cd'; fg = '#8a5a00'; }
  else if (c.n) { t = '⏳ ' + c.n + ' MENUNGGU SINKRONISASI'; bg = '#e3f2fd'; fg = '#1565c0'; }
  else { t = '🟢 Online'; bg = '#e8f5e9'; fg = '#2e7d32'; }
  if (FS.tunggu && !jalan) t += ' · 📷 ' + FS.tunggu + ' foto';
  b.style.display = ''; b.textContent = t; b.style.background = bg; b.style.color = fg; b.style.opacity = (!off && !c.n && !c.g && !jalan) ? '.8' : '1';
  const s = el('ofs');
  if (s) {
    s.style.display = (gid() && (c.n || c.g) && !jalan) ? '' : 'none';
    s.style.opacity = off ? '.6' : '1';
  }
  const p = el('ofp');
  if (p && p._g) p._g();
}
function deskripsi(it) {
  const j = J[it.jenis], nm = j ? j.n : it.jenis;
  if (it.type === 'hapus') return ['Hapus catatan: ' + nm, ''];
  if (it.type === 'simpanBanyak') return [nm + ' (' + it.data.length + ' anak)', tgl((it.data[0] || {}).tanggal || '')];
  return [nm + (it.baru ? ' (baru)' : ' (ubah)'), tgl(it.data.tanggal || '')];
}
function fotoBlok() {
  const st = bacaStat();
  if (!FS.tunggu && !FS.naik && !FS.gagal && !st.fotoTot) return '';
  const k = (a, l, w) => '<span style="margin-right:12px;white-space:nowrap">' + l + ' <b style="color:' + w + '">' + a + '</b></span>';
  return '<p class="sub" style="margin-bottom:12px;font-size:13px">📷 Foto: ' + k(FS.tunggu, 'menunggu unggah', '#1565c0') + k(FS.naik, 'sudah di Drive (data belum terkirim)', '#2e7d32') + k(FS.gagal, 'gagal', FS.gagal ? '#b4233f' : 'inherit')
    + (st.fotoTot ? '<br><small>Total foto terunggah dari perangkat ini: ' + st.fotoTot + '. Salinan lokal disimpan sampai data terkirim.</small>' : '') + '</p>';
}
function ketFoto(it) {
  const ids = fotoItem(it);
  if (!ids.length) return '';
  const h = { tunggu: 0, naik: 0, gagal: 0 };
  ids.forEach(x => { h[FM[x] || 'tunggu']++; });
  const p = [];
  if (h.tunggu) p.push(h.tunggu + ' menunggu unggah');
  if (h.naik) p.push(h.naik + ' sudah di Drive');
  if (h.gagal) p.push(h.gagal + ' gagal');
  return '<span style="flex:1 1 100%;font-size:12px">📷 ' + ids.length + ' foto: ' + p.join(', ') + '</span>';
}
function bukaPanel() {
  if (!gid()) return;
  if (el('ofp')) return;
  const md = document.createElement('div');
  md.className = 'md'; md.id = 'ofp';
  md._g = () => {
    const v = urutQ(), c = hitung(), st = bacaStat();
    const ket = !online() ? 'Anda sedang offline. Catatan tetap bisa diisi dan akan dikirim otomatis saat internet kembali.'
      : perluLogin ? 'Sesi login berakhir. Masuk ulang untuk melanjutkan sinkron. Data di bawah aman di perangkat ini.'
      : jalan ? 'Sedang menyinkronkan data...'
      : (c.n || c.g) ? 'Ada data yang belum terkirim ke spreadsheet.' : 'Semua data sudah tersinkron.';
    const kotak = (a, l, w) => '<div style="flex:1;min-width:92px;text-align:center;background:#f3f9ff;border-radius:16px;padding:10px 6px"><div style="font:700 26px/1.2 Fredoka,system-ui,sans-serif;color:' + w + '">' + a + '</div><div style="font-size:12px;font-weight:700">' + l + '</div></div>';
    const jam = st.t ? new Date(st.t).toLocaleString('id-ID') : '';
    md.innerHTML = '<div class="sheet"><h2>🔄 Sinkronisasi data</h2><p class="sub" style="margin-bottom:10px">' + esc(ket) + '</p>'
      + '<div style="display:flex;gap:8px;margin-bottom:6px">' + kotak(st.ok || 0, '✅ Berhasil (sinkron terakhir)', '#2e7d32') + kotak(c.g, '⚠️ Gagal', c.g ? '#b4233f' : 'inherit') + kotak(c.n, '⏳ Menunggu', '#1565c0') + '</div>'
      + '<p class="sub" style="margin-bottom:12px;font-size:12px">' + (jam ? 'Sinkron terakhir: ' + esc(jam) + ' · ' : '') + 'Total terkirim dari perangkat ini: ' + (st.tot || 0) + (st.totDup ? ' · Dicegah dobel: ' + st.totDup : '') + '</p>'
      + fotoBlok() + (v.length ? v.map(it => {
        const d = deskripsi(it), gg = it.status === 'gagal';
        return '<div class="ukb" style="margin-bottom:8px"><b>' + esc(d[0]) + ' <small>' + esc(d[1]) + '</small></b>'
          + '<span style="flex:1 1 100%;font-size:13px;color:' + (gg ? '#b4233f' : 'inherit') + '">' + (gg ? '⚠️ ' + esc(it.err || 'Ditolak server') + ' (dicoba lagi otomatis tiap 30 menit)' : '⏳ Menunggu sinkronisasi' + (it.err ? ' (percobaan ulang: ' + esc(it.err) + ')' : '')) + '</span>'
          + ketFoto(it)
          + (gg ? '<button type="button" class="btn gh s" data-rt="' + esc(it.qid) + '">Coba lagi</button>' : '')
          + '<button type="button" class="btn rd s" data-bg="' + esc(it.qid) + '">Buang</button></div>';
      }).join('') : '<div class="empty">Tidak ada data yang mengantre.</div>')
      + '<div class="act"><button type="button" class="btn gh" data-x>Tutup</button><button type="button" class="btn" data-sy' + (jalan ? ' disabled' : '') + '>' + (jalan ? '🔄 Menyinkronkan...' : '🔄 SINKRONKAN SEKARANG') + '</button></div></div>';
  };
  md.onclick = async e => {
    const t = e.target;
    if (t === md || t.closest('[data-x]')) return md.remove();
    if (t.closest('[data-sy]')) { sinkronSekarang(); return; }
    const rt = t.closest('[data-rt]'), bg = t.closest('[data-bg]');
    if (rt) {
      const it = Q.get(rt.dataset.rt); if (!it) return;
      it.status = 'antri'; it.tries = 0; it.err = ''; it.next = 0;
      await simpanItem(it).catch(() => {});
      statusBaru(); sinkron(true);
    }
    if (bg) {
      const it = Q.get(bg.dataset.bg); if (!it) return;
      if (!await tanya('Buang data ini?', 'Data ini belum terkirim. Jika dibuang, data hilang dari perangkat dan tidak akan masuk ke spreadsheet.', 'Buang')) return;
      const fid = fotoItem(it);
      await buangItem(it).catch(() => {});
      await hapusFotoYatim(fid);
      statusBaru(); segarkan([it.jenis]);
    }
  };
  md._g();
  document.body.appendChild(md);
}

/* ---------- pasang pembungkus ---------- */
window.api = function (action, p) {
  p = p || {};
  if (action === 'list' || action === 'semua') return baca(action, p);
  if (action === 'simpan' || action === 'simpanBanyak' || action === 'hapus') return tulis(action, p);
  if (action === 'unggahLampiran') return unggah(p);
  if (action === 'fotoData') return fotoBaca(p);
  if (!online()) return Promise.reject(netErr('Tidak ada koneksi internet. ' + (BUTUH[action] || '')));
  return apiAsli(action, p);
};

// tandai catatan yang menunggu sinkron di daftar jurnal
const tampilAsli = window.tampil;
if (typeof tampilAsli === 'function') window.tampil = function (k) {
  const r = tampilAsli.apply(this, arguments);
  try {
    const m = pend();
    if (m.size) document.querySelectorAll('#ls [data-e]').forEach(b => {
      const st = m.get(b.dataset.e), c = b.closest('.card');
      if (!st || !c || c.querySelector('.ofb')) return;
      const s = c.querySelector('small');
      if (s) s.insertAdjacentHTML('beforeend', ' <span class="bdg ofb">' + (st === 'gagal' ? '⚠️ gagal sinkron' : '⏳ Menunggu Sinkronisasi') + '</span>');
    });
  } catch (e) {}
  return r;
};

// setelah masuk: lanjutkan sinkron untuk guru ini
const shellAsli = window.shell;
if (typeof shellAsli === 'function') window.shell = function () {
  const r = shellAsli.apply(this, arguments);
  perluLogin = false;
  pastikan().then(() => { statusBaru(); sinkron(); });
  return r;
};
const keluarAsli = window.keluar;
if (typeof keluarAsli === 'function') window.keluar = function () {
  const r = keluarAsli.apply(this, arguments);
  statusBaru();
  return r;
};

// Pembersihan foto lokal. ATURAN: foto yang belum terunggah TIDAK PERNAH dihapus otomatis, dan foto yang masih
// dipakai item antrean (semua guru di perangkat ini) tidak dihapus. Hanya foto yang sudah terunggah, tidak dipakai
// antrean mana pun, dan sudah lebih dari 7 hari sejak terunggah.
async function bersihkanFoto() {
  try {
    const ref = new Set(); (await idbAll('q')).forEach(it => fotoItem(it).forEach(x => ref.add(x)));
    (await idbAll('foto')).forEach(f => {
      if (!f.real || ref.has(f.id)) return;
      if (Date.now() - (f.up || f.t || 0) > 7 * 864e5) idbDel('foto', f.id).catch(() => {});
    });
  } catch (e) {}
}

buatPil();
pastikan().then(() => { statusBaru(); sinkron(); });
bersihkanFoto();
try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) {} // minta agar data tidak dihapus otomatis oleh browser
addEventListener('online', () => { statusBaru(); sinkron(); });
addEventListener('offline', statusBaru);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { statusBaru(); sinkron(); } });
setInterval(() => { statusBaru(); sinkron(); }, 60000);
window.__offline = { sinkron: sinkron, sinkronSekarang: sinkronSekarang, antrean: () => urutQ(), stat: bacaStat, foto: () => idbAll('foto'), statusFoto: () => FS, bersihkanFoto: bersihkanFoto }; // untuk pengujian
})();
