"""REPL de solo lectura del asistente de inventario.

Envoltura delgada de `scripts/consultar.py`: no abre la base por su cuenta, no
escribe SQL y no inventa datos. Todo lo que muestra sale de las consultas con
nombre que ya existen ahi.

    uv run python -m src.app
    uv run python src/app.py
"""

from __future__ import annotations

import shlex
import sqlite3
import sys
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from datetime import date
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
RUTA_SCRIPTS = RAIZ / "scripts"

if str(RUTA_SCRIPTS) not in sys.path:
    # `pythonpath = ["scripts"]` de pyproject.toml solo aplica a pytest: en
    # `python src/app.py` lo que esta en sys.path es src/, no la raiz del
    # entregable, y `import consultar` no encontraria nada.
    sys.path.insert(0, str(RUTA_SCRIPTS))

try:
    import consultar
except ImportError as error:  # pragma: no cover - solo si falta scripts/consultar.py
    raise SystemExit(
        f"No se encontro {RUTA_SCRIPTS / 'consultar.py'} ({error})."
        " El REPL solo funciona dentro del entregable, junto a scripts/."
    ) from None

# El corte es el del Excel, no la fecha de hoy: los estados de inventario se
# leen tal como quedaron cargados y con esa fecha se cuentan los vencimientos.
CORTE_EXCEL = date(2026, 9, 4)
BASE_POR_DEFECTO = RAIZ / consultar.BASE_POR_DEFECTO
PROMPT = "inventario> "
DESPEDIDA = "Hasta luego. Sesion cerrada."

AVISO_ESTADOS = (
    "Los estados salen de la columna 'estado' de la base, con corte"
    " 2026-09-04 (el del Excel). El comando 'hoy' cambia la fecha con la que se"
    " cuentan los vencimientos, no esa columna."
)


@dataclass(frozen=True)
class Comando:
    sintaxis: str
    ayuda: str
    minimo: int
    maximo: int

    @property
    def uso(self) -> str:
        return f"Uso: {self.sintaxis}"


COMANDOS: dict[str, Comando] = {
    "resumen": Comando(
        "resumen", "Conteos, estados, categorias e indicadores", 0, 0
    ),
    "bajo-minimo": Comando(
        "bajo-minimo [categoria]", "Lotes con stock por debajo del minimo", 0, 1
    ),
    "vencidos": Comando(
        "vencidos [categoria]", "Lotes ya vencidos a la fecha de corte", 0, 1
    ),
    "por-vencer": Comando(
        "por-vencer [categoria]", "Lotes que vencen en los proximos 30 dias", 0, 1
    ),
    "producto": Comando(
        "producto <codigo>", "Ficha de un producto y sus lotes (ej. ABA-0218)", 1, 1
    ),
    "proveedor": Comando(
        "proveedor <id>", "Ficha de un proveedor (ej. PRV-001)", 1, 1
    ),
    "hoy": Comando(
        "hoy <AAAA-MM-DD>", "Cambia la fecha de corte de esta sesion", 1, 1
    ),
    "corte": Comando("corte", "Muestra la fecha de corte actual", 0, 0),
    "ayuda": Comando("ayuda", "Muestra esta lista de comandos", 0, 0),
    "salir": Comando("salir", "Cierra la sesion", 0, 0),
}


@dataclass(frozen=True)
class Orden:
    """Una linea ya interpretada. `error` lleva el mensaje si no se pudo leer."""

    comando: str
    argumentos: tuple[str, ...] = ()
    error: str = ""


@dataclass
class Sesion:
    """Estado de la conversacion: la conexion y el corte vigente."""

    conexion: sqlite3.Connection
    corte: date = CORTE_EXCEL


@dataclass(frozen=True)
class Respuesta:
    texto: str
    terminar: bool = False


def interpretar(linea: str) -> Orden | None:
    """Parte una linea en comando y argumentos. None si la linea esta vacia.

    Nunca levanta: un argumento de mas, un comando desconocido o comillas sin
    cerrar vuelven como `Orden.error`, no como excepcion.
    """
    try:
        partes = shlex.split(linea)
    except ValueError as error:  # comillas sin cerrar
        return Orden("", (), f"No se pudo interpretar la linea ({error}). Revisa las comillas.")
    if not partes:
        return None
    nombre, *argumentos = partes
    especificacion = COMANDOS.get(nombre)
    if especificacion is None:
        return Orden(
            "", (), f"Comando desconocido: '{nombre}'. Escribe 'ayuda' para ver la lista."
        )
    if not especificacion.minimo <= len(argumentos) <= especificacion.maximo:
        return Orden(
            "",
            (),
            f"{especificacion.uso} (recibiste {len(argumentos)} argumento"
            f"{'' if len(argumentos) == 1 else 's'}).",
        )
    return Orden(nombre, tuple(argumentos))


def _leer_fecha(texto: str) -> date:
    """Solo AAAA-MM-DD: `date.fromisoformat` tambien acepta la forma AAAAmmdd."""
    fecha = date.fromisoformat(texto)
    if fecha.isoformat() != texto:
        raise ValueError(texto)
    return fecha


def _con_corte(corte: date, cuerpo: str) -> str:
    """Antepone el corte con el que se conto, para que la cifra se lea sola."""
    return f"Corte: {corte.isoformat()}.\n{cuerpo}"


