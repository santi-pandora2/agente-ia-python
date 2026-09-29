"""Consultas de solo lectura sobre la base de inventario.

Es la unica via de datos del asistente: no escribe nada y solo acepta
parametros con nombre, no SQL libre.
"""

from __future__ import annotations

import argparse
import sqlite3
from datetime import date
from pathlib import Path

BASE_POR_DEFECTO = Path("datos/procesados/inventario.db")
CATEGORIAS_SIN_CONTROL = ("Panadería",)
DIAS_POR_VENCER = 30


def conectar(base: Path) -> sqlite3.Connection:
    """Abre la base en modo solo lectura; el entorno no tiene binario sqlite3."""
    if not base.exists():
        raise SystemExit(
            f"No existe la base {base}. Generela con:\n"
            "  uv run python scripts/importar_excel.py "
            "datos/original/operacion_comercial_app.xlsm datos/procesados/inventario.db"
        )
    conexion = sqlite3.connect(f"file:{base.resolve()}?mode=ro", uri=True)
    conexion.row_factory = sqlite3.Row
    return conexion


def formatear(encabezados: list[str], filas: list[tuple], consulta: str) -> str:
    """Arma la tabla de una consulta alineando por posicion.

    `consulta` es el nombre del subcomando y solo se usa para que el error de
    desalineacion diga que consulta se rompio: sin el, un SELECT con una
    columna mas que la lista de encabezados se corria una columna a la
    izquierda y se perdia el ultimo valor sin avisar.
    """
    if not filas:
        return "Sin resultados."
    columnas = [[("" if celda is None else str(celda)) for celda in fila] for fila in filas]
    for numero, fila in enumerate(columnas, start=1):
        if len(fila) != len(encabezados):
            raise ValueError(
                f"La consulta '{consulta}' trae {len(fila)} valores en la fila"
                f" {numero} pero declara {len(encabezados)} encabezados."
                " formatear los empareja por posicion, asi que lo que sobre"
                " se pierde en silencio: alinea el SELECT con la lista de"
                " encabezados."
            )
    anchos = [
        max(len(encabezados[columna]), *(len(fila[columna]) for fila in columnas))
        for columna in range(len(encabezados))
    ]

    def linea(celdas: list[str]) -> str:
        return "  ".join(celda.ljust(ancho) for celda, ancho in zip(celdas, anchos))

    cuerpo = [linea(encabezados), "  ".join("-" * ancho for ancho in anchos)]
    cuerpo.extend(linea(fila) for fila in columnas)
    return "\n".join(cuerpo)


def dinero(valor) -> str:
    return f"COP {int(valor or 0):,}".replace(",", ".")


def validar_categoria(conexion: sqlite3.Connection, categoria: str | None) -> None:
    if categoria is None:
        return
    conocidas = {
        fila[0]
        for fila in conexion.execute("SELECT DISTINCT categoria FROM productos")
    }
    if categoria not in conocidas:
        raise SystemExit(
            f"Categoria desconocida: {categoria}. Opciones: {', '.join(sorted(conocidas))}"
        )


