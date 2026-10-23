#!/usr/bin/env python3
"""Lista y resuelve categorías públicas de Ferricentro.

Uso:
  categorias.py --listar
  categorias.py --url 12
  categorias.py --buscar perforacion
  categorias.py --json
"""
import argparse
import json
import sys
import urllib.request
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

BASE = "https://ferricentro.com"
PREFIJOS = ("/productos", "/combos", "/ofertas", "/precios-fugaces", "/experto-sata")


class Nav(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.items = []
        self._href = None
        self._texto = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            href = dict(attrs).get("href", "")
            self._href = href
            self._texto = []

    def handle_data(self, data):
        if self._href is not None:
            self._texto.append(data)

    def handle_endtag(self, tag):
        if tag == "a" and self._href is not None:
            self.items.append((self._href, " ".join("".join(self._texto).split())))
            self._href = None
            self._texto = []


def normalizar(href):
    url = urlparse(urljoin(BASE, href))
    if url.hostname not in ("ferricentro.com", "www.ferricentro.com"):
        return None
    path = url.path.rstrip("/") or "/"
    if not any(path == p or path.startswith(p + "/") for p in PREFIJOS):
        return None
    return BASE + path


def categorias():
    req = urllib.request.Request(BASE + "/", headers={"User-Agent": "Mozilla/5.0", "Accept-Language": "es"})
    with urllib.request.urlopen(req, timeout=30) as r:
        html = r.read().decode("utf-8", "replace")
    parser = Nav()
    parser.feed(html)
    vistas = set()
    out = []
    for href, titulo in parser.items:
        url = normalizar(href)
        if not url or url in vistas:
            continue
        if not titulo or len(titulo) > 120:
            continue
        if "{" in titulo or "background-image" in titulo or titulo.startswith("."):
            continue
        vistas.add(url)
        out.append({"titulo": titulo, "url": url})
    return out


def imprimir(items, stream=sys.stdout, indices=None):
    for pos, it in enumerate(items):
        i = indices[pos] if indices else pos + 1
        ruta = it["url"].replace(BASE, "") or "/"
        print(f"{i:>3}  {it['titulo']:<34} {ruta}", file=stream)


def main():
    ap = argparse.ArgumentParser(description="Selecciona una categoría de Ferricentro")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--listar", action="store_true", help="lista categorías numeradas")
    g.add_argument("--url", type=int, metavar="N", help="imprime la URL de la categoría N")
    g.add_argument("--buscar", metavar="TEXTO", help="busca por nombre o ruta")
    g.add_argument("--json", action="store_true", help="salida JSON")
    a = ap.parse_args()
    try:
        items = categorias()
    except Exception as e:
        print(f"ERROR al leer categorías: {e}", file=sys.stderr)
        return 1
    if not items:
        print("ERROR: no se encontraron categorías", file=sys.stderr)
        return 1
    if a.url is not None:
        if not 1 <= a.url <= len(items):
            print(f"ERROR: índice fuera de rango (1..{len(items)})", file=sys.stderr)
            return 2
        print(items[a.url - 1]["url"])
        return 0
    if a.json:
        print(json.dumps(items, ensure_ascii=False, indent=2))
        return 0
    if a.buscar:
        t = a.buscar.casefold().strip()
        exactos = [x for x in items if x["url"].rstrip("/").split("/")[-1].casefold() == t]
        hallados = exactos or [x for x in items if t in x["titulo"].casefold() or t in x["url"].casefold()]
        if len(hallados) == 1:
            print(hallados[0]["url"])
            return 0
        if not hallados:
            print(f"ERROR: sin coincidencias para {a.buscar!r}", file=sys.stderr)
            return 3
        print(f"Coincidencias para {a.buscar!r}:", file=sys.stderr)
        imprimir(hallados, sys.stderr, [items.index(x) + 1 for x in hallados])
        print("Elige un número, una ruta o una URL completa.", file=sys.stderr)
        return 3
    imprimir(items)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BrokenPipeError:
        try:
            sys.stdout.close()
        except Exception:
            pass
        raise SystemExit(0)
