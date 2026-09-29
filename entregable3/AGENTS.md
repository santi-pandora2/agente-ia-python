# AGENTS.md — Asistente de inventario

Este proyecto convierte el libro `operacion_comercial_app.xlsm` en una base SQLite
reconstruible y expone un arnés de agentes para responder preguntas de inventario
sobre **Productos, Proveedores e Inventario**, y nada más.

## Alcance

| Dentro | Fuera |
| --- | --- |
| Hojas `Productos`, `Proveedores`, `Inventario` | `Ventas`, `Clientes`, `Libro diario`, `Panel Operaciones`, `Compras`, `Detalle compras`, `Detalle ventas`, `Movimientos inventario`, `Configuración`, `Inicio` |
| Tablas `productos`, `proveedores`, `inventario` | Cualquier otra tabla, hoja o archivo |
|_stock por lote_, márgenes, vencimientos, proveedores | Ventas, compras, clientes, flujo de caja |

Ante una pregunta fuera de alcance, responder que no está soportado y no inventar.
Para ampliar el alcance hay que cambiar primero el importador y este documento.

## Jerarquía de verdad

1. `datos/original/operacion_comercial_app.xlsm` es **inmutable**. Contiene macros VBA y
   formato condicional que `openpyxl` descarta al leer, así que cualquier escritura
   destruiría información. Nunca se edita, ni con `openpyxl`, ni con scripts.
2. `datos/procesados/inventario.db` es **derivada y reconstruible**: se regenera borrada
   con el importador y está en `.gitignore`. Si algo no cuadra, se reimporta; no se
   "corrige" a mano.
3. La respuesta del asistente siempre se apoya en la base, nunca en memoria ni en suposiciones.

## Comandos

```bash
uv run python scripts/importar_excel.py datos/original/operacion_comercial_app.xlsm datos/procesados/inventario.db
uv run python scripts/consultar.py resumen
uv run python scripts/revisar_datos.py
uv run pytest -q
```

- **Importar** (~25 s): reconstruye la base. Atajo `/importar`.
- **Consultar**: única vía de datos del asistente, solo lectura y sin SQL libre.
  Subcomandos: `resumen`, `bajo-minimo [categoria]`, `vencidos [categoria]`,
  `por-vencer [categoria]`, `producto <codigo>`, `proveedor <id>`.
  Acepta `--base <ruta>` y `--hoy <AAAA-MM-DD>`.
- **Revisar**: 10 chequeos de invariantes y reglas de negocio; sale con código 1 si
  algo falla y con `--json` para agentes. Atajo `/revisar`.
- **Probar**: 33 tests. El Excel real se importa una vez por sesión (~25 s), los
  escenarios de error usan libros sintéticos.

## Contrato de datos

`proveedores(id, razon_social, nit, categoria, contacto, telefono, correo, ciudad, estado)`
`productos(codigo, nombre, categoria, proveedor_id, unidad, precio_costo, precio_venta)`
`inventario(id, producto_codigo, ubicacion, lote, stock, stock_minimo, fecha_vencimiento, estado, ultima_actualizacion, observaciones, fila_origen)`

- Claves: `proveedores.id`, `productos.codigo`, `(inventario.producto_codigo, inventario.lote)`.
- Cantidades y precios son enteros. El stock es **por lote**, no por producto.
- Fechas en `YYYY-MM-DD`; `fecha_vencimiento` es `NULL` cuando el estado es `NO APLICA`.
- Montos en COP, sin miles separators ni conversión a otras monedas.

### Invariantes verificadas (contrato, no son opiniones)

75 proveedores, 1250 productos, 827 lotes, 73 lotes bajo el mínimo, 0 relaciones
inválidas, 0 claves duplicadas, 0 precios `<= 0`, `precio_venta >= precio_costo`,
0 campos obligatorios nulos, 0 fechas ilegibles.

## Reglas de negocio obligatorias al responder

1. **Panadería no se lleva en inventario** (`Configuración!B16`: "No controlado"). Sus
   250 productos existen en el catálogo y **nunca** tienen lote. Nunca reportarlos como
   faltantes, agotados ni "sin inventario": la respuesta correcta es que la categoría no
   se controla.
2. **Estados de inventario** con corte `2026-09-04` (el del Excel): `VENCIDO` = fecha
   pasada, `POR VENCER` = de 0 a 29 días, `VIGENTE` = 30 días o más, `NO APLICA` = sin
   fecha de vencimiento. No recalcular el estado de un lote en otra fecha sin decirlo.
3. **`En revisión` no es `Activo`.** 4 proveedores están en revisión y tienen 68 productos
   vivos. Al mencionarlos, advertir que no están habilitados para despachar.
4. 173 productos de categorías controladas no tienen lote: es información real, no un error
   de carga. Al responder "no tengo lote", decirlo como tal.
5. Cifras de referencia: 533 lotes `NO APLICA`, 124 `VENCIDO`, 15 `POR VENCER`,
   155 `VIGENTE`, 2 lotes con `stock = 0`.

## Cómo responde el asistente

- Ve siempre por `scripts/consultar.py` para obtener cifras; si la base no existe,
  ejecutar el importador primero.
- Citar el dato con su origen: código de producto, lote, ubicación, estado y fecha de
  vencimiento. "Hay poco" no es una respuesta.
- Si una cifra sale de una estimación o de un supuesto, decirlo en la misma frase.
- No inventar proveedores, productos, lotes ni fechas. No existe un producto → decirlo.
- Responder en español, con los nombres de categoría tal como están en la base
  (con tilde: `Papelería`, `Ferretería`).

## Estructura

```
AGENTS.md                        este archivo
opencode.json                    registro de agentes y permisos
.opencode/agent/{software,datos,qa}.md
.opencode/command/{importar,revisar}.md
scripts/importar_excel.py        Excel -> SQLite (único que escribe)
scripts/consultar.py             consultas de solo lectura
scripts/revisar_datos.py         checklist de datos
tests/                           pytest
datos/original/                  el .xlsm, inmutable
datos/procesados/                la base derivada, ignorada por git
```

## Agentes

| Agente | Puede | Encargado de |
| --- | --- | --- |
| `software` | editar código | `scripts/consultar.py`, `tests/`, lógica de negocio. No toca `datos/` |
| `datos` | ejecutar, no editar | reimportar, auditar la base, explicar desviaciones de conteos |
| `qa` | ejecutar, `edit: deny` | correr tests y el checklist, responder Approved/Blocked con evidencia |

El agente principal coordina y responde al usuario; delega el trabajo pesado y no
reescribe la base a mano para "hacerla pasar".