def resumen(conexion: sqlite3.Connection) -> str:
    conteos = conexion.execute(
        "SELECT (SELECT COUNT(*) FROM proveedores) AS proveedores,"
        " (SELECT COUNT(*) FROM productos) AS productos,"
        " (SELECT COUNT(*) FROM inventario) AS inventario"
    ).fetchone()
    estados = conexion.execute(
        "SELECT estado, COUNT(*) AS lotes, COALESCE(SUM(stock), 0) AS unidades"
        " FROM inventario GROUP BY estado ORDER BY lotes DESC"
    ).fetchall()
    categorias = conexion.execute(
        "SELECT p.categoria, COUNT(*) AS productos,"
        " SUM(CASE WHEN i.id IS NULL THEN 1 ELSE 0 END) AS sin_lote"
        " FROM productos p LEFT JOIN inventario i ON i.producto_codigo = p.codigo"
        " GROUP BY p.categoria ORDER BY p.categoria"
    ).fetchall()
    proveedores = conexion.execute(
        "SELECT estado, COUNT(*) AS proveedores FROM proveedores"
        " GROUP BY estado ORDER BY proveedores DESC"
    ).fetchall()
    valor = conexion.execute(
        "SELECT COALESCE(SUM(i.stock * p.precio_costo), 0) FROM inventario i"
        " JOIN productos p ON p.codigo = i.producto_codigo"
    ).fetchone()[0]
    bajo_minimo = conexion.execute(
        "SELECT COUNT(*) FROM inventario WHERE stock < stock_minimo"
    ).fetchone()[0]

    return "\n\n".join(
        [
            "Conteos\n"
            + formatear(
                ["Tabla", "Filas"],
                [
                    ("proveedores", conteos["proveedores"]),
                    ("productos", conteos["productos"]),
                    ("inventario", conteos["inventario"]),
                ],
                "resumen/conteos",
            ),
            "Inventario por estado\n"
            + formatear(
                ["Estado", "Lotes", "Unidades"],
                [tuple(fila) for fila in estados],
                "resumen/inventario por estado",
            ),
            "Productos por categoria\n"
            + formatear(
                ["Categoria", "Productos", "Sin lote"],
                [tuple(fila) for fila in categorias],
                "resumen/productos por categoria",
            ),
            "Proveedores\n"
            + formatear(
                ["Estado", "Proveedores"],
                [tuple(fila) for fila in proveedores],
                "resumen/proveedores",
            ),
            "Indicadores\n"
            + formatear(
                ["Indicador", "Valor"],
                [
                    ("Lotes bajo el minimo", bajo_minimo),
                    ("Valor del inventario a costo", dinero(valor)),
                    ("Categorias sin control de inventario", ", ".join(CATEGORIAS_SIN_CONTROL)),
                ],
                "resumen/indicadores",
            ),
        ]
    )


def _condiciones_categoria(alias: str, categoria: str | None) -> tuple[str, list]:
    if categoria is None:
        return "", []
    return f" AND {alias}.categoria = ?", [categoria]


def bajo_minimo(conexion: sqlite3.Connection, categoria: str | None) -> str:
    validar_categoria(conexion, categoria)
    extra, parametros = _condiciones_categoria("p", categoria)
    filas = conexion.execute(
        "SELECT i.producto_codigo AS codigo, p.nombre, p.categoria, i.lote, i.ubicacion,"
        " i.stock, i.stock_minimo, i.stock_minimo - i.stock AS falta, i.estado, p.proveedor_id"
        " FROM inventario i JOIN productos p ON p.codigo = i.producto_codigo"
        " WHERE i.stock < i.stock_minimo" + extra + " ORDER BY falta DESC, codigo",
        parametros,
    ).fetchall()
    return "Lotes bajo el minimo\n" + formatear(
        [
            "Codigo", "Producto", "Categoria", "Lote", "Ubicacion",
            "Stock", "Minimo", "Falta", "Estado", "Proveedor",
        ],
        [tuple(fila) for fila in filas],
        "bajo-minimo",
    )


def vencidos(conexion: sqlite3.Connection, hoy: date, categoria: str | None) -> str:
    validar_categoria(conexion, categoria)
    extra, parametros = _condiciones_categoria("p", categoria)
    filas = conexion.execute(
        "SELECT i.producto_codigo AS codigo, p.nombre, p.categoria, i.lote, i.ubicacion,"
        " i.stock, i.fecha_vencimiento,"
        " CAST(julianday(date(?)) - julianday(date(i.fecha_vencimiento)) AS INTEGER)"
        "   AS dias_vencido, i.estado, p.proveedor_id"
        " FROM inventario i JOIN productos p ON p.codigo = i.producto_codigo"
        " WHERE i.fecha_vencimiento IS NOT NULL"
        "   AND date(i.fecha_vencimiento) < date(?)" + extra
        + " ORDER BY dias_vencido DESC, codigo",
        [hoy.isoformat(), hoy.isoformat(), *parametros],
    ).fetchall()
    marcados = conexion.execute(
        "SELECT COUNT(*) FROM inventario WHERE estado = 'VENCIDO'"
    ).fetchone()[0]
    return (
        f"Lotes vencidos a hoy {hoy.isoformat()}"
        f" ({len(filas)} filas; {marcados} marcados VENCIDO en el Excel)\n"
        + formatear(
            [
                "Codigo", "Producto", "Categoria", "Lote", "Ubicacion",
                "Stock", "Vence", "Dias", "Estado", "Proveedor",
            ],
            [tuple(fila) for fila in filas],
            "vencidos",
        )
    )


