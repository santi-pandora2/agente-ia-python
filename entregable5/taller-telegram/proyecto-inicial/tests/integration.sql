-- tests/integration.sql
-- Integración real del bot del spa. NO se puede ejecutar con dobles de prueba:
-- necesita una base de datos Supabase donde la migración ya esté aplicada.
--
-- Cómo ejecutarla (una sola vez, como un bloque):
--   1. Supabase > SQL Editor > New query.
--   2. Pega este archivo completo y pulsa Run.
--   3. Debe terminar en "Success" sin ningún error "FALLA de integración".
--      Si algo falla, el mensaje dice qué condición no se cumplió.
--
-- Todo ocurre dentro de BEGIN/ROLLBACK: los servicios, los horarios y los
-- datos reales del proyecto no quedan alterados.
--
-- Datos usados: identidades y nombres inventados (900001 a 900004), ningún
-- dato personal real y ningún token.
--
-- Este archivo NO comprueba carreras por sí solo. Al final están las
-- instrucciones de concurrencia en dos sesiones separadas.

begin;

-- =====================================================================
-- Utilidades de aserción
-- =====================================================================

create temporary table spa_test_vars (
  clave text primary key,
  valor text not null
) on commit drop;

create or replace function pg_temp.spa_assert(condicion boolean, mensaje text)
returns void
language plpgsql
as $$
begin
  if condicion is not true then
    raise exception 'FALLA de integración: %', mensaje using errcode = 'P0001';
  end if;
end $$;

create or replace function pg_temp.spa_put_num(p_clave text, p_valor bigint)
returns void
language plpgsql
as $$
begin
  insert into spa_test_vars (clave, valor) values ($1, $2::text)
  on conflict (clave) do update set valor = excluded.valor;
end $$;

create or replace function pg_temp.spa_get_num(p_clave text)
returns bigint
language sql
as $$
  select spa_test_vars.valor::bigint
    from spa_test_vars
   where spa_test_vars.clave = $1;
$$;

create or replace function pg_temp.spa_get_txt(p_clave text)
returns text
language sql
as $$
  select spa_test_vars.valor
    from spa_test_vars
   where spa_test_vars.clave = $1;
$$;

-- Llama la RPC igual que la función del servidor. El responsable ficticio es
-- siempre user 800001 / chat 800001.
create or replace function pg_temp.spa_llamar(
  p_update_id bigint,
  p_accion text,
  p_actor_user_id bigint,
  p_actor_chat_id bigint,
  p_nombre text,
  p_cita_id bigint,
  p_servicio_id bigint,
  p_horario_id bigint
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
language sql
as $$
  select * from public.spa_mutar_cita(
    p_update_id, p_accion, p_actor_user_id, p_actor_chat_id,
    800001, 800001, p_nombre, p_cita_id, p_servicio_id, p_horario_id
  );
$$;

-- Aparta todos los avisos pendientes para dejar elegible solo uno.
create or replace function pg_temp.spa_apartar(p_id bigint)
returns void
language plpgsql
as $$
begin
  update public.spa_notificaciones n
     set disponible_desde = now() + interval '1 day'
   where n.estado = 'pendiente'
     and n.id <> p_id;
end $$;

create or replace function pg_temp.spa_aislar(p_id bigint)
returns void
language plpgsql
as $$
begin
  perform pg_temp.spa_apartar(p_id);
  update public.spa_notificaciones n
     set disponible_desde = now()
   where n.id = p_id;
end $$;

-- =====================================================================
-- 1. Seguridad: RLS, privilegios y ausencia de políticas públicas
-- =====================================================================

do $$
declare
  v_t text;
  v_p text;
  v_total integer;
begin
  select count(*) into v_total
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and c.relname in (
       'spa_servicios', 'spa_horarios', 'spa_citas', 'spa_eventos', 'spa_notificaciones'
     )
     and c.relrowsecurity;
  perform pg_temp.spa_assert(v_total = 5,
    'RLS debe estar habilitado en las 5 tablas del spa; habilitadas: ' || v_total);

  foreach v_t in array array[
    'spa_servicios', 'spa_horarios', 'spa_citas', 'spa_eventos', 'spa_notificaciones'
  ] loop
    foreach v_p in array array['select', 'insert', 'update', 'delete'] loop
      perform pg_temp.spa_assert(
        not has_table_privilege('anon', 'public.' || v_t, v_p),
        'anon no debe tener ' || v_p || ' sobre ' || v_t);
      perform pg_temp.spa_assert(
        not has_table_privilege('authenticated', 'public.' || v_t, v_p),
        'authenticated no debe tener ' || v_p || ' sobre ' || v_t);
      perform pg_temp.spa_assert(
        has_table_privilege('service_role', 'public.' || v_t, v_p),
        'service_role debe poder hacer ' || v_p || ' sobre ' || v_t);
    end loop;
  end loop;

  foreach v_t in array array[
    'spa_servicios_id_seq', 'spa_horarios_id_seq', 'spa_citas_id_seq',
    'spa_notificaciones_id_seq'
  ] loop
    perform pg_temp.spa_assert(
      not has_sequence_privilege('anon', 'public.' || v_t, 'usage'),
      'anon no debe usar la secuencia ' || v_t);
    perform pg_temp.spa_assert(
      not has_sequence_privilege('authenticated', 'public.' || v_t, 'usage'),
      'authenticated no debe usar la secuencia ' || v_t);
  end loop;

  select count(*) into v_total
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'spa_generar_horarios', 'spa_mutar_cita',
       'spa_reclamar_avisos', 'spa_finalizar_aviso'
     );
  perform pg_temp.spa_assert(v_total = 4,
    'deben existir las 4 RPC del spa; encontradas: ' || v_total);

  select count(*) into v_total
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'spa_generar_horarios', 'spa_mutar_cita',
       'spa_reclamar_avisos', 'spa_finalizar_aviso'
     )
     and has_function_privilege('service_role', p.oid, 'execute');
  perform pg_temp.spa_assert(v_total = 4,
    'service_role debe poder ejecutar las 4 RPC; ejecutables: ' || v_total);

  select count(*) into v_total
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'spa_generar_horarios', 'spa_mutar_cita',
       'spa_reclamar_avisos', 'spa_finalizar_aviso'
     )
     and (
       has_function_privilege('anon', p.oid, 'execute')
       or has_function_privilege('authenticated', p.oid, 'execute')
       or has_function_privilege('public', p.oid, 'execute')
     );
  perform pg_temp.spa_assert(v_total = 0,
    'ninguna RPC debe ser ejecutable por public, anon o authenticated; '
      || 'expuestas: ' || v_total);

  select count(*) into v_total
    from pg_policies p
   where p.schemaname = 'public'
     and p.tablename in (
       'spa_servicios', 'spa_horarios', 'spa_citas', 'spa_eventos', 'spa_notificaciones'
     );
  perform pg_temp.spa_assert(v_total = 0,
    'no debe haber políticas RLS en las tablas del spa; encontradas: ' || v_total);
