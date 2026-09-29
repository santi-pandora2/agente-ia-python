"""Reglas de negocio e invariantes que el asistente no puede incumplir."""

from __future__ import annotations

from datetime import date

from revisar_datos import (
    AVISO,
    CORTE_BASE,
    DIAS_POR_VENCER,
    FALLA,
    PASA,
    revisar,
)


def por_nombre(hallazgos, nombre: str):
    return next(hallazgo for hallazgo in hallazgos if nombre in hallazgo.chequeo)


def test_la_base_aprueba_el_checklist(conexion) -> None:
    hallazgos = revisar(conexion, CORTE_BASE)
    fallidas = [hallazgo.chequeo for hallazgo in hallazgos if hallazgo.estado == FALLA]
    assert fallidas == []


def test_invariantes_de_estructura_pasan(conexion) -> None:
    hallazgos = revisar(conexion, CORTE_BASE)
    for nombre in (
        "Conteos de las 3 tablas del alcance",
        "Claves unicas",
        "Integridad referencial",
        "Campos obligatorios poblados",
        "Dominio de estados, precios y textos",
        "Vencimientos coherentes",
    ):
        assert por_nombre(hallazgos, nombre).estado == PASA, nombre


def test_panaderia_no_se_inventaria(conexion) -> None:
    hallazgos = revisar(conexion, CORTE_BASE)
    chequeo = por_nombre(hallazgos, "sin control de inventario")
    assert chequeo.estado == PASA
    lotes = conexion.execute(
        "SELECT COUNT(*) FROM inventario i JOIN productos p ON p.codigo = i.producto_codigo"
        " WHERE p.categoria = 'Panadería'"
    ).fetchone()[0]
    assert lotes == 0
    productos = conexion.execute(
        "SELECT COUNT(*) FROM productos WHERE categoria = 'Panadería'"
    ).fetchone()[0]
    assert productos == 250


def test_proveedores_en_revision_quedan_visibles(conexion) -> None:
    hallazgos = revisar(conexion, CORTE_BASE)
    chequeo = por_nombre(hallazgos, "Proveedores no Activos")
    assert chequeo.estado == AVISO
    assert "PRV-001" in chequeo.detalle
    en_revision = conexion.execute(
        "SELECT COUNT(*) FROM proveedores WHERE estado = 'En revisión'"
    ).fetchone()[0]
    assert en_revision == 4


def test_categorias_fuera_de_catalogo_avisan(conexion_escribible) -> None:
    conexion_escribible.execute(
        "INSERT INTO productos (codigo, nombre, categoria, proveedor_id, unidad,"
        " precio_costo, precio_venta) VALUES ('ZZZ-0001', 'Prueba', 'Licores',"
        " 'PRV-001', 'Unidad', 1000, 2000)"
    )
    conexion_escribible.commit()
    assert por_nombre(revisar(conexion_escribible, CORTE_BASE), "catalogo conocido").estado == AVISO


def test_lote_vencido_fuera_de_corte_falla(conexion_escribible) -> None:
    conexion_escribible.execute(
        "UPDATE inventario SET estado = 'VIGENTE', fecha_vencimiento = '2020-01-01'"
        " WHERE producto_codigo = 'ABA-0218'"
    )
    conexion_escribible.commit()
    assert por_nombre(revisar(conexion_escribible, CORTE_BASE), "Vencimientos coherentes").estado == FALLA


def test_no_aplica_exige_fecha_nula(conexion_escribible) -> None:
    conexion_escribible.execute(
        "UPDATE inventario SET estado = 'NO APLICA' WHERE producto_codigo = 'ABA-0218'"
    )
    conexion_escribible.commit()
    assert por_nombre(revisar(conexion_escribible, CORTE_BASE), "Vencimientos").estado == FALLA

    conexion_escribible.execute(
        "UPDATE inventario SET fecha_vencimiento = NULL WHERE producto_codigo = 'ABA-0218'"
    )
    conexion_escribible.commit()
    assert por_nombre(revisar(conexion_escribible, CORTE_BASE), "Vencimientos").estado == PASA


def test_umbral_de_por_vencer_por_defecto(conexion) -> None:
    assert DIAS_POR_VENCER == 30
    assert CORTE_BASE == date(2026, 9, 4)
    por_vencer = conexion.execute(
        "SELECT COUNT(*) FROM inventario WHERE estado = 'POR VENCER'"
    ).fetchone()[0]
    assert por_vencer == 15
