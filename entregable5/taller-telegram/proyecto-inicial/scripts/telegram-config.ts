type Env = (name: string) => string | undefined;
type Fetcher = typeof fetch;

function required(env: Env, name: string): string {
  const value = env(name)?.trim();
  if (!value || value.includes("REEMPLAZAR")) {
    throw new Error(`Falta completar ${name} en .env.`);
  }
  return value;
}

// No propagar excepciones de fetch: pueden incluir la URL con el token.
export async function telegramCall(
  token: string,
  method: string,
  body: Record<string, unknown>,
  fetcher: Fetcher = fetch,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new Error(
      "No se pudo conectar con Telegram. Revisa internet e intenta de nuevo.",
    );
  }
  let data: { ok?: boolean; result?: unknown; error_code?: number };
  try {
    data = await response.json();
  } catch {
    throw new Error(
      "Telegram devolvió una respuesta que no se puede interpretar.",
    );
  }
  if (!response.ok || data.ok !== true) {
    throw new Error(
      `Telegram rechazó la operación (código ${
        data.error_code ?? response.status
      }). Revisa el token y la configuración; no compartas su valor.`,
    );
  }
  return data.result;
}

export async function configurar(
  mode: string,
  env: Env,
  fetcher: Fetcher = fetch,
): Promise<Record<string, unknown>> {
  if (!["identificar", "conectar", "estado"].includes(mode)) {
    throw new Error("Usa identificar, conectar o estado.");
  }
  const token = required(env, "TELEGRAM_BOT_TOKEN");
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error("El formato de TELEGRAM_BOT_TOKEN no parece correcto.");
  }
  if (mode === "identificar") {
    const info = await telegramCall(token, "getWebhookInfo", {}, fetcher) as {
      url?: string;
    };
    if (info.url) {
      throw new Error(
        "El bot ya tiene webhook. Usa un bot nuevo para identificar o conserva los IDs previamente obtenidos. No se borró el webhook.",
      );
    }
    const updates = await telegramCall(token, "getUpdates", {
      timeout: 0,
      limit: 100,
    }, fetcher) as Array<{
      message?: {
        text?: string;
        from?: { id: number; first_name?: string };
        chat?: { id: number; type: string };
      };
    }>;
    const people = new Map<
      number,
      { ADMIN_USER_ID: string; ADMIN_CHAT_ID: string; nombre: string }
    >();
    for (const update of updates) {
      const message = update.message;
      if (message?.chat?.type !== "private" || !message.from) continue;
      if (!["/start", "/identificar"].includes(message.text ?? "")) continue;
      people.set(message.from.id, {
        ADMIN_USER_ID: String(message.from.id),
        ADMIN_CHAT_ID: String(message.chat.id),
        nombre: (message.from.first_name ?? "Sin nombre").slice(0, 80),
      });
    }
    return {
      personas: [...people.values()],
      siguiente: people.size
        ? "Elige la fila del responsable y conserva sus dos IDs."
        : "Abre tu bot, pulsa Iniciar y envía /identificar. Después repite este comando.",
    };
  }
  const expected = required(env, "TELEGRAM_WEBHOOK_URL");
  let url: URL;
  try {
    url = new URL(expected);
  } catch {
    throw new Error("TELEGRAM_WEBHOOK_URL no es una URL válida.");
  }
  if (
    url.protocol !== "https:" || !url.hostname.endsWith(".supabase.co") ||
    url.pathname !== "/functions/v1/spa-telegram" || url.search || url.hash ||
    url.username || url.password
  ) {
    throw new Error(
      "Usa la URL HTTPS de Supabase terminada en /functions/v1/spa-telegram, sin claves ni parámetros.",
    );
  }
  if (mode === "conectar") {
    const secret = required(env, "TELEGRAM_WEBHOOK_SECRET");
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(secret)) {
      throw new Error(
        "TELEGRAM_WEBHOOK_SECRET debe tener entre 32 y 256 caracteres: letras, números, guion o guion bajo.",
      );
    }
    await telegramCall(token, "setWebhook", {
      url: url.toString(),
      secret_token: secret,
      allowed_updates: ["message", "callback_query"],
      max_connections: 1,
      drop_pending_updates: true,
    }, fetcher);
    return {
      configurado: true,
      siguiente:
        "Envía /start en Telegram. Conectar no prueba que la función responda correctamente.",
    };
  }
  const info = await telegramCall(token, "getWebhookInfo", {}, fetcher) as {
    url?: string;
    pending_update_count?: number;
    last_error_date?: number;
  };
  return {
    conectado_a_esta_funcion: info.url === url.toString(),
    eventos_pendientes: info.pending_update_count ?? 0,
    ultimo_error_utc: info.last_error_date
      ? new Date(info.last_error_date * 1000).toISOString()
      : null,
    siguiente:
      "Si hay error reciente, revisa Invocations y Logs de spa-telegram. La fecha de error puede ser histórica; comprueba una interacción nueva.",
  };
}

if (import.meta.main) {
  try {
    console.log(
      JSON.stringify(
        await configurar(Deno.args[0] ?? "", (key) => Deno.env.get(key)),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "La configuración no terminó.",
    );
    Deno.exit(1);
  }
}