end $$;

-- =====================================================================
-- 2. Los dos índices únicos parciales que garantizan la ocupación
-- =====================================================================

do $$
declare
  v_total integer;
begin
  select count(*) into v_total
    from pg_index i
    join pg_class t on t.oid = i.indrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'public'
     and t.relname = 'spa_citas'
     and i.indisunique
     and i.indpred is not null
     and pg_get_expr(i.indpred, i.indrelid) like '%pendiente%';
  perform pg_temp.spa_assert(v_total = 2,
    'deben existir 2 índices únicos parciales de ocupación en spa_citas; '
      || 'encontrados: ' || v_total);
end $$;

-- =====================================================================
-- 3. Servicios ficticios y semilla de horarios
-- =====================================================================

do $$
declare
  v_total integer;
  v_malos integer;
  v_creados integer;
  v_h1 bigint;
  v_h2 bigint;
  v_h3 bigint;
begin
  select count(*) into v_total
    from public.spa_servicios
   where activo
     and (nombre, precio_cop, duracion_min) in (
       ('Manicure', 30000, 60),
       ('Pedicure', 40000, 60),
       ('Manos y pies', 65000, 60)
     );
  perform pg_temp.spa_assert(v_total = 3,
    'deben existir los 3 servicios ficticios con su precio y duración; '
      || 'encontrados: ' || v_total);

  perform public.spa_generar_horarios();
  select public.spa_generar_horarios() into v_creados;
  perform pg_temp.spa_assert(v_creados = 0,
    'la semilla debe ser idempotente: la segunda llamada no crea horarios; '
      || 'creó: ' || v_creados);

  select count(*) into v_malos
    from public.spa_horarios h
   where extract(hour from h.inicio at time zone 'America/Bogota')
           not in (9, 10, 11, 14, 15, 16)
      or extract(isodow from h.inicio at time zone 'America/Bogota') = 7
      or (h.inicio at time zone 'America/Bogota')::date
         = (now() at time zone 'America/Bogota')::date
      or h.fin - h.inicio <> interval '60 minutes';
  perform pg_temp.spa_assert(v_malos = 0,
    'los horarios deben ser de lunes a sábado, a las 09/10/11/14/15/16 hora Bogotá, '
      || 'de 60 minutos y nunca hoy; incorrectos: ' || v_malos);

  select h.id into v_h1
    from public.spa_horarios h
   where h.inicio > now()
   order by h.inicio
   limit 1 offset 0;
  select h.id into v_h2
    from public.spa_horarios h
   where h.inicio > now()
   order by h.inicio
   limit 1 offset 1;
  select h.id into v_h3
    from public.spa_horarios h
   where h.inicio > now()
   order by h.inicio
   limit 1 offset 2;
  perform pg_temp.spa_assert(
    v_h1 is not null and v_h2 is not null and v_h3 is not null,
    'deben existir al menos 3 horarios futuros. Ejecuta '
      || 'select public.spa_generar_horarios(); y vuelve a correr esta prueba.');

  perform pg_temp.spa_put_num('h1', v_h1);
  perform pg_temp.spa_put_num('h2', v_h2);
  perform pg_temp.spa_put_num('h3', v_h3);
end $$;

-- =====================================================================
-- 4. Solicitar cita: la clienta 900001 pide el horario h1
-- =====================================================================

do $$
declare
  v_codigo text;
  v_cita bigint;
  v_estado text;
  v_horario bigint;
  v_admin bigint;
  v_cliente bigint;
  v_total integer;
