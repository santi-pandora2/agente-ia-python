# Guía de publicación — Spa Manos y Pies

Esta guía la ejecuta el estudiante en su terminal. No contiene secretos: los
valores se escriben en privado y nunca se pegan en OpenCode ni en el repositorio.

## 1. Variables de entorno

### Entorno alojado de la función (Supabase)

| Variable | Para qué sirve | Quién la define |
|---|---|---|
| `SUPABASE_URL` | URL del proyecto | Inyectada por Supabase; no copiarla a `.env` |
| `SUPABASE_SECRET_KEYS` | Diccionario JSON de claves de servidor; se usa `default` o la primera | Inyectada por Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Respaldo si no existe `SUPABASE_SECRET_KEYS` | Inyectada por Supabase |
| `TELEGRAM_BOT_TOKEN` | Token del bot entregado por BotFather | Secreto propio |
| `TELEGRAM_WEBHOOK_SECRET` | Secreto del webhook, 32–256 caracteres `[A-Za-z0-9_-]` | Secreto propio |
| `ADMIN_USER_ID` | `user_id` numérico del responsable; **autoriza** las acciones | Obtenido con `telegram:identificar` |
| `ADMIN_CHAT_ID` | Chat privado donde llegan los avisos | Obtenido con `telegram:identificar` |

`ADMIN_USER_ID` y `ADMIN_CHAT_ID` no se confunden aunque en un chat privado
coincidan. No usar `SUPABASE_PUBLISHABLE_KEYS`: no sirve para estas RPC
restringidas.

### Scripts locales (solo para conectar el webhook)

En un archivo `.env` privado (fuera de Git), a partir de `.env.example`:

| Variable | Valor |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Token del bot |
| `TELEGRAM_WEBHOOK_SECRET` | El mismo secreto del entorno alojado |
| `TELEGRAM_WEBHOOK_URL` | `https://<proyecto>.supabase.co/functions/v1/spa-telegram` |

## 2. Función y ruta

- Carpeta: `supabase/functions/spa-telegram`
- Entrada: `index.ts` (registra `Deno.serve`; los demás módulos son testables y
  no lo hacen al importarse).
- Ruta pública: `https://<proyecto>.supabase.co/functions/v1/spa-telegram`
- `verify_jwt = false` en `supabase/config.toml`. La protección real es comparar
  `X-Telegram-Bot-Api-Secret-Token` con `TELEGRAM_WEBHOOK_SECRET` **antes** de
  leer el cuerpo. No se usa un JWT de Supabase para autenticar a Telegram.
- Los dos `deno.json` (raíz y `supabase/functions/spa-telegram/`) fijan
  `@supabase/supabase-js@2.117.2` para que el empaquetado remoto no dependa solo
  de la configuración raíz.

## 3. Antes de publicar

```bash
deno task check
deno task test
deno task check:funcion
```

### 3.1 Migraciones de base de datos (en este orden)

Ambas migraciones son **idempotentes**: se pueden aplicar más de una vez sin
duplicar objetos ni datos, y ninguna borra tablas ni filas existentes.

| Orden | Archivo | Qué hace |
|---|---|---|
| 1 | `supabase/migrations/202610020001_spa.sql` | Migración canónica: tablas, índices, RLS, permisos, semilla de servicios, generador de horarios y las RPC (`spa_mutar_cita`, `spa_reclamar_notificaciones`, `spa_finalizar_notificacion`) |
| 2 | `supabase/migrations/202610030001_spa_base_datos.sql` | Migración incremental de reparación: asegura esquema, índices, RLS, permisos y semilla **sin** recrear las RPC; elimina las sobrecargas antiguas de las funciones y reasigna los `grant` a `service_role` |

En Supabase → SQL Editor se aplican en el orden indicado, o con el CLI:

```bash
supabase db push
```

Si la base ya estaba publicada con una versión anterior que falló, aplicar la
migración 2 primero deja el esquema en pie y la 1 termina de completarlo; el
orden inverso también funciona porque ambas son idempotentes.

Después de aplicar, ejecutar el generador de horarios (si la siembra no los
incluye ya):

```sql
select public.spa_generar_horarios();
```

### 3.2 Comprobación rápida del esquema

```sql
-- Debe devolver true
select has_function_privilege(
  'service_role',
  'public.spa_mutar_cita(bigint,text,bigint,bigint,text,bigint,bigint,bigint,bigint,bigint)',
  'EXECUTE');

-- Debe devolver false: los clientes anónimos no ejecutan las RPC
select has_function_privilege(
  'anon',
  'public.spa_mutar_cita(bigint,text,bigint,bigint,text,bigint,bigint,bigint,bigint,bigint)',
  'EXECUTE');

-- Debe devolver 42 en la primera carga (7 días × 6 horas)
select count(*) from public.spa_horarios;
```

### 3.3 Pruebas de integración contra la base real

`tests/integration.sql` es un script SQL que se puede pegar en Supabase → SQL
Editor (usa `pg_temp.spa_assert`, que se crea y se descarta dentro del
script). Comprueba permisos del responsable, cambios de estado repetidos,
horarios vencidos, semántica de reintentos, propiedad del lease y los
privilegios reales de `anon`, `authenticated` y `service_role`.

```bash
# Con psql (si el estudiante lo tiene instalado)
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/integration.sql
```

