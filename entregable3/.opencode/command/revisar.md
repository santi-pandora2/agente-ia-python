---
description: Pasa el checklist de datos y los tests, y resume Approved o Blocked con evidencia.
agent: build
---

Verifica que la base de inventario sigue siendo confiable para responder preguntas.

1. Tests:

   ```bash
   uv run pytest -q
   ```

2. Checklist de datos:

   ```bash
   uv run python scripts/revisar_datos.py
   ```

3. Si algo falla, delega la investigacion al agente `datos` (que explica desviaciones de
   conteos) o a `software` (si es un problema de codigo). Tu veredicto debe quedar en
   Approved o Blocked con la evidencia copiada de la salida.

4. Resume que significa cada AVISO para las respuestas del asistente: por ejemplo, que
   los 4 proveedores "En revision" no estan habilitados para despachar y que los 250
   productos de Panaderia no se controlan en inventario.

Contexto adicional del usuario: $ARGUMENTS
