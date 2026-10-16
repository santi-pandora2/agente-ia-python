#!/usr/bin/env python3
"""Ejecuta la extracción con la extensión cargada (usa chrome.scripting +
chrome.downloads reales desde el contexto de la extensión, sin clics manuales).

Flujo:
 1. Localiza/abre la pestaña de la URL autorizada y la deja activa.
 2. Abre popup.html en una pestaña en segundo plano (contexto de la extensión).
 3. Desde ahí llama a chrome.tabs + chrome.scripting + chrome.downloads.
 4. Descarga el CSV (sin diálogo) y lo reporta.
"""
import argparse
import asyncio
import json
import urllib.request

import websockets

EVALUAR = r"""
(async () => {
  const esperada = __URL__;
  const tabs = await chrome.tabs.query({});
  const tab = tabs.find(t => t.url && t.url.startsWith(esperada))
            || tabs.find(t => t.url && (t.url.startsWith('https://ferricentro.com') || t.url.startsWith('http://ferricentro.com')));
  if (!tab || !tab.id) return {ok:false, error:'no se encontró la pestaña '+esperada};
  const host = (() => { try { return new URL(tab.url).hostname; } catch(e) { return ''; } })();
  if (!(host === 'ferricentro.com' || host.endsWith('.ferricentro.com')))
    return {ok:false, error:'dominio no autorizado: '+host};
  await chrome.scripting.executeScript({target:{tabId:tab.id}, files:['extractor.js']});
  const res = await chrome.scripting.executeScript({target:{tabId:tab.id}, func:()=>window.extractProducts()});
  const r = res && res[0] && res[0].result;
  if (!r) return {ok:false, error:'sin resultados'};
  if (!r.products || r.products.length === 0)
    return {ok:false, error:'0 productos', warnings:r.warnings||[], errors:r.errors||[], url:tab.url};
  const esc = f => { if (f==null) return ''; const s=String(f); return (s.includes(',')||s.includes('"')||s.includes('\n')||s.includes('\r')) ? '"'+s.replace(/"/g,'""')+'"' : s; };
  const fecha = new Date().toISOString();
  const headers=['titulo','precio_oferta','descuento_porcentaje','url_producto','imagen_url','fecha_consulta','fuente_url'];
  const lines=[headers.join(',')];
  for (const p of r.products)
    lines.push([esc(p.titulo),esc(p.precio_oferta),esc(p.descuento_porcentaje),esc(p.url_producto),esc(p.imagen_url),esc(fecha),esc(tab.url)].join(','));
  const blob = new Blob([lines.join('\r\n')+'\r\n'],{type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const ts = fecha.replace(/[:.]/g,'-');
  const dlId = await chrome.downloads.download({url, filename:'ferricentro_productos_'+ts+'.csv', saveAs:false});
  const limite = Date.now() + 30000;
  let item = null;
  while (Date.now() < limite) {
    const it = await chrome.downloads.search({id: dlId});
    if (it && it.length) {
      item = it[0];
      if (item.state === 'complete' || item.state === 'interrupted') break;
    }
    await new Promise(r => setTimeout(r, 400));
  }
  if (!item) return {ok:false, error:'descarga sin confirmación', url:tab.url, count:r.count};
  if (item.state !== 'complete')
    return {ok:false, error:'descarga '+item.state+': '+(item.error||''), file:item.filename||'', url:tab.url};
  return {ok:true, url:tab.url, count:r.count, file:item.filename||'', size:item.fileSize||0, warnings:(r.warnings||[]).slice(0,8)};
})()
"""


def _get(path: str):
    with urllib.request.urlopen(f"http://127.0.0.1:{PORT}{path}", timeout=5) as r:
        return json.load(r)


async def cdp(ws_url, method, params=None, timeout=60):
    async with websockets.connect(ws_url, max_size=50 * 1024 * 1024) as ws:
        await ws.send(json.dumps({"id": 1, "method": method, "params": params or {}}))
        while True:
            m = json.loads(await asyncio.wait_for(ws.recv(), timeout=timeout))
            if m.get("id") == 1:
                return m


async def esperar_carga(target_id, max_s=60):
    """Espera a que la pestaña termine de cargar y devuelve su objetivo actualizado."""
    for _ in range(max_s):
        for t in _get("/json/list"):
            if t["id"] != target_id:
                continue
            try:
                out = await cdp(t["webSocketDebuggerUrl"], "Runtime.evaluate",
                                {"expression": "document.readyState", "returnByValue": True},
                                timeout=10)
                if out["result"]["result"].get("value") in ("interactive", "complete"):
                    await asyncio.sleep(2)
                    return t
            except Exception:
                pass
        await asyncio.sleep(1)
    return None


async def main(url: str, ext_id: str):
    ver = _get("/json/version")
    browser_ws = ver["webSocketDebuggerUrl"]

    objetivos = _get("/json/list")
    paginas = [t for t in objetivos if t["type"] == "page"]

    destino = next((t for t in paginas if t["url"].startswith(url)), None)
    if destino:
        await cdp(browser_ws, "Target.activateTarget", {"targetId": destino["id"]})
        print(f"Pestaña activa: {destino['url'][:70]}")
    else:
        r = await cdp(browser_ws, "Target.createTarget", {"url": url, "background": False})
        destino = {"id": r["result"]["targetId"], "url": url}
        print(f"Pestaña abierta: {url}")

    destino = await esperar_carga(destino["id"]) or destino

    r = await cdp(browser_ws, "Target.createTarget",
                  {"url": f"chrome-extension://{ext_id}/popup.html", "background": True})
    popup_id = r["result"]["targetId"]

    try:
        res = None
        for intento in range(3):
            lista = _get("/json/list")
            popup = next(t for t in lista if t["id"] == popup_id)
            await asyncio.sleep(1.5)
            out = await cdp(popup["webSocketDebuggerUrl"], "Runtime.evaluate", {
                "expression": EVALUAR.replace("__URL__", json.dumps(url)),
                "awaitPromise": True, "returnByValue": True,
            }, timeout=120)
            res = out.get("result", {}).get("result", {}).get("value")
            if isinstance(res, dict) and res.get("ok"):
                break
            if isinstance(res, dict) and "no se encontró la pestaña" in str(res.get("error", "")):
                await cdp(browser_ws, "Target.activateTarget", {"targetId": destino["id"]})
                await asyncio.sleep(4)
                continue
            break
        if not isinstance(res, dict):
            print("ERROR: sin respuesta de la extensión:", json.dumps(out.get("result", {}), ensure_ascii=False)[:300])
            return 1
        if res.get("ok"):
            print(f"Extensión ejecutada: {res['count']} productos extraídos")
            for w in res.get("warnings", []):
                print("  aviso:", w)
            print(f"CSV guardado en: {res.get('file')} ({res.get('size', 0)} bytes)")
            return 0
        print(f"ERROR: {res.get('error')}")
        for w in res.get("warnings", [])[:5]:
            print("  aviso:", w)
        return 1
    finally:
        await cdp(browser_ws, "Target.closeTarget", {"targetId": popup_id})


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--ext-id", required=True)
    ap.add_argument("--url", required=True)
    a = ap.parse_args()
    PORT = a.port
    raise SystemExit(asyncio.run(main(a.url, a.ext_id)))
