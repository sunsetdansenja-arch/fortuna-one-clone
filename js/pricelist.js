// Fortuna Laundry — pricelist module
// Sumber data: backend action pricelist_read / pricelist_create / pricelist_update / pricelist_delete.
// loadPricelist() mengisi PACKAGE_CATALOG (js/config.js) sehingga seluruh logika harga/satuan/deadline
// di orders.js tetap bekerja tanpa perubahan.

let pricelistRows=[];            // baris mentah dari backend
let pricelistUsingDefaults=true; // true bila table backend kosong → katalog bawaan dipakai
let pricelistEditing=null;       // baris yang sedang diedit (null = mode tambah)
let pricelistSaving=false;

const plNum=v=>Number(String(v??'').replace(/[^0-9]/g,''))||0;

function pricelistToCatalogEntry(p){
  const unit=String(p.SATUAN||'').toLowerCase()||'unit';
  const min=Number(p.HARGA_MIN)||0;
  const hours=Number(p.DEADLINE_JAM)||0;
  return {
    unit,
    price:min>0?min:null,
    maxPrice:Number(p.HARGA_MAX)>min?Number(p.HARGA_MAX):null,
    pricing:p.PRICING||(min>0?(unit==='kg'?'perKg':'perUnit'):'manual'),
    deadline:p.DEADLINE||'',
    duration:hours>0?hours:null
  };
}

async function loadPricelist(){
  try{
    // Timeout 10 detik supaya dashboard tidak tertahan bila n8n lambat / cold start.
    const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),10000);
    let j;
    try{
      const r=await fetch(WEBHOOK_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'pricelist_read',data:{}}),signal:ctl.signal});
      j=await r.json();
      if(!r.ok||j.status==='error')throw new Error(j.message||'Request gagal');
    }catch(err){
      throw err.name==='AbortError'?new Error('server tidak merespons (timeout 10 detik)'):err;
    }finally{clearTimeout(timer);}
    const list=Array.isArray(j.data?.packages)?j.data.packages:[];
    pricelistRows=list;
    if(!list.length){
      PACKAGE_CATALOG=DEFAULT_PACKAGE_CATALOG;
      pricelistUsingDefaults=true;
    }else{
      PACKAGE_CATALOG=Object.fromEntries(list.map(p=>[String(p.NAMA_PAKET).toUpperCase(),pricelistToCatalogEntry(p)]));
      pricelistUsingDefaults=false;
    }
    PACKAGES=Object.keys(PACKAGE_CATALOG);
    return true;
  }catch(e){
    // Gagal: biarkan katalog yang sedang aktif (bawaan atau hasil muat terakhir) tetap dipakai.
    toast('Pricelist gagal dimuat, memakai data terakhir: '+e.message,false);
    return false;
  }
}

function pricelistPriceLabel(p){
  const min=Number(p.HARGA_MIN)||0;
  if(!(min>0))return 'Harga manual';
  let s=rupiah(min);
  if(Number(p.HARGA_MAX)>min)s+='–'+rupiah(p.HARGA_MAX);
  return s+' / '+String(p.SATUAN||'').toLowerCase();
}

function renderPricelist(){
  const list=$('pricelistList');
  if(!list)return;
  const q=String($('pricelistSearch')?.value||'').trim().toLowerCase();
  const unit=$('pricelistUnitFilter')?.value||'ALL';
  const rows=pricelistRows.filter(p=>(!q||String(p.NAMA_PAKET).toLowerCase().includes(q))&&(unit==='ALL'||p.SATUAN===unit));
  $('pricelistEmptyNotice')?.classList.toggle('hidden',!pricelistUsingDefaults);
  $('pricelistCount').textContent=pricelistUsingDefaults?'Belum ada paket di server':rows.length+' dari '+pricelistRows.length+' paket ditampilkan';
  if(!rows.length){
    list.innerHTML='<div class="p-8 text-center text-sm text-slate-400">'+(pricelistUsingDefaults?'Pricelist masih kosong.':'Tidak ada paket yang cocok.')+'</div>';
    return;
  }
  list.innerHTML=rows.map(p=>{
    const deadline=p.DEADLINE?esc(p.DEADLINE):'-';
    return `<div class="px-4 py-3.5 flex items-center justify-between gap-3">
      <div class="min-w-0">
        <div class="flex items-center gap-2 flex-wrap"><span class="font-extrabold text-sm break-words">${esc(p.NAMA_PAKET)}</span><span class="pill bg-slate-100 text-slate-600">${esc(p.SATUAN)}</span></div>
        <div class="text-[11px] text-slate-500 mt-1">${esc(pricelistPriceLabel(p))} · Deadline: ${deadline}</div>
      </div>
      <div class="flex gap-2 shrink-0">
        <button type="button" data-act="edit" data-name="${esc(p.NAMA_PAKET)}" class="btn w-9 h-9 rounded-xl bg-slate-100 text-slate-700" aria-label="Edit"><i class="fa-solid fa-pen"></i></button>
        <button type="button" data-act="delete" data-name="${esc(p.NAMA_PAKET)}" class="btn w-9 h-9 rounded-xl bg-red-50 text-red-600" aria-label="Hapus"><i class="fa-solid fa-trash"></i></button>
      </div>
    </div>`;
  }).join('');
}

