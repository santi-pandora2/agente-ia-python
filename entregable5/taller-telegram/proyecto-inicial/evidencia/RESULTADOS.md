# Resultados — Pruebas del bot (PROMPT 4 y PROMPT 5)

Actualizado en esta etapa con lo **realmente ejecutado**. La integración SQL y
la concurrencia se ejecutaron contra un PostgreSQL local real. La publicación
en Supabase y el Telegram real siguen **PENDIENTES** (requieren credenciales y
la terminal del estudiante).

Las secciones separan explícitamente dos fuentes de verdad:

- **Ejecutado por OpenCode (agente)**: verificado en esta sesión con
  comandos, código y salidas observables.
- **Observado por el estudiante (usuario)**: requiere el bot publicado y
  credenciales reales; no lo puede verificar el agente.

## Estado de las observaciones manuales del estudiante

El listado de observaciones manuales llegó con los campos **sin completar**
(`[APROBADA o ERROR observado]`, `[resultado]`, `[NO EJECUTADA]`, etc.), es
decir, el estudiante no reportó el resultado real de ninguna prueba manual.
Por eso, en este documento esas filas quedan como **NO REPORTADO** y no se
inventan resultados. Deben completarse después de republicar la función
(sección "Pruebas manuales pendientes").

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
- `deno task test`: **58 aprobadas / 0 fallidas** (sin `.env`, sin tokens, sin
  `--allow-all`, sin acceso a Telegram ni a Supabase).
  - `scripts/telegram-config_test.ts`: 6 pruebas (se conserva en la suite).
  - `tests/handler_test.ts`: 44 pruebas.
  - `tests/telegram_test.ts`: 8 pruebas.

## Integración SQL (ejecutada)

PostgreSQL 17.11 real (binarios portable de `embedded-postgres-binaries`,
17.11.0) en `127.0.0.1:54329`, con los roles `anon`, `authenticated` y
`service_role` creados para replicar los roles de Supabase. Scripts de apoyo
en `.supabase/pg/` (ignorado por Git).

```bash
# Base limpia: se recrea el esquema public y se aplican las migraciones
deno run -A run.ts reset.sql 00_roles.sql \
  ../../supabase/migrations/202610020001_spa.sql \
  ../../supabase/migrations/202610030001_spa_base_datos.sql

# Suite de integración
deno run -A run.ts ../../tests/integration.sql
```

Resultados:

- `202610020001_spa.sql` sobre base vacía: **OK**, `horarios_creados: 42`.
- `202610020001_spa.sql` reaplicada: **OK**, `horarios_creados: 0`
  (idempotente, no duplica objetos ni filas).
- `202610030001_spa_base_datos.sql` reaplicada: **OK**, `horarios_creados: 0`.
- `tests/integration.sql`: **13/13 aserciones OK** (el script hace `ROLLBACK`
  al final, no deja datos).

Los tres órdenes de aplicación se probaron sobre una base limpia:

| Escenario | Secuencia | Resultado |
|---|---|---|
| Base vacía (equivalente a la base dañada) | `202610030001` → `202610020001` | 42 → 0 horarios, 13/13 aserciones |
| Base nueva | `202610020001` → `202610030001` | 42 → 0 horarios, 13/13 aserciones |
| Idempotencia total | `202610020001` → `202610030001` → `202610020001` → `202610030001` | 42 → 0 → 0 → 0 horarios, 13/13 aserciones |

Semilla verificada: 42 horarios = 7 días × 6 franjas (09:00, 10:00, 11:00,
14:00, 15:00, 16:00 en `America/Bogota`), 1 hora cada uno, 0 domingos,
3 servicios activos.
- Privilegios verificados con `has_function_privilege` /
  `has_table_privilege`: `service_role` tiene `EXECUTE` en las RPC y
  `SELECT,INSERT,UPDATE,DELETE` en las tablas; `anon` y `authenticated` no
  tienen `EXECUTE` en las RPC ni `SELECT` en las tablas.

## Concurrencia (ejecutada con dos sesiones reales)

`deno run -A concurrencia.ts` — dos conexiones simultáneas a la misma base,
sin dobles de prueba:

