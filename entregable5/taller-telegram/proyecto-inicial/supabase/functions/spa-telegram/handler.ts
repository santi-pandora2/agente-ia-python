import type { Cita, Repo } from "./repository.ts";
import type { TelegramClient } from "./telegram.ts";

export const ZONA = "America/Bogota";
export const MAX_PENDIENTES = 10;
// La especificación pide los próximos siete días de atención, excluyendo hoy.
export const DIAS_ATENCION = 7;

export interface Context {
  repo: Repo;
  tg: TelegramClient;
  adminUserId: number;
  adminChatId: number;
  // Reloj inyectable: las pruebas usan una fecha fija, la función usa el reloj real.
  now: () => Date;
  // Datos del evento en curso. Los fija handleUpdate en cada invocación:
  // no se conserva estado entre eventos.
  update_id?: number;
  contAvisos?: number;
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    chat: { id: number; type: string };
    from: { id: number; first_name?: string; username?: string };
    text?: string;
  };
  callback_query?: {
    id: string;
    from: { id: number; first_name?: string };
    data?: string;
    message?: { chat: { id: number; type?: string } };
  };
}

export interface ResultadoAvisos {
  aceptadas: number;
  fallidas: number;
  revision: number;
  reintentables: number;
  sin_lease: number;
}

export interface WebhookDeps {
  repo: Repo;
  tg: TelegramClient;
  adminUserId: number;
  adminChatId: number;
  secret: string;
  now?: () => Date;
}

// ------------------------------- Utilidades -------------------------------

export function bogotaYmd(d: Date): string {
  return d.toLocaleDateString("sv-SE", { timeZone: ZONA });
}

