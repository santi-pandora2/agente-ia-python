# Instrucciones para OpenCode

Construye el bot de Telegram descrito en ESPECIFICACION.md. Trabaja dentro de esta carpeta. El estudiante ejecuta este taller por etapas; completa solamente la etapa que te pidió.

- Usa TypeScript, Deno y Supabase Edge Functions. No uses n8n, Docker para la ruta básica, un servidor permanente, frontend ni un modelo de IA dentro del bot.
- Lee ESPECIFICACION.md antes de construir. Conserva los nombres de archivos, tablas, variables y tareas definidos allí.
- Usa Telegram Bot API directamente mediante fetch. Mantén las dependencias al mínimo y fija la versión de supabase-js en deno.json.
- Los archivos de ejemplo contienen marcadores, nunca secretos. No leas, imprimas, busques ni adjuntes .env, contraseñas, tokens o credenciales. No incluyas cuerpos completos de mensajes en logs.
- El estudiante introduce las credenciales y ejecuta los comandos de autenticación, publicación y configuración de Telegram en su terminal. Puedes preparar estos comandos y comprobar el código sin credenciales.
- No cambies opencode.json ni estas reglas para saltarte una restricción.
- Comprueba permisos por user_id y pertenencia de citas en el servidor. No confíes en botones ni datos enviados por el cliente.
- Toda modificación de citas debe ser transaccional en Postgres. La deduplicación del evento, la cita y las notificaciones se guardan en la misma transacción.
- Una consulta previa a INSERT no sustituye el índice único de ocupación. Los envíos a Telegram no tienen garantía de exactamente una vez.
- No marques una notificación como enviada antes de que Telegram confirme ok=true.
- Ejecuta deno task check y deno task test después de cambios funcionales. Prueba fallas y permisos, no solamente el caso feliz.
- No declares pruebas de Supabase o Telegram reales como aprobadas si solamente usaste dobles de prueba.
- Reporta archivos creados, comandos ejecutados, pruebas aprobadas y pendientes. No inventes resultados.

Puedes crear y modificar el código necesario para la etapa solicitada y descargar dependencias públicas para las verificaciones. No agregues servicios o funciones fuera del alcance.
