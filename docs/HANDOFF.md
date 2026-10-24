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
- Pestaña **Campañas**: plantilla de WhatsApp a un segmento. Se arma la lista de destinatarios (sin teléfono, descansando 7 días y sin datos quedan fuera), se revisa/quita gente y un humano pulsa "Aprobar y enviar"; envía hasta `CRM_MAX_CAMPAIGN_SENDS_PER_HOUR` (40) por hora y se detiene tras 3 errores seguidos. El agente NO puede crear ni enviar campañas. Plantillas con botones con variables no se admiten todavía.
- `deploy/set-password.sh` cambia la contraseña sin mostrarla (`--rotate-key` renueva el enlace privado).
- Pendiente fuera del repo: programar en OpenClaw el resumen de las 8:00 y la recarga semanal (ver `docs/openclaw/SKILL.md`); 465 clientes de AnaliX sin teléfono ($6.55 mil millones; los grandes: JAIMAR, RALLY PASSION, CAMILO SANCHEZ AGUILERA, ORION LUJOS Y SONIDO); 6 pares de teléfonos compartidos por revisar.

## Pendientes / ideas
- Campañas: seguimiento de respuestas por campaña, y estados de entrega/lectura vía webhook.
- Seguridad: cambiar la contraseña con `bash /opt/crm/deploy/set-password.sh --rotate-key` (se cambió varias veces durante la configuración).
