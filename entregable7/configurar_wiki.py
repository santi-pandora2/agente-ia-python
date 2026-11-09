import os
from datetime import datetime

# Configura tus rutas (reemplaza TU_USUARIO por tu usuario real o usa la ruta directa)
WIKI_PATH = r"C:\Users\TU_USUARIO\Documents\memoria\preferencias"
OBSIDIAN_VAULT_PATH = WIKI_PATH

def inicializar_y_verificar_wiki():
    print(f"--- INICIALIZANDO LLM WIKI EN OPENCODE ---")
    print(f"Ruta Wiki resuelta: {WIKI_PATH}")
    print(f"Ruta Bóveda Obsidian resuelta: {OBSIDIAN_VAULT_PATH}")

    # 1. Comprobar acceso de lectura/escritura y existencia de la carpeta
    try:
        if not os.path.exists(WIKI_PATH):
            os.makedirs(WIKI_PATH, exist_ok=True)
            print("[OK] La carpeta no existía; se ha creado exitosamente.")
        else:
            print("[OK] La carpeta ya existe en el sistema. Se conservarán los archivos previos.")
    except Exception as e:
        print(f"[ERROR] No se pudo acceder o crear la carpeta: {e}")
        return

    # 2. Crear la estructura de subcarpetas requerida
    subcarpetas = [
        os.path.join("raw", "transcripts"),
        "entities",
        "concepts",
        "comparisons",
        "queries"
    ]
    
    for sub in subcarpetas:
        ruta_sub = os.path.join(WIKI_PATH, sub)
        os.makedirs(ruta_sub, exist_ok=True)
    print("[OK] Subcarpetas ('raw/transcripts', 'entities', 'concepts', 'comparisons', 'queries') verificadas.")

    # 3. Gestionar archivos principales (SCHEMA.md, index.md, log.md) conservando contenido existente
    schema_path = os.path.join(WIKI_PATH, "SCHEMA.md")
    if not os.path.exists(schema_path):
        with open(schema_path, "w", encoding="utf-8") as f:
            f.write("# SCHEMA.md - Reglas de la LLM Wiki\n\n"
                    "1. **Fuente (raw/):** Conserva los transcripts originales intactos.\n"
                    "2. **Páginas (entities/ y concepts/):** Sintetizan el conocimiento conectado mediante enlaces `[[enlace]]`.\n"
                    "3. **Perfil y Preferencias:** Almacena de forma estructurada los gustos, perfiles y configuraciones del usuario.\n")

    index_path = os.path.join(WIKI_PATH, "index.md")
    if not os.path.exists(index_path):
        with open(index_path, "w", encoding="utf-8") as f:
            f.write("# index.md - Índice General de la Bóveda\n\n"
                    "- [[SCHEMA|Reglas del sistema]]\n"
                    "- [[perfil_usuario|Perfil, gustos y preferencias]]\n")

    log_path = os.path.join(WIKI_PATH, "log.md")
    fecha_hora = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    nuevo_log = f"- **{fecha_hora}:** Verificación y preparación de la wiki completada desde OpenCode.\n"
    
    if os.path.exists(log_path):
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(nuevo_log)
    else:
        with open(log_path, "w", encoding="utf-8") as f:
            f.write(f"# log.md - Registro de Acciones\n\n{nuevo_log}")

    # 4. Preparar la nota inicial para el perfil, gustos y preferencias
    perfil_path = os.path.join(WIKI_PATH, "entities", "perfil_usuario.md")
    if not os.path.exists(perfil_path):
        with open(perfil_path, "w", encoding="utf-8") as f:
            f.write("# Perfil, Gustos y Preferencias\n\n"
                    "## Contexto y Datos Personales\n"
                    "- *Registra aquí tus preferencias generales, configuraciones técnicas y gustos recurrentes.*\n\n"
                    "## Conexiones\n"
                    "- [[SCHEMA|Reglas de la Wiki]]\n")
        print("[OK] Creada la página inicial para tu perfil en 'entities/perfil_usuario.md'.")
    else:
        print("[OK] La página de perfil ya existe y se ha conservado.")

    print("\n¡Todo configurado con éxito! Puedes abrir tu bóveda directamente en Obsidian.")

if __name__ == "__main__":
    inicializar_y_verificar_wiki()
