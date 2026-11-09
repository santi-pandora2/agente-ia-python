import os
import re

# Ruta de tu bóveda local (Linux)
WIKI_PATH = r"preferencias"  # Reemplaza con tu ruta exacta si es necesario

def consultar_llm_wiki(entidad_o_tema, pregunta_usuario=""):
    print(f"=== CONSULTANDO LLM WIKI: [{entidad_o_tema.upper()}] ===\n")
    
    # 1. Buscar notas relacionadas en entities/ y concepts/
    carpetas = [os.path.join(WIKI_PATH, "entities"), os.path.join(WIKI_PATH, "concepts")]
    notas_encontradas = []
    
    for carpeta in carpetas:
        if os.path.exists(carpeta):
            for archivo in os.listdir(carpeta):
                if archivo.endswith(".md") and entidad_o_tema.lower() in archivo.lower():
                    notas_encontradas.append(os.path.join(carpeta, archivo))

    if not notas_encontradas:
        print(f"⚠️ No se encontraron notas específicas para '{entidad_o_tema}'.")
        print("Revisando el índice general index.md...")
        index_path = os.path.join(WIKI_PATH, "index.md")
        if os.path.exists(index_path):
            with open(index_path, "r", encoding="utf-8") as f:
                print("\n--- index.md ---")
                print(f.read())
        return

    # 2. Leer y estructurar el contenido de las notas halladas
    for ruta_nota in notas_encontradas:
        nombre_nota = os.path.basename(ruta_nota)
        print(f"📄 **Nota Consultada:** `[[{nombre_nota}]]` (Ruta: {ruta_nota})")
        
        with open(ruta_nota, "r", encoding="utf-8") as f:
            contenido = f.read()

        # Separar lo vigente de lo histórico mediante expresiones o secciones
        print("\n--- CONTENIDO Y ESTADO VIGENTE ---")
        print(contenido)

        # 3. Buscar fuentes originales asociadas en raw/transcripts/
        raw_dir = os.path.join(WIKI_PATH, "raw", "transcripts")
        fuentes_asociadas = []
        if os.path.exists(raw_dir):
            for raw_file in os.listdir(raw_dir):
                if entidad_o_tema.lower() in raw_file.lower():
                    fuentes_asociadas.append(os.path.join("raw/transcripts", raw_file))
        
        if fuentes_asociadas:
            print("\n📌 **Fuentes / Evidencia Relevante:**")
            for f_src in fuentes_asociadas:
                print(f"  - `{f_src}`")
        else:
            print("\n⚠️ Nota: No se hallaron archivos raw explícitos con ese término.")
        
        print("\n" + "="*50 + "\n")

    if pregunta_usuario:
        print(f"❓ **Respondiendo a la consulta:** {pregunta_usuario}")
        print("(Usa la información extraída arriba para validar tu respuesta sin inventar datos).")

if __name__ == "__main__":
    # --- EJEMPLO DE USO ---
    # Reemplaza con el tema o persona que quieras consultar y tu pregunta
    consultar_llm_wiki(
        entidad_o_tema="mariana", 
        pregunta_usuario="¿En qué horario tiene clases de IA y a qué correo debo escribirle para temas académicos?"
    )
