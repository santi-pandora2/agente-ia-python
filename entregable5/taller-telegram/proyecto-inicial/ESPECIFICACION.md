# Bot de citas para un spa de manos y pies

## Resultado del taller

Un bot publicado recibe solicitudes, conserva citas en Supabase, permite que el responsable confirme o rechace y notifica a la clienta. La aplicación responde en español. Este es un negocio ficticio para aprendizaje.

## Decisiones del prototipo

- Nombre: Spa Manos y Pies.
- Moneda: COP. Precios ficticios: manicure 30000, pedicure 40000, manos y pies 65000.
- Para simplificar, TODOS los servicios ocupan un bloque de 60 minutos. No son duraciones reales ni una recomendación comercial.
- Una estación de atención; no se pueden ocupar simultáneamente dos servicios.
- Horarios de inicio: 09:00, 10:00, 11:00, 14:00, 15:00, 16:00. De lunes a sábado.
- Mostrar los próximos siete días de atención, excluyendo hoy. Semilla dinámica relativa al día de ejecución: nunca fechas fijas del curso.
- Guardar timestamps con zona horaria. Mostrar y calcular días en America/Bogota, no en la zona del computador ni en UTC.
- Chat privado únicamente. Responder de manera breve en grupos sin exponer datos ni ejecutar acciones.
- Nombre tomado de first_name de Telegram, máximo 80 caracteres; identificar a la persona por user_id, no por ese nombre. No pedir teléfono ni información clínica.
- Una cita activa como máximo por clienta. Cancelar para solicitar otra. Una cita pasada no debe bloquear solicitudes nuevas: la RPC cierra las citas vencidas de esa persona antes de crear una nueva.
- Estados: pendiente, confirmada, cancelada, rechazada, finalizada. Las pendientes y confirmadas ocupan el horario.
- Una solicitud pendiente se mantiene hasta confirmación, rechazo, cancelación o vencimiento del horario. No hay expiración automática a los pocos minutos.
- Reprogramar consiste en cancelar y solicitar nuevamente. Proponer otro horario consiste en rechazar con aviso e invitar a solicitar de nuevo.
- Sin IA, pagos, correo, recordatorios automáticos, campañas, agenda externa ni múltiples profesionales.

## Experiencia

`/start` y `/help` muestran [Servicios] [Agendar] [Mi cita].

Servicios muestra nombre, precio y duración. Agendar muestra servicio, día, horario y resumen con [Enviar solicitud] [Volver al inicio]. El resumen todavía NO ocupa el horario. Enviar valida de nuevo y crea una única cita pendiente. Responder con su identificador y aclarar que está pendiente de confirmación.

Mi cita muestra solamente la cita activa de quien consulta, con [Cancelar cita]. Pedir una segunda confirmación antes de cancelar. Después del cierre, permitir otra solicitud.

Cada solicitud genera un aviso privado al responsable, con [Confirmar] [Rechazar y ofrecer nueva solicitud]. Al actuar, verificar ADMIN_USER_ID, el estado actual y que el horario no haya pasado. Notificar a la clienta y mostrar al responsable el resultado.

`/pendientes` es exclusivo del responsable. Muestra hasta diez citas futuras pendientes y sus botones; si hay más, implementar paginación. `/reintentar` es exclusivo del responsable y procesa hasta diez avisos elegibles. Mostrar cantidad aceptada, fallida y pendiente de revisión; no mostrar tokens ni errores crudos del proveedor.

Textos no reconocidos: mostrar ayuda. Nunca inventar disponibilidad ni confirmar una cita desde texto libre.

## Conversación y botones

Evitar estado en memoria de la función. Preferir callbacks autocontenidos con identificadores numéricos breves; volver a consultar todos los registros. Ejemplos: servicio:1, dia:1:20261005, horario:1:25, enviar:1:25, confirmar:42, rechazar:42, cancelar:42, cancelar_ok:42.

callback_data no supera 64 bytes. Validar el formato antes de usarlo. Una persona puede manipular o pulsar un botón antiguo. Revalidar siempre. No convertir callback_data en SQL. Llamar answerCallbackQuery con timeout corto; su falla no revierte una cita ni impide procesarla.

## Arquitectura y archivos