export function fmtFechaBogota(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("es-CO", {
    timeZone: ZONA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function horaBogota(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("en-GB", {
    timeZone: ZONA,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// Etiqueta legible de un día (YYYY-MM-DD) sin pasar por una zona horaria:
// el día se interpreta como calendario y se arma en UTC para que el nombre
// del día de la semana no se corra por el desplazamiento local.
export function fmtDiaBogota(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const y = Number(m[1]);
  const mes = Number(m[2]);
  const d = Number(m[3]);
  if (mes < 1 || mes > 12 || d < 1 || d > 31) return ymd;
  const fecha = new Date(Date.UTC(y, mes - 1, d));
  const dia = fecha.toLocaleDateString("es-CO", {
    timeZone: "UTC",
    weekday: "short",
  });
  const mesTxt = fecha.toLocaleDateString("es-CO", {
    timeZone: "UTC",
    month: "short",
  });
  return `${dia} ${d} ${mesTxt}`.replace(/\./g, "").trim();
}

function ymdToCb(ymd: string): string {
  return ymd.replaceAll("-", "");
}

function cbToYmd(cb: string): string {
  return `${cb.slice(0, 4)}-${cb.slice(4, 6)}-${cb.slice(6, 8)}`;
}

export function buildKb(
  rows: Array<Array<{ text: string; callback_data: string }>>,
) {
  return { inline_keyboard: rows };
}

// ---------------------------- Envío directo -------------------------------
// Los mensajes de navegación y de resultado se envían directamente. Si el
// envío falla, queda registrado un aviso recuperable con clave derivada del
// update_id: así el mensaje no se pierde y se puede reintentar con
// /reintentar. Nunca se registra el cuerpo entrante de Telegram.
export async function enviarDirecto(
  ctx: Context,
  chatId: number,
  text: string,
  reply_markup?: unknown,
): Promise<void> {
  let ok = false;
  try {
    const r = await ctx.tg.sendMessage({ chat_id: chatId, text, reply_markup });
    ok = r.ok;
  } catch (_) {
    ok = false;
  }
  if (ok) return;
  const update_id = ctx.update_id;
  if (update_id === undefined) return;
  const n = ctx.contAvisos ?? 0;
  ctx.contAvisos = n + 1;
  try {
    await ctx.repo.registrarAvisoNavegacion({
      clave: `navegacion:${update_id}:${n}`,
      chat_id: chatId,
      texto: text.slice(0, 4000),
    });
  } catch (_) {
    // Si tampoco se puede registrar el aviso, no hay más que hacer aquí:
    // la cita (si hubo una) sigue guardada.
  }
}

// ------------------------------ Callbacks ---------------------------------

export type Callback =
  | { tipo: "servicios" }
  | { tipo: "agendar" }
  | { tipo: "mi_cita" }
  | { tipo: "inicio" }
  | { tipo: "servicio"; servicioId: number }
  | { tipo: "dia"; servicioId: number; dia: string }
  | { tipo: "horario"; servicioId: number; horarioId: number }
  | { tipo: "enviar"; servicioId: number; horarioId: number }
  | { tipo: "confirmar"; citaId: number }
  | { tipo: "rechazar"; citaId: number }
  | { tipo: "cancelar"; citaId: number }
  | { tipo: "cancelar_ok"; citaId: number }
  | { tipo: "pendientes"; offset: number };

function entero(s: string | undefined): number | null {
  if (s === undefined || !/^\d{1,15}$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

function dos(accion: string, partes: string[]): Callback | null {
  const a = entero(partes[1]);
  const b = entero(partes[2]);
  if (!a || !b || partes.length !== 3) return null;
  if (accion === "horario") return { tipo: "horario", servicioId: a, horarioId: b };
  if (accion === "enviar") return { tipo: "enviar", servicioId: a, horarioId: b };
  return null;
}

// Valida el formato ANTES de usar los datos. Devuelve null si es inválido o
// demasiado largo; nunca se convierte en SQL.
export function parseCallback(data: string | undefined): Callback | null {
  if (!data || data.length > 64) return null;
  const partes = data.split(":");
  const accion = partes[0];
  if (partes.length === 1) {
    if (accion === "servicios") return { tipo: "servicios" };
    if (accion === "agendar") return { tipo: "agendar" };
    if (accion === "mi_cita") return { tipo: "mi_cita" };
    if (accion === "inicio") return { tipo: "inicio" };
    return null;
  }
  if (accion === "servicio") {
    const a = entero(partes[1]);
    return partes.length === 2 && a ? { tipo: "servicio", servicioId: a } : null;
  }
  if (accion === "dia") {
    const a = entero(partes[1]);
    const dia = partes[2];
    return partes.length === 3 && a && dia && /^\d{8}$/.test(dia)
      ? { tipo: "dia", servicioId: a, dia }
      : null;
  }
  if (accion === "horario" || accion === "enviar") {
    return dos(accion, partes);
  }
  if (
    accion === "confirmar" || accion === "rechazar" || accion === "cancelar" ||
    accion === "cancelar_ok"
  ) {
    const a = entero(partes[1]);
    if (partes.length !== 2 || !a) return null;
    return { tipo: accion, citaId: a } as Callback;
  }
  if (accion === "pendientes") {
    const a = entero(partes[1]);
    return partes.length === 2 && a !== null
      ? { tipo: "pendientes", offset: a }
      : null;
  }
  return null;
}

// ------------------------------ Notificaciones ----------------------------

export interface Aviso {
  text: string;
  reply_markup?: unknown;
}

// Convierte el teclado que viaja en el payload del aviso al formato de
// Telegram. Solo se aceptan callback_data que el enrutador ya sabe
// interpretar (parseCallback): un dato manipulado no autoriza nada y
// tampoco se envía a Telegram.
function tecladoDesdePayload(valor: unknown): unknown | undefined {
  if (!Array.isArray(valor)) return undefined;
  const filas: Array<Array<{ text: string; callback_data: string }>> = [];
  for (const fila of valor) {
    if (!Array.isArray(fila)) continue;
    const botones: Array<{ text: string; callback_data: string }> = [];
    for (const boton of fila) {
      const b = (boton ?? {}) as Record<string, unknown>;
      const texto = String(b.texto ?? "").trim().slice(0, 64);
      const callback = String(b.callback_data ?? "");
      if (!texto || callback.length > 64) continue;
      if (!parseCallback(callback)) continue;
      botones.push({ text: texto, callback_data: callback });
    }
    if (botones.length > 0) filas.push(botones);
  }
  return filas.length > 0 ? { inline_keyboard: filas } : undefined;
}

export function formatNotif(payload: unknown): Aviso {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (!p.tipo) return { text: "Notificación del spa." };
  switch (p.tipo) {
    case "solicitada_cliente":
      return {
        text: `Solicitud recibida. ID de cita: ${p.cita_id}. Pendiente de confirmación.`,
      };
    case "solicitada_admin":
      return {
        text:
          `Nueva solicitud. Cita: ${p.cita_id}. Cliente: ${p.nombre ?? p.cliente_user_id ?? ""}`,
        reply_markup: tecladoDesdePayload(p.teclado),
      };
    case "confirmada_cliente":
      return { text: `Tu cita ${p.cita_id} fue confirmada.` };
    case "confirmada_admin":
      return { text: `Cita ${p.cita_id} confirmada.` };
    case "rechazada_cliente":
      return {
        text: `Tu cita ${p.cita_id} fue rechazada. Solicita otro horario.`,
      };
    case "rechazada_admin":
      return { text: `Cita ${p.cita_id} rechazada.` };
    case "cancelada_cliente":
      return { text: `Tu cita ${p.cita_id} fue cancelada.` };
    case "cancelada_admin":
      return { text: `Cita ${p.cita_id} cancelada por la clienta.` };
    case "navegacion":
      // Aviso recuperable de un mensaje que no se pudo enviar directamente.
      return { text: String(p.texto ?? "Notificación del spa.").slice(0, 4000) };
    default:
      return { text: "Notificación del spa." };
  }
}

export async function procesarAvisos(
  ctx: Context,
  lote: number,
): Promise<ResultadoAvisos> {
  const res: ResultadoAvisos = {
    aceptadas: 0,
    fallidas: 0,
    revision: 0,
    reintentables: 0,
    sin_lease: 0,
  };
  let claims;
  try {
    claims = await ctx.repo.reclamarNotificaciones(lote);
  } catch (_) {
    return res;
  }
  for (const c of claims) {
    const payload = c.payload;
    const aviso = formatNotif(payload);
    let envio;
    try {
      envio = await ctx.tg.sendMessage({
        chat_id: c.chat_id,
        text: aviso.text,
        reply_markup: aviso.reply_markup,
      });
    } catch (_) {
      // Excepción inesperada: no se marcó como enviada. Queda en revisión.
      try {
        await ctx.repo.finalizarNotificacion({
          id: c.id,
          lease_token: c.lease_token,
          enviada: false,
          error_codigo: "excepcion",
          incierto: true,
        });
      } catch (_) { /* no interrumpir el lote */ }
      res.revision++;
      continue;
    }

    let finalizado = false;
    if (envio.ok && envio.message_id) {
      // Solo se marca enviada si Telegram confirmó ok=true con message_id.
      try {
        finalizado = await ctx.repo.finalizarNotificacion({
          id: c.id,
          lease_token: c.lease_token,
          enviada: true,
          telegram_message_id: envio.message_id,
        });
      } catch (_) { /* dejar el lease para reintento */ }
      if (finalizado) res.aceptadas++;
      else res.sin_lease++;
      continue;
    }

    // Falla de envío: la cita NUNCA se borra; solo se actualiza el aviso.
    // - permanente (bot bloqueado) -> fallida
    // - incierto (timeout, red)    -> revision (no se reenvía a ciegas)
    // - otro error recuperable      -> vuelve a la cola con espera creciente
    try {
      finalizado = await ctx.repo.finalizarNotificacion({
        id: c.id,
        lease_token: c.lease_token,
        enviada: false,
        error_codigo: envio.error_code ?? "envio_fallido",
        retry_after_seconds: envio.retry_after,
        permanente: envio.permanente ?? false,
        incierto: envio.uncertain ?? false,
      });
    } catch (_) { /* dejar el lease para reintento */ }
    if (!finalizado) {
      res.sin_lease++;
    } else if (envio.permanente) {
      res.fallidas++;
    } else if (envio.uncertain) {
      res.revision++;
    } else {
      res.reintentables++;
    }
  }
  return res;
}

// --------------------------- Entrada de mensajes --------------------------

export async function handleUpdate(
  ctx: Context,
  upd: TelegramUpdate,
): Promise<void> {
  // Datos del evento en curso. Se fijan en cada invocación: no queda estado
  // entre eventos (la cita se vuelve a consultar en la base de datos).
  ctx.update_id = upd.update_id;
  ctx.contAvisos = 0;
  // /reintentar mueve la cola explícitamente y reporta; no procesa el lote normal.
  if (upd.message && (upd.message.text ?? "").trim() === "/reintentar") {
    await comandoReintentar(ctx, upd.message);
    return;
  }
  if (upd.callback_query) {
    await handleCallback(ctx, upd.callback_query, upd.update_id);
  } else if (upd.message) {
    await handleMessage(ctx, upd.message);
  }
  // Se espera un lote pequeño dentro de la misma invocación; sin cron la cola
  // solo avanza con eventos nuevos o /reintentar.
  await procesarAvisos(ctx, 3);
}

async function comandoReintentar(
  ctx: Context,
  msg: NonNullable<TelegramUpdate["message"]>,
) {
  if (msg.chat.type !== "private") {
    await enviarDirecto(ctx, msg.chat.id, "Solo en chat privado.");
    return;
  }
  if (msg.from.id !== ctx.adminUserId) {
    await enviarDirecto(ctx, msg.chat.id, "No autorizado.");
    return;
  }
  const r = await procesarAvisos(ctx, 10);
  await enviarDirecto(
    ctx,
    msg.chat.id,
    `Reintento: aceptadas ${r.aceptadas}, fallidas ${r.fallidas}, en revisión ${r.revision}, reintentables ${r.reintentables}.`,
  );
}

async function handleMessage(
  ctx: Context,
  msg: NonNullable<TelegramUpdate["message"]>,
) {
  const chat = msg.chat;
  if (chat.type !== "private") {
    // En grupos no se expone información ni se ejecutan acciones.
    await enviarDirecto(ctx, chat.id, "Solo en chat privado.");
    return;
  }
  const text = (msg.text ?? "").trim();
  if (text === "/start" || text === "/help") {
    await sendInicio(ctx, chat.id);
    return;
  }
  if (text === "/pendientes") {
    if (msg.from.id !== ctx.adminUserId) {
      await enviarDirecto(ctx, chat.id, "No autorizado.");
      return;
    }
    await showPendientes(ctx, msg.from.id, chat.id, 0);
    return;
  }
  // Texto no reconocido: mostrar ayuda. Nunca confirmar desde texto libre.
  await sendInicio(ctx, chat.id);
}

async function handleCallback(
  ctx: Context,
  cb: NonNullable<TelegramUpdate["callback_query"]>,
  update_id: number,
) {
  const chatId = cb.message?.chat?.id ?? cb.from.id;
  const uid = cb.from.id;

  // Se responde el callback con timeout corto; su falla no revierte nada.
  try {
    await ctx.tg.answerCallbackQuery(cb.id);
  } catch (_) { /* ignorar */ }

  // Chat privado únicamente: un botón pulsado en un grupo (por ejemplo, un
  // mensaje reenviado) no ejecuta acciones ni expone datos.
  const tipoChat = cb.message?.chat?.type;
  if (tipoChat !== undefined && tipoChat !== "private") {
    await enviarDirecto(ctx, chatId, "Solo en chat privado.");
    return;
  }

  const accion = parseCallback(cb.data);
  if (!accion) {
    // Callback manipulado o vencido: no se ejecuta nada, se muestra la ayuda.
    await sendInicio(ctx, chatId);
    return;
  }

  switch (accion.tipo) {
    case "servicios":
      await showServicios(ctx, chatId);
      return;
    case "agendar":
      await showAgendar(ctx, chatId);
      return;
    case "mi_cita":
      await showMiCita(ctx, uid, chatId);
      return;
    case "inicio":
      await sendInicio(ctx, chatId);
      return;
    case "servicio":
      await elegirHorario(ctx, uid, chatId, accion.servicioId);
      return;
    case "dia":
      await elegirHorario(ctx, uid, chatId, accion.servicioId, cbToYmd(accion.dia));
      return;
    case "horario":
      await mostrarResumen(ctx, uid, chatId, accion.servicioId, accion.horarioId);
      return;
    case "enviar":
      await enviarSolicitud(
        ctx,
        uid,
        chatId,
        accion.servicioId,
        accion.horarioId,
        cb.from.first_name ?? "Cliente",
        update_id,
      );
      return;
    case "confirmar":
    case "rechazar":
      if (uid !== ctx.adminUserId) {
        await noAutorizado(ctx, chatId);
        return;
      }
      await resolverCitaAdmin(ctx, uid, chatId, accion.citaId, accion.tipo, update_id);
      return;
    case "cancelar":
      await pedirCancelar(ctx, uid, chatId, accion.citaId);
      return;
    case "cancelar_ok":
      await cancelarCita(ctx, uid, chatId, accion.citaId, update_id);
      return;
    case "pendientes":
      if (uid !== ctx.adminUserId) {
        await noAutorizado(ctx, chatId);
        return;
      }
      await showPendientes(ctx, uid, chatId, accion.offset);
      return;
  }
}

async function noAutorizado(ctx: Context, chatId: number) {
  await enviarDirecto(ctx, chatId, "No autorizado.");
}

// ------------------------------- Pantallas --------------------------------

async function sendInicio(ctx: Context, chatId: number) {
  const kb = buildKb([
    [{ text: "Servicios", callback_data: "servicios" }],
    [{ text: "Agendar", callback_data: "agendar" }],
    [{ text: "Mi cita", callback_data: "mi_cita" }],
  ]);
  await enviarDirecto(
    ctx,
    chatId,
    "Spa Manos y Pies\nServicios • Agendar • Mi cita",
    kb,
  );
}

async function showServicios(ctx: Context, chatId: number) {
  const servicios = await ctx.repo.getServicios();
  if (servicios.length === 0) {
    await enviarDirecto(
      ctx,
      chatId,
      "No hay servicios disponibles por ahora.",
    );
    return;
  }
  let txt = "Servicios (todos de 60 minutos):\n";
  for (const s of servicios) {
    txt += `- ${s.nombre}: $${s.precio_cop.toLocaleString("es-CO")} COP · ${s.duracion_min} min\n`;
  }
  const kb = buildKb([[{ text: "Volver al inicio", callback_data: "inicio" }]]);
  await enviarDirecto(ctx, chatId, txt, kb);
}

async function showAgendar(ctx: Context, chatId: number) {
  const servicios = await ctx.repo.getServicios();
  if (servicios.length === 0) {
    await enviarDirecto(
      ctx,
      chatId,
      "No hay servicios disponibles por ahora.",
    );
    return;
  }
  const rows = servicios.map((s) => [
    { text: s.nombre, callback_data: `servicio:${s.id}` },
  ]);
  rows.push([{ text: "Volver al inicio", callback_data: "inicio" }]);
  await enviarDirecto(ctx, chatId, "Selecciona un servicio:", buildKb(rows));
}

async function elegirHorario(
  ctx: Context,
  _uid: number,
  chatId: number,
  servicioId: number,
  diaYmd?: string,
) {
  await ctx.repo.generarHorarios();
  const todos = await ctx.repo.getHorariosProximos(7);
  // Excluir hoy y cualquier horario ya pasado, comparando días en Bogotá.
  const hoyYmd = bogotaYmd(ctx.now());
  const futuros = todos.filter((h) => bogotaYmd(new Date(h.inicio)) > hoyYmd);
  const porDia = new Map<string, Array<{ id: number; inicio: string }>>();
  for (const h of futuros) {
    const d = bogotaYmd(new Date(h.inicio));
    if (!porDia.has(d)) porDia.set(d, []);
    porDia.get(d)!.push({ id: h.id, inicio: h.inicio });
  }
  const dias = Array.from(porDia.keys()).sort().slice(0, DIAS_ATENCION);
  // Un callback viejo puede apuntar a un día que ya está fuera de la ventana
  // de siete días: ese día ya no se ofrece.
  const permitidos = new Set(dias);

  if (!diaYmd) {
    if (dias.length === 0) {
      await enviarDirecto(
        ctx,
        chatId,
        "No hay horarios disponibles por ahora.",
      );
      return;
    }
    const rows = dias.map((d) => [
      { text: fmtDiaBogota(d), callback_data: `dia:${servicioId}:${ymdToCb(d)}` },
    ]);
    rows.push([{ text: "Volver", callback_data: "agendar" }]);
    await enviarDirecto(
      ctx,
      chatId,
      "Elige un día de atención (hora de Bogotá):",
      buildKb(rows),
    );
    return;
  }

  const lista = porDia.get(diaYmd);
  if (!lista || lista.length === 0 || !permitidos.has(diaYmd)) {
    // Callback viejo o día ya no disponible.
    await enviarDirecto(
      ctx,
      chatId,
      "Ese día ya no está disponible. Vuelve a elegir un día.",
    );
    return;
  }
  lista.sort((a, b) => a.inicio.localeCompare(b.inicio));
  const rows = lista.map((h) => [
    { text: horaBogota(h.inicio), callback_data: `horario:${servicioId}:${h.id}` },
  ]);
  rows.push([{ text: "Volver", callback_data: `servicio:${servicioId}` }]);
  await enviarDirecto(
    ctx,
    chatId,
    `Horarios para ${fmtDiaBogota(diaYmd)} (hora de Bogotá):`,
    buildKb(rows),
  );
}

async function mostrarResumen(
  ctx: Context,
  _uid: number,
  chatId: number,
  servicioId: number,
  horarioId: number,
) {
  const [servs, h] = await Promise.all([
    ctx.repo.getServicios(),
    ctx.repo.getHorarioById(horarioId),
  ]);
  const s = servs.find((x) => x.id === servicioId);
  if (!s || !h) {
    await enviarDirecto(
      ctx,
      chatId,
      "No encontramos ese servicio u horario. Vuelve a agendar.",
    );
    return;
  }
  if (bogotaYmd(new Date(h.inicio)) <= bogotaYmd(ctx.now())) {
    await enviarDirecto(
      ctx,
      chatId,
      "Ese horario ya pasó o es de hoy. Elige otro día.",
    );
    return;
  }
  const txt =
    `Resumen de tu solicitud\nServicio: ${s.nombre}\nPrecio: $${s.precio_cop.toLocaleString("es-CO")} COP\nHorario: ${fmtFechaBogota(h.inicio)} (Bogotá)\nAún no ocupa el horario.`;
  const kb = buildKb([
    [{ text: "Enviar solicitud", callback_data: `enviar:${servicioId}:${h.id}` }],
    [{ text: "Volver al inicio", callback_data: "inicio" }],
  ]);
  await enviarDirecto(ctx, chatId, txt, kb);
}

async function enviarSolicitud(
  ctx: Context,
  uid: number,
  chatId: number,
  servicioId: number,
  horarioId: number,
  nombreFrom: string,
  update_id: number,
) {
  // Revalidar en el servidor: no confiar en el callback.
  const h = await ctx.repo.getHorarioById(horarioId);
  if (!h) {
    await enviarDirecto(
      ctx,
      chatId,
      "Ese horario no existe. Vuelve a agendar.",
    );
    return;
  }
  // El servicio también se revalida: un callback manipulado con un servicio
  // inexistente es un error de negocio (respuesta 200), no una falla técnica.
  const servicios = await ctx.repo.getServicios();
  if (!servicios.some((s) => s.id === servicioId)) {
    await enviarDirecto(
      ctx,
      chatId,
      "Ese servicio no está disponible. Vuelve a agendar.",
    );
    return;
  }
  if (bogotaYmd(new Date(h.inicio)) <= bogotaYmd(ctx.now())) {
    await enviarDirecto(
      ctx,
      chatId,
      "Ese horario ya pasó o es de hoy. Elige otro día.",
    );
    return;
  }
  const nombre = (nombreFrom ?? "").trim().slice(0, 80) || "Cliente";
  const res = await ctx.repo.mutarCita({
    update_id,
    accion: "solicitar",
    actor_user_id: uid,
    actor_chat_id: chatId,
    nombre,
    servicio_id: servicioId,
    horario_id: horarioId,
    admin_user_id: ctx.adminUserId,
    admin_chat_id: ctx.adminChatId,
  });
  await enviarDirecto(ctx, chatId, mensajeResultado("solicitar", res));
}

async function showMiCita(ctx: Context, uid: number, chatId: number) {
  const c = await ctx.repo.getCitaActiva(uid);
  if (!c) {
    const kb = buildKb([[{ text: "Volver al inicio", callback_data: "inicio" }]]);
    await enviarDirecto(
      ctx,
      chatId,
      "No tienes una cita activa.",
      kb,
    );
    return;
  }
  const h = await ctx.repo.getHorarioById(c.horario_id);
  // Una cita cuyo horario ya pasó no está vigente: no se ofrece cancelar
  // (la RPC la cerraría) sino pedir una nueva, como pide la especificación.
  const sinHorario = h === null;
  const vencida = sinHorario ||
    new Date(h!.inicio).getTime() <= ctx.now().getTime();
  const estado = sinHorario
    ? `${c.estado} (horario no disponible)`
    : vencida
    ? `${c.estado} (el horario ya pasó)`
    : c.estado;
  const txt = `Mi cita\nID: ${c.id}\nEstado: ${estado}\nHorario: ${
    h ? fmtFechaBogota(h.inicio) : c.horario_id
  } (Bogotá)${
    vencida
      ? "\nEsta cita ya no está vigente. Puedes solicitar un horario nuevo."
      : ""
  }`;
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  if (vencida) {
    rows.push([{ text: "Agendar", callback_data: "agendar" }]);
  } else if (c.estado === "pendiente" || c.estado === "confirmada") {
    rows.push([{ text: "Cancelar cita", callback_data: `cancelar:${c.id}` }]);
  }
  rows.push([{ text: "Volver al inicio", callback_data: "inicio" }]);
  await enviarDirecto(ctx, chatId, txt, buildKb(rows));
}

async function pedirCancelar(
  ctx: Context,
  uid: number,
  chatId: number,
  cid: number,
) {
  // El botón se revalida: solo se pide la confirmación de una cita propia.
  const cita = await ctx.repo.getCitaById(cid);
  if (!cita) {
    await enviarDirecto(ctx, chatId, "No encontramos esa cita.");
    return;
  }
  if (cita.cliente_user_id !== uid) {
    await noAutorizado(ctx, chatId);
    return;
  }
  const kb = buildKb([
    [{ text: "Sí, cancelar", callback_data: `cancelar_ok:${cid}` }],
    [{ text: "No", callback_data: "mi_cita" }],
  ]);
  await enviarDirecto(
    ctx,
    chatId,
    "Confirma la cancelación. Esta acción libera el horario.",
    kb,
  );
}

async function cancelarCita(
  ctx: Context,
  uid: number,
  chatId: number,
  cid: number,
  update_id: number,
) {
  const cita = await ctx.repo.getCitaById(cid);
  if (!cita) {
    await enviarDirecto(ctx, chatId, "No encontramos esa cita.");
    return;
  }
  // Permiso comprobado en el servidor por user_id, no por el botón.
  if (cita.cliente_user_id !== uid) {
    await noAutorizado(ctx, chatId);
    return;
  }
  const res = await ctx.repo.mutarCita({
    update_id,
    accion: "cancelar",
    actor_user_id: uid,
    actor_chat_id: chatId,
    nombre: cita.cliente_nombre ?? "",
    cita_id: cid,
    admin_user_id: ctx.adminUserId,
    admin_chat_id: ctx.adminChatId,
  });
  await enviarDirecto(ctx, chatId, mensajeResultado("cancelar", res));
}

async function resolverCitaAdmin(
  ctx: Context,
  uid: number,
  chatId: number,
  cid: number,
  accion: "confirmar" | "rechazar",
  update_id: number,
) {
  const res = await ctx.repo.mutarCita({
    update_id,
    accion,
    actor_user_id: uid,
    actor_chat_id: chatId,
    nombre: "Admin",
    cita_id: cid,
    admin_user_id: ctx.adminUserId,
    admin_chat_id: ctx.adminChatId,
  });
  await enviarDirecto(ctx, chatId, mensajeResultado(accion, res, "admin"));
}

async function showPendientes(
  ctx: Context,
  _uid: number,
  chatId: number,
  offset: number,
) {
  const citas = await ctx.repo.getPendientes(offset, MAX_PENDIENTES);
  // Solo citas futuras: una cita pendiente cuyo horario ya pasó no se
  // ofrece para confirmar ni para rechazar.
  const futuras: Array<{ cita: Cita; inicio: string }> = [];
  for (const c of citas) {
    const h = await ctx.repo.getHorarioById(c.horario_id);
    if (!h) continue;
    if (new Date(h.inicio).getTime() <= ctx.now().getTime()) continue;
    futuras.push({ cita: c, inicio: h.inicio });
  }
  let txt = futuras.length
    ? `Citas pendientes (desde ${offset}):\n`
    : "No hay citas pendientes.";
  for (const f of futuras) {
    txt += `- Cita ${f.cita.id}: ${fmtFechaBogota(f.inicio)}\n`;
  }
  const rows = futuras.map((f) => [
    { text: `Confirmar ${f.cita.id}`, callback_data: `confirmar:${f.cita.id}` },
    { text: `Rechazar ${f.cita.id}`, callback_data: `rechazar:${f.cita.id}` },
  ]);
  if (citas.length === MAX_PENDIENTES) {
    rows.push([
      { text: "Siguiente", callback_data: `pendientes:${offset + MAX_PENDIENTES}` },
    ]);
  }
  rows.push([{ text: "Volver al inicio", callback_data: "inicio" }]);
  await enviarDirecto(ctx, chatId, txt, buildKb(rows));
}

function mensajeResultado(
  accion: "solicitar" | "confirmar" | "rechazar" | "cancelar",
  res: { estado?: unknown; [k: string]: unknown },
  audiencia: "cliente" | "admin" = "cliente",
): string {
  const estado = String(res?.estado ?? "");
  const id = res?.cita_id !== undefined ? String(res.cita_id) : "";
  switch (estado) {
    case "ok":
      if (accion === "solicitar") {
        return `Solicitud creada. ID de cita: ${id}. Queda pendiente de confirmación.`;
      }
      if (accion === "confirmar") return `Cita ${id} confirmada.`.trim();
      if (accion === "rechazar") {
        return "Cita rechazada. La clienta puede solicitar otro horario.";
      }
      return "Cita cancelada. El horario quedó libre.";
    case "duplicado":
      return "Esta acción ya se había procesado. No se duplicó la cita.";
    case "consulta_tu_cita":
      return "Ya tienes una cita activa. Usa [Mi cita] para gestionarla o cancélala para agendar otra.";
    case "horario_ocupado":
      return "Ese horario ya está ocupado. Elige otro horario.";
    case "vencida":
      // El mismo desenlace se ve distinto según quién mira el mensaje.
      return audiencia === "admin"
        ? `El horario de la cita ${id} ya pasó: la cita se cerró y no se confirmó.`
        : "Ese horario ya pasó. Elige otro horario.";
    case "estado_invalido":
      return audiencia === "admin"
        ? `La cita ${id} ya cambió de estado (actual: ${String(res?.actual ?? "?")}).`
        : "La cita ya cambió de estado. Abre [Mi cita] para ver el estado actual.";
    case "no_encontrada":
      return "No encontramos esa cita.";
    case "no_autorizado":
      return "No autorizado.";
    case "accion_desconocida":
      return "No se pudo completar la acción.";
    default:
      return "No se pudo completar la acción. Intenta de nuevo.";
  }
}

// ------------------------- Entrada HTTP del webhook -----------------------

export async function handleRequest(
  req: Request,
  deps: WebhookDeps,
): Promise<Response> {
  // 405 método incorrecto.
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  // 401 secreto incorrecto. Se compara ANTES de leer el cuerpo.
  const recibido = req.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (!deps.secret || recibido !== deps.secret) {
    return new Response("Unauthorized", { status: 401 });
  }
  // 400 JSON inválido o evento mal formado.
  let cuerpo: string;
  try {
    cuerpo = await req.text();
  } catch (_) {
    return new Response("Bad Request", { status: 400 });
  }
  let upd: TelegramUpdate;
  try {
    upd = JSON.parse(cuerpo) as TelegramUpdate;
  } catch (_) {
    return new Response("Bad Request", { status: 400 });
  }
  if (!upd || typeof upd !== "object" || typeof upd.update_id !== "number") {
    return new Response("Bad Request", { status: 400 });
  }

  const ctx: Context = {
    repo: deps.repo,
    tg: deps.tg,
    adminUserId: deps.adminUserId,
    adminChatId: deps.adminChatId,
    now: deps.now ?? (() => new Date()),
  };
  try {
    await handleUpdate(ctx, upd);
  } catch (_) {
    // Falla técnica antes de confirmar la transacción.
    return new Response("error", { status: 500 });
  }
  // Eventos válidos, ignorados y errores de negocio responden 200.
  return new Response("ok", { status: 200 });
}
