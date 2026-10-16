#!/usr/bin/env python3
"""Carga la extensión local en Chrome vía CDP (Extensions.loadUnpacked)."""
import asyncio
import json
import sys
import urllib.request

import websockets


async def cargar(puerto: int, ruta: str) -> int:
    url = f"http://127.0.0.1:{puerto}/json/version"
    ws_url = None
    for _ in range(60):
        try:
            with urllib.request.urlopen(url, timeout=2) as resp:
                ws_url = json.load(resp)["webSocketDebuggerUrl"]
            break
        except Exception:
            await asyncio.sleep(0.5)
    if not ws_url:
        print("ERROR: Chrome no respondió en el puerto de depuración.")
        return 1

    async with websockets.connect(ws_url, max_size=10 * 1024 * 1024) as ws:
        await ws.send(json.dumps({
            "id": 1,
            "method": "Extensions.loadUnpacked",
            "params": {"path": ruta},
        }))
        while True:
            msg = json.loads(await ws.recv())
            if msg.get("id") == 1:
                break

    if "result" in msg:
        print(f"Extensión cargada. ID: {msg['result']['id']}")
        return 0

    texto = json.dumps(msg.get("error", {}), ensure_ascii=False)
    if "already" in texto.lower() or "duplicate" in texto.lower():
        print("La extensión ya estaba cargada en este perfil.")
        return 0
    print(f"ERROR al cargar la extensión: {texto}")
    return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(cargar(int(sys.argv[1]), sys.argv[2])))