El script no deja datos: trabaja dentro de una transacción y hace `ROLLBACK`
al final.

## 4. Publicar

Los ejecuta el estudiante en su terminal:

```bash
supabase secrets set TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... \
  ADMIN_USER_ID=... ADMIN_CHAT_ID=...

supabase functions deploy spa-telegram

deno task telegram:identificar   # obtiene ADMIN_USER_ID y ADMIN_CHAT_ID
deno task telegram:conectar      # registra la URL y el secret_token
deno task telegram:estado        # comprueba el webhook
```

### 4.1 Si se corrigió el código de la función

Cada vez que se cambie el TypeScript hay que **volver a publicar**:

```bash
supabase functions deploy spa-telegram
```

No hace falta repetir `supabase db push` si no cambiaron las migraciones, ni
volver a registrar el webhook si la URL y el secreto siguen igual: el webhook
ya apunta a la misma función. Solo se repite `telegram:conectar` si cambió la
URL o el secreto.

## 5. Comprobaciones posteriores

1. `/start` en chat privado muestra `[Servicios] [Agendar] [Mi cita]`.
2. Servicios muestra nombre, precio y duración (todos 60 min).
3. Agendar → servicio → día → horario. Los días y horas se muestran en hora de
   Bogotá, se excluye hoy y se ofrecen **como máximo siete días de atención**
   (de mañana al séptimo día, con etiqueta legible tipo "jue 15 oct").
4. Resumen con `[Enviar solicitud] [Volver al inicio]`; aún no ocupa horario.
   Al enviar, se indica el ID y que la cita queda **pendiente**.
5. Llega un aviso privado al responsable con `[Confirmar] [Rechazar ...]`.
   Confirmar notifica a la clienta.
6. `Mi cita` muestra solo la cita propia y `Cancelar cita` pide una segunda
   confirmación antes de liberar el horario. Si el horario de la cita ya pasó,
   la cita se muestra como no vigente y se ofrece `Agendar` para pedir otro.
7. `/pendientes` y `/reintentar` son exclusivos del responsable.
8. Un mensaje en grupo responde `Solo en chat privado.` sin datos ni acciones.
9. Un texto libre muestra la ayuda; nunca confirma desde texto.
10. En Supabase → Invocations/Logs: 401 con secreto incorrecto (sin procesar el
    cuerpo), 400 con JSON inválido, 405 con método incorrecto, 200 en eventos
    válidos.
11. Un botón reenviado en un grupo (o pulsado por otra persona) responde
    `Solo en chat privado.` y **no** confirma ni cancela nada.
12. Un `callback_data` manipulado con un servicio inexistente responde
    `Ese servicio no está disponible. Vuelve a agendar.` y la cita no se crea.
13. `/pendientes` solo lista citas cuyo horario sigue en el futuro.
14. Si un mensaje de navegación no se puede enviar (por ejemplo, la clienta
    bloqueó el bot), queda un aviso recuperable en `spa_notificaciones` con
    `clave = 'navegacion:<update_id>:<n>'`; se reintenta con `/reintentar`.

## 6. Limitación de recuperación de avisos

No hay worker permanente ni cron en la ruta básica. Una notificación
`pendiente` **no se envía por sí sola**: la cola avanza solo cuando llega un
evento nuevo (cada invocación procesa un lote pequeño) o cuando el responsable
usa `/reintentar`. Un timeout o una respuesta incierta queda en `revision` para
no repetir a ciegas; si alguien decide reenviar, podría producirse un duplicado.
Los avisos en `revision` se atienden desde SQL Editor; no hay reenvío automático.

La cola usa tres desenlaces distintos según lo que responda Telegram:

| Situación | Estado del aviso | Comportamiento |
|---|---|---|
| `ok=true` con `message_id` | `enviada` | Solo entonces se marca como enviada |
| Error recuperable (5xx, 429) | `pendiente` | Vuelve a la cola con espera creciente (15 s, 30 s, 60 s, 120 s; tope 300 s) y respeta `retry_after` |
| Error permanente (bot bloqueado, chat no encontrado) | `fallida` | No se reintenta automáticamente |
| Timeout o respuesta incierta | `revision` | No se reenvía a ciegas: puede haberse entregado |

`/reintentar` informa el resultado del lote: `aceptadas`, `fallidas`,
`en revisión` y `reintentables`. El máximo es 5 intentos por aviso; después de
eso el aviso queda en `revision`. Los envíos a Telegram **no** tienen garantía
de exactamente una vez: el diseño evita duplicar por reintento automático, pero
un aviso en `revision` reenviado a mano puede llegar dos veces.

### 6.1 Avisos de mensajes que no se pudieron enviar

Además de los avisos al responsable, la cola guarda un tipo de aviso
`navegacion`: son los mensajes directedos a la clienta (menú, servicios,
horarios, resumen, resultado) que **fallaron** al enviarse. Se guardan con
clave `navegacion:<update_id>:<n>`, `estado 'pendiente'` y una espera de 15 s
antes de volver a la cola. Como la clave deriva del `update_id`, un mismo
mensaje no se duplica en la cola.

Solo se guarda el **texto saliente** que no se pudo enviar (truncado a 4000
caracteres); nunca se guarda el cuerpo del mensaje entrante de Telegram.