document.addEventListener('click',e=>{
  const b=e.target.closest('#pricelistList [data-act]');
  if(!b)return;
  if(b.dataset.act==='edit')editPricelist(b.dataset.name);
  else if(b.dataset.act==='delete')deletePricelist(b.dataset.name);
});

async function refreshPricelist(silent=false){
  const btn=$('pricelistRefreshBtn'),icon=$('pricelistRefreshIcon');
  if(btn)btn.disabled=true;
  if(icon)icon.className='fa-solid fa-spinner fa-spin mr-1';
  try{
    const ok=await loadPricelist();
    renderPricelist();
    refreshPackageOptions();
    if(ok&&!silent)toast('Pricelist berhasil diperbarui');
  }finally{
    if(btn)btn.disabled=false;
    if(icon)icon.className='fa-solid fa-rotate-right mr-1';
  }
}

/* ---------- form ---------- */

function plToggleManual(){
  const manual=$('pl-manual').checked;
  ['pl-harga-min','pl-harga-max'].forEach(id=>{
    $(id).disabled=manual;
    if(manual)$(id).value='';
  });
}

function plToggleDeadline(){
  const none=$('pl-deadline-unit').value==='NONE';
  $('pl-deadline-angka').disabled=none;
  if(none)$('pl-deadline-angka').value='';
}

function resetPricelistForm(){
  pricelistEditing=null;
  $('pricelistForm').reset();
  plToggleManual();
  plToggleDeadline();
  $('pricelistFormTitle').textContent='Tambah Paket';
  $('pricelistSaveText').textContent='Simpan Paket';
  $('pricelistCancelBtn').classList.add('hidden');
}

function editPricelist(name){
  const p=pricelistRows.find(x=>x.NAMA_PAKET===name);
  if(!p)return;
  pricelistEditing=p;
  $('pl-nama').value=p.NAMA_PAKET;
  $('pl-satuan').value=p.SATUAN;
  const min=Number(p.HARGA_MIN)||0;
  $('pl-manual').checked=!(min>0);
  plToggleManual();
  if(min>0){
    $('pl-harga-min').value=String(min);
    $('pl-harga-max').value=Number(p.HARGA_MAX)>min?String(p.HARGA_MAX):'';
  }
  const m=String(p.DEADLINE||'').match(/^(\d+(?:[.,]\d+)?)\s*(jam|hari)$/i);
  if(m){
    $('pl-deadline-angka').value=m[1].replace(',','.');
    $('pl-deadline-unit').value=m[2].toUpperCase();
  }else{
    $('pl-deadline-angka').value='';
    $('pl-deadline-unit').value='NONE';
  }
  plToggleDeadline();
  $('pricelistFormTitle').textContent='Edit Paket';
  $('pricelistSaveText').textContent='Simpan Perubahan';
  $('pricelistCancelBtn').classList.remove('hidden');
  $('pricelistForm').scrollIntoView({behavior:'smooth',block:'start'});
}

