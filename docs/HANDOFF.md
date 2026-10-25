# Estado del proyecto CRM (para retomar en otro chat)

Rama de trabajo: `ccr-a1c0a3f6-mh5l7b`. Todo lo descrito aquí ya está subido.

## Qué es
CRM de ventas sobre la bandeja de WhatsApp (Next.js + SQLite), conectado a **Kapso** (WhatsApp) y a **OpenClaw** (agente en Telegram que corre en el mismo VPS).

## Dónde corre (VPS Ubuntu 24.04, Contabo)
- Código: `/opt/crm` (usuario de sistema `crm`), servicio systemd `crm`, escucha solo en `127.0.0.1:4000`.
- HTTPS público con Caddy (`/etc/caddy/Caddyfile`, dominio `*.sslip.io` del VPS). `/api/agent/*` NO se expone a internet.
- Datos: `/var/lib/crm/crm.db` (fuera del código, no se toca al actualizar). Copias: `/var/backups/crm` (diarias, 14 días) y antes de cada actualización.
- Configuración y secretos: `/etc/crm/crm.env` (contraseña, API key de Kapso, tokens). `/etc/crm/agent.env` solo con `CRM_AGENT_TOKEN` y `CRM_BASE_URL`, cargado en los servicios `openclaw-gateway` y `openclaw-cali` (drop-in `crm.conf`).
- Actualizar: `crm-update` (ejecuta `deploy/update.sh`: muestra datos antes/después, compila, respalda, reinicia y trae mensajes nuevos de Kapso).
- Ver contraseña: `grep '^INBOX_PASSWORD=' /etc/crm/crm.env` (usuario `admin`).
- El usuario trabaja desde el celular (Termius + Chrome). Darle comandos de una sola línea y pasos cortos.

## Funciones hechas
- Clientes con ciudad, etiquetas, etapas, campos personalizados, notas e historial (compras + WhatsApp).
- Recurrencia por cliente (primera compra, una vez, recurrente, le toca recomprar, perdido) y valor RFM.
- Segmentos guardados + filtros + exportar CSV. Resumen (dashboard) móvil.
- Kapso: webhook firmado (mensajes en vivo) + "Traer historial" (completo o solo lo nuevo), audios transcritos, sin duplicados, resultado guardado en `sync_runs`.
- "Esperan tu respuesta": último mensaje del cliente sin contestar en los últimos 14 días.
- API del agente (`docs/openclaw/SKILL.md`): consultar clientes/acciones, notas, etapas, proponer mensajes (aprobación humana), e importar clientes y ventas (`/api/agent/import/customers`, `/api/agent/import/sales`, dedupe por `externalId`, teléfonos colombianos sin 57 se unen al contacto de WhatsApp).
- Probado con 45.000 ventas / 720 clientes (lista de clientes 0,2 s).

## En curso: cargar ventas desde AnaliX vía OpenClaw
OpenClaw tiene acceso a AnaliX (caché local). Lo que encontró:
- 44.933 líneas de venta (cliente × producto × mes), 2020–2026, 720 clientes, 2.256 productos. Campos: mes, año, vendedor, zona (11 zonas), producto, descripción, cliente, total, cantidad.
- **No tiene**: teléfono, número de factura, ciudad (solo zona), día exacto.
- Plan acordado: cruzar con la hoja de Google Sheets **BD_Clientes** (tiene NIT y teléfonos) por nombre normalizado / NIT.
- Reglas de carga ya enviadas a OpenClaw: `soldAt` = primer día del mes; `externalId` = `ANX-cliente-año-mes-producto` (estable); producto = código + descripción; `data` = {seller, zone, qty}; etiquetas "Zona X" y "Vendedor Y"; ciudad desde BD_Clientes; lotes de 500; prueba de 10 primero.
- **Siguiente paso**: OpenClaw debe reportar cuántos de los 720 clientes cruzan con teléfono y cuáles no. Decidir qué hacer con los que no tienen teléfono (el CRM hoy exige teléfono como clave).

