# Extensión Local - Extractor de Inventario Ferricentro

Extensión nativa Manifest V3 para recorrer listados paginados autorizados de [ferricentro.com](https://ferricentro.com) y generar el inventario dividido en catálogo de proveedor, actualización POS y excepciones, en CSV UTF-8. Diseñada conforme a principios de seguridad, mínima y sin dependencias externas.

## Características

- Manifest V3 nativo, sin dependencias externas, telemetría, analítica ni código remoto.
- Extracción solo tras acción explícita del usuario (botón "Analizar listado completo").
- **Paginación automática:** recorre la página actual y todas las siguientes del mismo listado hasta la última página o hasta 500 páginas.
- **SKU por producto** extraído de `form[data-product-sku]` con respaldo en el texto visible `SKU: ...`.
- **Inventario dividido en tres CSV UTF-8:** `catalogo_proveedor.csv` (maestro), `actualizacion_pos.csv` (filas válidas para POS) y `excepciones.csv` (filas con problemas).
- **SKU en los tres archivos**, con validación de SKU faltante o duplicado.
- **Paginación visible en el popup:** lista cada página recorrida con su enlace "Siguiente →"
  y permite navegar la vista previa con botones "Anterior" y "Siguiente".
- Dominio autorizado limitado a `*.ferricentro.com` (no usa `<all_urls>`).
- Permisos mínimos: `activeTab`, `scripting`, `downloads`.
- Vista previa con SKU, tabla de productos, páginas recorridas, avisos de campos faltantes/ambiguos y validación de compatibilidad.
- CSV UTF-8 con escape correcto de comas/comillas. Bloquea exportación si no hay productos.

## Estructura de archivos

```
extension-ferricentro/
├── manifest.json   # Manifest V3
├── popup.html      # Interfaz mínima
├── popup.css       # Estilos
├── popup.js        # Lógica popup + división catálogo/POS/excepciones
├── extractor.js    # Extracción DOM + paginación (executeScript)
└── README.md       # Documentación
```

## Permisos

| Permiso | Justificación |
|---------|---------------|
| `activeTab` | Acceso temporal a la pestaña activa para extraer DOM visible. No accede a todas las pestañas. |
| `scripting` | Inyección segura y temporal para ejecutar extractor.js solo en pestaña activa tras acción explícita. |
| `downloads` | Permite guardar los CSV generados localmente. |

`host_permissions`: `https://ferricentro.com/*`, `https://*.ferricentro.com/*`. Restringido al dominio autorizado.

## Inicio rápido (todo en uno)

Desde la carpeta `entregable4`:

```bash
./abrir_ferricentro.sh                          # abre, carga la extensión, recorre todas las páginas y descarga catálogo, POS y excepciones
./abrir_ferricentro.sh https://ferricentro.com/productos/ferreteria  # cualquier categoría
AUTO=0 ./abrir_ferricentro.sh                   # solo abre el navegador con la extensión
REINICIAR=1 ./abrir_ferricentro.sh              # cierra una sesión previa y arranca limpia
```

En una sola ejecución:
1. Abre Chrome (perfil local `.perfil-chrome`, ventana real).
2. Carga esta extensión sin empaquetar.
3. Navega a la URL autorizada y espera a que cargue.
4. Ejecuta la extensión (misma lógica del botón "Analizar listado completo").
5. Recorre automáticamente todas las páginas del listado.
6. Descarga `catalogo_proveedor.csv`, `actualizacion_pos.csv` y `excepciones.csv` en `~/Descargas`, siempre en UTF-8.

Si la página no tiene listado de productos, termina con error claro y no descarga.

> Nota: Chrome 137+ bloquea `--load-extension`, por eso la carga se hace vía CDP
> (`Extensions.loadUnpacked`) con `cargar_extension.py`, y la ejecución de la
> extracción con `usar_extension.py` usando los APIs reales de la extensión
> (`chrome.scripting`, `chrome.downloads`).

## Instalación manual (Chrome/Edge - Chromium)

1. Abrir `chrome://extensions/` (Chrome) o `edge://extensions/` (Edge)
2. Activar "Modo desarrollador"
3. Clic "Cargar extensión sin empaquetar"
4. Seleccionar carpeta `extension-ferricentro` (sin comprimir)
5. Verificar que aparece extensión con permisos listados

## Uso

1. Abrir listado autorizado en `https://ferricentro.com/...` (ej. `https://ferricentro.com/productos/herramienta-electrica/perforacion`)
2. Abrir popup de la extensión
3. Pulsar "Analizar listado completo" (acción explícita)
4. Revisar estado, cantidad, páginas recorridas, paginación del listado, avisos y vista previa con SKU
5. Navegar la vista previa con "Anterior"/"Siguiente" si hay más de 20 productos
6. Si validado, pulsar "Descargar catálogo + POS + excepciones"

## Archivos CSV de entrega

La paginación es automática en cada extracción: se recorren todas las páginas oficiales
del listado y luego se descargan tres archivos UTF-8 en `~/Descargas`.

### 1. Catálogo proveedor (`catalogo_proveedor.csv`)

Maestro completo con todos los productos extraídos, incluidos los que luego caen en excepciones.

| Campo | Contenido |
| --- | --- |
| `proveedor` | `Ferricentro` |
| `sku` | SKU observado en la tarjeta |
| `nombre` | Título del producto |
| `precio_cop` | Precio de oferta sin símbolos ni separadores |
| `inventario` | Vacío: el listado no expone cantidad de existencias; no se inventa |
| `activo` | `true` |
| `url_producto` | URL absoluta de la ficha |
| `imagen_url` | URL absoluta de la imagen |
| `descuento_porcentaje` | Descuento si existe |
| `fecha_consulta` | ISO 8601 de la extracción |
| `fuente_url` | Listado analizado |

### 2. Actualización POS (`actualizacion_pos.csv`)

Subconjunto listo para cargar/actualizar en el POS. Solo incluye filas con `sku`, `nombre`
y `precio_cop` válidos, sin SKU duplicados.

Encabezados: `sku,nombre,precio_cop,inventario,activo,accion,proveedor,url_producto`.
`accion` vale `UPSERT`; `inventario` queda vacío por la misma razón anterior.

### 3. Excepciones (`excepciones.csv`)

Filas que no se pueden enviar al POS: SKU faltante o duplicado, nombre faltante,
precio faltante/no numérico/no positivo, entre otras.

Encabezados: `sku,nombre,precio_cop,motivo,url_producto,fuente_url`.
Si no hay problemas, el archivo queda solo con el encabezado.

Regla de división: `catálogo = actualización POS + excepciones`. Todo CSV usa UTF-8,
escape de comillas `""` y entrecomillado de campos con coma/comilla/salto de línea.

## Inventario entregado

Los tres archivos se generaron con la extensión sobre
`https://ferricentro.com/productos/herramienta-electrica/perforacion`:

- **115 productos** (coincide con los 115 declarados por la categoría).
- **5 páginas** recorridas automáticamente.
- **115 SKU** presentes, 0 productos sin SKU.
- `../catalogo_proveedor.csv`: 115 filas.
- `../actualizacion_pos.csv`: 115 filas, 115 SKU únicos, `UPSERT`.
- `../excepciones.csv`: 0 filas (solo encabezado).

El skill reutilizable con plantilla, lanzador y validadores está en
`../skill-construir-extension-ferricentro/`.

## Validación y pruebas

### Casos probados (2026-10-23)

- [x] Todos los archivos declarados en `manifest.json` existen
- [x] Página compatible sin paginación (Combos): **19/19 productos**, 1 página
- [x] Página compatible con paginación (Perforación): **115/115 productos**, 5 páginas
- [x] SKU extraído en todos los productos probados: 19/19 y 115/115
- [x] `catalogo_proveedor.csv`: 115 filas y 115 SKU
- [x] `actualizacion_pos.csv`: 115 filas, 115 SKU únicos, acción `UPSERT`
- [x] `excepciones.csv`: 0 filas (solo encabezado)
- [x] División validada: catálogo 115 = POS 115 + excepciones 0
- [x] Página no compatible (`/checkout/cart`): error claro, 0 descargas
- [x] CSV UTF-8, escape correcto de comas/comillas
- [x] Popup muestra las 5 páginas recorridas con "Siguiente →" en las primeras 4 y "Última página" en la 5.ª
- [x] Vista previa paginada: 115 productos en 6 páginas de 20; "Siguiente" pasa de la página 1 a la 2 (fila 21)
- [x] Carga sin comprimir en Chrome vía CDP
- [ ] Diferencias entre navegadores (Chrome vs Edge) - pendiente

### Selectores confirmados

- Grid: `ol.products.list.items.product-items`
- Tarjeta: `li.item.product.product-item`
- Título: `a.product-item-link`
- Imagen: `img.product-image-photo` (`data-src`/`srcset`/`src`)
- Precio: `[data-price-type="finalPrice"]` → `data-price-amount` (respaldo `.special-price .price`)
- Descuento: `.discount_percent`
- SKU: `form[data-product-sku]` (respaldo `.product-item-row_label` / texto `SKU: ...`)
- Paginación: `li.pages-item-next a.action.next` y enlaces `?p=N` del mismo pathname
- Total declarado: `.toolbar-amount` (formato `24 artículos de 115`)

### Condiciones de validación
- Compatible: contenedor + >=1 tarjeta + título + URL detectables
- No compatible: estructura no coincide -> error claro, sin exportar incompletos
- Cero resultados: 0 productos -> no habilitar descarga
- Paginación: continúa mientras exista enlace siguiente del mismo listado; se detiene en la última página, si una página no aporta productos nuevos o al alcanzar 500 páginas
- Verificación de total: si la categoría declara N productos y se extraen menos, se muestra un aviso
- Campos ambiguos/faltantes: aparecen en avisos

## Límites y seguridad

- Solo lectura del DOM visible y de las páginas siguientes del mismo listado autorizado.
- No ejecuta instrucciones de la página.
- No inicia sesión, no envía formularios, no añade al carrito, no evade CAPTCHA/login.
- No recopila cookies, credenciales, historial ni datos innecesarios.
- Solo dominio autorizado `*.ferricentro.com`.
- Sin scroll infinito: usa la paginación oficial del listado.
- Extracción tras acción explícita únicamente.

## Notas de implementación

- `extractor.js` usa selectores con respaldo por texto/patrón conforme a `proceso-extension-ferricentro.txt`. Si falta un selector verificado -> no inventa; registra aviso.
- `extractProductsAll(maxPages)` extrae la página actual y hace `fetch` same-origin de las siguientes, parseando con `DOMParser`.
- Popup inyecta el extractor vía `chrome.scripting.executeScript` (MV3).
- Generación CSV con `Blob` + `chrome.downloads.download`.

## Diferencias entre navegadores (pendiente de verificación)
Documentar tras pruebas en Chrome y Edge.
