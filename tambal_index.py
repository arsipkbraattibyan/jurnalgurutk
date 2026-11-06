#!/usr/bin/env python3
# Menambal index.html: Penilaian Pembelajaran + pengamatan Panca Cinta (tanpa nilai angka).
# Pemakaian:  python3 tambal_index.py index.html
# Hasil:      index_baru.html (berkas asli tidak diubah; logo dan semua kode lain tetap persis sama)
import sys, io

src = sys.argv[1] if len(sys.argv) > 1 else 'index.html'
out = 'index_baru.html'
t = io.open(src, encoding='utf-8').read()

def sekali(teks, kunci, nama):
    n = teks.count(kunci)
    if n != 1:
        sys.exit('GAGAL: titik sisip "%s" ditemukan %d kali (harus tepat 1). Berkas tidak diubah.' % (nama, n))

# ---------- 1. teknik asesmen ----------
LAMA_TEKNIK = "{k:'teknik',l:'Teknik',t:'sel',o:['Catatan anekdot','Hasil karya','Ceklis','Foto berseri','Observasi','Percakapan']},"
BARU_TEKNIK = "{k:'teknik',l:'Teknik',t:'sel',o:['Observasi','Catatan anekdot','Hasil karya','Dokumentasi','Percakapan','Ceklis perkembangan']},"

