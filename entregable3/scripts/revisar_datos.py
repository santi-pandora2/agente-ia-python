"""Revisa la base de inventario contra las invariantes y reglas de negocio.

Es el checklist del agente de QA: valida que la base derivada del Excel siga
siendo confiable para responder preguntas de inventario.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from dataclasses import asdict, dataclass
from datetime import date
from pathlib import Path

from consultar import BASE_POR_DEFECTO, conectar

CORTE_BASE = date(2026, 9, 4)
DIAS_POR_VENCER = 30
CONTEOS_ESPERADOS = {"proveedores": 75, "productos": 1250, "inventario": 827}
CATEGORIAS_CONOCIDAS = ("Abarrotes", "Ferretería", "Miscelánea", "Panadería", "Papelería")
CATEGORIAS_SIN_CONTROL = ("Panadería",)
ESTADOS_INVENTARIO = ("VIGENTE", "POR VENCER", "VENCIDO", "NO APLICA")
ESTADOS_PROVEEDOR = ("Activo", "En revisión")

PASA = "PASA"
FALLA = "FALLA"
AVISO = "AVISO"


@dataclass
class Hallazgo:
    chequeo: str
    estado: str
    detalle: str


def unico(conexion: sqlite3.Connection, sql: str, parametros: tuple = ()) -> int:
    return conexion.execute(sql, parametros).fetchone()[0]


def en(valores: tuple[str, ...]) -> str:
    return "(" + ", ".join("?" for _ in valores) + ")"


def revisar_conteos(conexion: sqlite3.Connection) -> Hallazgo:
    diferencias = []
    for tabla, esperado in CONTEOS_ESPERADOS.items():
        real = unico(conexion, f"SELECT COUNT(*) FROM {tabla}")
        if real != esperado:
            diferencias.append(f"{tabla}={real} (esperado {esperado})")
    return Hallazgo(
        "Conteos de las 3 tablas del alcance",
        PASA if not diferencias else FALLA,
        "75 proveedores, 1250 productos, 827 lotes"
        if not diferencias
        else "; ".join(diferencias),
    )


def revisar_claves(conexion: sqlite3.Connection) -> Hallazgo:
    duplicados = unico(
        conexion, "SELECT COUNT(*) FROM (SELECT codigo FROM productos GROUP BY codigo HAVING COUNT(*) > 1)"
    ) + unico(
        conexion, "SELECT COUNT(*) FROM (SELECT id FROM proveedores GROUP BY id HAVING COUNT(*) > 1)"
    ) + unico(
        conexion,
        "SELECT COUNT(*) FROM (SELECT producto_codigo, lote FROM inventario"
        " GROUP BY producto_codigo, lote HAVING COUNT(*) > 1)",
    )
    return Hallazgo(
        "Claves unicas (productos.codigo, proveedores.id, inventario+producto)",
        PASA if duplicados == 0 else FALLA,
        "0 duplicados" if duplicados == 0 else f"{duplicados} claves duplicadas",
    )


def revisar_integridad(conexion: sqlite3.Connection) -> Hallazgo:
    huerfanos = len(conexion.execute("PRAGMA foreign_key_check").fetchall())
    sin_padre = unico(
        conexion,
        "SELECT COUNT(*) FROM inventario i LEFT JOIN productos p ON p.codigo = i.producto_codigo"
        " WHERE p.codigo IS NULL",
    ) + unico(
        conexion,
        "SELECT COUNT(*) FROM productos p LEFT JOIN proveedores v ON v.id = p.proveedor_id"
        " WHERE v.id IS NULL",
    )
    detalle = (
        "0 relaciones invalidas" if huerfanos + sin_padre == 0
        else f"{huerfanos} violaciones de FK, {sin_padre} huerfanos"
    )
    return Hallazgo(
        "Integridad referencial inventario->productos->proveedores",
        PASA if huerfanos + sin_padre == 0 else FALLA,
        detalle,
    )


def revisar_obligatorios(conexion: sqlite3.Connection) -> Hallazgo:
    nulos = (
        unico(
            conexion,
            "SELECT COUNT(*) FROM productos WHERE codigo IS NULL OR nombre IS NULL"
            " OR nombre = '' OR categoria IS NULL OR proveedor_id IS NULL"
            " OR precio_costo IS NULL OR precio_venta IS NULL",
        )
        + unico(
            conexion,
            "SELECT COUNT(*) FROM proveedores WHERE id IS NULL OR razon_social IS NULL"
            " OR razon_social = ''",
        )
        + unico(
            conexion,
            "SELECT COUNT(*) FROM inventario WHERE producto_codigo IS NULL OR lote IS NULL"
            " OR lote = '' OR stock IS NULL OR stock_minimo IS NULL",
        )
    )
    return Hallazgo(
        "Campos obligatorios poblados",
        PASA if nulos == 0 else FALLA,
        "0 nulos en campos obligatorios" if nulos == 0 else f"{nulos} campos obligatorios nulos",
    )


def revisar_dominio(conexion: sqlite3.Connection) -> Hallazgo:
    problemas = unico(
        conexion,
        f"SELECT COUNT(*) FROM inventario WHERE estado NOT IN {en(ESTADOS_INVENTARIO)}",
        ESTADOS_INVENTARIO,
    ) + unico(
        conexion,
        f"SELECT COUNT(*) FROM proveedores WHERE estado NOT IN {en(ESTADOS_PROVEEDOR)}",
        ESTADOS_PROVEEDOR,
    ) + unico(
        conexion, "SELECT COUNT(*) FROM inventario WHERE stock < 0 OR stock_minimo < 0"
    ) + unico(
        conexion, "SELECT COUNT(*) FROM productos WHERE precio_costo <= 0 OR precio_venta <= 0"
    ) + unico(
        conexion, "SELECT COUNT(*) FROM productos WHERE precio_venta < precio_costo"
    ) + unico(
        conexion,
        "SELECT COUNT(*) FROM productos WHERE nombre <> TRIM(nombre) OR categoria <> TRIM(categoria)",
    )
    return Hallazgo(
        "Dominio de estados, precios y textos",
        PASA if problemas == 0 else FALLA,
        f"estados {len(ESTADOS_INVENTARIO)} de inventario / {len(ESTADOS_PROVEEDOR)} de proveedor,"
        " precios > 0, precio_venta >= precio_costo, textos sin espacios sobrantes"
        if problemas == 0
        else f"{problemas} valores fuera de dominio",
    )


def revisar_vencimientos(conexion: sqlite3.Connection, corte: date) -> Hallazgo:
    incoherentes = unico(
        conexion,
        "SELECT COUNT(*) FROM inventario"
        " WHERE (estado = 'NO APLICA') <> (fecha_vencimiento IS NULL)",
    )
    mal_rotulados = unico(
        conexion,
        "SELECT COUNT(*) FROM inventario WHERE fecha_vencimiento IS NOT NULL AND estado <> CASE"
        " WHEN date(fecha_vencimiento) < date(?) THEN 'VENCIDO'"
        " WHEN date(fecha_vencimiento) < date(?, ?) THEN 'POR VENCER'"
        " ELSE 'VIGENTE' END",
        (corte.isoformat(), corte.isoformat(), f"+{DIAS_POR_VENCER} days"),
    )
    ilegibles = unico(
        conexion,
        "SELECT COUNT(*) FROM inventario WHERE (fecha_vencimiento IS NOT NULL"
        " AND date(fecha_vencimiento) IS NULL)"
        " OR (ultima_actualizacion IS NOT NULL AND date(ultima_actualizacion) IS NULL)",
    )
    total = incoherentes + mal_rotulados + ilegibles
    return Hallazgo(
        f"Vencimientos coherentes al corte {corte.isoformat()}",
        PASA if total == 0 else FALLA,
        "NO APLICA <=> sin fecha; estado coincide con los dias al corte"
        if total == 0
        else f"{incoherentes} sin coherencia estado/fecha, {mal_rotulados} mal rotulados,"
        f" {ilegibles} fechas ilegibles",
    )


def revisar_categorias_sin_control(conexion: sqlite3.Connection) -> Hallazgo:
    lotes = unico(
        conexion,
        "SELECT COUNT(*) FROM inventario i JOIN productos p ON p.codigo = i.producto_codigo"
        f" WHERE p.categoria IN {en(CATEGORIAS_SIN_CONTROL)}",
        CATEGORIAS_SIN_CONTROL,
    )
    return Hallazgo(
        f"Categorias sin control de inventario ({', '.join(CATEGORIAS_SIN_CONTROL)})",
        PASA if lotes == 0 else AVISO,
        "0 lotes: la categoria no se lleva en inventario, no reportar faltantes"
        if lotes == 0
        else f"{lotes} lotes en categorias no controladas: actualizar la regla de AGENTS.md",
    )


def revisar_categorias(conexion: sqlite3.Connection) -> Hallazgo:
    desconocidas = conexion.execute(
        f"SELECT DISTINCT categoria FROM productos WHERE categoria NOT IN {en(CATEGORIAS_CONOCIDAS)}",
        CATEGORIAS_CONOCIDAS,
    ).fetchall()
    sin_lote = conexion.execute(
        "SELECT p.categoria, COUNT(*) FROM productos p"
        " LEFT JOIN inventario i ON i.producto_codigo = p.codigo"
        f" WHERE i.id IS NULL AND p.categoria NOT IN {en(CATEGORIAS_SIN_CONTROL)}"
        " GROUP BY p.categoria ORDER BY p.categoria",
        CATEGORIAS_SIN_CONTROL,
    ).fetchall()
    if desconocidas:
        return Hallazgo(
            "Categorias dentro del catalogo conocido",
            AVISO,
            "fuera de catalogo: "
            + ", ".join(fila[0] for fila in desconocidas)
            + "; revisar las reglas de AGENTS.md",
        )
    detalle = "productos sin lote en categorias controladas: " + (
        ", ".join(f"{fila[0]} {fila[1]}" for fila in sin_lote) or "ninguno"
    )
    return Hallazgo("Categorias dentro del catalogo conocido", PASA, detalle)


def revisar_proveedores(conexion: sqlite3.Connection) -> Hallazgo:
    en_revision = conexion.execute(
        "SELECT v.id, v.razon_social, COUNT(DISTINCT p.codigo) AS productos"
        " FROM proveedores v JOIN productos p ON p.proveedor_id = v.id"
        " WHERE v.estado <> 'Activo' GROUP BY v.id, v.razon_social ORDER BY v.id"
    ).fetchall()
    if not en_revision:
        return Hallazgo("Proveedores no Activos", PASA, "0 proveedores en revision con productos")
    detalle = "; ".join(
        f"{fila['id']} {fila['razon_social']} ({fila['productos']} productos)"
        for fila in en_revision
    )
    return Hallazgo(
        "Proveedores no Activos",
        AVISO,
        f"{len(en_revision)} proveedores no habilitados, con productos vivos: {detalle}",
    )


def revisar_stock_cero(conexion: sqlite3.Connection) -> Hallazgo:
    filas = conexion.execute(
        "SELECT producto_codigo AS codigo, lote, stock_minimo FROM inventario WHERE stock = 0"
    ).fetchall()
    if not filas:
        return Hallazgo("Lotes agotados", PASA, "0 lotes con stock 0")
    return Hallazgo(
        "Lotes agotados",
        AVISO,
        "; ".join(f"{fila['codigo']} {fila['lote']} (minimo {fila['stock_minimo']})" for fila in filas),
    )


def revisar(conexion: sqlite3.Connection, corte: date) -> list[Hallazgo]:
    return [
        revisar_conteos(conexion),
        revisar_claves(conexion),
        revisar_integridad(conexion),
        revisar_obligatorios(conexion),
        revisar_dominio(conexion),
        revisar_vencimientos(conexion, corte),
        revisar_categorias_sin_control(conexion),
        revisar_categorias(conexion),
        revisar_proveedores(conexion),
        revisar_stock_cero(conexion),
    ]


def formatear_hallazgos(hallazgos: list[Hallazgo]) -> str:
    bloques = []
    for hallazgo in hallazgos:
        detalle = hallazgo.detalle
        continuaciones = "\n".join(
            "      " + linea for linea in detalle.split("\n")
        )
        bloques.append(f"{hallazgo.estado:<5} {hallazgo.chequeo}\n{continuaciones}")
    return "\n\n".join(bloques)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", type=Path, default=BASE_POR_DEFECTO, help="Ruta del .db")
    parser.add_argument(
        "--corte",
        type=date.fromisoformat,
        default=CORTE_BASE,
        help=f"Fecha de corte para los estados (Excel: {CORTE_BASE.isoformat()})",
    )
    parser.add_argument("--json", action="store_true", help="Salida en JSON para agentes")
    argumentos = parser.parse_args()

    conexion = conectar(argumentos.base)
    try:
        hallazgos = revisar(conexion, argumentos.corte)
    finally:
        conexion.close()

    if argumentos.json:
        print(json.dumps([asdict(hallazgo) for hallazgo in hallazgos], ensure_ascii=False, indent=2))
    else:
        print(formatear_hallazgos(hallazgos))

    fallidas = sum(hallazgo.estado == FALLA for hallazgo in hallazgos)
    if not argumentos.json:
        print(f"\nFallas: {fallidas}. Base {'APROBADA' if fallidas == 0 else 'RECHAZADA'}.")
    raise SystemExit(1 if fallidas else 0)


if __name__ == "__main__":
    main()
