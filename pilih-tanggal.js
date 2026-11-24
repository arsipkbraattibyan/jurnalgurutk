/* Pemilih tanggal/bulan terang untuk layar sentuh (pemilih bawaan HP mengikuti mode gelap sistem) */
(function(){
if(!window.matchMedia||!matchMedia('(pointer:coarse)').matches)return;
var BLN=['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'],BS=['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'],HR=['M','S','S','R','K','J','S'];
var p2=function(n){return('0'+n).slice(-2)};
function tgl(){var d=new Date();return d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate())}
function kirim(inp,v){inp.value=v;['input','change'].forEach(function(t){inp.dispatchEvent(new Event(t,{bubbles:true}))})}
function buka(inp){
 if(document.querySelector('.dpm'))return;
 var bulan=inp.type==='month',now=tgl(),v=inp.value||'',pv=(bulan?v+'-01':v).match(/^(\d{4})-(\d{2})-(\d{2})/);
 var th=pv?+pv[1]:+now.slice(0,4),bl=pv?+pv[2]-1:+now.slice(5,7)-1,mode=bulan?'bln':'hari';
 var m=document.createElement('div');m.className='dpm';document.body.appendChild(m);
 function tutup(){m.remove()}
 function gambar(){
  var h='<div class="dpc"><div class="dph"><button type="button" class="dpn" data-n="-1">‹</button><div class="dpt">'+(mode==='bln'?th:BLN[bl]+' '+th)+'</div><button type="button" class="dpn" data-n="1">›</button></div>';
  if(mode==='bln'){h+='<div class="dpm12">'+BS.map(function(b,i){var k=th+'-'+p2(i+1);return'<button type="button" class="dpd'+(k===v?' on':(k===now.slice(0,7)?' td':''))+'" data-m="'+i+'">'+b+'</button>'}).join('')+'</div>'}
  else{
   h+='<div class="dpg">'+HR.map(function(x){return'<div class="dpw">'+x+'</div>'}).join('')+'</div><div class="dpg dpb">';
   var aw=new Date(th,bl,1).getDay(),n=new Date(th,bl+1,0).getDate(),i;
   for(i=0;i<aw;i++)h+='<span></span>';
   for(i=1;i<=n;i++){var k=th+'-'+p2(bl+1)+'-'+p2(i);h+='<button type="button" class="dpd'+(k===v?' on':(k===now?' td':''))+'" data-d="'+k+'">'+i+'</button>'}
   h+='</div>';
  }
  h+='<div class="dpa"><button type="button" data-a="x">Batal</button><button type="button" data-a="h">'+(bulan?'Bulan ini':'Hari ini')+'</button><button type="button" data-a="k">Kosongkan</button></div></div>';
  m.innerHTML=h;
 }
 m.addEventListener('click',function(e){
  if(e.target===m)return tutup();
  var b=e.target.closest('button');if(!b)return;
  if(b.dataset.n){var n=+b.dataset.n;if(mode==='bln')th+=n;else{bl+=n;if(bl<0){bl=11;th--}if(bl>11){bl=0;th++}}return gambar()}
  if(b.dataset.d){kirim(inp,b.dataset.d);return tutup()}
  if(b.dataset.m){kirim(inp,th+'-'+p2(+b.dataset.m+1));return tutup()}
  if(b.dataset.a==='x')return tutup();
  if(b.dataset.a==='k'){kirim(inp,'');return tutup()}
  if(b.dataset.a==='h'){kirim(inp,bulan?now.slice(0,7):now);return tutup()}
 });
 gambar();
}
function sasar(e){var t=e.target;return t&&t.tagName==='INPUT'&&(t.type==='date'||t.type==='month')&&!t.disabled?t:null}
document.addEventListener('pointerdown',function(e){var t=sasar(e);if(t)t.readOnly=true},true);
document.addEventListener('click',function(e){var t=sasar(e);if(!t)return;e.preventDefault();e.stopPropagation();t.blur();buka(t)},true);
})();
