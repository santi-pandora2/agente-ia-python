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

export interface TelegramClient {
  sendMessage(opts: TelegramSendOptions): Promise<{ ok: boolean; message_id?: number; retry_after?: number; error_code?: string; uncertain?: boolean }>;
  answerCallbackQuery(callback_query_id: string, text?: string, show_alert?: boolean): Promise<boolean>;
}

interface TelegramDeps {
  token: string;
  requestTimeoutMs: number;
}

function sleep(ms: number) {
  return delay(Math.max(0, ms));
}

export function createTelegramClient(deps: TelegramDeps): TelegramClient {
  const base = `https://api.telegram.org/bot${deps.token}`;

  async function request<T>(method: string, body: unknown, timeoutMs: number): Promise<TelegramApiResult<T>> {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}/${method}`, {
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
      const r = await request<{ message_id: number }>("sendMessage", body, deps.requestTimeoutMs);
      if (r.ok && r.result?.message_id) {
        return { ok: true, message_id: r.result.message_id };
      }
      const retry_after = r.parameters?.retry_after;
      let error_code = r.error_code ? String(r.error_code) : undefined;
      if (!error_code && r.description) error_code = r.description;
      // Timeout o respuesta incierta -> uncertain para revision
      const uncertain = r.description === "timeout" || r.description === "respuesta_no_json" || r.description === "network_error";
      return { ok: false, retry_after, error_code, uncertain };
    },
    async answerCallbackQuery(callback_query_id, text, show_alert = false) {
      const r = await request("answerCallbackQuery", {
        callback_query_id,
        text,
        show_alert,
      }, Math.min(3000, deps.requestTimeoutMs));
      return !!r.ok;
    },
  };
}