begin
  select l.codigo, l.cita_id, l.estado_cita, l.horario_id,
         l.aviso_admin_id, l.aviso_cliente_id
    into v_codigo, v_cita, v_estado, v_horario, v_admin, v_cliente
    from pg_temp.spa_llamar(
      900001, 'solicitar', 900001, 900001, 'Clienta Ficticia A',
      null,
      (select s.id from public.spa_servicios s where s.nombre = 'Manicure'),
      pg_temp.spa_get_num('h1')
    ) as l
   limit 1;

  perform pg_temp.spa_assert(v_codigo = 'ok',
    'solicitar debe responder ok; respondió ' || coalesce(v_codigo, 'null'));
  perform pg_temp.spa_assert(v_cita is not null and v_estado = 'pendiente',
    'la cita debe quedar pendiente con identificador');
  perform pg_temp.spa_assert(v_horario = pg_temp.spa_get_num('h1'),
    'la cita debe quedar en el horario pedido');
  perform pg_temp.spa_assert(v_admin is not null and v_cliente is not null,
    'solicitar debe encolar los dos avisos');

  perform pg_temp.spa_put_num('cita_a', v_cita);

  select count(*) into v_total
    from public.spa_notificaciones n
   where n.clave in (
     'cita:' || v_cita || ':pendiente:admin',
     'cita:' || v_cita || ':pendiente:cliente'
   );
  perform pg_temp.spa_assert(v_total = 2,
    'deben existir los 2 avisos de la solicitud; encontrados: ' || v_total);

  -- El aviso al responsable va a su chat privado y trae los dos botones.
  select count(*) into v_total
    from public.spa_notificaciones n
   where n.clave = 'cita:' || v_cita || ':pendiente:admin'
     and n.chat_id = 800001
     and n.payload->'teclado'->0->0->>'callback_data' = 'confirmar:' || v_cita
     and n.payload->'teclado'->0->1->>'callback_data' = 'rechazar:' || v_cita
     and n.payload->>'texto' like '%Manicure%';
  perform pg_temp.spa_assert(v_total = 1,
    'el aviso al responsable debe traer los botones confirmar y rechazar');

  -- El aviso a la clienta no lleva botones.
  select count(*) into v_total
    from public.spa_notificaciones n
   where n.clave = 'cita:' || v_cita || ':pendiente:cliente'
     and n.chat_id = 900001
     and n.payload->>'texto' like '%PENDIENTE de confirmación%';
  perform pg_temp.spa_assert(v_total = 1,
    'la clienta debe recibir el aviso de cita pendiente de confirmación');

  select count(*) into v_total
    from public.spa_eventos e
   where e.update_id = 900001 and e.tipo = 'solicitar';
  perform pg_temp.spa_assert(v_total = 1,
    'el update_id 900001 debe quedar reservado en spa_eventos');
end $$;

-- =====================================================================
-- 5. El mismo update_id otra vez: duplicado sin efectos
-- =====================================================================

do $$
declare
  v_codigo text;
  v_total integer;
begin
  select l.codigo into v_codigo
    from pg_temp.spa_llamar(
      900001, 'solicitar', 900001, 900001, 'Clienta Ficticia A',
      null,
      (select s.id from public.spa_servicios s where s.nombre = 'Manicure'),
      pg_temp.spa_get_num('h1')
    ) as l
   limit 1;
  perform pg_temp.spa_assert(v_codigo = 'duplicado',
    'repetir el update_id debe responder duplicado; respondió '
      || coalesce(v_codigo, 'null'));

  select count(*) into v_total
    from public.spa_citas c
   where c.cliente_user_id = 900001;
  perform pg_temp.spa_assert(v_total = 1,
    'repetir el evento no debe crear otra cita; citas de la clienta: ' || v_total);

  select count(*) into v_total
    from public.spa_notificaciones n
   where n.clave like 'cita:' || pg_temp.spa_get_num('cita_a') || ':%';
  perform pg_temp.spa_assert(v_total = 2,
    'repetir el evento no debe crear otros avisos; avisos: ' || v_total);
end $$;

-- =====================================================================
-- 6. Otro update_id para una clienta que ya tiene cita activa
-- =====================================================================

do $$
declare
  v_codigo text;
  v_cita bigint;
  v_total integer;
begin
  select l.codigo, l.cita_id into v_codigo, v_cita
    from pg_temp.spa_llamar(
      900002, 'solicitar', 900001, 900001, 'Clienta Ficticia A',
      null,
      (select s.id from public.spa_servicios s where s.nombre = 'Manicure'),
      pg_temp.spa_get_num('h2')
    ) as l
   limit 1;
  perform pg_temp.spa_assert(v_codigo = 'cita_activa',
    'pedir una segunda cita activa debe responder cita_activa; respondió '
      || coalesce(v_codigo, 'null'));
  perform pg_temp.spa_assert(v_cita = pg_temp.spa_get_num('cita_a'),
    'cita_activa debe devolver el identificador de la cita que ya existe');

  select count(*) into v_total
    from public.spa_citas c
   where c.cliente_user_id = 900001;
  perform pg_temp.spa_assert(v_total = 1,
    'no debe crearse una segunda cita para la misma clienta; citas: ' || v_total);
end $$;

-- =====================================================================
-- 7. Ocupación: otra clienta pide el horario h1, que ya está ocupado
-- =====================================================================

do $$
declare
  v_codigo text;
  v_cita bigint;
  v_total integer;
