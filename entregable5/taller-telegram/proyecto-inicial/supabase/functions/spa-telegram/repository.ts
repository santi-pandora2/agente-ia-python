import { createClient, SupabaseClient } from "@supabase/supabase-js";

export type CitaEstado = "pendiente" | "confirmada" | "cancelada" | "rechazada" | "finalizada";

export interface Servicio {
  id: number;
  nombre: string;
  precio_cop: number;
  duracion_min: number;
  activo: boolean;
}

export interface Horario {
  id: number;
  inicio: string; // timestamptz
  fin: string;
}

export interface Cita {
  id: number;
  cliente_user_id: number;
  cliente_chat_id: number;
  cliente_nombre: string;
  servicio_id: number;
  horario_id: number;
  estado: CitaEstado;
  created_at: string;
}

export interface NotifClaim {
  id: number;
  clave: string;
  chat_id: number;
  payload: unknown;
  intentos: number;
  lease_token: string;
}

export interface Repo {
  getServicios(): Promise<Servicio[]>;
  generarHorarios(): Promise<void>;
  getHorariosProximos(limitDias?: number): Promise<Horario[]>;
  getCitaActiva(cliente_user_id: number): Promise<Cita | null>;
  getCitaById(id: number): Promise<Cita | null>;
  getHorarioById(id: number): Promise<Horario | null>;
  mutarCita(params: {
    update_id: number;
    accion: "solicitar" | "confirmar" | "rechazar" | "cancelar";
    actor_user_id: number;
    actor_chat_id: number;
    nombre: string;
    cita_id?: number;
    servicio_id?: number;
    horario_id?: number;
    admin_user_id?: number;
    admin_chat_id?: number;
  }): Promise<{ estado: string; [k: string]: unknown }>;
  reclamarNotificaciones(lote: number): Promise<NotifClaim[]>;
  finalizarNotificacion(params: {
    id: number;
    lease_token: string;
    enviada: boolean;
    telegram_message_id?: number;
    error_codigo?: string;
    retry_after_seconds?: number;
    permanente?: boolean;
    incierto?: boolean;
  }): Promise<boolean>;
  getPendientes(offset: number, limit: number): Promise<Cita[]>;
  registrarAvisoNavegacion(params: {
    clave: string;
    chat_id: number;
    texto: string;
  }): Promise<void>;
}

export function getSupabaseSecret(): string | undefined {
  const skeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (skeys) {
    try {
      const obj = JSON.parse(skeys);
      if (obj.default) return obj.default;
      const first = Object.values(obj)[0];
      if (typeof first === "string") return first;
    } catch (_) {
      // ignore
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || undefined;
}

export function createRepo(url: string, serviceKey: string): Repo {
  const client: SupabaseClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "public" },
  });

  return {
    async getServicios() {
      const { data, error } = await client.from("spa_servicios").select("*").eq("activo", true).order("id");
      if (error) throw error;
      return (data || []) as Servicio[];
    },
    async generarHorarios() {
      const { error } = await client.rpc("spa_generar_horarios");
      if (error) throw error;
    },
    async getHorariosProximos(limitDias = 7) {
      // Solo horarios futuros. El límite exacto de días de atención y la
      // exclusión de hoy los aplica el handler con el reloj de Bogotá
      // (siete días de atención, sin hoy), no un desfase fijo en la consulta.
      const { data, error } = await client
        .from("spa_horarios")
        .select("*")
        .gt("inicio", new Date().toISOString())
        .order("inicio")
        .limit(limitDias * 12);
      if (error) throw error;
      return (data || []) as Horario[];
    },
    async getCitaActiva(cliente_user_id: number) {
      const { data, error } = await client
        .from("spa_citas")
        .select("*")
        .eq("cliente_user_id", cliente_user_id)
        .in("estado", ["pendiente", "confirmada"])
        .order("id", { ascending: false })
        .limit(1);
      if (error) throw error;
      return data?.[0] ? (data[0] as Cita) : null;
    },
    async getCitaById(id: number) {
      const { data, error } = await client.from("spa_citas").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data ? (data as Cita) : null;
    },
    async getHorarioById(id: number) {
      const { data, error } = await client.from("spa_horarios").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data ? (data as Horario) : null;
    },
    async mutarCita(params) {
      const { data, error } = await client.rpc("spa_mutar_cita", {
        p_update_id: params.update_id,
        p_accion: params.accion,
        p_actor_user_id: params.actor_user_id,
        p_actor_chat_id: params.actor_chat_id,
        p_nombre: params.nombre,
        p_cita_id: params.cita_id ?? null,
        p_servicio_id: params.servicio_id ?? null,
        p_horario_id: params.horario_id ?? null,
        p_admin_user_id: params.admin_user_id ?? null,
        p_admin_chat_id: params.admin_chat_id ?? null,
      });
      if (error) throw error;
      return (data as any) || { estado: "error" };
    },
    async reclamarNotificaciones(lote: number) {
      const { data, error } = await client.rpc("spa_reclamar_notificaciones", { p_lote: lote });
      if (error) throw error;
      return (data || []) as NotifClaim[];
    },
    async finalizarNotificacion(params) {
      const { data, error } = await client.rpc("spa_finalizar_notificacion", {
        p_id: params.id,
        p_lease_token: params.lease_token,
        p_enviada: params.enviada,
        p_telegram_message_id: params.telegram_message_id ?? null,
        p_error_codigo: params.error_codigo ?? null,
        p_retry_after_seconds: params.retry_after_seconds ?? null,
        p_permanente: params.permanente ?? false,
        p_incierto: params.incierto ?? false,
      });
      if (error) throw error;
      return !!data;
    },
    async getPendientes(offset: number, limit: number) {
      // Solo citas futuras: una cita pendiente cuyo horario ya pasó no se
      // ofrece para confirmar ni para rechazar.
      const { data: horarios, error: e1 } = await client
        .from("spa_horarios")
        .select("id")
        .gt("inicio", new Date().toISOString());
      if (e1) throw e1;
      const ids = (horarios ?? []).map((h) => h.id as number);
      if (ids.length === 0) return [];
      const { data, error } = await client
        .from("spa_citas")
        .select("*")
        .eq("estado", "pendiente")
        .in("horario_id", ids)
        .order("id")
        .range(offset, offset + limit - 1);
      if (error) throw error;
      return (data || []) as Cita[];
    },
    async registrarAvisoNavegacion(params) {
      // Aviso recuperable de un mensaje que falló al enviarse directamente.
      // La clave deriva del update_id; no se guarda el cuerpo entrante.
      const { error } = await client.from("spa_notificaciones").upsert(
        {
          clave: params.clave,
          chat_id: params.chat_id,
          payload: { tipo: "navegacion", texto: params.texto },
          estado: "pendiente",
          intentos: 0,
          disponible_desde: new Date(Date.now() + 15000).toISOString(),
        },
        { onConflict: "clave", ignoreDuplicates: true },
      );
      if (error) throw error;
    },
  };
}
