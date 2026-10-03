-- Migración 202610020001_spa.sql
-- Spa Manos y Pies (negocio ficticio del taller).
-- Una sola migración: no hay DROP ni borrados de tablas.
-- No contiene credenciales, tokens ni datos personales reales.

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

-- Avisos elegibles: solo los 'pendiente' cuya espera ya venció.
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
-- 4. Servicios ficticios
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

-- =====================================================================
-- 6. spa_mutar_cita
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
  p_admin_user_id bigint,
  p_admin_chat_id bigint,
  p_nombre text default null,
  p_cita_id bigint default null,
  p_servicio_id bigint default null,
  p_horario_id bigint default null
)
returns table (
  codigo text,
  cita_id bigint,
  estado_cita text,
  horario_id bigint,
  aviso_admin_id bigint,
  aviso_cliente_id bigint,
  detalle text
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_accion text := lower(btrim(coalesce(p_accion, '')));
  v_nombre text := left(coalesce(nullif(btrim(coalesce(p_nombre, '')), ''), 'Sin nombre'), 80);
  v_insertado integer;
  v_cita public.spa_citas%rowtype;
  v_servicio public.spa_servicios%rowtype;
  v_horario public.spa_horarios%rowtype;
  v_id_cita bigint;
  v_id_horario bigint;
  v_estado text;
  v_aviso_admin bigint;
  v_aviso_cliente bigint;
  v_otro_id bigint;
  v_otro_estado text;
  v_fecha text;
  v_servicio_texto text;
begin
  -- 0. Datos mínimos del evento y de la configuración del responsable
  if p_update_id is null or p_actor_user_id is null or p_actor_chat_id is null
     or p_admin_user_id is null or p_admin_chat_id is null then
    return query
      select 'datos_invalidos', null::bigint, null::text, null::bigint,
        null::bigint, null::bigint,
        'Faltan datos del evento o de la configuración del responsable.';
    return;
  end if;

  if v_accion not in ('solicitar', 'confirmar', 'rechazar', 'cancelar') then
    return query
      select 'datos_invalidos', null::bigint, null::text, null::bigint,
        null::bigint, null::bigint, 'Acción no reconocida.';
    return;
  end if;

  -- 1. Permisos que no dependen de la cita
  if v_accion in ('confirmar', 'rechazar') and p_actor_user_id <> p_admin_user_id then
    return query
      select 'sin_permiso', null::bigint, null::text, null::bigint,
        null::bigint, null::bigint, 'Solo el responsable puede confirmar o rechazar.';
    return;
  end if;

  -- 2. Deduplicación del evento: una fila por update_id.
  -- Si ya existe, se devuelve duplicado sin ningún otro efecto.
  insert into public.spa_eventos (update_id, tipo)
  values (p_update_id, v_accion)
  on conflict (update_id) do nothing;
  get diagnostics v_insertado = row_count;
  if v_insertado = 0 then
    return query
      select 'duplicado', null::bigint, null::text, null::bigint,
        null::bigint, null::bigint, 'Este evento ya se procesó.';
    return;
  end if;

  -- 3. Cerrar las citas vencidas de la clienta: una cita pasada no bloquea
  --    solicitudes nuevas. Solo al solicitar o cancelar.
  if v_accion in ('solicitar', 'cancelar') then
    update public.spa_citas c
       set estado = 'finalizada'
     where c.cliente_user_id = p_actor_user_id
       and c.estado in ('pendiente', 'confirmada')
       and exists (
         select 1 from public.spa_horarios h
          where h.id = c.horario_id
            and h.inicio <= now()
       );
  end if;

  -- 4. Solicitar
  if v_accion = 'solicitar' then
    if p_servicio_id is null or p_horario_id is null then
      return query
        select 'datos_invalidos', null::bigint, null::text, null::bigint,
          null::bigint, null::bigint, 'Falta el servicio o el horario.';
      return;
    end if;

    select s.id, s.nombre, s.precio_cop, s.duracion_min
      into v_servicio
      from public.spa_servicios s
     where s.id = p_servicio_id
       and s.activo;
    if not found then
      return query
        select 'servicio_no_disponible', null::bigint, null::text, null::bigint,
          null::bigint, null::bigint, 'Ese servicio no está disponible.';
      return;
    end if;

    select h.id, h.inicio, h.fin
      into v_horario
      from public.spa_horarios h
     where h.id = p_horario_id;
    if not found then
      return query
        select 'horario_no_disponible', null::bigint, null::text, null::bigint,
          null::bigint, null::bigint, 'Ese horario ya no existe.';
      return;
    end if;

    v_id_horario := v_horario.id;
    if v_horario.inicio <= now() then
      return query
        select 'horario_vencido', null::bigint, null::text, v_id_horario,
          null::bigint, null::bigint, 'Ese horario ya pasó.';
      return;
    end if;

    v_fecha := to_char(v_horario.inicio at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI');
    v_servicio_texto := v_servicio.nombre
      || ' (COP ' || v_servicio.precio_cop
      || ', ' || v_servicio.duracion_min || ' min)';

    -- Aviso amable si ya tiene una cita activa. La garantía real es el
    -- índice único: entre esta consulta y el INSERT puede entrar otra persona.
    select c.id, c.estado
      into v_otro_id, v_otro_estado
      from public.spa_citas c
     where c.cliente_user_id = p_actor_user_id
       and c.estado in ('pendiente', 'confirmada')
       and exists (
         select 1 from public.spa_horarios h
          where h.id = c.horario_id
            and h.inicio > now()
       );
    if found then
      return query
        select 'cita_activa', v_otro_id, v_otro_estado, null::bigint,
          null::bigint, null::bigint,
          'Ya tienes una cita activa. Cancela la anterior para solicitar otra.';
      return;
    end if;

    -- INSERT real: el índice único parcial es el que decide.
    begin
      insert into public.spa_citas (
        cliente_user_id, cliente_chat_id, cliente_nombre, servicio_id, horario_id, estado
      )
      values (
        p_actor_user_id, p_actor_chat_id, v_nombre, v_servicio.id, v_id_horario, 'pendiente'
      )
      returning id into v_id_cita;
    exception
      when unique_violation then
        select c.id, c.estado
          into v_otro_id, v_otro_estado
          from public.spa_citas c
         where c.horario_id = v_id_horario
           and c.estado in ('pendiente', 'confirmada');
        if found then
          return query
            select 'horario_ocupado', v_otro_id, v_otro_estado, v_id_horario,
              null::bigint, null::bigint, 'Ese horario acaba de ocuparse. Elige otro.';
          return;
        end if;

        select c.id, c.estado
          into v_otro_id, v_otro_estado
          from public.spa_citas c
         where c.cliente_user_id = p_actor_user_id
           and c.estado in ('pendiente', 'confirmada');
        if found then
          return query
            select 'cita_activa', v_otro_id, v_otro_estado, null::bigint,
              null::bigint, null::bigint,
              'Ya tienes una cita activa. Cancela la anterior para solicitar otra.';
          return;
        end if;
        -- Conflicto distinto de ocupación o de cita activa: error técnico.
        -- Se propaga para revertir toda la transacción, incluido update_id.
        raise;
    end;

    insert into public.spa_notificaciones (clave, chat_id, payload)
    values (
      'cita:' || v_id_cita || ':pendiente:admin',
      p_admin_chat_id,
      jsonb_build_object(
        'destinatario', 'admin',
        'cita_id', v_id_cita,
        'texto',
          'Nueva solicitud de cita #' || v_id_cita || E'\n\n'
          || 'Clienta: ' || v_nombre || E'\n'
          || 'Servicio: ' || v_servicio_texto || E'\n'
          || 'Horario: ' || v_fecha || ' (America/Bogota)',
        'teclado', jsonb_build_array(
          jsonb_build_array(
            jsonb_build_object('texto', 'Confirmar',
              'callback_data', 'confirmar:' || v_id_cita),
            jsonb_build_object('texto', 'Rechazar y ofrecer nueva solicitud',
              'callback_data', 'rechazar:' || v_id_cita)
          )
        )
      )
    )
    on conflict (clave) do nothing
    returning id into v_aviso_admin;

    insert into public.spa_notificaciones (clave, chat_id, payload)
    values (
      'cita:' || v_id_cita || ':pendiente:cliente',
      p_actor_chat_id,
      jsonb_build_object(
        'destinatario', 'cliente',
        'cita_id', v_id_cita,
        'texto',
          'Recibimos tu solicitud. Tu cita #' || v_id_cita || E'\n'
          || v_servicio.nombre || ' el ' || v_fecha || ' (America/Bogota)' || E'\n\n'
          || 'Está PENDIENTE de confirmación. Te avisamos apenas el responsable responda.'
      )
    )
    on conflict (clave) do nothing
    returning id into v_aviso_cliente;

    return query
      select 'ok', v_id_cita, 'pendiente'::text, v_id_horario, v_aviso_admin, v_aviso_cliente,
        'Cita #' || v_id_cita || ' pendiente de confirmación.';
    return;
  end if;

  -- 5. Confirmar o rechazar (solo el responsable, validado en el punto 1)
  if v_accion in ('confirmar', 'rechazar') then
    if p_cita_id is null then
      return query
        select 'datos_invalidos', null::bigint, null::text, null::bigint,
          null::bigint, null::bigint, 'Falta el identificador de la cita.';
      return;
    end if;

    -- Fila bloqueada mientras se cambia el estado.
    -- c.* y no una lista: INTO en una variable de fila asigna por posición.
    select c.*
      into v_cita
      from public.spa_citas c
     where c.id = p_cita_id
     for update;
    if not found then
      return query
        select 'cita_no_encontrada', null::bigint, null::text, null::bigint,
          null::bigint, null::bigint, 'Esa cita no existe.';
      return;
    end if;

    v_id_cita := v_cita.id;
    v_id_horario := v_cita.horario_id;
    v_estado := v_cita.estado;

    if v_cita.estado <> 'pendiente' then
      return query
        select 'estado_invalido', v_id_cita, v_estado, v_id_horario, null::bigint, null::bigint,
          'La cita #' || v_id_cita || ' ya está ' || v_estado || '. No se vuelve a cambiar.';
      return;
    end if;

    select s.id, s.nombre, s.precio_cop, s.duracion_min
      into v_servicio
      from public.spa_servicios s
     where s.id = v_cita.servicio_id;
    select h.id, h.inicio, h.fin
      into v_horario
      from public.spa_horarios h
     where h.id = v_id_horario;
    if not found then
      return query
        select 'horario_no_disponible', v_id_cita, v_estado, v_id_horario,
          null::bigint, null::bigint, 'El horario de la cita ya no existe.';
      return;
    end if;

    if v_horario.inicio <= now() then
      update public.spa_citas c
         set estado = 'finalizada'
       where c.id = v_id_cita;
      return query
        select 'horario_vencido', v_id_cita, 'finalizada'::text, v_id_horario,
          null::bigint, null::bigint,
          'El horario de la cita #' || v_id_cita || ' ya pasó. Se cerró como finalizada.';
      return;
    end if;

    v_fecha := to_char(v_horario.inicio at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI');
    v_estado := case when v_accion = 'confirmar' then 'confirmada' else 'rechazada' end;
    update public.spa_citas c
       set estado = v_estado
     where c.id = v_id_cita;

    insert into public.spa_notificaciones (clave, chat_id, payload)
    values (
      'cita:' || v_id_cita || ':' || v_estado || ':cliente',
      v_cita.cliente_chat_id,
      jsonb_build_object(
        'destinatario', 'cliente',
        'cita_id', v_id_cita,
        'texto',
          case when v_estado = 'confirmada'
            then 'Tu cita #' || v_id_cita || ' está CONFIRMADA.' || E'\n'
              || v_servicio.nombre || ' el ' || v_fecha || ' (America/Bogota).' || E'\n\n'
              || 'Si necesitas otro horario, cancela y solicita de nuevo.'
            else 'Tu cita #' || v_id_cita || ' fue RECHAZADA.' || E'\n\n'
              || 'Puedes solicitar otra cita cuando quieras.'
          end
      )
    )
    on conflict (clave) do nothing
    returning id into v_aviso_cliente;

    insert into public.spa_notificaciones (clave, chat_id, payload)
    values (
      'cita:' || v_id_cita || ':' || v_estado || ':admin',
      p_admin_chat_id,
      jsonb_build_object(
        'destinatario', 'admin',
        'cita_id', v_id_cita,
        'texto',
          'Cita #' || v_id_cita || ' ' || v_estado
          || '. Clienta: ' || v_cita.cliente_nombre
          || '. Se le notificó por este chat.'
      )
    )
    on conflict (clave) do nothing
    returning id into v_aviso_admin;

    return query
      select 'ok', v_id_cita, v_estado, v_id_horario, v_aviso_admin, v_aviso_cliente,
        'Cita #' || v_id_cita || ' ' || v_estado || '. La clienta ya fue notificada.';
    return;
  end if;

  -- 6. Cancelar (la clienta dueña de la cita o el responsable)
  if p_cita_id is null then
    return query
      select 'datos_invalidos', null::bigint, null::text, null::bigint,
        null::bigint, null::bigint, 'Falta el identificador de la cita.';
    return;
  end if;

  select c.*
    into v_cita
    from public.spa_citas c
   where c.id = p_cita_id
   for update;
  if not found then
    return query
      select 'cita_no_encontrada', null::bigint, null::text, null::bigint,
        null::bigint, null::bigint, 'Esa cita no existe.';
    return;
  end if;

  v_id_cita := v_cita.id;
  v_id_horario := v_cita.horario_id;
  v_estado := v_cita.estado;

  if v_cita.cliente_user_id <> p_actor_user_id and p_actor_user_id <> p_admin_user_id then
    return query
      select 'sin_permiso', v_id_cita, v_estado, v_id_horario, null::bigint, null::bigint,
        'Esa cita no es tuya.';
    return;
  end if;

  if v_cita.estado not in ('pendiente', 'confirmada') then
    return query
      select 'estado_invalido', v_id_cita, v_estado, v_id_horario, null::bigint, null::bigint,
        'La cita #' || v_id_cita || ' ya está ' || v_estado || '.';
    return;
  end if;

  select h.id, h.inicio, h.fin
    into v_horario
    from public.spa_horarios h
   where h.id = v_id_horario;
  if not found then
    return query
      select 'horario_no_disponible', v_id_cita, v_estado, v_id_horario,
        null::bigint, null::bigint, 'El horario de la cita ya no existe.';
    return;
  end if;

  if v_horario.inicio <= now() then
    update public.spa_citas c
       set estado = 'finalizada'
     where c.id = v_id_cita;
    return query
      select 'horario_vencido', v_id_cita, 'finalizada'::text, v_id_horario,
        null::bigint, null::bigint,
        'El horario de la cita #' || v_id_cita || ' ya pasó. Se cerró como finalizada.';
    return;
  end if;

  v_fecha := to_char(v_horario.inicio at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI');
  update public.spa_citas c
     set estado = 'cancelada'
   where c.id = v_id_cita;

  insert into public.spa_notificaciones (clave, chat_id, payload)
    values (
      'cita:' || v_id_cita || ':cancelada:cliente',
      v_cita.cliente_chat_id,
      jsonb_build_object(
        'destinatario', 'cliente',
        'cita_id', v_id_cita,
        'texto',
          'Tu cita #' || v_id_cita || ' del ' || v_fecha
          || ' quedó CANCELADA.' || E'\n\nPuedes solicitar otra cuando quieras.'
      )
    )
    on conflict (clave) do nothing
    returning id into v_aviso_cliente;

  insert into public.spa_notificaciones (clave, chat_id, payload)
    values (
      'cita:' || v_id_cita || ':cancelada:admin',
      p_admin_chat_id,
      jsonb_build_object(
        'destinatario', 'admin',
        'cita_id', v_id_cita,
        'texto',
          'Cita #' || v_id_cita || ' cancelada ('
          || case when p_actor_user_id = v_cita.cliente_user_id
                  then 'por la clienta' else 'por el responsable' end
          || '). Horario del ' || v_fecha || ' liberado.'
      )
    )
    on conflict (clave) do nothing
    returning id into v_aviso_admin;

  return query
    select 'ok', v_id_cita, 'cancelada'::text, v_id_horario, v_aviso_admin, v_aviso_cliente,
      'Cita #' || v_id_cita || ' cancelada. El horario quedó libre.';
  return;
end $$;

-- =====================================================================
-- 7. Avisos: reclamar con lease y finalizar el intento
-- =====================================================================

create or replace function public.spa_reclamar_avisos(
  p_limite integer default 10,
  p_segundos_lease integer default 60
)
returns setof public.spa_notificaciones
language sql
security invoker
set search_path = public, pg_temp
as $$
  with candidatos as (
    select n.id
      from public.spa_notificaciones n
     where n.intentos < 5
       and (
         (n.estado = 'pendiente' and n.disponible_desde <= now())
         or (n.estado = 'procesando' and n.lease_hasta is not null and n.lease_hasta <= now())
       )
     order by n.disponible_desde, n.id
     for update skip locked
     limit least(greatest(coalesce(p_limite, 10), 1), 20)
  )
  update public.spa_notificaciones n
     set estado = 'procesando',
         intentos = n.intentos + 1,
         lease_hasta = now() + make_interval(
           secs => least(greatest(coalesce(p_segundos_lease, 60), 10), 300)
         ),
         lease_token = gen_random_uuid()
    from candidatos c
   where n.id = c.id
  returning n.*;
$$;

create or replace function public.spa_finalizar_aviso(
  p_id bigint,
  p_token uuid,
  p_resultado text,
  p_error_codigo text default null,
  p_telegram_message_id bigint default null
)
returns text
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_aviso public.spa_notificaciones%rowtype;
  v_resultado text := lower(btrim(coalesce(p_resultado, '')));
  v_espera interval;
begin
  if v_resultado not in ('enviada', 'reintentable', 'permanente', 'revision') then
    raise exception 'Resultado de aviso no reconocido: %', v_resultado using errcode = '22023';
  end if;

  if p_id is null or p_token is null then
    return 'peticion_invalida';
  end if;

  -- n.* y no una lista: INTO en una variable de fila asigna por posición.
  select n.*
    into v_aviso
    from public.spa_notificaciones n
   where n.id = p_id
   for update;
  if not found then
    return 'no_encontrado';
  end if;

  -- Solo el dueño del lease puede cerrar el intento.
  if v_aviso.estado <> 'procesando'
     or v_aviso.lease_token is null
     or v_aviso.lease_token <> p_token then
    return 'sin_lease';
  end if;

  if v_resultado = 'enviada' then
    update public.spa_notificaciones n
       set estado = 'enviada',
           telegram_message_id = coalesce(p_telegram_message_id, n.telegram_message_id),
           error_codigo = null,
           lease_hasta = null,
           lease_token = null
     where n.id = p_id;

  elsif v_resultado = 'revision' then
    -- Respuesta incierta: no se reenvía solo, lo revisa una persona.
    update public.spa_notificaciones n
       set estado = 'revision',
           error_codigo = left(coalesce(p_error_codigo, 'respuesta_incierta'), 120),
           lease_hasta = null,
           lease_token = null
     where n.id = p_id;

  elsif v_resultado = 'permanente' then
    update public.spa_notificaciones n
       set estado = 'fallida',
           error_codigo = left(coalesce(p_error_codigo, 'error_permanente'), 120),
           lease_hasta = null,
           lease_token = null
     where n.id = p_id;

  else
    if v_aviso.intentos >= 5 then
      update public.spa_notificaciones n
         set estado = 'fallida',
             error_codigo = left(coalesce(p_error_codigo, 'intentos_agotados'), 120),
             lease_hasta = null,
             lease_token = null
       where n.id = p_id;
    else
      -- Espera creciente: 15 s, 30 s, 60 s, 120 s (tope 300 s).
      v_espera := make_interval(
        secs => least(300, (15 * power(2, greatest(v_aviso.intentos - 1, 0)))::integer)
      );
      update public.spa_notificaciones n
         set estado = 'pendiente',
             disponible_desde = now() + v_espera,
             error_codigo = left(coalesce(p_error_codigo, 'reintento'), 120),
             lease_hasta = null,
             lease_token = null
       where n.id = p_id;
    end if;
  end if;

  return (select n.estado from public.spa_notificaciones n where n.id = p_id);
end $$;

-- =====================================================================
-- 8. Privilegios de las RPC: solo service_role
-- =====================================================================

revoke execute on function public.spa_generar_horarios(integer)
  from public, anon, authenticated;
grant execute on function public.spa_generar_horarios(integer) to service_role;

revoke execute on function public.spa_mutar_cita(bigint, text, bigint, bigint, bigint, bigint, text, bigint, bigint, bigint)
  from public, anon, authenticated;
grant execute on function public.spa_mutar_cita(bigint, text, bigint, bigint, bigint, bigint, text, bigint, bigint, bigint)
  to service_role;

revoke execute on function public.spa_reclamar_avisos(integer, integer)
  from public, anon, authenticated;
grant execute on function public.spa_reclamar_avisos(integer, integer) to service_role;

revoke execute on function public.spa_finalizar_aviso(bigint, uuid, text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.spa_finalizar_aviso(bigint, uuid, text, text, bigint)
  to service_role;

-- =====================================================================
-- 9. Primera siembra de horarios
-- =====================================================================

select public.spa_generar_horarios() as horarios_creados;