- La sesión B **queda bloqueada** mientras la sesión A no confirma
  (`SELECT … FOR UPDATE` sobre el horario) → **PASA**.
- Al confirmar A, B recibe `horario_ocupado` → **PASA**.
- El horario queda con **una sola** cita activa → **PASA**.
- Dos sesiones con el mismo `update_id` producen `ok` y `duplicado`, y el
  evento queda reservado **una sola vez** → **PASA**.

## Estado por tipo

- **Unitario**: APROBADO (58/58 con dobles de prueba y reloj fijo). No prueba
  Postgres, RLS ni despliegue.
- **Integración SQL** (`tests/integration.sql`): APROBADO contra PostgreSQL
  17.11 local. No ejecutada contra Supabase.
- **Concurrencia (2 sesiones)**: APROBADO con dos sesiones reales sobre
  PostgreSQL local. No ejecutada contra Supabase.
- **Telegram real**: PENDIENTE. No ejecutado (requiere el token del bot).
- **Publicación en Supabase**: PENDIENTE. No ejecutado (requiere credenciales
  y la terminal del estudiante).

## Revisión de PROMPT 5: defectos hallados y corregidos

Todo lo de esta sección fue **ejecutado y verificado por OpenCode (agente)** en
PostgreSQL local y con dobles de prueba. Las correcciones son solo de
TypeScript: **no hay cambios de SQL**, por lo que no hace falta repetir
`supabase db push` por esta etapa.

| Id | Defecto | Comportamiento antes | Corrección | Verificación |
|---|---|---|---|---|
| D1 | Callback de un grupo (botón reenviado) se ejecutaba igual que en privado | Podía confirmar, cancelar o exponer datos de una cita en un grupo | `handleCallback` rechaza `chat.type !== "private"` con "Solo en chat privado." y no ejecuta ninguna acción | 2 pruebas nuevas: no confirma, no cancela |
| D2 | `enviar` con servicio inexistente terminaba en error técnico (HTTP 500) | `spa_mutar_cita` lanzaba `servicio_inactivo_o_inexistente` y el webhook respondía 500 | `enviarSolicitud` revalida el servicio en el servidor y responde "Ese servicio no está disponible. Vuelve a agendar." (error de negocio, HTTP 200) | 1 prueba nueva: mensaje de negocio y **sin** llamar la RPC |
| D3 | `/pendientes` listaba citas de horarios ya vencidos | Podía ofrecer confirmar una cita cuyo horario ya pasó | Filtro en dos capas: `repository.getPendientes` solo trae horarios con `inicio > now()` y `showPendientes` descarta los ya iniciados | 1 prueba nueva + integración SQL |
| D4 | Un mensaje de navegación que fallaba al enviarse se perdía (error 500, sin registro) | El mensaje no quedaba en ningún lado y la respuesta era 500 | `enviarDirecto` captura el fallo y deja un aviso recuperable con clave `navegacion:<update_id>:<n>` en `spa_notificaciones` (`estado 'pendiente'`, espera 15 s, `ignoreDuplicates`) | 1 prueba nueva + prueba SQL del insert con deduplicación |

Detalles de implementación:

- `handler.ts`: helper exportado `enviarDirecto(ctx, chatId, text, reply_markup?)`.
  Se usa en **todos** los mensajes de navegación y de resultado. El cuerpo
  entrante de Telegram **no** se registra; solo el texto saliente que no se
  pudo enviar (truncado a 4000 caracteres).
- `handler.ts`: `handleUpdate` fija `ctx.update_id` y `ctx.contAvisos` en cada
  invocación (no hay estado compartido entre eventos).
- `handler.ts`: `formatNotif` reconoce el tipo de aviso `navegacion`.
- `repository.ts`: nuevo método `registrarAvisoNavegacion` (`upsert` con
  `onConflict: "clave"` e `ignoreDuplicates: true`) y filtro de citas futuras
  en `getPendientes`.
- `tests/handler_test.ts`: 5 pruebas nuevas (2 de grupo, 1 de servicio
  inexistente, 1 de aviso de navegación, 1 de `/pendientes` sin citas
  vencidas) y `FakeRepo.registrarAvisoNavegacion`.

