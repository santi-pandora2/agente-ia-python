import type {
  Cita,
  Horario,
  NotifClaim,
  Repo,
  Servicio,
} from "../supabase/functions/spa-telegram/repository.ts";
import type {
  EnvioResultado,
  TelegramClient,
} from "../supabase/functions/spa-telegram/telegram.ts";
import {
  fmtFechaBogota,
  handleRequest,
  handleUpdate,
  parseCallback,
  procesarAvisos,
  type Context,
  type TelegramUpdate,
  type WebhookDeps,
} from "../supabase/functions/spa-telegram/handler.ts";

// ------------------------------- Aserciones -------------------------------

function assert(cond: unknown, msg = "Falló la comprobación"): asserts cond {
  if (!cond) throw new Error(msg);
}

function assertIncluye(texto: string, fragmento: string, msg?: string) {
  assert(
    texto.includes(fragmento),
    msg ?? `Se esperaba "${fragmento}" en el texto: ${texto}`,
  );
}

// ------------------------------ Dobles de prueba --------------------------

class FakeRepo implements Repo {
  servicios: Servicio[] = [];
  horarios: Horario[] = [];
  citas: Cita[] = [];
  pendientes: Cita[] = [];
  claims: NotifClaim[] = [];
  resultadosMutar: Array<{ estado: string; [k: string]: unknown }> = [];
  finalizarOk = true;
  avisosNav: Array<{ clave: string; chat_id: number; texto: string }> = [];
  llamadas = {
    generar: 0,
    reclamar: [] as number[],
    mutar: [] as Array<Parameters<Repo["mutarCita"]>[0]>,
    finalizar: [] as Array<Parameters<Repo["finalizarNotificacion"]>[0]>,
  };

  async getServicios() {
    return this.servicios;
  }
  async generarHorarios() {
    this.llamadas.generar++;
  }
  async getHorariosProximos() {
    return this.horarios;
  }
  async getCitaActiva(uid: number) {
    return this.citas.find((c) =>
      c.cliente_user_id === uid &&
      (c.estado === "pendiente" || c.estado === "confirmada")
    ) ?? null;
  }
  async getCitaById(id: number) {
    return this.citas.find((c) => c.id === id) ?? null;
  }
  async getHorarioById(id: number) {
    return this.horarios.find((h) => h.id === id) ?? null;
  }
  async mutarCita(params: Parameters<Repo["mutarCita"]>[0]) {
    this.llamadas.mutar.push(params);
    const r = this.resultadosMutar.shift() ?? { estado: "ok", cita_id: 42 };
    if (r.estado === "ok" && params.accion === "solicitar") {
      this.citas.push({
        id: Number(r.cita_id ?? this.citas.length + 1),
        cliente_user_id: params.actor_user_id,
        cliente_chat_id: params.actor_chat_id,
        cliente_nombre: params.nombre,
        servicio_id: params.servicio_id ?? 0,
        horario_id: params.horario_id ?? 0,
        estado: "pendiente",
        created_at: "2026-10-14T15:00:00.000Z",
      });
    }
    return r;
  }
  async reclamarNotificaciones(lote: number) {
    this.llamadas.reclamar.push(lote);
    return this.claims.splice(0, lote);
  }
  async finalizarNotificacion(
    params: Parameters<Repo["finalizarNotificacion"]>[0],
  ) {
    this.llamadas.finalizar.push(params);
    return this.finalizarOk;
  }
  async getPendientes(offset: number, limit: number) {
    return this.pendientes.slice(offset, offset + limit);
  }
  async registrarAvisoNavegacion(params: {
    clave: string;
    chat_id: number;
    texto: string;
  }) {
    this.avisosNav.push(params);
  }
}

interface Enviado {
  chat_id: number;
  text: string;
  reply_markup?: unknown;
}

class FakeTg implements TelegramClient {
  enviados: Enviado[] = [];
  cola: EnvioResultado[] = [];
  answers: string[] = [];
  private contador = 100;

  async sendMessage(
    opts: { chat_id: number; text: string; reply_markup?: unknown },
  ) {
    this.enviados.push({
      chat_id: opts.chat_id,
      text: opts.text,
      reply_markup: opts.reply_markup,
    });
    if (this.cola.length) return this.cola.shift()!;
    return { ok: true, message_id: this.contador++ };
  }
  async answerCallbackQuery(id: string) {
    this.answers.push(id);
    return true;
  }
}

// ------------------------------- Escenario --------------------------------

