#!/usr/bin/env python3
"""Valida los tres CSV de entrega de la extensión Ferricentro.

Uso:
  validar_csv.py catalogo_proveedor.csv actualizacion_pos.csv excepciones.csv
  validar_csv.py archivo.csv   # autodetecta el tipo por encabezado
"""
import csv
import sys

CATALOGO = ["proveedor", "sku", "nombre", "precio_cop", "inventario", "activo",
            "url_producto", "imagen_url", "descuento_porcentaje", "fecha_consulta", "fuente_url"]
POS = ["sku", "nombre", "precio_cop", "inventario", "activo", "accion",
       "proveedor", "url_producto"]
EXC = ["sku", "nombre", "precio_cop", "motivo", "url_producto", "fuente_url"]


def leer(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.reader(f))
    if not rows:
        raise ValueError("CSV vacío")
    return rows[0], rows[1:]


def tipo(headers):
    if headers == CATALOGO:
        return "catalogo"
    if headers == POS:
        return "pos"
    if headers == EXC:
        return "excepciones"
    return None


def validar_catalogo(filas):
    errores = []
    sin_sku = 0
    for i, fila in enumerate(filas, start=2):
        if len(fila) != len(CATALOGO):
            errores.append(f"fila {i}: {len(fila)} columnas")
            continue
        r = dict(zip(CATALOGO, fila))
        if not r["sku"].strip():
            sin_sku += 1
        if not r["proveedor"].strip():
            errores.append(f"fila {i}: proveedor vacío")
        if r["activo"] not in ("true", "false"):
            errores.append(f"fila {i}: activo inválido ({r['activo']!r})")
        if r["precio_cop"].strip() and not r["precio_cop"].strip().isdigit():
            errores.append(f"fila {i}: precio no numérico ({r['precio_cop']!r})")
    return errores, {"filas": len(filas), "sin_sku": sin_sku}


def validar_pos(filas):
    errores = []
    vistos = set()
    for i, fila in enumerate(filas, start=2):
        if len(fila) != len(POS):
            errores.append(f"fila {i}: {len(fila)} columnas")
            continue
        r = dict(zip(POS, fila))
        if not r["sku"].strip():
            errores.append(f"fila {i}: SKU vacío")
        elif r["sku"] in vistos:
            errores.append(f"fila {i}: SKU duplicado ({r['sku']})")
        else:
            vistos.add(r["sku"])
        if not r["nombre"].strip():
            errores.append(f"fila {i}: nombre vacío")
        if not r["precio_cop"].strip().isdigit() or int(r["precio_cop"]) <= 0:
            errores.append(f"fila {i}: precio inválido ({r['precio_cop']!r})")
        if r["activo"] != "true":
            errores.append(f"fila {i}: activo debe ser true ({r['activo']!r})")
        if r["accion"] not in ("UPSERT", "ACTUALIZAR"):
            errores.append(f"fila {i}: acción inválida ({r['accion']!r})")
    return errores, {"filas": len(filas), "skus": len(vistos)}


def validar_exc(filas):
    errores = []
    for i, fila in enumerate(filas, start=2):
        if len(fila) != len(EXC):
            errores.append(f"fila {i}: {len(fila)} columnas")
            continue
        r = dict(zip(EXC, fila))
        if not r["motivo"].strip():
            errores.append(f"fila {i}: motivo vacío")
    return errores, {"filas": len(filas)}


def main(paths):
    if not paths or len(paths) not in (1, 3):
        print("uso: validar_csv.py catalogo_proveedor.csv actualizacion_pos.csv excepciones.csv", file=sys.stderr)
        return 2
    datos = {}
    fallos = []
    for path in paths:
        try:
            headers, filas = leer(path)
        except Exception as e:
            fallos.append(f"{path}: {e}")
            continue
        t = tipo(headers)
        if not t:
            fallos.append(f"{path}: encabezado no reconocido: {headers}")
            continue
        if t in datos:
            fallos.append(f"{path}: tipo duplicado ({t})")
            continue
        datos[t] = (path, filas)

    for t, (path, filas) in datos.items():
        if t == "catalogo":
            err, meta = validar_catalogo(filas)
        elif t == "pos":
            err, meta = validar_pos(filas)
        else:
            err, meta = validar_exc(filas)
        if err:
            fallos.extend(f"{path}: {e}" for e in err[:15])
        else:
            extra = ""
            if t == "catalogo":
                extra = f", {meta['sin_sku']} sin SKU"
            elif t == "pos":
                extra = f", {meta['skus']} SKU únicos"
            print(f"OK {path}: {meta['filas']} fila(s){extra}, UTF-8")

    if len(paths) == 3:
        faltan = {"catalogo", "pos", "excepciones"} - set(datos)
        if faltan:
            fallos.append("faltan archivos: " + ", ".join(sorted(faltan)))
        else:
            n_cat = len(datos["catalogo"][1])
            n_pos = len(datos["pos"][1])
            n_exc = len(datos["excepciones"][1])
            if n_cat != n_pos + n_exc:
                fallos.append(f"catálogo ({n_cat}) != POS ({n_pos}) + excepciones ({n_exc})")
            else:
                print(f"OK división: catálogo {n_cat} = POS {n_pos} + excepciones {n_exc}")

    if fallos:
        print("FALLA validación de entrega")
        for f in fallos[:20]:
            print("  -", f)
        return 1
    print("RESULTADO: entrega CSV válida (UTF-8).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
