# Reporte de Calidad de Datos — la-esquina-productos-desorganizados.csv

**Fecha:** 2026-09-11
**Origen:** `la-esquina-productos-desorganizados.csv` (archivo original conservado sin cambios)
**Salida:** `productos_limpios.csv`

---

## 1. Resumen del dataset y granularidad

- **100 filas** de entrada, **7 columnas** (`codigo, nombre, categoria, id_proveedor, proveedor, precio_venta, unidad`).
- Catálogo de 5 líneas de producto: Martillo Clásico (FER), Vela aromática Mediano (MIS), Galleta de avena Grande (PAN), Atún Premium (ABA) y Resma de papel Mini (PAP).
- **Granularidad esperada:** 1 fila = 1 producto identificado por un código único `XXX-####`.

---

## 2. Chequeos realizados

| Chequeo | Método |
|---|---|
| Completitud | Celdas vacías, `N/A`, sentinelas en todas las columnas |
| Unicidad | Duplicados por código normalizado (código exacto y semántico) |
| Validez de formato | Códigos producto e id_proveedor (`XXX####` / `XXX-####`, mayúsculas) |
| Consistencia de vocabularios | Categoría, unidad y proveedor (casos, tildes, espacios) |
| Consistencia de precios | Formatos `$`, `COP`, `.`, `mil`, `N/A`, vacíos y cruce de códigos repetidos |
| Integridad | Códigos duplicados con distinto precio (misma clave, valores contradictorios) |

---

## 3. Hallazgos y cambios aplicados (con conteos)

### 3.1 Duplicados exactos eliminados — 5 filas
Filas idénticas a su primera aparición (mismo código y mismos datos); se conservó la primera ocurrencia.

| Fila eliminada | Código | Idéntica a fila |
|---|---|---|
| 92 | FER-0006 | 7 |
| 93 | PAN-0018 | 19 |
| 94 | PAN-0033 | 34 |
| 95 | ABA-0049 | 50 |
| 96 | ABA-0064 | 65 |

Riesgo: **Crítico**. La unicidad por código es la clave primaria del catálogo; sin deduplicar, conteos, joins e inventarios se inflan ~5 %.
Confianza: alta (mismos datos en las 7 columnas).

### 3.2 Códigos duplicados con precio distinto — 3 filas (no eliminadas, enviadas a revisión)
Misma clave `codigo`, precio contradictorio. No se descartó ninguna fila ni se eligió un precio al azar.

| Código | Precio fila original | Precio fila duplicada |
|---|---|---|
| ABA-0009 | 73071 (fila 10) | 78071 (fila 97) |
| MIS-0027 | 17613 (fila 28) | 22613 (fila 98) |
| PAP-0055 | 41345 (fila 56) | 46345 (fila 99) |

Riesgo: **Crítico**. Un producto no puede tener dos precios vigentes; afecta ventas, márgenes y reportes. Requiere decisión de negocio.

### 3.3 Valores faltantes — 10 celdas en 9 filas
Se dejaron **vacías** (no se inventaron valores) y la fila se marcó en `pendiente_revision`.

| Tipo | Conteo | Códigos / filas |
|---|---|---|
| precio faltante (`N/A` o vacío) | 3 | FER-0031, MIS-0047, MIS-0062 |
| id_proveedor faltante | 5 | MIS-0017, ABA-0034, FER-0051, PAN-0068, PAP-0085 |
| código faltante | 1 | fila 100 "Producto sin código" |
| nombre faltante | 1 | PAP-0099 (fila 101) |

Riesgo: **Alto** (precios faltantes rompen cálculos) y **Medio** (id_proveedor/código/nombre).

### 3.4 Precios aproximados "X mil" — 4 filas
Se interpretó "mil" como ×1.000 literal (p. ej., `176 mil` → `176000`) y se marcaron por ser valores redondeados por la fuente.

| Código | Valor original | Valor parseado |
|---|---|---|
| MIS-0022 | 176 mil | 176000 |
| ABA-0044 | 152 mil | 152000 |
| FER-0066 | 128 mil | 128000 |
| PAN-0088 | 105 mil | 105000 |

Riesgo: **Medio**. El valor usado puede diferir del precio exacto registrado en el sistema.

### 3.5 Formatos normalizados (sin cambio semántico)

| Dato | Cambio | Filas afectadas |
|---|---|---|
| Código de producto | `ABA0014`→`ABA-0014`, minúsculas → mayúsculas | 10 |
| id_proveedor | `PRV028`→`PRV-028`, `PRV019`, `PRV010` | 3 |
| Categoría | 5 ortografías distintas por categoría → forma canónica con tilde (Ferretería, Miscelánea, Panadería, Abarrotes, Papelería) | 52 |
| Unidad | `und`/`ud`→`Unidad`; `paquete`→`Paquete` | 66 |
| Proveedor | `Importadora San Martin`→`Importadora San Martín` | 1 |
| Nombre | Corrección de espacios sobrantes (p. ej., `  Martillo Clásico `) | varias |