# ---------- 2. blok pengamatan Panca Cinta ----------
BLOK_PCP = r'''/* ---------- Pengamatan Panca Cinta di Jurnal Penilaian (tanpa nilai angka) ---------- */
// Indikator di bawah adalah contoh awal. Sesuaikan dengan teks resmi Panduan KBC sebelum dipakai di laporan.
const PCI={
PC1:['Berdoa dengan tertib sebelum dan sesudah kegiatan','Menirukan gerakan ibadah dengan sungguh-sungguh','Mengucap salam dan syukur secara spontan','Meniru kebiasaan baik yang diceritakan tentang Rasulullah (jujur, berbagi)'],
PC2:['Bertanya tentang hal yang ingin diketahui','Antusias mencoba dan mengeksplorasi bahan','Bertahan menyelesaikan kegiatan sampai selesai','Menyimak cerita atau penjelasan guru dengan perhatian'],
PC3:['Membuang sampah pada tempatnya','Merapikan alat main setelah dipakai','Merawat tanaman atau hewan (menyiram, memberi makan)','Menjaga kebersihan kelas dan menghemat air'],
PC4:['Mau berbagi dan bergantian','Menolong teman yang kesulitan','Mengungkapkan perasaan dengan kata-kata','Menghargai perbedaan teman','Mengucapkan tolong, maaf, dan terima kasih'],
PC5:['Ikut bernyanyi lagu kebangsaan atau daerah dengan semangat','Menyebutkan simbol negara (bendera, Garuda)','Bersikap hormat saat upacara atau pengibaran bendera','Tertarik pada pakaian, makanan, atau permainan tradisional']};
const pcpBlok=()=>`<details class="fd full" id="pcpb"><summary class="ah kosong"><span>💗 Pengamatan Panca Cinta (opsional)</span><i>Belum ada</i><em>›</em></summary><p class="sub" style="font-size:12px;margin:-2px 0 8px">Catat perilaku autentik yang tampak pada anak, tanpa nilai angka. Teknik asesmen mengikuti isian Teknik di atas, foto bukti mengikuti blok foto, dan tautan ke Jurnal Harian dibuat otomatis (tanggal dan kelompok yang sama).</p><p class="sub" id="pcpw" style="display:none;font-size:12px;color:#c0392b;margin:0 0 8px">Pengamatan Panca Cinta yang tersimpan belum bisa dimuat. Bagian ini tidak akan diubah saat Anda menyimpan.</p><div class="fd" style="margin-bottom:10px"><label for="pcpa">Anak</label><select id="pcpa"><option value="">Pilih anak...</option></select></div><div class="fd" style="margin-bottom:10px"><label>Nilai Panca Cinta (boleh lebih dari satu)</label><div class="opts" id="pcpn">${KBCN0.map(([id,n])=>`<label class="op"><input type="checkbox" name="pcpn" value="${id}"><span>${esc(n)}</span></label>`).join('')}</div></div><div class="fd" style="margin-bottom:10px"><label>Perilaku yang diamati</label><div class="opts" id="pcpi" style="grid-template-columns:1fr"></div><div class="fup" style="margin-top:10px"><input id="pcpx" maxlength="200" placeholder="Tulis perilaku lain yang teramati" style="flex:1 1 220px;width:auto" autocomplete="off"><button type="button" class="btn o s" data-pa>+ Tambah</button></div></div><div class="fd" style="margin-bottom:10px"><label for="pcpc">Catatan hasil pengamatan</label><textarea id="pcpc" rows="3" maxlength="1000" placeholder="Apa yang dilakukan dan dikatakan anak, dalam situasi apa"></textarea></div><button type="button" class="btn y s" data-pcs>Simpan pengamatan anak ini</button><div id="pcpl"></div></details>`;
function pcpInit(md,row,daftar){const b=md.querySelector('#pcpb');if(!b)return;
const q=s=>b.querySelector(s),L=[];let cur=[],cust=[];
md._pcpOk=!row; // jurnal baru langsung siap; jurnal lama siap setelah data lamanya terbaca
const nilaiDipilih=()=>[...b.querySelectorAll('input[name=pcpn]:checked')].map(c=>c.value);
const ring=()=>{const a=b.querySelector('.ah');a.querySelector('i').textContent=L.length?L.length+' anak':'Belum ada';a.classList.toggle('kosong',!L.length)};
const isiAnak=()=>{const s=q('#pcpa'),v=s.value,n=daftar();s.innerHTML='<option value="">Pilih anak...</option>'+n.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');if(n.indexOf(v)>=0)s.value=v};
const renderInd=()=>{const base=[].concat(...nilaiDipilih().map(n=>PCI[n]||[])),all=[...new Set(base.concat(cust,cur))];
q('#pcpi').innerHTML=all.length?all.map(x=>`<label class="op"><input type="checkbox" name="pcpind" value="${esc(x)}"${cur.indexOf(x)>=0?' checked':''}><span>${esc(x)}</span></label>`).join(''):'<span class="sub">Pilih nilai Panca Cinta untuk menampilkan perilaku yang bisa diamati.</span>'};
const draw=()=>{q('#pcpl').innerHTML=L.map((it,i)=>`<div class="ukb" style="margin-top:8px"><b>${esc(it.nama)} <small>${esc(pcNama(it.nilai.join(',')))}</small></b><span style="flex:1 1 100%;font-size:13px">${esc([it.indikator.join('; '),it.catatan].filter(Boolean).join(' | '))}</span><button type="button" class="btn gh s" data-pe="${i}">Ubah</button><button type="button" class="btn rd s" data-pd="${i}">Hapus</button></div>`).join('')};
const bersih=()=>{cur=[];cust=[];q('#pcpa').value='';b.querySelectorAll('input[name=pcpn]').forEach(c=>c.checked=false);q('#pcpc').value='';q('#pcpx').value='';q('[data-pcs]').textContent='Simpan pengamatan anak ini';renderInd()};
const tambahInd=()=>{const v=q('#pcpx').value.trim().replace(/\s*\|\s*/g,' ');if(!v)return toast('Tulis perilakunya dulu',1);
if(cust.indexOf(v)<0)cust.push(v);if(cur.indexOf(v)<0)cur.push(v);q('#pcpx').value='';renderInd()};
const simpanItem=()=>{const nama=q('#pcpa').value,nl=nilaiDipilih(),cat=q('#pcpc').value.trim();
if(!nama)return toast('Pilih anak dulu',1);if(!nl.length)return toast('Pilih minimal satu nilai Panca Cinta',1);
if(!cur.length&&!cat)return toast('Pilih perilaku yang diamati atau tulis catatan pengamatan',1);
const it={nama,nilai:nl,indikator:cur.slice(),catatan:cat},i=L.findIndex(x=>kunci(x.nama)===kunci(nama));
if(i>=0)L[i]=it;else L.push(it);ring();draw();bersih()};
b.addEventListener('change',e=>{const n=e.target.name;
if(n==='pcpn')renderInd();
else if(n==='pcpind'){const v=e.target.value;cur=e.target.checked?cur.filter(x=>x!==v).concat(v):cur.filter(x=>x!==v)}});
b.addEventListener('click',e=>{const t=e.target;
if(t.closest('[data-pa]'))return tambahInd();
if(t.closest('[data-pcs]'))return simpanItem();
const pe=t.closest('[data-pe]'),pd=t.closest('[data-pd]');
if(pe){const it=L[+pe.dataset.pe],s=q('#pcpa');
if(![...s.options].some(o=>o.value===it.nama))s.insertAdjacentHTML('beforeend',`<option value="${esc(it.nama)}">${esc(it.nama)}</option>`);
s.value=it.nama;b.querySelectorAll('input[name=pcpn]').forEach(c=>c.checked=it.nilai.indexOf(c.value)>=0);
cur=it.indikator.slice();cust=it.indikator.slice();q('#pcpc').value=it.catatan;renderInd();q('[data-pcs]').textContent='Perbarui pengamatan anak ini';return}
if(pd){L.splice(+pd.dataset.pd,1);ring();draw();bersih()}});
q('#pcpx').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();tambahInd()}});
md.addEventListener('change',e=>{if(e.target.name==='kelas')isiAnak()});
(KBCN?Promise.resolve(KBCN):api('kbcNilai').then(j=>KBCN=j.nilai.map(x=>[x.ID,x.nama]))).then(l=>l.forEach(([id,t])=>b.querySelectorAll('input[name=pcpn]').forEach(c=>{if(c.value===id)c.nextElementSibling.textContent=t}))).catch(()=>{});
loadSiswa().then(isiAnak);isiAnak();renderInd();
if(row)api('kbcDaftar',{f:{jurnalid:row.ID,jenis:'penilaian'}}).then(j=>{
(j.rows||[]).filter(k=>k.anakid).forEach(k=>L.push({nama:k.anaknama,nilai:[k.nilaiid].concat(String(k.nilailain||'').split(',')).filter(Boolean),indikator:String(k.indikator||'').split(' | ').filter(Boolean),catatan:k.hasil||''}));
md._pcpOk=true;ring();draw()}).catch(()=>{const w=q('#pcpw');if(w)w.style.display=''});
// ada isian yang belum dimasukkan ke daftar?
md._pcpPending=()=>nilaiDipilih().length>0||cur.length>0||!!q('#pcpc').value.trim();
// undefined = data lama gagal dimuat, jadi jangan dikirim (agar tidak menimpa pengamatan yang ada)
md._pcpGet=()=>md._pcpOk?L.map(x=>({nama:x.nama,nilai:x.nilai,indikator:x.indikator,catatan:x.catatan})):undefined}
'''

