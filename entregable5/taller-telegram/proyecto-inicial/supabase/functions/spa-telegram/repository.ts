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
  }): Promise<boolean>;
  getPendientes(offset: number, limit: number): Promise<Cita[]>;
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
      const hoy = new Date();
      const zona = "America/Bogota";
      const ymd = hoy.toLocaleDateString("sv-SE", { timeZone: zona }); // YYYY-MM-DD
      const { data, error } = await client
        .from("spa_horarios")
        .select("*")
        .gt("inicio", `${ymd}T23:59:59.999-05:00`) // excluir hoy aprox? spec: próximos 7 días excluyendo hoy
        .order("inicio")
        .limit(limitDias * 10);
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
      });
      if (error) throw error;
      return !!data;
    },
    async getPendientes(offset: number, limit: number) {
      const { data, error } = await client
        .from("spa_citas")
        .select("*")
        .eq("estado", "pendiente")
        .order("id")
        .range(offset, offset + limit - 1);
      if (error) throw error;
      return (data || []) as Cita[];
    },
  };
}
