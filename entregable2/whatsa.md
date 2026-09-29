# Skill: Normalización y Procesamiento de Pedidos de WhatsApp a Excel

## 📋 Descripción General
Esta skill permite procesar, limpiar y normalizar un conjunto de datos desestructurados provenientes de conversaciones de WhatsApp (formato JSON)[cite: 1] hacia un formato tabular relacional estructurado en Excel. Su objetivo es evitar la duplicidad de registros, asegurar la integridad de las órdenes, aplicar formato de mayúscula inicial y cumplir con las Tres Formas Normales (1NF, 2NF, 3NF).

---

## 🔍 1. Reglas de Limpieza y Transformación Previa

### A. Mayúscula Inicial (`INITCAP`)
* Todos los campos de texto descriptivo (Nombres de clientes, Ciudades, Barrios, Nombres de productos y Estados) deben transformarse para que la primera letra de cada palabra esté en mayúscula y el resto en minúscula.
  * *Ejemplo:* `ana gómez` ➡️ `Ana Gómez`[cite: 1]
  * *Ejemplo:* `barrio palermo` ➡️ `Barrio Palermo`[cite: 1]

### B. Validación de Órdenes Duplicadas
* **Identificador Único de Orden:** Se extrae el código del ticket/punto de entrega mencionado en el chat (ej. `HOG-0001`)[cite: 1].
* **Control de Duplicidad:** El sistema debe verificar la lista de órdenes existentes. Si un `conversation_id` o `ticket_id` ya fue registrado, la fila se descarta o se marca como duplicada para evitar que el mismo pedido aparezca dos veces en el Excel final.

---

## 📐 2. Estructura de Normalización de Datos

Para garantizar la consistencia y evitar redundancias, el modelo de datos se divide en tablas normalizadas:

### ⚡ Primera Forma Normal (1NF) - Valores Atómicos
* **Objetivo:** Eliminar grupos repetitivos y asegurar que cada celda contenga un único valor. Los mensajes de WhatsApp donde los clientes solicitan múltiples productos en una sola frase se descomponen en líneas de detalle independientes.
* **Estructura Tabular Provisional (1NF):**
  * `ID_Conversacion`, `Telefono`, `Nombre_Cliente`, `Ciudad`, `Barrio`, `Fecha_Hora`, `Producto_Solicitado`, `Cantidad`, `Subtotal_Item`, `Total_Orden`, `Estado_Pedido`.

### 🔄 Segunda Forma Normal (2NF) - Dependencia Funcional Completa
* **Objetivo:** Estar en 1NF y eliminar dependencias parciales separando los datos en entidades independientes mediante claves primarias.
* **Tablas Resultantes en 2NF:**
  1. **Tabla `Clientes`:**
     * `ID_Cliente` (PK - Llave Primaria)
     * `Telefono`
     * `Nombre_Cliente`
  2. **Tabla `Pedidos`:**
     * `ID_Pedido` (PK, ej. `HOG-0001` con validación de unicidad)[cite: 1]
     * `ID_Cliente` (FK - Llave Foránea)
     * `Ciudad`
     * `Barrio`
     * `Fecha`
     * `Total_Pedido`
     * `Estado`
  3. **Tabla `Detalle_Pedido`:**
     * `ID_Detalle` (PK)
     * `ID_Pedido` (FK)
     * `Nombre_Producto`
     * `Cantidad`
     * `Precio_Unitario`

### 🔗 Tercera Forma Normal (3NF) - Ausencia de Dependencias Transitivas
* **Objetivo:** Estar en 2NF y eliminar cualquier dependencia entre atributos que no sean clave. Las ubicaciones y los costos de envío asociados se aíslan para evitar redundancia de datos geográficos.
* **Tablas Finales (3NF) para el Excel:**
  * **`Dim_Clientes`**: `ID_Cliente`, `Telefono`, `Nombre_Cliente` (Mayúscula inicial aplicada).
  * **`Dim_Ubicaciones`**: `ID_Ubicacion`, `Ciudad`, `Barrio`, `Costo_Domicilio_Base`.
  * **`Fact_Pedidos`**: `ID_Pedido` (Validado contra duplicados), `ID_Cliente`, `ID_Ubicacion`, `Fecha_Hora`, `Metodo_Pago`, `Total`.
  * **`Fact_Detalle_Pedidos`**: `ID_Linea`, `ID_Pedido`, `SKU_Producto`, `Descripcion_Producto`, `Cantidad`.

---

## ⚙️ 3. Algoritmo de Validación en la Generación del Excel

