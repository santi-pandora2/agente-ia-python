# Resultados

## Estructura y base de datos (etapa actual)

- Migración: `supabase/migrations/202610020001_spa.sql`
- Funciones creadas: `spa_generar_horarios()`,
  `spa_mutar_cita(p_update_id, p_accion, p_actor_user_id, p_actor_chat_id, p_nombre, p_cita_id, p_servicio_id, p_horario_id, p_admin_user_id, p_admin_chat_id)`,
  `spa_reclamar_notificaciones(p_lote)`,
  `spa_finalizar_notificacion(p_id,p_lease_token,p_enviada,p_telegram_message_id,p_error_codigo,p_retry_after_seconds)`
- Config: `supabase/config.toml` (project_id spa-manos-pies,
  functions.spa-telegram.verify_jwt=false)
- Tests integración: `tests/integration.sql` (BEGIN/ROLLBACK, aserciones,
  permisos, duplicados, ocupación, cancelación, vencimiento, avisos,
  concurrencia)

## Estado por tipo

- **Unitario**: PENDIENTE (requiere handler/telegram testables)
- **Integración SQL**: PENDIENTE (ejecutar en SQL Editor con service_role)
- **Concurrencia (2 sesiones)**: PENDIENTE (verificar con instrucciones en
  integration.sql)
- **Telegram real**: PENDIENTE

## Notas

- Índice único parcial
  `spa_citas(horario_id) WHERE estado IN ('pendiente','confirmada')` protege
  ocupación incluso con solicitudes simultáneas. Consultar "libre" antes de
  insertar no sustituye este índice; la RPC bloquea filas y maneja
  unique_violation devolviendo `horario_ocupado`.
- RPCs revocadas de anon/authenticated/PUBLIC; solo service_role.
- spa_mutar_cita guarda evento, cita y avisos en la misma transacción.
- Reclamo con FOR UPDATE SKIP LOCKED, lease 30s, token, lote limitado,
  reintentos con estados `revision/fallida`.

## Ejecutar migración (una sola vez, desde SQL Editor)

1. Abrir Supabase -> SQL Editor.
2. Copiar/pegar contenido de `supabase/migrations/202610020001_spa.sql` y
   ejecutar.
3. Verificar: tablas creadas, funciones presentes, servicios insertados,
   horarios generados.
4. Probar `tests/integration.sql` (puede ejecutarse completo con
   BEGIN/ROLLBACK).

## Pendiente para siguiente etapa

- Implementar `supabase/functions/spa-telegram/` (index.ts, handler.ts,
  repository.ts, telegram.ts) con Deno.serve solo en index.ts.
- Ajustar/usar deno.json raíz con check/test completos y conservar tareas
  telegram:existentes.
- Validación webhook (X-Telegram-Bot-Api-Secret-Token), callbacks
  autocontenidos, permisos por user_id.
- No marcar notificación como enviada antes de ok=true; recuperación por evento
  o `/reintentar`.
- Ejecutar `deno task check` y `deno task test` tras cambios funcionales.
