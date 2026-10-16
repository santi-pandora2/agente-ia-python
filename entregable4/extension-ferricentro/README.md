# Extensión Local - Extractor de Productos Ferricentro

Extensión nativa Manifest V3 para extraer productos visibles de listados autorizados de [ferricentro.com](https://ferricentro.com). Diseñada conforme a principios de seguridad, mínima y sin dependencias externas.

## Características

- Manifest V3 nativo, sin dependencias externas, telemetría, analítica ni código remoto.
- Extracción solo tras acción explícita del usuario (botón "Analizar página actual").
- Dominio autorizado limitado a `*.ferricentro.com` (no usa `<all_urls>`).
- Permisos mínimos: `activeTab`, `scripting`, `downloads`.
- Vista previa con tabla, avisos de campos faltantes/ambiguos, validación de compatibilidad.
- Exporta CSV UTF-8 con encabezados estables y escape correcto de comas/comillas.
- Bloquea exportación si página no compatible o datos incompletos.

## Estructura de archivos

```
extension-ferricentro/
├── manifest.json   # Manifest V3
├── popup.html      # Interfaz mínima
├── popup.css       # Estilos
├── popup.js        # Lógica popup + generación CSV
├── extractor.js    # Extracción DOM (content script via executeScript)
└── README.md       # Documentación
```

## Permisos

| Permiso | Justificación |
|---------|---------------|
| `activeTab` | Acceso temporal a la pestaña activa para extraer DOM visible. No accede a todas las pestañas. |
| `scripting` | Inyección segura y temporal para ejecutar extractor.js solo en pestaña activa tras acción explícita. |
| `downloads` | Permite guardar CSV generado localmente con diálogo `saveAs`. |

`host_permissions`: `https://ferricentro.com/*`, `https://*.ferricentro.com/*`. Restringido al dominio autorizado.

## Inicio rápido (todo en uno)

Desde la carpeta `entregable4`:

```bash
./abrir_ferricentro.sh                          # abre, carga la extensión, analiza y descarga el CSV
./abrir_ferricentro.sh https://ferricentro.com/otra-categoria
AUTO=0 ./abrir_ferricentro.sh                   # solo abre el navegador con la extensión
REINICIAR=1 ./abrir_ferricentro.sh              # cierra una sesión previa y arranca limpia
```

En una sola ejecución:
1. Abre Chrome (perfil local `.perfil-chrome`, ventana real).
2. Carga esta extensión sin empaquetar.
3. Navega a la URL autorizada y espera a que cargue.
4. Ejecuta la extensión (misma lógica del botón "Analizar página actual").
5. Descarga el CSV a `~/Descargas/ferricentro_productos_<fecha>.csv`.

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

1. Abrir listado autorizado en `https://ferricentro.com/...` (ej. `https://ferricentro.com/combos`)
2. Abrir popup de la extensión
3. Pulsar "Analizar página actual" (acción explícita)
4. Revisar estado, cantidad, avisos y vista previa (primeros registros)
5. Si validado, pulsar "Descargar CSV"

## Campos del CSV

Encabezados fijos y estables:
- `titulo` - Título del producto
- `precio_oferta` - Precio de oferta (valor extraído tal como aparece)
- `descuento_porcentaje` - Porcentaje de descuento si presente; vacío si no existe
- `url_producto` - URL absoluta a ficha de producto
- `imagen_url` - URL absoluta de imagen principal
- `fecha_consulta` - ISO 8601 al momento de extracción
- `fuente_url` - URL de la página analizada (dominio autorizado)

Escape CSV: UTF-8, comillas dobles escapadas `""`, campos con coma/comilla/salto entrecomillados.

## Validación y pruebas

### Casos probados (documentados)
- [x] Todos los archivos declarados en `manifest.json` existen
- [x] Página compatible (listado Combos) - verificado 2026-10-16: 20/20 tarjetas
- [ ] Página no compatible (sin listado) - pendiente
- [ ] Cero resultados - pendiente
- [x] Campos faltantes (sin descuento) - verificado: `descuento_porcentaje` vacío cuando no hay badge
- [x] CSV UTF-8, encabezados estables, escape correcto de comas/comillas (implementado)
- [x] Carga sin comprimir en Chrome - verificado 2026-10-16 (Chrome 155 vía CDP)
- [ ] Diferencias entre navegadores (Chrome vs Edge) - pendiente

### Selectores confirmados (2026-10-16, `https://ferricentro.com/combos`)
- Grid: `ol.products.list.items.product-items`
- Tarjeta: `li.item.product.product-item`
- Título: `a.product-item-link`
- Imagen: `img.product-image-photo` (`src`)
- Precio: `[data-price-type="finalPrice"]` → `data-price-amount` (respaldo `.special-price .price`)
- Descuento: `.discount_percent`

### Condiciones de validación
- Compatible: contenedor + >=1 tarjeta + título + URL detectables (según estructura observada en TXT)
- No compatible: estructura no coincide -> error claro, sin exportar incompletos
- Cero resultados: 0 productos -> no habilitar descarga
- Campos ambiguos/faltantes: aparecen en avisos

## Límites y seguridad

- Solo lectura del DOM visible. No ejecuta instrucciones de la página.
- No inicia sesión, no envía formularios, no añade al carrito, no evade CAPTCHA/login.
- No recopila cookies, credenciales, historial ni datos innecesarios.
- Solo dominio autorizado `*.ferricentro.com`.
- No scroll infinito (solo primera página visible).
- Extracción tras acción explícita únicamente.

## Notas de implementación

- `extractor.js` usa selectores con respaldo por texto/patrón conforme a `proceso-extension-ferricentro.txt`. Si falta selector verificado -> no inventa; registra aviso.
- Popup inyecta extractor vía `chrome.scripting.executeScript` (MV3).
- Generación CSV con `Blob` + `chrome.downloads.download` con `saveAs: true`.

## Diferencias entre navegadores (pendiente de verificación)
Documentar tras pruebas en Chrome y Edge.
