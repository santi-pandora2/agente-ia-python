-- Pruebas de integración con datos ficticios
-- Ejecutar dentro de BEGIN ... ROLLBACK para no alterar datos.
-- Requiere acceso a service_role. Estas aserciones fallan si la condición es falsa.
--
-- Orden de aplicación previo (SQL Editor):
--   1) supabase/migrations/202610030001_spa_base_datos.sql
--   2) supabase/migrations/202610020001_spa.sql
-- Ambas migraciones son idempotentes y no borran tablas ni datos.

begin;

-- Helper de aserciones: la función assert() no existe en todas las
-- instalaciones de PostgreSQL, así que se usa una función temporal que
-- aborta la transacción (y por tanto la prueba) cuando la condición es falsa.
-- Al terminar el ROLLBACK esta función desaparece con la transacción.
create or replace function pg_temp.spa_assert(p_ok boolean, p_msg text)
returns boolean
language plpgsql
as $$
begin
  if p_ok is not true then
    raise exception 'Aserción fallida: %', p_msg;
  end if;
  return true;
end $$;

-- Datos base ficticios (no personales reales)
select spa_generar_horarios();

-- Verificar servicios
do $$
begin
  assert (select count(*) from spa_servicios where activo = true) >= 3, 'Servicios activos insuficientes';
end$$;

-- RPC: solicitar
with r1 as (
  select spa_mutar_cita(
    p_update_id := 1001,
    p_accion := 'solicitar',
    p_actor_user_id := 12345,
    p_actor_chat_id := 12345,
    p_nombre := 'ClienteA',
    p_cita_id := null,
    p_servicio_id := 1,
    p_horario_id := (select id from spa_horarios order by inicio limit 1),
    p_admin_user_id := 999,
    p_admin_chat_id := 999
  ) as res
)
select pg_temp.spa_assert(
  (select (res)->>'estado' from r1) = 'ok',
  'solicitar debe retornar ok'
);

-- Duplicado: mismo update_id
with rdup as (
  select spa_mutar_cita(
    p_update_id := 1001,
    p_accion := 'solicitar',
    p_actor_user_id := 12345,
    p_actor_chat_id := 12345,
    p_nombre := 'ClienteA',
    p_servicio_id := 1,
    p_horario_id := (select id from spa_horarios order by inicio limit 1),
    p_admin_user_id := 999,
    p_admin_chat_id := 999
  ) as res
)
select pg_temp.spa_assert(
  (select (res)->>'estado' from rdup) in ('duplicado','ok'),
  'mismo update_id debe ser duplicado o idempotente'
);

-- Obtener cita creada
select pg_temp.spa_assert(exists(select 1 from spa_citas where cliente_user_id = 12345 and estado in ('pendiente')), 'debe existir cita pendiente');

-- Confirmar por admin
with rc as (
  select spa_mutar_cita(
    p_update_id := 2001,
    p_accion := 'confirmar',
    p_actor_user_id := 999,
    p_actor_chat_id := 999,
    p_nombre := 'Admin',
    p_cita_id := (select id from spa_citas where cliente_user_id = 12345 limit 1),
    p_admin_user_id := 999,
    p_admin_chat_id := 999
  ) as res
)
select pg_temp.spa_assert((select (res)->>'estado' from rc) = 'ok', 'confirmar debe ser ok');

-- Cancelar por cliente (doble intención validada)
with rcan as (
  select spa_mutar_cita(
    p_update_id := 3001,
    p_accion := 'cancelar',
    p_actor_user_id := 12345,
    p_actor_chat_id := 12345,
    p_nombre := 'ClienteA',
    p_cita_id := (select id from spa_citas where cliente_user_id = 12345 limit 1),
    p_admin_user_id := 999,
    p_admin_chat_id := 999
  ) as res
)
select pg_temp.spa_assert((select (res)->>'estado' from rcan) = 'ok', 'cancelar debe ser ok');