def _despachar(sesion: Sesion, orden: Orden) -> Respuesta:
    conexion, corte = sesion.conexion, sesion.corte
    categoria = orden.argumentos[0] if orden.argumentos else None

    if orden.comando == "resumen":
        return Respuesta(f"{consultar.resumen(conexion)}\n\n{AVISO_ESTADOS}")
    if orden.comando == "bajo-minimo":
        return Respuesta(f"{consultar.bajo_minimo(conexion, categoria)}\n\n{AVISO_ESTADOS}")
    if orden.comando == "vencidos":
        return Respuesta(_con_corte(corte, consultar.vencidos(conexion, corte, categoria)))
    if orden.comando == "por-vencer":
        return Respuesta(
            _con_corte(corte, consultar.por_vencer(conexion, corte, categoria))
        )
    if orden.comando == "producto":
        return Respuesta(consultar.producto(conexion, orden.argumentos[0]))
    if orden.comando == "proveedor":
        return Respuesta(consultar.proveedor(conexion, orden.argumentos[0]))
    if orden.comando == "hoy":
        try:
            nuevo = _leer_fecha(orden.argumentos[0])
        except ValueError:
            return Respuesta(
                f"Fecha invalida: '{orden.argumentos[0]}'."
                f" {COMANDOS['hoy'].uso} (por ejemplo: hoy 2026-10-01)."
            )
        sesion.corte = nuevo
        return Respuesta(f"Corte cambiado a {nuevo.isoformat()}.\n\n{AVISO_ESTADOS}")
    if orden.comando == "corte":
        return Respuesta(f"Corte actual: {corte.isoformat()}.\n\n{AVISO_ESTADOS}")
    if orden.comando == "ayuda":
        return Respuesta(ayuda())
    if orden.comando == "salir":
        return Respuesta(DESPEDIDA, terminar=True)
    raise AssertionError(f"comando sin despachar: {orden.comando!r}")


def ejecutar(sesion: Sesion, orden: Orden) -> Respuesta:
    """Ejecuta una orden ya interpretada y devuelve lo que hay que imprimir.

    Una entrada mala no tumba la sesion: `validar_categoria` aborta con
    `SystemExit` listando las categorias validas, y ahi lo unico que se levanta
    es eso, asi que se muestra y se sigue.
    """
    if orden.error:
        return Respuesta(orden.error)
    try:
        return _despachar(sesion, orden)
    except SystemExit as error:
        return Respuesta(str(error))
    except sqlite3.Error as error:
        return Respuesta(f"La consulta no se pudo ejecutar: {error}")
    except ValueError as error:  # formatear: una consulta trae mas datos que columnas
        return Respuesta(f"La consulta fallo y no se pudo imprimir el resultado: {error}")


def ayuda() -> str:
    """Lista de comandos, armada desde COMANDOS para que no se desincronice."""
    ancho = max(len(comando.sintaxis) for comando in COMANDOS.values())
    cuerpo = "\n".join(
        f"  {comando.sintaxis.ljust(ancho)}  {comando.ayuda}"
        for comando in COMANDOS.values()
    )
    return (
        f"Comandos:\n{cuerpo}\n\n"
        'Los nombres de categoria van tal como estan en la base, con tilde:'
        ' bajo-minimo "Ferretería".\n'
        "Sin argumentos opcionales, el comando trae todas las categorias.\n"
        "Ctrl+C o Ctrl+D tambien cierran la sesion. No se escribe nada: todas"
        " las consultas son de solo lectura."
    )


def banner(base: Path, corte: date) -> str:
    """Cabecera de arranque: que base, con que corte y que se puede escribir."""
    return "\n".join(
        [
            "Asistente de inventario (solo lectura)",
            f"Base: {base}",
            f"Corte: {corte.isoformat()} (el del Excel, no la fecha de hoy)",
            "",
            "Comandos: resumen, bajo-minimo [categoria], vencidos [categoria],",
            "          por-vencer [categoria], producto <codigo>, proveedor <id>,",
            "          hoy <AAAA-MM-DD>, corte, ayuda, salir",
            "Escribe 'ayuda' para verlos con detalle y 'salir' para cerrar.",
        ]
    )


def _lineas(entrada: Iterable[str] | None) -> Iterator[str]:
    """Origen de las lineas: las inyectadas por el llamador o las de input()."""
    if entrada is not None:
        yield from entrada
        return
    while True:
        try:
            yield input(PROMPT)
        except (EOFError, KeyboardInterrupt):
            print()  # el prompt interrumpido deja el cursor a media linea
            return


def main(entrada: Iterable[str] | None = None, base: Path | None = None) -> int:
    """Abre la base, corre el REPL y devuelve el codigo de salida.

    `entrada` existe para los tests: si es None se lee de input(), asi la
    salida se puede comprobar con capsys sin depender de un terminal.
    """
    ruta = Path(base) if base is not None else BASE_POR_DEFECTO
    try:
        conexion = consultar.conectar(ruta)
    except SystemExit as error:  # conectar ya explica como regenerar la base
        print(error)
        return 1
    except sqlite3.Error as error:
        print(f"No se pudo abrir {ruta}: {error}")
        return 1

    sesion = Sesion(conexion)
    try:
        print(banner(ruta, sesion.corte))
        for linea in _lineas(entrada):
            orden = interpretar(linea)
            if orden is None:  # linea vacia: no hace nada y no imprime nada
                continue
            try:
                respuesta = ejecutar(sesion, orden)
            except KeyboardInterrupt:
                print("\nInterrumpido.")
                print(DESPEDIDA)
                return 0
            if respuesta.texto:
                print(respuesta.texto)
            if respuesta.terminar:
                return 0
        print(DESPEDIDA)  # se agoto la entrada: Ctrl+D o entrada inyectada
        return 0
    finally:
        conexion.close()


if __name__ == "__main__":
    raise SystemExit(main())