begin
  select l.codigo, l.cita_id into v_codigo, v_cita
    from pg_temp.spa_llamar(
      900003, 'solicitar', 900002, 900002, 'Clienta Ficticia B',
      null,
      (select s.id from public.spa_servicios s where s.nombre = 'Manicure'),
      pg_temp.spa_get_num('h1')
    ) as l
   limit 1;
  perform pg_temp.spa_assert(v_codigo = 'horario_ocupado',
    'un horario ocupado debe responder horario_ocupado; respondió '
      || coalesce(v_codigo, 'null'));
  perform pg_temp.spa_assert(v_cita = pg_temp.spa_get_num('cita_a'),
    'horario_ocupado debe devolver la cita que ocupa el horario');

  select count(*) into v_total
    from public.spa_citas c
   where c.horario_id = pg_temp.spa_get_num('h1')
     and c.estado in ('pendiente', 'confirmada');
  perform pg_temp.spa_assert(v_total = 1,
    'el horario ocupado debe tener exactamente una cita activa; tiene: ' || v_total);
end $$;

-- =====================================================================
-- 8. Permisos por rol y por pertenencia de la cita
-- =====================================================================

do $$
declare
  v_codigo text;
  v_total integer;
begin
  -- Una clienta no confirma.
  select l.codigo into v_codigo
    from pg_temp.spa_llamar(
      900004, 'confirmar', 900002, 900002, 'Clienta Ficticia B',
      pg_temp.spa_get_num('cita_a'), null, null
    ) as l
   limit 1;
  perform pg_temp.spa_assert(v_codigo = 'sin_permiso',
    'una clienta no puede confirmar; respondió ' || coalesce(v_codigo, 'null'));

  -- Ni auto-confirmar: eso es del responsable.
  select l.codigo into v_codigo
    from pg_temp.spa_llamar(
      900005, 'confirmar', 900001, 900001, 'Clienta Ficticia A',
      pg_temp.spa_get_num('cita_a'), null, null
    ) as l
   limit 1;
  perform pg_temp.spa_assert(v_codigo = 'sin_permiso',
    'la clienta no puede auto-confirmar; respondió ' || coalesce(v_codigo, 'null'));

  -- Tampoco rechaza.
  select l.codigo into v_codigo
    from pg_temp.spa_llamar(
      900013, 'rechazar', 900002, 900002, 'Clienta Ficticia B',
      pg_temp.spa_get_num('cita_a'), null, null
    ) as l
   limit 1;
  perform pg_temp.spa_assert(v_codigo = 'sin_permiso',
    'una clienta no puede rechazar; respondió ' || coalesce(v_codigo, 'null'));

  -- No se cancela la cita de otra persona.
  select l.codigo into v_codigo
    from pg_temp.spa_llamar(
      900006, 'cancelar', 900002, 900002, 'Clienta Ficticia B',
      pg_temp.spa_get_num('cita_a'), null, null
    ) as l
   limit 1;
  perform pg_temp.spa_assert(v_codigo = 'sin_permiso',
    'no se puede cancelar la cita de otra persona; respondió '
      || coalesce(v_codigo, 'null'));

  select count(*) into v_total
    from public.spa_citas c
   where c.id = pg_temp.spa_get_num('cita_a')
     and c.estado = 'pendiente';
  perform pg_temp.spa_assert(v_total = 1,
    'los intentos sin permiso no deben cambiar el estado de la cita');

  -- Los rechazos por rol se detectan antes de reservar el update_id.
  -- Ojo: cancelar necesita leer la cita para saber de quién es, así que un
  -- cancelar sin permiso sí consume su update_id (900006) y responde
  -- sin_permiso de todos modos.
  select count(*) into v_total
    from public.spa_eventos e
   where e.update_id in (900004, 900005, 900013);
  perform pg_temp.spa_assert(v_total = 0,
    'un intento sin permiso de rol no debe reservar el update_id; reservados: '
      || v_total);

  select count(*) into v_total
    from public.spa_eventos e
   where e.update_id = 900006;
  perform pg_temp.spa_assert(v_total = 1,
    'un cancelar sin permiso sí se registra como evento procesado');
end $$;

-- =====================================================================
-- 9. El responsable confirma; el cambio repetido no crea otra transición
-- =====================================================================

do $$
declare
  v_codigo text;
  v_estado text;
  v_cita bigint := pg_temp.spa_get_num('cita_a');
  v_total integer;
begin
  select l.codigo, l.estado_cita into v_codigo, v_estado
    from pg_temp.spa_llamar(
      900007, 'confirmar', 800001, 800001, 'Responsable Ficticio',
      v_cita, null, null
    ) as l
   limit 1;
  perform pg_temp.spa_assert(v_codigo = 'ok',
    'el responsable debe poder confirmar; respondió ' || coalesce(v_codigo, 'null'));
  perform pg_temp.spa_assert(v_estado = 'confirmada',
    'la cita debe quedar confirmada; quedó ' || coalesce(v_estado, 'null'));

  select count(*) into v_total
    from public.spa_citas c
   where c.id = v_cita and c.estado = 'confirmada';
  perform pg_temp.spa_assert(v_total = 1,
    'la tabla debe mostrar la cita como confirmada');

  select count(*) into v_total
    from public.spa_notificaciones n
   where n.clave in (
     'cita:' || v_cita || ':confirmada:cliente',
     'cita:' || v_cita || ':confirmada:admin'
   );
  perform pg_temp.spa_assert(v_total = 2,
    'deben existir los 2 avisos de la confirmación; encontrados: ' || v_total);

  -- Segundo toque del botón, con otro update_id.
  select l.codigo into v_codigo
    from pg_temp.spa_llamar(
      900008, 'confirmar', 800001, 800001, 'Responsable Ficticio',
      v_cita, null, null
    ) as l
   limit 1;
  perform pg_temp.spa_assert(v_codigo = 'estado_invalido',
    'confirmar dos veces debe responder estado_invalido; respondió '
      || coalesce(v_codigo, 'null'));

  select count(*) into v_total
    from public.spa_notificaciones n
   where n.clave like 'cita:' || v_cita || ':%';
  perform pg_temp.spa_assert(v_total = 4,
    'la cita debe tener 4 avisos en total (solicitud + confirmación); tiene: '
      || v_total);
