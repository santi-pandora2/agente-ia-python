const btnAnalizar = document.getElementById('btnAnalizar');
const btnDescargar = document.getElementById('btnDescargar');
const estadoEl = document.getElementById('estado');
const cantidadEl = document.getElementById('cantidad');
const avisosEl = document.getElementById('avisos');
const tbodyPreview = document.getElementById('tbodyPreview');
let datosExtraidos = null;

function setEstado(t){ estadoEl.textContent = t||''; }
function setAvisos(list){
  if(!list||list.length===0){ avisosEl.textContent='Sin avisos.'; return; }
  avisosEl.textContent = list.join('\n');
}
function esc(s){ if(s==null||s===undefined)return''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); }
function csvEscape(f){ if(f==null||f===undefined)return''; const s=String(f); if(s.includes(',')||s.includes('"')||s.includes('\n')||s.includes('\r')) return '"'+s.replace(/"/g,'""')+'"'; return s; }

function renderPreview(products){
  tbodyPreview.innerHTML='';
  const lim = Math.min(products.length,20);
  for(let i=0;i<lim;i++){
    const p=products[i];
    const tr=document.createElement('tr');
    tr.innerHTML='<td>'+esc(p.index)+'</td><td title="'+esc(p.titulo)+'">'+esc(p.titulo)+'</td><td>'+esc(p.precio_oferta)+'</td><td>'+esc(p.descuento_porcentaje)+'</td><td title="'+esc(p.url_producto)+'">'+esc(p.url_producto)+'</td><td title="'+esc(p.imagen_url)+'">'+esc(p.imagen_url)+'</td>';
    tbodyPreview.appendChild(tr);
  }
}

btnAnalizar.addEventListener('click', async ()=>{
  setEstado('Analizando... acción explícita');
  setAvisos([]); tbodyPreview.innerHTML=''; cantidadEl.textContent='0'; btnDescargar.disabled=true; datosExtraidos=null;
  try{
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
    if(!tab||!tab.id){ setEstado('Error: pestaña activa'); return; }
    const urlTab = tab.url||'';
    let host;
    try{ host=new URL(urlTab).hostname; }catch(e){ host=''; }
    if(!(host==='ferricentro.com'||host.endsWith('.ferricentro.com'))){ setEstado('Dominio no autorizado (*.ferricentro.com)'); return; }
    await chrome.scripting.executeScript({target:{tabId:tab.id}, files:['extractor.js']});
    const res = await chrome.scripting.executeScript({target:{tabId:tab.id}, func:()=>window.extractProducts()});
    const r = res&&res[0]&&res[0].result;
    if(!r){ setEstado('Sin resultados'); return; }
    const warns=[];
    if(r.errors&&r.errors.length) warns.push(...r.errors);
    if(r.warnings&&r.warnings.length) warns.push(...r.warnings);
    datosExtraidos={products:r.products||[], fuenteUrl:urlTab};
    cantidadEl.textContent=String(r.count||0);
    renderPreview(datosExtraidos.products);
    setAvisos(warns);
    if(r.ok&&r.count>0){ setEstado('Listo. Revisar vista previa'); btnDescargar.disabled=false; }
    else if(r.count===0){ setEstado('0 productos. Página no compatible o sin visibles'); }
    else if(!r.compatible){ setEstado('Página no compatible. No exportar incompletos'); }
    else{ setEstado('Con advertencias'); }
  }catch(e){ setEstado('Error: '+(e.message||e)); }
});

btnDescargar.addEventListener('click', async ()=>{
  if(!datosExtraidos||!datosExtraidos.products.length) return;
  try{
    const fuente = datosExtraidos.fuenteUrl||'';
    const fecha = new Date().toISOString();
    const headers=['titulo','precio_oferta','descuento_porcentaje','url_producto','imagen_url','fecha_consulta','fuente_url'];
    const lines=[headers.join(',')];
    for(let i=0;i<datosExtraidos.products.length;i++){
      const p=datosExtraidos.products[i];
      lines.push([csvEscape(p.titulo),csvEscape(p.precio_oferta),csvEscape(p.descuento_porcentaje),csvEscape(p.url_producto),csvEscape(p.imagen_url),csvEscape(fecha),csvEscape(fuente)].join(','));
    }
    const blob=new Blob([lines.join('\r\n')+'\r\n'],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const ts=new Date().toISOString().replace(/[:.]/g,'-');
    await chrome.downloads.download({url, filename:'ferricentro_productos_'+ts+'.csv', saveAs:true});
    URL.revokeObjectURL(url); setEstado('CSV descargado');
  }catch(e){ setEstado('Error descarga: '+(e.message||e)); }
});