-- Liberación de horario (nueva solicitud con mismo horario?)
-- Verificar que no bloquea si cancelada
do $$
begin
  assert (select count(*) from spa_citas where cliente_user_id = 12345 and estado = 'cancelada') >= 1, 'debe registrarse cancelada';
end$$;

-- Ocupación: otra persona intenta horario ocupado
-- Reutilizar horario de cita 12345? tras cancelar, horario queda libre para nueva solicitud
with rs2 as (
  select spa_mutar_cita(
    p_update_id := 4001,
    p_accion := 'solicitar',
    p_actor_user_id := 67890,
    p_actor_chat_id := 67890,
    p_nombre := 'ClienteB',
    p_servicio_id := 1,
    p_horario_id := (select horario_id from spa_citas where cliente_user_id = 12345 limit 1),
    p_admin_user_id := 999,
    p_admin_chat_id := 999
  ) as res
)
select pg_temp.spa_assert((select (res)->>'estado' from rs2) = 'ok', 'horario libre debe permitir nueva solicitud');

-- Otra solicitud con horario ya ocupado (pendiente/confirmada)
with rocc as (
  select spa_mutar_cita(
    p_update_id := 5001,
    p_accion := 'solicitar',
    p_actor_user_id := 54321,
    p_actor_chat_id := 54321,
    p_nombre := 'ClienteC',
    p_servicio_id := 1,
    p_horario_id := (select horario_id from spa_citas where cliente_user_id = 67890 and estado in ('pendiente','confirmada') limit 1),
    p_admin_user_id := 999,
    p_admin_chat_id := 999
  ) as res
)
select pg_temp.spa_assert((select (res)->>'estado' from rocc) = 'horario_ocupado', 'horario ocupado debe devolver horario_ocupado');

-- Permisos: cliente no puede confirmar
with rbad1 as (
  select spa_mutar_cita(
    p_update_id := 6001,
    p_accion := 'confirmar',
    p_actor_user_id := 12345,
    p_actor_chat_id := 12345,
    p_nombre := 'ClienteA',
    p_cita_id := (select id from spa_citas where cliente_user_id = 67890 limit 1),
    p_admin_user_id := 999,
    p_admin_chat_id := 999
  ) as res
)
select pg_temp.spa_assert((select (res)->>'estado' from rbad1) in ('estado_invalido','no_autorizado','no_encontrada'), 'solo admin puede confirmar');

-- Permisos: una clienta no puede cancelar la cita de otra
with rbad2 as (
  select spa_mutar_cita(
    p_update_id := 6002,
    p_accion := 'cancelar',
    p_actor_user_id := 12345,
    p_actor_chat_id := 12345,
    p_nombre := 'ClienteA',
    p_cita_id := (select id from spa_citas where cliente_user_id = 67890 limit 1),
    p_admin_user_id := 999,
    p_admin_chat_id := 999
  ) as res
)
select pg_temp.spa_assert((select (res)->>'estado' from rbad2) = 'no_autorizado', 'solo la dueña puede cancelar');

-- Duplicados de cambio de estado
with rdup2 as (
  select spa_mutar_cita(
    p_update_id := 2001,
    p_accion := 'confirmar',
    p_actor_user_id := 999,
    p_actor_chat_id := 999,
    p_nombre := 'Admin',
    p_cita_id := (select id from spa_citas where cliente_user_id = 12345 limit 1),
    p_admin_user_id := 999,
    p_admin_chat_id := 999
  ) as res
)
select pg_temp.spa_assert((select (res)->>'estado' from rdup2) in ('duplicado','estado_invalido','no_encontrada'), 'confirmación duplicada debe manejarse');

-- Cambio de estado repetido con un update_id nuevo: la cita ya está cancelada
with rrep as (
  select spa_mutar_cita(
    p_update_id := 2002,
    p_accion := 'confirmar',
    p_actor_user_id := 999,
    p_actor_chat_id := 999,
    p_nombre := 'Admin',
    p_cita_id := (select id from spa_citas where cliente_user_id = 12345 limit 1),
    p_admin_user_id := 999,
    p_admin_chat_id := 999
  ) as res
)
select pg_temp.spa_assert((select (res)->>'estado' from rrep) = 'estado_invalido', 'no se puede confirmar una cita cancelada');