end $$;

-- =====================================================================
-- 10. Cancelación: libera el horario y permite volver a agendar
-- =====================================================================

do $$
declare
  v_codigo text;
  v_cita bigint;
  v_cita2 bigint;
  v_total integer;
begin
  select l.codigo, l.cita_id into v_codigo, v_cita
    from pg_temp.spa_llamar(
      900009, 'solicitar', 900002, 900002, 'Clienta Ficticia B',
      null,
      (select s.id from public.spa_servicios s where s.nombre = 'Manicure'),
      pg_temp.spa_get_num('h2')
    ) as l
   limit 1;
  perform pg_temp.spa_assert(v_codigo = 'ok',
    'la clienta B debe poder pedir h2; respondió ' || coalesce(v_codigo, 'null'));

  select l.codigo into v_codigo
    from pg_temp.spa_llamar(
      900010, 'cancelar', 900001, 900001, 'Clienta Ficticia A',
      v_cita, null, null
    ) as l
   limit 1;
  perform pg_temp.spa_assert(v_codigo = 'sin_permiso',
    'no se puede cancelar una cita ajena; respondió ' || coalesce(v_codigo, 'null'));

  select l.codigo into v_codigo
    from pg_temp.spa_llamar(
      900011, 'cancelar', 900002, 900002, 'Clienta Ficticia B',
      v_cita, null, null
    ) as l
   limit 1;
  perform pg_temp.spa_assert(v_codigo = 'ok',
    'la clienta debe poder cancelar su cita; respondió ' || coalesce(v_codigo, 'null'));

  select count(*) into v_total
    from public.spa_notificaciones n
   where n.clave in (
     'cita:' || v_cita || ':cancelada:cliente',
     'cita:' || v_cita || ':cancelada:admin'
   );
  perform pg_temp.spa_assert(v_total = 2,
    'la cancelación debe avisar a la clienta y al responsable; encontrados: '
      || v_total);

  -- El horario quedó libre: B puede volver a pedirlo.
  select l.codigo, l.cita_id into v_codigo, v_cita2
    from pg_temp.spa_llamar(
      900012, 'solicitar', 900002, 900002, 'Clienta Ficticia B',
      null,
      (select s.id from public.spa_servicios s where s.nombre = 'Manicure'),
      pg_temp.spa_get_num('h2')
    ) as l
   limit 1;
  perform pg_temp.spa_assert(v_codigo = 'ok',
    'tras cancelar, el horario debe quedar libre; respondió '
      || coalesce(v_codigo, 'null'));
  perform pg_temp.spa_assert(v_cita2 is distinct from v_cita,
    'la nueva cita debe ser distinta de la cancelada');

  select l.codigo into v_codigo
    from pg_temp.spa_llamar(
      900014, 'cancelar', 900002, 900002, 'Clienta Ficticia B',
      v_cita2, null, null
    ) as l
   limit 1;
  perform pg_temp.spa_assert(v_codigo = 'ok',
    'la clienta debe poder cancelar la segunda cita; respondió '
      || coalesce(v_codigo, 'null'));

  select l.codigo into v_codigo
    from pg_temp.spa_llamar(
      900015, 'cancelar', 900002, 900002, 'Clienta Ficticia B',
      v_cita2, null, null
    ) as l
   limit 1;
  perform pg_temp.spa_assert(v_codigo = 'estado_invalido',
    'cancelar dos veces la misma cita debe responder estado_invalido; respondió '
      || coalesce(v_codigo, 'null'));

  select count(*) into v_total
    from public.spa_citas c
   where c.horario_id = pg_temp.spa_get_num('h2')
     and c.estado in ('pendiente', 'confirmada');
  perform pg_temp.spa_assert(v_total = 0,
    'no debe quedar ninguna cita activa en h2; hay: ' || v_total);
end $$;

-- =====================================================================
-- 11. Vencimiento: una cita pasada no bloquea una solicitud nueva
-- =====================================================================

do $$
declare
  v_codigo text;
  v_estado text;
  v_h_pasado bigint;
  v_h_reciente bigint;
  v_cita_vencida bigint;
  v_cita_pendiente bigint;
  v_total integer;
