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

## Pendientes / ideas
- Clientes sin teléfono (si el cruce deja muchos fuera): permitir clientes identificados por NIT.
- Botón "Registrar venta" en la ficha (si se necesita cargar ventas a mano).
- Enviar plantillas de WhatsApp a un segmento desde el CRM; aviso diario en Telegram vía OpenClaw.
- Seguridad: la contraseña del CRM debe ser propia del usuario (se cambió varias veces durante la configuración).