Comprobación del aviso de navegación contra PostgreSQL local (equivalente
exacto del `upsert`): la fila queda `estado 'pendiente'`, `intentos 0`, y el
segundo `insert` con la misma clave no crea otra fila
(`on conflict (clave) do nothing`); además **no** es elegible de inmediato
(`spa_reclamar_notificaciones` no la devuelve hasta que pasan los 15 s).

## Revisión del flujo de inicio (segunda ronda)

Revisión punto por punto del recorrido `/start` → Servicios → Agendar → día →
horario → resumen → Enviar → Mi cita → Cancelar, comparando con
`ESPECIFICACION.md`. Todo lo de esta sección fue **ejecutado y verificado por
OpenCode (agente)**. Son correcciones solo de TypeScript: **no hay cambios de
SQL**, así que no hace falta repetir `supabase db push`.

| Id | Defecto | Comportamiento antes | Corrección | Verificación |
|---|---|---|---|---|
| E1 | Se podían offered más de siete días de atención | `getHorariosProximos` traía hasta 70 filas y el handler agrupaba **todos** los días; como `spa_horarios` **acumula** filas, tras varios días de uso el bot ofrecía los días 8, 9, 10… | `elegirHorario` recorta a los primeros `DIAS_ATENCION = 7` días de atención; un callback a un día fuera de la ventana responde "Ese día ya no está disponible" | 2 pruebas nuevas; comprobado en PostgreSQL local (tabla con 10 días → el bot ofrece 7) |
| E2 | La consulta de horarios usaba un desfase fijo `-05:00` | `gt("inicio", "<hoy>T23:59:59.999-05:00")` calculaba el corte a mano y dependía de la zona horaria del equipo | La consulta usa `inicio > now()`; el corte de "excluye hoy" y la ventana de 7 días los aplica el handler con el reloj de Bogotá | Re-ejecución de la suite y del SQL de integración |
| E3 | "Mi cita" mostraba como vigente una cita ya vencida | Mostraba `Estado: pendiente` con un horario pasado y ofrecía "Cancelar cita" | Se marca como no vigente ("el horario ya pasó") y se ofrece [Agendar] para pedir otro horario | 1 prueba nueva |
| E4 | "Cancelar cita" pedía la confirmación sin comprobar la pertenencia | Un `callback_data` manipulado `cancelar:<id ajena>` hacía que el bot pidiera confirmar la cancelación de otra persona | `pedirCancelar` revalida por `user_id` en el servidor: "No autorizado." y sin botón de confirmación | 1 prueba nueva |
| E5 | El responsable veía el texto dirigido a la clienta | Al confirmar una cita vencida, el responsable leía "Ese horario ya pasó. Elige otro horario." | `mensajeResultado` distingue la audiencia: el responsable ve "El horario de la cita 7 ya pasó: la cita se cerró y no se confirmó." | 1 prueba nueva |
| E6 | El botón de día mostraba la fecha en ISO | "2026-10-15" | Etiqueta legible calculada sobre el calendario (sin corrimiento por zona horaria): "jue 15 oct" | 1 prueba nueva (actualizada) |
| E7 | Sin servicios activos se mostraba una lista vacía | "Servicios (todos de 60 minutos):" sin nada | Mensaje claro "No hay servicios disponibles por ahora." | Cubierto por el código, sin prueba propia |

Comprobación de la acumulación en PostgreSQL local (la tabla real, no un doble):

```sql
-- tras insertar días extra (simula el uso de varios días)
select count(distinct (inicio at time zone 'America/Bogota')::date)
  from spa_horarios where inicio > now();   -- 10
select count(*) from (select id from spa_horarios
  where inicio > now() order by inicio limit 84) t;  -- 60 filas
```

La consulta del repositorio trae los diez días; el handler recorta la
ventana a los siete primeros días de atención. Se limpiaron después las filas
extra para dejar la base local como estaba.

## Re-ejecución de la suite después de las correcciones

```bash
deno task check          # OK
deno task check:funcion  # OK
deno task test           # 58 aprobadas / 0 fallidas

# Base limpia + migraciones
deno run -A run.ts reset.sql 00_roles.sql \
  ../../supabase/migrations/202610020001_spa.sql \
  ../../supabase/migrations/202610030001_spa_base_datos.sql
# 202610020001 -> horarios_creados: 42 ; 202610030001 -> horarios_creados: 0

deno run -A run.ts ../../tests/integration.sql   # 13/13 aserciones OK
deno run -A concurrencia.ts                      # CONCURRENCIA: OK (5/5)
```

