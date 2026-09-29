"""La via de datos del asistente: consultas con nombre y solo lectura."""

from __future__ import annotations

import re
import sqlite3
import subprocess
import sys
from datetime import date
from pathlib import Path

import pytest

import consultar
from consultar import (
    bajo_minimo,
    conectar,
    formatear,
    por_vencer,
    producto,
    proveedor,
    resumen,
    vencidos,
)

CORTE = date(2026, 9, 4)
TABLAS = ("bajo-minimo", "vencidos", "por-vencer")
ESTADOS_INVENTARIO = ("VENCIDO", "VIGENTE", "POR VENCER", "NO APLICA")
# Que forma debe tener el valor de cada columna si cae bajo su encabezado.
DOMINIO_COLUMNAS = {
    "Codigo": r"[A-Z]{3}-\d{4}",
    "Lote": r"LT-\d{7}",
    "Ubicacion": r"[A-Z]-\d{2}-\d{2}",
    "Stock": r"\d+",
    "Minimo": r"\d+",
    "Falta": r"\d+",
    "Vence": r"\d{4}-\d{2}-\d{2}",
    "Dias": r"-?\d+",
    "Estado": "|".join(ESTADOS_INVENTARIO),
    "Proveedor": r"PRV-\d{3}",
}


def consulta(nombre: str, conexion) -> str:
    """Devuelve la salida impresa de una de las tres tablas de lotes."""
    if nombre == "bajo-minimo":
        return bajo_minimo(conexion, None)
    if nombre == "vencidos":
        return vencidos(conexion, CORTE, None)
    if nombre == "por-vencer":
        return por_vencer(conexion, CORTE, None)
    raise AssertionError(f"tabla no contemplada: {nombre}")


def separador(salida: str) -> int:
    """Indice de la linea de guiones, que fija los anchos de cada columna."""
    return next(
        indice
        for indice, linea in enumerate(salida.splitlines())
        if re.fullmatch(r"-+(?: {2}-+)+", linea.strip())
    )


def bloque(salida: str) -> tuple[str, list[str]]:
    """Separa la primera tabla impresa en su linea de encabezados y sus filas."""
    lineas = salida.splitlines()
    marca = separador(salida)
    return lineas[marca - 1], lineas[marca + 1:]


def celdas_crudas(linea: str) -> list[str]:
    """Parte una linea impresa por sus separaciones de dos espacios."""
    return [celda for celda in re.split(r" {2,}", linea.strip()) if celda]


def tabla(salida: str) -> tuple[list[str], list[dict[str, str]]]:
    """Recorta las celdas por posicion, igual que hace formatear.

    Los nombres de producto traen espacios ("Jugo en caja Andes Reforzado"),
    asi que no se parte por palabra: se leen los anchos de la linea de
    guiones y se cortan las celdas con esas posiciones. Asi el test mide la
    alineacion de la tabla y no el texto de un nombre.
    """
    lineas = salida.splitlines()
    marca = separador(salida)
    anchos = [len(grupo) for grupo in re.findall(r"-{2,}", lineas[marca])]
    inicios: list[int] = []
    desplazamiento = 0
    for ancho in anchos:
        inicios.append(desplazamiento)
        desplazamiento += ancho + 2

    def celdas(linea: str) -> list[str]:
        return [
            linea[inicio:inicio + ancho].strip()
            for inicio, ancho in zip(inicios, anchos, strict=True)
        ]

    encabezados = celdas(lineas[marca - 1])
    filas = [
        dict(zip(encabezados, celdas(linea), strict=True))
        for linea in lineas[marca + 1:]
        if linea.strip()
    ]
    return encabezados, filas


def fila_de(salida: str, codigo: str) -> dict[str, str]:
    _, filas = tabla(salida)
    return next(fila for fila in filas if fila["Codigo"] == codigo)


def test_la_conexion_del_asistente_es_solo_lectura(base: Path) -> None:
    abierta = conectar(base)
    try:
        with pytest.raises(sqlite3.OperationalError):
            abierta.execute("DELETE FROM productos")
    finally:
        abierta.close()


def test_base_inexistente_explica_como_regenerarla(tmp_path: Path) -> None:
    with pytest.raises(SystemExit) as error:
        conectar(tmp_path / "no-existe.db")
    assert "importar_excel.py" in str(error.value)


def test_resumen_consolida_las_tres_tablas(conexion) -> None:
    salida = resumen(conexion)
    assert re.search(r"proveedores\s+75", salida)
    assert re.search(r"productos\s+1250", salida)
    assert re.search(r"inventario\s+827", salida)
    assert re.search(r"Lotes bajo el minimo\s+73", salida)
    assert "Panadería" in salida