const ZONA_FIJA = new Date("2026-10-14T15:00:00.000Z"); // 10:00 en Bogotá
const ADMIN_USER = 900;
const ADMIN_CHAT = 900;
const SECRETO = "secreto-ficticio-abcdefghijklmnop";

function nuevoContexto() {
  const repo = new FakeRepo();
  const tg = new FakeTg();
  repo.servicios = [
    { id: 1, nombre: "Manicure", precio_cop: 30000, duracion_min: 60, activo: true },
    { id: 2, nombre: "Pedicure", precio_cop: 40000, duracion_min: 60, activo: true },
    { id: 3, nombre: "Manos y pies", precio_cop: 65000, duracion_min: 60, activo: true },
  ];
  repo.horarios = [
    // Días futuros respecto a "hoy" Bogotá = 2026-10-14.
    { id: 25, inicio: "2026-10-15T14:00:00.000Z", fin: "2026-10-15T15:00:00.000Z" },
    { id: 26, inicio: "2026-10-15T15:00:00.000Z", fin: "2026-10-15T16:00:00.000Z" },
    { id: 27, inicio: "2026-10-16T14:00:00.000Z", fin: "2026-10-16T15:00:00.000Z" },
    // Horario de un día pasado (2026-10-13 en Bogotá).
    { id: 99, inicio: "2026-10-13T14:00:00.000Z", fin: "2026-10-13T15:00:00.000Z" },
    // Horario de hoy (2026-10-14 18:00 Bogotá): debe excluirse.
    { id: 98, inicio: "2026-10-14T23:00:00.000Z", fin: "2026-10-15T00:00:00.000Z" },
  ];
  const ctx: Context = {
    repo,
    tg,
    adminUserId: ADMIN_USER,
    adminChatId: ADMIN_CHAT,
    now: () => ZONA_FIJA,
  };
  return { repo, tg, ctx };
}

function depsWebhook(repo: FakeRepo, tg: FakeTg): WebhookDeps {
  return {
    repo,
    tg,
    adminUserId: ADMIN_USER,
    adminChatId: ADMIN_CHAT,
    secret: SECRETO,
    now: () => ZONA_FIJA,
  };
}

function updateTexto(
  update_id: number,
  uid: number,
  text: string,
  type = "private",
  chatId = uid,
): TelegramUpdate {
  return {
    update_id,
    message: {
      chat: { id: chatId, type },
      from: { id: uid, first_name: "Cliente" },
      text,
    },
  };
}

function updateCallback(
  update_id: number,
  uid: number,
  data: string,
  chatId = uid,
  tipoChat = "private",
): TelegramUpdate {
  return {
    update_id,
    callback_query: {
      id: `cb-${update_id}`,
      from: { id: uid, first_name: "Cliente" },
      data,
      message: { chat: { id: chatId, type: tipoChat } },
    },
  };
}

function ultimoKb(tg: FakeTg) {
  const kb = tg.enviados.at(-1)!.reply_markup as {
    inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
  };
  return kb.inline_keyboard.flat();
}

function citaBase(over: Partial<Cita> = {}): Cita {
  return {
    id: 7,
    cliente_user_id: 100,
    cliente_chat_id: 100,
    cliente_nombre: "Ana",
    servicio_id: 1,
    horario_id: 25,
    estado: "pendiente",
    created_at: "2026-10-14T15:00:00.000Z",
    ...over,
  };
}

function claimBase(over: Partial<NotifClaim> = {}): NotifClaim {
  return {
    id: 1,
    clave: "cita:42:solicitada:cliente",
    chat_id: 100,
    payload: { tipo: "solicitada_cliente", cita_id: 42 },
    intentos: 1,
    lease_token: "tok-1",
    ...over,
  };
}

// -------------------------------- Pruebas ---------------------------------

Deno.test("menú inicial muestra Servicios, Agendar y Mi cita", async () => {
  const { tg, ctx } = nuevoContexto();
  await handleUpdate(ctx, updateTexto(1, 100, "/start"));
  assertIncluye(tg.enviados.at(-1)!.text, "Spa Manos y Pies");
  const datos = ultimoKb(tg).map((b) => b.callback_data);
  assert(
    datos.includes("servicios") && datos.includes("agendar") &&
      datos.includes("mi_cita"),
    `Faltan botones del menú: ${datos}`,
  );
});

