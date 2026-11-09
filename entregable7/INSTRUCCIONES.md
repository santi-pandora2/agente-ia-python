# Instrucciones — LLM Wiki Local (OpenCode + Obsidian)

## Estructura del proyecto

```
entregable7/
├── crear_wiki.py              # Inicializa la estructura base (carpetas + SCHEMA/index/log)
├── configurar_wiki.py         # Verifica y prepara la bóveda para Obsidian (conserva archivos previos)
├── wiki_maestro.py            # Ingiesta entradas en la wiki (raw/, entities/, log.md, index.md)
├── consultar_wiki.py          # Consulta una entidad/tema y muestra sus notas y fuentes
├── servidor_telegram_wiki.py  # Micro-servicio FastAPI con webhook de Telegram
└── preferencias/              # Tu bóveda local de Obsidian
    ├── SCHEMA.md              # Reglas del sistema
    ├── index.md               # Índice general de navegación
    ├── log.md                 # Registro de acciones
    ├── raw/
    │   └── transcripts/       # Evidencia original (nunca se sobrescribe)
    ├── entities/              # Notas de personas, herramientas o conceptos
    ├── concepts/              # Notas de conceptos clave
    ├── comparisons/           # Comparativas
    └── queries/               # Consultas
```

## Pasos para poner en marcha

### 1. Inicializar la wiki por primera vez
```bash
python3 crear_wiki.py
```
Crea las carpetas y archivos base (`SCHEMA.md`, `index.md`, `log.md`) en `preferencias/`.

### 2. Verificar/preparar la bóveda para Obsidian (opcional, conserva contenido previo)
```bash
python3 configurar_wiki.py
```
Verifica que existan todas las carpetas y crea `entities/perfil_usuario.md` si no existe.

### 3. Ingresar datos a la wiki (ejemplo: Mariana Torres)
```bash
python3 wiki_maestro.py
```
Guarda fuente en `raw/transcripts/`, crea notas en `entities/`, y actualiza `log.md` e `index.md`.  
Edita el bloque `if __name__ == "__main__":` para registrar tus propios datos.

### 4. Consultar una entidad
```bash
python3 consultar_wiki.py
```
Edita `entidad_o_tema` y `pregunta_usuario` en el bloque `if __name__ == "__main__":`.

### 5. Micro-servicio con Telegram (FastAPI)
1. Obtén un token de [@BotFather](https://t.me/BotFather) en Telegram.
2. Edita `servidor_telegram_wiki.py`, línea 12:
   ```python
   TELEGRAM_TOKEN = "TU_TOKEN_AQUI"
   ```
3. Ejecuta el servidor:
   ```bash
   uvicorn servidor_telegram_wiki:app --reload --host 0.0.0.0 --port 8000
   ```
4. Configura el webhook de Telegram apuntando a `https://tu-dominio/webhook` (o usa ngrok para pruebas locales).

## Variables importantes a ajustar

| Archivo | Variable | Valor por defecto | Qué cambiar |
|---------|----------|-------------------|-------------|
| `crear_wiki.py` | `base_dir` | `"preferencias"` | Ruta de tu bóveda local |
| `configurar_wiki.py` | `WIKI_PATH` | `"C:\Users\TU_USUARIO\..."` | Cambia a tu ruta real |
| `wiki_maestro.py` | `WIKI_PATH` | `"preferencias"` | Ruta relativa o absoluta |
| `consultar_wiki.py` | `WIKI_PATH` | `"preferencias"` | Ruta relativa o absoluta |
| `servidor_telegram_wiki.py` | `WIKI_PATH` | `"~/Documentos/memoria/preferencias"` | Tu ruta local |
| `servidor_telegram_wiki.py` | `TELEGRAM_TOKEN` | `"TU_TELEGRAM_BOT_TOKEN_AQUI"` | Token de @BotFather |

## Convenciones de la wiki

- **raw/transcripts/:** Evidencia original, nunca se sobrescribe.
- **entities/ y concepts/:** Notas con enlaces cruzados `[[enlace]]`. Cada actualización se añade como bloque con fecha y hora.
- **log.md:** Registro de acciones, se añade al final (append).
- **index.md:** Índice navegable con enlaces `[[titulo|texto]]`.

## Comandos útiles

```bash
# Ver archivos creados
ls -la preferencias/
ls -la preferencias/entities/
ls -la preferencias/raw/transcripts/

# Ejecutar cualquier script
python3 crear_wiki.py
python3 wiki_maestro.py
python3 consultar_wiki.py
uvicorn servidor_telegram_wiki:app --reload
```
