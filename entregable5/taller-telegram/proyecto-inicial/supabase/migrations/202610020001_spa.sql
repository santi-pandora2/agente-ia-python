-- Migración 202610020001_spa.sql
-- Spa Manos y Pies (negocio ficticio del taller).
-- Una sola migración: no hay DROP ni borrados de tablas.
-- No contiene credenciales, tokens ni datos personales reales.
--
-- IMPORTANTE (corrección): este archivo antes contenía SOLO la sección de RPC
-- y fallaba con `type "spa_horarios" does not exist`, porque Postgres valida
-- el cuerpo de las funciones al crearlas. Esta versión es autónoma: primero
-- crea el esquema (tablas, índices, RLS, permisos y semilla) y después las
-- RPC. Es idempotente: aplicarla dos veces no rompe nada y no borra datos.
-- Para una base ya dañada, aplicar primero la migración incremental
-- 202610030001_spa_base_datos.sql y después esta.

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

-- Avisos elegibles: 'pendiente' cuya espera ya venció.
-- Los 'revision' NO son elegibles: se atienden a mano para no repetir a ciegas.
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
-- Inserta los próximos días de atención (lunes a sábado) en hora Bogotá,
-- excluyendo hoy. Idempotente. Se ejecuta al migrar y antes de mostrar
-- disponibilidad, para que el bot siga siendo útil después de una semana.
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
    -- get_iso_day: lunes = 1 ... sábado = 6, domingo = 7 (no se atiende)
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
-- 6. Limpieza de versiones anteriores de las funciones
-- Solo se borran FUNCIONES obsoletas (nunca tablas ni datos): si una base
-- aplicó una versión previa con otra firma, esas sobrecargas harían
-- ambigua la llamada por nombre desde la función del servidor.
-- =====================================================================

drop function if exists public.spa_mutar_cita(bigint, text, bigint, bigint, bigint, bigint, text, bigint, bigint, bigint);
drop function if exists public.spa_finalizar_notificacion(bigint, uuid, boolean, bigint, text, integer, boolean);
drop function if exists public.spa_reclamar_avisos(integer, integer);
drop function if exists public.spa_finalizar_aviso(bigint, uuid, text, text, bigint);

-- =====================================================================
-- 7. spa_mutar_cita
-- Punto único de escritura de citas. La reserva de update_id, el cambio de
-- la cita y los avisos ocurren en la MISMA transacción: si algo falla, se
-- revierte todo, incluida la reserva del evento.
-- p_admin_user_id y p_admin_chat_id los envía la función del servidor desde
-- su entorno; nunca vienen del cuerpo de Telegram, y como las RPC no se
-- ejecutan desde anon ni authenticated, solo el service_role puede llamarlas.
-- =====================================================================

