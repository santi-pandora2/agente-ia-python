---
description: Reimporta el Excel de operaciones hacia la base SQLite y contrasta los conteos con el contrato de AGENTS.md.
agent: build
---

Reimporta la base de inventario y verifica que sus cifras sean las del contrato.

1. Ejecuta la importacion (tarda ~25 s, es normal):

   ```bash
   uv run python scripts/importar_excel.py datos/original/operacion_comercial_app.xlsm datos/procesados/inventario.db
   ```

2. Si la base ya existia, borrala antes: la importacion es atomica, pero asi queda
   claro que no se esta acumulando datos viejos.

3. Corre el checklist y separa FALLA de AVISO:

   ```bash
   uv run python scripts/revisar_datos.py
   ```

4. Reporta en una tabla: conteos reales contra los esperados (75 proveedores, 1250
   productos, 827 lotes, 73 bajo el minimo), estado de cada uno de los 10 chequeos y el
   significado de cada AVISO para las respuestas del asistente.

No edites el `.xlsm`: es inmutable. Si un conteo no cuadra, reportalo con numeros y
explica la desviacion; no ajustes los datos para que pase. Contexto adicional del
usuario: $ARGUMENTS
