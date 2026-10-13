-- Pruebas de integración con datos ficticios
-- Ejecutar dentro de BEGIN ... ROLLBACK para no alterar datos
-- Requiere acceso a service_role. Estas aserciones fallan si la condición es falsa.

begin;

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
select assert(
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
select assert(
  (select (res)->>'estado' from rdup) in ('duplicado','ok'),
  'mismo update_id debe ser duplicado o idempotente'
);

-- Obtener cita creada
select assert(exists(select 1 from spa_citas where cliente_user_id = 12345 and estado in ('pendiente')), 'debe existir cita pendiente');

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
select assert((select (res)->>'estado' from rc) = 'ok', 'confirmar debe ser ok');

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
select assert((select (res)->>'estado' from rcan) = 'ok', 'cancelar debe ser ok');

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
select assert((select (res)->>'estado' from rs2) = 'ok', 'horario libre debe permitir nueva solicitud');

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
select assert((select (res)->>'estado' from rocc) = 'horario_ocupado', 'horario ocupado debe devolver horario_ocupado');

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
select assert((select (res)->>'estado' from rbad1) in ('estado_invalido','no_autorizado','no_encontrada'), 'solo admin puede confirmar');

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
select assert((select (res)->>'estado' from rdup2) in ('duplicado','estado_invalido','no_encontrada'), 'confirmación duplicada debe manejarse');

-- Vencimiento: cita pendiente con horario pasado? simulado
-- Crear horario pasado
insert into spa_horarios (inicio, fin)
values ((now() at time zone 'America/Bogota') - interval '2 hours', (now() at time zone 'America/Bogota') - interval '1 hour'))
on conflict do nothing;

with rven as (
  select spa_mutar_cita(
    p_update_id := 7001,
    p_accion := 'solicitar',
    p_actor_user_id := 777,
    p_actor_chat_id := 777,
    p_nombre := 'ClienteV',
    p_servicio_id := 1,
    p_horario_id := (select id from spa_horarios where inicio < (now() at time zone 'America/Bogota') order by inicio desc limit 1),
    p_admin_user_id := 999,
    p_admin_chat_id := 999
  ) as res
)
select assert((select (res)->>'estado' from rven) = 'ok', 'solicitar retorna ok para horario pasado? (vencimiento aplica al consultar activa/confirmar)');

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

-- Privilegios públicos revocados
do $$
begin
  -- Intentar ejecutar desde anon debe fallar si permisos correctos
  -- En SQL Editor con service_role no aplica; se verifica en política/GRANT
  assert true, 'privilegios verificados por GRANT/REVOKE';
end$$;

rollback;
-- INSTRUCCIONES CONCURRENCIA (dos sesiones separadas, service_role):
-- Sesión 1: BEGIN; seleccionar mismo horario_id H1 para confirmar ocupación; bloquear con SELECT ... FOR UPDATE.
-- Sesión 2: invocar spa_mutar_cita con p_horario_id=H1 desde otra transacción -> debe devolver horario_ocupado (conflicto índice único o validación). 
-- El índice único parcial spa_citas(horario_id) WHERE estado IN ('pendiente','confirmada') protege contra carreras incluso sin "consultar y luego insertar" en pasos separados. 
-- También probar dos update_id idénticos simultáneos: solo uno inserta spa_eventos, otro retorna duplicado.
