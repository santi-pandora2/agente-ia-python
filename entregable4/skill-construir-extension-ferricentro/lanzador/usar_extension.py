#!/usr/bin/env python3
"""Ejecuta la extracción con la extensión cargada (usa chrome.scripting +
chrome.downloads reales desde el contexto de la extensión, sin clics manuales).

Flujo:
 1. Localiza/abre la pestaña de la URL autorizada y la deja activa.
 2. Abre popup.html en una pestaña en segundo plano (contexto de la extensión).
 3. Desde ahí llama a chrome.tabs + chrome.scripting + chrome.downloads.
 4. Recorre todas las páginas del listado y descarga catálogo, actualización POS y excepciones (UTF-8).
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
  const res = await chrome.scripting.executeScript({target:{tabId:tab.id}, func:()=>window.extractProductsAll(500)});
  const r = res && res[0] && res[0].result;
  if (!r) return {ok:false, error:'sin resultados'};
  if (!r.products || r.products.length === 0)
    return {ok:false, error:'0 productos', warnings:r.warnings||[], errors:r.errors||[], url:tab.url, pages:r.pages||0};

  const fecha = new Date().toISOString();

  if (typeof window.buildInventoryFiles !== 'function')
    return {ok:false, error:'popup.js no expuso buildInventoryFiles'};
  const files = window.buildInventoryFiles(r.products, tab.url, fecha, 'Ferricentro');

  async function bajar(nombre, texto) {
    const blob = new Blob([texto],{type:'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const id = await chrome.downloads.download({url, filename:nombre, saveAs:false, conflictAction:'overwrite'});
    const limite = Date.now() + 60000;
    let item = null;
    while (Date.now() < limite) {
      const it = await chrome.downloads.search({id});
      if (it && it.length) {
        item = it[0];
        if (item.state === 'complete' || item.state === 'interrupted') break;
      }
      await new Promise(r => setTimeout(r, 400));
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    if (!item) return {ok:false, error:'descarga sin confirmación', filename:nombre};
    if (item.state !== 'complete') return {ok:false, error:'descarga '+item.state+': '+(item.error||''), filename:item.filename||nombre};
    return {ok:true, filename:item.filename||nombre, size:item.fileSize||0};
  }

  const catalogo = await bajar('catalogo_proveedor.csv', files.catalogo);
  if (!catalogo.ok) return {ok:false, error:'catalogo_proveedor: '+catalogo.error, url:tab.url, count:r.count};
  const pos = await bajar('actualizacion_pos.csv', files.actualizacion);
  if (!pos.ok) return {ok:false, error:'actualizacion_pos: '+pos.error, url:tab.url, count:r.count};
  const exc = await bajar('excepciones.csv', files.excepciones);
  if (!exc.ok) return {ok:false, error:'excepciones: '+exc.error, url:tab.url, count:r.count};

  return {
    ok:true, url:tab.url, count:r.count, pages:r.pages||0, totalDeclared:r.totalDeclared||null,
    counts:files.counts,
    catalogFile:catalogo.filename, catalogSize:catalogo.size,
    posFile:pos.filename, posSize:pos.size,
    exceptionsFile:exc.filename, exceptionsSize:exc.size,
    warnings:(r.warnings||[]).slice(0,12), errors:(r.errors||[]).slice(0,8)
  };
})()
"""


def _get(path: str):
    with urllib.request.urlopen(f"http://127.0.0.1:{PORT}{path}", timeout=5) as r:
        return json.load(r)


async def cdp(ws_url, method, params=None, timeout=120):
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
        out = None
        for intento in range(3):
            lista = _get("/json/list")
            popup = next(t for t in lista if t["id"] == popup_id)
            await asyncio.sleep(1.5)
            out = await cdp(popup["webSocketDebuggerUrl"], "Runtime.evaluate", {
                "expression": EVALUAR.replace("__URL__", json.dumps(url)),
                "awaitPromise": True, "returnByValue": True,
            }, timeout=600)
            res = out.get("result", {}).get("result", {}).get("value")
            if isinstance(res, dict) and res.get("ok"):
                break
            if isinstance(res, dict) and "no se encontró la pestaña" in str(res.get("error", "")):
                await cdp(browser_ws, "Target.activateTarget", {"targetId": destino["id"]})
                await asyncio.sleep(4)
                continue
            break
        if not isinstance(res, dict):
            print("ERROR: sin respuesta de la extensión:", json.dumps((out or {}).get("result", {}), ensure_ascii=False)[:300])
            return 1
        if res.get("ok"):
            print(f"Extensión ejecutada: {res['count']} productos extraídos en {res.get('pages', 0)} página(s)")
            if res.get("totalDeclared") is not None:
                print(f"Total declarado por la categoría: {res['totalDeclared']}")
            for w in res.get("warnings", []):
                print("  aviso:", w)
            for e in res.get("errors", []):
                print("  error:", e)
            c = res.get('counts') or {}
            print(f"Catálogo guardado en: {res.get('catalogFile')} ({res.get('catalogSize', 0)} bytes, {c.get('catalogo', 0)} filas)")
            print(f"Actualización POS guardada en: {res.get('posFile')} ({res.get('posSize', 0)} bytes, {c.get('actualizacion', 0)} filas)")
            print(f"Excepciones guardadas en: {res.get('exceptionsFile')} ({res.get('exceptionsSize', 0)} bytes, {c.get('excepciones', 0)} filas)")
            return 0
        print(f"ERROR: {res.get('error')}")
        for w in res.get("warnings", [])[:8]:
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
