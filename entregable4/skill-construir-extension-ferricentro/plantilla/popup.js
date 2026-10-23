const btnAnalizar = document.getElementById('btnAnalizar');
const btnDescargar = document.getElementById('btnDescargar');
const estadoEl = document.getElementById('estado');
const cantidadEl = document.getElementById('cantidad');
const paginasEl = document.getElementById('paginas');
const avisosEl = document.getElementById('avisos');
const tbodyPreview = document.getElementById('tbodyPreview');
const paginaActualEl = document.getElementById('paginaActual');
const paginaTotalEl = document.getElementById('paginaTotal');
const btnPrev = document.getElementById('btnPrev');
const btnNext = document.getElementById('btnNext');
const paginasRecorridasEl = document.getElementById('paginasRecorridas');
const PREVIEW_POR_PAGINA = 20;
let datosExtraidos = null;
let paginaPreview = 0;

function setEstado(t){ estadoEl.textContent = t||''; }
function setAvisos(list){
  if(!list||list.length===0){ avisosEl.textContent='Sin avisos.'; return; }
  avisosEl.textContent = list.join('\n');
}
function esc(s){ if(s==null||s===undefined)return''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); }
function csvEscape(f){ if(f==null||f===undefined)return''; const s=String(f); if(s.includes(',')||s.includes('"')||s.includes('\n')||s.includes('\r')) return '"'+s.replace(/"/g,'""')+'"'; return s; }

function renderPreview(products, page){
  const totalPaginas = Math.ceil(products.length / PREVIEW_POR_PAGINA);
  if(totalPaginas === 0) paginaPreview = 0;
  else paginaPreview = Math.max(0, Math.min(page || 0, totalPaginas - 1));
  tbodyPreview.innerHTML='';
  if(totalPaginas === 0){
    paginaActualEl.textContent='0';
    paginaTotalEl.textContent='0';
    btnPrev.disabled=true;
    btnNext.disabled=true;
    return;
  }
  const inicio = paginaPreview * PREVIEW_POR_PAGINA;
  const fin = Math.min(inicio + PREVIEW_POR_PAGINA, products.length);
  for(let i=inicio;i<fin;i++){
    const p=products[i];
    const tr=document.createElement('tr');
    tr.innerHTML='<td>'+esc(p.index)+'</td><td title="'+esc(p.sku)+'">'+esc(p.sku)+'</td><td title="'+esc(p.titulo)+'">'+esc(p.titulo)+'</td><td>'+esc(p.precio_oferta)+'</td><td>'+esc(p.descuento_porcentaje)+'</td><td title="'+esc(p.url_producto)+'">'+esc(p.url_producto)+'</td><td title="'+esc(p.imagen_url)+'">'+esc(p.imagen_url)+'</td>';
    tbodyPreview.appendChild(tr);
  }
  paginaActualEl.textContent=String(paginaPreview+1);
  paginaTotalEl.textContent=String(totalPaginas);
  btnPrev.disabled = paginaPreview <= 0;
  btnNext.disabled = paginaPreview >= totalPaginas - 1;
}

function renderPaginacion(stats){
  paginasRecorridasEl.innerHTML='';
  if(!stats || stats.length===0){
    paginasRecorridasEl.textContent='Sin páginas recorridas.';
    return;
  }
  for(let i=0;i<stats.length;i++){
    const s=stats[i];
    const fila=document.createElement('div');
    fila.className='pagina-item';
    const info=document.createElement('div');
    info.className='pagina-info';
    info.innerHTML='<strong>Página '+esc(s.pagina)+'</strong> <span>'+esc(s.productos)+' productos, '+esc(s.nuevos)+' nuevos</span>';
    const nav=document.createElement('div');
    nav.className='pagina-nav';
    if(s.siguiente){
      const a=document.createElement('a');
      a.href=s.siguiente;
      a.target='_blank';
      a.rel='noopener';
      a.title=s.siguiente;
      a.textContent='Siguiente →';
      nav.appendChild(a);
    }else{
      const ultima=document.createElement('span');
      ultima.className='ultima';
      ultima.textContent='Última página';
      nav.appendChild(ultima);
    }
    fila.appendChild(info);
    fila.appendChild(nav);
    paginasRecorridasEl.appendChild(fila);
  }
}

function buildInventoryFiles(products, fuente, fecha, proveedor){
  const prov = proveedor || 'Ferricentro';
  const catalogoHeaders=['proveedor','sku','nombre','precio_cop','inventario','activo','url_producto','imagen_url','descuento_porcentaje','fecha_consulta','fuente_url'];
  const posHeaders=['sku','nombre','precio_cop','inventario','activo','accion','proveedor','url_producto'];
  const excHeaders=['sku','nombre','precio_cop','motivo','url_producto','fuente_url'];
  const catalogo=[catalogoHeaders.join(',')];
  const pos=[posHeaders.join(',')];
  const excepciones=[excHeaders.join(',')];
  const skuCounts={};
  const skus=[];
  for(let i=0;i<products.length;i++){
    const sku=String(products[i].sku||'').trim();
    skus.push(sku);
    if(sku) skuCounts[sku]=(skuCounts[sku]||0)+1;
  }
  for(let i=0;i<products.length;i++){
    const p=products[i];
    const sku=skus[i];
    const nombre=String(p.titulo||'').trim();
    const precio=String(p.precio_oferta||'').trim();
    const url=String(p.url_producto||'').trim();
    const imagen=String(p.imagen_url||'').trim();
    const descuento=String(p.descuento_porcentaje||'').trim();
    catalogo.push([csvEscape(prov),csvEscape(sku),csvEscape(nombre),csvEscape(precio),'', 'true',csvEscape(url),csvEscape(imagen),csvEscape(descuento),csvEscape(fecha),csvEscape(fuente)].join(','));
    const motivos=[];
    if(!sku) motivos.push('SKU faltante');
    if(!nombre) motivos.push('nombre faltante');
    if(!precio) motivos.push('precio faltante');
    else if(!/^\d+$/.test(precio)) motivos.push('precio no numérico');
    else if(parseInt(precio,10)<=0) motivos.push('precio no positivo');
    if(sku && skuCounts[sku]>1) motivos.push('SKU duplicado ('+skuCounts[sku]+' veces)');
    if(motivos.length){
      excepciones.push([csvEscape(sku),csvEscape(nombre),csvEscape(precio),csvEscape(motivos.join('; ')),csvEscape(url),csvEscape(fuente)].join(','));
    }else{
      pos.push([csvEscape(sku),csvEscape(nombre),csvEscape(precio),'','true','UPSERT',csvEscape(prov),csvEscape(url)].join(','));
    }
  }
  return {
    catalogo: catalogo.join('\r\n')+'\r\n',
    actualizacion: pos.join('\r\n')+'\r\n',
    excepciones: excepciones.join('\r\n')+'\r\n',
    counts:{catalogo:catalogo.length-1, actualizacion:pos.length-1, excepciones:excepciones.length-1}
  };
}
window.buildInventoryFiles = buildInventoryFiles;

async function descargar(nombre, texto, saveAs){
  const blob=new Blob([texto],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  await chrome.downloads.download({url, filename:nombre, saveAs:!!saveAs, conflictAction:'overwrite'});
  setTimeout(()=>URL.revokeObjectURL(url), 60000);
}

btnAnalizar.addEventListener('click', async ()=>{
  setEstado('Analizando listado completo... acción explícita');
  setAvisos([]); tbodyPreview.innerHTML=''; cantidadEl.textContent='0'; paginasEl.textContent='0'; btnDescargar.disabled=true; datosExtraidos=null;
  renderPreview([],0); renderPaginacion([]);
  try{
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
    if(!tab||!tab.id){ setEstado('Error: pestaña activa'); return; }
    const urlTab = tab.url||'';
    let host;
    try{ host=new URL(urlTab).hostname; }catch(e){ host=''; }
    if(!(host==='ferricentro.com'||host.endsWith('.ferricentro.com'))){ setEstado('Dominio no autorizado (*.ferricentro.com)'); return; }
    await chrome.scripting.executeScript({target:{tabId:tab.id}, files:['extractor.js']});
    const res = await chrome.scripting.executeScript({target:{tabId:tab.id}, func:()=>window.extractProductsAll(500)});
    const r = res&&res[0]&&res[0].result;
    if(!r){ setEstado('Sin resultados'); return; }
    const warns=[];
    if(r.errors&&r.errors.length) warns.push(...r.errors);
    if(r.warnings&&r.warnings.length) warns.push(...r.warnings);
    if(r.totalDeclared!=null && r.count!==r.totalDeclared) warns.push('Declarados por la categoría: '+r.totalDeclared);
    datosExtraidos={products:r.products||[], fuenteUrl:urlTab, pages:r.pages||0, totalDeclared:r.totalDeclared, pageStats:r.pageStats||[]};
    cantidadEl.textContent=String(r.count||0);
    paginasEl.textContent=String(r.pages||0);
    renderPreview(datosExtraidos.products,0);
    renderPaginacion(datosExtraidos.pageStats);
    setAvisos(warns);
    if(r.ok&&r.count>0){ setEstado('Listo. '+r.count+' productos en '+r.pages+' página(s). Revisar vista previa'); btnDescargar.disabled=false; }
    else if(r.count===0){ setEstado('0 productos. Página no compatible o sin visibles'); }
    else if(!r.compatible){ setEstado('Página no compatible. No exportar incompletos'); }
    else{ setEstado('Con advertencias. Revisar avisos antes de descargar'); btnDescargar.disabled=false; }
  }catch(e){ setEstado('Error: '+(e.message||e)); }
});

btnPrev.addEventListener('click', ()=>{
  if(datosExtraidos && datosExtraidos.products.length) renderPreview(datosExtraidos.products, paginaPreview-1);
});

btnNext.addEventListener('click', ()=>{
  if(datosExtraidos && datosExtraidos.products.length) renderPreview(datosExtraidos.products, paginaPreview+1);
});

btnDescargar.addEventListener('click', async ()=>{
  if(!datosExtraidos||!datosExtraidos.products.length) return;
  btnDescargar.disabled=true;
  try{
    const fuente = datosExtraidos.fuenteUrl||'';
    const fecha = new Date().toISOString();
    const files = buildInventoryFiles(datosExtraidos.products, fuente, fecha, 'Ferricentro');
    await descargar('catalogo_proveedor.csv', files.catalogo, false);
    await descargar('actualizacion_pos.csv', files.actualizacion, false);
    await descargar('excepciones.csv', files.excepciones, false);
    setEstado('Descargados: catalogo_proveedor.csv, actualizacion_pos.csv y excepciones.csv ('+files.counts.catalogo+' catálogo, '+files.counts.actualizacion+' POS, '+files.counts.excepciones+' excepciones)');
    btnDescargar.disabled=false;
  }catch(e){ setEstado('Error descarga: '+(e.message||e)); btnDescargar.disabled=false; }
});
