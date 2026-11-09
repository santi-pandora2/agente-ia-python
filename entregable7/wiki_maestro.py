import os
from datetime import datetime

# Ruta absoluta o relativa de tu bóveda local de Obsidian
WIKI_PATH = r"preferencias"  # Reemplaza TU_USUARIO por tu usuario real

def asegurar_estructura():
    """Garantiza que todas las carpetas y archivos base existan."""
    os.makedirs(os.path.join(WIKI_PATH, "raw", "transcripts"), exist_ok=True)
    os.makedirs(os.path.join(WIKI_PATH, "entities"), exist_ok=True)
    os.makedirs(os.path.join(WIKI_PATH, "concepts"), exist_ok=True)
    os.makedirs(os.path.join(WIKI_PATH, "comparisons"), exist_ok=True)
    os.makedirs(os.path.join(WIKI_PATH, "queries"), exist_ok=True)

def procesar_entrada_wiki(titulo, categoria, contenido_nuevo, fuente_original=""):
    """
    Ingresa nueva información manteniendo el estándar de la LLM Wiki:
    - Guarda evidencia en raw/transcripts/
    - Actualiza entities/ o concepts/ conservando historial
    - Sincroniza log.md e index.md
    """
    asegurar_estructura()
    
    ahora = datetime.now()
    fecha_hora = ahora.strftime("%Y-%m-%d %H:%M:%S")
    fecha_simple = ahora.strftime("%Y-%m-%d")
    
    # 1. Guardar la fuente original si existe
    if fuente_original:
        raw_dir = os.path.join(WIKI_PATH, "raw", "transcripts")
        raw_name = f"fuente_{fecha_simple}_{titulo.lower().replace(' ', '_')}.txt"
        raw_path = os.path.join(raw_dir, raw_name)
        with open(raw_path, "w", encoding="utf-8") as f:
            f.write(f"Fecha: {fecha_hora}\nTema: {titulo}\n\n{fuente_original}")
        print(f"[OK] Fuente guardada en raw/transcripts/{raw_name}")

    # 2. Gestionar la página en entities/ o concepts/
    carpeta_destino = os.path.join(WIKI_PATH, categoria)
    nombre_archivo = f"{titulo.lower().replace(' ', '_')}.md"
    ruta_archivo = os.path.join(carpeta_destino, nombre_archivo)

    contenido_previo = ""
    if os.path.exists(ruta_archivo):
        with open(ruta_archivo, "r", encoding="utf-8") as f:
            contenido_previo = f.read()

    bloque_actualizacion = f"""
## Actualización ({fecha_hora})
{contenido_nuevo}
"""

    if contenido_previo:
        # Conserva el historial y añade la nueva versión vigente
        nuevo_contenido = contenido_previo + "\n" + bloque_actualizacion
    else:
        # Crea la nota desde cero con su estructura
        nuevo_contenido = f"""# {titulo}

{bloque_actualizacion}

## Historial y Referencias
- Creado el {fecha_hora}
"""

    with open(ruta_archivo, "w", encoding="utf-8") as f:
        f.write(nuevo_contenido)
    print(f"[OK] Nota actualizada en {categoria}/{nombre_archivo}")

    # 3. Registrar acción en log.md
    log_path = os.path.join(WIKI_PATH, "log.md")
    log_entrada = f"- **{fecha_hora}:** Se actualizó/creó la nota `[[{titulo}]]` en la categoría `{categoria}`.\n"
    
    if os.path.exists(log_path):
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(log_entrada)
    else:
        with open(log_path, "w", encoding="utf-8") as f:
            f.write(f"# log.md - Registro de Acciones\n\n{log_entrada}")

    # 4. Asegurar que esté listado en index.md
    index_path = os.path.join(WIKI_PATH, "index.md")
    enlace_markdown = f"- [[{titulo}|{titulo}]]"
    
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            index_content = f.read()
        if enlace_markdown not in index_content:
            index_content += f"\n{enlace_markdown}"
            with open(index_path, "w", encoding="utf-8") as f:
                f.write(index_content)

    print("¡Sincronización completada con éxito en tu bóveda local!")

if __name__ == "__main__":
    # --- DATOS DE MARIANA TORRES ---
    mensaje_fuente = """Soy Mariana Torres, analista de datos y estudiante de IA.
Trabajo en una consultora; por la mañana analizo proyectos
y por la tarde tengo reuniones. Me gusta caminar y leer.
Uso mariana.personal@example.com para asuntos personales,
mariana.trabajo@example.com para trabajo y
mariana.estudios@example.com para clases y formación.
Prefiero mantener cada correo asociado a su propio tema.
Tengo clase de IA los martes de 6 a 8 p. m. y seguimiento
los jueves a las 9 a. m., en hora de Colombia.
Prefiero explicaciones claras, breves y con ejemplos prácticos.
Guárdalo en mi wiki y enlaza perfil, correos, agenda y gustos."""

    fecha_hoy = datetime.now().strftime("%Y-%m-%d")
    fecha_hora = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # 1. Guardar fuente original en raw/transcripts/
    procesar_entrada_wiki(
        titulo="Perfil de Mariana Torres",
        categoria="entities",
        contenido_nuevo="Analista de datos en consultora y estudiante de IA. Prefiere explicaciones claras, breves y con ejemplos prácticos.\n\nConexiones:\n- [[correos_mariana|Correos Electrónicos]]\n- [[agenda_mariana|Horarios y Agenda]]\n- [[gustos_mariana|Intereses y Gustos]]",
        fuente_original=mensaje_fuente
    )

    # 2. Correos
    procesar_entrada_wiki(
        titulo="Correos Electrónicos de Mariana",
        categoria="entities",
        contenido_nuevo="Organización de canales de comunicación por tema:\n- **Personal:** `mariana.personal@example.com`\n- **Trabajo:** `mariana.trabajo@example.com`\n- **Estudios:** `mariana.estudios@example.com`\n\nConexiones:\n- [[mariana_torres|Perfil Principal]]",
        fuente_original=mensaje_fuente
    )

    # 3. Agenda
    procesar_entrada_wiki(
        titulo="Horarios y Agenda de Mariana",
        categoria="entities",
        contenido_nuevo="## Rutina Diaria\n- **Mañanas:** Análisis de proyectos en la consultora.\n- **Tardes:** Reuniones de trabajo.\n\n## Compromisos Recurrentes (Hora Colombia)\n- **Martes (6:00 PM - 8:00 PM):** Clase de IA.\n- **Jueves (9:00 AM):** Seguimiento de proyectos.\n\nConexiones:\n- [[mariana_torres|Perfil Principal]]",
        fuente_original=mensaje_fuente
    )

    # 4. Gustos
    procesar_entrada_wiki(
        titulo="Intereses y Gustos de Mariana",
        categoria="entities",
        contenido_nuevo="- **Actividades:** Caminar y leer.\n- **Estilo de comunicación:** Explicaciones claras, breves y con ejemplos prácticos.\n\nConexiones:\n- [[mariana_torres|Perfil Principal]]",
        fuente_original=mensaje_fuente
    )

    print("¡Ingesta de datos de Mariana Torres completada con éxito!")
