/**
 * Extractor para listados de Ferricentro (https://ferricentro.com)
 * Solo lectura. Conforme a proceso-extension-ferricentro.txt
 * Estructura observada en https://ferricentro.com/combos (Magento):
 *   - grid:  ol.products.list.items.product-items
 *   - tarjeta: li.item.product.product-item
 *   - título: a.product-item-link
 *   - imagen: img.product-image-photo
 *   - precio: [data-price-type="finalPrice"] (data-price-amount) / .special-price .price
 *   - descuento: .discount_percent
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

function cleanText(el) {
  if (!el) return '';
  const clone = el.cloneNode(true);
  const noise = clone.querySelectorAll
    ? clone.querySelectorAll('style,script,noscript')
    : [];
  for (let i = 0; i < noise.length; i++) noise[i].remove();
  return normalizeText(clone.textContent);
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
  const all = norm.match(/\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{2})?|\d+(?:[.,]\d{2})?/g);
  if (all && all.length > 0) {
    const last = all[all.length - 1];
    const clean = last.replace(/[.,]/g, '');
    if (/^\d+$/.test(clean) && clean.length >= 3) return clean;
  }
  return '';
}

function extractDiscount(text) {
  if (!text) return '';
  const m = normalizeText(text).match(/(\d{1,3})\s*%/);
  if (m) {
    const v = parseInt(m[1], 10);
    if (!isNaN(v) && v >= 0 && v <= 100) return String(v);
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
  if (low.includes('/static/')) return false;
  const parts = low.split('ferricentro.com/')[1];
  if (!parts) return false;
  return parts.length > 1;
}

function findCards() {
  let cards = Array.prototype.slice.call(
    document.querySelectorAll('ol.products.list.items.product-items > li.item.product.product-item, li.item.product.product-item')
  );
  if (cards.length === 0) {
    cards = Array.prototype.slice.call(document.querySelectorAll('li[class*="product-item"], article[class*="product-item"]'));
  }
  if (cards.length === 0) {
    const containers = document.querySelectorAll('.products, [class*="products-grid"], [class*="product-items"]');
    for (let i = 0; i < containers.length; i++) {
      const kids = containers[i].children;
      for (let j = 0; j < kids.length; j++) cards.push(kids[j]);
    }
  }
  return cards;
}

function cardTitle(card, link) {
  let t = link ? cleanText(link) : '';
  if (!t) {
    const h = card.querySelector('h1,h2,h3,h4');
    if (h) t = cleanText(h);
  }
  if (!t) {
    const alt = card.querySelector('img[alt]');
    if (alt) {
      const a = normalizeText(alt.getAttribute('alt'));
      if (a && !/^imagen_/i.test(a)) t = a;
    }
  }
  return t;
}

function cardImage(card) {
  const img = card.querySelector('img.product-image-photo') || card.querySelector('img');
  if (!img) return '';
  let src = img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('data-lazy');
  if (!src) {
    const srcset = img.getAttribute('srcset');
    if (srcset && srcset.trim()) src = srcset.split(',')[0].trim().split(' ')[0];
  }
  if (!src) src = img.getAttribute('src');
  return src ? toAbsoluteUrl(src) : '';
}

function cardPrice(card) {
  const fin = card.querySelector('[data-price-type="finalPrice"]');
  if (fin && fin.getAttribute('data-price-amount')) {
    const amt = String(fin.getAttribute('data-price-amount')).trim();
    if (/^\d+$/.test(amt)) return amt;
  }
  const special = card.querySelector('.special-price .price');
  if (special) {
    const p = extractPrice(special.textContent);
    if (p) return p;
  }
  const prices = card.querySelectorAll('.price-box .price');
  if (prices.length) {
    const p = extractPrice(prices[prices.length - 1].textContent);
    if (p) return p;
  }
  return extractPrice(cleanText(card));
}

function cardDiscount(card) {
  const badge = card.querySelector('.discount_percent, [class*="discount"]');
  if (badge) {
    const d = extractDiscount(badge.textContent);
    if (d) return d;
  }
  return '';
}

function extractProducts() {
  const res = { ok: false, compatible: false, count: 0, products: [], warnings: [], errors: [] };
  try {
    if (!isAuthorizedDomain()) { res.errors.push('Dominio no autorizado'); return res; }
    const cards = findCards();
    if (cards.length === 0) {
      res.warnings.push('No se encontraron tarjetas de producto (estructura no reconocida)');
      return res;
    }
    const seen = new Set();
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      let link = card.querySelector('a.product-item-link');
      if (!link || !isProductUrl(toAbsoluteUrl(link.getAttribute('href')))) {
        const anchors = card.querySelectorAll('a[href]');
        let found = null;
        for (let k = 0; k < anchors.length; k++) {
          if (isProductUrl(toAbsoluteUrl(anchors[k].getAttribute('href')))) { found = anchors[k]; break; }
        }
        if (!found) continue;
        link = found;
      }
      const url = toAbsoluteUrl(link.getAttribute('href'));
      if (seen.has(url)) continue;
      seen.add(url);
      const titulo = cardTitle(card, link);
      const prod = {
        index: seen.size,
        titulo: titulo || '',
        precio_oferta: cardPrice(card) || '',
        descuento_porcentaje: cardDiscount(card) || '',
        url_producto: url || '',
        imagen_url: cardImage(card) || ''
      };
      res.products.push(prod);
      if (!prod.titulo) res.warnings.push('P' + prod.index + ': título ambiguo');
      if (!prod.precio_oferta) res.warnings.push('P' + prod.index + ': precio ambiguo');
    }
    res.count = res.products.length;
    res.compatible = res.count > 0;
    res.ok = res.count > 0;
    if (res.count === 0) res.warnings.push('0 productos encontrados en la primera página visible');
    return res;
  } catch (e) {
    res.errors.push(e.message || e);
    return res;
  }
}

window.extractProducts = extractProducts;
