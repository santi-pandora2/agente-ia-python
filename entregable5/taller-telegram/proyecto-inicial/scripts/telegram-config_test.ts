import { configurar, telegramCall } from "./telegram-config.ts";

function assert(value: unknown, message = "Falló la comprobación") {
  if (!value) throw new Error(message);
}
async function rejects(fn: () => Promise<unknown>, contains: string) {
  try {
    await fn();
  } catch (error) {
    assert(error instanceof Error && error.message.includes(contains));
    return;
  }
  throw new Error("Debía fallar");
}
const values: Record<string, string> = {
  TELEGRAM_BOT_TOKEN: "123456:token_ficticio",
  TELEGRAM_WEBHOOK_SECRET: "a".repeat(32),
  TELEGRAM_WEBHOOK_URL:
    "https://proyecto-ficticio.supabase.co/functions/v1/spa-telegram",
};
const env = (key: string) => values[key];
const reply = (result: unknown) =>
  new Response(JSON.stringify({ ok: true, result }));

Deno.test("identificar separa el usuario del chat y omite grupos", async () => {
  const fake: typeof fetch = async (input) =>
    String(input).endsWith("getWebhookInfo") ? reply({ url: "" }) : reply([
      {
        message: {
          text: "/identificar",
          from: { id: 123, first_name: "Docente" },
          chat: { id: 456, type: "private" },
        },
      },
      {
        message: {
          text: "/identificar",
          from: { id: 789 },
          chat: { id: -99, type: "group" },
        },
      },
    ]);
  const result = await configurar("identificar", env, fake);
  const people = result.personas as Array<Record<string, string>>;
  assert(
    people.length === 1 && people[0].ADMIN_USER_ID === "123" &&
      people[0].ADMIN_CHAT_ID === "456",
  );
  assert(!JSON.stringify(result).includes(values.TELEGRAM_BOT_TOKEN));
});
Deno.test("identificar no elimina un webhook existente", async () => {
  let calls = 0;
  await rejects(() =>
    configurar("identificar", env, async () => {
      calls++;
      return reply({ url: values.TELEGRAM_WEBHOOK_URL });
    }), "ya tiene webhook");
  assert(calls === 1);
});
Deno.test("conectar envía el secreto como parámetro y restringe eventos", async () => {
  const result = await configurar("conectar", env, async (_input, init) => {
    const body = JSON.parse(String((init as { body?: unknown })?.body));
    assert(body.secret_token === values.TELEGRAM_WEBHOOK_SECRET);
    assert(body.max_connections === 1 && body.drop_pending_updates === true);
    assert(body.allowed_updates.join(",") === "message,callback_query");
    return reply(true);
  });
  assert(result.configurado === true);
  assert(!JSON.stringify(result).includes(values.TELEGRAM_WEBHOOK_SECRET));
});
Deno.test("validación falla antes de enviar si falta token o URL es incorrecta", async () => {
  const forbidden: typeof fetch = () => {
    throw new Error("No debía llamar a la red");
  };
  await rejects(
    () => configurar("estado", () => undefined, forbidden),
    "Falta completar",
  );
  await rejects(
    () =>
      configurar(
        "conectar",
        (key) =>
          key === "TELEGRAM_WEBHOOK_URL"
            ? "https://otro.example/bot"
            : env(key),
        forbidden,
      ),
    "URL HTTPS",
  );
});
Deno.test("no expone URLs con tokens cuando fetch falla", async () => {
  const secret = "123456:secreto_ficticio";
  try {
    await telegramCall(secret, "getMe", {}, () => {
      throw new Error(`Error https://api.telegram.org/bot${secret}/getMe`);
    });
  } catch (error) {
    assert(error instanceof Error && !error.message.includes(secret));
    return;
  }
  throw new Error("Debía fallar");
});
Deno.test("HTTP 200 con ok=false no es un éxito", async () => {
  await rejects(
    () =>
      telegramCall(
        "123:fake",
        "getMe",
        {},
        async () =>
          new Response(JSON.stringify({ ok: false, error_code: 401 })),
      ),
    "código 401",
  );
});