def test_bajo_minimo_coincide_con_la_base(conexion) -> None:
    salida = bajo_minimo(conexion, None)
    esperado = conexion.execute(
        "SELECT COUNT(*) FROM inventario WHERE stock < stock_minimo"
    ).fetchone()[0]
    filas = [linea for linea in salida.splitlines() if linea.startswith(("ABA", "FER", "MIS", "PAP"))]
    assert len(filas) == esperado == 73


def test_bajo_minimo_filtrado_por_categoria(conexion) -> None:
    salida = bajo_minimo(conexion, "Panadería")
    assert salida == "Lotes bajo el minimo\nSin resultados."


def test_vencidos_al_corte_del_excel(conexion) -> None:
    salida = vencidos(conexion, CORTE, None)
    assert "(124 filas; 124 marcados VENCIDO en el Excel)" in salida
    filas = [linea for linea in salida.splitlines() if linea.startswith(("ABA", "FER", "MIS", "PAP"))]
    assert len(filas) == 124


def test_por_vencer_respeta_la_ventana_de_30_dias(conexion) -> None:
    salida = por_vencer(conexion, CORTE, None)
    filas = [linea for linea in salida.splitlines() if linea.startswith(("ABA", "FER", "MIS", "PAP"))]
    esperados = conexion.execute(
        "SELECT COUNT(*) FROM inventario WHERE estado = 'POR VENCER'"
    ).fetchone()[0]
    assert len(filas) == esperados == 15
    assert "LT-2430339" in salida


def test_ficha_de_producto_con_lote(conexion) -> None:
    salida = producto(conexion, "ABA-0218")
    assert "LT-2430339" in salida
    assert "D-14-06" in salida
    assert "73" in salida
    assert "Priorizar" in salida


def test_ficha_de_producto_de_panaderia_avisa_no_controlado(conexion) -> None:
    salida = producto(conexion, "PAN-0001")
    assert "NO CONTROLADO" in salida
    assert "Lote" not in salida


def test_producto_sin_lote_lo_dice(conexion) -> None:
    sin_lote = conexion.execute(
        "SELECT p.codigo FROM productos p LEFT JOIN inventario i"
        " ON i.producto_codigo = p.codigo WHERE i.id IS NULL AND p.categoria <> 'Panadería'"
        " LIMIT 1"
    ).fetchone()[0]
    assert "Sin lotes inventariados" in producto(conexion, sin_lote)


def test_producto_inexistente_no_inventa(conexion) -> None:
    assert producto(conexion, "ZZZ-9999") == "No existe el producto ZZZ-9999 en el catalogo."


def test_ficha_de_proveedor_en_revision_avisa(conexion) -> None:
    salida = proveedor(conexion, "PRV-001")
    assert "En revisión" in salida
    assert "AVISO" in salida
    assert re.search(r"Productos\s+18", salida)


def test_proveedor_activo_no_avisa(conexion) -> None:
    salida = proveedor(conexion, "PRV-061")
    assert "AVISO" not in salida


def test_categoria_desconocida_se_rechaza(conexion) -> None:
    with pytest.raises(SystemExit) as error:
        bajo_minimo(conexion, "Ferreteria")
    assert "Categoria desconocida" in str(error.value)


def test_cli_responde_en_salida_estandar(base: Path) -> None:
    proceso = subprocess.run(
        [sys.executable, str(Path(consultar.__file__)), "--base", str(base), "resumen"],
        capture_output=True,
        text=True,
        check=True,
    )
    assert "Lotes bajo el minimo" in proceso.stdout


# --- Alineacion de columnas ------------------------------------------------
# Los tests de conteo de filas no ven un desplazamiento de una columna: la
# fila sigue teniendo el mismo numero de lineas y los valores siguen en la
# salida. Estos tests miran que valor cae bajo que encabezado.


@pytest.mark.parametrize("nombre", TABLAS)
def test_la_primera_fila_tiene_una_celda_por_encabezado(conexion, nombre: str) -> None:
    """Cada valor del SELECT cae bajo un encabezado: ni sobra ni falta celda.

    Ojo: contar celdas no ve un desplazamiento (con el bug el valor de mas se
    perdia y el conteo daba igual); lo que si ve es un encabezado sin valor.
    El corrimiento lo cazan los tests de forma de dato y de valor exacto.
    """
    salida = consulta(nombre, conexion)
    _, lineas_fila = bloque(salida)
    encabezados, filas = tabla(salida)
    assert lineas_fila, f"{nombre} no devolvio filas"
    assert len(celdas_crudas(lineas_fila[0])) == len(encabezados)
    assert all(filas[0][columna] for columna in encabezados), filas[0]


