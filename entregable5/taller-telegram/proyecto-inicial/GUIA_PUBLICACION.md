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

En Supabase → SQL Editor, aplicar la migración
`supabase/migrations/202610020001_spa.sql` (esquema, RLS, semilla y RPC).
Ejecutar `spa_generar_horarios()` antes de mostrar disponibilidad.

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

## 5. Comprobaciones posteriores

1. `/start` en chat privado muestra `[Servicios] [Agendar] [Mi cita]`.
2. Servicios muestra nombre, precio y duración (todos 60 min).
3. Agendar → servicio → día → horario. Los días y horas se muestran en hora de
   Bogotá y se excluye hoy.
4. Resumen con `[Enviar solicitud] [Volver al inicio]`; aún no ocupa horario.
   Al enviar, se indica el ID y que la cita queda **pendiente**.
5. Llega un aviso privado al responsable con `[Confirmar] [Rechazar ...]`.
   Confirmar notifica a la clienta.
6. `Mi cita` muestra solo la cita propia y `Cancelar cita` pide una segunda
   confirmación antes de liberar el horario.
7. `/pendientes` y `/reintentar` son exclusivos del responsable.
8. Un mensaje en grupo responde `Solo en chat privado.` sin datos ni acciones.
9. Un texto libre muestra la ayuda; nunca confirma desde texto.
10. En Supabase → Invocations/Logs: 401 con secreto incorrecto (sin procesar el
    cuerpo), 400 con JSON inválido, 405 con método incorrecto, 200 en eventos
    válidos.

## 6. Limitación de recuperación de avisos

No hay worker permanente ni cron en la ruta básica. Una notificación
`pendiente` **no se envía por sí sola**: la cola avanza solo cuando llega un
evento nuevo (cada invocación procesa un lote pequeño) o cuando el responsable
usa `/reintentar`. Un timeout o una respuesta incierta queda en `revision` para
no repetir a ciegas; si alguien decide reenviar, podría producirse un duplicado.
Los avisos en `revision` se atienden desde SQL Editor; no hay reenvío automático.
