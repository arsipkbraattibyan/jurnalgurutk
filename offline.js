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
  if (online()) {
    try { return await core('unggahLampiran', p, 60000, true); }
    catch (e) { if (!e.net && !e.auth) throw e; if (e.auth) perluLogin = true; }
  }
  const id = 'tmp_' + acak(16);
  try { await idbPut('foto', { id: id, gid: gid(), b64: p.b64, t: Date.now() }); } catch (e) { throw penuh(); }
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
// ganti ID sementara dengan ID Drive (unggah dulu jika belum)
async function petaFoto(str) {
  const out = [];
  for (const id of String(str || '').split(/\s+/).filter(Boolean)) {
    if (id.indexOf('tmp_') !== 0) { out.push(id); continue; }
    const rec = await idbGet('foto', id).catch(() => null);
    if (!rec) continue; // berkas lokal hilang
    if (rec.real) { out.push(rec.real); continue; }
    const j = await kirim('unggahLampiran', { b64: rec.b64 }, S.token, 60000);
    if (!j.ok) { const e = new Error(j.error || 'Unggah foto gagal'); e.auth = !!j.auth; throw e; }
    rec.real = j.id;
    await idbPut('foto', rec).catch(() => {});
    out.push(j.id);
  }
  return out.join(' ');
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
async function tandaiGagal(it, msg) {
  it.tries = (it.tries || 0) + 1; it.err = msg;
  if (it.tries >= 3) { it.status = 'gagal'; toast('Ada data yang ditolak server. Ketuk indikator di kanan bawah untuk melihatnya.', true); }
  await simpanItem(it).catch(() => {});
}
async function sinkron() {
  if (jalan) return;
  await pastikan();
  if (!S.token || !gid() || !online()) return;
  const items = urutQ().filter(x => x.status === 'antri');
  if (!items.length) return;
  jalan = true; perluLogin = false; statusBaru();
  let ok = 0, ulang = false, kbcMsg = '';
  const kena = new Set();
  try {
    for (const it of items) {
      if (!Q.has(it.qid)) continue; // dibuang saat sinkron berjalan
      const rev = it.rev;
      let j;
      try { j = await kirim(it.type, await payload(it), S.token, 60000); }
      catch (e) {
        if (e.net) break;
        if (e.auth) { perluLogin = true; break; }
        await tandaiGagal(it, e.message); continue;
      }
      if (!j.ok) {
        if (j.auth) { perluLogin = true; break; }
        if (!(it.type === 'hapus' && /tidak ditemukan/i.test(j.error || ''))) { await tandaiGagal(it, j.error || 'Ditolak server'); continue; }
      } else if (j.kbcError) kbcMsg = j.kbcError;
      const cur = Q.get(it.qid);
      if (cur && cur.rev === rev) await buangItem(cur).catch(() => {});
      else if (cur) ulang = true; // diubah saat sedang dikirim: kirim lagi versi terbaru
      kena.add(it.jenis); ok++;
    }
  } finally { jalan = false; statusBaru(); }
  if (ok) { toast('✅ ' + ok + ' data berhasil disinkronkan'); await segarkan([...kena]); }
  if (kbcMsg) toast('Jurnal tersimpan, tetapi bagian KBC belum tersimpan: ' + kbcMsg, true);
  if (ulang) setTimeout(sinkron, 1500);
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
}
function hitung() {
  const v = [...Q.values()], n = v.filter(x => x.status === 'antri').length;
  return { n: n, g: v.length - n };
}
function statusBaru() {
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
  b.style.display = ''; b.textContent = t; b.style.background = bg; b.style.color = fg; b.style.opacity = (!off && !c.n && !c.g && !jalan) ? '.8' : '1';
  const p = el('ofp');
  if (p && p._g) p._g();
}
function deskripsi(it) {
  const j = J[it.jenis], nm = j ? j.n : it.jenis;
  if (it.type === 'hapus') return ['Hapus catatan: ' + nm, ''];
  if (it.type === 'simpanBanyak') return [nm + ' (' + it.data.length + ' anak)', tgl((it.data[0] || {}).tanggal || '')];
  return [nm + (it.baru ? ' (baru)' : ' (ubah)'), tgl(it.data.tanggal || '')];
}
function bukaPanel() {
  if (!gid()) return;
  if (el('ofp')) return;
  const md = document.createElement('div');
  md.className = 'md'; md.id = 'ofp';
  md._g = () => {
    const v = urutQ(), c = hitung();
    const ket = !online() ? 'Anda sedang offline. Catatan tetap bisa diisi dan akan dikirim otomatis saat internet kembali.'
      : perluLogin ? 'Sesi login berakhir. Masuk ulang untuk melanjutkan sinkron. Data di bawah aman di perangkat ini.'
      : jalan ? 'Sedang menyinkronkan data...'
      : (c.n || c.g) ? 'Ada data yang belum terkirim ke spreadsheet.' : 'Semua data sudah tersinkron.';
    md.innerHTML = '<div class="sheet"><h2>🔄 Sinkronisasi data</h2><p class="sub" style="margin-bottom:10px">' + esc(ket) + '</p>'
      + (v.length ? v.map(it => {
        const d = deskripsi(it), gg = it.status === 'gagal';
        return '<div class="ukb" style="margin-bottom:8px"><b>' + esc(d[0]) + ' <small>' + esc(d[1]) + '</small></b>'
          + '<span style="flex:1 1 100%;font-size:13px;color:' + (gg ? '#b4233f' : 'inherit') + '">' + (gg ? '⚠️ ' + esc(it.err || 'Ditolak server') : '⏳ Menunggu sinkronisasi' + (it.err ? ' (percobaan ulang: ' + esc(it.err) + ')' : '')) + '</span>'
          + (gg ? '<button type="button" class="btn gh s" data-rt="' + esc(it.qid) + '">Coba lagi</button>' : '')
          + '<button type="button" class="btn rd s" data-bg="' + esc(it.qid) + '">Buang</button></div>';
      }).join('') : '<div class="empty">Tidak ada data yang mengantre.</div>')
      + '<div class="act"><button type="button" class="btn gh" data-x>Tutup</button><button type="button" class="btn" data-sy>Sinkronkan sekarang</button></div></div>';
  };
  md.onclick = async e => {
    const t = e.target;
    if (t === md || t.closest('[data-x]')) return md.remove();
    if (t.closest('[data-sy]')) {
      if (!online()) return toast('Belum ada internet', true);
      sinkron(); return;
    }
    const rt = t.closest('[data-rt]'), bg = t.closest('[data-bg]');
    if (rt) {
      const it = Q.get(rt.dataset.rt); if (!it) return;
      it.status = 'antri'; it.tries = 0; it.err = '';
      await simpanItem(it).catch(() => {});
      statusBaru(); sinkron();
    }
    if (bg) {
      const it = Q.get(bg.dataset.bg); if (!it) return;
      if (!await tanya('Buang data ini?', 'Data ini belum terkirim. Jika dibuang, data hilang dari perangkat dan tidak akan masuk ke spreadsheet.', 'Buang')) return;
      await buangItem(it).catch(() => {});
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

// bersihkan foto lokal lama (sudah terunggah > 7 hari, atau yatim > 60 hari)
function bersihkanFoto() {
  idbAll('foto').then(a => a.forEach(f => {
    const umur = Date.now() - (f.t || 0);
    if ((f.real && umur > 7 * 864e5) || umur > 60 * 864e5) idbDel('foto', f.id).catch(() => {});
  })).catch(() => {});
}

buatPil();
pastikan().then(() => { statusBaru(); sinkron(); });
bersihkanFoto();
try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) {} // minta agar data tidak dihapus otomatis oleh browser
addEventListener('online', () => { statusBaru(); sinkron(); });
addEventListener('offline', statusBaru);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { statusBaru(); sinkron(); } });
setInterval(() => { statusBaru(); sinkron(); }, 60000);
window.__offline = { sinkron: sinkron, antrean: () => urutQ() }; // untuk pengujian
})();
