/**
 * LAPORAN BARU - Jurnal Guru KB-RA At Tibyan
 * Dipasang SETELAH script utama di index.html (satu baris sebelum </body>):
 *   <script src="laporan-baru.js"></script>
 *
 * Menimpa tampilan menu Laporan dengan 4 pilihan:
 *   1. Kurikulum Merdeka   2. Kurikulum Berbasis Cinta   3. Terpadu (KM + KBC)
 *   4. Rekap jurnal (laporan lama, fungsi laporan() asli tidak diubah)
 * Data: hanya MEMBACA ROWS (J2..J8, aksi 'semua'/'list') dan KBC_Jurnal (aksi 'kbcDaftar')
 * yang sama dengan yang diisi guru di jurnal. Tidak ada penyimpanan, tidak ada data ganda.
 * Cetak, PDF, Excel, Word memakai aksiLap() yang sudah ada (membaca elemen "#lap .paper").
 */
(function () {
'use strict';

const E = esc;
let RV2 = 0;
const KC = {};
const SUMBER = ['harian', 'perkembangan', 'penilaian', 'kokurikuler', 'refleksi'];
const DESK = {
  PC1: 'Menumbuhkan iman, ibadah, dan meneladani akhlak Rasulullah.',
  PC2: 'Menumbuhkan rasa ingin tahu, semangat belajar, dan menghargai ilmu.',
  PC3: 'Menumbuhkan kepedulian merawat alam, tanaman, hewan, dan kebersihan.',
  PC4: 'Menumbuhkan kasih sayang, empati, berbagi, dan menghargai perbedaan.',
  PC5: 'Menumbuhkan rasa bangga dan cinta pada bangsa, budaya, dan negeri.'
};
const STAT = { hadir: 'Hadir', sakit: 'Sakit', izin: 'Izin', alpha: 'Tanpa keterangan' };

/* ---------- pembantu ---------- */
const uniq = a => [...new Set(a.filter(Boolean))];
const T10 = t => String(t || '').slice(0, 10);
const byT = (a, b) => String(a.tanggal).localeCompare(String(b.tanggal));
const nm = s => pcNama(s);
const nilaiKbc = r => [r.nilaiid].concat(String(r.nilailain || '').split(',')).map(x => String(x).trim()).filter(Boolean);
const nJ = k => J[k] ? J[k].n.replace('Jurnal ', '') : k;
const list = a => a.length ? a.map(x => '• ' + E(x)).join('<br>') : '-';
const inP = (t, rg) => { t = T10(t); return (!rg.dari || t >= rg.dari) && (!rg.sampai || t <= rg.sampai); };

function semRange(th, sm) {
  const y = parseInt(th, 10) || new Date().getFullYear();
  return sm === 'Genap' ? { dari: (y + 1) + '-01-01', sampai: (y + 1) + '-06-30' } : { dari: y + '-07-01', sampai: y + '-12-31' };
}
const tahunList = () => {
  const s = new Set(['2025/2026', '2026/2027', '2027/2028']);
  if (S.guru && S.guru.tahun) s.add(S.guru.tahun);
  return [...s].sort();
};

function periode() {
  const m = nilai('lpm') || 'bulan', g = S.guru || {};
  let th = g.tahun || '', sm = g.semester || '';
  if (m === 'tanggal') {
    let a = $('#lrd').value, b = $('#lrs').value;
    if (a && b && a > b) { const t = a; a = b; b = t; }
    return { m, dari: a || (b ? '0000-01-01' : ''), sampai: b || (a ? '9999-12-31' : ''),
      label: !a && !b ? 'Seluruh periode' : (a ? tgl(a) : 'awal') + ' s.d. ' + (b ? tgl(b) : 'sekarang'), th, sm };
  }
  if (m === 'bulan') {
    const bl = $('#lrb').value || hari().slice(0, 7), p = bl.split('-');
    return { m, dari: bl + '-01', sampai: bl + '-' + String(new Date(+p[0], +p[1], 0).getDate()).padStart(2, '0'), label: blnNama(bl), th, sm };
  }
  if (m === 'semester') {
    th = $('#lrth').value || th; sm = nilai('lrsm') || 'Ganjil';
    const r = semRange(th, sm);
    return { m, dari: r.dari, sampai: r.sampai, label: 'Semester ' + sm + ' tahun pelajaran ' + th, th, sm };
  }
  return { m, dari: '', sampai: '', label: 'Seluruh periode', th, sm };
}

function ambilFilter() {
  const s = $('#lra'), kel = klf() || nilai('lrk') || '', anak = s ? s.value : '';
  return { rg: periode(), kel: kelNorm(kel) || '', anak: anak,
    anakNama: anak && s.selectedOptions[0] ? s.selectedOptions[0].dataset.n : '',
    jenis: nilai('lrj') || 'km', kbc: [], kk: [] };
}

// jurnal milik guru (ROWS) disaring periode, kelompok, dan anak (hanya Jurnal Perkembangan yang punya nama anak)
const dat = (k, F) => (ROWS[k] || []).filter(r => inP(r.tanggal, F.rg)
  && (!F.kel || !r.kelas || kelNorm(r.kelas) === F.kel)
  && (k !== 'perkembangan' || !F.anak || kunci(r.nama) === F.anak)).slice().sort(byT);
// catatan KBC (KBC_Jurnal) disaring kelompok dan anak; catatan tingkat kelas tetap tampil saat memilih anak
const kbSaring = F => F.kbc.filter(r => (!F.kel || !r.kelas || kelNorm(r.kelas) === F.kel)
  && (!r.anakid || !F.anak || kunci(r.anaknama) === F.anak)).slice().sort(byT);

function tb(cols, rows) {
  return '<div class="ov"><table class="rt"><thead><tr><th>No</th>' + cols.map(c => '<th>' + E(c[0]) + '</th>').join('') + '</tr></thead><tbody>'
    + (rows.length ? rows.map((r, i) => '<tr><td class="c">' + (i + 1) + '</td>' + cols.map(c => '<td' + (c[2] ? ' class="c"' : '') + '>' + c[1](r) + '</td>').join('') + '</tr>').join('')
      : '<tr><td class="c" colspan="' + (cols.length + 1) + '">Tidak ada catatan pada periode ini.</td></tr>') + '</tbody></table></div>';
}

/* ---------- bagian laporan: masing-masing mengembalikan [judul, html] ---------- */
function sIdent(F) {
  const g = S.guru, rows = [['Nama guru', g.nama], ['NIP / NUPTK', g.nip], ['Status kepegawaian', g.status], ['Nama sekolah', g.sekolah], ['NPSN', g.npsn],
    ['Jenjang', g.jenjang], ['Kelompok yang diampu', kelNorm(g.kelas) || g.kelas], ['Tahun pelajaran', F.rg.th], ['Semester', F.rg.sm],
    ['Alamat sekolah', alamatSek(g)], ['Kepala sekolah', g.kepsek], ['NIP / NUPTK kepala sekolah', g.nipkepsek],
    ['Kelompok dalam laporan', F.kel || 'Semua kelompok'], ['Anak dalam laporan', F.anakNama || 'Semua anak'], ['Periode laporan', F.rg.label]];
  return ['Identitas', '<table class="rt id">' + rows.map(x => '<tr><td>' + x[0] + '</td><td>' + E(x[1] || '-') + '</td></tr>').join('') + '</table>'];
}

function sCP(F) {
  const P = dat('perkembangan', F), by = ELEMEN_CP.map(() => []);
  P.forEach(r => { const i = elemenIdx(r.aspek); if (i >= 0) by[i].push(r); });
  const rows = ELEMEN_CP.map((n, i) => ({ n: n, r: by[i] }));
  let h = tb([['Elemen CP', x => E(x.n)],
    ['Tujuan pembelajaran (TP)', x => list(uniq(x.r.map(r => r.tujuan)))],
    ['Indikator yang diamati', x => list(uniq([].concat.apply([], x.r.map(r => String(r.indikator || '').split(' | ')))).slice(0, 12))],
    ['Jumlah pengamatan', x => x.r.length, 1]], rows);
  h += '<p style="font-size:11px;margin:4px 0 0">TP dan indikator diambil dari isian Jurnal Perkembangan Anak pada periode ini.</p>';
  const K = dat('kokurikuler', F);
  if (K.length) h += '<h4>Tujuan kegiatan kokurikuler</h4>' + tb([['Tanggal', r => tgl(r.tanggal)], ['Tema', r => E(r.tema)], ['Tujuan kegiatan', r => E(r.tujuan)]], K);
  return ['Capaian Pembelajaran (CP) dan Tujuan Pembelajaran (TP)', h];
}

function sTema(F) {
  const m = new Map();
  const add = (r, j) => {
    const t = r.tema || '-', s = r.subtema || '-', k = t + '|' + s;
    let o = m.get(k); if (!o) { o = { t: t, s: s, h: 0, p: 0, a: [] }; m.set(k, o); }
    o[j]++; o.a.push(T10(r.tanggal));
  };
  dat('harian', F).forEach(r => add(r, 'h')); dat('perkembangan', F).forEach(r => add(r, 'p'));
  const rows = [...m.values()].map(o => { o.a.sort(); return o; }).sort((a, b) => a.a[0].localeCompare(b.a[0]));
  return ['Tema dan subtema', tb([['Tema', o => E(o.t)], ['Subtema', o => E(o.s)], ['Jurnal harian', o => o.h, 1], ['Pengamatan anak', o => o.p, 1],
    ['Rentang tanggal', o => tgl(o.a[0]) + (o.a[o.a.length - 1] !== o.a[0] ? ' s.d. ' + tgl(o.a[o.a.length - 1]) : '')]], rows)];
}

const pcHarian = (F, r) => {
  const k = F.kk.find(x => x.jenis === 'harian' && String(x.jurnalid) === String(r.ID) && !x.anakid);
  return k ? '<b>' + E(nm(nilaiKbc(k).join(','))) + '</b><br>' + E(k.aktivitas) : '-';
};

function sHarian(F, kbc) {
  const H = dat('harian', F);
  const cols = [['Tanggal', r => tgl(r.tanggal)], ['Kelompok', r => E(kelNorm(r.kelas))], ['Tema', r => E(r.tema)], ['Subtema', r => E(r.subtema)],
    ['Sentra', r => E(r.sentra)], ['Kegiatan inti', r => E(r.kegiatan)], ['Metode', r => E(r.metode)], ['Ketercapaian', r => E(r.capaian)],
    ['Kendala', r => E(r.kendala)], ['Tindak lanjut', r => E(r.tindak)]];
  if (kbc) cols.push(['Penguatan Panca Cinta', r => pcHarian(F, r)]);
  return ['Jurnal harian mengajar', '<h4>Ketercapaian kegiatan</h4>' + dist('Ketercapaian', H, 'capaian', opsi('harian', 'capaian')) + '<h4>Rincian jurnal harian</h4>' + tb(cols, H)];
}

function sHadir(F) {
  const kh = dat('kehadiran', F);
  let h;
  if (F.anak) {
    const ak = (SISWA || []).find(s => kunci(s.nama) === F.anak), kl = ak ? ak.kelas : '', k0 = F.anakNama.trim().toLowerCase();
    const rows = kh.filter(r => !kl || kelNorm(r.kelas) === kl).map(r => ({ t: r.tanggal, s: absenDari(r)[k0] || 'hadir' }));
    const c = x => rows.filter(r => r.s === x).length;
    h = '<h4>Rekap kehadiran ' + E(F.anakNama) + '</h4><table class="rt sm"><thead><tr><th>Hari tercatat</th><th>Hadir</th><th>Sakit</th><th>Izin</th><th>Tanpa keterangan</th><th>Persentase hadir</th></tr></thead><tbody><tr><td class="c">'
      + rows.length + '</td><td class="c">' + c('hadir') + '</td><td class="c">' + c('sakit') + '</td><td class="c">' + c('izin') + '</td><td class="c">' + c('alpha') + '</td><td class="c">' + pct(c('hadir'), rows.length) + '</td></tr></tbody></table>'
      + '<h4>Rincian per hari</h4>' + tb([['Tanggal', r => tgl(r.t)], ['Status', r => E(STAT[r.s])]], rows);
  } else {
    const jh = sum(kh, 'jumlah');
    h = '<h4>Rekapitulasi kehadiran anak</h4><table class="rt sm"><thead><tr><th>Hari tercatat</th><th>Hadir</th><th>Sakit</th><th>Izin</th><th>Tanpa keterangan</th><th>Persentase hadir</th></tr></thead><tbody><tr><td class="c">'
      + kh.length + '</td><td class="c">' + sum(kh, 'hadir') + '</td><td class="c">' + sum(kh, 'sakit') + '</td><td class="c">' + sum(kh, 'izin') + '</td><td class="c">' + sum(kh, 'alpha') + '</td><td class="c">' + pct(sum(kh, 'hadir'), jh) + '</td></tr></tbody></table>'
      + '<h4>Rincian per hari</h4>' + tb([['Tanggal', r => tgl(r.tanggal)], ['Kelompok', r => E(kelNorm(r.kelas))], ['Jumlah anak', r => E(r.jumlah), 1], ['Hadir', r => E(r.hadir), 1], ['Sakit', r => E(r.sakit), 1],
        ['Izin', r => E(r.izin), 1], ['Tanpa keterangan', r => E(r.alpha), 1], ['Catatan', r => E(r.catatan)]], kh)
      + '<h4>Presensi per anak</h4><p style="margin:0 0 4px;font-size:12px">Sumber: Rekap Absen, hanya pada tanggal yang Jurnal Kehadirannya sudah diisi.</p><div id="prs" data-w="1">' + presTabel({ loading: 1 }) + '</div>';
  }
  return ['Kehadiran', h];
}

function sPerk(F, kbc) {
  const P = dat('perkembangan', F);
  const cols = [['Tanggal', r => tgl(r.tanggal)], ['Anak', r => E(r.nama)], ['Kelompok', r => E(kelNorm(r.kelas))],
    ['Tema / subtema', r => E([r.tema, r.subtema].filter(Boolean).join(' / '))], ['Elemen CP', r => E(r.aspek)],
    ['Indikator', r => E(String(r.indikator || '').split(' | ').join('; '))],
    ['Capaian', r => lvl(r) >= 0 ? lvChip(lvl(r)) : E(r.tingkat), 1]];
  if (kbc) cols.push(['Panca Cinta', r => E(nm(r.pancacinta))]);
  cols.push(['Catatan pengamatan', r => E(r.catatan)], ['Tindak lanjut', r => E(r.tindak)]);
  return ['Perkembangan anak', '<h4>Tingkat capaian</h4>' + dist('Tingkat capaian', P, 'tingkat', TKT)
    + '<p style="font-size:11px;margin:4px 0 0">BB = Belum Berkembang, MB = Mulai Berkembang, BSH = Berkembang Sesuai Harapan, BSB = Berkembang Sangat Baik.</p>'
    + '<h4>Rincian pengamatan</h4>' + tb(cols, P)];
}

function sAses(F) {
  const pn = dat('penilaian', F), tn = sum(pn, 'bb') + sum(pn, 'mb') + sum(pn, 'bsh') + sum(pn, 'bsb');
  const sm = '<h4>Rekap hasil penilaian</h4><table class="rt sm dst"><thead><tr><th>Tingkat capaian</th><th>Jumlah anak</th><th>Persentase</th></tr></thead><tbody>'
    + [['bb', TKT[0]], ['mb', TKT[1]], ['bsh', TKT[2]], ['bsb', TKT[3]]].map(x => '<tr><td>' + x[1] + '</td><td class="c">' + sum(pn, x[0]) + '</td><td class="c">' + pct(sum(pn, x[0]), tn) + '</td></tr>').join('')
    + '<tr class="tt"><td>Total</td><td class="c">' + tn + '</td><td class="c">' + (tn ? '100%' : '-') + '</td></tr></tbody></table>';
  return ['Asesmen (penilaian pembelajaran)', sm + '<h4>Rincian penilaian</h4>' + tb([['Tanggal', r => tgl(r.tanggal)], ['Kelompok', r => E(kelNorm(r.kelas))], ['Tema', r => E(r.tema)], ['Aspek', r => E(r.aspek)],
    ['Jenis', r => E(r.jenis)], ['Teknik', r => E(r.teknik)], ['Anak dinilai', r => E(r.peserta), 1], ['BB', r => E(r.bb), 1], ['MB', r => E(r.mb), 1], ['BSH', r => E(r.bsh), 1], ['BSB', r => E(r.bsb), 1],
    ['Tindak lanjut', r => E(r.tindak)]], pn)];
}

function sRefl(F, mode) {
  const R = dat('refleksi', F);
  const kb = r => E([r.pcterap, r.pancacinta ? nm(r.pancacinta) : ''].filter(Boolean).join(': '));
  let cols;
  if (mode === 'km') cols = [['Tanggal', r => tgl(r.tanggal)], ['Perasaan', r => E(r.suasana)], ['Yang berjalan baik', r => E(r.berjalan)], ['Kendala', r => E(r.tantangan)], ['Tindak lanjut', r => E(r.rencana)]];
  else if (mode === 'kbc') cols = [['Tanggal', r => tgl(r.tanggal)], ['Penerapan Panca Cinta', kb], ['Respons anak', r => E(r.respons)], ['Kepedulian anak', r => E(r.peduli)],
    ['Kesesuaian dengan tujuan', r => E(r.sesuaitujuan)], ['Kendala', r => E(r.tantangan)], ['Tindak lanjut', r => E(r.rencana)]];
  else cols = [['Tanggal', r => tgl(r.tanggal)], ['Perasaan', r => E(r.suasana)], ['Yang berjalan baik', r => E(r.berjalan)], ['Penerapan Panca Cinta', kb], ['Respons anak', r => E(r.respons)],
    ['Kepedulian anak', r => E(r.peduli)], ['Kesesuaian dengan tujuan', r => E(r.sesuaitujuan)], ['Kendala', r => E(r.tantangan)], ['Tindak lanjut', r => E(r.rencana)]];
  return [mode === 'kbc' ? 'Refleksi KBC' : 'Refleksi guru', tb(cols, R)];
}

function sNilai(F) {
  const ns = (KBCN || KBCN0), kk = F.kk;
  const rows = ns.map(([id, n]) => {
    const c = SUMBER.map(j => kk.filter(r => r.jenis === j && nilaiKbc(r).indexOf(id) >= 0).length);
    return { id: id, n: n, c: c, t: c.reduce((a, b) => a + b, 0) };
  });
  const tot = rows.reduce((a, r) => a + r.t, 0);
  const cols = [['Nilai Panca Cinta', r => E(r.n)], ['Makna', r => E(DESK[r.id] || '')]]
    .concat(SUMBER.map((j, i) => [nJ(j), r => r.c[i], 1]))
    .concat([['Total', r => r.t, 1], ['Persentase', r => pct(r.t, tot), 1]]);
  return ['Lima nilai Panca Cinta', tb(cols, rows)
    + '<p style="font-size:11px;margin:4px 0 0">Satu catatan dengan beberapa nilai dihitung pada setiap nilainya. Persentase terhadap jumlah seluruh penyebutan nilai.</p>'];
}

function sTujuan(F) {
  const ns = (KBCN || KBCN0);
  const rows = ns.map(([id, n]) => ({ n: n, t: uniq(F.kk.filter(r => nilaiKbc(r).indexOf(id) >= 0).map(r => r.tujuan)) }));
  return ['Tujuan penguatan', tb([['Nilai Panca Cinta', r => E(r.n)], ['Tujuan penguatan', r => list(r.t)]], rows)];
}

function sAktPemb(F) {
  const H = dat('harian', F), K = dat('kokurikuler', F);
  let h = '<h4>Kegiatan pembelajaran harian</h4>' + tb([['Tanggal', r => tgl(r.tanggal)], ['Kelompok', r => E(kelNorm(r.kelas))], ['Tema / subtema', r => E([r.tema, r.subtema].filter(Boolean).join(' / '))],
    ['Kegiatan inti', r => E(r.kegiatan)], ['Sentra', r => E(r.sentra)], ['Metode', r => E(r.metode)],
    ['Nilai Panca Cinta', r => { const k = F.kk.find(x => x.jenis === 'harian' && String(x.jurnalid) === String(r.ID) && !x.anakid); return k ? E(nm(nilaiKbc(k).join(','))) : '-'; }]], H);
  if (K.length) h += '<h4>Kegiatan kokurikuler</h4>' + tb([['Tanggal', r => tgl(r.tanggal)], ['Tema', r => E(r.tema)], ['Bentuk kegiatan', r => E(r.bentuk)], ['Aktivitas anak', r => E(r.aktivitas)],
    ['Nilai Panca Cinta', r => E(nm(r.pancacinta))]], K);
  return ['Aktivitas pembelajaran', h];
}

function sImpl(F) {
  const kk = F.kk, kelas = kk.filter(r => !r.anakid);
  const sum1 = SUMBER.map(j => ({ n: nJ(j), a: kk.filter(r => r.jenis === j).length, b: kk.filter(r => r.jenis === j && r.anakid).length }));
  return ['Implementasi KBC', '<h4>Jumlah catatan KBC per jurnal</h4>' + tb([['Sumber jurnal', r => E(r.n)], ['Jumlah catatan KBC', r => r.a, 1], ['Di antaranya pengamatan per anak', r => r.b, 1]], sum1)
    + '<h4>Penerapan KBC di kelas</h4>' + tb([['Tanggal', r => tgl(r.tanggal)], ['Sumber', r => E(nJ(r.jenis))], ['Nilai Panca Cinta', r => E(nm(nilaiKbc(r).join(',')))],
      ['Aktivitas implementasi', r => E(r.aktivitas)], ['Catatan penerapan', r => E(r.hasil)]], kelas)];
}

function sPengamatan(F) {
  const a = F.kk.filter(r => r.anakid);
  return ['Hasil pengamatan', tb([['Tanggal', r => tgl(r.tanggal)], ['Anak', r => E(r.anaknama)], ['Sumber', r => E(nJ(r.jenis))], ['Nilai Panca Cinta', r => E(nm(nilaiKbc(r).join(',')))],
    ['Perilaku yang diamati', r => E(String(r.indikator || '').split(' | ').join('; '))], ['Teknik', r => E(r.teknik)], ['Catatan hasil pengamatan', r => E(r.hasil)]], a)
    + '<p style="font-size:11px;margin:4px 0 0">Pengamatan autentik tanpa nilai angka, bersumber dari Jurnal Perkembangan dan Jurnal Penilaian.</p>'];
}

function sDok(F, gabung) {
  const m = new Map(), MX = 60;
  const ids = r => String(r.foto || '').split(/\s+/).filter(Boolean);
  const add = (id, o) => { if (!m.has(id)) m.set(id, o); };
  F.kk.forEach(r => ids(r).forEach(id => add(id, { t: r.tanggal, c: '<b>' + E(nJ(r.jenis)) + '</b><br>' + tgl(r.tanggal) + '<br>' + E(nm(nilaiKbc(r).join(','))) + (r.anaknama ? '<br>' + E(r.anaknama) : '') })));
  if (gabung) Object.keys(FOTO).forEach(k => dat(k, F).forEach(r => ids(r).forEach(id => add(id, { t: r.tanggal, c: '<b>' + E(nJ(k)) + '</b><br>' + tgl(r.tanggal) + '<br>' + E(J[k].t(r)) }))));
  const L = [...m.entries()].sort((a, b) => String(a[1].t).localeCompare(String(b[1].t))), sh = L.slice(0, MX);
  return ['Dokumentasi', sh.length
    ? '<div class="gal">' + sh.map(([id, o]) => '<figure><img data-fid="' + E(id) + '" src="' + BLANK + '" alt="Foto"><figcaption>' + o.c + '</figcaption></figure>').join('') + '</div>'
      + (L.length > MX ? '<p style="font-size:12px">Menampilkan ' + MX + ' dari ' + L.length + ' foto pada periode ini. Persempit periode laporan untuk melihat sisanya.</p>' : '')
    : '<p style="font-size:12px">Tidak ada foto pada periode ini.</p>'];
}

function sRingkas(F) {
  const rows = KEYS.map(k => ({ n: J[k].n, p: J[k].per, a: dat(k, F).length, b: F.kk.filter(r => r.jenis === k).length }));
  const kh = dat('kehadiran', F);
  return ['Ringkasan terpadu', '<h4>Jumlah catatan per jurnal dan catatan KBC terkait</h4>' + tb([['Jenis jurnal', r => E(r.n)], ['Periode pengisian', r => E(r.p)], ['Jumlah catatan', r => r.a, 1], ['Catatan KBC terkait', r => r.b, 1]], rows)
    + '<p style="font-size:12px;margin:6px 0 0">Kehadiran anak pada periode ini: ' + pct(sum(kh, 'hadir'), sum(kh, 'jumlah')) + ' dari ' + kh.length + ' hari tercatat.</p>'];
}

/* ---------- penyusunan halaman ---------- */
function kertas(F, judul, secs) {
  const g = S.guru, today = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  const kop = '<div class="kop"><img class="kl" src="' + LOGO + '" alt=""><div class="kt"><h2>' + E((g.sekolah || 'NAMA SEKOLAH').toUpperCase()) + '</h2><p>' + E(g.jenjang || '') + (g.npsn ? ' - NPSN ' + E(g.npsn) : '') + '</p>'
    + (alamatSek(g) ? '<p>' + E(alamatSek(g)) + (g.telpsekolah ? ' | Telp. ' + E(g.telpsekolah) : '') + '</p>' : '') + '</div></div>';
  const ket = [F.kel ? 'Kelompok: ' + E(F.kel) : '', F.anakNama ? 'Anak: ' + E(F.anakNama) : ''].filter(Boolean).join(' | ');
  return '<div class="paper">' + kop + '<h1 class="jd">' + judul + '</h1><p class="sj">Tahun pelajaran ' + E(F.rg.th || '-') + ', semester ' + E(F.rg.sm || '-') + '<br>Periode: ' + E(F.rg.label) + (ket ? '<br>' + ket : '') + '</p>'
    + secs.map((s, i) => '<h3>' + String.fromCharCode(65 + i) + '. ' + s[0] + '</h3>' + s[1]).join('')
    + '<div class="ttd"><div><p>Mengetahui,<br>Kepala ' + E(g.sekolah || 'sekolah') + '</p><div class="sp"></div><b><u>' + E(g.kepsek || '..............................') + '</u></b></div>'
    + '<div><p>Surabaya, ' + today + '<br>Guru ' + E(g.kelas || 'kelompok') + '</p><div class="sp"></div><b><u>' + E(g.nama) + '</u></b></div></div></div>';
}

function bangun(F) {
  F.kk = kbSaring(F);
  if (F.jenis === 'kbc') return kertas(F, 'LAPORAN KURIKULUM BERBASIS CINTA', [sIdent(F), sNilai(F), sTujuan(F), sAktPemb(F), sImpl(F), sPengamatan(F), sDok(F, false), sRefl(F, 'kbc')]);
  if (F.jenis === 'terpadu') return kertas(F, 'LAPORAN TERPADU<br>KURIKULUM MERDEKA DAN KURIKULUM BERBASIS CINTA',
    [sIdent(F), sRingkas(F), sCP(F), sTema(F), sHarian(F, true), sHadir(F), sPerk(F, true), sAses(F), sNilai(F), sTujuan(F), sImpl(F), sPengamatan(F), sRefl(F, 'gab'), sDok(F, true)]);
  if (F.jenis === 'lama') {
    const rg = { dari: F.rg.dari, sampai: F.rg.sampai, label: F.rg.label, judul: '' };
    return laporan(rg, { loading: 1 });
  }
  return kertas(F, 'LAPORAN KURIKULUM MERDEKA', [sIdent(F), sCP(F), sTema(F), sHarian(F, false), sHadir(F), sPerk(F, false), sAses(F), sRefl(F, 'km')]);
}

/* ---------- ambil data KBC dari database yang sama (tanpa menulis) ---------- */
async function ambilKbc(rg) {
  const key = (rg.dari || '') + '|' + (rg.sampai || ''), c = KC[key];
  if (c && Date.now() - c.t < 30000) return { rows: c.rows };
  try {
    if (!KBCN) { try { KBCN = (await api('kbcNilai')).nilai.map(x => [x.ID, x.nama]); } catch (e) {} }
    const j = await api('kbcDaftar', { f: { dari: rg.dari || '', sampai: rg.sampai || '' } });
    KC[key] = { t: Date.now(), rows: j.rows || [] };
    return { rows: KC[key].rows };
  } catch (e) { return { rows: [], err: e.message }; }
}

async function gambar() {
  const my = ++RV2, lap = $('#lap');
  if (!lap) return;
  const F = ambilFilter();
  if (F.jenis === 'kbc' || F.jenis === 'terpadu') {
    lap.innerHTML = muat();
    const r = await ambilKbc(F.rg);
    if (my !== RV2 || S.view !== 'laporan') return;
    F.kbc = r.rows; F.err = r.err;
  }
  let html;
  try { html = bangun(F); } catch (er) { lap.innerHTML = '<div class="empty">' + E(er.message) + '</div>'; return; }
  lap.innerHTML = (F.err ? '<div class="abn k0 noprint">Catatan KBC belum bisa dimuat (' + E(F.err) + '). Bagian KBC ditampilkan kosong. Pastikan Code.gs dan Kbc.gs terbaru sudah dipasang dan kbcSiapkan() sudah dijalankan.</div>' : '') + html;
  isiFoto(lap);
  if ($('#prs')) {
    let p;
    try { p = await api('presensi', { dari: F.rg.dari, sampai: F.rg.sampai, kelas: F.kel }); } catch (er) { p = { err: er.message }; }
    if (my !== RV2 || S.view !== 'laporan') return;
    const pr = $('#prs');
    if (pr) { pr.innerHTML = presTabel(p); pr.removeAttribute('data-w'); }
  }
}

function isiAnak() {
  const s = $('#lra'), kel = kelNorm(klf() || nilai('lrk') || ''), cur = s.value, mp = new Map();
  (SISWA || []).filter(x => !kel || x.kelas === kel).forEach(x => mp.set(kunci(x.nama), String(x.nama)));
  (ROWS.perkembangan || []).forEach(r => { const k = kunci(r.nama); if (k && (!kel || kelNorm(r.kelas) === kel) && !mp.has(k)) mp.set(k, String(r.nama).trim()); });
  const L = [...mp.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  s.innerHTML = '<option value="">Semua anak</option>' + L.map(([k, n]) => '<option value="' + E(k) + '" data-n="' + E(n) + '">' + E(n) + '</option>').join('');
  if (mp.has(cur)) s.value = cur;
}

function aturInput() {
  const m = nilai('lpm') || 'bulan';
  [['#lpt', m === 'tanggal'], ['#lpb', m === 'bulan'], ['#lps', m === 'semester']].forEach(x => { $(x[0]).style.display = x[1] ? '' : 'none'; });
}

async function viewLaporan() {
  const m = $('#main'), g = S.guru, kf = klf();
  const th = g.tahun || tahunList()[0], sm = g.semester === 'Genap' ? 'Genap' : 'Ganjil';
  m.innerHTML = '<div class="card noprint" id="lrc"><h3>🔎 Filter laporan</h3>'
    + '<div class="fd"><label>Jenis laporan</label>' + radioGrup('lrj', [['km', 'Kurikulum Merdeka'], ['kbc', 'Kurikulum Berbasis Cinta'], ['terpadu', 'Terpadu (KM + KBC)'], ['lama', 'Rekap jurnal (laporan lama)']], 'km', 'lrj') + '</div>'
    + '<div class="fg" style="margin-top:14px"><div class="fd"><label>Nama guru</label><input value="' + E(g.nama) + '" disabled></div>'
    + (kf ? '<div class="fd"><label>Kelompok</label><input value="' + E(kf) + '" disabled></div>'
      : '<div class="fd full"><label>Kelompok</label>' + radioGrup('lrk', [['', 'Semua'], ['Kelompok A', 'Kelompok A'], ['Kelompok B', 'Kelompok B'], ['KB', 'KB']], '', 'lrk') + '</div>')
    + '<div class="fd"><label for="lra">Nama anak (opsional)</label><select id="lra"><option value="">Semua anak</option></select></div></div>'
    + '<div class="fd" style="margin-top:14px"><label>Periode</label>' + radioGrup('lpm', [['tanggal', 'Tanggal'], ['bulan', 'Bulan'], ['semester', 'Semester'], ['semua', 'Seluruh periode']], 'bulan', 'lpm') + '</div>'
    + '<div class="filt" style="margin-top:12px"><div class="fg" id="lpt" style="display:none"><div class="fd"><label for="lrd">Dari tanggal</label><input type="date" id="lrd" value="' + hari().slice(0, 8) + '01"></div><div class="fd"><label for="lrs">Sampai tanggal</label><input type="date" id="lrs" value="' + hari() + '"></div></div>'
    + '<div class="fd" id="lpb"><label for="lrb">Bulan</label><input type="month" id="lrb" value="' + hari().slice(0, 7) + '" style="width:210px"></div>'
    + '<div class="fg" id="lps" style="display:none"><div class="fd"><label for="lrth">Tahun pelajaran</label><select id="lrth">' + tahunList().map(t => '<option' + (t === th ? ' selected' : '') + '>' + E(t) + '</option>').join('') + '</select></div>'
    + '<div class="fd"><label>Semester</label>' + radioGrup('lrsm', [['Ganjil', 'Ganjil (Jul-Des)'], ['Genap', 'Genap (Jan-Jun)']], sm, 'lrsm') + '</div></div></div>'
    + '<small class="sub">Data diambil dari jurnal yang sudah Anda isi, tidak perlu mengisi ulang. Pilih nama anak untuk melihat perkembangan dan kehadiran anak itu saja; catatan tingkat kelas tetap ditampilkan.</small>'
    + ukrHtml() + '</div><h3 class="noprint" style="margin:6px 0 10px;color:var(--navy)">👁️ Pratinjau laporan</h3><div id="lap">' + muat() + '</div>';
  aturInput();
  let tm;
  $('#lrc').onchange = e => {
    if (e.target.name === 'lrk') isiAnak();
    aturInput(); clearTimeout(tm); tm = setTimeout(gambar, 80);
  };
  $('.ukr').onclick = e => { const b = e.target.closest('[data-ak]'); if (b) aksiLap(b.dataset.uk, b.dataset.ak); };
  const ada = cacheSemua();
  try {
    await loadSiswa();
    if (!ada) await muatSemua();
    if (S.view !== 'laporan') return;
    isiAnak(); gambar();
    if (ada) muatSemua().then(() => { if (S.view === 'laporan') { isiAnak(); gambar(); } }).catch(() => {});
  } catch (e) { const l = $('#lap'); if (l) l.innerHTML = '<div class="empty">' + E(e.message) + '</div>'; }
}

window.viewLaporan = viewLaporan;
window.__lapBangun = { bangun: bangun, ambilFilter: ambilFilter }; // untuk pengujian
})();