begin
  insert into public.spa_horarios (inicio, fin)
  values (now() - interval '2 days', now() - interval '2 days' + interval '60 minutes')
  returning id into v_h_pasado;
  insert into public.spa_horarios (inicio, fin)
  values (now() - interval '5 minutes', now() - interval '5 minutes' + interval '60 minutes')
  returning id into v_h_reciente;

  -- Cita confirmada de hace dos días, de la clienta C.
  insert into public.spa_citas (
    cliente_user_id, cliente_chat_id, cliente_nombre, servicio_id, horario_id, estado
  )
  values (900003, 900003, 'Clienta Ficticia C',
          (select s.id from public.spa_servicios s where s.nombre = 'Manicure'),
          v_h_pasado, 'confirmada')
  returning id into v_cita_vencida;

  -- Cita pendiente de hace cinco minutos, de la clienta D.
  insert into public.spa_citas (
    cliente_user_id, cliente_chat_id, cliente_nombre, servicio_id, horario_id, estado
  )
  values (900004, 900004, 'Clienta Ficticia D',
          (select s.id from public.spa_servicios s where s.nombre = 'Manicure'),
          v_h_reciente, 'pendiente')
  returning id into v_cita_pendiente;

  -- La clienta C pide un horario futuro: la cita vencida se cierra sola.
  select l.codigo into v_codigo
    from pg_temp.spa_llamar(
      900016, 'solicitar', 900003, 900003, 'Clienta Ficticia C',
      null,
      (select s.id from public.spa_servicios s where s.nombre = 'Manicure'),
      pg_temp.spa_get_num('h3')
    ) as l
   limit 1;
  perform pg_temp.spa_assert(v_codigo = 'ok',
    'una cita vencida no debe bloquear una solicitud nueva; respondió '
      || coalesce(v_codigo, 'null'));

  select c.estado into v_estado
    from public.spa_citas c
   where c.id = v_cita_vencida;
  perform pg_temp.spa_assert(v_estado = 'finalizada',
    'la cita vencida debe quedar finalizada; quedó ' || coalesce(v_estado, 'null'));

  -- El responsable intenta confirmar un horario que ya pasó.
  select l.codigo into v_codigo
    from pg_temp.spa_llamar(
      900017, 'confirmar', 800001, 800001, 'Responsable Ficticio',
      v_cita_pendiente, null, null
    ) as l
   limit 1;
  perform pg_temp.spa_assert(v_codigo = 'horario_vencido',
    'no se puede confirmar un horario pasado; respondió ' || coalesce(v_codigo, 'null'));

  select c.estado into v_estado
    from public.spa_citas c
   where c.id = v_cita_pendiente;
  perform pg_temp.spa_assert(v_estado = 'finalizada',
    'la cita con horario pasado debe quedar finalizada; quedó '
      || coalesce(v_estado, 'null'));

  -- Tampoco se puede solicitar un horario que ya pasó.
  select l.codigo into v_codigo
    from pg_temp.spa_llamar(
      900018, 'solicitar', 900004, 900004, 'Clienta Ficticia D',
      null,
      (select s.id from public.spa_servicios s where s.nombre = 'Manicure'),
      v_h_reciente
    ) as l
   limit 1;
  perform pg_temp.spa_assert(v_codigo = 'horario_vencido',
    'no se puede solicitar un horario pasado; respondió '
      || coalesce(v_codigo, 'null'));

  select count(*) into v_total
    from public.spa_citas c
   where c.cliente_user_id = 900003
     and c.estado in ('pendiente', 'confirmada');
  perform pg_temp.spa_assert(v_total = 1,
    'la clienta C debe tener exactamente una cita activa; tiene: ' || v_total);
end $$;

-- =====================================================================
-- 12. Outbox: reclamar con lease, finalizar y no repetir a ciegas
-- =====================================================================

do $$
declare
  v_ids bigint[];
  v_id bigint;
  v_codigo text;
  v_estado text;
  v_token uuid;
  v_token1 uuid;
  v_token2 uuid;
  v_total integer;
  v_intentos integer;