1. **Ingesta:** Cargar el archivo JSON de origen[cite: 1].
2. **Filtrado de Mensajes Válidos:** Procesar únicamente los mensajes donde se confirma la transacción (ej. "Pedido confirmado" o equivalentes en el flujo del chat)[cite: 1].
3. **Validación de Unicidad:** 
   ```python
   if id_pedido in set_ordenes_procesadas:
       marcar_como_duplicado_y_descartar()
   else:
       set_ordenes_procesadas.add(id_pedido)
   ```
4. **Normalización de Texto:** Aplicar `INITCAP` a `Nombre_Cliente`, `Ciudad`, `Barrio`, `Descripcion_Producto` y `Estado`.
5. **Descomposición a 3FN:** Separar los datos en `Dim_Clientes`, `Dim_Ubicaciones`, `Fact_Pedidos` y `Fact_Detalle_Pedidos` según el modelo del §2.
6. **Escritura del Excel:** Volcar las 4 tablas normalizadas más las hojas de agregado (`Ingresos por ciudad`, `Metodos de pago`) que alimentan los gráficos del tablero.
7. **Cierre:** Liberar el workbook y registrar en consola el conteo final de filas aceptadas y descartadas.

---

## 🧩 4. Preguntas de Negocio Respondidas desde el Tablero

Las 3 preguntas se calculan **sobre las tablas 3NF ya depuradas** (`pedidos whatsapp colombia.xlsx`), que son la misma fuente de datos que consume `dashboard-pedidos.html`. Cada pregunta tiene una función Python dedicada en el §5.

### ❓ Pregunta 1 — ¿Cuál es el promedio SIN pedido vs. pedidos totales?

**Respuesta corta:** el ticket promedio de un pedido real es **$263.152**, mientras que una conversación **sin pedido vale $0**. La brecha es del **100 %**.

| Métrica | Sin pedido | Pedidos totales |
|---|---:|---:|
| Conversaciones | 49 | 151 |
| Ingresos | $0 | $39.736.000 |
| **Ticket promedio** | **$0** | **$263.152** |

| Indicador derivado | Valor |
|---|---:|
| Conversaciones totales | 200 |
| Tasa de conversión (pedidos ÷ conversaciones) | 75,5 % |
| Pedidos por cada conversación sin pedido | 3,08 : 1 |
| **Brecha de ticket promedio** | **$263.152 (100 %)** |

**Interpretación:** el 24,5 % del tráfico (49 de 200 conversaciones) se pierde antes de facturar. No es un problema de precio sino de seguimiento: cada una de esas 49 conversaciones abandonada equivale a un pedido no cerrado. Recuperar la mitad del embudo añadiría **≈ 24 pedidos y $6,3 millones** en ingresos.

---

### ❓ Pregunta 2 — ¿Cuál es el producto más vendido?

**Respuesta corta:** **`Cobija Térmica Doble Gris`** (`SKU-011`) con **46 unidades**.

| Puesto | Producto | Unidades | Ingresos | Participación |
|---:|---|---:|---:|---:|
| 🥇 1 | **Cobija Térmica Doble Gris** | **46** | $4.094.000 | 7,6 % |
| 🥈 2 | Protector de Colchón Doble | 45 | $2.520.000 | 7,4 % |
| 🥉 3 | Cortina Blackout 140x220 Gris | 39 | $4.485.000 | 6,4 % |

- Catálogo analizado: **24 referencias** · **605 unidades** vendidas en total.
- **Alerta de calidad de dato:** el margen entre el #1 y el #2 es de **1 sola unidad** (46 vs. 45), y la participación del líder es de apenas **7,6 %**. Con esa diferencia la posición #1 **no es estadísticamente concluyente**; conviene reportarla como "cabeza de catálogo", no como el producto-star.
- **Más vendido ≠ más rentable:** por unidades gana la *Cobija*, pero por facturación la *Cortina Blackout* la supera ($4.485.000 vs. $4.094.000). El módulo expone ambos criterios en `unidades` y `es_venta_por_facturacion`; la decisión de inventario debe usar facturación, no unidades.

**Interpretación:** el top 3 agrupa textiles de cama (cobijas, cortinas, almohadas, sábanas, protectores). Concentrar ahí el inventario y la pauta publicitaria maximiza el retorno por peso volumétrico, que es el factor de costo dominante en la logística de hogar.

---

### ❓ Pregunta 3 — ¿Cuál es el método de pago más usado?

