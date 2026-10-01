import { extractProducts } from './extractor.js';

const btnAnalizar = document.getElementById('btnAnalizar');
const btnDescargar = document.getElementById('btnDescargar');
const estadoEl = document.getElementById('estado');
const cantidadEl = document.getElementById('cantidad');
const avisosEl = document.getElementById('avisos');
const tbodyPreview = document.getElementById('tbodyPreview');

let datosExtraidos = null;

function setEstado(text) {
  estadoEl.textContent = text || '';
}

function setAvisos(list) {
  if (!list || list.length === 0) {
    avisosEl.textContent = 'Sin avisos.';
    return;
  }
  avisosEl.textContent = list.join('\n');
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderPreview(products) {
  tbodyPreview.innerHTML = '';
  const limit = Math.min(products.length, 20);
  for (let i = 0; i < limit; i++) {
    const p = products[i];
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(p.index)}</td>
      <td title="${escapeHtml(p.titulo)}">${escapeHtml(p.titulo)}</td>
      <td>${escapeHtml(p.precio_oferta)}</td>
      <td>${escapeHtml(p.descuento_porcentaje)}</td>
      <td title="${escapeHtml(p.url_producto)}">${escapeHtml(p.url_producto)}</td>
      <td title="${escapeHtml(p.imagen_url)}">${escapeHtml(p.imagen_url)}</td>
    `;
    tbodyPreview.appendChild(tr);
  }
}

function csvEscapeField(field) {
  if (field === null || field === undefined) return '';
  const s = String(field);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function generarCSV(products) {
  const headers = [
    'titulo',
    'precio_oferta',
    'descuento_porcentaje',
    'url_producto',
    'imagen_url',
    'fecha_consulta',
    'fuente_url'
  ];
  
  const fechaConsulta = new Date().toISOString();
  let fuenteUrl = '';
  if (chrome && chrome.tabs && chrome.tabs.query) {
    // se obtiene en contexto popup; pero fallback
  }
  
  const lines = [];
  lines.push(headers.join(','));
  
  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    const row = [
      csvEscapeField(p.titulo),
      csvEscapeField(p.precio_oferta),
      csvEscapeField(p.descuento_porcentaje),
      csvEscapeField(p.url_producto),
      csvEscapeField(p.imagen_url),
      csvEscapeField(fechaConsulta),
      csvEscapeField(fuenteUrl || (window && window.location ? window.location.href : ''))
    ];
    lines.push(row.join(','));
  }
  
  return lines.join('\r\n');
}

async function obtenerFuenteUrl() {
  try {
    if (chrome.tabs) {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs && tabs[0] && tabs[0].url) return tabs[0].url;
    }
  } catch (e) {}
  return '';
}

btnAnalizar.addEventListener('click', async () => {
  setEstado('Iniciando análisis... (acción explícita)');
  setAvisos([]);
  tbodyPreview.innerHTML = '';
  cantidadEl.textContent = '0';
  btnDescargar.disabled = true;
  datosExtraidos = null;
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      setEstado('Error: No se pudo obtener la pestaña activa');
      return;
    }
    
    const fuenteUrl = tab.url || '';
    const host = new URL(fuenteUrl).hostname;
    if (!(host === 'ferricentro.com' || host.endsWith('.ferricentro.com'))) {
      setEstado('Error: Dominio no autorizado. Solo *.ferricentro.com');
      return;
    }
    
    setEstado('Ejecutando extractor en página actual...');
    
    const injectionResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['extractor.js']
    });
    
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        if (typeof extractProducts === 'function') {
          return extractProducts();
        }
        return { ok: false, errors: ['extractor.js no cargado correctamente'] };
      }
    });
    
    const res = results && results[0] && results[0].result;
    if (!res) {
      setEstado('Error: No se obtuvieron resultados de la extracción');
      return;
    }
    
    const allWarnings = [];
    if (res.errors && res.errors.length > 0) {
      allWarnings.push(...res.errors);
    }
    if (res.warnings && res.warnings.length > 0) {
      allWarnings.push(...res.warnings);
    }
    
    datosExtraidos = {
      products: res.products || [],
      fuenteUrl: fuenteUrl
    };
    
    cantidadEl.textContent = String(res.count || 0);
    renderPreview(datosExtraidos.products);
    setAvisos(allWarnings);
    
    if (res.ok && res.count > 0) {
      setEstado('Extracción completada. Revisar vista previa antes de descargar.');
      btnDescargar.disabled = false;
    } else if (res.count === 0) {
      setEstado('Cero resultados encontrados. Página no compatible o sin productos visibles.');
      btnDescargar.disabled = true;
    } else if (!res.compatible) {
      setEstado('Página no compatible con estructura documentada. No exportar datos incompletos.');
      btnDescargar.disabled = true;
    } else {
      setEstado('Extracción con advertencias. Revisar avisos.');
      btnDescargar.disabled = true;
    }
  } catch (e) {
    setEstado('Error: ' + (e.message || e));
    setAvisos(['Verifique que la pestaña esté activa y en dominio autorizado *.ferricentro.com']);
  }
});

btnDescargar.addEventListener('click', async () => {
  if (!datosExtraidos || !datosExtraidos.products || datosExtraidos.products.length === 0) {
    return;
  }
  
  try {
    const fuenteUrlFinal = datosExtraidos.fuenteUrl || await obtenerFuenteUrl();
    const fechaConsulta = new Date().toISOString();
    const headers = [
      'titulo',
      'precio_oferta',
      'descuento_porcentaje',
      'url_producto',
      'imagen_url',
      'fecha_consulta',
      'fuente_url'
    ];
    
    const lines = [];
    lines.push(headers.join(','));
    for (let i = 0; i < datosExtraidos.products.length; i++) {
      const p = datosExtraidos.products[i];
      const row = [
        csvEscapeField(p.titulo),
        csvEscapeField(p.precio_oferta),
        csvEscapeField(p.descuento_porcentaje),
        csvEscapeField(p.url_producto),
        csvEscapeField(p.imagen_url),
        csvEscapeField(fechaConsulta),
        csvEscapeField(fuenteUrlFinal)
      ];
      lines.push(row.join(','));
    }
    const csvContent = lines.join('\r\n') + '\r\n';
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `ferricentro_productos_${ts}.csv`;
    
    await chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: true
    });
    
    URL.revokeObjectURL(url);
    setEstado('CSV descargado correctamente.');
  } catch (e) {
    setEstado('Error al descargar CSV: ' + (e.message || e));
  }
});

function csvEscapeField(field) {
  if (field === null || field === undefined) return '';
  const s = String(field);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
