-- Continuación: RPCs spa_mutar_cita, reclamar y finalizar notificaciones

-- spa_mutar_cita
create or replace function spa_mutar_cita(
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
set search_path = public
as $$
declare
  v_evento_exists boolean;
  v_horario spa_horarios%rowtype;
  v_servicio spa_servicios%rowtype;
  v_cita spa_citas%rowtype;
  v_result jsonb;
  v_update_id bigint := p_update_id;
  v_admin_user_id bigint := p_admin_user_id;
  v_admin_chat_id bigint := p_admin_chat_id;
begin
  -- Resguardar update_id y evento
  insert into spa_eventos (update_id, tipo)
  values (v_update_id, p_accion)
  on conflict (update_id) do nothing;
  select exists (select 1 from spa_eventos where update_id = v_update_id) into v_evento_exists;
  -- Si ya existía, verificar si fue procesado por este update_id? Retornar duplicado
  -- Para identificar duplicado: si no insertamos nada, asumimos ya procesado
  if not found and (select count(*) from spa_eventos where update_id = v_update_id) >= 0 then
    -- on conflict: evento ya existe
    null;
  end if;
  -- Detectar duplicado: intentar obtener cita/avisos relacionados? pero no tenemos vínculo; 
  -- Estrategia: si evento ya existía antes de este intento, devolver duplicado
  -- Simplificado: contar eventos con ese update_id creado recientemente? no. Usar bloqueo: 
  -- evento insertado solo una vez; para duplicado retornamos {"estado":"duplicado","update_id":...}
  -- Comprobar existencia previa
  perform 1 from spa_eventos e where e.update_id = v_update_id limit 1;
  -- Duplicado: si hubo conflicto en insert, el evento ya estaba
  -- plpgsql: INSERT ... ON CONFLICT no cambia FOUND en conflicto; mejor usar CTE o select
  begin
    insert into spa_eventos (update_id, tipo) values (v_update_id, p_accion)
    on conflict do nothing;
  exception when others then
    return jsonb_build_object('estado','duplicado','update_id',v_update_id);
  end;
  -- Reintentar detección
  if (select count(*) from spa_eventos where update_id = v_update_id) = 0 then
    return jsonb_build_object('estado','duplicado','update_id',v_update_id);
  end if;
  -- Acciones
  if p_accion = 'solicitar' then
    if p_servicio_id is null or p_horario_id is null then
      raise exception 'servicio y horario requeridos';
    end if;
    select * into v_servicio from spa_servicios where id = p_servicio_id and activo = true for share;
    if not found then raise exception 'servicio_inactivo_o_inexistente'; end if;
    select * into v_horario from spa_horarios where id = p_horario_id for update;
    if not found then raise exception 'horario_inexistente'; end if;
    -- cerrar vencidas para cliente
    update spa_citas set estado = 'finalizada'
    where cliente_user_id = p_actor_user_id and estado = 'pendiente'
      and exists (select 1 from spa_horarios h where h.id = horario_id and h.inicio < now() at time zone 'America/Bogota');
    update spa_citas set estado = 'cancelada'
    where cliente_user_id = p_actor_user_id and estado = 'confirmada'
      and exists (select 1 from spa_horarios h where h.id = horario_id and h.inicio < now() at time zone 'America/Bogota');
    -- verificar activa
    if exists (
      select 1 from spa_citas c
      join spa_horarios h on h.id = c.horario_id
      where c.cliente_user_id = p_actor_user_id
        and c.estado in ('pendiente','confirmada')
        and h.inicio >= (now() at time zone 'America/Bogota')
    ) then
      return jsonb_build_object('estado','consulta_tu_cita');
    end if;
    -- crear pendiente
    insert into spa_citas (cliente_user_id, cliente_chat_id, cliente_nombre, servicio_id, horario_id, estado, created_at)
    values (p_actor_user_id, p_actor_chat_id, left(p_nombre,80), v_servicio.id, v_horario.id, 'pendiente', now())
    returning * into v_cita;
    -- avisos
    insert into spa_notificaciones (clave, chat_id, payload, estado, intentos, disponible_desde)
    values (
      format('cita:%s:solicitada:cliente', v_cita.id),
      v_cita.cliente_chat_id,
      jsonb_build_object('tipo','solicitada_cliente','cita_id',v_cita.id,'horario_id',v_horario.id,'servicio_id',v_servicio.id),
      'pendiente', 0, now()
    ) on conflict do nothing;
    insert into spa_notificaciones (clave, chat_id, payload, estado, intentos, disponible_desde)
    values (
      format('cita:%s:solicitada:admin', v_cita.id),
      v_admin_chat_id,
      jsonb_build_object('tipo','solicitada_admin','cita_id',v_cita.id,'cliente_user_id',p_actor_user_id,'nombre',left(p_nombre,80)),
      'pendiente', 0, now()
    ) on conflict do nothing;
    v_result := jsonb_build_object('estado','ok','accion','solicitar','cita_id',v_cita.id);
    return v_result;
  elsif p_accion = 'confirmar' then
    if v_admin_user_id is null or v_admin_chat_id is null then
      raise exception 'admin_requerido';
    end if;
    if p_cita_id is null then raise exception 'cita_id_requerido'; end if;
    select * into v_cita from spa_citas where id = p_cita_id for update;
    if not found then return jsonb_build_object('estado','no_encontrada'); end if;
    if v_cita.estado not in ('pendiente') then
      return jsonb_build_object('estado','estado_invalido','actual',v_cita.estado);
    end if;
    -- vencida?
    select * into v_horario from spa_horarios where id = v_cita.horario_id for update;
    if (v_horario.inicio < now() at time zone 'America/Bogota') then
      update spa_citas set estado = 'finalizada' where id = v_cita.id;
      return jsonb_build_object('estado','vencida');
    end if;
    update spa_citas set estado = 'confirmada' where id = v_cita.id returning * into v_cita;
    insert into spa_notificaciones (clave, chat_id, payload, estado, intentos, disponible_desde)
    values (
      format('cita:%s:confirmada:cliente', v_cita.id),
      v_cita.cliente_chat_id,
      jsonb_build_object('tipo','confirmada_cliente','cita_id',v_cita.id),
      'pendiente', 0, now()
    ) on conflict do nothing;
    insert into spa_notificaciones (clave, chat_id, payload, estado, intentos, disponible_desde)
    values (
      format('cita:%s:confirmada:admin', v_cita.id),
      v_admin_chat_id,
      jsonb_build_object('tipo','confirmada_admin','cita_id',v_cita.id),
      'pendiente', 0, now()
    ) on conflict do nothing;
    return jsonb_build_object('estado','ok','accion','confirmar','cita_id',v_cita.id);
  elsif p_accion = 'rechazar' then
    if v_admin_user_id is null or v_admin_chat_id is null then
      raise exception 'admin_requerido';
    end if;
    if p_cita_id is null then raise exception 'cita_id_requerido'; end if;
    select * into v_cita from spa_citas where id = p_cita_id for update;
    if not found then return jsonb_build_object('estado','no_encontrada'); end if;
    if v_cita.estado not in ('pendiente') then
      return jsonb_build_object('estado','estado_invalido','actual',v_cita.estado);
    end if;
    select * into v_horario from spa_horarios where id = v_cita.horario_id for update;
    update spa_citas set estado = 'rechazada' where id = v_cita.id returning * into v_cita;
    insert into spa_notificaciones (clave, chat_id, payload, estado, intentos, disponible_desde)
    values (
      format('cita:%s:rechazada:cliente', v_cita.id),
      v_cita.cliente_chat_id,
      jsonb_build_object('tipo','rechazada_cliente','cita_id',v_cita.id),
      'pendiente', 0, now()
    ) on conflict do nothing;
    insert into spa_notificaciones (clave, chat_id, payload, estado, intentos, disponible_desde)
    values (
      format('cita:%s:rechazada:admin', v_cita.id),
      v_admin_chat_id,
      jsonb_build_object('tipo','rechazada_admin','cita_id',v_cita.id),
      'pendiente', 0, now()
    ) on conflict do nothing;
    return jsonb_build_object('estado','ok','accion','rechazar','cita_id',v_cita.id);
  elsif p_accion = 'cancelar' then
    if p_cita_id is null then raise exception 'cita_id_requerido'; end if;
    select * into v_cita from spa_citas where id = p_cita_id for update;
    if not found then return jsonb_build_object('estado','no_encontrada'); end if;
    if v_cita.cliente_user_id <> p_actor_user_id then
      return jsonb_build_object('estado','no_autorizado');
    end if;
    if v_cita.estado not in ('pendiente','confirmada') then
      return jsonb_build_object('estado','estado_invalido','actual',v_cita.estado);
    end if;
    select * into v_horario from spa_horarios where id = v_cita.horario_id for update;
    update spa_citas set estado = 'cancelada' where id = v_cita.id returning * into v_cita;
    insert into spa_notificaciones (clave, chat_id, payload, estado, intentos, disponible_desde)
    values (
      format('cita:%s:cancelada:cliente', v_cita.id),
      v_cita.cliente_chat_id,
      jsonb_build_object('tipo','cancelada_cliente','cita_id',v_cita.id),
      'pendiente', 0, now()
    ) on conflict do nothing;
    insert into spa_notificaciones (clave, chat_id, payload, estado, intentos, disponible_desde)
    values (
      format('cita:%s:cancelada:admin', v_cita.id),
      v_admin_chat_id,
      jsonb_build_object('tipo','cancelada_admin','cita_id',v_cita.id),
      'pendiente', 0, now()
    ) on conflict do nothing;
    return jsonb_build_object('estado','ok','accion','cancelar','cita_id',v_cita.id);
  else
    return jsonb_build_object('estado','accion_desconocida');
  end if;
exception
  when unique_violation then
    return jsonb_build_object('estado','horario_ocupado');
  when others then
    raise;
end;
$$;

revoke execute on function spa_mutar_cita from public, anon, authenticated;
grant execute on function spa_mutar_cita to service_role;

-- Reclamar notificaciones
create or replace function spa_reclamar_notificaciones(p_lote integer default 10)
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
set search_path = public
as $$
declare
  v_token uuid := gen_random_uuid();
begin
  return query
  with candidatos as (
    select n.id
    from spa_notificaciones n
    where n.estado = 'pendiente'
      and n.disponible_desde <= now()
      and (n.lease_hasta is null or n.lease_hasta < now())
    order by n.id
    for update skip locked
    limit greatest(1, coalesce(p_lote,10))
  ), asignados as (
    update spa_notificaciones n
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

revoke execute on function spa_reclamar_notificaciones from public, anon, authenticated;
grant execute on function spa_reclamar_notificaciones to service_role;

-- Finalizar notificación
create or replace function spa_finalizar_notificacion(
  p_id bigint,
  p_lease_token uuid,
  p_enviada boolean,
  p_telegram_message_id bigint default null,
  p_error_codigo text default null,
  p_retry_after_seconds integer default null
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_n spa_notificaciones%rowtype;
begin
  select * into v_n from spa_notificaciones where id = p_id for update;
  if not found then
    return false;
  end if;
  if v_n.lease_token is distinct from p_lease_token then
    return false; -- no es dueño del lease
  end if;
  if p_enviada then
    update spa_notificaciones
    set estado = 'enviada',
        telegram_message_id = p_telegram_message_id,
        error_codigo = null,
        lease_hasta = null,
        lease_token = null,
        disponible_desde = now()
    where id = p_id;
    return true;
  else
    if v_n.intentos >= 5 then
      update spa_notificaciones
      set estado = 'fallida',
          error_codigo = coalesce(p_error_codigo,'max_intentos'),
          lease_hasta = null,
          lease_token = null,
          disponible_desde = now()
      where id = p_id;
      return true;
    end if;
    update spa_notificaciones
    set estado = 'revision',
        error_codigo = coalesce(p_error_codigo,'envio_fallido'),
        lease_hasta = null,
        lease_token = null,
        disponible_desde = now() + (coalesce(p_retry_after_seconds,5) * interval '1 second')
    where id = p_id;
    return true;
  end if;
end;
$$;

revoke execute on function spa_finalizar_notificacion from public, anon, authenticated;
grant execute on function spa_finalizar_notificacion to service_role;