**Respuesta corta:** **hay empate en volumen** entre **Nequi, Daviplata y Pago Contraentrega** con **35 pedidos cada uno** (23,18 %). Si se desempata por recaudo, el ganador es **Transferencia Bancaria** con **$9.998.000** (25,2 % del recaudo).

| Método de pago | Pedidos | Participación | Ingresos | Ticket promedio |
|---|---:|---:|---:|---:|
| Daviplata | 35 | 23,18 % | $9.069.000 | $259.114 |
| Nequi | 35 | 23,18 % | $7.990.000 | $228.286 |
| Pago Contraentrega | 35 | 23,18 % | $9.432.000 | $269.486 |
| Transferencia Bancaria | 34 | 22,52 % | **$9.998.000** | **$294.059** |
| ⚠️ Sin definir | 12 | 7,95 % | $3.247.000 | $270.583 |

**Interpretación y calidad de dato:**
- **Empate real, no error:** 3 métodos con la misma frecuencia. El módulo **no** elige un ganador arbitrariamente: reporta `empate_en_uso = True` y desempata por ingresos, que es el criterio de negocio correcto.
- **La distribución es casi uniforme (4 métodos ≈ 23 % cada uno).** Es un patrón propio de un dataset sintético: no refleja preferencia real del consumidor, así que **no se debe concluir que "a los colombianos les gusta Daviplata"**.
- **`Sin definir` (12 pedidos, 7,95 %) es un dato faltante**, no una categoría de pago. Tiene $3.247.000 de recaudo sin clasificar y **debe excluirse del ranking** antes de decidir sobre pasarelas de pago.
- Acción recomendada: capturar el método de pago en el 100 % de los pedidos nuevos para eliminar la categoría fantasma.

---

## 🐍 5. Compendio Python de Activación (`modulo_activacion.py`)

Este módulo es la **activación ejecutable** de la skill: lee el Excel 3NF y produce los tres indicadores del §4 que ya consume el tablero HTML.

### 5.1 Contrato del módulo

| Tipo | Elemento | Descripción |
|---|---|---|
| **ENTRADA** | `ruta_excel: str` | Ruta al `.xlsx` normalizado. |
| **ENTRADA** | `fact_pedidos: list[dict]` | Hoja `fact_pedidos` → 151 filas. |
| **ENTRADA** | `fact_detalle_pedidos: list[dict]` | Hoja `fact_detalle_pedidos` → 302 líneas. |
| **ENTRADA** | `conversaciones: list[dict]` | Hoja `conversaciones` (1NF) → 351 filas. |
| **ENTRADA** | `columnas_requeridas: list[str]` | Contrato de columnas por tabla (validación 3NF). |
| **SALIDA** | `activar_preguntas() -> TableroPedidos` | Dataclass con `.pregunta_1_ticket`, `.pregunta_2_producto`, `.pregunta_3_pago`, `.resumen_tablero`. |
| **SALIDA** | `imprimir_tablero(tablero)` | Reporte legible por consola (salida secundaria). |
| **EXCEPCIÓN** | `ArchivoExcelNoEncontrado` | La ruta del `.xlsx` no existe. |
| **EXCEPCIÓN** | `HojaNormalizadaAusente` | Falta una hoja 3NF en el workbook. |
| **EXCEPCIÓN** | `ColumnaFaltante` | Violación del contrato de columnas o tabla vacía. |
| **EXCEPCIÓN** | `DatoNoNumerico` | `Total` / `Cantidad` / `Subtotal` no casteable a número. |
| **EXCEPCIÓN** | `DivisorCero` | Promedio o porcentaje sobre 0 registros. |
| **CIERRE** | `main()` + `finally: wb.close()` | Carga entradas → activa → imprime → libera el recurso. |

Todas las excepciones heredan de `ErrorActivacion`, de modo que el llamador puede capturarlas en un único `except ErrorActivacion`.

### 5.2 Código fuente