-- Vencimiento: cita pendiente con horario pasado? simulado
-- Crear horario pasado. now() es un instante absoluto: la comparación no
-- depende de la zona horaria de la sesión.
insert into spa_horarios (inicio, fin)
values (now() - interval '2 hours', now() - interval '1 hour')
on conflict do nothing;

with rven as (
  select spa_mutar_cita(
    p_update_id := 7001,
    p_accion := 'solicitar',
    p_actor_user_id := 777,
    p_actor_chat_id := 777,
    p_nombre := 'ClienteV',
    p_servicio_id := 1,
    p_horario_id := (select id from spa_horarios where inicio < now() order by inicio desc limit 1),
    p_admin_user_id := 999,
    p_admin_chat_id := 999
  ) as res
)
select pg_temp.spa_assert((select (res)->>'estado' from rven) = 'ok', 'solicitar retorna ok para horario pasado? (vencimiento aplica al consultar activa/confirmar)');

-- Expiración: el responsable no puede confirmar un horario que ya pasó
with rvenc as (
  select spa_mutar_cita(
    p_update_id := 7002,
    p_accion := 'confirmar',
    p_actor_user_id := 999,
    p_actor_chat_id := 999,
    p_nombre := 'Admin',
    p_cita_id := (select id from spa_citas where cliente_user_id = 777 limit 1),
    p_admin_user_id := 999,
    p_admin_chat_id := 999
  ) as res
)
select pg_temp.spa_assert((select (res)->>'estado' from rvenc) = 'vencida', 'confirmar un horario vencido debe devolver vencida');

-- Avisos y outbox
do $$
begin
  assert (select count(*) from spa_notificaciones) >= 1, 'debe haber avisos persistidos';
end$$;

-- Prueba de reclamación
do $$
declare
  r record;
begin
  for r in select * from spa_reclamar_notificaciones(5) loop
    perform spa_finalizar_notificacion(r.id, r.lease_token, true, null, null, null);
  end loop;
end$$;

-- Semántica de reintento de los avisos: incierto -> revision, permanente ->
-- fallida, error recuperable -> pendiente con espera creciente.
insert into spa_notificaciones (clave, chat_id, payload, estado, intentos, disponible_desde)
values ('test:incierto', 999, '{"tipo":"test"}'::jsonb, 'pendiente', 0, now()),
       ('test:permanente', 999, '{"tipo":"test"}'::jsonb, 'pendiente', 0, now()),
       ('test:reintentable', 999, '{"tipo":"test"}'::jsonb, 'pendiente', 0, now());

do $$
declare
  r record;
begin
  for r in select * from spa_reclamar_notificaciones(50) loop
    if r.clave = 'test:incierto' then
      perform spa_finalizar_notificacion(r.id, r.lease_token, false, null, 'timeout', null, false, true);
    elsif r.clave = 'test:permanente' then
      perform spa_finalizar_notificacion(r.id, r.lease_token, false, null, '403', null, true, false);
    elsif r.clave = 'test:reintentable' then
      perform spa_finalizar_notificacion(r.id, r.lease_token, false, null, '500', 3, false, false);
    end if;
  end loop;
end$$;

do $$
begin
  assert (select estado from spa_notificaciones where clave = 'test:incierto') = 'revision',
    'una respuesta incierta debe quedar en revision';
  assert (select estado from spa_notificaciones where clave = 'test:permanente') = 'fallida',
    'un error permanente debe quedar fallida';
  assert (select estado from spa_notificaciones where clave = 'test:reintentable') = 'pendiente',
    'un error recuperable debe volver a la cola';
  assert (select disponible_desde from spa_notificaciones where clave = 'test:reintentable') > now(),
    'el reintento debe esperar antes de volver a la cola';
