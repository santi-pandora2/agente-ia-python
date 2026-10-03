# Resultados de las pruebas

Actualiza este archivo solo con resultados observados. Si algo no lo has
ejecutado tú, déjalo en PENDIENTE: no se publica nada hasta que el proyecto
real y Telegram real estén verificados.

Negocios, precios e identidades son ficticios. No hay tokens ni datos
personales en este repositorio.

## 1. Unitario (dobles de prueba, sin red y sin base de datos)

Qué cubre: lógica del manejador y del cliente de Telegram con reloj fijo e
interfaces inyectadas. NO cubre Postgres, RLS, despliegue ni Telegram real.

| Comando | Qué incluye | Resultado observado |
|---|---|---|
| `deno task check` | `scripts/`, `tests/`, `supabase/functions/` | APROBADO |
| `deno task test` | `tests/*_test.ts` y `scripts/*_test.ts` | 6 pruebas, 0 fallidas |

Detalle de la última ejecución:

- `deno task check` = `deno check "scripts/**/*.ts" "tests/**/*.ts" "supabase/functions/**/*.ts"`.
  Revisó `scripts/telegram-config.ts` y `scripts/telegram-config_test.ts`.
- `deno task test` = `deno test "tests/**/*.ts" "scripts/**/*.ts"`.
  6 pruebas de `scripts/telegram-config_test.ts`, todas aprobadas:
  identificar separa el usuario del chat y omite grupos; identificar no elimina
  un webhook existente; conectar envía el secreto como parámetro y restringe
  eventos; validación falla antes de enviar si falta token o la URL es
  incorrecta; no expone URLs con tokens cuando fetch falla; HTTP 200 con
  ok=false no es un éxito.

Pendiente de esta etapa:

- `tests/handler_test.ts` y `tests/telegram_test.ts` todavía no existen: son de
  la etapa siguiente, junto con la función. Hasta entonces `deno task test` solo
  corre las 6 pruebas de los scripts de configuración.
- `deno task check:funcion` fallará hasta que exista
  `supabase/functions/spa-telegram/index.ts`.

## 2. Integración SQL

Qué cubre: migración, tablas, índices, RLS, privilegios, RPC, deduplicación,
ocupación, permisos, transiciones, vencimiento y cola de avisos con lease.

### 2.1 PostgreSQL local, sin Supabase — EJECUTADO

Para no entregar SQL sin comprobar, se levantó un PostgreSQL 18 local
temporal, se aplicó la migración y se ejecutó `tests/integration.sql` completo.
Lo observado:

| Comprobación | Resultado observado |
|---|---|
| `supabase/migrations/202610020001_spa.sql` aplicada | Sin error |
| Servicios de la semilla | 3 (Manicure 30000, Pedicure 40000, Manos y pies 65000) |
| Horarios generados por `spa_generar_horarios()` | 42 filas (7 días × 6 horarios, saltando domingo) |
| RPC creadas | 4 (`spa_generar_horarios`, `spa_mutar_cita`, `spa_reclamar_avisos`, `spa_finalizar_aviso`) |
| Migración aplicada dos veces seguidas | Sin error (idempotente) |
| `tests/integration.sql` completo | Todas las aserciones pasaron |
| Estado después del `ROLLBACK` | 0 citas, 0 avisos, 0 eventos, 42 horarios: la semilla quedó intacta |

Lo que verificó `tests/integration.sql`, todo con llamadas reales a las RPC:

- RLS habilitado en las 5 tablas y sin ninguna política.
- `anon` y `authenticated` sin `select`, `insert`, `update` ni `delete`, y sin
  acceso a las 4 secuencias; `service_role` sí puede.
- Las 4 RPC no son ejecutables por `public`, `anon` ni `authenticated`, y sí por
  `service_role`.
- Existen los 2 índices únicos parciales de ocupación.
- La semilla es idempotente y los horarios respetan 09/10/11/14/15/16 hora
  Bogotá, lunes a sábado, 60 minutos, nunca el día de hoy.
- Solicitar crea una cita pendiente y 2 avisos con las claves esperadas.
- Repetir el mismo `update_id` responde `duplicado` sin crear nada.
- Otro `update_id` con cita activa responde `cita_activa` con el identificador.
- Otra clienta sobre el mismo horario responde `horario_ocupado`.
- Confirmar, rechazar y cancelar citas ajenas responden `sin_permiso` y no
  cambian el estado.
- El responsable confirma: 2 avisos nuevos, y un segundo toque responde
  `estado_invalido` sin duplicar avisos.
- Cancelar libera el horario y permite volver a pedirlo.
- Cita vencida: se cierra sola como `finalizada` y no bloquea una solicitud
  nueva; confirmar o solicitar un horario pasado responde `horario_vencido`.
- Outbox: reclamar con lease y token, no reclamar dos veces un lease vivo,
  token ajeno rechazado con `sin_lease`, `revision` no se reenvía solo,
  `ok=true` guarda `telegram_message_id` y libera el lease, lease vencido se
  reclamable con token nuevo, error reintentable deja espera creciente, error
  permanente queda `fallida`, al quinto intento queda `fallida`, y un aviso con
  5 intentos no vuelve a reclamarse.
