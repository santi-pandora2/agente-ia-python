/**
 * Extractor para listados de Ferricentro (https://ferricentro.com)
 * Solo lectura. Conforme a proceso-extension-ferricentro.txt
 */
function normalizeText(s) {
  if (!s) return '';
  return String(s)
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/\t/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toAbsoluteUrl(url, base) {
  if (!url) return '';
  try {
    const baseUrl = base || window.location.origin;
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return new URL(url).toString();
    }
    if (url.startsWith('//')) return new URL('https:' + url).toString();
    if (url.startsWith('/')) return new URL(url, baseUrl).toString();
    return new URL(url, baseUrl).toString();
  } catch (e) {
    return '';
  }
}

function extractPrice(text) {
  if (!text) return '';
  const norm = normalizeText(text);
  // Buscar cifras con puntos o comas - tomar última ocurrencia (precio actual)
  const all = norm.match(/\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{2})?|\d+(?:[.,]\d{2})/g);
  if (all && all.length > 0) {
    const last = all[all.length - 1];
    const clean = last.replace(/[.,]/g, '');
    if (/^\d+$/.test(clean) && clean.length >= 3) return clean;
  }
  const m2 = norm.match(/(\d[\d\.\,]{3,})/);
  if (m2) {
    const clean = m2[1].replace(/[.,]/g, '');
    if (/^\d+$/.test(clean) && clean.length >= 3) return clean;
  }
  return '';
}

function extractDiscount(text) {
  if (!text) return '';
  const norm = normalizeText(text);
  const m = norm.match(/(\d{1,3})\s*%\s*(OFF|Dto|Descuento|dscto)?/i);
  if (m) {
    const v = parseInt(m[1], 10);
    if (!isNaN(v) && v >= 0 && v <= 999) return String(v);
  }
  return '';
}

function isAuthorizedDomain() {
  const h = window.location.hostname;
  return h === 'ferricentro.com' || h.endsWith('.ferricentro.com');
}

function isProductUrl(href) {
  if (!href) return false;
  const low = href.toLowerCase();
  if (!low.includes('ferricentro.com')) return false;
  if (low.includes('#')) return false;
  if (low.includes('checkout') || low.includes('cart') || low.includes('customer') || low.includes('account')) return false;
  if (low.includes('wishlist') || low.includes('compare')) return false;
  if (low.includes('media/') || low.includes('.jpg') || low.includes('.png') || low.includes('.webp')) return false;
  if (low.match(/\/(combos|ofertas|productos|categorias)?\/?$/)) return false;
  const parts = low.split('ferricentro.com/')[1];
  if (!parts) return false;
  if (parts.startsWith('media/') || parts.startsWith('static/')) return false;
  return parts.length > 1;
}

function findProductItems(container) {
  if (!container) container = document.querySelector('main') || document.body;
  const seen = new Set();
  const items = [];
  const links = container.querySelectorAll('a[href]');
  for (let i = 0; i < links.length; i++) {
    const l = links[i];
    const href = l.getAttribute('href');
    if (!href) continue;
    const abs = toAbsoluteUrl(href);
    if (!isProductUrl(abs)) continue;
    if (seen.has(abs)) continue;
    let card = l.closest('li') || l.closest('article') || l.closest('[class*="product"]') || l.closest('.product-item') || l.parentElement;
    seen.add(abs);
    items.push({ card, link: l, href: abs });
  }
  if (items.length === 0) {
    const cards = container.querySelectorAll('li, article, [class*="product"], .product-item');
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      const l = c.querySelector('a[href]');
      if (!l) continue;
      const abs = toAbsoluteUrl(l.getAttribute('href'));
      if (!isProductUrl(abs)) continue;
      if (seen.has(abs)) continue;
      seen.add(abs);
      items.push({ card: c, link: l, href: abs });
    }
  }
  return items;
}

function extractProducts() {
  const res = { ok: false, compatible: false, count: 0, products: [], warnings: [], errors: [] };
  try {
    if (!isAuthorizedDomain()) { res.errors.push('Dominio no autorizado'); return res; }
    const container = document.querySelector('main') || document.querySelector('.column.main') || document.querySelector('#maincontent') || document.body;
    const items = findProductItems(container);
    if (items.length === 0) {
      res.warnings.push('No se encontraron tarjetas de producto (estructura no reconocida)');
      return res;
    }
    res.compatible = true;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const card = it.card;
      let titulo = '';
      if (it.link) titulo = normalizeText(it.link.textContent);
      if (!titulo) {
        const h = card.querySelector('h2,h3,h4,strong');
        if (h) titulo = normalizeText(h.textContent);
      }
      let imgUrl = '';
      const img = card.querySelector('img');
      if (img) {
        let src = img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('data-lazy') || img.getAttribute('srcset');
        if (src && src.includes(',')) src = src.split(',')[0].trim().split(' ')[0];
        if (!src) src = img.getAttribute('src');
        if (src) imgUrl = toAbsoluteUrl(src);
      }
      let precio = extractPrice(card.textContent);
      let desc = extractDiscount(card.textContent);
      const prod = {
        index: i+1,
        titulo: titulo || '',
        precio_oferta: precio || '',
        descuento_porcentaje: desc || '',
        url_producto: it.href || '',
        imagen_url: imgUrl || ''
      };
      res.products.push(prod);
      if (!prod.titulo) res.warnings.push('P'+(i+1)+': título ambiguo');
      if (!prod.precio_oferta) res.warnings.push('P'+(i+1)+': precio ambiguo');
    }
    res.count = res.products.length;
    res.ok = res.compatible && res.count > 0;
    return res;
  } catch (e) {
    res.errors.push(e.message || e);
    return res;
  }
}
window.extractProducts = extractProducts;
