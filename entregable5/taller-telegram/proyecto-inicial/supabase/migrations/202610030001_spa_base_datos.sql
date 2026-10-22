-- Migración incremental 202610030001_spa_base_datos.sql
-- Spa Manos y Pies (negocio ficticio del taller).
--
-- Motivo: la versión anterior de 202610020001_spa.sql contenía SOLO la sección
-- de RPC y fallaba con `type "spa_horarios" does not exist` (Postgres valida
-- el cuerpo de las funciones al crearlas). Consecuencia: en una base donde
-- esa versión ya estaba aplicada quedaban las tablas, los índices, el RLS y
-- la semilla de servicios sin crear, o directamente la base vacía.
--
-- Esta migración deja el ESQUEMA BASE completo y es idempotente: se puede
-- aplicar varias veces, no borra tablas ni datos y no deja nada huérfano.
-- NO redefine las RPC (viven en 202610020001_spa.sql); solo vuelve a asegurar
-- los permisos de ejecución de las que ya existan.
--
-- Orden de aplicación recomendado:
--   1. 202610030001_spa_base_datos.sql  -> asegura tablas, índices, RLS, semilla
--   2. 202610020001_spa.sql             -> crea/actualiza las RPC (es idempotente
--                                          y vuelve a asegurar el esquema)
-- En una base nueva basta con 202610020001_spa.sql: ya es autónoma.

-- =====================================================================
-- 1. Tablas
-- =====================================================================

create table if not exists public.spa_servicios (
  id bigint generated always as identity primary key,
  nombre text not null,
  precio_cop integer not null check (precio_cop >= 0),
  duracion_min integer not null check (duracion_min > 0),
  activo boolean not null default true,
  constraint spa_servicios_nombre_key unique (nombre)
);

create table if not exists public.spa_horarios (
  id bigint generated always as identity primary key,
  inicio timestamptz not null unique,
  fin timestamptz not null,
  constraint spa_horarios_rango_ck check (fin > inicio)
);

create table if not exists public.spa_citas (
  id bigint generated always as identity primary key,
  cliente_user_id bigint not null,
  cliente_chat_id bigint not null,
  cliente_nombre text not null,
  servicio_id bigint not null references public.spa_servicios (id),
  horario_id bigint not null references public.spa_horarios (id),
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'confirmada', 'cancelada', 'rechazada', 'finalizada')),
  created_at timestamptz not null default now()
);

create table if not exists public.spa_eventos (
  update_id bigint primary key,
  tipo text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.spa_notificaciones (
  id bigint generated always as identity primary key,
  clave text not null unique,
  chat_id bigint not null,
  payload jsonb not null,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'procesando', 'enviada', 'fallida', 'revision')),
  intentos integer not null default 0 check (intentos >= 0 and intentos <= 5),
  disponible_desde timestamptz not null default now(),
  lease_hasta timestamptz,
  lease_token uuid,
  telegram_message_id bigint,
  error_codigo text,
  created_at timestamptz not null default now(),
  constraint spa_notificaciones_clave_ck check (length(clave) > 0 and length(clave) <= 120)
);

-- =====================================================================
-- 2. Índices
-- La ocupación del horario y la cita activa de cada clienta se garantizan
-- con índices únicos parciales: una consulta previa a INSERT no alcanza.
-- =====================================================================

create unique index if not exists spa_citas_ocupacion_idx
  on public.spa_citas (horario_id)
  where estado in ('pendiente', 'confirmada');

create unique index if not exists spa_citas_cita_activa_idx
  on public.spa_citas (cliente_user_id)
  where estado in ('pendiente', 'confirmada');

create index if not exists spa_citas_estado_idx
  on public.spa_citas (estado, created_at desc);

create index if not exists spa_horarios_inicio_idx
  on public.spa_horarios (inicio);

create index if not exists spa_notificaciones_estado_idx
  on public.spa_notificaciones (estado);

create index if not exists spa_notificaciones_elegibles_idx
  on public.spa_notificaciones (disponible_desde, id)
  where estado = 'pendiente';

create index if not exists spa_notificaciones_lease_idx
  on public.spa_notificaciones (lease_hasta)
  where estado = 'procesando';

-- =====================================================================
-- 3. Seguridad: RLS en todas las tablas, sin políticas, y solo service_role
-- =====================================================================

alter table public.spa_servicios enable row level security;
alter table public.spa_horarios enable row level security;
alter table public.spa_citas enable row level security;
alter table public.spa_eventos enable row level security;
alter table public.spa_notificaciones enable row level security;

