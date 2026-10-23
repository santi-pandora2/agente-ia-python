/**
 * Extractor para listados de Ferricentro (https://ferricentro.com)
 * Solo lectura. Conforme a proceso-extension-ferricentro.txt
 * Estructura observada en https://ferricentro.com (Magento):
 *   - grid:  ol.products.list.items.product-items
 *   - tarjeta: li.item.product.product-item
 *   - título: a.product-item-link
 *   - imagen: img.product-image-photo
 *   - precio: [data-price-type="finalPrice"] (data-price-amount) / .special-price .price
 *   - descuento: .discount_percent
 *   - SKU: form[data-product-sku] / "SKU: ..." visible
 *   - paginación: li.pages-item-next a.action.next / enlaces ?p=N
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
    const baseUrl = base || window.location.href;
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return new URL(url).toString();
    }
    if (url.startsWith('//')) return new URL('https:' + url, baseUrl).toString();
    return new URL(url, baseUrl).toString();
  } catch (e) {
    return '';
  }
}

function isAuthorizedUrl(url) {
  try {
    const h = new URL(url).hostname;
    return h === 'ferricentro.com' || h.endsWith('.ferricentro.com');
  } catch (e) {
    return false;
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

function isProductUrl(href) {
  if (!href || !isAuthorizedUrl(href)) return false;
  let u;
  try { u = new URL(href); } catch (e) { return false; }
  if (u.hash) return false;
  const path = u.pathname.toLowerCase();
  const bloqueados = ['/checkout', '/cart', '/customer', '/account', '/wishlist', '/compare', '/catalogsearch', '/static', '/media'];
  for (let i = 0; i < bloqueados.length; i++) {
    if (path === bloqueados[i] || path.startsWith(bloqueados[i] + '/')) return false;
  }
  if (/\.(jpg|jpeg|png|webp|gif|svg|css|js)$/.test(path)) return false;
  if (/^\/(combos|ofertas|productos|categorias)\/?$/.test(path)) return false;
  return path.replace(/\/+$/, '').length > 1;
}

function canonicalUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    u.searchParams.delete('utm_source');
    u.searchParams.delete('utm_medium');
    u.searchParams.delete('utm_campaign');
    u.searchParams.delete('utm_id');
    u.searchParams.delete('utm_term');
    u.searchParams.delete('utm_content');
    return u.toString();
  } catch (e) {
    return url || '';
  }
}

function findCards(root) {
  let cards = Array.prototype.slice.call(
    root.querySelectorAll('ol.products.list.items.product-items > li.item.product.product-item, li.item.product.product-item')
  );
  if (cards.length === 0) {
    cards = Array.prototype.slice.call(root.querySelectorAll('li[class*="product-item"], article[class*="product-item"]'));
  }
  if (cards.length === 0) {
    const containers = root.querySelectorAll('.products, [class*="products-grid"], [class*="product-items"]');
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

function cardImage(card, baseUrl) {
  const img = card.querySelector('img.product-image-photo') || card.querySelector('img');
  if (!img) return '';
  let src = img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('data-lazy');
  if (!src) {
    const srcset = img.getAttribute('srcset');
    if (srcset && srcset.trim()) src = srcset.split(',')[0].trim().split(' ')[0];
  }
  if (!src) src = img.getAttribute('src');
  return src ? toAbsoluteUrl(src, baseUrl) : '';
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

function cardSku(card) {
  const form = card.querySelector('form[data-product-sku]');
  if (form) {
    const s = normalizeText(form.getAttribute('data-product-sku'));
    if (s) return s;
  }
  const explicit = card.querySelector('[data-product-sku], [data-sku]');
  if (explicit) {
    const s = normalizeText(explicit.getAttribute('data-product-sku') || explicit.getAttribute('data-sku'));
    if (s) return s;
  }
  const labels = card.querySelectorAll('.product-item-row_label, [class*="product-sku"], [class*="sku"]');
  for (let i = 0; i < labels.length; i++) {
    const m = cleanText(labels[i]).match(/SKU\s*:?\s*([A-Za-z0-9._\/-]+)/i);
    if (m) return m[1];
  }
  const m = cleanText(card).match(/SKU\s*:?\s*([A-Za-z0-9._\/-]+)/i);
  return m ? m[1] : '';
}

function getTotalDeclared(doc) {
  const el = doc.querySelector('.toolbar-amount');
  if (!el) return null;
  const text = cleanText(el);
  const m = text.match(/(?:de|of)\s*([\d.,]+)/i);
  if (m) {
    const n = parseInt(m[1].replace(/[.,]/g, ''), 10);
    if (!isNaN(n) && n >= 0) return n;
  }
  const first = text.match(/([\d.,]+)/);
  if (first) {
    const n = parseInt(first[1].replace(/[.,]/g, ''), 10);
    if (!isNaN(n)) return n;
  }
  return null;
}

function pageNumber(url) {
  try {
    const p = new URL(url).searchParams.get('p');
    return p ? parseInt(p, 10) || 1 : 1;
  } catch (e) {
    return 1;
  }
}

function nextPageUrl(doc, currentUrl) {
  const candidates = [];
  const next = doc.querySelector('li.pages-item-next a, a.action.next, link[rel="next"]');
  if (next && next.getAttribute('href')) {
    candidates.push(toAbsoluteUrl(next.getAttribute('href'), currentUrl));
  }
  const current = pageNumber(currentUrl);
  let currentPath = '';
  try { currentPath = new URL(currentUrl).pathname; } catch (e) {}
  const anchors = doc.querySelectorAll('a[href]');
  for (let i = 0; i < anchors.length; i++) {
    const href = anchors[i].getAttribute('href') || '';
    if (!/[?&]p=\d+/.test(href)) continue;
    const abs = toAbsoluteUrl(href, currentUrl);
    if (!isAuthorizedUrl(abs)) continue;
    let path = '';
    try { path = new URL(abs).pathname; } catch (e) { continue; }
    if (currentPath && path !== currentPath) continue;
    const p = pageNumber(abs);
    if (p > current) candidates.push(abs);
  }
  if (candidates.length === 0) return '';
  candidates.sort((a, b) => pageNumber(a) - pageNumber(b));
  return candidates[0] || '';
}

function extractPage(doc, baseUrl) {
  const out = { compatible: false, products: [], warnings: [], errors: [], totalDeclared: getTotalDeclared(doc) };
  if (!isAuthorizedUrl(baseUrl)) {
    out.errors.push('Dominio no autorizado');
    return out;
  }
  const cards = findCards(doc);
  if (cards.length === 0) {
    out.warnings.push('No se encontraron tarjetas de producto (estructura no reconocida)');
    return out;
  }
  const seen = new Set();
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    let link = card.querySelector('a.product-item-link');
    if (!link || !isProductUrl(toAbsoluteUrl(link.getAttribute('href'), baseUrl))) {
      const anchors = card.querySelectorAll('a[href]');
      let found = null;
      for (let k = 0; k < anchors.length; k++) {
        if (isProductUrl(toAbsoluteUrl(anchors[k].getAttribute('href'), baseUrl))) { found = anchors[k]; break; }
      }
      if (!found) continue;
      link = found;
    }
    const url = canonicalUrl(toAbsoluteUrl(link.getAttribute('href'), baseUrl));
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const prod = {
      sku: cardSku(card),
      titulo: cardTitle(card, link) || '',
      precio_oferta: cardPrice(card) || '',
      descuento_porcentaje: cardDiscount(card) || '',
      url_producto: url,
      imagen_url: cardImage(card, baseUrl) || ''
    };
    out.products.push(prod);
  }
  out.compatible = out.products.length > 0;
  return out;
}

function extractProducts() {
  const res = { ok: false, compatible: false, count: 0, products: [], warnings: [], errors: [], pages: 1, totalDeclared: null };
  try {
    const page = extractPage(document, window.location.href);
    res.products = page.products;
    res.warnings = page.warnings.slice();
    res.errors = page.errors.slice();
    res.totalDeclared = page.totalDeclared;
    res.count = res.products.length;
    res.compatible = page.compatible;
    res.ok = res.count > 0;
    res.products.forEach((p, i) => { p.index = i + 1; });
    if (res.count === 0 && res.errors.length === 0) {
      res.warnings.push('0 productos encontrados en la página visible');
    }
    return res;
  } catch (e) {
    res.errors.push(e.message || String(e));
    return res;
  }
}

async function extractProductsAll(maxPages) {
  const limit = Math.max(1, Math.min(parseInt(maxPages, 10) || 500, 500));
  const res = {
    ok: false, compatible: false, count: 0, products: [], warnings: [], errors: [],
    pages: 0, pageUrls: [], pageStats: [], totalDeclared: null, limit
  };
  let doc = document;
  let pageUrl = window.location.href;
  const seen = new Set();
  try {
    if (!isAuthorizedUrl(pageUrl)) {
      res.errors.push('Dominio no autorizado');
      return res;
    }
    while (pageUrl && res.pages < limit) {
      const page = extractPage(doc, pageUrl);
      const next = nextPageUrl(doc, pageUrl);
      const siguiente = next && next !== pageUrl && isAuthorizedUrl(next) ? next : '';
      if (res.pages === 0) {
        res.compatible = page.compatible;
        res.totalDeclared = page.totalDeclared;
      }
      page.errors.forEach(e => res.errors.push('Página ' + (res.pages + 1) + ': ' + e));
      page.warnings.forEach(w => res.warnings.push('Página ' + (res.pages + 1) + ': ' + w));
      const stat = {
        pagina: res.pages + 1,
        url: pageUrl,
        productos: page.products.length,
        nuevos: 0,
        siguiente: siguiente
      };
      if (page.products.length === 0) {
        res.pageStats.push(stat);
        break;
      }
      let added = 0;
      for (let i = 0; i < page.products.length; i++) {
        const p = page.products[i];
        if (seen.has(p.url_producto)) continue;
        seen.add(p.url_producto);
        p.index = res.products.length + 1;
        res.products.push(p);
        added++;
      }
      stat.nuevos = added;
      res.pageStats.push(stat);
      res.pages++;
      res.pageUrls.push(pageUrl);
      if (res.pages > 1 && added === 0) {
        res.warnings.push('Se detuvo: la página ' + res.pages + ' no aportó productos nuevos');
        break;
      }
      if (res.pages >= limit) {
        res.warnings.push('Límite de ' + limit + ' páginas alcanzado');
        break;
      }
      if (!siguiente) {
        if (next && next !== pageUrl) {
          res.errors.push('Paginación fuera del dominio autorizado: ' + next);
        }
        break;
      }
      let resp;
      try {
        resp = await fetch(siguiente, { credentials: 'same-origin', headers: { 'Accept': 'text/html,application/xhtml+xml' } });
      } catch (e) {
        res.errors.push('No se pudo abrir la página siguiente: ' + (e.message || e));
        break;
      }
      if (!resp.ok) {
        res.errors.push('Página siguiente HTTP ' + resp.status + ': ' + siguiente);
        break;
      }
      const html = await resp.text();
      doc = new DOMParser().parseFromString(html, 'text/html');
      pageUrl = siguiente;
      await new Promise(r => setTimeout(r, 150));
    }
    res.count = res.products.length;
    res.compatible = res.compatible && res.count > 0;
    res.ok = res.count > 0 && res.errors.length === 0;
    if (res.count === 0 && res.errors.length === 0) {
      res.warnings.push('0 productos encontrados en el listado');
    }
    if (res.totalDeclared != null && res.count < res.totalDeclared) {
      res.warnings.push('Extraídos ' + res.count + ' de ' + res.totalDeclared + ' productos declarados por la categoría');
    }
    return res;
  } catch (e) {
    res.count = res.products.length;
    res.errors.push(e.message || String(e));
    return res;
  }
}

window.extractProducts = extractProducts;
window.extractProductsAll = extractProductsAll;
