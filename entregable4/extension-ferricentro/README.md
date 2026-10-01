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

## Instalación (Chrome/Edge - Chromium)

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
- [ ] Página compatible (listado Combos) - pendiente verificación en navegador
- [ ] Página no compatible (sin listado) - pendiente
- [ ] Cero resultados - pendiente
- [ ] Campos faltantes (sin descuento) - pendiente
- [x] CSV UTF-8, encabezados estables, escape correcto de comas/comillas (implementado)
- [ ] Carga sin comprimir en Chrome y Edge - pendiente
- [ ] Diferencias entre navegadores (Chrome vs Edge) - pendiente

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