def por_vencer(conexion: sqlite3.Connection, hoy: date, categoria: str | None) -> str:
    validar_categoria(conexion, categoria)
    extra, parametros = _condiciones_categoria("p", categoria)
    filas = conexion.execute(
        "SELECT i.producto_codigo AS codigo, p.nombre, p.categoria, i.lote, i.stock,"
        " i.fecha_vencimiento,"
        " CAST(julianday(date(i.fecha_vencimiento)) - julianday(date(?)) AS INTEGER)"
        "   AS dias_restantes, i.estado, p.proveedor_id"
        " FROM inventario i JOIN productos p ON p.codigo = i.producto_codigo"
        " WHERE i.fecha_vencimiento IS NOT NULL"
        "   AND date(i.fecha_vencimiento) >= date(?)"
        "   AND date(i.fecha_vencimiento) < date(?, ?)" + extra
        + " ORDER BY dias_restantes, codigo",
        [
            hoy.isoformat(),
            hoy.isoformat(),
            hoy.isoformat(),
            f"+{DIAS_POR_VENCER} days",
            *parametros,
        ],
    ).fetchall()
    return (
        f"Lotes que vencen en los proximos {DIAS_POR_VENCER} dias (hoy {hoy.isoformat()})\n"
        + formatear(
            [
                "Codigo", "Producto", "Categoria", "Lote", "Stock",
                "Vence", "Dias", "Estado", "Proveedor",
            ],
            [tuple(fila) for fila in filas],
            "por-vencer",
        )
    )


def producto(conexion: sqlite3.Connection, codigo: str) -> str:
    fila = conexion.execute(
        "SELECT p.codigo, p.nombre, p.categoria, p.unidad, p.precio_costo, p.precio_venta,"
        " p.proveedor_id, v.razon_social, v.estado AS estado_proveedor, v.ciudad,"
        " v.contacto, v.correo, v.telefono"
        " FROM productos p LEFT JOIN proveedores v ON v.id = p.proveedor_id"
        " WHERE p.codigo = ?",
        (codigo,),
    ).fetchone()
    if fila is None:
        return f"No existe el producto {codigo} en el catalogo."

    if fila["categoria"] in CATEGORIAS_SIN_CONTROL:
        return formatear(
            ["Codigo", "Nombre", "Categoria", "Proveedor", "Estado proveedor", "Control"],
            [
                (
                    fila["codigo"],
                    fila["nombre"],
                    fila["categoria"],
                    f"{fila['razon_social']} ({fila['proveedor_id']})",
                    fila["estado_proveedor"],
                    "NO CONTROLADO: esta categoria no se lleva en inventario",
                )
            ],
            "producto (sin control)",
        )

    ficha = formatear(
        ["Campo", "Valor"],
        [
            ("Codigo", fila["codigo"]),
            ("Nombre", fila["nombre"]),
            ("Categoria", fila["categoria"]),
            ("Unidad", fila["unidad"]),
            ("Precio costo", dinero(fila["precio_costo"])),
            ("Precio venta", dinero(fila["precio_venta"])),
            (
                "Proveedor",
                f"{fila['razon_social']} ({fila['proveedor_id']}, {fila['estado_proveedor']})",
            ),
            ("Ciudad", fila["ciudad"]),
            ("Contacto", f"{fila['contacto']} / {fila['telefono']}"),
            ("Correo", fila["correo"]),
        ],
        "producto/ficha",
    )
    lotes = conexion.execute(
        "SELECT lote, ubicacion, stock, stock_minimo, estado, fecha_vencimiento,"
        " ultima_actualizacion, observaciones FROM inventario"
        " WHERE producto_codigo = ? ORDER BY lote",
        (codigo,),
    ).fetchall()
    cuerpo = formatear(
        [
            "Lote", "Ubicacion", "Stock", "Minimo",
            "Estado", "Vence", "Ultimo movimiento", "Observaciones",
        ],
        [tuple(lote) for lote in lotes],
        "producto/lotes",
    )
    if not lotes:
        cuerpo = (
            "Sin lotes inventariados: el producto existe en el catalogo pero no tiene"
            " registro en Inventario."
        )
    totales = conexion.execute(
        "SELECT COALESCE(SUM(stock), 0) AS unidades,"
        " COALESCE(SUM(stock * (SELECT precio_costo FROM productos WHERE codigo = ?)), 0) AS valor"
        " FROM inventario WHERE producto_codigo = ?",
        (codigo, codigo),
    ).fetchone()
    pie = formatear(
        ["Total", "Valor a costo"],
        [
            (
                f"{len(lotes)} {'lote' if len(lotes) == 1 else 'lotes'},"
                f" {totales['unidades']} unidades",
                dinero(totales["valor"]),
            )
        ],
        "producto/totales",
    )
    return f"{ficha}\n\n{cuerpo}\n\n{pie}"


