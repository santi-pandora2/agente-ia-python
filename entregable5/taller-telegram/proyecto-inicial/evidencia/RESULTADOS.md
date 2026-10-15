# Resultados — Pruebas del bot (PROMPT 4)

Actualizado en esta etapa con lo **realmente ejecutado**. La integración SQL, la
concurrencia y Telegram real **no** se ejecutaron: quedan PENDIENTES.

## Comandos ejecutados

```bash
deno task check
deno task check:funcion
deno task test
```

- `deno task check`: OK. Comprueba `scripts/**`, `tests/**` y
  `supabase/functions/**` (incluye `index.ts`).
- `deno task check:funcion`: OK. Comprueba el entrypoint
  `supabase/functions/spa-telegram/index.ts` con el `deno.json` de su carpeta.
- `deno task test`: **43 aprobadas / 0 fallidas** (sin `.env`, sin tokens, sin
  `--allow-all`, sin acceso a Telegram ni a Supabase).
  - `scripts/telegram-config_test.ts`: 6 pruebas (se conserva en la suite).
  - `tests/handler_test.ts`: 29 pruebas.
  - `tests/telegram_test.ts`: 8 pruebas.

## Estado por tipo

- **Unitario**: APROBADO (43/43 con dobles de prueba y reloj fijo). No prueba
  Postgres, RLS ni despliegue.
- **Integración SQL** (`tests/integration.sql`): PENDIENTE. No ejecutado.
- **Concurrencia (2 sesiones)**: PENDIENTE. No ejecutada.
- **Telegram real**: PENDIENTE. No ejecutado.

## Escenarios unitarios cubiertos

Menú inicial; servicios; día y horario en `America/Bogota`; fecha pasada y día
de hoy excluidos; horario ocupado; cita propia; cancelación ajena; confirmación
por alguien que no es responsable; callback manipulado; callback viejo; dos
solicitudes de la misma persona; replay de `update_id` (se propaga el
`update_id` real de Telegram); doble confirmación; aviso fallido después de
guardar (la cita se conserva); HTTP 200 de Telegram con `ok=false`; 429 con
`retry_after`; timeout incierto (queda para revisión); error permanente (fallido);
lease vencido (no se marca enviado); secreto incorrecto (401); JSON inválido
(400); método incorrecto (405); mensajes de grupo; texto no reconocido;
`/pendientes` y `/reintentar` exclusivos del responsable.

Se verifica que los errores se muestran en español y son comprensibles, que
ninguna falla de envío borra la cita y que el aviso se guarda con el estado
correcto (`enviada` solo si Telegram confirma `ok=true` con `message_id`).

## Cambios de código de esta etapa

- `handler.ts`: reloj inyectable (`now`); se propaga el `update_id` real a la
  RPC (antes se usaba `Date.now()`); callbacks autocontenidos con formato
  validado (`servicio:1`, `dia:1:20261015`, `enviar:1:25`, `confirmar:42`, …) y
  longitud máxima de 64 bytes; permisos por `user_id` en el servidor; exclusión
  de hoy y de horarios pasados en Bogotá; `handleRequest` con 401/405/400/200 y
  `500` ante falla técnica antes de confirmar; procesamiento de avisos sin
  perder los pendientes por error.
- `telegram.ts`: `fetch` inyectable; `uncertain` (timeout, red, JSON ilegible) y
  `permanente` (403/bloqueado); no filtra la URL con el token.
- `repository.ts`: `finalizarNotificacion` acepta `permanente`.
- `index.ts`: valida variables al iniciar y delega en `handleRequest`;
  `Deno.serve` solo se registra aquí.
- `202610020001_spa.sql`: reserva de `update_id` con `GET DIAGNOSTICS`
  (duplicado real por evento) y parámetro `p_permanente` en
  `spa_finalizar_notificacion`.

## Notas y pendientes

- La migración de esta etapa contiene la sección de RPC. Para que
  `tests/integration.sql` sea ejecutable, el esquema (tablas, índices únicos
  parciales, RLS, semilla `spa_generar_horarios()`) debe existir en la base de
  datos antes de correr la prueba; verificar/restaurar esa sección antes de
  declarar la integración aprobada.
- La concurrencia real exige dos sesiones separadas según las instrucciones de
  `tests/integration.sql`; no se deduce de consultas secuenciales.
- Sin cron, los avisos pendientes no se envían solos: avanzan con eventos nuevos
  o con `/reintentar`. Ver `GUIA_PUBLICACION.md`.