do $$
declare
  v_tabla text;
begin
  foreach v_tabla in array array[
    'spa_servicios', 'spa_horarios', 'spa_citas', 'spa_eventos', 'spa_notificaciones'
  ] loop
    execute format('revoke all on table public.%I from anon, authenticated', v_tabla);
    execute format('grant all on table public.%I to service_role', v_tabla);
  end loop;
end $$;

do $$
declare
  v_tabla text;
begin
  foreach v_tabla in array array[
    'spa_servicios', 'spa_horarios', 'spa_citas', 'spa_notificaciones'
  ] loop
    execute format('revoke all on sequence public.%I_id_seq from anon, authenticated', v_tabla);
    execute format('grant all on sequence public.%I_id_seq to service_role', v_tabla);
  end loop;
end $$;

-- =====================================================================
-- 4. Servicios ficticios (idempotente)
-- =====================================================================

insert into public.spa_servicios (nombre, precio_cop, duracion_min, activo)
values ('Manicure', 30000, 60, true),
       ('Pedicure', 40000, 60, true),
       ('Manos y pies', 65000, 60, true)
on conflict (nombre) do nothing;

-- =====================================================================
-- 5. spa_generar_horarios
-- =====================================================================

create or replace function public.spa_generar_horarios(p_dias integer default 7)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_dias integer := least(greatest(coalesce(p_dias, 7), 1), 31);
  v_horas constant integer[] := array[9, 10, 11, 14, 15, 16];
  v_offset integer;
  v_hora integer;
  v_fecha date;
  v_inicio timestamptz;
  v_dias_atencion integer := 0;
  v_insertados integer := 0;
begin
  for v_offset in 1..14 loop
    exit when v_dias_atencion >= v_dias;
    v_fecha := (now() at time zone 'America/Bogota')::date + v_offset;
    if extract(isodow from v_fecha)::integer = 7 then
      continue;
    end if;
    v_dias_atencion := v_dias_atencion + 1;
    foreach v_hora in array v_horas loop
      v_inicio := (v_fecha + make_time(v_hora, 0, 0)) at time zone 'America/Bogota';
      insert into public.spa_horarios (inicio, fin)
      values (v_inicio, v_inicio + interval '60 minutes')
      on conflict (inicio) do nothing;
      if found then
        v_insertados := v_insertados + 1;
      end if;
    end loop;
  end loop;
  return v_insertados;
end $$;

revoke execute on function public.spa_generar_horarios(integer)
  from public, anon, authenticated;
grant execute on function public.spa_generar_horarios(integer) to service_role;

-- =====================================================================
-- 6. Versiones obsoletas de funciones
-- Solo se borran FUNCIONES con firma anterior (nunca tablas ni datos): si
-- quedaran, la llamada por nombre desde la función del servidor sería
-- ambigua.
-- =====================================================================

drop function if exists public.spa_mutar_cita(bigint, text, bigint, bigint, bigint, bigint, text, bigint, bigint, bigint);
drop function if exists public.spa_finalizar_notificacion(bigint, uuid, boolean, bigint, text, integer, boolean);
drop function if exists public.spa_reclamar_avisos(integer, integer);
drop function if exists public.spa_finalizar_aviso(bigint, uuid, text, text, bigint);

-- =====================================================================
-- 7. Permisos de ejecución de las RPC que ya existan
-- Si la RPC todavía no existe (porque 202610020001_spa.sql está pendiente),
-- el permiso se aplica en cuanto se cree la función.
-- =====================================================================

do $$
declare
  v_firma text;
begin
  foreach v_firma in array array[
    'public.spa_generar_horarios(integer)',
    'public.spa_mutar_cita(bigint, text, bigint, bigint, text, bigint, bigint, bigint, bigint, bigint)',
    'public.spa_reclamar_notificaciones(integer)',
    'public.spa_finalizar_notificacion(bigint, uuid, boolean, bigint, text, integer, boolean, boolean)'
  ] loop
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.oid = to_regprocedure(v_firma)) then
      execute format('revoke execute on function %s from public, anon, authenticated', v_firma);
      execute format('grant execute on function %s to service_role', v_firma);
    end if;
  end loop;
end $$;

-- =====================================================================
-- 8. Primera siembra de horarios
-- =====================================================================

select public.spa_generar_horarios() as horarios_creados;
