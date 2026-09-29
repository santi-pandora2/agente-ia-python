"""El REPL de `src/app.py`: parser, corte de fechas y sesion que no se cae.

No se toca `pyproject.toml`: `src/` es un namespace package (no lleva
`__init__.py`) y la raiz del entregable se agrega aqui para poder importarlo.
`scripts` ya esta en el path por `pythonpath = ["scripts"]` de pytest, y el
propio `src/app.py` se lo agrega para funcionar con `python src/app.py`.
"""

from __future__ import annotations

import sqlite3
import subprocess
import sys
from datetime import date
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[1]
if str(RAIZ) not in sys.path:
    sys.path.insert(0, str(RAIZ))

from src import app  # noqa: E402

CORTE = date(2026, 9, 4)
PANADERIA = "Panadería"


def correr(capsys, base: Path, *lineas: str) -> tuple[str, int]:
    """Ejecuta el REPL con lineas inyectadas: no depende de stdin ni terminal."""
    codigo = app.main(entrada=list(lineas), base=base)
    return capsys.readouterr().out, codigo


def espias_de_fecha(monkeypatch) -> list[tuple[date, str | None]]:
    """Reemplaza las dos consultas de fechas y guarda con que fecha se llamaron."""
    llamadas: list[tuple[date, str | None]] = []

    def registrar(nombre):
        def consulta(conexion, hoy, categoria):
            llamadas.append((hoy, categoria))
            return f"salida de {nombre}"

        return consulta

    monkeypatch.setattr(app.consultar, "vencidos", registrar("vencidos"))
    monkeypatch.setattr(app.consultar, "por_vencer", registrar("por_vencer"))
    return llamadas


# --- Parser: la linea se interpreta sin levantar excepcion ------------------


@pytest.mark.parametrize(
    ("linea", "comando", "argumentos"),
    [
        ("bajo-minimo Ferretería", "bajo-minimo", ("Ferretería",)),
        ("producto ABA-0218", "producto", ("ABA-0218",)),
        ("vencidos", "vencidos", ()),
        ("por-vencer Papelería", "por-vencer", ("Papelería",)),
        ("hoy 2026-10-01", "hoy", ("2026-10-01",)),
        ("proveedor PRV-001", "proveedor", ("PRV-001",)),
        ("resumen", "resumen", ()),
        ("corte", "corte", ()),
        ("ayuda", "ayuda", ()),
        ("salir", "salir", ()),
        ("  producto   ABA-0218  ", "producto", ("ABA-0218",)),
        ('bajo-minimo "Abarrotes"', "bajo-minimo", ("Abarrotes",)),
    ],
)
def test_la_linea_se_parte_en_comando_y_argumentos(
    linea: str, comando: str, argumentos: tuple[str, ...]
) -> None:
    orden = app.interpretar(linea)
    assert orden is not None
    assert (orden.comando, orden.argumentos, orden.error) == (comando, argumentos, "")


@pytest.mark.parametrize("linea", ["", "   ", "\t"])
def test_la_linea_vacia_no_devuelve_orden(linea: str) -> None:
    assert app.interpretar(linea) is None


@pytest.mark.parametrize(
    ("linea", "esperado"),
    [
        ("bajo-minimo Ferretería Papelería", "Uso: bajo-minimo [categoria]"),
        ("producto ABA-0218 de más", "Uso: producto <codigo>"),
        ("resumen extra", "Uso: resumen"),
        ("producto", "Uso: producto <codigo>"),
        ("proveedor", "Uso: proveedor <id>"),
        ("hoy", "Uso: hoy <AAAA-MM-DD>"),
        ("corte 2026-09-04", "Uso: corte"),
    ],
)
def test_argumentos_de_mas_o_de_menos_dicen_el_uso(linea: str, esperado: str) -> None:
    orden = app.interpretar(linea)
    assert orden is not None
    assert orden.error == esperado or orden.error.startswith(f"{esperado} ")
    assert orden.comando == ""


def test_comando_desconocido_sugiere_ayuda() -> None:
    orden = app.interpretar("inventario")
    assert orden is not None
    assert "Comando desconocido: 'inventario'" in orden.error
    assert "ayuda" in orden.error


def test_comillas_sin_cerrar_dicen_algo() -> None:
    orden = app.interpretar('producto "ABA-0218')
    assert orden is not None
    assert "No se pudo interpretar la linea" in orden.error
    assert "comillas" in orden.error


def test_el_uso_cuenta_los_argumentos_de_mas() -> None:
    orden = app.interpretar("resumen uno dos")
    assert orden is not None
    assert orden.error == "Uso: resumen (recibiste 2 argumentos)."


# --- El corte por defecto es el del Excel, no la fecha de hoy ----------------