- `error_codigo` no guarda URLs, dominios ni secuencias con forma de token, y el
  aviso no guarda el cuerpo entrante de Telegram.

Errores que aparecieron y se corrigieron durante esta comprobación (para que no
se repitan al escribir la función):

- `SELECT ... INTO variable_de_fila` asigna **por posición**, no por nombre.
  Listar solo algunas columnas de `spa_citas` o `spa_notificaciones` metía un
  texto de nombre sobre un campo `bigint` o sobre `payload jsonb`. Ahora se usa
  `c.*` y `n.*`.
- `pg_temp` no tiene `min(uuid)`: para leer el token del aviso reclamado se usa
  `(array_agg(n.lease_token order by n.id))[1]`.
- `cancelar` valida la pertenencia de la cita **después** de reservar el
  `update_id`, así que un cancelar sin permiso sí consume su `update_id` y
  responde `sin_permiso`. Los rechazos por rol se detectan antes y no lo
  consumen.

### 2.2 Proyecto Supabase publicado — PENDIENTE

No se ha ejecutado nada contra un proyecto Supabase. Cuando lo hagas:

1. Aplica la migración una sola vez (ver la sección 6).
2. Pega `tests/integration.sql` completo en el SQL Editor y pulsa Run.
3. Anota aquí la fecha, si terminó en `Success` sin errores
   `FALLA de integración`, y las cifras que impriman los avisos.
4. Si algo falla, copia el mensaje completo del error aquí.

## 3. Concurrencia real

### 3.1 Dos conexiones simultáneas contra PostgreSQL local — EJECUTADO

Prueba de carrera real, no secuencial, con dos conexiones abiertas a la vez:

| Paso | Resultado observado |
|---|---|
| Sesión A pide el horario y deja la transacción abierta | `ok`, cita 1 |
| Sesión B pide el mismo horario | Se queda esperando bloqueada por el índice único |
| Se confirma la sesión A | La B se desbloquea |
| Respuesta de la sesión B | `horario_ocupado`, cita 1, "Ese horario acaba de ocuparse. Elige otro." |
| Citas activas en el horario disputado | 1 |
| Limpieza | 0 citas, 0 avisos, 0 eventos |

Esto confirma que el índice único parcial es el que decide y que el manejador
de violación se traduce en `horario_ocupado` sin dejar una reserva huérfana.

### 3.2 Dos sesiones del proyecto Supabase — PENDIENTE

Las instrucciones paso a paso están al final de `tests/integration.sql`.
Necesitas dos sesiones abiertas al mismo tiempo. Anota aquí lo que viste,
incluido lo que muestra la sesión B mientras espera.

## 4. Telegram real — PENDIENTE

No se ha hecho ninguna llamada a Telegram. Requiere token, webhook publicado y
un proyecto con la migración aplicada. Cuando exista, anota:

- [ ] `/start` muestra los tres botones
- [ ] Agendar muestra los próximos 7 días excluyendo hoy, en hora Bogotá
- [ ] El resumen no ocupa el horario hasta pulsar Enviar
- [ ] La clienta recibe su aviso y el responsable recibe el suyo con botones
- [ ] Confirmar y rechazar notifican a la clienta y muestran el resultado
- [ ] Cancelar pide segunda confirmación y libera el horario
- [ ] `answerCallbackQuery` con timeout corto no rompe nada
- [ ] `/pendientes` y `/reintentar` solo funcionan del responsable
- [ ] Un evento repetido no crea una segunda cita
- [ ] Mensaje en un grupo: respuesta breve, sin datos ni acciones
- [ ] Texto no reconocido muestra la ayuda

## 5. Despliegue y seguridad de la función — PENDIENTE

- [ ] `supabase/config.toml` con `verify_jwt = false` aplicado al proyecto
- [ ] Secreto de webhook incorrecto responde 401
- [ ] Método distinto de POST responde 405
- [ ] JSON mal formado responde 400
- [ ] Un aviso fallido no borra la cita y responde 200
- [ ] Aviso en `revision` visible desde el SQL Editor
- [ ] Ninguna URL con token aparece en logs ni en la base

## 6. Cómo aplicar la migración una sola vez

Ruta: `supabase/migrations/202610020001_spa.sql`

Opción recomendada, desde tu terminal con la CLI de Supabase autenticada:

```bash
supabase db push
```

Opción manual, si prefieres el SQL Editor:

1. Supabase > SQL Editor > New query.
2. Pega **todo** el contenido de `supabase/migrations/202610020001_spa.sql`.
3. Pulsa Run una sola vez.

Qué esperar: la última línea responde `horarios_creados` con un número
aproximado de 42 en una base nueva. Si la consulta termina con error, no la
repitas a ciegas: pega el mensaje en OpenCode.

La migración no tiene `DROP` ni borra tablas, así que aplicarla una sola vez
deja la base lista con las 5 tablas, sus índices, RLS, los 3 servicios
ficticios y los primeros horarios.

Para reponer horarios más adelante (el bot los necesita de nuevo cada semana):

```sql
select public.spa_generar_horarios();
```