## Pruebas manuales pendientes (las ejecuta el estudiante)

Ninguna de estas puede ejecutarlas el agente: requieren el bot publicado, el
token real y credenciales de Supabase. Columna de estado para llenar:

| Escenario | Estado |
|---|---|
| Menú y servicios en Telegram | NO REPORTADO |
| Solicitar, confirmar, consultar, cancelar y rechazar | NO REPORTADO |
| Doble clic y permisos (callback manipulado, no responsable) | NO REPORTADO |
| Horario ocupado con dos clientas | NO REPORTADO |
| Bloquear el bot y confirmar (estado de la cita y del aviso) | NO REPORTADO |
| Callback desde un grupo (mensaje reenviado) | NO REPORTADO — nuevo, D1 |
| `enviar` con servicio inexistente (callback manipulado) | NO REPORTADO — nuevo, D2 |
| `/pendientes` con una cita ya vencida | NO REPORTADO — nuevo, D3 |
| Mensaje de navegación que no se pudo enviar (aviso recuperable) | NO REPORTADO — nuevo, D4 |
| Agendar ofrece como máximo siete días de atención | NO REPORTADO — nuevo, E1 |
| "Mi cita" de una cita cuyo horario ya pasó | NO REPORTADO — nuevo, E3 |
| Etiqueta del día en el menú de días | NO REPORTADO — nuevo, E6 |

## Qué debe rehacer el estudiante tras estas correcciones

1. **Publicar de nuevo la función** (el código TypeScript cambió):

   ```bash
   supabase functions deploy spa-telegram
   ```

   Es el comando de publicación de la sección 4 de `GUIA_PUBLICACION.md`
   (el paso 13 de la lista de publicación). Si el comando no pide
   `--no-verify`, verificar que la verificación de Deno pase en la salida.
2. **No repetir el SQL**: esta etapa no cambió migraciones. Las dos
   migraciones siguen siendo las de PROMPT 4.
3. **No volver a registrar el webhook**: la URL pública y el secreto no
   cambiaron, así que el webhook ya apunta a la misma función. Solo si cambia
   la URL o el secreto, repetir el registro (`deno task telegram:conectar`,
   sección 4 de `GUIA_PUBLICACION.md`).
4. **Repetir los flujos de Telegram afectados** por D1, D2, D3, D4, E1, E3 y
   E6 (tabla anterior). Los demás flujos no se ven afectados por el cambio.
5. **Anotar los resultados** en la tabla de la sección anterior, replacing
   `NO REPORTADO` por `APROBADA` o el error observado.

En el flujo de inicio, la comprobación clave es que **Agendar** muestre como
mucho siete días de atención (de mañana al séptimo día, sin hoy) y que la
etiqueta de cada día sea legible (por ejemplo "jue 15 oct").

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
`/pendientes` y `/reintentar` exclusivos del responsable; botones
`[Confirmar] [Rechazar]` en el aviso al responsable; teclado manipulado
descartado; aviso recuperable cuenta como `reintentable`; aviso incierto
cuenta como `en revisión` y se marca `incierto` en la RPC; `/reintentar`
informa los reintentables; callback en un grupo no confirma ni cancela;
servicio inexistente en `enviar` es error de negocio y no llama la RPC; un
mensaje de navegación fallido queda como aviso recuperable con clave
`navegacion:<update_id>:<n>` y sin el cuerpo entrante; `/pendientes` excluye
citas cuyo horario ya pasó; se ofrecen solo siete días de atención; un día
fuera de esa ventana ya no está disponible; el día se muestra con etiqueta
legible ("jue 15 oct"); "Mi cita" con horario vencido no ofrece cancelar y
ofrece agendar; la cancelación se revalida por `user_id` antes de pedir la
confirmación; el responsable recibe un texto propio cuando la cita está
vencida.

Se verifica que los errores se muestran en español y son comprensibles, que
ninguna falla de envío borra la cita y que el aviso se guarda con el estado
correcto (`enviada` solo si Telegram confirma `ok=true` con `message_id`).

