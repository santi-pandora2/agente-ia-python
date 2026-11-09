import os
from datetime import datetime
from fastapi import FastAPI, Request
from telegram import Bot
from telegram.ext import Dispatcher, CommandHandler, MessageHandler, Filters
import asyncio

# Ruta local a tu bóveda (ajusta tu usuario si es necesario)
WIKI_PATH = os.path.expanduser("~/Documentos/memoria/preferencias")

# TOKEN de tu Bot de Telegram (Obtenido con @BotFather)
TELEGRAM_TOKEN = "9131425745:AAEJMSB5HUmsRs9WPRTypoiAaNdeXarhl3c"

app = FastAPI(title="Bot Telegram + OpenCode LLM Wiki Bridge")
bot = Bot(token=TELEGRAM_TOKEN)

# --- FUNCIONES CORE DE LA WIKI LOCAL ---
def registrar_en_wiki(titulo: str, categoria: str, contenido: str, fuente: str):
    """Guarda la nota en la bóveda local actualizando raw/, entities/, log.md e index.md"""
    ahora = datetime.now()
    fecha_str = ahora.strftime("%Y-%m-%d %H:%M:%S")
    fecha_simple = ahora.strftime("%Y-%m-%d")

    # 1. Guardar raw original
    raw_dir = os.path.join(WIKI_PATH, "raw", "transcripts")
    os.makedirs(raw_dir, exist_ok=True)
    raw_file = os.path.join(raw_dir, f"fuente_{fecha_simple}_{titulo.lower().replace(' ', '_')}.txt")
    with open(raw_file, "w", encoding="utf-8") as f:
        f.write(f"Fecha: {fecha_str}\nFuente: Telegram Bot\n\n{fuente}")

    # 2. Guardar/Actualizar Nota en entities/ o concepts/
    dest_dir = os.path.join(WIKI_PATH, categoria)
    os.makedirs(dest_dir, exist_ok=True)
    file_name = f"{titulo.lower().replace(' ', '_')}.md"
    file_path = os.path.join(dest_dir, file_name)

    contenido_previo = ""
    if os.path.exists(file_path):
        with open(file_path, "r", encoding="utf-8") as f:
            contenido_previo = f.read()

    bloque = f"\n## Actualización ({fecha_str})\n{contenido}\n"
    nuevo_contenido = (contenido_previo + bloque) if contenido_previo else f"# {titulo}\n{bloque}\n## Historial\n- Creado: {fecha_str}\n"

    with open(file_path, "w", encoding="utf-8") as f:
        f.write(nuevo_contenido)

    # 3. Log e Index
    log_path = os.path.join(WIKI_PATH, "log.md")
    with open(log_path, "a", encoding="utf-8") as f:
        f.write(f"- **{fecha_str}:** Nota `[[{titulo}]]` guardada vía Telegram Bot.\n")

    index_path = os.path.join(WIKI_PATH, "index.md")
    enlace = f"- [[{titulo}|{titulo}]]"
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            idx_txt = f.read()
        if enlace not in idx_txt:
            with open(index_path, "a", encoding="utf-8") as f:
                f.write(f"\n{enlace}")


# --- HANDLERS DEL BOT DE TELEGRAM ---
@app.post("/webhook")
async def telegram_webhook(request: Request):
    """Endpoint que recibe las actualizaciones directas de Telegram"""
    data = await request.json()
    
    # Extraer el mensaje y chat_id
    if "message" in data and "text" in data["message"]:
        chat_id = data["message"]["chat"]["id"]
        texto_usuario = data["message"]["text"]

        # Procesamiento básico de entrada
        if texto_usuario.startswith("/start"):
            bot.send_message(chat_id=chat_id, text="¡Hola! Soy tu asistente LLM Wiki. Cualquier preferencia o nota que me envíes quedará sincronizada en tu bóveda local de Obsidian.")
        else:
            # Procesar el mensaje y guardarlo en la Wiki local
            titulo = f"Nota_{datetime.now().strftime('%H%M%S')}"
            registrar_en_wiki(
                titulo=titulo,
                categoria="entities",
                contenido=texto_usuario,
                fuente=texto_usuario
            )
            bot.send_message(
                chat_id=chat_id, 
                text=f"✅ Guardado en tu LLM Wiki local:\n- Archivo: `entities/{titulo}.md`\n- Estado: Registrado en log.md e index.md"
            )

    return {"status": "ok"}
