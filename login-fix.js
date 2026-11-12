/* Jurnal Guru - tambalan login (muat SEBELUM offline.js)
   1) api(): batas waktu + coba ulang otomatis untuk daftarGuru / login / profil.
   2) muatGuruLogin(): daftar nama disimpan di perangkat, jadi guru tetap bisa memilih nama
      walau server Apps Script sedang lambat. Pesan error menampilkan sebab sebenarnya. */
(function () {
'use strict';
if (typeof api !== 'function' || typeof muatGuruLogin !== 'function') return;

const ULANG = { daftarGuru: 4, login: 4, profil: 4 }; // hanya aksi yang aman diulang
const jeda = ms => new Promise(ok => setTimeout(ok, ms));
const jaringan = m => { const e = new Error(m); e.net = true; return e; };

window.api = async function (action, p) {
  p = p || {};
  const n = ULANG[action] || 1;
  let galat;
  for (let i = 0; i < n; i++) {
    const ac = new AbortController(), tm = setTimeout(() => ac.abort(), n > 1 ? 10000 : 25000);
    try {
      let r;
      try {
        r = await fetch(API_URL, { method: 'POST', body: JSON.stringify(Object.assign({ action: action, token: S.token }, p)), signal: ac.signal });
      } catch (e) {
        throw jaringan(e && e.name === 'AbortError' ? 'Server terlalu lama merespons.' : 'Tidak bisa terhubung ke server.');
      }
      let j;
      try { j = await r.json(); } catch (e) { throw jaringan('Jawaban server tidak valid.'); }
      if (!j.ok) { if (j.auth) keluar(); throw new Error(j.error || 'Terjadi kesalahan'); }
      if (j.sv !== undefined) svCek(j.sv);
      return j;
    } catch (e) {
      if (!e.net) throw e;            // error dari server (mis. PIN salah): jangan diulang
      galat = e;
      if (i < n - 1) await jeda(1200 * (i + 1));
    } finally { clearTimeout(tm); }
  }
  throw galat;
};

const GL = 'jg_gl';
window.muatGuruLogin = async function () {
  const U = $('#lgxU'), E = $('#lgxE');
  if (!U) return;
  const isi = L => {
    U.innerHTML = '<option value="" disabled hidden selected>Pilih nama Anda</option>'
      + L.map(g => `<option value="${esc(g.id)}">${esc(g.nama)}</option>`).join('');
    U.disabled = false; U.value = '';
  };
  try { localStorage.removeItem(LAST_KEY); } catch (e) {}
  let dariCache = false;
  try {
    const c = JSON.parse(localStorage.getItem(GL) || '[]');
    if (Array.isArray(c) && c.length) { isi(c); dariCache = true; }
  } catch (e) {}
  try {
    const j = await api('daftarGuru');
    if (S.mode !== 'login' || !$('#lgxU')) return;
    const sk = j.sekolah || {};
    if (sk.nama) $('#lgxSek').textContent = sk.nama;
    const logoOk = /^data:image\/(png|jpeg);base64,/.test(sk.logo || '');
    if (logoOk) { if ($('#lgxLogo').src !== sk.logo) $('#lgxLogo').src = sk.logo; }
    else if (sekCache().logo) $('#lgxLogo').src = LOGO;
    sekCache({ nama: sk.nama || '', logo: logoOk ? sk.logo : '' });
    const L = j.guru || [];
    E.hidden = true;
    if (!L.length) { U.innerHTML = '<option value="">Belum ada guru terdaftar</option>'; return; }
    const dipilih = U.value;
    isi(L);
    if (dipilih && L.some(g => String(g.id) === String(dipilih))) U.value = dipilih; // pilihan guru tidak hilang
    try { localStorage.setItem(GL, JSON.stringify(L.map(g => ({ id: g.id, nama: g.nama })))); } catch (e) {}
  } catch (e) {
    if (S.mode !== 'login' || !$('#lgxU')) return;
    console.error('daftarGuru gagal:', e);
    if (dariCache) return; // daftar dari perangkat sudah tampil, login tetap bisa dipakai
    U.innerHTML = '<option value="">Daftar nama belum termuat</option>';
    E.innerHTML = 'Server belum merespons (' + esc((e && e.message) || 'galat tidak dikenal') + '). Tunggu sebentar lalu <button type="button" id="lgxR">Coba lagi</button>';
    E.hidden = false;
    $('#lgxR').onclick = () => { E.hidden = true; window.muatGuruLogin(); };
  }
};
})();