end$$;

-- Solo el dueño del lease puede finalizar el intento
do $$
declare
  v_id bigint;
begin
  select id into v_id from spa_notificaciones where clave = 'test:reintentable';
  assert spa_finalizar_notificacion(v_id, gen_random_uuid(), false, null, 'otro', null, false, false) = false,
    'no se puede finalizar sin ser dueño del lease';
end$$;

-- Privilegios públicos revocados
do $$
declare
  v_mutar text := 'public.spa_mutar_cita(bigint,text,bigint,bigint,text,bigint,bigint,bigint,bigint,bigint)';
  v_reclamar text := 'public.spa_reclamar_notificaciones(integer)';
  v_finalizar text := 'public.spa_finalizar_notificacion(bigint,uuid,boolean,bigint,text,integer,boolean,boolean)';
  v_semilla text := 'public.spa_generar_horarios(integer)';
begin
  assert not has_function_privilege('anon', v_mutar, 'EXECUTE'), 'anon no debe ejecutar spa_mutar_cita';
  assert not has_function_privilege('authenticated', v_mutar, 'EXECUTE'), 'authenticated no debe ejecutar spa_mutar_cita';
  assert not has_function_privilege('public', v_mutar, 'EXECUTE'), 'public no debe ejecutar spa_mutar_cita';
  assert not has_function_privilege('anon', v_reclamar, 'EXECUTE'), 'anon no debe ejecutar spa_reclamar_notificaciones';
  assert not has_function_privilege('public', v_reclamar, 'EXECUTE'), 'public no debe ejecutar spa_reclamar_notificaciones';
  assert not has_function_privilege('anon', v_finalizar, 'EXECUTE'), 'anon no debe ejecutar spa_finalizar_notificacion';
  assert not has_function_privilege('public', v_finalizar, 'EXECUTE'), 'public no debe ejecutar spa_finalizar_notificacion';
  assert not has_function_privilege('anon', v_semilla, 'EXECUTE'), 'anon no debe ejecutar spa_generar_horarios';
  assert has_function_privilege('service_role', v_mutar, 'EXECUTE'), 'service_role debe ejecutar spa_mutar_cita';
  assert has_function_privilege('service_role', v_reclamar, 'EXECUTE'), 'service_role debe ejecutar spa_reclamar_notificaciones';
  assert has_function_privilege('service_role', v_finalizar, 'EXECUTE'), 'service_role debe ejecutar spa_finalizar_notificacion';
  assert has_function_privilege('service_role', v_semilla, 'EXECUTE'), 'service_role debe ejecutar spa_generar_horarios';
  assert not has_table_privilege('anon', 'public.spa_citas', 'SELECT'), 'anon no debe leer spa_citas';
  assert not has_table_privilege('authenticated', 'public.spa_citas', 'SELECT'), 'authenticated no debe leer spa_citas';
  assert not has_table_privilege('anon', 'public.spa_notificaciones', 'SELECT'), 'anon no debe leer spa_notificaciones';
  assert has_table_privilege('service_role', 'public.spa_citas', 'SELECT'), 'service_role debe leer spa_citas';
  assert has_table_privilege('service_role', 'public.spa_notificaciones', 'SELECT'), 'service_role debe leer spa_notificaciones';
end$$;

rollback;

-- INSTRUCCIONES CONCURRENCIA (dos sesiones separadas, service_role):
-- Sesión 1: BEGIN; seleccionar mismo horario_id H1 para confirmar ocupación; bloquear con SELECT ... FOR UPDATE.
-- Sesión 2: invocar spa_mutar_cita con p_horario_id=H1 desde otra transacción -> debe devolver horario_ocupado (conflicto índice único o validación).
-- El índice único parcial spa_citas(horario_id) WHERE estado IN ('pendiente','confirmada') protege contra carreras incluso sin "consultar y luego insertar" en pasos separados.
-- También probar dos update_id idénticos simultáneos: solo uno inserta spa_eventos, otro retorna duplicado.
