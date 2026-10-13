import { createRepo, getSupabaseSecret } from "./repository.ts";
import { createTelegramClient } from "./telegram.ts";
import { handleUpdate, type TelegramUpdate } from "./handler.ts";

function getEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

Deno.serve(async (req) => {
  // Verificar método
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  // Verificar secreto webhook
  const secret = req.headers.get("X-Telegram-Bot-Api-Secret-Token");
  const expected = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
  if (!expected || secret !== expected) {
    return new Response("Unauthorized", { status: 401 });
  }
  // Leer JSON
  let upd: TelegramUpdate;
  try {
    upd = (await req.json()) as TelegramUpdate;
  } catch {
    return new Response("Bad Request", { status: 400 });
  }
  // Validar evento básico
  if (!upd.update_id) {
    return new Response("Bad Request", { status: 400 });
  }

  try {
    const url = Deno.env.get("SUPABASE_URL");
    if (!url) throw new Error("SUPABASE_URL");
    const key = getSupabaseSecret();
    if (!key) throw new Error("Missing service key (SUPABASE_SECRET_KEYS or SUPABASE_SERVICE_ROLE_KEY)");
    const repo = createRepo(url, key);
    const tg = createTelegramClient({
      token: getEnv("TELEGRAM_BOT_TOKEN"),
      requestTimeoutMs: 8000,
    });
    const adminUserId = parseInt(getEnv("ADMIN_USER_ID"));
    const adminChatId = parseInt(getEnv("ADMIN_CHAT_ID"));

    await handleUpdate({ repo, tg, adminUserId, adminChatId }, upd);
    return new Response("ok", { status: 200 });
  } catch (e) {
    return new Response("error", { status: 500 });
  }
});