begin
  select coalesce(array_agg(n.id order by n.id), '{}'::bigint[]) into v_ids
    from public.spa_notificaciones n
   where n.estado = 'pendiente';
  perform pg_temp.spa_assert(coalesce(array_length(v_ids, 1), 0) >= 4,
    'deben quedar al menos 4 avisos pendientes para probar la cola; hay: '
      || coalesce(array_length(v_ids, 1), 0));

  -- Escenario 1: reclamar, no repetir, token ajeno y respuesta incierta.
  perform pg_temp.spa_aislar(v_ids[1]);

  select count(*),
         (array_agg(n.id order by n.id))[1],
         (array_agg(n.lease_token order by n.id))[1],
         (array_agg(n.estado order by n.id))[1],
         (array_agg(n.intentos order by n.id))[1]
    into v_total, v_id, v_token, v_estado, v_intentos
    from public.spa_reclamar_avisos(20, 60) as n;
  perform pg_temp.spa_assert(v_total = 1 and v_id = v_ids[1],
    'reclamar debe devolver el único aviso elegible; devolvió ' || v_total);
  perform pg_temp.spa_assert(
    v_estado = 'procesando' and v_intentos = 1 and v_token is not null,
    'el aviso reclamado queda procesando, con un intento y un token');

  select count(*) into v_total
    from public.spa_reclamar_avisos(20, 60) as n;
  perform pg_temp.spa_assert(v_total = 0,
    'un aviso con lease vivo no se reclama otra vez; se reclamó: ' || v_total);

  select public.spa_finalizar_aviso(v_ids[1], gen_random_uuid(), 'enviada', null, 1)
    into v_codigo;
  perform pg_temp.spa_assert(v_codigo = 'sin_lease',
    'un token que no es el del lease no puede cerrar el intento; devolvió '
      || v_codigo);

  select public.spa_finalizar_aviso(v_ids[1], v_token, 'revision', 'timeout_indeciso')
    into v_codigo;
  perform pg_temp.spa_assert(v_codigo = 'revision',
    'una respuesta incierta queda en revision; devolvió ' || v_codigo);

  select count(*) into v_total
    from public.spa_reclamar_avisos(20, 60) as n;
  perform pg_temp.spa_assert(v_total = 0,
    'un aviso en revision no se reenvía solo; se reclamó: ' || v_total);

  -- Escenario 2: revisado a mano, vuelve a la cola y Telegram confirma ok.
  update public.spa_notificaciones n
     set estado = 'pendiente', disponible_desde = now()
   where n.id = v_ids[1];

  perform pg_temp.spa_aislar(v_ids[1]);
  select count(*), (array_agg(n.lease_token order by n.id))[1]
    into v_total, v_token2
    from public.spa_reclamar_avisos(20, 60) as n;
  perform pg_temp.spa_assert(v_total = 1 and v_token2 is not null and v_token2 <> v_token,
    'al volver a la cola debe recibirse un token nuevo');

  select public.spa_finalizar_aviso(v_ids[1], v_token2, 'enviada', null, 555000111)
    into v_codigo;
  perform pg_temp.spa_assert(v_codigo = 'enviada',
    'con ok=true de Telegram el aviso queda enviada; devolvió ' || v_codigo);

  select count(*) into v_total
    from public.spa_notificaciones n
   where n.id = v_ids[1]
     and n.estado = 'enviada'
     and n.telegram_message_id = 555000111
     and n.lease_token is null
     and n.lease_hasta is null
     and n.error_codigo is null;
  perform pg_temp.spa_assert(v_total = 1,
    'el message_id se guarda y el lease se libera solo tras ok=true');

  -- Escenario 3: un lease vencido se vuelve a reclamar con token nuevo.
  perform pg_temp.spa_aislar(v_ids[2]);
  select count(*),
         (array_agg(n.lease_token order by n.id))[1],
         (array_agg(n.intentos order by n.id))[1]
    into v_total, v_token1, v_intentos
    from public.spa_reclamar_avisos(20, 60) as n;
  perform pg_temp.spa_assert(v_total = 1 and v_intentos = 1,
    'debe reclamarse el aviso 2');

  update public.spa_notificaciones n
     set lease_hasta = now() - interval '1 minute'
   where n.id = v_ids[2];

  select count(*),
         (array_agg(n.lease_token order by n.id))[1],
         (array_agg(n.intentos order by n.id))[1]
    into v_total, v_token2, v_intentos
    from public.spa_reclamar_avisos(20, 60) as n;
  perform pg_temp.spa_assert(
    v_total = 1 and v_token2 <> v_token1 and v_intentos = 2,
    'un lease vencido se reclama otra vez, con token nuevo e intentos 2');

  select public.spa_finalizar_aviso(v_ids[2], v_token1, 'enviada', null, 1)
    into v_codigo;
  perform pg_temp.spa_assert(v_codigo = 'sin_lease',
    'el token del lease anterior ya no puede cerrar el intento');

  -- Escenario 4: error reintentable deja una espera creciente.
  select public.spa_finalizar_aviso(v_ids[2], v_token2, 'reintentable', 'telegram_503')
    into v_codigo;
  perform pg_temp.spa_assert(v_codigo = 'pendiente',
    'un error reintentable vuelve a la cola; devolvió ' || v_codigo);

  select count(*) into v_total
    from public.spa_notificaciones n
   where n.id = v_ids[2]
     and n.estado = 'pendiente'
     and n.disponible_desde > now()
     and n.lease_token is null;
  perform pg_temp.spa_assert(v_total = 1,
    'el reintento debe esperar antes de volver a estar disponible');

  perform pg_temp.spa_apartar(v_ids[2]);
  select count(*) into v_total
    from public.spa_reclamar_avisos(20, 60) as n;
  perform pg_temp.spa_assert(v_total = 0,
    'un aviso en espera no se reclama todavía; se reclamó: ' || v_total);

  -- Escenario 5: error permanente queda fallido y no vuelve a la cola.
  perform pg_temp.spa_aislar(v_ids[3]);
  select count(*) into v_total
    from public.spa_reclamar_avisos(20, 60) as n;
  perform pg_temp.spa_assert(v_total = 1, 'debe reclamarse el aviso 3');

  select n.lease_token into v_token
    from public.spa_notificaciones n
   where n.id = v_ids[3];
  select public.spa_finalizar_aviso(v_ids[3], v_token, 'permanente', 'bot_bloqueado')
    into v_codigo;
  perform pg_temp.spa_assert(v_codigo = 'fallida',
    'un error permanente queda fallido; devolvió ' || v_codigo);

  select count(*) into v_total
    from public.spa_reclamar_avisos(20, 60) as n;
  perform pg_temp.spa_assert(v_total = 0,
    'un aviso fallido no vuelve a la cola; se reclamó: ' || v_total);

  -- Escenario 6: al quinto intento el aviso queda fallido.
  update public.spa_notificaciones n
     set intentos = 4
   where n.id = v_ids[4];
  perform pg_temp.spa_aislar(v_ids[4]);
  select count(*) into v_total
    from public.spa_reclamar_avisos(20, 60) as n;
  perform pg_temp.spa_assert(v_total = 1, 'debe reclamarse el aviso 4');

  select n.lease_token into v_token
    from public.spa_notificaciones n
   where n.id = v_ids[4];
  select public.spa_finalizar_aviso(v_ids[4], v_token, 'reintentable', null)
    into v_codigo;
  perform pg_temp.spa_assert(v_codigo = 'fallida',
    'al agotar los 5 intentos el aviso queda fallido; devolvió ' || v_codigo);

  select count(*) into v_total
    from public.spa_notificaciones n
   where n.id = v_ids[4]
     and n.intentos = 5
     and n.error_codigo = 'intentos_agotados';
  perform pg_temp.spa_assert(v_total = 1,
    'el quinto intento agotado debe quedar registrado como fallido');

  update public.spa_notificaciones n
     set estado = 'pendiente', disponible_desde = now()
   where n.id = v_ids[4];
  select count(*) into v_total
    from public.spa_reclamar_avisos(20, 60) as n;
  perform pg_temp.spa_assert(v_total = 0,
    'un aviso con 5 intentos no se vuelve a reclamar; se reclamó: ' || v_total);

  -- La base nunca guarda URLs de Telegram, tokens ni mensajes crudos.
  select count(*) into v_total
    from public.spa_notificaciones n
   where n.error_codigo like '%://%'
      or n.error_codigo like '%api.telegram%'
      or n.error_codigo ~ '[0-9]{5,}:[A-Za-z0-9_-]{10,}'
      or length(n.error_codigo) > 60;
  perform pg_temp.spa_assert(v_total = 0,
    'error_codigo debe guardar solo un código corto, sin URL ni token; filas: '
      || v_total);

  select count(*) into v_total
    from public.spa_notificaciones n
   where n.payload ? 'text'
      or n.payload ? 'message';
  perform pg_temp.spa_assert(v_total = 0,
    'el aviso no debe guardar el cuerpo entrante de Telegram; filas: ' || v_total);
