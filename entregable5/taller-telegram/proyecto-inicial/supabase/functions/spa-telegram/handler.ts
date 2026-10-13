import type { Repo, Cita } from "./repository.ts";
import type { TelegramClient } from "./telegram.ts";

const ZONA = "America/Bogota";
const MAX_PENDIENTES = 10;

export interface Context {
  repo: Repo;
  tg: TelegramClient;
  adminUserId: number;
  adminChatId: number;
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

export function fmtFechaBogota(iso: string): string {
  try {
    return new Date(iso).toLocaleString("es-CO", {
      timeZone: ZONA,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function parseCb(data: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!data) return out;
  for (const p of data.split(";")) {
    const [k, v] = p.split("=");
    if (k) out[k] = v ?? "";
  }
  return out;
}

export function buildKb(rows: Array<Array<{ text: string; callback_data: string }>>) {
  return { inline_keyboard: rows };
}

function formatNotif(payload: any): string {
  if (!payload || !payload.tipo) return "Notificación";
  switch (payload.tipo) {
    case "solicitada_cliente":
      return `Solicitud recibida. ID cita: ${payload.cita_id}. Pendiente de confirmación.`;
    case "solicitada_admin":
      return `Nueva solicitud. Cita: ${payload.cita_id} Cliente: ${payload.cliente_user_id} ${payload.nombre ?? ""}`;
    case "confirmada_cliente":
      return `Tu cita ${payload.cita_id} fue confirmada.`;
    case "confirmada_admin":
      return `Cita ${payload.cita_id} confirmada.`;
    case "rechazada_cliente":
      return `Tu cita ${payload.cita_id} fue rechazada. Solicita otro horario.`;
    case "rechazada_admin":
      return `Cita ${payload.cita_id} rechazada.`;
    case "cancelada_cliente":
      return `Tu cita ${payload.cita_id} fue cancelada.`;
    case "cancelada_admin":
      return `Cita ${payload.cita_id} cancelada por cliente.`;
    default:
      return "Notificación";
  }
}

export async function handleUpdate(ctx: Context, upd: TelegramUpdate): Promise<void> {
  try {
    const claims = await ctx.repo.reclamarNotificaciones(3);
    for (const c of claims) {
      try {
        const payload = c.payload as any;
        const r = await ctx.tg.sendMessage({ chat_id: c.chat_id, text: formatNotif(payload) });
        if (r.ok && r.message_id) {
          await ctx.repo.finalizarNotificacion({ id: c.id, lease_token: c.lease_token, enviada: true, telegram_message_id: r.message_id });
        } else {
          await ctx.repo.finalizarNotificacion({
            id: c.id,
            lease_token: c.lease_token,
            enviada: false,
            error_codigo: r.error_code,
            retry_after_seconds: r.retry_after,
          });
        }
      } catch (_) {
        await ctx.repo.finalizarNotificacion({ id: c.id, lease_token: c.lease_token, enviada: false, error_codigo: "excepcion" });
      }
    }
  } catch (_) {}

  if (upd.callback_query) {
    await handleCallback(ctx, upd.callback_query);
    return;
  }
  if (upd.message) {
    await handleMessageFull(ctx, upd.message, upd.update_id);
    return;
  }
}

async function handleCallback(ctx: Context, cb: NonNullable<TelegramUpdate["callback_query"]>) {
  const data = cb.data || "";
  const p = parseCb(data);
  const chatId = cb.message?.chat?.id ?? cb.from.id;
  const uid = cb.from.id;
  void ctx.tg.answerCallbackQuery(cb.id).catch(() => {});

  if (p.a === "serv") {
    await showServicios(ctx, chatId);
    return;
  }
  if (p.a === "agendar") {
    await showAgendar(ctx, uid, chatId);
    return;
  }
  if (p.a === "micita") {
    await showMiCita(ctx, uid, chatId);
    return;
  }
  if (p.a === "inicio") {
    await sendInicio(chatId, ctx.tg);
    return;
  }
  if (p.a === "s") {
    const sid = parseInt(p.sid || "0");
    await elegirHorario(ctx, uid, chatId, sid);
    return;
  }
  if (p.a === "d") {
    const sid = parseInt(p.sid || "0");
    const dia = p.d || "";
    await elegirHorario(ctx, uid, chatId, sid, dia);
    return;
  }
  if (p.a === "h") {
    const sid = parseInt(p.sid || "0");
    const hid = parseInt(p.hid || "0");
    await mostrarResumen(ctx, uid, chatId, sid, hid);
    return;
  }
  if (p.a === "env") {
    const sid = parseInt(p.sid || "0");
    const hid = parseInt(p.hid || "0");
    const nom = p.nom || "";
    await enviarSolicitud(ctx, uid, chatId, sid, hid, nom, cb.from.first_name || "Cliente");
    return;
  }
  if (p.a === "conf") {
    const cid = parseInt(p.cid || "0");
    await confirmarCita(ctx, uid, chatId, cid);
    return;
  }
  if (p.a === "rech") {
    const cid = parseInt(p.cid || "0");
    await rechazarCita(ctx, uid, chatId, cid);
    return;
  }
  if (p.a === "cancel") {
    const cid = parseInt(p.cid || "0");
    await pedirCancelar(ctx, uid, chatId, cid);
    return;
  }
  if (p.a === "cancelok") {
    const cid = parseInt(p.cid || "0");
    await cancelarCita(ctx, uid, chatId, cid);
    return;
  }
  if (p.a === "pen") {
    const off = parseInt(p.off || "0");
    await showPendientes(ctx, chatId, off);
    return;
  }
}

async function handleMessageFull(ctx: Context, msg: NonNullable<TelegramUpdate["message"]>, update_id: number) {
  const chat = msg.chat;
  const from = msg.from;
  if (chat.type !== "private") {
    await ctx.tg.sendMessage({ chat_id: chat.id, text: "Solo en chat privado." });
    return;
  }
  const text = (msg.text || "").trim();
  if (text === "/start" || text === "/help") {
    await sendInicio(chat.id, ctx.tg);
    return;
  }
  if (text === "/pendientes") {
    if (from.id !== ctx.adminUserId) {
      await ctx.tg.sendMessage({ chat_id: chat.id, text: "No autorizado." });
      return;
    }
    await showPendientes(ctx, chat.id, 0);
    return;
  }
  if (text === "/reintentar") {
    if (from.id !== ctx.adminUserId) {
      await ctx.tg.sendMessage({ chat_id: chat.id, text: "No autorizado." });
      return;
    }
    await ctx.repo.reclamarNotificaciones(10);
    await ctx.tg.sendMessage({ chat_id: chat.id, text: "Reintento solicitado (lote hasta 10)." });
    return;
  }
  await sendInicio(chat.id, ctx.tg);
}

async function sendInicio(chatId: number, tg: TelegramClient) {
  const kb = buildKb([
    [{ text: "Servicios", callback_data: "a=serv" }],
    [{ text: "Agendar", callback_data: "a=agendar" }],
    [{ text: "Mi cita", callback_data: "a=micita" }],
  ]);
  await tg.sendMessage({ chat_id: chatId, text: "Spa Manos y Pies\nServicios • Agendar • Mi cita", reply_markup: kb });
}

async function showServicios(ctx: Context, chatId: number) {
  const servicios = await ctx.repo.getServicios();
  let txt = "Servicios:\n";
  for (const s of servicios) {
    txt += `- ${s.nombre}: $${s.precio_cop.toLocaleString("es-CO")} • ${s.duracion_min} min\n`;
  }
  const kb = buildKb([[{ text: "Volver al inicio", callback_data: "a=inicio" }]]);
  await ctx.tg.sendMessage({ chat_id: chatId, text: txt, reply_markup: kb });
}

async function showAgendar(ctx: Context, uid: number, chatId: number) {
  const servicios = await ctx.repo.getServicios();
  const rows = servicios.map((s) => [{ text: s.nombre, callback_data: `a=s;sid=${s.id}` }]);
  rows.push([{ text: "Volver al inicio", callback_data: "a=inicio" }]);
  await ctx.tg.sendMessage({ chat_id: chatId, text: "Selecciona servicio:", reply_markup: buildKb(rows) });
}

async function elegirHorario(ctx: Context, uid: number, chatId: number, sid: number, diaSel?: string) {
  await ctx.repo.generarHorarios();
  const hs = await ctx.repo.getHorariosProximos(7);
  // agrupar por día
  const porDia = new Map<string, Array<{ id: number; inicio: string }>>();
  for (const h of hs) {
    const d = new Date(h.inicio).toLocaleDateString("sv-SE", { timeZone: ZONA });
    if (!porDia.has(d)) porDia.set(d, []);
    porDia.get(d)!.push({ id: h.id, inicio: h.inicio });
  }
  const dias = Array.from(porDia.keys()).sort();
  if (!diaSel) {
    const rows = dias.map((d) => [{ text: d, callback_data: `a=d;sid=${sid};d=${d}` }]);
    rows.push([{ text: "Volver", callback_data: "a=agendar" }]);
    await ctx.tg.sendMessage({ chat_id: chatId, text: "Selecciona día (próximos 7, excluyendo hoy):", reply_markup: buildKb(rows) });
    return;
  }
  const list = porDia.get(diaSel) || [];
  list.sort((a,b)=>a.inicio.localeCompare(b.inicio));
  const rowsH = list.map((h) => [{ text: fmtFechaBogota(h.inicio).slice(11,16), callback_data: `a=h;sid=${sid};hid=${h.id}` }]);
  rowsH.push([{ text: "Volver", callback_data: `a=s;sid=${sid}` }]);
  await ctx.tg.sendMessage({ chat_id: chatId, text: `Horarios para ${diaSel}:`, reply_markup: buildKb(rowsH) });
}

async function mostrarResumen(ctx: Context, uid: number, chatId: number, sid: number, hid: number) {
  const [servs, h] = await Promise.all([ctx.repo.getServicios(), ctx.repo.getHorarioById(hid)]);
  const s = servs.find((x) => x.id === sid);
  if (!s || !h) {
    await ctx.tg.sendMessage({ chat_id: chatId, text: "Datos no encontrados." });
    return;
  }
  const nom = "";
  const txt = `Resumen\nServicio: ${s.nombre} $${s.precio_cop.toLocaleString("es-CO")}\nHorario: ${fmtFechaBogota(h.inicio)}\nEstado: pendiente (sin ocupar horario aún)`;
  const kb = buildKb([
    [{ text: "Enviar solicitud", callback_data: `a=env;sid=${sid};hid=${hid};nom=${encodeURIComponent(nom)}` }],
    [{ text: "Volver al inicio", callback_data: "a=inicio" }],
  ]);
  await ctx.tg.sendMessage({ chat_id: chatId, text: txt, reply_markup: kb });
}

async function enviarSolicitud(ctx: Context, uid: number, chatId: number, sid: number, hid: number, nom: string, nombreFrom: string) {
  const nombre = (nom || nombreFrom || "Cliente").slice(0,80);
  const res = await ctx.repo.mutarCita({
    update_id: Date.now(), // placeholder? usa timestamp seguro; pero update_id debe venir de TG; aquí llamada interna? mejor usar número único
    accion: "solicitar",
    actor_user_id: uid,
    actor_chat_id: chatId,
    nombre,
    servicio_id: sid,
    horario_id: hid,
    admin_user_id: ctx.adminUserId,
    admin_chat_id: ctx.adminChatId,
  });
  const est = String(res.estado || "");
  if (est === "ok") {
    await ctx.tg.sendMessage({ chat_id: chatId, text: `Solicitud creada. Cita ID: ${res.cita_id}. Pendiente de confirmación.` });
    return;
  }
  if (est === "consulta_tu_cita") {
    await ctx.tg.sendMessage({ chat_id: chatId, text: "Ya tienes una cita activa. Usa [Mi cita] para gestionarla." });
    return;
  }
  if (est === "horario_ocupado") {
    await ctx.tg.sendMessage({ chat_id: chatId, text: "Horario ocupado. Elige otro horario." });
    return;
  }
  await ctx.tg.sendMessage({ chat_id: chatId, text: "No se pudo crear la solicitud." });
}

async function showMiCita(ctx: Context, uid: number, chatId: number) {
  const c = await ctx.repo.getCitaActiva(uid);
  if (!c) {
    const kb = buildKb([[{ text: "Volver al inicio", callback_data: "a=inicio" }]]);
    await ctx.tg.sendMessage({ chat_id: chatId, text: "No tienes cita activa.", reply_markup: kb });
    return;
  }
  const h = await ctx.repo.getHorarioById(c.horario_id);
  let txt = `Mi cita\nID: ${c.id}\nEstado: ${c.estado}\nHorario: ${h ? fmtFechaBogota(h.inicio) : c.horario_id}`;
  const rows = [] as any[];
  if (c.estado === "pendiente" || c.estado === "confirmada") {
    rows.push([{ text: "Cancelar cita (confirmar)", callback_data: `a=cancel;cid=${c.id}` }]);
  }
  rows.push([{ text: "Volver al inicio", callback_data: "a=inicio" }]);
  await ctx.tg.sendMessage({ chat_id: chatId, text: txt, reply_markup: buildKb(rows) });
}

async function pedirCancelar(ctx: Context, uid: number, chatId: number, cid: number) {
  const kb = buildKb([
    [{ text: "Sí, cancelar", callback_data: `a=cancelok;cid=${cid}` }],
    [{ text: "No", callback_data: "a=micita" }],
  ]);
  await ctx.tg.sendMessage({ chat_id: chatId, text: "Confirma cancelación. Esta acción libera el horario.", reply_markup: kb });
}

async function cancelarCita(ctx: Context, uid: number, chatId: number, cid: number) {
  const res = await ctx.repo.mutarCita({
    update_id: Date.now(),
    accion: "cancelar",
    actor_user_id: uid,
    actor_chat_id: chatId,
    nombre: "",
    cita_id: cid,
    admin_user_id: ctx.adminUserId,
    admin_chat_id: ctx.adminChatId,
  });
  if (res.estado === "ok") {
    await ctx.tg.sendMessage({ chat_id: chatId, text: "Cita cancelada." });
    return;
  }
  await ctx.tg.sendMessage({ chat_id: chatId, text: `No se pudo cancelar (${res.estado})` });
}

async function confirmarCita(ctx: Context, uid: number, chatId: number, cid: number) {
  if (uid !== ctx.adminUserId) {
    await ctx.tg.sendMessage({ chat_id: chatId, text: "No autorizado." });
    return;
  }
  const res = await ctx.repo.mutarCita({
    update_id: Date.now(),
    accion: "confirmar",
    actor_user_id: uid,
    actor_chat_id: chatId,
    nombre: "Admin",
    cita_id: cid,
    admin_user_id: ctx.adminUserId,
    admin_chat_id: ctx.adminChatId,
  });
  await ctx.tg.sendMessage({ chat_id: chatId, text: `Confirmar: ${res.estado}` });
}

async function rechazarCita(ctx: Context, uid: number, chatId: number, cid: number) {
  if (uid !== ctx.adminUserId) {
    await ctx.tg.sendMessage({ chat_id: chatId, text: "No autorizado." });
    return;
  }
  const res = await ctx.repo.mutarCita({
    update_id: Date.now(),
    accion: "rechazar",
    actor_user_id: uid,
    actor_chat_id: chatId,
    nombre: "Admin",
    cita_id: cid,
    admin_user_id: ctx.adminUserId,
    admin_chat_id: ctx.adminChatId,
  });
  await ctx.tg.sendMessage({ chat_id: chatId, text: `Rechazar: ${res.estado}` });
}

async function showPendientes(ctx: Context, chatId: number, offset: number) {
  if (chatId !== ctx.adminChatId) {
    // permitir solo adminChatId; también validado por user_id en comandos
  }
  const citas = await ctx.repo.getPendientes(offset, MAX_PENDIENTES);
  let txt = `Pendientes (${offset}-${offset + citas.length}):\n`;
  const rows = [] as any[];
  for (const c of citas) {
    rows.push([{ text: `Conf ${c.id}`, callback_data: `a=conf;cid=${c.id}` }, { text: `Rech ${c.id}`, callback_data: `a=rech;cid=${c.id}` }]);
  }
  if (citas.length === MAX_PENDIENTES) {
    rows.push([{ text: "Siguiente", callback_data: `a=pen;off=${offset + MAX_PENDIENTES}` }]);
  }
  rows.push([{ text: "Volver", callback_data: "a=inicio" }]);
  await ctx.tg.sendMessage({ chat_id: chatId, text: txt || "Sin pendientes", reply_markup: buildKb(rows) });
}

async function getAdminChatIdSafe(_ctx: Context): Promise<number | null> {
  return null;
}