```python
"""
MODULO_ACTIVACION — Preguntas de Negocio del Tablero de Pedidos (Hogar Colombia)
================================================================================
Activación ejecutable de la skill "Normalización y Procesamiento de Pedidos de
WhatsApp a Excel". Lee el Excel ya normalizado en 3NF y produce los tres
indicadores que alimentan `dashboard-pedidos.html`.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import openpyxl

# --------------------------------------------------------------------------- #
# EXCEPCIONES
# --------------------------------------------------------------------------- #

class ErrorActivacion(Exception):
    """Raíz de la jerarquía: permite capturar todo el flujo con un solo except."""


class ArchivoExcelNoEncontrado(ErrorActivacion):
    """La ruta del libro de Excel no existe."""


class HojaNormalizadaAusente(ErrorActivacion):
    """El workbook no tiene una de las hojas 3NF requeridas."""


class ColumnaFaltante(ErrorActivacion):
    """Un registro no cumple el contrato de columnas de su tabla."""


class DatoNoNumerico(ErrorActivacion):
    """Un campo numérico llega vacío, nulo o con formato inválido."""


class DivisorCero(ErrorActivacion):
    """División entre cero al calcular un promedio o un porcentaje."""


# --------------------------------------------------------------------------- #
# CONTRATO DE COLUMNAS (1NF -> 3NF)
# --------------------------------------------------------------------------- #

CONTRATO: dict[str, set[str]] = {
    "fact_pedidos": {"ID_Pedido", "Ciudad", "Metodo_Pago", "Total", "Estado"},
    "fact_detalle_pedidos": {"ID_Pedido", "Descripcion_Producto", "Cantidad"},
    "conversaciones": {"ID_Conversacion", "Total_Orden", "Estado_Pedido"},
}

SIN_METODO = "Sin definir"   # etiqueta para `Metodo_Pago` nulo (12 pedidos)


# --------------------------------------------------------------------------- #
# SALIDA ESTRUCTURADA
# --------------------------------------------------------------------------- #

@dataclass
class TableroPedidos:
    pregunta_1_ticket: dict[str, Any] = field(default_factory=dict)
    pregunta_2_producto: dict[str, Any] = field(default_factory=dict)
    pregunta_3_pago: dict[str, Any] = field(default_factory=dict)
    resumen_tablero: dict[str, Any] = field(default_factory=dict)


# --------------------------------------------------------------------------- #
# UTILIDADES DE LECTURA Y VALIDACIÓN
# --------------------------------------------------------------------------- #

def _leer_hoja(wb, nombre: str) -> list[dict]:
    """Convierte una hoja del workbook en lista de diccionarios (1NF plana)."""
    if nombre not in wb.sheetnames:
        raise HojaNormalizadaAusente(
            f"Falta la hoja '{nombre}'. Hojas disponibles: {wb.sheetnames}"
        )
    filas = wb[nombre].iter_rows(values_only=True)
    try:
        encabezado = next(filas)
    except StopIteration:
        raise ColumnaFaltante(f"La hoja '{nombre}' está vacía.") from None
    return [dict(zip(encabezado, f)) for f in filas if f and f[0] is not None]


def _validar_columnas(nombre_tabla: str, registros: list[dict]) -> None:
    """Verifica el contrato 3NF antes de calcular cualquier indicador."""
    if not registros:
        raise ColumnaFaltante(f"La tabla '{nombre_tabla}' no tiene registros.")
    for columna in CONTRATO[nombre_tabla]:
        if columna not in registros[0]:
            raise ColumnaFaltante(
                f"Columna '{columna}' ausente en '{nombre_tabla}'. "
                f"Columnas leídas: {list(registros[0])}"
            )


def _a_numero(valor: Any, campo: str, id_registro: Any) -> float:
    """Casteo defensivo: todo importe o cantidad debe ser numérico."""
    if valor is None or valor == "":
        return 0.0
    try:
        return float(valor)
    except (TypeError, ValueError):
        raise DatoNoNumerico(
            f"'{campo}'={valor!r} en el registro {id_registro} no es numérico."
        ) from None


def _a_texto(valor: Any, defecto: str = SIN_METODO) -> str:
    """Normaliza a texto limpio; los nulos caen en la categoría por defecto."""
    if valor is None:
        return defecto
    texto = str(valor).strip()
    return texto if texto else defecto


def _promedio(total: float, cantidad: int, contexto: str) -> float:
    """Promedio protegido: nunca divide entre cero."""
    if cantidad == 0:
        raise DivisorCero(f"No hay registros para calcular el promedio de {contexto}.")
    return total / cantidad


def _porcentaje(parte: float, total: float) -> float:
    if total == 0:
        raise DivisorCero("No se puede calcular un porcentaje sobre un total de 0.")
    return round(parte / total * 100, 2)


# --------------------------------------------------------------------------- #
# PREGUNTA 1 — Ticket promedio SIN pedido vs. pedidos totales
# --------------------------------------------------------------------------- #

def pre_1_ticket_promedio(
    fact_pedidos: list[dict], conversaciones: list[dict]
) -> dict[str, Any]:
    """
    Compara el ticket promedio de las conversaciones SIN pedido contra el ticket
    promedio de los pedidos totales facturados.

    Una conversacion marcada `Sin Pedido` nunca llega a `fact_pedidos`: por diseno
    del modelo 3NF su `Total_Orden` es 0, asi que su promedio es $0 y la brecha
    contra el ticket promedio de los pedidos reales es del 100 %.
    """
    # --- cohorte A: conversaciones sin pedido (solo existe en la tabla 1NF) ---
    sin_pedido = [c for c in conversaciones
                  if _a_texto(c["Estado_Pedido"]) == "Sin Pedido"]
    n_sin = len({c["ID_Conversacion"] for c in sin_pedido})
    ingresos_sin = sum(
        _a_numero(c["Total_Orden"], "Total_Orden", c["ID_Conversacion"])
        for c in sin_pedido
    )

    # --- cohorte B: pedidos totales (tabla de hechos 3NF) ---
    n_pedidos = len({p["ID_Pedido"] for p in fact_pedidos})
    ingresos_pedidos = sum(
        _a_numero(p["Total"], "Total", p["ID_Pedido"]) for p in fact_pedidos
    )

    if n_pedidos == 0:
        raise DivisorCero("`fact_pedidos` esta vacia: no hay pedidos para promediar.")

    ticket_pedidos = _promedio(ingresos_pedidos, n_pedidos, "pedidos totales")
    ticket_sin = ingresos_sin / n_sin if n_sin else 0.0   # cohorte vacia => $0
    conversaciones_totales = n_pedidos + n_sin

    return {
        "pregunta": "¿Cuál es el promedio SIN pedido vs. pedidos totales?",
        "ticket_promedio_pedidos": round(ticket_pedidos),
        "ticket_promedio_sin_pedido": round(ticket_sin),
        "brecha_absoluta": round(ticket_pedidos - ticket_sin),
        "brecha_porcentual": _porcentaje(ticket_pedidos - ticket_sin, ticket_pedidos),
        "pedidos_totales": n_pedidos,
        "conversaciones_sin_pedido": n_sin,
        "conversaciones_totales": conversaciones_totales,
        "tasa_conversion_pct": _porcentaje(n_pedidos, conversaciones_totales),
        "relacion_pedidos_por_sin_pedido": round(n_pedidos / n_sin, 2) if n_sin else 0.0,
        "ingresos_pedidos": round(ingresos_pedidos),
        "ingresos_sin_pedido": round(ingresos_sin),
        "lectura": (
            f"Por cada pedido facturado hay "
            f"{n_sin / n_pedidos:.2f} conversaciones sin pedido. "
            f"Cerrar ese embudo vale ${round(ticket_pedidos):,} de ticket promedio."
        ),
    }


# --------------------------------------------------------------------------- #
# PREGUNTA 2 — Producto más vendido
# --------------------------------------------------------------------------- #

def pre_2_producto_mas_vendido(fact_detalle_pedidos: list[dict]) -> dict[str, Any]:
    """
    Rankea el catalogo por unidades vendidas desde `fact_detalle_pedidos`.
    El desempate se resuelve por ingresos (Precio_Unitario x Cantidad) y, si
    persistiera, por orden alfabetico para que el resultado sea determinista.
    """
    unidades: Counter[str] = Counter()
    ingresos: defaultdict[str, float] = defaultdict(float)
    skus: dict[str, str] = {}

    for d in fact_detalle_pedidos:
        nombre = _a_texto(d["Descripcion_Producto"], defecto="(sin nombre)")
        cant = _a_numero(d["Cantidad"], "Cantidad", d.get("ID_Linea"))
        precio = _a_numero(d.get("Precio_Unitario"), "Precio_Unitario",
                           d.get("ID_Linea"))
        unidades[nombre] += int(cant)
        ingresos[nombre] += cant * precio
        skus.setdefault(nombre, _a_texto(d.get("SKU_Producto"), defecto="SIN-SKU"))

    if not unidades:
        raise ColumnaFaltante("`fact_detalle_pedidos` no tiene lineas de detalle.")

    total_unidades = sum(unidades.values())
    ranking = sorted(unidades.items(),
                     key=lambda kv: (-kv[1], -ingresos[kv[0]], kv[0]))
    top_nombre, top_cant = ranking[0]
    podium = [{"producto": n, "unidades": c, "ingresos": round(ingresos[n]),
               "participacion_pct": _porcentaje(c, total_unidades)}
              for n, c in ranking[:3]]

    # Mismo producto en otro color/talla -> el lider se puede rotar sin rotacion
    # de stock. Se agrupa por el nombre sin el ultimo token (el calificador).
    familia = " ".join(top_nombre.split()[:-1]).lower()
    variantes = sorted(u for u in unidades
                       if u != top_nombre
                       and " ".join(u.split()[:-1]).lower() == familia)

    return {
        "pregunta": "¿Cuál es el producto más vendido?",
        "producto_mas_vendido": top_nombre,
        "sku": skus.get(top_nombre),
        "unidades": top_cant,
        "unidades_totales_catalogo": total_unidades,
        "participacion_pct": _porcentaje(top_cant, total_unidades),
        "ingresos_del_producto": round(ingresos[top_nombre]),
        "catalogo_skus": len(unidades),
        "podium": podium,
        "variantes_del_lider": variantes,
        "tiene_variantes": bool(variantes),
        "es_venta_por_unidades": True,
        "es_venta_por_facturacion": ingresos[top_nombre] == max(ingresos.values()),
        "margen_sobre_segundo": (ranking[1][1] - top_cant) if len(ranking) > 1 else 0,
        "lectura": (
            f"'{top_nombre}' lidera con {top_cant} unidades "
            f"({_porcentaje(top_cant, total_unidades)}% de {total_unidades} unidades). "
            f"Debe ser el primero en el inventario y en la pauta publicitaria."
            + (f" Tiene {len(variantes)} variantes de color/talla para rotar stock."
               if variantes else "")
        ),
    }


# --------------------------------------------------------------------------- #
# PREGUNTA 3 — Método de pago más usado
# --------------------------------------------------------------------------- #

def pre_3_metodo_pago_mas_usado(fact_pedidos: list[dict]) -> dict[str, Any]:
    """
    Cruza volumen de pedidos e ingresos por metodo de pago.

    IMPORTANTE (calidad de dato): el metodo mas usado por TRANSACCIONES puede
    no ser el mas usado por INGRESOS, y varios metodos pueden empatar. Este
    modulo NO oculta el empate: reporta `empate_en_uso=True` y desempata por
    ingresos.
    """
    conteo: Counter[str] = Counter()
    ingresos: defaultdict[str, float] = defaultdict(float)
    sin_metodo = 0

    for p in fact_pedidos:
        metodo = _a_texto(p["Metodo_Pago"], defecto=SIN_METODO)
        conteo[metodo] += 1
        ingresos[metodo] += _a_numero(p["Total"], "Total", p["ID_Pedido"])
        if metodo == SIN_METODO:
            sin_metodo += 1

    if not conteo:
        raise ColumnaFaltante("`fact_pedidos` esta vacia: no hay metodos de pago.")

    total_pedidos = sum(conteo.values())
    lider_uso = max(conteo.values())
    empatados = sorted(m for m, c in conteo.items() if c == lider_uso)
    mayor_ingreso = max(ingresos, key=lambda m: ingresos[m])

    ranking = sorted(conteo.items(),
                     key=lambda kv: (-kv[1], -ingresos[kv[0]], kv[0]))
    return {
        "pregunta": "¿Cuál es el método de pago más usado?",
        "metodo_mas_usado": empatados,
        "empate_en_uso": len(empatados) > 1,
        "criterio_desempate": "Ingresos facturados por metodo "
                              "(pago mas usado = mayor recaudo)",
        "metodo_mas_ingresos": mayor_ingreso,
        "pedidos_por_metodo": dict(ranking),
        "ingresos_por_metodo": {m: round(ingresos[m]) for m, _ in ranking},
        "ticket_promedio_por_metodo": {
            m: round(ingresos[m] / conteo[m]) for m, _ in ranking
        },
        "participacion_pct_por_metodo": {
            m: _porcentaje(c, total_pedidos) for m, c in ranking
        },
        "pedidos_sin_metodo_definido": sin_metodo,
        "participacion_sin_definir_pct": _porcentaje(sin_metodo, total_pedidos),
        "es_distribucion_equitativa": (max(conteo.values())
                                       - min(v for k, v in conteo.items()
                                             if k != SIN_METODO)) <= 1,
        "lectura": (
            f"Por uso hay empate entre {', '.join(empatados)} con {lider_uso} "
            f"pedidos cada uno. Por recaudo manda '{mayor_ingreso}' con "
            f"${round(ingresos[mayor_ingreso]):,}. {sin_metodo} pedidos "
            f"({_porcentaje(sin_metodo, total_pedidos)}%) no tienen metodo "
            f"capturado: es un dato faltante, NO una categoria real de pago."
        ),
    }


# --------------------------------------------------------------------------- #
# ACTIVACIÓN — Orquesta las tres preguntas
# --------------------------------------------------------------------------- #

def _resumen_tablero(fact_pedidos: list[dict]) -> dict[str, Any]:
    """KPIs globales que el HTML ya consume: pedidos, estados, ingresos, ticket."""
    estados = Counter(_a_texto(p["Estado"]) for p in fact_pedidos)
    ingresos = sum(_a_numero(p["Total"], "Total", p["ID_Pedido"])
                   for p in fact_pedidos)
    n = len(fact_pedidos)
    return {
        "pedidos_total": n,
        "entregados": estados.get("Entregado", 0),
        "pendientes": estados.get("Pendiente", 0),
        "ingresos": round(ingresos),
        "ticket_promedio": round(_promedio(ingresos, n, "tablero")) if n else 0,
    }


def activar_preguntas(
    fact_pedidos: list[dict],
    fact_detalle_pedidos: list[dict],
    conversaciones: list[dict],
) -> TableroPedidos:
    """Punto de entrada unico: valida entradas y dispara los 3 indicadores."""
    for tabla, registros in (
        ("fact_pedidos", fact_pedidos),
        ("fact_detalle_pedidos", fact_detalle_pedidos),
        ("conversaciones", conversaciones),
    ):
        _validar_columnas(tabla, registros)

    return TableroPedidos(
        pregunta_1_ticket=pre_1_ticket_promedio(fact_pedidos, conversaciones),
        pregunta_2_producto=pre_2_producto_mas_vendido(fact_detalle_pedidos),
        pregunta_3_pago=pre_3_metodo_pago_mas_usado(fact_pedidos),
        resumen_tablero=_resumen_tablero(fact_pedidos),
    )


# --------------------------------------------------------------------------- #
# SALIDA legible por consola
# --------------------------------------------------------------------------- #

def _cop(moneda: int) -> str:
    return f"${moneda:,}".replace(",", ".")


def imprimir_tablero(tablero: TableroPedidos) -> None:
    """SALIDA secundaria: reporte por consola alineado al tablero HTML."""
    p1, p2, p3 = (tablero.pregunta_1_ticket, tablero.pregunta_2_producto,
                  tablero.pregunta_3_pago)
    r = tablero.resumen_tablero

    print("=" * 78)
    print("TABLERO DE PEDIDOS · HOGAR COLOMBIA — ACTIVACIÓN DE LA SKILL")
    print("=" * 78)
    print(f"Pedidos totales : {r['pedidos_total']}   "
          f"Entregados: {r['entregados']}   Pendientes: {r['pendientes']}")
    print(f"Ingresos        : {_cop(r['ingresos'])}   "
          f"Ticket promedio: {_cop(r['ticket_promedio'])}")

    print("-" * 78)
    print("P1 · Promedio SIN pedido vs pedidos totales")
    print(f"    Ticket promedio pedidos totales : {_cop(p1['ticket_promedio_pedidos'])}")
    print(f"    Ticket promedio sin pedido      : {_cop(p1['ticket_promedio_sin_pedido'])}")
    print(f"    Brecha                          : {_cop(p1['brecha_absoluta'])} "
          f"({p1['brecha_porcentual']}%)")
    print(f"    Cohortes                       : {p1['pedidos_totales']} pedidos / "
          f"{p1['conversaciones_sin_pedido']} sin pedido "
          f"({p1['tasa_conversion_pct']}% de conversion)")

    print("-" * 78)
    print("P2 · Producto más vendido")
    print(f"    {p2['producto_mas_vendido']} ({p2['sku']})")
    print(f"    Unidades: {p2['unidades']} de {p2['unidades_totales_catalogo']} "
          f"({p2['participacion_pct']}%)  ·  Ingresos: "
          f"{_cop(p2['ingresos_del_producto'])}")
    for pos, item in enumerate(p2["podium"], start=1):
        print(f"      {pos}. {item['producto']:<38} {item['unidades']:>4} u.")

    print("-" * 78)
    print("P3 · Método de pago más usado")
    print(f"    Empate en uso        : {', '.join(p3['metodo_mas_usado'])} "
          f"({p3['empate_en_uso']})")
    print(f"    Mayor recaudo        : {p3['metodo_mas_ingresos']}")
    for metodo, cant in p3["pedidos_por_metodo"].items():
        print(f"      {metodo:<24} {cant:>4} ped.  "
              f"{_cop(p3['ingresos_por_metodo'][metodo]):>13}  "
              f"{p3['participacion_pct_por_metodo'][metodo]:>5}%")
    print(f"    Sin metodo definido  : {p3['pedidos_sin_metodo_definido']} pedidos "
          f"({p3['participacion_sin_definir_pct']}%) -> dato faltante")
    print("=" * 78)


# --------------------------------------------------------------------------- #
# CIERRE — Carga de entradas, ejecucion y liberacion del recurso
# --------------------------------------------------------------------------- #

def main(ruta_excel: str = "pedidos whatsapp colombia.xlsx") -> TableroPedidos:
    """CIERRE: arma entradas -> activa los 3 indicadores -> imprime -> libera."""
    wb = None
    try:
        ruta = Path(ruta_excel)
        if not ruta.is_file():
            raise ArchivoExcelNoEncontrado(f"No existe el archivo: {ruta.resolve()}")

        wb = openpyxl.load_workbook(ruta, data_only=True, read_only=True)
        entradas = {
            "fact_pedidos": _leer_hoja(wb, "fact_pedidos"),
            "fact_detalle_pedidos": _leer_hoja(wb, "fact_detalle_pedidos"),
            "conversaciones": _leer_hoja(wb, "conversaciones"),
        }
        tablero = activar_preguntas(**entradas)
        imprimir_tablero(tablero)
        return tablero

    except ErrorActivacion as exc:
        print(f"[ErrorActivacion] {type(exc).__name__}: {exc}")
        raise
    except Exception as exc:                       # barrera de cierre
        print(f"[Inesperado] {type(exc).__name__}: {exc}")
        raise
    finally:
        if wb is not None:
            wb.close()                              # CIERRE: libera el .xlsx
        print("[Cierre] Workbook liberado. Activacion finalizada.\n")


if __name__ == "__main__":
    main()
```

