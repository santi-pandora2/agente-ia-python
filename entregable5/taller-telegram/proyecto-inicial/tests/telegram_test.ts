import { createTelegramClient } from "../supabase/functions/spa-telegram/telegram.ts";

function assert(cond: unknown, msg = "Falló la comprobación"): asserts cond {
  if (!cond) throw new Error(msg);
}

const TOKEN = "123456:token_ficticio_abcdefghijklmnop";

function cliente(fetcher: typeof fetch) {
  return createTelegramClient({
    token: TOKEN,
    requestTimeoutMs: 5000,
    fetchImpl: fetcher,
  });
}

function respuestaJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.test("sendMessage devuelve ok y el message_id confirmado", async () => {
  let capturado: { url: string; body: Record<string, unknown> } | null = null;
  const c = cliente(async (input, init) => {
    capturado = {
      url: String(input),
      body: JSON.parse(String((init as { body?: unknown }).body)),
    };
    return respuestaJson({ ok: true, result: { message_id: 321 } });
  });
  const r = await c.sendMessage({ chat_id: 100, text: "hola" });
  assert(r.ok === true && r.message_id === 321);
  assert(capturado!.url.endsWith("/sendMessage"));
  assert(capturado!.body.chat_id === 100 && capturado!.body.text === "hola");
  assert(!JSON.stringify(r).includes(TOKEN), "no debe filtrar el token");
});

Deno.test("HTTP 200 con ok=false no es un éxito", async () => {
  const c = cliente(async () =>
    respuestaJson({ ok: false, error_code: 401, description: "Unauthorized" })
  );
  const r = await c.sendMessage({ chat_id: 1, text: "x" });
  assert(r.ok === false);
  assert(r.error_code === "401");
  assert(r.permanente === false);
});

Deno.test("429 devuelve retry_after y error_code", async () => {
  const c = cliente(async () =>
    respuestaJson({
      ok: false,
      error_code: 429,
      description: "Too Many Requests: retry after 7",
      parameters: { retry_after: 7 },
    })
  );
  const r = await c.sendMessage({ chat_id: 1, text: "x" });
  assert(r.ok === false);
  assert(r.error_code === "429");
  assert(r.retry_after === 7);
  assert(r.uncertain !== true);
});

Deno.test("bot bloqueado (403) es un error permanente", async () => {
  const c = cliente(async () =>
    respuestaJson({
      ok: false,
      error_code: 403,
      description: "Forbidden: bot was blocked by the user",
    })
  );
  const r = await c.sendMessage({ chat_id: 1, text: "x" });
  assert(r.ok === false);
  assert(r.permanente === true);
});

Deno.test("timeout se marca como incierto", async () => {
  const c = cliente(async () => Promise.reject(new DOMException("abort", "AbortError")));
  const r = await c.sendMessage({ chat_id: 1, text: "x" });
  assert(r.ok === false);
  assert(r.uncertain === true);
  assert(r.error_code === "timeout");
});

Deno.test("respuesta no JSON se marca como incierta", async () => {
  const c = cliente(async () => new Response("no es json", { status: 200 }));
  const r = await c.sendMessage({ chat_id: 1, text: "x" });
  assert(r.ok === false);
  assert(r.uncertain === true);
  assert(r.error_code === "respuesta_no_json");
});

Deno.test("error de red se marca como incierto y no filtra el token", async () => {
  const c = cliente(async () => Promise.reject(new Error(`falló ${TOKEN}`)));
  const r = await c.sendMessage({ chat_id: 1, text: "x" });
  assert(r.ok === false);
  assert(r.uncertain === true);
  assert(r.error_code === "network_error");
  assert(!JSON.stringify(r).includes(TOKEN));
});

Deno.test("answerCallbackQuery devuelve true con ok=true", async () => {
  const c = cliente(async () => respuestaJson({ ok: true, result: true }));
  assert((await c.answerCallbackQuery("cb-1")) === true);
});