Deno.test("texto no reconocido muestra la ayuda", async () => {
  const { tg, ctx } = nuevoContexto();
  await handleUpdate(ctx, updateTexto(2, 100, "hola"));
  assertIncluye(tg.enviados.at(-1)!.text, "Spa Manos y Pies");
});

Deno.test("servicios muestra nombre, precio y duración", async () => {
  const { tg, ctx } = nuevoContexto();
  await handleUpdate(ctx, updateCallback(3, 100, "servicios"));
  const texto = tg.enviados.at(-1)!.text;
  assertIncluye(texto, "Manicure");
  assertIncluye(texto, "30.000");
  assertIncluye(texto, "Pedicure");
  assertIncluye(texto, "65.000");
  assertIncluye(texto, "min");
});

Deno.test("la hora se calcula en zona America/Bogota", () => {
  // 14:00 UTC = 09:00 en Bogotá (UTC-5), sin importar la zona del equipo.
  const etiqueta = fmtFechaBogota("2026-10-15T14:00:00.000Z");
  assertIncluye(etiqueta, "15/10/2026");
  assertIncluye(etiqueta, "09:00");
});

Deno.test("día y horario se muestran en Bogotá y excluyen hoy", async () => {
  const { tg, ctx } = nuevoContexto();
  await handleUpdate(ctx, updateCallback(4, 100, "servicio:1"));
  const botones = ultimoKb(tg);
  const textos = botones.map((b) => b.text);
  // Etiqueta legible del día (jue 15 oct) y el día exacto en el callback.
  assert(textos.includes("jue 15 oct"), `Días mostrados: ${textos}`);
  assert(textos.includes("vie 16 oct"));
  assert(!textos.includes("2026-10-13"), "no debe mostrar el día pasado");
  assert(!textos.includes("2026-10-14"), "no debe mostrar el día de hoy");
  const datos = botones.map((b) => b.callback_data);
  assert(
    datos.includes("dia:1:20261015") && datos.includes("dia:1:20261016"),
    `Callbacks de día: ${datos}`,
  );

  await handleUpdate(ctx, updateCallback(5, 100, "dia:1:20261015"));
  const horas = ultimoKb(tg).map((b) => b.text);
  assert(horas.includes("09:00") && horas.includes("10:00"), `Horas: ${horas}`);
  assertIncluye(tg.enviados.at(-1)!.text, "Horarios para jue 15 oct");
});

Deno.test("solo se ofrecen siete días de atención", async () => {
  const { repo, tg, ctx } = nuevoContexto();
  // Se agregan días hasta pasar la ventana de siete días de atención.
  for (let d = 17; d <= 30; d++) {
    const ymd = `2026-10-${d}`;
    repo.horarios.push({
      id: 200 + d,
      inicio: `${ymd}T14:00:00.000Z`,
      fin: `${ymd}T15:00:00.000Z`,
    });
  }
  await handleUpdate(ctx, updateCallback(60, 100, "servicio:1"));
  const dias = ultimoKb(tg).filter((b) => b.callback_data.startsWith("dia:"));
  assert(dias.length === 7, `Días ofrecidos: ${dias.length}`);
  const ultimo = dias.at(-1)!.callback_data;
  assert(
    ultimo === "dia:1:20261021",
    `El último día debe ser el séptimo: ${ultimo}`,
  );
  assert(!dias.some((b) => b.callback_data.endsWith("20261022")));
});

Deno.test("un día fuera de la ventana de siete días ya no está disponible", async () => {
  const { tg, ctx } = nuevoContexto();
  // 2026-10-30 está fuera de los siete días que el bot ofrece.
  await handleUpdate(ctx, updateCallback(61, 100, "dia:1:20261030"));
  assertIncluye(tg.enviados.at(-1)!.text, "ya no está disponible");
});

Deno.test("Mi cita con horario vencido ofrece agendar y no cancelar", async () => {
  const { repo, tg, ctx } = nuevoContexto();
  // Horario 99 = 2026-10-13, anterior a "hoy" (2026-10-14).
  repo.citas = [citaBase({ horario_id: 99 })];
  await handleUpdate(ctx, updateCallback(62, 100, "mi_cita"));
  const texto = tg.enviados.at(-1)!.text;
  assertIncluye(texto, "Mi cita");
  assertIncluye(texto, "ya pasó");
  assertIncluye(texto, "ya no está vigente");
  const kb = ultimoKb(tg).map((b) => b.callback_data);
  assert(kb.includes("agendar"), "debe ofrecer agendar otra");
  assert(!kb.includes("cancelar:7"), "no debe ofrecer cancelar una cita vencida");
});