def test_el_repl_arranca_en_el_corte_del_excel(
    base: Path, monkeypatch, capsys
) -> None:
    """Aunque la fecha de hoy sea otra, el REPL cuenta al corte del Excel."""

    class FechaLejana(date):
        @classmethod
        def today(cls) -> date:
            return date(2030, 1, 1)

    monkeypatch.setattr(app, "date", FechaLejana)
    llamadas = espias_de_fecha(monkeypatch)

    salida, codigo = correr(capsys, base, "vencidos", "por-vencer", "salir")

    assert llamadas == [(CORTE, None), (CORTE, None)]
    assert "Corte: 2026-09-04." in salida
    assert "2030-01-01" not in salida
    assert codigo == 0


def test_hoy_cambia_la_fecha_que_se_pasa_a_las_consultas_de_fechas(
    base: Path, monkeypatch, capsys
) -> None:
    llamadas = espias_de_fecha(monkeypatch)

    salida, _ = correr(
        capsys, base, "vencidos", "hoy 2026-10-01", "vencidos Abarrotes", "corte", "salir"
    )

    assert llamadas == [
        (CORTE, None),
        (date(2026, 10, 1), "Abarrotes"),
    ]
    assert "Corte actual: 2026-10-01." in salida
    assert "Corte: 2026-10-01." in salida


def test_corte_muestra_el_corte_sin_cambiarlo(base: Path, monkeypatch, capsys) -> None:
    llamadas = espias_de_fecha(monkeypatch)

    salida, _ = correr(capsys, base, "corte", "salir")

    assert llamadas == []
    assert "Corte actual: 2026-09-04." in salida


def test_cada_consulta_de_fechas_anuncia_el_corte(base: Path, capsys) -> None:
    salida, _ = correr(capsys, base, "vencidos", "por-vencer", "salir")
    assert salida.count("Corte: 2026-09-04.") == 2


def test_los_estados_avisan_que_no_se_recalculan(base: Path, capsys) -> None:
    salida, _ = correr(capsys, base, "bajo-minimo", "salir")
    assert "columna 'estado'" in salida
    assert "corte 2026-09-04" in salida


# --- Una entrada mala no cierra la sesion -----------------------------------


def test_categoria_invalida_no_cierra_la_sesion(base: Path, capsys) -> None:
    salida, codigo = correr(capsys, base, "bajo-minimo Ferreteria", "corte", "salir")
    assert "Categoria desconocida: Ferreteria" in salida
    assert "Ferretería" in salida  # la lista de categorias validas
    assert "Corte actual: 2026-09-04." in salida  # la sesion sigue viva
    assert codigo == 0


def test_producto_inexistente_no_cierra_la_sesion(base: Path, capsys) -> None:
    salida, codigo = correr(capsys, base, "producto ZZZ-9999", "corte", "salir")
    assert "No existe el producto ZZZ-9999" in salida
    assert "Corte actual: 2026-09-04." in salida
    assert codigo == 0


def test_hoy_con_fecha_no_iso_no_cierra_la_sesion(base: Path, capsys) -> None:
    salida, codigo = correr(capsys, base, "hoy 25/09/2026", "corte", "salir")
    assert "Fecha invalida: '25/09/2026'." in salida
    assert "Uso: hoy <AAAA-MM-DD>" in salida
    assert "Corte actual: 2026-09-04." in salida  # el corte no se movio
    assert codigo == 0


def test_hoy_solo_acepta_el_formato_iso(base: Path, capsys) -> None:
    salida, _ = correr(capsys, base, "hoy 20261001", "corte", "salir")
    assert "Fecha invalida: '20261001'." in salida
    assert "Corte actual: 2026-09-04." in salida


def test_error_de_sqlite_no_cierra_la_sesion(base_escribible: Path, capsys) -> None:
    """Una consulta que revienta en la base avisa y la sesion sigue."""
    rompedora = sqlite3.connect(base_escribible)
    rompedora.execute("DROP TABLE inventario")
    rompedora.commit()
    rompedora.close()

    salida, codigo = correr(capsys, base_escribible, "resumen", "corte", "salir")

    assert "La consulta no se pudo ejecutar" in salida
    assert "no such table: inventario" in salida
    assert "Corte actual: 2026-09-04." in salida
    assert codigo == 0


def test_comando_desconocido_en_pista_no_cierra_la_sesion(base: Path, capsys) -> None:
    salida, codigo = correr(capsys, base, "inventario", "corte", "salir")
    assert "Comando desconocido: 'inventario'." in salida
    assert "Corte actual: 2026-09-04." in salida
    assert codigo == 0


def test_argumento_de_mas_en_pista_no_cierra_la_sesion(base: Path, capsys) -> None:
    salida, codigo = correr(capsys, base, "producto ABA-0218 y mas", "corte", "salir")
    assert "Uso: producto <codigo>" in salida
    assert "Corte actual: 2026-09-04." in salida
    assert codigo == 0


# --- Ciclo de la sesion ----------------------------------------------------


def test_la_linea_vacia_no_imprime_nada(base: Path, capsys) -> None:
    salida, codigo = correr(capsys, base, "", "   ", "salir")
    assert salida == f"{app.banner(base, CORTE)}\n{app.DESPEDIDA}\n"
    assert codigo == 0


