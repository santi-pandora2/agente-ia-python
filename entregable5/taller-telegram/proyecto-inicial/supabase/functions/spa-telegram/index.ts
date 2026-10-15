import { createRepo, getSupabaseSecret } from "./repository.ts";
import { createTelegramClient } from "./telegram.ts";
import { handleRequest } from "./handler.ts";

function getEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Falta ${name}`);
  return v;
}

// Validación al iniciar: si falta una variable, la función no arranca.
const url = getEnv("SUPABASE_URL");
const secretKey = getSupabaseSecret();
if (!secretKey) {
  throw new Error(
    "Falta la clave de servidor (SUPABASE_SECRET_KEYS o SUPABASE_SERVICE_ROLE_KEY).",
  );
}
const adminUserId = Number(getEnv("ADMIN_USER_ID"));
const adminChatId = Number(getEnv("ADMIN_CHAT_ID"));
if (!Number.isSafeInteger(adminUserId) || !Number.isSafeInteger(adminChatId)) {
  throw new Error("ADMIN_USER_ID y ADMIN_CHAT_ID deben ser números enteros.");
}

const repo = createRepo(url, secretKey);
const tg = createTelegramClient({
  token: getEnv("TELEGRAM_BOT_TOKEN"),
  requestTimeoutMs: 8000,
});
const secret = getEnv("TELEGRAM_WEBHOOK_SECRET");

// Deno.serve solo se registra desde este archivo de entrada.
Deno.serve((req) => handleRequest(req, { repo, tg, adminUserId, adminChatId, secret }));