Resumen formatos de precio detectados en origen:

| Formato | Conteo |
|---|---|
| Entero simple | 75 |
| Con prefijo `$` | 11 |
| Con punto de miles (`.`) | 6 |
| Con texto `mil` | 4 |
| Con prefijo `COP` | 1 |
| `N/A` o vacío | 3 |

Todos los precios se guardaron como enteros sin símbolos ni separadores.

---

## 4. Resultado de la limpieza

- **Fila originales:** 100
- **Filas en `productos_limpios.csv`:** 95
- **Filas con `pendiente_revision`:** 17 (9 por incompletitud, 4 por precio aproximado, 3 por precio en conflicto, 1 por código faltante)
- **Archivo original:** intacto.

---

## 5. Pendientes de revisión (17 filas)

| Fila | Código | Motivo |
|---|---|---|
| 18 | MIS-0017 | id_proveedor faltante |
| 23 | MIS-0022 | precio aproximado (176 mil → 176000) |
| 32 | FER-0031 | precio faltante |
| 35 | ABA-0034 | id_proveedor faltante |
| 45 | ABA-0044 | precio aproximado (152 mil → 152000) |
| 48 | MIS-0047 | precio faltante |
| 52 | FER-0051 | id_proveedor faltante |
| 63 | MIS-0062 | precio faltante |
| 67 | FER-0066 | precio aproximado (128 mil → 128000) |
| 69 | PAN-0068 | id_proveedor faltante |
| 86 | PAP-0085 | id_proveedor faltante |
| 89 | PAN-0088 | precio aproximado (105 mil → 105000) |
| 97 | ABA-0009 | precio en conflicto 73071 vs 78071 |
| 98 | MIS-0027 | precio en conflicto 17613 vs 22613 |
| 99 | PAP-0055 | precio en conflicto 41345 vs 46345 |
| 100 | (sin código) | código faltante — "Producto sin código" |
| 101 | PAP-0099 | nombre faltante + id_proveedor faltante |

---

## 6. Causas probables e impactos

- **Duplicados:** exportaciones/pegados repetidos del mismo catálogo, o carga doble de inventario. Impacto: conteos y valores de inventario inflados.
- **Precios en conflicto:** actualizaciones de precio no consolidadas o captura manual errónea. Impacto: ventas/márgenes con datos contradictorios.
- **Precios aproximados y faltantes:** captura manual (notación "mil") y registros incompletos. Impacto: agregados de valor imprecisos o nulos.
- **Formato no estándar (códigos, categorías, unidades):** ingreso manual sin validación. Impacto: agrupaciones y cruces inconsistentes (resuelto con la normalización).

---

## 7. Recomendaciones

1. **Resolver los 3 precios en conflicto** contra el sistema de origen y unificar el valor vigente (decisión de negocio, no deducible).
2. **Completar los 5 `id_proveedor`** con el maestro de proveedores (los nombres sugieren el id esperado, pero no se infirió para no inventar).
3. **Asignar código** a la fila "Producto sin código" y **nombre** a PAP-0099.
4. **Confirmar los 4 precios "X mil"** con el valor exacto.
5. **Automatizar reglas** estables en la carga futura:
   - unicidad de `codigo`;
   - `precio_venta` numérico > 0 y obligatorio;
   - `categoria` ∈ {Ferretería, Miscelánea, Panadería, Abarrotes, Papelería};
   - formato `XXX-####` para códigos y `PRV-###` para proveedores.

---

## 8. Límites del análisis y supuestos

1. **No se inventó ningún valor.** Celdas incompletas quedaron vacías y marcadas en `pendiente_revision`.
2. "mil" se leyó como multiplicador ×1.000 (valor literal del texto) y se marcó como aproximado.
3. `$`, `COP` y `.` se trataron como símbolo de moneda y separador de miles; todos los precios resultaron enteros.
4. `ud`/`UND` se interpretaron como abreviatura de "Unidad". De significar otra unidad de medida, ajustar.
5. Categorías, unidades, códigos y proveedores se normalizaron a una forma canónica visible en el CSV; los cambios fueron puramente de formato/ortografía.
6. **No se usó un maestro de proveedores ni de productos** (no existía en el entregable): los id faltantes no se dedujeron del nombre aunque parecieran deducibles.
7. Los códigos presentan huecos de numeración (p. ej., 0091–0098 sin uso y salto a 0099); se asumieron como normales y no requirieron corrección.
8. `Producto sin código` (35.000) y `PAP-0099` (12.500) conservaron su precio original; ambos quedaron pendientes de identificación.
9. El análisis y la limpieza fueron reproducibles desde un script en Python (`csv` estándar); el script se ejecutó fuera del directorio de entrega (no se incorporó como entregable).