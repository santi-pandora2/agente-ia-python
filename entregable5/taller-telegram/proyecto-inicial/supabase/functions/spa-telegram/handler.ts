import type { Repo } from "./repository.ts";
import type { TelegramClient } from "./telegram.ts";

export const ZONA = "America/Bogota";
export const MAX_PENDIENTES = 10;

export interface Context {
  repo: Repo;
  tg: TelegramClient;
  adminUserId: number;
  adminChatId: number;
  // Reloj inyectable: las pruebas usan una fecha fija, la función usa el reloj real.
  now: () => Date;
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
    message?: { chat: { id: number } };
  };
}

export interface ResultadoAvisos {
  aceptadas: number;
  fallidas: number;
  revision: number;
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

function formatNotif(payload: unknown): string {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (!p.tipo) return "Notificación del spa.";
  switch (p.tipo) {
    case "solicitada_cliente":
      return `Solicitud recibida. ID de cita: ${p.cita_id}. Pendiente de confirmación.`;
    case "solicitada_admin":
      return `Nueva solicitud. Cita: ${p.cita_id}. Cliente: ${p.nombre ?? p.cliente_user_id ?? ""}`;
    case "confirmada_cliente":
      return `Tu cita ${p.cita_id} fue confirmada.`;
    case "confirmada_admin":
      return `Cita ${p.cita_id} confirmada.`;
    case "rechazada_cliente":
      return `Tu cita ${p.cita_id} fue rechazada. Solicita otro horario.`;
    case "rechazada_admin":
      return `Cita ${p.cita_id} rechazada.`;
    case "cancelada_cliente":
      return `Tu cita ${p.cita_id} fue cancelada.`;
    case "cancelada_admin":
      return `Cita ${p.cita_id} cancelada por la clienta.`;
    default:
      return "Notificación del spa.";
  }
}

export async function procesarAvisos(
  ctx: Context,
  lote: number,
): Promise<ResultadoAvisos> {
  const res: ResultadoAvisos = { aceptadas: 0, fallidas: 0, revision: 0, sin_lease: 0 };
  let claims;
  try {
    claims = await ctx.repo.reclamarNotificaciones(lote);
  } catch (_) {
    return res;
  }
  for (const c of claims) {
    const payload = c.payload;
    let envio;
    try {
      envio = await ctx.tg.sendMessage({
        chat_id: c.chat_id,
        text: formatNotif(payload),
      });
    } catch (_) {
      // Excepción inesperada: no se marcó como enviada. Queda en revisión.
      try {
        await ctx.repo.finalizarNotificacion({
          id: c.id,
          lease_token: c.lease_token,
          enviada: false,
          error_codigo: "excepcion",
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
    try {
      finalizado = await ctx.repo.finalizarNotificacion({
        id: c.id,
        lease_token: c.lease_token,
        enviada: false,
        error_codigo: envio.error_code ?? "envio_fallido",
        retry_after_seconds: envio.retry_after,
        permanente: envio.permanente ?? false,
      });
    } catch (_) { /* dejar el lease para reintento */ }
    if (!finalizado) {
      res.sin_lease++;
    } else if (envio.permanente) {
      res.fallidas++;
    } else {
      res.revision++;
    }
  }
  return res;
}

// --------------------------- Entrada de mensajes --------------------------

export async function handleUpdate(
  ctx: Context,
  upd: TelegramUpdate,
): Promise<void> {
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
    await ctx.tg.sendMessage({ chat_id: msg.chat.id, text: "Solo en chat privado." });
    return;
  }
  if (msg.from.id !== ctx.adminUserId) {
    await ctx.tg.sendMessage({ chat_id: msg.chat.id, text: "No autorizado." });
    return;
  }
  const r = await procesarAvisos(ctx, 10);
  await ctx.tg.sendMessage({
    chat_id: msg.chat.id,
    text:
      `Reintento: aceptadas ${r.aceptadas}, fallidas ${r.fallidas}, en revisión ${r.revision}.`,
  });
}

async function handleMessage(
  ctx: Context,
  msg: NonNullable<TelegramUpdate["message"]>,
) {
  const chat = msg.chat;
  if (chat.type !== "private") {
    // En grupos no se expone información ni se ejecutan acciones.
    await ctx.tg.sendMessage({ chat_id: chat.id, text: "Solo en chat privado." });
    return;
  }
  const text = (msg.text ?? "").trim();
  if (text === "/start" || text === "/help") {
    await sendInicio(ctx, chat.id);
    return;
  }
  if (text === "/pendientes") {
    if (msg.from.id !== ctx.adminUserId) {
      await ctx.tg.sendMessage({ chat_id: chat.id, text: "No autorizado." });
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
  await ctx.tg.sendMessage({ chat_id: chatId, text: "No autorizado." });
}

// ------------------------------- Pantallas --------------------------------

async function sendInicio(ctx: Context, chatId: number) {
  const kb = buildKb([
    [{ text: "Servicios", callback_data: "servicios" }],
    [{ text: "Agendar", callback_data: "agendar" }],
    [{ text: "Mi cita", callback_data: "mi_cita" }],
  ]);
  await ctx.tg.sendMessage({
    chat_id: chatId,
    text: "Spa Manos y Pies\nServicios • Agendar • Mi cita",
    reply_markup: kb,
  });
}

async function showServicios(ctx: Context, chatId: number) {
  const servicios = await ctx.repo.getServicios();
  let txt = "Servicios (todos de 60 minutos):\n";
  for (const s of servicios) {
    txt += `- ${s.nombre}: $${s.precio_cop.toLocaleString("es-CO")} COP · ${s.duracion_min} min\n`;
  }
  const kb = buildKb([[{ text: "Volver al inicio", callback_data: "inicio" }]]);
  await ctx.tg.sendMessage({ chat_id: chatId, text: txt, reply_markup: kb });
}

async function showAgendar(ctx: Context, chatId: number) {
  const servicios = await ctx.repo.getServicios();
  const rows = servicios.map((s) => [
    { text: s.nombre, callback_data: `servicio:${s.id}` },
  ]);
  rows.push([{ text: "Volver al inicio", callback_data: "inicio" }]);
  await ctx.tg.sendMessage({
    chat_id: chatId,
    text: "Selecciona un servicio:",
    reply_markup: buildKb(rows),
  });
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
  const dias = Array.from(porDia.keys()).sort();

  if (!diaYmd) {
    if (dias.length === 0) {
      await ctx.tg.sendMessage({
        chat_id: chatId,
        text: "No hay horarios disponibles por ahora.",
      });
      return;
    }
    const rows = dias.map((d) => [
      { text: d, callback_data: `dia:${servicioId}:${ymdToCb(d)}` },
    ]);
    rows.push([{ text: "Volver", callback_data: "agendar" }]);
    await ctx.tg.sendMessage({
      chat_id: chatId,
      text: "Elige un día de atención (hora de Bogotá):",
      reply_markup: buildKb(rows),
    });
    return;
  }

  const lista = porDia.get(diaYmd);
  if (!lista || lista.length === 0) {
    // Callback viejo o día ya no disponible.
    await ctx.tg.sendMessage({
      chat_id: chatId,
      text: "Ese día ya no está disponible. Vuelve a elegir un día.",
    });
    return;
  }
  lista.sort((a, b) => a.inicio.localeCompare(b.inicio));
  const rows = lista.map((h) => [
    { text: horaBogota(h.inicio), callback_data: `horario:${servicioId}:${h.id}` },
  ]);
  rows.push([{ text: "Volver", callback_data: `servicio:${servicioId}` }]);
  await ctx.tg.sendMessage({
    chat_id: chatId,
    text: `Horarios para ${diaYmd} (hora de Bogotá):`,
    reply_markup: buildKb(rows),
  });
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
    await ctx.tg.sendMessage({
      chat_id: chatId,
      text: "No encontramos ese servicio u horario. Vuelve a agendar.",
    });
    return;
  }
  if (bogotaYmd(new Date(h.inicio)) <= bogotaYmd(ctx.now())) {
    await ctx.tg.sendMessage({
      chat_id: chatId,
      text: "Ese horario ya pasó o es de hoy. Elige otro día.",
    });
    return;
  }
  const txt =
    `Resumen de tu solicitud\nServicio: ${s.nombre}\nPrecio: $${s.precio_cop.toLocaleString("es-CO")} COP\nHorario: ${fmtFechaBogota(h.inicio)} (Bogotá)\nAún no ocupa el horario.`;
  const kb = buildKb([
    [{ text: "Enviar solicitud", callback_data: `enviar:${servicioId}:${h.id}` }],
    [{ text: "Volver al inicio", callback_data: "inicio" }],
  ]);
  await ctx.tg.sendMessage({ chat_id: chatId, text: txt, reply_markup: kb });
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
    await ctx.tg.sendMessage({
      chat_id: chatId,
      text: "Ese horario no existe. Vuelve a agendar.",
    });
    return;
  }
  if (bogotaYmd(new Date(h.inicio)) <= bogotaYmd(ctx.now())) {
    await ctx.tg.sendMessage({
      chat_id: chatId,
      text: "Ese horario ya pasó o es de hoy. Elige otro día.",
    });
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
  await ctx.tg.sendMessage({
    chat_id: chatId,
    text: mensajeResultado("solicitar", res),
  });
}

async function showMiCita(ctx: Context, uid: number, chatId: number) {
  const c = await ctx.repo.getCitaActiva(uid);
  if (!c) {
    const kb = buildKb([[{ text: "Volver al inicio", callback_data: "inicio" }]]);
    await ctx.tg.sendMessage({
      chat_id: chatId,
      text: "No tienes una cita activa.",
      reply_markup: kb,
    });
    return;
  }
  const h = await ctx.repo.getHorarioById(c.horario_id);
  const txt = `Mi cita\nID: ${c.id}\nEstado: ${c.estado}\nHorario: ${
    h ? fmtFechaBogota(h.inicio) : c.horario_id
  } (Bogotá)`;
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  if (c.estado === "pendiente" || c.estado === "confirmada") {
    rows.push([{ text: "Cancelar cita", callback_data: `cancelar:${c.id}` }]);
  }
  rows.push([{ text: "Volver al inicio", callback_data: "inicio" }]);
  await ctx.tg.sendMessage({
    chat_id: chatId,
    text: txt,
    reply_markup: buildKb(rows),
  });
}

async function pedirCancelar(
  ctx: Context,
  _uid: number,
  chatId: number,
  cid: number,
) {
  const kb = buildKb([
    [{ text: "Sí, cancelar", callback_data: `cancelar_ok:${cid}` }],
    [{ text: "No", callback_data: "mi_cita" }],
  ]);
  await ctx.tg.sendMessage({
    chat_id: chatId,
    text: "Confirma la cancelación. Esta acción libera el horario.",
    reply_markup: kb,
  });
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
    await ctx.tg.sendMessage({ chat_id: chatId, text: "No encontramos esa cita." });
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
  await ctx.tg.sendMessage({
    chat_id: chatId,
    text: mensajeResultado("cancelar", res),
  });
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
  await ctx.tg.sendMessage({
    chat_id: chatId,
    text: mensajeResultado(accion, res),
  });
}

async function showPendientes(
  ctx: Context,
  _uid: number,
  chatId: number,
  offset: number,
) {
  const citas = await ctx.repo.getPendientes(offset, MAX_PENDIENTES);
  let txt = citas.length
    ? `Citas pendientes (desde ${offset}):\n`
    : "No hay citas pendientes.";
  for (const c of citas) {
    const h = await ctx.repo.getHorarioById(c.horario_id);
    txt += `- Cita ${c.id}: ${h ? fmtFechaBogota(h.inicio) : c.horario_id}\n`;
  }
  const rows = citas.map((c) => [
    { text: `Confirmar ${c.id}`, callback_data: `confirmar:${c.id}` },
    { text: `Rechazar ${c.id}`, callback_data: `rechazar:${c.id}` },
  ]);
  if (citas.length === MAX_PENDIENTES) {
    rows.push([
      { text: "Siguiente", callback_data: `pendientes:${offset + MAX_PENDIENTES}` },
    ]);
  }
  rows.push([{ text: "Volver al inicio", callback_data: "inicio" }]);
  await ctx.tg.sendMessage({ chat_id: chatId, text: txt, reply_markup: buildKb(rows) });
}

function mensajeResultado(
  accion: "solicitar" | "confirmar" | "rechazar" | "cancelar",
  res: { estado?: unknown; [k: string]: unknown },
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
      return "Ese horario ya pasó. Elige otro horario.";
    case "estado_invalido":
      return "La cita ya cambió de estado. Abre [Mi cita] para ver el estado actual.";
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
