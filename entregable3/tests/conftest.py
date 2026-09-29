"""Fixtures compartidas: el Excel real se importa una vez por sesion."""

from __future__ import annotations

import shutil
import sqlite3
from dataclasses import dataclass
from pathlib import Path

import pytest

from consultar import conectar
from importar_excel import convertir

RAIZ = Path(__file__).resolve().parents[1]
ORIGEN = RAIZ / "datos" / "original" / "operacion_comercial_app.xlsm"


@dataclass
class Importacion:
    base: Path
    conteos: dict[str, int]


@pytest.fixture(scope="session")
def origen() -> Path:
    assert ORIGEN.exists(), f"Falta el Excel de origen: {ORIGEN}"
    return ORIGEN


@pytest.fixture(scope="session")
def importacion(origen: Path, tmp_path_factory: pytest.TempPathFactory) -> Importacion:
    destino = tmp_path_factory.mktemp("datos") / "inventario.db"
    return Importacion(base=destino, conteos=convertir(origen, destino))


@pytest.fixture(scope="session")
def base(importacion: Importacion) -> Path:
    return importacion.base


@pytest.fixture(scope="session")
def conexion(base: Path):
    abierta = conectar(base)
    yield abierta
    abierta.close()


@pytest.fixture
def base_escribible(base: Path, tmp_path: Path) -> Path:
    """Copia aislada para los tests que necesitan romper datos a proposito."""
    copia = tmp_path / "inventario.db"
    shutil.copy(base, copia)
    return copia


@pytest.fixture
def conexion_escribible(base_escribible: Path):
    abierta = sqlite3.connect(base_escribible)
    abierta.row_factory = sqlite3.Row
    yield abierta
    abierta.close()
