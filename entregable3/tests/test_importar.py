"""El importador debe producir una base reconstruible y fiel al Excel."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest
from openpyxl import Workbook

from importar_excel import convertir

CONTEOS = {"proveedores": 75, "productos": 1250, "inventario": 827}

FILA_PROVEEDOR = [
    "PRV-001", "Proveedor Uno", "900000000-1", "Abarrotes", "Ana Ruiz", "6011111111",
    "3011111111", "ana@proveedor.co", "Carrera 1 # 2-3", "Bogotá D.C.", "Cundinamarca",
    "Contado", "Transferencia bancaria", "Activo",
]
FILA_PRODUCTO = [
    "ABA-0001", "Producto Uno", "Abarrotes", "PRV-001", "Proveedor Uno", "Unidad",
    1000, 1500, 0.5, None,
]
FILA_INVENTARIO = [
    "ABA-0001", "Producto Uno", "Abarrotes", "Proveedor Uno", "A-01-01", "LT-0001",
    5, 10, 1000, 5000, "2027-01-01", 118, "VIGENTE", "2026-08-01", "",
]


def libro_minimo(ruta: Path, hojas: tuple[str, ...] = ("Productos", "Proveedores", "Inventario")) -> Path:
    """Libro de una fila por hoja que replica el acomodo real de columnas."""
    libro = Workbook()
    libro.remove(libro.active)
    for nombre, fila in zip(hojas, (FILA_PRODUCTO, FILA_PROVEEDOR, FILA_INVENTARIO)):
        hoja = libro.create_sheet(nombre)
        for numero in range(4):
            hoja.append(["Encabezado" if numero == 3 else None] * 15)
        hoja.append(list(fila) + [None] * (15 - len(fila)))
    libro.save(ruta)
    libro.close()
    return ruta


def test_conteos_del_excel_real(importacion) -> None:
    conteos = importacion.conteos
    assert {clave: conteos[clave] for clave in CONTEOS} == CONTEOS
    assert conteos["bajo_minimo"] == 73


def test_importacion_no_deja_archivo_temporal(importacion) -> None:
    assert importacion.base.exists()
    assert not importacion.base.with_suffix(".temporal.db").exists()


def test_esquema_de_las_tres_tablas(conexion) -> None:
    esperado = {
        "proveedores": {
            "id", "razon_social", "nit", "categoria", "contacto",
            "telefono", "correo", "ciudad", "estado",
        },
        "productos": {
            "codigo", "nombre", "categoria", "proveedor_id", "unidad",
            "precio_costo", "precio_venta",
        },
        "inventario": {
            "id", "producto_codigo", "ubicacion", "lote", "stock",
            "stock_minimo", "fecha_vencimiento", "estado",
            "ultima_actualizacion", "observaciones", "fila_origen",
        },
    }
    for tabla, columnas in esperado.items():
        reales = {fila["name"] for fila in conexion.execute(f"PRAGMA table_info({tabla})")}
        assert reales == columnas, tabla


def test_solo_las_tres_tablas_del_alcance(conexion) -> None:
    tablas = {
        fila[0]
        for fila in conexion.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
    }
    assert tablas == set(CONTEOS)


def test_relaciones_invalidas(conexion) -> None:
    assert conexion.execute("PRAGMA foreign_key_check").fetchall() == []


def test_claves_unicas(conexion) -> None:
    assert conexion.execute(
        "SELECT codigo, COUNT(*) FROM productos GROUP BY codigo HAVING COUNT(*) > 1"
    ).fetchall() == []
    assert conexion.execute(
        "SELECT producto_codigo, lote, COUNT(*) FROM inventario"
        " GROUP BY producto_codigo, lote HAVING COUNT(*) > 1"
    ).fetchall() == []


def test_el_mapeo_de_columnas_se_respeta(tmp_path: Path) -> None:
    destino = tmp_path / "inventario.db"
    conteos = convertir(libro_minimo(tmp_path / "minimo.xlsm"), destino)
    assert conteos == {"proveedores": 1, "productos": 1, "inventario": 1, "bajo_minimo": 1}

    with sqlite3.connect(destino) as consulta:
        assert consulta.execute("SELECT nit, ciudad, estado FROM proveedores").fetchone() == (
            "900000000-1",
            "Bogotá D.C.",
            "Activo",
        )
        assert consulta.execute(
            "SELECT proveedor_id, unidad, precio_costo, precio_venta FROM productos"
        ).fetchone() == ("PRV-001", "Unidad", 1000, 1500)
        assert consulta.execute(
            "SELECT ubicacion, lote, stock, stock_minimo, fecha_vencimiento, estado,"
            " ultima_actualizacion, fila_origen FROM inventario"
        ).fetchone() == ("A-01-01", "LT-0001", 5, 10, "2027-01-01", "VIGENTE", "2026-08-01", 5)


def test_importacion_es_idempotente(tmp_path: Path) -> None:
    origen = libro_minimo(tmp_path / "minimo.xlsm")
    destino = tmp_path / "inventario.db"
    assert convertir(origen, destino) == convertir(origen, destino)


def test_origen_inexistente(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        convertir(tmp_path / "no-existe.xlsm", tmp_path / "salida.db")


def test_libro_sin_hojas_requeridas(tmp_path: Path) -> None:
    origen = libro_minimo(tmp_path / "parcial.xlsm", hojas=("Productos",))
    destino = tmp_path / "salida.db"
    with pytest.raises(ValueError, match="Faltan hojas requeridas"):
        convertir(origen, destino)
    assert not destino.exists()