@pytest.mark.parametrize("nombre", TABLAS)
def test_cada_columna_tiene_la_forma_de_su_dato(conexion, nombre: str) -> None:
    """Si una fila se corre, el valor deja de parecerse a lo de su columna."""
    encabezados, filas = tabla(consulta(nombre, conexion))
    assert filas, nombre
    for fila in filas:
        for columna, dominio in DOMINIO_COLUMNAS.items():
            if columna not in encabezados:
                continue
            assert re.fullmatch(
                dominio, fila[columna]
            ), f"{nombre}: '{columna}' recibio {fila[columna]!r} en la fila {fila}"


@pytest.mark.parametrize("nombre", TABLAS)
def test_categoria_va_entre_producto_y_lote(conexion, nombre: str) -> None:
    """formatear alinea por posicion, asi que el orden tambien es contrato."""
    encabezados, _ = tabla(consulta(nombre, conexion))
    assert "Categoria" in encabezados, f"{nombre} no declara la columna Categoria"
    assert encabezados.index("Categoria") == encabezados.index("Producto") + 1
    assert encabezados.index("Lote") == encabezados.index("Categoria") + 1


@pytest.mark.parametrize("nombre", TABLAS)
def test_la_columna_proveedor_no_recibe_un_estado_de_inventario(conexion, nombre: str) -> None:
    """Con el bug, el estado del lote caia bajo 'Proveedor' y el PRV se perdia."""
    encabezados, filas = tabla(consulta(nombre, conexion))
    assert "Proveedor" in encabezados
    assert filas, nombre
    for fila in filas:
        assert fila["Proveedor"] not in ESTADOS_INVENTARIO, fila
        assert re.fullmatch(r"PRV-\d{3}", fila["Proveedor"]), fila


def test_vencidos_deja_cada_valor_bajo_su_encabezado(conexion) -> None:
    """MIS-0041 verificado con corte 2026-09-04, la fila mas vencida."""
    fila = fila_de(vencidos(conexion, CORTE, None), "MIS-0041")
    assert fila == {
        "Codigo": "MIS-0041",
        "Producto": "Cepillo de ropa Práctika Mini",
        "Categoria": "Miscelánea",
        "Lote": "LT-2401144",
        "Ubicacion": "B-01-01",
        "Stock": "145",
        "Vence": "2025-03-23",
        "Dias": "530",
        "Estado": "VENCIDO",
        "Proveedor": "PRV-020",
    }


def test_por_vencer_deja_cada_valor_bajo_su_encabezado(conexion) -> None:
    """ABA-0249 verificado con corte 2026-09-04, vence en 3 dias."""
    fila = fila_de(por_vencer(conexion, CORTE, None), "ABA-0249")
    assert fila == {
        "Codigo": "ABA-0249",
        "Producto": "Jugo en caja Andes Reforzado",
        "Categoria": "Abarrotes",
        "Lote": "LT-2487491",
        "Stock": "84",
        "Vence": "2026-09-07",
        "Dias": "3",
        "Estado": "POR VENCER",
        "Proveedor": "PRV-049",
    }


def test_bajo_minimo_deja_cada_valor_bajo_su_encabezado(conexion) -> None:
    """ABA-0250 verificado con corte 2026-09-04, el que mas falta."""
    fila = fila_de(bajo_minimo(conexion, None), "ABA-0250")
    assert fila == {
        "Codigo": "ABA-0250",
        "Producto": "Jugo en caja Casa Real Especial",
        "Categoria": "Abarrotes",
        "Lote": "LT-2449372",
        "Ubicacion": "D-22-02",
        "Stock": "2",
        "Minimo": "26",
        "Falta": "24",
        "Estado": "VIGENTE",
        "Proveedor": "PRV-052",
    }


def test_formatear_avisa_si_la_fila_sobra_de_encabezados() -> None:
    """El bug de fondo: zip(celdas, anchos) se comia el valor sobrante."""
    with pytest.raises(ValueError) as error:
        formatear(["Codigo", "Lote"], [("ABA-0218", "LT-2449372", "Abarrotes")], "bajo-minimo")
    assert "bajo-minimo" in str(error.value)
    assert "3 valores" in str(error.value)
    assert "2 encabezados" in str(error.value)


def test_formatear_avisa_si_a_la_fila_le_faltan_valores() -> None:
    with pytest.raises(ValueError) as error:
        formatear(["Codigo", "Lote", "Stock"], [("ABA-0218", "LT-2449372")], "vencidos")
    assert "vencidos" in str(error.value)
    assert "2 valores" in str(error.value)
    assert "3 encabezados" in str(error.value)


def test_formatear_sigue_armando_la_tabla_cuando_el_conteo_calza() -> None:
    salida = formatear(["Codigo", "Lote"], [("ABA-0218", "LT-2449372")], "bajo-minimo")
    assert celdas_crudas(salida.splitlines()[0]) == ["Codigo", "Lote"]
    assert celdas_crudas(salida.splitlines()[2]) == ["ABA-0218", "LT-2449372"]
