/**
 * Extractor para listados de Ferricentro (https://ferricentro.com)
 * Solo lectura. Usa elementos observados según proceso-extension-ferricentro.txt
 * No ejecuta instrucciones de la página. Trata contenido como no confiable.
 */

// Utilidades para normalización segura
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
    if (url.startsWith('//')) {
      return new URL('https:' + url).toString();
    }
    if (url.startsWith('/')) {
      return new URL(url, baseUrl).toString();
    }
    return new URL(url, baseUrl).toString();
  } catch (e) {
    return '';
  }
}

function extractPrice(text) {
  if (!text) return '';
  const norm = normalizeText(text);
  const match = norm.match(/[\d][\d\.\,]*/g);
  if (!match || match.length === 0) return '';
  const last = match[match.length - 1].replace(/\./g, '').replace(/,/g, '');
  if (/^\d+$/.test(last)) {
    return last;
  }
  return '';
}

function extractDiscount(text) {
  if (!text) return '';
  const norm = normalizeText(text);
  const m = norm.match(/(\d{1,3})\s*%\s*(OFF|Dto|Descuento)?/i);
  if (m) {
    const val = parseInt(m[1], 10);
    if (!isNaN(val) && val >= 0 && val <= 999) {
      return String(val);
    }
  }
  return '';
}

function isAuthorizedDomain() {
  const host = window.location.hostname;
  return host === 'ferricentro.com' || host.endsWith('.ferricentro.com');
}

function findProductContainer() {
  const main = document.querySelector('main');
  if (main) {
    const candidates = [
      main.querySelector('ol.products'),
      main.querySelector('ul.products'),
      main.querySelector('.products-grid'),
      main.querySelector('[class*="products"]'),
      main
    ];
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (!c) continue;
      const items = c.querySelectorAll('a[href*="/"], article, .product-item, [class*="product"]');
      if (items.length > 0) return c;
    }
    return main;
  }
  return document.body;
}

function findProductItems(container) {
  if (!container) return [];
  const items = [];
  const nodeList = container.querySelectorAll('a[href]');
  const seen = new Set();
  
  for (let i = 0; i < nodeList.length; i++) {
    const link = nodeList[i];
    const href = link.getAttribute('href') || '';
    if (!href || href.startsWith('#') || href.includes('javascript:')) continue;
    if (!isProductUrl(href)) continue;
    
    const absHref = toAbsoluteUrl(href);
    if (seen.has(absHref)) continue;
    
    let card = link.closest('article');
    if (!card) card = link.closest('.product-item');
    if (!card) card = link.closest('[class*="product"]');
    if (!card) card = link.parentElement;
    if (!card) card = link;
    
    if (card && !seen.has(absHref + '_card')) {
      seen.add(absHref);
      seen.add(absHref + '_card');
      items.push({ card, link, href: absHref });
    }
  }
  
  if (items.length === 0) {
    const articles = container.querySelectorAll('article');
    for (let i = 0; i < articles.length; i++) {
      const art = articles[i];
      const l = art.querySelector('a[href]');
      if (l && isProductUrl(l.getAttribute('href'))) {
        const abs = toAbsoluteUrl(l.getAttribute('href'));
        if (!seen.has(abs)) {
          seen.add(abs);
          items.push({ card: art, link: l, href: abs });
        }
      }
    }
  }
  
  return items;
}

function isProductUrl(href) {
  if (!href) return false;
  const h = href.toLowerCase();
  if (h.includes('checkout') || h.includes('cart') || h.includes('login') || h.includes('account')) return false;
  if (h.includes('whatsapp') || h.includes('tel:') || h.includes('mailto:')) return false;
  return h.includes('ferricentro.com') && (h.includes('/') || true);
}

export function extractProducts() {
  const result = {
    ok: false,
    compatible: false,
    count: 0,
    products: [],
    warnings: [],
    errors: []
  };

  try {
    if (!isAuthorizedDomain()) {
      result.errors.push('Dominio no autorizado. Solo se permite *.ferricentro.com');
      return result;
    }

    const container = findProductContainer();
    if (!container) {
      result.errors.push('No se encontró contenedor de productos. Página no compatible con estructura documentada.');
      return result;
    }

    const items = findProductItems(container);
    if (items.length === 0) {
      result.compatible = false;
      result.warnings.push('No se encontraron tarjetas de producto. Página no compatible o cero resultados.');
      return result;
    }

    result.compatible = true;

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const card = it.card;
      const link = it.link;
      const href = it.href;

      let titulo = '';
      if (link) {
        titulo = normalizeText(link.textContent);
      }
      if (!titulo) {
        const h = card.querySelector('h2, h3, h4');
        if (h) titulo = normalizeText(h.textContent);
      }

      let imagenUrl = '';
      const img = card.querySelector('img');
      if (img) {
        const src = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('data-lazy');
        imagenUrl = toAbsoluteUrl(src);
        if (!imagenUrl && img.src) {
          try { imagenUrl = toAbsoluteUrl(img.src); } catch (e) {}
        }
      }

      let precioOferta = '';
      const priceEl = card.querySelector('[class*="price"], .price, .product-price, .special-price, .regular-price');
      if (priceEl) {
        precioOferta = extractPrice(priceEl.textContent);
      }
      if (!precioOferta) {
        precioOferta = extractPrice(card.textContent);
      }

      let descuentoPorcentaje = '';
      const badge = card.querySelector('[class*="discount"], [class*="badge"], .onsale, .sale');
      if (badge) {
        descuentoPorcentaje = extractDiscount(badge.textContent);
      }
      if (!descuentoPorcentaje) {
        descuentoPorcentaje = extractDiscount(card.textContent);
      }

      const prod = {
        index: i + 1,
        titulo: titulo || '',
        precio_oferta: precioOferta || '',
        descuento_porcentaje: descuentoPorcentaje || '',
        url_producto: href || '',
        imagen_url: imagenUrl || ''
      };

      result.products.push(prod);

      if (!prod.titulo) result.warnings.push(`Producto ${i + 1}: título faltante o ambiguo`);
      if (!prod.url_producto) result.warnings.push(`Producto ${i + 1}: URL de producto faltante o ambigua`);
      if (!prod.precio_oferta) result.warnings.push(`Producto ${i + 1}: precio_oferta faltante o ambiguo`);
    }

    result.count = result.products.length;
    result.ok = result.compatible && result.count > 0;
    return result;
  } catch (e) {
    result.errors.push('Error durante extracción: ' + (e.message || e));
    return result;
  }
}