### 5.3 Ejecución y salida esperada

```bash
python modulo_activacion.py
```

```text
==============================================================================
TABLERO DE PEDIDOS · HOGAR COLOMBIA — ACTIVACIÓN DE LA SKILL
==============================================================================
Pedidos totales : 151   Entregados: 24   Pendientes: 127
Ingresos        : $39.736.000   Ticket promedio: $263.152
------------------------------------------------------------------------------
P1 · Promedio SIN pedido vs pedidos totales
    Ticket promedio pedidos totales : $263.152
    Ticket promedio sin pedido      : $0
    Brecha                          : $263.152 (100.0%)
    Cohortes                       : 151 pedidos / 49 sin pedido (75.5% de conversion)
------------------------------------------------------------------------------
P2 · Producto más vendido
    Cobija Térmica Doble Gris (SKU-011)
    Unidades: 46 de 605 (7.6%)  ·  Ingresos: $4.094.000
      1. Cobija Térmica Doble Gris                46 u.
      2. Protector de Colchón Doble               45 u.
      3. Cortina Blackout 140x220 Gris            39 u.
------------------------------------------------------------------------------
P3 · Método de pago más usado
    Empate en uso        : Daviplata, Nequi, Pago Contraentrega (True)
    Mayor recaudo        : Transferencia Bancaria
      Pago Contraentrega         35 ped.     $9.432.000  23.18%
      Daviplata                  35 ped.     $9.069.000  23.18%
      Nequi                      35 ped.     $7.990.000  23.18%
      Transferencia Bancaria     34 ped.     $9.998.000  22.52%
      Sin definir                12 ped.     $3.247.000   7.95%
    Sin metodo definido  : 12 pedidos (7.95%) -> dato faltante
==============================================================================
[Cierre] Workbook liberado. Activacion finalizada.
```

### 5.4 Manejo de excepciones aplicado

| Escenario | Excepción lanzada | Comportamiento |
|---|---|---|
| Ruta del `.xlsx` inexistente | `ArchivoExcelNoEncontrado` | Imprime la ruta absoluta resuelta y aborta. |
| Workbook sin hoja `fact_detalle_pedidos` | `HojaNormalizadaAusente` | Lista las hojas disponibles para diagnóstico. |
| Tabla vacía o sin columna `Metodo_Pago` | `ColumnaFaltante` | Detiene **antes** de calcular, con el contrato violado en el mensaje. |
| `Total = "N/A"` o celda con texto | `DatoNoNumerico` | Nulos/tríos se tratan como `0.0`; el resto se rechaza con el `ID` del registro. |
| Cálculo de promedio sin registros | `DivisorCero` | La cohorte `Sin Pedido` vacía devuelve `$0` (no es un error de negocio). |
| Excepción no prevista | `Exception` genérica | Se registra y se propaga, sin tragarse el error. |

Todas las rutas terminan en `finally: wb.close()`, que garantiza la liberación del archivo aunque el cálculo falle.