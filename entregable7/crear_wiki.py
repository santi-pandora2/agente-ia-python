import os

def inicializar_llm_wiki():
    # 1. Definir la ruta base y las carpetas de la estructura
    base_dir = "preferencias"
    carpetas = [
        "raw/transcripts",
        "entities",
        "concepts",
        "comparisons",
        "queries"
    ]
    
    # Crear la estructura de directorios
    for carpeta in carpetas:
        ruta_completa = os.path.join(base_dir, carpeta)
        os.makedirs(ruta_completa, exist_ok=True)
        print(f"Directorio creado: {ruta_completa}")
        
    # 2. Crear SCHEMA.md (Reglas del sistema)
    schema_path = os.path.join(base_dir, "SCHEMA.md")
    schema_content = """# SCHEMA.md - Reglas de la LLM Wiki

1. **Fuente (raw/):** Conserva los transcripts y archivos originales intactos. Nunca se sobrescriben.
2. **Páginas (entities/ y concepts/):** Reúnen el conocimiento aprendido sobre personas, herramientas o conceptos, conectándose mediante enlaces cruzados (`[[enlace]]`).
3. **Orientación:** Al retomar la wiki, lee siempre este archivo para recordar las normas, el `index.md` para ver el mapa de contenido y el `log.md` para auditar la actividad reciente.
"""
    with open(schema_path, "w", encoding="utf-8") as f:
        f.write(schema_content)
    print("Creado: preferencias/SCHEMA.md")

    # 3. Crear index.md (Mapa de navegación)
    index_path = os.path.join(base_dir, "index.md")
    index_content = """# index.md - Índice General de la Wiki

## Orientación
- [[SCHEMA|Reglas del sistema]]

## Entidades (entities/)
- *(Vacío - Se llenará conforme proceses datos)*

## Conceptos clave (concepts/)
- *(Vacío - Se llenará conforme proceses datos)*
"""
    with open(index_path, "w", encoding="utf-8") as f:
        f.write(index_content)
    print("Creado: preferencias/index.md")

    # 4. Crear log.md (Registro de acciones)
    log_path = os.path.join(base_dir, "log.md")
    log_content = """# log.md - Registro de Acciones y Cambios

- **2026-11-08:** Inicialización de la estructura de la LLM Wiki en el entorno local.
"""
    with open(log_path, "w", encoding="utf-8") as f:
        f.write(log_content)
    print("Creado: preferencias/log.md")

    print("\n¡Estructura de la LLM Wiki completada con éxito!")

if __name__ == "__main__":
    inicializar_llm_wiki()