Deno.test("pedir la cancelación de una cita ajena no se confirma", async () => {
  const { repo, tg, ctx } = nuevoContexto();
  repo.citas = [citaBase({ cliente_user_id: 200, cliente_chat_id: 200 })];
  await handleUpdate(ctx, updateCallback(63, 100, "cancelar:7"));
  assertIncluye(tg.enviados.at(-1)!.text, "No autorizado");
  assert(
    tg.enviados.at(-1)!.reply_markup === undefined,
    "no debe ofrecer confirmar la cancelación de otra persona",
  );
});

Deno.test("el responsable ve un mensaje propio cuando la cita está vencida", async () => {
  const { repo, tg, ctx } = nuevoContexto();
  repo.resultadosMutar = [{ estado: "vencida", cita_id: 7 }];
  await handleUpdate(ctx, updateCallback(64, ADMIN_USER, "confirmar:7"));
  const texto = tg.enviados.at(-1)!.text;
  assertIncluye(texto, "ya pasó");
  assert(!texto.includes("Elige otro horario"), `Texto de clienta: ${texto}`);
});

Deno.test("fecha pasada y día de hoy no se ofrecen", async () => {
  const { repo, tg, ctx } = nuevoContexto();

  await handleUpdate(ctx, updateCallback(6, 100, "dia:1:20261013"));
  assertIncluye(tg.enviados.at(-1)!.text, "ya no está disponible");

  await handleUpdate(ctx, updateCallback(7, 100, "horario:1:98"));
  assertIncluye(tg.enviados.at(-1)!.text, "ya pasó o es de hoy");

  await handleUpdate(ctx, updateCallback(8, 100, "enviar:1:99"));
  assertIncluye(tg.enviados.at(-1)!.text, "ya pasó o es de hoy");
  assert(repo.llamadas.mutar.length === 0, "no debe crear cita en día pasado");
});

Deno.test("horario ocupado devuelve un error comprensible", async () => {
  const { repo, tg, ctx } = nuevoContexto();
  repo.resultadosMutar = [{ estado: "horario_ocupado" }];
  await handleUpdate(ctx, updateCallback(9, 100, "enviar:1:25"));
  assertIncluye(tg.enviados.at(-1)!.text, "ocupado");
});

Deno.test("Mi cita muestra la cita propia", async () => {
  const { repo, tg, ctx } = nuevoContexto();
  repo.citas = [citaBase()];
  await handleUpdate(ctx, updateCallback(10, 100, "mi_cita"));
  const texto = tg.enviados.at(-1)!.text;
  assertIncluye(texto, "Mi cita");
  assertIncluye(texto, "ID: 7");
  assertIncluye(texto, "15/10/2026");
  const kb = ultimoKb(tg).map((b) => b.callback_data);
  assert(kb.includes("cancelar:7"), "debe ofrecer cancelar");
});

Deno.test("no se puede cancelar una cita ajena", async () => {
  const { repo, tg, ctx } = nuevoContexto();
  repo.citas = [citaBase({ cliente_user_id: 200, cliente_chat_id: 200 })];
  await handleUpdate(ctx, updateCallback(11, 100, "cancelar_ok:7"));
  assertIncluye(tg.enviados.at(-1)!.text, "No autorizado");
  assert(repo.llamadas.mutar.length === 0, "no debe cancelar la cita ajena");
});

Deno.test("solo el responsable puede confirmar o rechazar", async () => {
  const { repo, tg, ctx } = nuevoContexto();
  await handleUpdate(ctx, updateCallback(12, 100, "confirmar:7"));
  assertIncluye(tg.enviados.at(-1)!.text, "No autorizado");
  await handleUpdate(ctx, updateCallback(13, 100, "rechazar:7"));
  assertIncluye(tg.enviados.at(-1)!.text, "No autorizado");
  assert(repo.llamadas.mutar.length === 0, "no debe mutar sin permiso");
});

Deno.test("callback manipulado no ejecuta acciones", async () => {
  const { repo, tg, ctx } = nuevoContexto();
  const manipulados = [
    "confirmar:abc",
    "servicio:99999999999999999999",
    "drop table spa_citas",
    "a".repeat(70),
    "",
    "cancelar_ok:0",
  ];
  for (const data of manipulados) {
    await handleUpdate(ctx, updateCallback(14, 100, data));
    assertIncluye(tg.enviados.at(-1)!.text, "Spa Manos y Pies");
  }
  assert(repo.llamadas.mutar.length === 0, "no debe ejecutar callbacks inválidos");
  assert(parseCallback("confirmar:abc") === null);
  assert(parseCallback("dia:1:20261015")?.tipo === "dia");
});