function pricelistFormData(){
  const nama=String($('pl-nama').value).replace(/\s+/g,' ').trim().toUpperCase();
  if(!nama)return {error:'Nama paket wajib diisi.'};
  const manual=$('pl-manual').checked;
  const min=plNum($('pl-harga-min').value),max=plNum($('pl-harga-max').value);
  let harga='0';
  if(!manual){
    if(!(min>0))return {error:'Harga wajib lebih dari 0, atau centang "Harga manual".'};
    if(max&&max<=min)return {error:'Harga maks harus lebih besar dari harga min (atau kosongkan).'};
    harga=max>min?min+'-'+max:String(min);
  }
  const mode=$('pl-deadline-unit').value;
  let deadline='';
  if(mode==='JAM'||mode==='HARI'){
    const n=Number(String($('pl-deadline-angka').value).replace(',','.'));
    if(!(n>0))return {error:'Isi angka deadline lebih dari 0, atau pilih "Tanpa deadline".'};
    deadline=n+' '+(mode==='HARI'?'Hari':'Jam');
  }else if(pricelistEditing&&pricelistEditing.DEADLINE&&!/\d/.test(pricelistEditing.DEADLINE)){
    deadline=pricelistEditing.DEADLINE; // pertahankan teks deadline non-angka yang sudah ada
  }
  return {data:{NAMA_PAKET:nama,SATUAN:$('pl-satuan').value,HARGA:harga,DEADLINE:deadline}};
}

async function savePricelist(e){
  e.preventDefault();
  if(pricelistSaving)return;
  const r=pricelistFormData();
  if(r.error)return toast(r.error,false);
  const btn=$('pricelistSaveBtn'),icon=$('pricelistSaveIcon'),txt=$('pricelistSaveText');
  const label=txt.textContent,editing=Boolean(pricelistEditing);
  pricelistSaving=true;
  btn.disabled=true;
  icon.className='fa-solid fa-spinner fa-spin mr-1';
  txt.textContent='Menyimpan...';
  try{
    if(editing)await api('pricelist_update',{NAMA_PAKET_LAMA:pricelistEditing.NAMA_PAKET,...r.data});
    else await api('pricelist_create',r.data);
    await loadPricelist();
    renderPricelist();
    refreshPackageOptions();
    resetPricelistForm();
    toast(editing?'Paket berhasil diperbarui':'Paket berhasil ditambahkan');
  }catch(err){
    toast('Paket gagal disimpan: '+err.message,false);
    txt.textContent=label;
  }finally{
    pricelistSaving=false;
    btn.disabled=false;
    icon.className='fa-solid fa-floppy-disk mr-1';
    if(txt.textContent==='Menyimpan...')txt.textContent=label;
  }
}

async function deletePricelist(name){
  if(!confirm('Hapus paket "'+name+'" dari pricelist?\nOrder lama yang sudah memakai paket ini tidak terpengaruh.'))return;
  try{
    await api('pricelist_delete',{NAMA_PAKET:name});
    if(pricelistEditing&&pricelistEditing.NAMA_PAKET===name)resetPricelistForm();
    await loadPricelist();
    renderPricelist();
    refreshPackageOptions();
    toast('Paket berhasil dihapus');
  }catch(err){
    toast('Paket gagal dihapus: '+err.message,false);
  }
}

/* ---------- impor katalog bawaan (hanya saat table backend kosong) ---------- */

function defaultCatalogPayload(name,it){
  const unitMap={kg:'KG',pcs:'PCS',set:'SET','pcs/set':'PCS',pasang:'PASANG',paket:'PAKET'};
  const harga=it.price==null?'0':(it.maxPrice&&it.maxPrice>it.price?it.price+'-'+it.maxPrice:String(it.price));
  let deadline='Non-Express / Sesuai Layanan';
  if(name==='FLEKSIBEL')deadline='';
  else if(it.duration)deadline=(it.duration>=24&&it.duration%24===0)?(it.duration/24)+' Hari':it.duration+' Jam';
  return {NAMA_PAKET:name,SATUAN:unitMap[it.unit]||'PCS',HARGA:harga,DEADLINE:deadline};
}

async function importPricelistDefaults(){
  const entries=Object.entries(DEFAULT_PACKAGE_CATALOG);
  if(!confirm('Impor '+entries.length+' paket dari katalog bawaan ke pricelist server?'))return;
  const btn=$('pricelistImportBtn'),txt=$('pricelistImportText');
  btn.disabled=true;
  let done=0;
  try{
    for(const [name,it] of entries){
      try{await api('pricelist_create',defaultCatalogPayload(name,it));}
      catch(err){if(!/sudah ada/i.test(err.message))throw err;}
      done++;
      txt.textContent='Mengimpor '+done+'/'+entries.length+'...';
    }
    toast('Katalog bawaan berhasil diimpor');
  }catch(err){
    toast('Impor berhenti di '+done+'/'+entries.length+': '+err.message,false);
  }finally{
    btn.disabled=false;
    txt.textContent='Impor Katalog Bawaan';
    await loadPricelist();
    renderPricelist();
    refreshPackageOptions();
  }
}