## Cambios de código de esta etapa

- `202610020001_spa.sql`: reescrita como migración canónica autónoma. Incluye
  las tablas que faltaban (`spa_servicios`, `spa_horarios`, `spa_citas`,
  `spa_eventos`, `spa_notificaciones`), los índices (incluidos los índices
  únicos parciales `spa_citas_ocupacion_idx` y `spa_citas_cita_activa_idx`),
  RLS sin políticas, `revoke` a `anon`/`authenticated` y `grant` a
  `service_role`, la semilla de servicios, `spa_generar_horarios(p_dias)` y las
  RPC. Se eliminan las sobrecargas antiguas de `spa_mutar_cita`,
  `spa_finalizar_notificacion`, `spa_reclamar_avisos` y `spa_finalizar_aviso`.
  - `spa_mutar_cita`: el responsable se valida en el servidor
    (`p_actor_user_id is distinct from p_admin_user_id` → `no_autorizado`); el
    `unique_violation` del horario se captura dentro de un bloque interno para
    no perder la reserva del `update_id`; las comparaciones de instantes usan
    `now()` (timestamptz) y no `now() at time zone`.
  - `spa_reclamar_notificaciones`: recupera los leases vencidos y exige
    `intentos < 5`.
  - `spa_finalizar_notificacion`: nuevo parámetro `p_incierto` y cuatro
    desenlaces (`enviada`, `fallida`, `revision`, `pendiente` con espera
    creciente 15/30/60/120 s, tope 300 s, respetando `retry_after`).
  - El aviso al responsable incluye el teclado `[Confirmar] [Rechazar y ofrecer
    nueva solicitud]` dentro del payload; los `callback_data` se revalidan en
    el servidor.
- `202610030001_spa_base_datos.sql` (nueva): migración incremental idempotente
  que asegura esquema, índices, RLS, permisos y semilla **sin** recrear las
  RPC, elimina las sobrecargas obsoletas y reasigna los `grant` a
  `service_role` de forma condicional.
- `handler.ts`: `formatNotif` devuelve texto **y** teclado; el teclado del
  payload solo se acepta si `parseCallback` lo reconoce (un `callback_data`
  manipulado se descarta); `ResultadoAvisos` suma `reintentables` y
  `/reintentar` los informa; los fallos de envío distinguen recuperable
  (reintentable), permanente (fallida) e incierto (revisión).
- `repository.ts`: `finalizarNotificacion` acepta `incierto` y envía
  `p_incierto` a la RPC.
- `tests/handler_test.ts`: 5 pruebas nuevas (botones del aviso, teclado
  manipulado, reintentable, incierto y reporte de `/reintentar`).
- `tests/integration.sql`: reescrito con el helper `pg_temp.spa_assert` (el
  build local no trae `assert()`), permisos del responsable, cambio de estado
  repetido, horario vencido, semántica de reintento, propiedad del lease y
  aserciones reales de privilegios.
- `GUIA_PUBLICACION.md`: orden de migraciones, comprobaciones de privilegios,
  cómo ejecutar `tests/integration.sql` y tabla de desenlaces de la cola.

### Cambios de código de PROMPT 5 (revisión)

- `handler.ts`:
  - `enviarDirecto` (nuevo, exportado): envío directo con captura de fallas;
    si el envío falla deja un aviso recuperable con clave
    `navegacion:<update_id>:<n>`. Se usa en todas las pantallas y mensajes de
    resultado.
  - `handleCallback` rechaza callbacks cuyo chat no sea privado.
  - `enviarSolicitud` revalida el servicio y responde error de negocio
    (no 500) si el servicio no existe o está inactivo.
  - `showPendientes` filtra citas con horario ya iniciado o inexistente.
  - `handleUpdate` fija `ctx.update_id` y `ctx.contAvisos` por invocación.
  - `formatNotif` reconoce el tipo de aviso `navegacion`.
- `repository.ts`:
  - `registrarAvisoNavegacion` (nuevo): `upsert` en `spa_notificaciones` con
    `onConflict: "clave"` e `ignoreDuplicates: true`, `estado 'pendiente'`,
    `intentos 0` y espera de 15 s.
  - `getPendientes` solo trae citas con horario futuro (`inicio > now()`).