Deno.test("callback viejo sobre cita ya resuelta informa el estado", async () => {
  const { repo, tg, ctx } = nuevoContexto();
  repo.resultadosMutar = [{ estado: "estado_invalido", actual: "confirmada" }];
  await handleUpdate(ctx, updateCallback(15, ADMIN_USER, "confirmar:7"));
  assertIncluye(tg.enviados.at(-1)!.text, "ya cambió de estado");
});

Deno.test("dos solicitudes de la misma persona piden gestionar la activa", async () => {
  const { repo, tg, ctx } = nuevoContexto();
  repo.resultadosMutar = [
    { estado: "ok", cita_id: 42 },
    { estado: "consulta_tu_cita" },
  ];
  await handleUpdate(ctx, updateCallback(16, 100, "enviar:1:25"));
  assertIncluye(tg.enviados.at(-1)!.text, "Solicitud creada");
  await handleUpdate(ctx, updateCallback(17, 100, "enviar:1:26"));
  assertIncluye(tg.enviados.at(-1)!.text, "Ya tienes una cita activa");
});

Deno.test("replay del mismo update_id no duplica y usa el update_id real", async () => {
  const { repo, tg, ctx } = nuevoContexto();
  repo.resultadosMutar = [{ estado: "ok", cita_id: 42 }, { estado: "duplicado" }];
  const upd = updateCallback(50, 100, "enviar:1:25");
  await handleUpdate(ctx, upd);
  await handleUpdate(ctx, upd);
  assert(repo.llamadas.mutar.length === 2);
  assert(
    repo.llamadas.mutar[0].update_id === 50 &&
      repo.llamadas.mutar[1].update_id === 50,
    "debe propagar el update_id de Telegram a la RPC",
  );
  assertIncluye(tg.enviados.at(-1)!.text, "ya se había procesado");
});

Deno.test("doble confirmación no cambia la cita otra vez", async () => {
  const { repo, tg, ctx } = nuevoContexto();
  repo.resultadosMutar = [
    { estado: "ok", cita_id: 7 },
    { estado: "estado_invalido", actual: "confirmada" },
  ];
  await handleUpdate(ctx, updateCallback(18, ADMIN_USER, "confirmar:7"));
  assertIncluye(tg.enviados.at(-1)!.text, "confirmada");
  await handleUpdate(ctx, updateCallback(19, ADMIN_USER, "confirmar:7"));
  assertIncluye(tg.enviados.at(-1)!.text, "ya cambió de estado");
});

Deno.test("aviso fallido después de guardar conserva la cita y registra el aviso", async () => {
  const { repo, tg, ctx } = nuevoContexto();
  repo.resultadosMutar = [{ estado: "ok", cita_id: 42 }];
  repo.claims = [claimBase()];
  // 1er envío: confirmación de la cita. 2do envío (aviso): falla con ok=false.
  tg.cola = [
    { ok: true, message_id: 500 },
    { ok: false, error_code: "500", uncertain: true },
  ];
  await handleUpdate(ctx, updateCallback(20, 100, "enviar:1:25"));

  assertIncluye(tg.enviados[0].text, "Solicitud creada");
  assert(repo.citas.length === 1, "la cita debe conservarse");
  assert(repo.llamadas.finalizar.length === 1, "debe finalizar el aviso");
  const fin = repo.llamadas.finalizar[0];
  assert(fin.enviada === false, "no debe marcarse como enviada");
  assert(typeof fin.error_codigo === "string" && fin.error_codigo.length > 0);
  assert(fin.lease_token === "tok-1");
});

Deno.test("HTTP 200 de Telegram con ok=false se registra como fallo", async () => {
  const { repo, tg, ctx } = nuevoContexto();
  repo.claims = [claimBase()];
  tg.cola = [{ ok: false, error_code: "400" }];
  await handleUpdate(ctx, { update_id: 21 });
  const fin = repo.llamadas.finalizar.at(-1)!;
  assert(fin.enviada === false);
  assert(fin.error_codigo === "400");
});