def test_salir_cierra_y_no_ejecuta_lo_que_viene_despues(base: Path, capsys) -> None:
    salida, codigo = correr(capsys, base, "corte", "salir", "resumen")
    assert salida.endswith(f"{app.DESPEDIDA}\n")
    assert salida.count(app.DESPEDIDA) == 1
    assert "Conteos" not in salida  # el resumen de despues no se ejecuto
    assert codigo == 0


def test_al_agotarse_la_entrada_se_despide(base: Path, capsys) -> None:
    """Lo que pasa con Ctrl+D: fin de la entrada y goodbye limpio."""
    salida, codigo = correr(capsys, base, "corte")
    assert salida.endswith(f"{app.DESPEDIDA}\n")
    assert codigo == 0


def test_el_banner_anuncia_base_corte_y_comandos(base: Path, capsys) -> None:
    salida, _ = correr(capsys, base, "salir")
    assert "Asistente de inventario (solo lectura)" in salida
    assert f"Base: {base}" in salida
    assert "Corte: 2026-09-04 (el del Excel, no la fecha de hoy)" in salida
    for comando in app.COMANDOS:
        assert comando in salida


def test_ayuda_lista_todos_los_comandos(base: Path, capsys) -> None:
    salida, _ = correr(capsys, base, "ayuda", "salir")
    for nombre, comando in app.COMANDOS.items():
        assert comando.sintaxis in salida, nombre
    assert 'Ferretería' in salida  # la categoría va con tilde, como en la base


def test_la_salida_es_limpia_para_un_informe(base: Path, capsys) -> None:
    """Sin colores ANSI, sin emojis, sin banner de arte y sin traceback."""
    salida, _ = correr(
        capsys, base, "resumen", "producto ABA-0218", "ayuda", "salir"
    )
    assert "\x1b" not in salida
    assert "Traceback" not in salida
    assert all(caracter.isprintable() or caracter in "\n\t" for caracter in salida)
    assert max(len(linea) for linea in app.banner(base, CORTE).splitlines()) <= 78


# --- Extremo a extremo sobre la base real -----------------------------------


def test_ficha_de_producto_con_lote(base: Path, capsys) -> None:
    salida, codigo = correr(capsys, base, "producto ABA-0218", "salir")
    assert "LT-2430339" in salida
    assert "Abarrotes" in salida
    assert "POR VENCER" in salida
    assert codigo == 0


def test_producto_de_panaderia_avisa_que_no_se_lleva(base: Path, capsys) -> None:
    salida, codigo = correr(capsys, base, "producto PAN-0001", "salir")
    assert PANADERIA in salida
    assert "NO CONTROLADO" in salida
    assert "no se lleva en inventario" in salida
    # y no lo reporta como faltante, agotado ni sin inventario
    assert "Sin lotes inventariados" not in salida
    assert "Falta" not in salida
    assert "faltante" not in salida.lower()
    assert "agotado" not in salida.lower()
    assert "LT-" not in salida
    assert "VENCIDO" not in salida
    assert codigo == 0


def test_panaderia_no_aparece_como_bajo_el_minimo(base: Path, capsys) -> None:
    """Con corte del Excel no hay lotes de Panadería que reportar."""
    salida, _ = correr(capsys, base, "bajo-minimo Panadería", "vencidos", "salir")
    assert "Sin resultados." in salida
    assert PANADERIA not in salida.split("Corte: ")[1]


def test_tabla_de_vencidos_avisa_el_corte(base: Path, capsys) -> None:
    salida, _ = correr(capsys, base, "vencidos", "salir")
    assert "(124 filas; 124 marcados VENCIDO en el Excel)" in salida
    assert "Corte: 2026-09-04." in salida


def test_proveedor_en_revision_avisa(base: Path, capsys) -> None:
    salida, _ = correr(capsys, base, "proveedor PRV-001", "salir")
    assert "En revisión" in salida
    assert "AVISO" in salida


# --- Arranque y modos de invocacion -----------------------------------------


def test_base_inexistente_explica_y_sale_con_error(tmp_path: Path, capsys) -> None:
    codigo = app.main(entrada=["resumen"], base=tmp_path / "no-existe.db")
    salida = capsys.readouterr().out
    assert codigo == 1
    assert "importar_excel.py" in salida
    assert "Traceback" not in salida
    assert "Conexion" not in salida  # no abrio nada


@pytest.mark.parametrize("modo", [["-m", "src.app"], ["src/app.py"]])
def test_los_dos_modos_de_invocacion_resuelven_el_modulo(modo: list[str]) -> None:
    """`python -m src.app` y `python src/app.py` llegan al mismo REPL.

    Con la base presente responde el REPL y se despide; si falta, avisa como
    regenerarla. Lo que no puede pasar en ninguno de los dos es un traceback.
    """
    proceso = subprocess.run(
        [sys.executable, *modo],
        cwd=RAIZ,
        input="salir\n",
        capture_output=True,
        text=True,
        timeout=60,
    )
    salida = proceso.stdout + proceso.stderr
    assert "Traceback" not in salida
    assert "No module named" not in salida
    assert "inventario" in salida
    assert proceso.returncode in (0, 1)