## Hecho después (carga de AnaliX terminada y mejoras)
- Cargados 251 clientes / 35.808 ventas ($21.357.561.988) con clave = teléfono; 30 nombres compartían teléfono (221 contactos). Se corrigieron nombres pisados y se revisaron pares dudosos (R2 CAR CUSTOM = antes QUALITA AUDIO; LUXURIOS CAR'S TOY'S = Diego Armando, tel. 3148840643 → pendiente de cargar).
- Importación de ventas: `dryRun`, detector de teléfonos con clientes distintos (`conflicts`, `onConflict:"skip"`, `sharedPhones`); cada venta guarda `data.client`.
- El import de clientes ya no pisa nombres existentes (`overwriteName:true` para hacerlo a propósito); `externalId` de más de 80 caracteres se acorta con hash.
- Clientes sin teléfono: `allowNoPhone:true` + `nit`/`name`; filtro "📵 Sin teléfono"; se agrega el teléfono en la ficha o con `PATCH {phone}` y se fusiona con el chat de WhatsApp si ya existe.
- Pestaña **Ventas** (por mes, vendedor, zona, productos, combos, productos que dejaron de llevar) y `GET /api/agent/reports/sales`.
- "Registrar venta" en la ficha del cliente; `GET /api/agent/digest` (resumen diario listo para Telegram).
- Pestaña **Cartera** (cuentas por cobrar): `POST /api/agent/import/receivables` (por factura, `dryRun`, `closeMissing`+`source`), antigüedad de la deuda, por vendedor, quién debe y botón "Recordar" (queda en Aprobaciones). Se busca al cliente por teléfono o NIT; la cartera aparece también en la ficha del cliente y en el resumen diario.
- **Clave para ver el dinero**: la pestaña Ventas (solo esa; Cartera queda abierta a propósito) muestra XXXX hasta escribir una clave propia (se crea la primera vez; se guarda con hash en la tabla `settings`). El servidor responde 423 sin la cookie de desbloqueo (30 min). Resumen y Clientes todavía muestran montos. La API del agente (OpenClaw, solo local) no usa esta clave.
- Pestaña **Campañas**: plantilla de WhatsApp a un segmento. Se arma la lista de destinatarios (sin teléfono, descansando 7 días y sin datos quedan fuera), se revisa/quita gente y un humano pulsa "Aprobar y enviar"; envía hasta `CRM_MAX_CAMPAIGN_SENDS_PER_HOUR` (40) por hora y se detiene tras 3 errores seguidos. El agente NO puede crear ni enviar campañas. Plantillas con botones con variables no se admiten todavía.
- **Verificación en dos pasos (TOTP)**: `bash /opt/crm/deploy/setup-2fa.sh` (pide un código de la app antes de activar; `--off` la desactiva). Con `CRM_TOTP_SECRET` en `/etc/crm/crm.env`, tras la contraseña/enlace privado el navegador debe pasar por `/verify`: código de 6 dígitos y, si ya existe la clave de 4 dígitos de Ventas, también esa clave (mensaje de error genérico); al pasar, cookie `crm_2fa` (`CRM_2FA_DAYS`=30). Ventas sigue pidiendo su propia clave (no se desbloquea al entrar). Scripts locales (crm-update, set-password) entran directo por 127.0.0.1 sin código; `/api/agent` y `/api/webhooks` no cambian. Si pierdes el celular: por SSH, `setup-2fa.sh --off`.
- `deploy/prune-sales.sh [--before AAAA-MM-DD]`: borra las ventas anteriores a esa fecha (por defecto 2024-01-01) tras vista previa, copia de seguridad y confirmación escrita (BORRAR). Después, las cargas de AnaliX deben filtrar desde esa fecha o volverán a entrar las ventas viejas.
- **Cobranza por teléfono (lado CRM)**: `GET /api/agent/collections/queue` (a quién se puede llamar ahora; vacío fuera de horario Ley 2300: L-V 7-19, sáb 8-15 hora Colombia, sin domingos ni festivos; excluye sin teléfono, "no llamar", llamados hoy, alcanzados o con recordatorio en 7 días, promesa vigente) y `POST /api/agent/customers/{id}/calls` (resumen, resultado, promesa de pago → línea de tiempo "Llamada de cobro", y promesas en el resumen diario). Festivos en `src/lib/crm/holidays.ts`. El botón **Llamar** de Cartera marca clientes (`call_requests`; rechaza si no se puede: sin teléfono, sin deuda vencida, no llamar, promesa vigente, contactado esta semana; el horario se revisa al momento de marcar la llamada) y OpenClaw los lee en `GET /api/agent/collections/requested`. La llamada en sí la hace OpenClaw con el plugin `@openclaw/voice-call` + Twilio (por configurar).
- `deploy/set-password.sh` cambia la contraseña sin mostrarla (`--rotate-key` renueva el enlace privado).
- Pendiente fuera del repo: programar en OpenClaw el resumen de las 8:00 y la recarga semanal (ver `docs/openclaw/SKILL.md`); 465 clientes de AnaliX sin teléfono ($6.55 mil millones; los grandes: JAIMAR, RALLY PASSION, CAMILO SANCHEZ AGUILERA, ORION LUJOS Y SONIDO); 6 pares de teléfonos compartidos por revisar.

## Pendientes / ideas
- Campañas: seguimiento de respuestas por campaña, y estados de entrega/lectura vía webhook.
- Seguridad: cambiar la contraseña con `bash /opt/crm/deploy/set-password.sh --rotate-key` (se cambió varias veces durante la configuración).