Deno.test("429 respeta retry_after", async () => {
  const { repo, tg, ctx } = nuevoContexto();
  repo.claims = [claimBase()];
  tg.cola = [{ ok: false, error_code: "429", retry_after: 7 }];
  await handleUpdate(ctx, { update_id: 22 });
  const fin = repo.llamadas.finalizar.at(-1)!;
  assert(fin.enviada === false);
  assert(fin.retry_after_seconds === 7);
  assert(fin.permanente === false);
});

Deno.test("timeout incierto queda para revisión y no como enviada", async () => {
  const { repo, tg, ctx } = nuevoContexto();
  repo.claims = [claimBase()];
  tg.cola = [{ ok: false, error_code: "timeout", uncertain: true }];
  const r = await procesarAvisos(ctx, 3);
  assert(repo.llamadas.finalizar[0].enviada === false);
  assert(repo.llamadas.finalizar[0].error_codigo === "timeout");
  assert(r.revision === 1 && r.aceptadas === 0);
});

Deno.test("error permanente queda fallido", async () => {
  const { repo, tg, ctx } = nuevoContexto();
  repo.claims = [claimBase()];
  tg.cola = [{
    ok: false,
    error_code: "403",
    permanente: true,
  }];
  const r = await procesarAvisos(ctx, 3);
  assert(repo.llamadas.finalizar[0].permanente === true);
  assert(r.fallidas === 1);
});

Deno.test("lease vencido no marca el aviso como enviado", async () => {
  const { repo, tg, ctx } = nuevoContexto();
  repo.claims = [claimBase({ lease_token: "tok-x" })];
  repo.finalizarOk = false; // el dueño del lease ya venció
  tg.cola = [{ ok: true, message_id: 999 }];
  const r = await procesarAvisos(ctx, 3);
  assert(repo.llamadas.finalizar.length === 1);
  assert(repo.llamadas.finalizar[0].enviada === true);
  assert(repo.llamadas.finalizar[0].lease_token === "tok-x");
  assert(r.aceptadas === 0 && r.sin_lease === 1, "no cuenta como aceptada");
});

Deno.test("mensaje en grupo no expone datos ni ejecuta acciones", async () => {
  const { repo, tg, ctx } = nuevoContexto();
  await handleUpdate(ctx, updateTexto(23, 100, "/start", "group", -100));
  assert(tg.enviados.at(-1)!.text === "Solo en chat privado.");
  assert(!tg.enviados.at(-1)!.text.includes("Manicure"));
  assert(repo.llamadas.mutar.length === 0);
});

Deno.test("/pendientes es exclusivo del responsable", async () => {
  const { repo, tg, ctx } = nuevoContexto();
  await handleUpdate(ctx, updateTexto(24, 100, "/pendientes"));
  assertIncluye(tg.enviados.at(-1)!.text, "No autorizado");

  repo.pendientes = [citaBase()];
  await handleUpdate(ctx, updateTexto(25, ADMIN_USER, "/pendientes"));
  const texto = tg.enviados.at(-1)!.text;
  assertIncluye(texto, "Cita 7");
  const kb = ultimoKb(tg).map((b) => b.callback_data);
  assert(kb.includes("confirmar:7") && kb.includes("rechazar:7"));
});

Deno.test("callback de pendientes también exige responsable", async () => {
  const { repo, tg, ctx } = nuevoContexto();
  repo.pendientes = [citaBase()];
  await handleUpdate(ctx, updateCallback(26, 100, "pendientes:0"));
  assertIncluye(tg.enviados.at(-1)!.text, "No autorizado");
  await handleUpdate(ctx, updateCallback(27, ADMIN_USER, "pendientes:0"));
  assertIncluye(tg.enviados.at(-1)!.text, "Cita 7");
});

Deno.test("/reintentar procesa avisos y reporta; ajeno no autorizado", async () => {
  const { repo, tg, ctx } = nuevoContexto();
  await handleUpdate(ctx, updateTexto(28, 100, "/reintentar"));
  assertIncluye(tg.enviados.at(-1)!.text, "No autorizado");

  repo.claims = [claimBase()];
  await handleUpdate(ctx, updateTexto(29, ADMIN_USER, "/reintentar"));
  assertIncluye(tg.enviados.at(-1)!.text, "Reintento: aceptadas 1");
  assert(repo.llamadas.reclamar.at(-1) === 10, "debe reclamar hasta 10 avisos");
});