Usar una función pública `spa-telegram` con `verify_jwt = false` en supabase/config.toml, protegida por comparación de X-Telegram-Bot-Api-Secret-Token con TELEGRAM_WEBHOOK_SECRET ANTES de leer el cuerpo. No usar un JWT de Supabase para autenticar Telegram.

Mantener index.ts como entrada y separar módulos testables dentro de esa misma carpeta. Deno.serve se registra solamente desde index.ts, no al importar las funciones en las pruebas.

Archivos que OpenCode debe crear:

```text
deno.json
deno.lock
supabase/config.toml
supabase/functions/spa-telegram/index.ts
supabase/functions/spa-telegram/deno.json
supabase/functions/spa-telegram/handler.ts
supabase/functions/spa-telegram/repository.ts
supabase/functions/spa-telegram/telegram.ts
supabase/migrations/202610020001_spa.sql
tests/handler_test.ts
tests/telegram_test.ts
tests/integration.sql
GUIA_PUBLICACION.md
evidencia/RESULTADOS.md
```

Tareas estables: `deno task check`, `deno task test`. Check cubre fuentes, scripts y tests; test usa datos ficticios y mocks sin acceso a Telegram ni Supabase. Las tareas NO cargan .env ni necesitan tokens reales. No usar --allow-all para tests.

Conservar las tareas locales existentes telegram:identificar, telegram:conectar y telegram:estado. Solo las ejecuta el estudiante en su terminal; OpenCode no debe invocarlas porque cargan configuración privada.

Colocar también el mapa de imports con versiones fijas en supabase/functions/spa-telegram/deno.json, para que el empaquetado remoto no dependa exclusivamente de la configuración de la raíz. Mantener los dos mapas coherentes o usar imports npm con versión explícita en el código. Verificar tanto el proyecto raíz como el entrypoint con la configuración de su carpeta antes de publicar.

Leer del entorno alojado SUPABASE_URL y la clave de servidor inyectada. Preferir SUPABASE_SECRET_KEYS (diccionario JSON, clave default o primera clave disponible); admitir SUPABASE_SERVICE_ROLE_KEY como respaldo. No exigir que el estudiante copie una clave de servidor a .env. SUPABASE_PUBLISHABLE_KEYS no sirve para estas RPC restringidas.

Variables personalizadas alojadas: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, ADMIN_USER_ID, ADMIN_CHAT_ID. Validar al iniciar. ADMIN_USER_ID autoriza; ADMIN_CHAT_ID indica el destino privado de avisos. No confundirlos aunque coincidan en un chat privado.

## Base de datos

Crear con migración única, sin DROP ni borrado de tablas:

| Tabla | Campos mínimos |
|---|---|
| spa_servicios | id bigint identity PK, nombre text, precio_cop integer, duracion_min integer, activo boolean |
| spa_horarios | id bigint identity PK, inicio timestamptz UNIQUE, fin timestamptz |
| spa_citas | id bigint identity PK, cliente_user_id bigint, cliente_chat_id bigint, cliente_nombre text, servicio_id FK, horario_id FK, estado text CHECK, created_at timestamptz |
| spa_eventos | update_id bigint PK, tipo text, created_at timestamptz |
| spa_notificaciones | id bigint identity PK, clave text UNIQUE, chat_id bigint, payload jsonb, estado CHECK, intentos integer, disponible_desde timestamptz, lease_hasta timestamptz nullable, lease_token uuid nullable, telegram_message_id bigint nullable, error_codigo text nullable, created_at timestamptz |

Notificaciones: pendiente, procesando, enviada, fallida, revision. Índice único parcial en spa_citas(horario_id) WHERE estado IN ('pendiente','confirmada'). Otro en cliente_user_id con la misma condición. Índices para consultas por estado y por notificaciones elegibles.

RLS habilitado en TODAS las tablas, sin políticas públicas. Revocar acceso de anon y authenticated; permitir a service_role. RPC invocables solo por service_role: REVOKE EXECUTE FROM PUBLIC, anon, authenticated y GRANT a service_role. Preferir SECURITY INVOKER. Si se necesita DEFINER, fijar search_path y nombres calificados. No poner credenciales en SQL.