end $$;

-- =====================================================================
-- 13. Estado final esperado
-- =====================================================================

do $$
declare
  v_total integer;
begin
  select count(*) into v_total
    from public.spa_citas c
   where c.estado in ('pendiente', 'confirmada')
     and c.horario_id in (
       pg_temp.spa_get_num('h1'), pg_temp.spa_get_num('h2'), pg_temp.spa_get_num('h3')
     );
  perform pg_temp.spa_assert(v_total = 2,
    'deben quedar activas la cita confirmada en h1 y la nueva en h3; hay: ' || v_total);

  select count(*) into v_total from public.spa_citas;
  perform pg_temp.spa_assert(v_total = 6,
    'el escenario completo debe dejar 6 citas; dejó: ' || v_total);

  -- 18 update_id de prueba, menos 3 rechazados por rol (900004, 900005 y 900013).
  select count(*) into v_total
    from public.spa_eventos e
   where e.update_id between 900001 and 900099;
  perform pg_temp.spa_assert(v_total = 15,
    'deben quedar 15 eventos reservados en el rango de prueba; hay: ' || v_total);

  select count(*) into v_total from public.spa_servicios;
  perform pg_temp.spa_assert(v_total = 3,
    'la semilla de servicios no debe alterarse; hay: ' || v_total);

  raise notice
    'Integración SQL: todas las aserciones pasaron. Se ejecuta ROLLBACK y nada queda guardado.';
end $$;

rollback;

-- =====================================================================
-- Concurrencia real: dos sesiones separadas
-- =====================================================================
--
-- Esta prueba NO es secuencial. Una consulta después de otra nunca choca con
-- el índice único, porque la primera ya terminó. Necesitas DOS sesiones
-- abiertas a la vez: dos pestañas del SQL Editor, o dos terminales con psql.
-- Con una sola sesión deja esta parte como PENDIENTE en evidencia/RESULTADOS.md.
--
-- 1. En cualquier sesión, consigue un horario libre:
--
--      select h.id,
--             to_char(h.inicio at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') as hora
--        from spa_horarios h
--       where h.inicio > now()
--         and not exists (
--           select 1 from spa_citas c
--            where c.horario_id = h.id
--              and c.estado in ('pendiente', 'confirmada')
--         )
--       order by h.inicio
--       limit 1;
--
-- 2. Sustituye <HORARIO_ID> por ese id en los bloques siguientes. Las dos
--    transacciones deben quedar ABIERTAS a la vez, por eso aquí no hay
--    ROLLBACK: al final se limpian los datos a mano.
--
--    Sesión A:
--
--      begin;
--      select * from spa_mutar_cita(
--        990001, 'solicitar', 900001, 900001, 800001, 800001,
--        'Clienta Ficticia A', null,
--        (select id from spa_servicios where nombre = 'Manicure'), <HORARIO_ID>
--      );
--
--    Sesión B (déjala corriendo; se queda esperando, y eso es lo esperado):
--
--      begin;
--      select * from spa_mutar_cita(
--        990002, 'solicitar', 900002, 900002, 800001, 800001,
--        'Clienta Ficticia B', null,
--        (select id from spa_servicios where nombre = 'Manicure'), <HORARIO_ID>
--      );
--
-- 3. Mientras B espera, en la sesión A ejecuta:
--
--      commit;
--
-- 4. Resultado esperado:
--      - Sesión A: codigo = 'ok', con identificador de cita.
--      - Sesión B: termina solo después del commit de A y devuelve
--        codigo = 'horario_ocupado' con el identificador de la cita de A.
--      - Si B devolviera 'ok', el índice único de ocupación estaría roto y
--        no debes publicar el proyecto en ese estado.
--
-- 5. Limpieza (cualquier sesión):
--
--      rollback;  -- en la sesión B
--      delete from spa_notificaciones
--       where chat_id in (800001, 900001, 900002)
--         and payload->>'texto' like '%Clienta Ficticia%';
--      delete from spa_citas where cliente_user_id in (900001, 900002);
--      delete from spa_eventos where update_id in (990001, 990002);
--
-- 6. Anota en evidencia/RESULTADOS.md lo que viste, incluido lo que muestra la
--    sesión B mientras espera.