Deno.test("webhook responde 401 con secreto incorrecto antes de leer el cuerpo", async () => {
  const { repo, tg } = nuevoContexto();
  const req = new Request("https://x/functions/v1/spa-telegram", {
    method: "POST",
    headers: { "X-Telegram-Bot-Api-Secret-Token": "incorrecto" },
    body: JSON.stringify(updateTexto(1, 100, "/start")),
  });
  const res = await handleRequest(req, depsWebhook(repo, tg));
  assert(res.status === 401, `Se esperaba 401, llegó ${res.status}`);
  assert(tg.enviados.length === 0);
});

Deno.test("webhook responde 405 con método incorrecto", async () => {
  const { repo, tg } = nuevoContexto();
  const req = new Request("https://x/functions/v1/spa-telegram", {
    method: "GET",
    headers: { "X-Telegram-Bot-Api-Secret-Token": SECRETO },
  });
  const res = await handleRequest(req, depsWebhook(repo, tg));
  assert(res.status === 405, `Se esperaba 405, llegó ${res.status}`);
});

Deno.test("webhook responde 400 con JSON inválido o evento mal formado", async () => {
  const { repo, tg } = nuevoContexto();
  const malJson = new Request("https://x/functions/v1/spa-telegram", {
    method: "POST",
    headers: { "X-Telegram-Bot-Api-Secret-Token": SECRETO },
    body: "{no es json",
  });
  assert((await handleRequest(malJson, depsWebhook(repo, tg))).status === 400);

  const sinId = new Request("https://x/functions/v1/spa-telegram", {
    method: "POST",
    headers: { "X-Telegram-Bot-Api-Secret-Token": SECRETO },
    body: JSON.stringify({ message: {} }),
  });
  assert((await handleRequest(sinId, depsWebhook(repo, tg))).status === 400);
});

Deno.test("webhook procesa un evento válido con 200", async () => {
  const { repo, tg } = nuevoContexto();
  const req = new Request("https://x/functions/v1/spa-telegram", {
    method: "POST",
    headers: { "X-Telegram-Bot-Api-Secret-Token": SECRETO },
    body: JSON.stringify(updateTexto(30, 100, "/start")),
  });
  const res = await handleRequest(req, depsWebhook(repo, tg));
  assert(res.status === 200, `Se esperaba 200, llegó ${res.status}`);
  assertIncluye(tg.enviados.at(-1)!.text, "Spa Manos y Pies");
});

Deno.test("aviso al responsable incluye botones Confirmar y Rechazar", async () => {
  const { repo, tg, ctx } = nuevoContexto();
  repo.claims = [claimBase({
    chat_id: ADMIN_CHAT,
    payload: {
      tipo: "solicitada_admin",
      cita_id: 42,
      nombre: "Ana",
      teclado: [[
        { texto: "Confirmar", callback_data: "confirmar:42" },
        {
          texto: "Rechazar y ofrecer nueva solicitud",
          callback_data: "rechazar:42",
        },
      ]],
    },
  })];
  const r = await procesarAvisos(ctx, 10);
  assert(r.aceptadas === 1, `Se esperaba 1 aceptada, hubo ${r.aceptadas}`);
  const datos = ultimoKb(tg).map((b) => b.callback_data);
  assert(
    datos.includes("confirmar:42") && datos.includes("rechazar:42"),
    `Faltan botones del aviso: ${datos}`,
  );
  assertIncluye(tg.enviados.at(-1)!.text, "Nueva solicitud");
});

Deno.test("el teclado manipulado se descarta y el aviso sale sin botones", async () => {
  const { repo, tg, ctx } = nuevoContexto();
  repo.claims = [claimBase({
    chat_id: ADMIN_CHAT,
    payload: {
      tipo: "solicitada_admin",
      cita_id: 42,
      teclado: [[
        { texto: "Confirmar", callback_data: "admin_todo:42" },
        { texto: "Malo", callback_data: "x" },
      ]],
    },
  })];
  await procesarAvisos(ctx, 10);
  const markup = tg.enviados.at(-1)!.reply_markup;
  assert(markup === undefined, `No debía enviar teclado manipulado: ${JSON.stringify(markup)}`);
});

Deno.test("aviso fallido recuperable queda como reintentable", async () => {
  const { repo, tg, ctx } = nuevoContexto();
  repo.claims = [claimBase()];
  tg.cola = [{
    ok: false,
    error_code: "telegram_5xx",
    retry_after: 5,
  }];
  const r = await procesarAvisos(ctx, 10);
  assert(r.reintentables === 1, `Se esperaba 1 reintentable, hubo ${r.reintentables}`);
  assert(r.aceptadas === 0 && r.fallidas === 0 && r.revision === 0);
  const fin = repo.llamadas.finalizar.at(-1)!;
  assert(fin.enviada === false, "no debe marcarse como enviada");
  assert(fin.retry_after_seconds === 5);
  assert(fin.incierto !== true, "un 5xx no es incierto");
});

