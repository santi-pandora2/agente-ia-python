# Asistente de inventario

Responde preguntas sobre **productos, proveedores e inventario** a partir del
libro `operacion_comercial_app.xlsm`. Los datos se cargan en una base SQLite
que se reconstruye desde el Excel con un comando, y todas las consultas son de
**solo lectura**.

No responde ventas, compras, clientes ni flujo de caja: esas hojas están fuera
del alcance y no se importan.

## 1. Requisitos

- Python 3.12 o superior (lo instala uv)
- [uv](https://docs.astral.sh/uv/)
- El archivo `datos/original/operacion_comercial_app.xlsm` (ya está en el repo)

## 2. Instalar

```bash
uv sync
```

Eso crea `.venv/` con `openpyxl` y `pytest`. No hay nada más que compilar.

## 3. Cargar los datos (una vez, y cada vez que cambie el Excel)

```bash
uv run python scripts/importar_excel.py \
  datos/original/operacion_comercial_app.xlsm \
  datos/procesados/inventario.db
```

Tarda unos 25 segundos. Imprime los conteos y los compara con lo esperado:

```
Base creada: datos/procesados/inventario.db
Proveedores: 75 (esperado: 75)
Productos: 1250 (esperado: 1250)
Inventario: 827 (esperado: 827)
Bajo el mínimo: 73 (esperado: 73)
Relaciones inválidas: 0
```

**A la ruta le importa:** el destino debe ser `datos/procesados/inventario.db`.
Si te equivocas al escribirla, el importador crea la carpeta que le digas y
deja una segunda base vacía, y el asistente abre esa. Si ves
`No existe la base`, casi siempre es esto.

El Excel nunca se modifica. La base es derivada: si algo no cuadra, se borra y
se vuelve a importar, no se corrige a mano.

## 4. Comprobar que los datos están sanos

```bash
uv run python scripts/revisar_datos.py
```

10 chequeos de invariantes y reglas de negocio. Sale con código 1 si algo falla
y con `--json` para agentes. En verde termina así:

```
Fallas: 0. Base APROBADA.
```

## 5. Consultar

Hay tres formas, todas de solo lectura y todas alimentadas por el mismo motor.

### 5.1 La consola del asistente (REPL)

```bash
uv run python -m src.app
```

También funciona `uv run python src/app.py`. Arranca así:

```
Asistente de inventario (solo lectura)
Base: /.../entregable3/datos/procesados/inventario.db
Corte: 2026-09-04 (el del Excel, no la fecha de hoy)

Comandos: resumen, bajo-minimo [categoria], vencidos [categoria],
          por-vencer [categoria], producto <codigo>, proveedor <id>,
          hoy <AAAA-MM-DD>, corte, ayuda, salir
Escribe 'ayuda' para verlos con detalle y 'salir' para cerrar.
inventario>
```

Se escribe el comando y se Enter, una consulta por línea. `Ctrl+C` o `Ctrl+D`
cierran la sesión. Si te equivocas en un comando, avisa y sigue; la sesión no
se cae.

| Comando | Qué responde |
| --- | --- |
| `resumen` | Conteos, inventario por estado, productos por categoría, proveedores, indicadores |
| `bajo-minimo [categoría]` | Lotes con stock por debajo del mínimo, con cuántos unidades faltan |
| `vencidos [categoría]` | Lotes cuya fecha de vencimiento ya pasó, con los días de atraso |
| `por-vencer [categoría]` | Lotes que vencen en los próximos 30 días |
| `producto <código>` | Ficha del producto: precios, proveedor y **todos** sus lotes |
| `proveedor <id>` | Ficha del proveedor: contacto, estado, cuántos productos y lotes maneja |
| `hoy <AAAA-MM-DD>` | Cambia la fecha de corte de la sesión |
| `corte` | Muestra la fecha de corte actual |
| `ayuda` / `salir` | Lista de comandos / cerrar |

El filtro de categoría es opcional; sin él salen todas. Los nombres van tal
como están en la base, **con tilde**: `bajo-minimo "Ferretería"`.

Ejemplo de sesión:

```
inventario> producto ABA-0218
...
Categoria     Abarrotes
Proveedor     Bodega El Dorado ABA S.A.S. (PRV-058, En revisión)
...
Lote        Ubicacion  Stock  Minimo  Estado      Vence       Ultimo movimiento
----------  ---------  -----  ------  ----------  ----------  ------------------
LT-2430339  D-14-06    73     22      POR VENCER  2026-10-02  2026-08-07
...
inventario> salir
Hasta luego. Sesion cerrada.
```

### 5.2 Un comando por vez, sin abrir sesión

```bash
uv run python scripts/consultar.py resumen
uv run python scripts/consultar.py bajo-minimo "Ferretería"
uv run python scripts/consultar.py vencidos --hoy 2026-09-04
uv run python scripts/consultar.py por-vencer
uv run python scripts/consultar.py producto ABA-0218
uv run python scripts/consultar.py proveedor PRV-001
```

Mismos comandos, sin la consola. Acepta `--base <ruta>` para abrir otra base y
`--hoy <AAAA-MM-DD>` para cambiar la fecha de corte. Es lo que se usa desde
otro programa o en un script.

### 5.3 Pidiéndole cosas al agente

El asistente también se maneja en lenguaje natural desde el editor, con los
agentes de `.opencode/`. Está la instrucción completa en `AGENTS.md`, y los
agentes son:

| Agente | Qué hace |
| --- | --- |
| `datos` | Reimporta el Excel, audita la base, explica por qué un conteo no cuadra |
| `software` | Arregla código de `scripts/` y `tests/` |
| `qa` | Corre los tests y el checklist, y responde Approved o Blocked con evidencia |

Comandos directos: `/importar` y `/revisar`.

## 6. Cómo leer los estados

El **corte es 2026-09-04**, la fecha con la que se calculó el Excel. Los cuatro
estados de un lote significan:

| Estado | Significado |
| --- | --- |
| `VENCIDO` | La fecha de vencimiento ya pasó |
| `POR VENCER` | Faltan de 0 a 29 días |
| `VIGENTE` | Faltan 30 días o más |
| `NO APLICA` | El lote no tiene fecha de vencimiento |

Una cosa que sorprende y conviene saber: **de los 5 apartados, solo Abarrotes
(201 lotes) y Miscelánea (93) manejan fecha de vencimiento.** Ferretería y
Papelería tienen lotes, pero todos `NO APLICA`. Si buscas un producto de
Ferretería con fecha de vencimiento, no existe.

Ojo también con el comando `hoy`: cambia la fecha con la que **se cuentan** los
vencimientos, pero no reescribe la columna `estado`, que sigue con el corte del
Excel. Por eso al mover la fecha pueden aparecer juntos un lote con pocos días
para vencer y estado `VIGENTE`. Es lo correcto, no un error.

## 7. Reglas que ya vienen incorporadas

No hace falta memorizarlas, pero conviene saber qué hace el asistente sin que
se lo pidas:

1. **Panadería no se lleva en inventario.** Sus 250 productos existen en el
   catálogo y nunca tienen lote. El asistente no los reporta como faltantes ni
   como "sin inventario": dice que la categoría no se controla.
2. **`En revisión` no es `Activo`.** Hay 4 proveedores en ese estado, con 68
   productos vivos. Cuando aparecen, avisa que no están habilitados para
   despachar.
3. **173 productos de categorías controladas no tienen lote.** Es información
   real del Excel, no una carga incompleta.
4. **El stock es por lote, no por producto.** Un producto con tres lotes tiene
   tres filas, y el mínimo se compara lote por lote.

## 8. Cifras de referencia

Están en el contrato del proyecto; si alguna cambia, es porque se reimportó
otro Excel.

| Dato | Valor |
| --- | --- |
| Proveedores | 75 (71 Activos, 4 En revisión) |
| Productos | 1250 (250 por cada una de las 5 categorías) |
| Lotes inventariados | 827 |
| Lotes bajo el mínimo | 73 |
| Lotes `NO APLICA` | 533 |
| Lotes `VENCIDO` | 124 |
| Lotes `POR VENCER` | 15 |
| Lotes `VIGENTE` | 155 |
| Valor del inventario a costo | COP 3.041.663.800 |

## 9. Probar que todo funciona

```bash
uv run pytest -q
```

**102 tests.** La primera corrida tarda ~30 s porque importa el Excel real una
vez por sesión; las siguientes son más rápidas.

Además hay 9 pruebas de búsqueda de información con su evidencia visible, para
revisar a ojo qué responde el asistente ante preguntas concretas:

```bash
cat pruebas_busqueda/00_indice.txt              # qué se prueba y por qué
cat pruebas_busqueda/logs/10_verificacion.log   # corrida completa: tests, checklist, 9 casos
cat pruebas_busqueda/logs/11_repl.log           # sesión de la consola, comando por comando
```

## 10. Estructura

```
AGENTS.md                      instrucciones del agente (contrato de datos y reglas)
README.md                      este archivo
opencode.json                  registro de agentes y permisos
.opencode/agent/               software, datos, qa
.opencode/command/             /importar, /revisar
src/app.py                     la consola del asistente (REPL)
scripts/importar_excel.py      Excel -> SQLite (el único que escribe)
scripts/consultar.py           las consultas de solo lectura
scripts/revisar_datos.py       checklist de datos
tests/                         pytest
pruebas_busqueda/              9 casos de búsqueda + logs de evidencia
datos/original/                el .xlsm, inmutable
datos/procesados/              la base derivada (no se versiona)
```

## 11. Si algo falla

| Síntoma | Qué hacer |
| --- | --- |
| `No existe la base ...` | Falta importar: paso 3 |
| `No se encontro .../consultar.py` | Corriste el REPL fuera del entregable |
| Los conteos no cuadran | `uv run python scripts/revisar_datos.py` y mira qué chequeo falla |
| Cambió el Excel | Vuelve a importar (paso 3) y re-verifica (paso 4) |
| Una respuesta suena rara | `scripts/consultar.py` es la fuente; ejecuta el comando a mano y compara |