Crear función de semilla `spa_generar_horarios()` invocable desde SQL Editor y por service_role. Inserta los próximos siete días de atención con ON CONFLICT DO NOTHING, en hora Bogotá. Ejecutarla al migrar y antes de mostrar disponibilidad para que el bot siga útil después de una semana. Datos de servicios idempotentes.

## Transacciones y duplicados

Crear RPC `spa_mutar_cita` con update_id, accion, actor_user_id, actor_chat_id, nombre, cita_id/servicio_id/horario_id opcionales y admin_user_id/admin_chat_id provenientes SOLO del entorno del servidor. Acciones: solicitar, confirmar, rechazar, cancelar. Nunca aceptar IDs administrativos desde el cuerpo de Telegram.

En una misma transacción: reservar update_id en spa_eventos; si ya existe, devolver resultado duplicado sin efectos; validar actor y registros; cerrar vencidas cuando corresponda; modificar cita; insertar avisos en spa_notificaciones con claves únicas. Bloquear filas al cambiar estado. Si hay conflicto de ocupación, devolver horario ocupado. Si hay conflicto de clienta activa, devolver consulta tu cita. Capturar conflictos sin dejar una reserva huérfana. Un error técnico revierte toda la transacción, incluido update_id.

Las claves de avisos incluyen cita, transición y destinatario. Ejemplo: cita:42:confirmada:cliente. Repetir evento o pulsar dos veces no crea otra cita ni otra transición. Los mensajes de navegación pueden enviarse directamente, pero si fallan deben registrar un aviso recuperable con clave derivada de update_id; no registrar el cuerpo entrante.

El webhook retorna 200 para eventos válidos ya procesados, eventos ignorados y errores de negocio. Retorna 401 para secreto incorrecto, 405 para método incorrecto, 400 para JSON/evento mal formado, 500/503 ante falla técnica ANTES de confirmar la transacción. Si la cita ya quedó guardada y falla el aviso, retorna 200 y conserva el aviso para reintentar. No borrar la cita.

## Envío y recuperación

Tras procesar un evento, esperar el procesamiento de un lote pequeño de avisos dentro de la invocación; no dejar promesas sin await. Implementar RPC de reclamación con FOR UPDATE SKIP LOCKED, lease temporal y token. Reclamar también leases vencidos. Solo el dueño del lease puede finalizar ese intento.

Usar fetch con timeout, Telegram sendMessage y validar status HTTP y JSON ok=true. Guardar message_id como aceptado por Telegram; no afirmar entrega ni lectura.

Máximo cinco intentos. Reintento con espera creciente. Respetar retry_after en 429. Error permanente, como bot bloqueado, queda fallido. Timeout o respuesta incierta queda revision para evitar repetir a ciegas; explicar la posibilidad de duplicados si una persona decide reenviar. Nunca guardar la URL completa con el token ni imprimir errores que la incluyan.

No hay worker permanente ni cron en la ruta básica. Cada evento y `/reintentar` mueve la cola. Una notificación pendiente no se enviará sola si no llega otro evento. Mostrar esa limitación en GUIA_PUBLICACION.md. Recuperación manual: responsable abre el bot y usa `/pendientes` y `/reintentar`; atender los estados revision desde SQL Editor, sin reenvío automático.

## Pruebas y evidencia

Tests unitarios con reloj fijo e interfaces inyectables de repositorio y Telegram. No prueban por sí solos Postgres, RLS ni despliegue.

tests/integration.sql debe contener una transacción BEGIN/ROLLBACK con datos ficticios, llamadas reales a RPC y aserciones que produzcan error si falla una condición. Probar reserva, repetición del mismo update_id, dos eventos diferentes para una cita activa, horario ocupado por otra persona, permisos de cancelar/confirmar, cambios repetidos de estado, liberación del horario, expiración, outbox y privilegios públicos. La semilla no puede quedar alterada. Para concurrencia real proporcionar prueba en dos sesiones con instrucciones explícitas; no afirmar que consultas secuenciales comprueban carreras.

evidencia/RESULTADOS.md distingue unitario, integración SQL, concurrencia y Telegram real. Empezar integración y Telegram como PENDIENTE. Actualizar solamente con resultados observados.