def proveedor(conexion: sqlite3.Connection, identificador: str) -> str:
    fila = conexion.execute(
        "SELECT id, razon_social, nit, categoria, contacto, telefono, correo, ciudad, estado"
        " FROM proveedores WHERE id = ?",
        (identificador,),
    ).fetchone()
    if fila is None:
        return f"No existe el proveedor {identificador}."

    conteos = conexion.execute(
        "SELECT COUNT(DISTINCT p.codigo) AS productos, COUNT(i.id) AS lotes,"
        " COALESCE(SUM(i.stock), 0) AS unidades,"
        " COALESCE(SUM(i.stock * p.precio_costo), 0) AS valor"
        " FROM productos p LEFT JOIN inventario i ON i.producto_codigo = p.codigo"
        " WHERE p.proveedor_id = ?",
        (identificador,),
    ).fetchone()
    ficha = formatear(
        ["Campo", "Valor"],
        [
            ("ID", fila["id"]),
            ("Razon social", fila["razon_social"]),
            ("NIT", fila["nit"]),
            ("Categoria principal", fila["categoria"]),
            ("Ciudad", fila["ciudad"]),
            ("Contacto", f"{fila['contacto']} / {fila['telefono']}"),
            ("Correo", fila["correo"]),
            ("Estado", fila["estado"]),
            ("Productos", conteos["productos"]),
            ("Lotes inventariados", conteos["lotes"]),
            ("Unidades", conteos["unidades"]),
            ("Valor a costo", dinero(conteos["valor"])),
        ],
        "proveedor",
    )
    if fila["estado"] != "Activo":
        ficha += (
            f"\n\nAVISO: el proveedor esta en estado '{fila['estado']}', no Activo."
            " No tratarlo como proveedor habilitado para nuevos despachos."
        )
    return ficha


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", type=Path, default=BASE_POR_DEFECTO, help="Ruta del .db")
    sub = parser.add_subparsers(dest="comando", required=True)

    sub.add_parser("resumen", help="Panorama de proveedores, productos e inventario")

    bajo = sub.add_parser("bajo-minimo", help="Lotes con stock por debajo del minimo")
    bajo.add_argument("categoria", nargs="?", help="Filtra por categoria")

    vencido = sub.add_parser("vencidos", help="Lotes ya vencidos")
    vencido.add_argument("categoria", nargs="?", help="Filtra por categoria")
    vencido.add_argument("--hoy", type=date.fromisoformat, default=date.today())

    proximo = sub.add_parser("por-vencer", help="Lotes que vencen pronto")
    proximo.add_argument("categoria", nargs="?", help="Filtra por categoria")
    proximo.add_argument("--hoy", type=date.fromisoformat, default=date.today())

    ficha = sub.add_parser("producto", help="Ficha de un producto y sus lotes")
    ficha.add_argument("codigo", help="Codigo de producto, por ejemplo ABA-0218")

    ficha_proveedor = sub.add_parser("proveedor", help="Ficha de un proveedor")
    ficha_proveedor.add_argument("id", help="ID de proveedor, por ejemplo PRV-001")

    argumentos = parser.parse_args()
    conexion = conectar(argumentos.base)
    try:
        if argumentos.comando == "resumen":
            salida = resumen(conexion)
        elif argumentos.comando == "bajo-minimo":
            salida = bajo_minimo(conexion, argumentos.categoria)
        elif argumentos.comando == "vencidos":
            salida = vencidos(conexion, argumentos.hoy, argumentos.categoria)
        elif argumentos.comando == "por-vencer":
            salida = por_vencer(conexion, argumentos.hoy, argumentos.categoria)
        elif argumentos.comando == "producto":
            salida = producto(conexion, argumentos.codigo)
        else:
            salida = proveedor(conexion, argumentos.id)
    finally:
        conexion.close()
    print(salida)


if __name__ == "__main__":
    main()
