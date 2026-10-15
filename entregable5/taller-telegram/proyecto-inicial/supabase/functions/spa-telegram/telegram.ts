import { delay } from "https://deno.land/std@0.224.0/async/delay.ts";

export interface TelegramSendOptions {
  chat_id: number;
  text: string;
  reply_markup?: unknown;
  parse_mode?: "HTML" | "MarkdownV2";
}

export interface TelegramApiResult<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

// Resultado normalizado de un envío. `uncertain` marca respuestas que no
// confirman entrega (timeout, red, JSON ilegible) y por eso van a revisión.
// `permanente` marca errores que no tiene sentido reintentar (bot bloqueado).
export interface EnvioResultado {
  ok: boolean;
  message_id?: number;
  retry_after?: number;
  error_code?: string;
  uncertain?: boolean;
  permanente?: boolean;
}

export interface TelegramClient {
  sendMessage(opts: TelegramSendOptions): Promise<EnvioResultado>;
  answerCallbackQuery(
    callback_query_id: string,
    text?: string,
    show_alert?: boolean,
  ): Promise<boolean>;
}

interface TelegramDeps {
  token: string;
  requestTimeoutMs: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

function sleepDefault(ms: number) {
  return delay(Math.max(0, ms));
}

function esPermanente(r: TelegramApiResult): boolean {
  if (r.error_code === 403) return true;
  const d = (r.description ?? "").toLowerCase();
  return d.includes("blocked") || d.includes("chat not found") ||
    d.includes("deactivated") || d.includes("bot can't initiate");
}

export function createTelegramClient(deps: TelegramDeps): TelegramClient {
  const base = `https://api.telegram.org/bot${deps.token}`;
  const doFetch = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? sleepDefault;

  async function request<T>(
    method: string,
    body: unknown,
    timeoutMs: number,
  ): Promise<TelegramApiResult<T>> {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(`${base}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      let data: TelegramApiResult<T> | null = null;
      try {
        data = (await res.json()) as TelegramApiResult<T>;
      } catch (_) {
        data = { ok: false, description: "respuesta_no_json" } as TelegramApiResult<T>;
      }
      return data;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        return { ok: false, description: "timeout" } as TelegramApiResult<T>;
      }
      return { ok: false, description: "network_error" } as TelegramApiResult<T>;
    } finally {
      clearTimeout(t);
    }
  }

  return {
    async sendMessage(opts) {
      const body = {
        chat_id: opts.chat_id,
        text: opts.text,
        reply_markup: opts.reply_markup,
        parse_mode: opts.parse_mode,
      };
      const r = await request<{ message_id: number }>(
        "sendMessage",
        body,
        deps.requestTimeoutMs,
      );
      if (r.ok && r.result?.message_id) {
        return { ok: true, message_id: r.result.message_id };
      }
      const retry_after = r.parameters?.retry_after;
      let error_code = r.error_code ? String(r.error_code) : undefined;
      if (!error_code && r.description) error_code = r.description;
      const uncertain = r.description === "timeout" ||
        r.description === "respuesta_no_json" ||
        r.description === "network_error";
      return {
        ok: false,
        retry_after,
        error_code,
        uncertain,
        permanente: esPermanente(r),
      };
    },
    async answerCallbackQuery(callback_query_id, text, show_alert = false) {
      const r = await request(
        "answerCallbackQuery",
        { callback_query_id, text, show_alert },
        Math.min(3000, deps.requestTimeoutMs),
      );
      if (r.ok) return true;
      // No reintentar en el flujo principal; una espera breve ayuda a no
      // saturar si Telegram respondió 429.
      if (r.parameters?.retry_after) {
        await sleep(Math.min(5000, r.parameters.retry_after * 1000));
      }
      return false;
    },
  };
}