Deno.test("aviso con error incierto queda en revisión y se marca incierto", async () => {
  const { repo, tg, ctx } = nuevoContexto();
  repo.claims = [claimBase()];
  tg.cola = [{ ok: false, error_code: "timeout", uncertain: true }];
  const r = await procesarAvisos(ctx, 10);
  assert(r.revision === 1, `Se esperaba 1 en revisión, hubo ${r.revision}`);
  assert(r.reintentables === 0);
  const fin = repo.llamadas.finalizar.at(-1)!;
  assert(fin.incierto === true, "debe informar incierto al servidor");
  assert(fin.enviada === false);
});

Deno.test("/reintentar reporta los reintentables", async () => {
  const { repo, tg, ctx } = nuevoContexto();
  repo.claims = [claimBase()];
  tg.cola = [{ ok: false, error_code: "telegram_5xx" }];
  await handleUpdate(ctx, updateTexto(31, ADMIN_USER, "/reintentar"));
  assertIncluye(tg.enviados.at(-1)!.text, "reintentables 1");
});

Deno.test("un callback en un grupo no ejecuta acciones ni expone datos", async () => {
  const { repo, tg, ctx } = nuevoContexto();
  repo.citas = [citaBase()];
  await handleUpdate(ctx, updateCallback(40, ADMIN_USER, "confirmar:7", -100, "group"));
  assertIncluye(tg.enviados.at(-1)!.text, "Solo en chat privado.");
  assert(repo.llamadas.mutar.length === 0, "no debe confirmar en un grupo");
  assert(tg.answers.length === 1, "debe responder el callback");
});

Deno.test("un callback en un grupo no cancela la cita de la clienta", async () => {
  const { repo, tg, ctx } = nuevoContexto();
  repo.citas = [citaBase()];
  await handleUpdate(ctx, updateCallback(41, 100, "cancelar_ok:7", -100, "group"));
  assertIncluye(tg.enviados.at(-1)!.text, "Solo en chat privado.");
  assert(repo.llamadas.mutar.length === 0, "no debe cancelar en un grupo");
});

Deno.test("servicio inexistente es un error de negocio, no una falla técnica", async () => {
  const { repo, tg, ctx } = nuevoContexto();
  await handleUpdate(ctx, updateCallback(42, 100, "enviar:999999:25"));
  assertIncluye(tg.enviados.at(-1)!.text, "Ese servicio no está disponible");
  assert(repo.llamadas.mutar.length === 0, "no debe llamar la RPC");
});

Deno.test("un mensaje directo fallido queda como aviso recuperable", async () => {
  const { repo, tg, ctx } = nuevoContexto();
  tg.cola = [{ ok: false, error_code: "403", permanente: true }];
  await handleUpdate(ctx, updateTexto(43, 100, "/start"));
  assert(repo.avisosNav.length === 1, `Debe quedar un aviso: ${repo.avisosNav.length}`);
  const aviso = repo.avisosNav[0];
  assert(aviso.clave.startsWith("navegacion:43:"), `Clave inesperada: ${aviso.clave}`);
  assert(aviso.chat_id === 100);
  assertIncluye(aviso.texto, "Spa Manos y Pies");
  assert(
    !JSON.stringify(aviso).includes("/start"),
    "no debe registrar el cuerpo entrante",
  );
});

Deno.test("/pendientes no muestra citas cuyo horario ya pasó", async () => {
  const { repo, tg, ctx } = nuevoContexto();
  // Cita 7 con horario 25 (futuro) y cita 8 con horario 99 (2026-10-13, pasado).
  repo.pendientes = [
    citaBase({ id: 7, horario_id: 25 }),
    citaBase({ id: 8, horario_id: 99 }),
  ];
  await handleUpdate(ctx, updateTexto(44, ADMIN_USER, "/pendientes"));
  const texto = tg.enviados.at(-1)!.text;
  assertIncluye(texto, "Cita 7");
  assert(!texto.includes("Cita 8"), `No debe listar la cita vencida: ${texto}`);
  const kb = ultimoKb(tg).map((b) => b.callback_data);
  assert(kb.includes("confirmar:7") && !kb.includes("confirmar:8"));
});