create or replace function public.spa_mutar_cita(
  p_update_id bigint,
  p_accion text,
  p_actor_user_id bigint,
  p_actor_chat_id bigint,
  p_nombre text,
  p_cita_id bigint default null,
  p_servicio_id bigint default null,
  p_horario_id bigint default null,
  p_admin_user_id bigint default null,
  p_admin_chat_id bigint default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_horario public.spa_horarios%rowtype;
  v_servicio public.spa_servicios%rowtype;
  v_cita public.spa_citas%rowtype;
  v_accion text := lower(btrim(coalesce(p_accion, '')));
  v_nombre text := left(coalesce(nullif(btrim(coalesce(p_nombre, '')), ''), 'Cliente'), 80);
  v_update_id bigint := p_update_id;
  v_admin_user_id bigint := p_admin_user_id;
  v_admin_chat_id bigint := p_admin_chat_id;
  v_filas integer := 0;
begin
  -- 0. Datos mínimos del evento
  if v_update_id is null or p_actor_user_id is null or p_actor_chat_id is null then
    return jsonb_build_object('estado', 'datos_invalidos');
  end if;
  if v_accion not in ('solicitar', 'confirmar', 'rechazar', 'cancelar') then
    return jsonb_build_object('estado', 'accion_desconocida');
  end if;

  -- 1. Permisos del responsable. Los datos administrativos vienen del
  --    entorno del servidor: el actor DEBE ser ese responsable.
  if v_accion in ('confirmar', 'rechazar') then
    if v_admin_user_id is null or v_admin_chat_id is null then
      raise exception 'admin_requerido';
    end if;
    if p_actor_user_id is distinct from v_admin_user_id then
      return jsonb_build_object('estado', 'no_autorizado');
    end if;
  end if;

  -- 2. Deduplicación del evento: una fila por update_id.
  --    Si ya existe, se devuelve duplicado sin ningún otro efecto.
  insert into public.spa_eventos (update_id, tipo)
  values (v_update_id, v_accion)
  on conflict (update_id) do nothing;
  get diagnostics v_filas = row_count;
  if v_filas = 0 then
    return jsonb_build_object('estado', 'duplicado', 'update_id', v_update_id);
  end if;

  -- 3. Solicitar
  if v_accion = 'solicitar' then
    if p_servicio_id is null or p_horario_id is null then
      raise exception 'servicio y horario requeridos';
    end if;
    select * into v_servicio
      from public.spa_servicios
     where id = p_servicio_id and activo = true
     for share;
    if not found then
      raise exception 'servicio_inactivo_o_inexistente';
    end if;
    select * into v_horario
      from public.spa_horarios
     where id = p_horario_id
     for update;
    if not found then
      raise exception 'horario_inexistente';
    end if;

    -- Cerrar las citas vencidas de esta clienta: una cita pasada no bloquea
    -- solicitudes nuevas. La comparación es entre instantes (timestamptz).
    update public.spa_citas c
       set estado = 'finalizada'
     where c.cliente_user_id = p_actor_user_id
       and c.estado in ('pendiente', 'confirmada')
       and exists (
         select 1 from public.spa_horarios h
          where h.id = c.horario_id
            and h.inicio <= now()
       );

    -- Cita activa: solo una por clienta. La garantía real es el índice
    -- único parcial; esta consulta solo mejora el mensaje.
    if exists (
      select 1 from public.spa_citas c
       where c.cliente_user_id = p_actor_user_id
         and c.estado in ('pendiente', 'confirmada')
         and exists (
           select 1 from public.spa_horarios h
            where h.id = c.horario_id
              and h.inicio > now()
         )
    ) then
      return jsonb_build_object('estado', 'consulta_tu_cita');
    end if;

    -- Alta de la cita. El bloque interno atrapa el conflicto de los índices
    -- únicos parciales SIN deshacer la reserva del update_id: un conflicto
    -- de negocio no es un error técnico.
    begin
      insert into public.spa_citas (
        cliente_user_id, cliente_chat_id, cliente_nombre,
        servicio_id, horario_id, estado, created_at
      )
      values (
        p_actor_user_id, p_actor_chat_id, v_nombre,
        v_servicio.id, v_horario.id, 'pendiente', now()
      )
      returning * into v_cita;
    exception
      when unique_violation then
        if exists (
          select 1 from public.spa_citas c
           where c.horario_id = v_horario.id
             and c.estado in ('pendiente', 'confirmada')
        ) then
          return jsonb_build_object('estado', 'horario_ocupado', 'horario_id', v_horario.id);
        end if;
        return jsonb_build_object('estado', 'consulta_tu_cita');
    end;

    -- Avisos: la clave lleva cita, transición y destinatario.
    insert into public.spa_notificaciones (clave, chat_id, payload, estado, intentos, disponible_desde)
    values (
      format('cita:%s:solicitada:cliente', v_cita.id),
      v_cita.cliente_chat_id,
      jsonb_build_object(
        'tipo', 'solicitada_cliente',
        'cita_id', v_cita.id,
        'horario_id', v_horario.id,
        'servicio_id', v_servicio.id
      ),
      'pendiente', 0, now()
    )
    on conflict (clave) do nothing;

    if v_admin_chat_id is not null then
      insert into public.spa_notificaciones (clave, chat_id, payload, estado, intentos, disponible_desde)
      values (
        format('cita:%s:solicitada:admin', v_cita.id),
        v_admin_chat_id,
        jsonb_build_object(
          'tipo', 'solicitada_admin',
          'cita_id', v_cita.id,
          'cliente_user_id', p_actor_user_id,
          'nombre', v_nombre,
          -- Botones [Confirmar] [Rechazar y ofrecer nueva solicitud].
          -- El callback se revalida en el servidor; no autoriza nada por sí solo.
          'teclado', jsonb_build_array(
            jsonb_build_array(
              jsonb_build_object('texto', 'Confirmar', 'callback_data', 'confirmar:' || v_cita.id),
              jsonb_build_object('texto', 'Rechazar y ofrecer nueva solicitud', 'callback_data', 'rechazar:' || v_cita.id)
            )
          )
        ),
        'pendiente', 0, now()
      )
      on conflict (clave) do nothing;
    end if;

    return jsonb_build_object('estado', 'ok', 'accion', 'solicitar', 'cita_id', v_cita.id);

  -- 4. Confirmar o rechazar (solo el responsable, validado en el punto 1)
  elsif v_accion in ('confirmar', 'rechazar') then
    if p_cita_id is null then
      return jsonb_build_object('estado', 'no_encontrada');
    end if;
    select * into v_cita
      from public.spa_citas
     where id = p_cita_id
     for update;
    if not found then
      return jsonb_build_object('estado', 'no_encontrada');
    end if;
    if v_cita.estado <> 'pendiente' then
      return jsonb_build_object('estado', 'estado_invalido', 'actual', v_cita.estado);
    end if;
    select * into v_horario
      from public.spa_horarios
     where id = v_cita.horario_id
     for update;
    if not found then
      raise exception 'horario_inexistente';
    end if;
    -- El horario ya pasó: la cita se cierra y no se confirma.
    if v_horario.inicio <= now() then
      update public.spa_citas set estado = 'finalizada' where id = v_cita.id;
      return jsonb_build_object('estado', 'vencida');
    end if;
    if v_accion = 'confirmar' then
      update public.spa_citas set estado = 'confirmada' where id = v_cita.id returning * into v_cita;
    else
      update public.spa_citas set estado = 'rechazada' where id = v_cita.id returning * into v_cita;
    end if;

    insert into public.spa_notificaciones (clave, chat_id, payload, estado, intentos, disponible_desde)
    values (
      format('cita:%s:%s:cliente', v_cita.id, v_accion),
      v_cita.cliente_chat_id,
      jsonb_build_object('tipo', v_accion || '_cliente', 'cita_id', v_cita.id),
      'pendiente', 0, now()
    )
    on conflict (clave) do nothing;

    insert into public.spa_notificaciones (clave, chat_id, payload, estado, intentos, disponible_desde)
    values (
      format('cita:%s:%s:admin', v_cita.id, v_accion),
      v_admin_chat_id,
      jsonb_build_object('tipo', v_accion || '_admin', 'cita_id', v_cita.id),
      'pendiente', 0, now()
    )
    on conflict (clave) do nothing;

    return jsonb_build_object('estado', 'ok', 'accion', v_accion, 'cita_id', v_cita.id);

  -- 5. Cancelar (la clienta dueña de la cita)
  elsif v_accion = 'cancelar' then
    if p_cita_id is null then
      return jsonb_build_object('estado', 'no_encontrada');
    end if;
    select * into v_cita
      from public.spa_citas
     where id = p_cita_id
     for update;
    if not found then
      return jsonb_build_object('estado', 'no_encontrada');
    end if;
    -- Permiso por user_id, no por el botón pulsado.
    if v_cita.cliente_user_id is distinct from p_actor_user_id then
      return jsonb_build_object('estado', 'no_autorizado');
    end if;
    if v_cita.estado not in ('pendiente', 'confirmada') then
      return jsonb_build_object('estado', 'estado_invalido', 'actual', v_cita.estado);
    end if;
    update public.spa_citas set estado = 'cancelada' where id = v_cita.id returning * into v_cita;

    insert into public.spa_notificaciones (clave, chat_id, payload, estado, intentos, disponible_desde)
    values (
      format('cita:%s:cancelada:cliente', v_cita.id),
      v_cita.cliente_chat_id,
      jsonb_build_object('tipo', 'cancelada_cliente', 'cita_id', v_cita.id),
      'pendiente', 0, now()
    )
    on conflict (clave) do nothing;

    if v_admin_chat_id is not null then
      insert into public.spa_notificaciones (clave, chat_id, payload, estado, intentos, disponible_desde)
      values (
        format('cita:%s:cancelada:admin', v_cita.id),
        v_admin_chat_id,
        jsonb_build_object('tipo', 'cancelada_admin', 'cita_id', v_cita.id),
        'pendiente', 0, now()
      )
      on conflict (clave) do nothing;
    end if;

    return jsonb_build_object('estado', 'ok', 'accion', 'cancelar', 'cita_id', v_cita.id);
  end if;
end;
$$;

revoke execute on function public.spa_mutar_cita(bigint, text, bigint, bigint, text, bigint, bigint, bigint, bigint, bigint)
  from public, anon, authenticated;
grant execute on function public.spa_mutar_cita(bigint, text, bigint, bigint, text, bigint, bigint, bigint, bigint, bigint)
  to service_role;

-- =====================================================================
-- 8. Avisos: reclamar con lease y finalizar el intento
-- =====================================================================

create or replace function public.spa_reclamar_notificaciones(p_lote integer default 10)
returns table (
  id bigint,
  clave text,
  chat_id bigint,
  payload jsonb,
  intentos integer,
  lease_token uuid
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_token uuid := gen_random_uuid();
begin
  return query
  with candidatos as (
    select n.id
      from public.spa_notificaciones n
     where n.intentos < 5
       and (
         (n.estado = 'pendiente' and n.disponible_desde <= now())
         or
         (n.estado = 'procesando' and n.lease_hasta is not null and n.lease_hasta <= now())
       )
     order by n.disponible_desde, n.id
     for update skip locked
     limit greatest(1, least(coalesce(p_lote, 10), 50))
  ), asignados as (
    update public.spa_notificaciones n
       set estado = 'procesando',
           lease_token = v_token,
           lease_hasta = now() + interval '30 seconds',
           intentos = n.intentos + 1
      from candidatos c
     where n.id = c.id
    returning n.id, n.clave, n.chat_id, n.payload, n.intentos, n.lease_token
  )
  select a.id, a.clave, a.chat_id, a.payload, a.intentos, a.lease_token
    from asignados a;
end;
$$;

revoke execute on function public.spa_reclamar_notificaciones(integer)
  from public, anon, authenticated;
grant execute on function public.spa_reclamar_notificaciones(integer) to service_role;

-- Finalizar el intento. Solo el dueño del lease puede cerrarlo.
-- p_permanente: error que no tiene sentido reintentar (bot bloqueado) -> fallida.
-- p_incierto: respuesta dudosa (timeout, red) -> revision, para no repetir a ciegas.
-- En otro caso el aviso vuelve a 'pendiente' con espera creciente (máx. 5 intentos).
create or replace function public.spa_finalizar_notificacion(
  p_id bigint,
  p_lease_token uuid,
  p_enviada boolean,
  p_telegram_message_id bigint default null,
  p_error_codigo text default null,
  p_retry_after_seconds integer default null,
  p_permanente boolean default false,
  p_incierto boolean default false
)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_n public.spa_notificaciones%rowtype;
  v_espera integer;
begin
  select * into v_n from public.spa_notificaciones where id = p_id for update;
  if not found then
    return false;
  end if;
  if v_n.lease_token is distinct from p_lease_token then
    return false; -- no es dueño del lease
  end if;

  if p_enviada then
    update public.spa_notificaciones
       set estado = 'enviada',
           telegram_message_id = p_telegram_message_id,
           error_codigo = null,
           lease_hasta = null,
           lease_token = null,
           disponible_desde = now()
     where id = p_id;
    return true;
  end if;

  if p_permanente then
    update public.spa_notificaciones
       set estado = 'fallida',
           error_codigo = coalesce(p_error_codigo, 'error_permanente'),
           lease_hasta = null,
           lease_token = null,
           disponible_desde = now()
     where id = p_id;
    return true;
  end if;

  if p_incierto then
    update public.spa_notificaciones
       set estado = 'revision',
           error_codigo = coalesce(p_error_codigo, 'respuesta_incierta'),
           lease_hasta = null,
           lease_token = null,
           disponible_desde = now()
     where id = p_id;
    return true;
  end if;

  if v_n.intentos >= 5 then
    update public.spa_notificaciones
       set estado = 'fallida',
           error_codigo = coalesce(p_error_codigo, 'max_intentos'),
           lease_hasta = null,
           lease_token = null,
           disponible_desde = now()
     where id = p_id;
    return true;
  end if;

  -- Reintento con espera creciente: 15 s, 30 s, 60 s, 120 s (tope 300 s).
  -- Si Telegram pidió retry_after (429), se respeta el mayor de los dos.
  v_espera := greatest(
    least(300, (15 * power(2, greatest(v_n.intentos - 1, 0)))::integer),
    least(coalesce(p_retry_after_seconds, 0), 300)
  );
  update public.spa_notificaciones
     set estado = 'pendiente',
         error_codigo = coalesce(p_error_codigo, 'envio_fallido'),
         lease_hasta = null,
         lease_token = null,
         disponible_desde = now() + make_interval(secs => v_espera)
   where id = p_id;
  return true;
end;
$$;

revoke execute on function public.spa_finalizar_notificacion(bigint, uuid, boolean, bigint, text, integer, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.spa_finalizar_notificacion(bigint, uuid, boolean, bigint, text, integer, boolean, boolean)
  to service_role;

-- =====================================================================
-- 9. Primera siembra de horarios
-- =====================================================================

select public.spa_generar_horarios() as horarios_creados;