- `tests/handler_test.ts`: 5 pruebas nuevas (2 de grupo, 1 de servicio
  inexistente, 1 de aviso de navegación, 1 de `/pendientes` sin citas
  vencidas) y `FakeRepo.registrarAvisoNavegacion`.
- `evidencia/RESULTADOS.md`: separación entre lo ejecutado por el agente y lo
  observado por el estudiante, tabla de defectos corregidos y lista de pasos
  pendientes para el estudiante.
- `GUIA_PUBLICACION.md`: se documenta que un mensaje de navegación fallido
  queda como aviso recuperable y que hay que republicar la función.

### Segunda ronda (revisión del flujo de inicio)

- `handler.ts`:
  - `DIAS_ATENCION = 7`: `elegirHorario` recorta la ventana a los primeros
    siete días de atención y rechaza callbacks de días fuera de la ventana.
  - `fmtDiaBogota`: etiqueta legible del día ("jue 15 oct") calculada sobre el
    calendario, sin corrimiento por la zona horaria del equipo.
  - `showMiCita`: una cita cuyo horario ya pasó se muestra como no vigente y
    ofrece [Agendar] en lugar de [Cancelar cita].
  - `pedirCancelar`: revalida por `user_id` que la cita sea de quien pulsa.
  - `mensajeResultado`: distingue el texto del responsable del texto de la
    clienta (casos "vencida" y "estado_invalido").
  - `showServicios` / `showAgendar`: mensaje claro cuando no hay servicios
    activos.
- `repository.ts`: `getHorariosProximos` usa `inicio > now()` (sin desfase
  fijo `-05:00`) y un límite de filas holgado; el corte de días lo aplica el
  handler.
- `tests/handler_test.ts`: 5 pruebas nuevas (ventana de siete días, día fuera
  de la ventana, cita vencida en "Mi cita", pertenencia en "Cancelar cita",
  texto propio del responsable) y actualización de la prueba de etiquetas.

## Notas y pendientes

- **Credencial expuesta (repetida)**: durante esta sesión, `.env.example` —que
  **sí** está versionado— volvió a quedar con el token real de Telegram, el
  secreto del webhook y la URL del proyecto (copiados desde `.env`). Se
  restauraron los marcadores `REEMPLAZAR` y se comprobó que:
  - el token **no** está en el historial de Git
    (`git log --all -p | grep -cE "TELEGRAM_BOT_TOKEN=[0-9]+:..."` → 0);
  - ningún archivo versionado contiene un token o secreto con forma real
    (`git grep -lIE ...` → ninguno);
  - `.env` **sí** está ignorado por Git (`.gitignore:1`).
  Aun así, el token debe considerarse comprometido: hay que revocarlo con
  BotFather (`/revoke`) y generar uno nuevo antes de publicar, y no volver a
  copiar `.env` sobre `.env.example`.
- Las pruebas de integración y concurrencia se hicieron contra PostgreSQL
  17.11 local, **no** contra Supabase. Antes de declarar la entrega completa
  hay que repetir `supabase db push` (o pegar las dos migraciones en el SQL
  Editor) y volver a correr `tests/integration.sql` en la base real.
- No hay `psql` ni `supabase` CLI en este entorno: el estudiante ejecuta esas
  partes en su terminal.
- Sin cron, los avisos pendientes no se envían solos: avanzan con eventos nuevos
  o con `/reintentar`. Ver `GUIA_PUBLICACION.md`.
- Los envíos a Telegram no tienen garantía de exactamente una vez: un aviso en
  `revision` reenviado a mano puede llegar dos veces.
- Tras las correcciones de PROMPT 5 el código cambió, así que la función
  publicada en Supabase está **desactualizada** hasta que el estudiante corra
  `supabase functions deploy spa-telegram` (sección 4 de `GUIA_PUBLICACION.md`).
  Con la misma URL y el mismo secreto **no** hace falta volver a registrar el
  webhook.
- Las observaciones manuales del estudiante llegaron sin completar, así que
  esta etapa **no** declara ninguna prueba de Telegram real como aprobada:
  lo aprobado es lo verificado con dobles de prueba y PostgreSQL local.