# ---------- 3. kait di bukaForm ----------
SIMPAN_LAMA = "d.kbc=kb}}"
SIMPAN_BARU = r'''d.kbc=kb}}
if(k==='penilaian'){
if(md._pcpPending&&md._pcpPending()){const pb=md.querySelector('#pcpb');pb.open=true;pb.scrollIntoView({behavior:'smooth',block:'center'});return toast('Pengamatan Panca Cinta belum dimasukkan. Ketuk "Simpan pengamatan anak ini" atau kosongkan isiannya',1)}
const pc=md._pcpGet&&md._pcpGet();if(pc!==undefined)d.pcobs=pc}'''

EDIT = [
 ('teknik penilaian', LAMA_TEKNIK, BARU_TEKNIK),
 ('awal kbcInit', "function kbcInit(md,row){const b=md.querySelector('#kbcb');if(!b)return;",
    BLOK_PCP + "function kbcInit(md,row){const b=md.querySelector('#kbcb');if(!b)return;"),
 ('template blok KBC', "${k==='harian'?kbcBlok():''}", "${k==='harian'?kbcBlok():''}${k==='penilaian'?pcpBlok():''}"),
 ('init KBC', "if(k==='harian')kbcInit(md,row);", "if(k==='harian')kbcInit(md,row);\nif(k==='penilaian')pcpInit(md,row,daftar);"),
 ('simpan KBC', SIMPAN_LAMA, SIMPAN_BARU),
]
for nama, lama, baru in EDIT:
    sekali(t, lama, nama)
for nama, lama, baru in EDIT:
    t = t.replace(lama, baru, 1)

io.open(out, 'w', encoding='utf-8', newline='').write(t)
print('Selesai. Hasil: %s (%d titik diubah). Ganti index.html Anda dengan berkas ini.' % (out, len(EDIT)))
