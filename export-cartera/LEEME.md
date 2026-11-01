# Módulo de Cartera (Medellín + Cali) — exportación

Copia **solo del módulo de cartera** del CRM de Xsite Group (repositorio `whatsapp-cloud-inbox`), para montarlo en un
CRM nuevo. Los archivos están en las **mismas rutas** que en el CRM original. No trae datos de clientes, bases de
datos, llaves ni claves: cada instalación genera las suyas.

> Para quien lo monte (persona o Claude): lee este archivo completo antes de tocar código. Las reglas de la sección 7
> las decidió el dueño del negocio una por una; no las cambies sin preguntar. Cualquier texto para clientes se le
> muestra al dueño ANTES de cambiarlo. Prueba en un CRM de prueba (sección 6) antes de desplegar.

Comprobado al exportar: esta carpeta **compila sola** (`tsc`, `eslint`, `next build`) y pasa las 12 pruebas de
`tests/cartera.e2e.js` contra una base vacía y la hoja simulada.

**Única diferencia con el código original** (todo lo demás es copia exacta, commit `0fcec73`):
- `src/instrumentation.ts`: sin la sincronización de ventas AnaliX.
- `src/app/crm/page.tsx` y `src/app/page.tsx`: nuevos (solo las dos pestañas de cartera).
- `package.json`: solo las librerías que usa la cartera, con versión exacta; `tests/`: nuevos.
- Comentarios del código: los nombres de clientes y del vendedor que servían de ejemplo se cambiaron por ejemplos inventados.

---

## 1. Archivos y para qué sirve cada uno

**Configuración**
| Archivo | Para qué |
|---|---|
| `package.json` | Librerías con versión EXACTA (las mismas que usa el CRM original) y comandos. |
| `next.config.ts`, `tsconfig.json`, `postcss.config.mjs`, `eslint.config.mjs`, `components.json`, `next-env.d.ts` | Configuración de Next.js, TypeScript, Tailwind, ESLint y shadcn/ui, igual al original. |

**Pantallas** (`src/app`, `src/components`)
| Archivo | Para qué |
|---|---|
| `src/app/crm/page.tsx` | **Nuevo en esta exportación**: página con solo las pestañas «Cartera» y «Cartera Cali» y los enlaces `#por-vencer` y `#cartera-cali`. El original tiene además Resumen, Clientes, Ventas, Pendientes… |
| `src/app/page.tsx` | **Nuevo en esta exportación**: la portada va directo a `/crm` (en el original es la bandeja de WhatsApp). |
| `src/app/layout.tsx`, `src/app/globals.css` | Estructura de la página, modo claro/oscuro automático (claro de 6 a 18 h Colombia) y colores verdes. |
| `src/app/error.tsx`, `src/app/global-error.tsx`, `src/components/error-screen.tsx` | Pantalla de error amable. |
| `src/app/verify/page.tsx`, `src/components/crm/lock-gate.tsx` | Verificación en dos pasos (código de 6 dígitos) y bloqueo con clave de 4 dígitos. |
| `src/components/query-provider.tsx` | React Query para toda la app. |
| `src/components/theme-toggle.tsx` | Botón de modo claro/oscuro/automático. |
| `src/components/ui/button.tsx` | Botón estilo shadcn/ui. |
| `src/components/crm/receivables-view.tsx` | **Pestaña «Cartera» (Medellín)**: Resumen/Extracto, vendedor, recuadro de la hoja, Por vencer, tarjetas, antigüedad (tocar filtra), Por vendedor, sin WhatsApp, Quién debe (WhatsApp, Recordar, Llamar, Programar), registro de llamadas. |
| `src/components/crm/cali-view.tsx` | **Pestaña «Cartera Cali»**: lo mismo, con datos aparte y firma de sede Cali. |
| `src/components/crm/due-soon.tsx` | «Por vencer» en semáforo, rangos, buscador, anillo «% avisado», botón de avisos en el celular. Prop `cali`. |
| `src/components/crm/cartera-extract.tsx` | Vista «Extracto» igual al Excel del sistema. Prop `cali`. |
| `src/components/crm/cartera-sheet-panel.tsx` | Recuadro de la hoja (Actualizar, Ver qué cambia) y «Clientes de la hoja sin WhatsApp» (`LinkRow`). |
| `src/components/crm/shared.tsx` | Utilidades de pantalla: `api()`, `card`, `Stat`, `cop()`, `WhatsAppLink`, `checkCollection`, Twilio. |
| `public/sw.js` | Service worker de los avisos en el celular (única ruta sin clave). |

**Servidor** (`src/lib`)
| Archivo | Para qué |
|---|---|
| `src/lib/crm/cartera-sheet.ts` | Leer la hoja, vista previa, bloqueos, carga, horario, unión por NIT, notas crédito, copia de Cali. |
| `src/lib/crm/cartera-cali.ts` | Resumen, semáforo, buscador y deudores de Cali (desde su copia aparte). |
| `src/lib/crm/cartera-extract.ts` | Arma el extracto (principal y Cali). |
| `src/lib/crm/receivables.ts` | Facturas: carga genérica, resumen, antigüedad, `daysLate`, horarios de carga. |
| `src/lib/crm/collection-messages.ts` | **Todos los textos para el cliente** (sección 5). |
| `src/lib/crm/collections.ts` | Reglas de cobro (Ley 2300), registro de llamadas, llamadas programadas. |
| `src/lib/crm/push.ts` | Avisos en el celular (8:00 «Por vencer») y avisos de pendientes; búsqueda y rangos de «Por vencer». |
| `src/lib/crm/holidays.ts`, `src/lib/crm/tasks-info.ts` | Festivos de Colombia (Ley Emiliani + Semana Santa) y fechas. |
| `src/lib/crm/twilio.ts` | Llamar por Twilio (opcional; sin configurar, «Llamar» usa el marcador del celular). |
| `src/lib/crm/db.ts` | Esquema SQLite (`node:sqlite`). Ver sección 3. |
| `src/lib/crm/customers.ts`, `agent-store.ts`, `scoring.ts`, `filters.ts`, `segments.ts`, `tags.ts`, `names.ts`, `reply.ts` | Núcleo del CRM que la cartera necesita (clientes, unir teléfonos, cola de Aprobaciones). Si el CRM nuevo ya tiene su manejo de clientes, adáptalo en vez de copiarlo. |
| `src/lib/crm/lock.ts`, `src/lib/crm/totp.ts`, `src/lib/twofa-token.ts`, `src/middleware.ts` | Clave de entrada (Basic Auth o enlace privado), dos pasos (TOTP), bloqueo con PIN, límite de intentos. |
| `src/lib/utils.ts` | `cn()`. |
| `src/instrumentation.ts` | Arranca el horario de carga de la hoja y los avisos de las 8:00. **Cambiado en esta exportación**: el original también arrancaba la sincronización de ventas AnaliX (no es de cartera). |

**API** (`src/app/api`)
| Ruta | Para qué |
|---|---|
| `crm/receivables` | Resumen de la cartera principal (`?seller=`, `?bucket=`). |
| `crm/receivables/sheet` | Estado de la hoja; POST `preview` / `update` / `load`. |
| `crm/receivables/due` | «Por vencer» (`?days=1|3|7|-15`, `?q=` buscador, `&tab=cali`). |
| `crm/receivables/extract` | Extracto (`?seller=`, `?tab=cali`). |
| `crm/receivables/cali` | Resumen de Cali (`?seller=`). |
| `crm/receivables/links` | Clientes de la hoja y su WhatsApp; unir, rechazar sugerencia, desvincular. |
| `crm/receivables/remind` | «Recordar»: deja el mensaje en Aprobaciones (`cali: true` para Cali). |
| `crm/collections/check` | Revisa las reglas de cobro antes de abrir WhatsApp o llamar (`aviso=1` no exige deuda vencida). |
| `crm/collections/call-requests` | Llamadas programadas. |
| `crm/customers/[id]/calls` | Registro de cómo le fue en la llamada. |
| `crm/push`, `crm/push/test` | Suscribirse a los avisos y mandar uno de prueba. |
| `crm/twilio`, `crm/lock`, `crm/version`, `auth/verify`, `client-error` | Twilio, bloqueo con PIN, versión (recarga sola al actualizar), dos pasos, registro de errores de pantalla. |

**Instalación y pruebas**
| Archivo | Para qué |
|---|---|
| `deploy/cartera-apps-script.gs` | Código del Apps Script (marcadores `__CLAVE__` y `__HOJA__`). |
| `deploy/setup-cartera-hoja.sh` | Instala la conexión con la hoja (sección 4). |
| `deploy/install.sh`, `deploy/update.sh`, `deploy/set-password.sh`, `deploy/setup-2fa.sh` | Instalación y actualización del CRM original en Ubuntu (sección 6). Traen pasos de WhatsApp/Kapso que son de los otros módulos. |
| `tests/hoja-simulada.js` | Hoja de Google simulada con datos inventados (modos: normal, `sin-cali`, `cali-danada`, `mitad`). |
| `tests/cartera.e2e.js` | Prueba con Playwright de punta a punta (12 revisiones). |

**No incluido** (son otros módulos del CRM original): ficha del cliente, bandeja de WhatsApp, pestaña Aprobaciones y el envío por WhatsApp Cloud API (Kapso), Pendientes/tareas en pantalla, ventas/AnaliX, campañas. «Recordar» deja el mensaje en la tabla `outbox`: el CRM nuevo necesita su propia pantalla de Aprobaciones para revisarlo y enviarlo.

---

## 2. «Cartera» (Medellín) frente a «Cartera Cali»

| | Cartera (Medellín) | Cartera Cali |
|---|---|---|
| Pestaña de la hoja | `Cartera por vendedor` | `Cartera Cali` |
| Hoja de Google | La misma (un solo libro) | La misma |
| Apps Script y clave | **Uno solo** para las dos: una llamada devuelve las dos pestañas (`pestanas`) | El mismo |
| Horario de lectura | Lun-sáb 10:45, 15:00 y 17:45, o «🔄 Actualizar» | El mismo (se lee en la misma llamada) |
| Dónde se guarda | Tabla `receivables` (`source = 'cartera'`, `external_id` = número de factura) | `settings.cartera_cali` (JSON con facturas, notas crédito, corte y hora). **Nunca entra a `receivables`** |
| Si la pestaña falla | La carga se frena y avisa | Se deja la copia anterior con aviso ⚠️ y la principal se carga normal |
| Vendedores | Los de la columna `Nombre_Vendedor` (o el «Vendedor» del encabezado) | Igual, de su pestaña |
| Unión con WhatsApp | Por NIT (`cartera_links`) | La misma tabla: unir un NIT en una sirve para la otra |
| Empresa en los textos | `Xsite Group` (`MAIN_COMPANY`) | `Xsite Group · sede Cali` (`CALI_COMPANY`) |
| Revisión antes de WhatsApp/llamar | Exige deuda vencida en el CRM (salvo «Por vencer») | Siempre con `aviso=1`/`reminder` (su deuda no está en `receivables`) |
| Aviso de las 8:00 en el celular | Sí | No |
| ✅ de «avisado hoy» | Guardado en el navegador (`crm-cobro-avisados`) | Aparte (`crm-cobro-avisados-cali`) |
| Vista elegida (Resumen/Extracto) | `crm-cartera-view` | `crm-cali-view` |
| Aparece en totales, ficha del cliente, avisos de deuda | Sí | No (solo en su pestaña) |

Restos de una versión anterior: si en `receivables` hay facturas con `external_id` que empieza por `CALI-`, la siguiente carga las borra (la vista previa lo dice).

---

## 3. Base de datos (SQLite, `src/lib/crm/db.ts`)

`contacts` (clientes; sin WhatsApp: `phone = 'nit:<NIT>'`), `receivables` (facturas), `cartera_links` (NIT → contacto: `linked`/`suggested`/`rejected`), `settings` (última carga, horario hecho, notas crédito, copia de Cali, llaves VAPID, interruptor de horario), `push_subscriptions`, `outbox` (Aprobaciones), `call_requests` (llamadas programadas) y `activities` con `kind = 'call'` (registro de llamadas). El esquema completo crea también tablas de otros módulos; no estorban.

---

## 4. Variables de entorno (solo nombres)

Obligatorias: `INBOX_PASSWORD`, `CRM_DB_PATH`, `CARTERA_SHEET_URL`, `CARTERA_SHEET_KEY`.
Opcionales: `INBOX_USERNAME` (por defecto `admin`), `INBOX_ACCESS_KEY` (enlace privado), `CRM_TOTP_SECRET` y `CRM_2FA_DAYS` (dos pasos), `CRM_DEFAULT_TERMS_DAYS` (plazo cuando falta una fecha, 30), `CRM_DEFAULT_COUNTRY_CODE` (57), `PUSH_SUBJECT` (mailto de Web Push), `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `TWILIO_CALLER_ID`, `TWILIO_AGENT_PHONE`, `TWILIO_API_URL`, `TWILIO_MAX_CALLS_PER_HOUR`. De Next: `NODE_ENV`, `NEXT_RUNTIME`, `NEXT_DIST_DIR`.
Van en `/etc/crm/crm.env` (permisos 600), nunca en el código ni en un chat.

---

## 5. La hoja y el Apps Script

- Pestañas, nombre exacto: **`Cartera por vendedor`** y **`Cartera Cali`**.
- Arriba, filas de filtros (`Fecha inicio | … | Fecha final | <corte> | Vendedor | <nombre>`); luego la fila de títulos, que se busca por contenido:
  `Cliente | Nombre_Cliente | T_Dcto | Documento | F_Expedic | F_Vencim | DiasVc | Deuda | Pagado | Venc_91 | Venc_61_90 | Venc_31_60 | Venc_0_30 | Por_Venc | Vencido | Saldo | Nombre_Vendedor`
  (obligatorias: Cliente, Nombre_Cliente, T_Dcto, Documento, F_Expedic, F_Vencim, Deuda, Saldo).
- Apps Script en un proyecto **aparte** (script.google.com → Nuevo proyecto), nunca dentro del de la hoja. Solo lee.
- `bash deploy/setup-cartera-hoja.sh`: pide el enlace de la hoja, genera la clave y la guarda de una vez, imprime el código ya con la clave y la hoja, pide la URL `/exec` (Implementar → Aplicación web, ejecutar como yo, acceso «Cualquier persona») y la prueba hasta 3 veces.
- Para cambiar el código después: Implementar → **Gestionar implementaciones** → lápiz → Versión «Nueva versión» → Implementar (la URL no cambia). Nunca «Nueva implementación».

---

## 6. Textos que se le envían al cliente (tal como están hoy)

Archivo `src/lib/crm/collection-messages.ts`. `{empresa}` = `Xsite Group` o `Xsite Group · sede Cali`. Los `*` son negrita en WhatsApp.

**Por vencer** (botón «💬 Cobrar por WhatsApp» del semáforo). Saluda con el nombre COMPLETO sin emojis:
```
Hola {NOMBRE COMPLETO} 👋 Te escribimos de *{empresa}* · cartera 💼

🧾 Fact. *{doc}* · *${valor}*            ← una por factura del rango, sin título ni fecha

⚠️ *Vencidas:*                          ← solo si tiene vencidas y la casilla está marcada
🧾 Fact. *{doc}* · {días} días · *${valor}*   ← máximo 6
🧾 y {N} facturas más · *${suma}*

💰 *Total: ${total}*

📅 Le agradecemos confirmarnos la *fecha programada para el pago*.
Quedamos atentos.

Cordialmente,
*{empresa}* · Cartera
```

**Por niveles de mora** (botón «💬 WhatsApp» de Quién debe y del Extracto; solo la factura más vieja; saluda con la PRIMERA palabra del nombre, o dos si la primera es muy corta; menos de 30 días = abre el chat sin texto):
- 30-45 días:
  `Hola {nombre} 👋 Te escribimos de *{empresa}* · cartera 💼` / `Tienes pendiente la factura *{doc}* por *${valor}* (vencida hace {días} días) 🧾` / `¿Qué fecha te programamos para el pago? 📅 Respóndenos con el día y lo dejamos agendado ✅`
- 46-55 días:
  `Hola {nombre} 👋 Te escribimos de *{empresa}* · cartera ⚠️` / `La factura *{doc}* por *${valor}* ya lleva *{días} días* vencida 🧾` / `Necesitamos que nos confirmes *hoy* la fecha de pago 📅 para seguir despachando sin inconvenientes 🚚`
- 56-65 días:
  `Hola {nombre} 👋 Te escribimos de *{empresa}* · cartera.` / `La factura *{doc}* por *${valor}* lleva *{días} días* vencida 🧾` / `Queremos seguir trabajando contigo 🤝 pero necesitamos que te pongas al día. Confírmanos hoy *qué día* realizas el pago 📅🙏`
- 66 días o más:
  `{nombre}, te contactamos de *{empresa}* · cartera 🔴` / `La factura *{doc}* por *${valor}* lleva *{días} días* en mora 🧾` / `Es un llamado formal 📌 Si en *5 días hábiles* no recibimos el pago o un acuerdo, la cuenta pasa a cobro prejurídico. Respóndenos hoy con la *fecha de pago* 📅`

**Recordar** (va a Aprobaciones; con 30+ días usa el de niveles; con menos, este):
`Hola {primer nombre}, te escribimos[ de Xsite Group · sede Cali] para recordarte que tienes un saldo pendiente de ${total} ({hasta 3 facturas}[…]), con facturas vencidas hace hasta {días} días. ¿Nos confirmas cuándo podrías realizar el pago? Gracias.` (la parte de «vencidas» solo si tiene).

**Avisos en el celular del usuario** (no del cliente): `📅 Vencen hoy y mañana: {N} facturas · ${total}` / `{cliente} ${valor} y {N} clientes más. ⚠️ {N} de ellos además tienen facturas vencidas (${x}). Toca para elegir a quién enviarle el recordatorio.` — y de prueba: `🔔 Avisos del CRM activados` / `Mañana no vence ninguna factura. Así se verán los avisos.`

---

## 7. Reglas de negocio que no son obvias

1. **Unión por NIT o por el usuario, nunca por nombre.** Un error real unió dos empresas distintas por nombre parecido. Las sugerencias solo se muestran («Sí, es él» / «No»).
2. **Días:** `daysLate` = 0 si no ha vencido; si ya venció, días desde la **fecha de expedición**. En el Extracto, `DiasVc` = días desde la expedición y el saldo va al rango de esos días aunque no haya vencido («cobrar desde ya»), así que `Por_Venc` queda en 0.
3. **Notas crédito** (T_Dcto empieza por «N» o saldo negativo): no se aplican a la deuda; solo se restan en el Extracto.
4. **La hoja es la cartera completa:** lo abierto que ya no aparece queda pagado.
5. **Bloqueos:** no carga si falta una columna, hay filas sin fecha o con saldo inválido, facturas repetidas, hoja vacía, o se darían por pagadas más del **15 %** de las abiertas. Tras ver la vista previa el usuario puede forzar lo del 15 %; lo demás siempre bloquea.
6. **Horario de carga:** lun-sáb 10:45, 15:00, 17:45 hora Colombia; una vez por horario; si el servidor arranca tarde, solo recupera el horario de las últimas 2 horas; nunca domingos ni festivos.
7. **Cali nunca se mezcla** con la principal ni puede frenarla o dañarla.
8. **Nunca se envía WhatsApp solo:** se abre WhatsApp con el texto (Android: wa.me en la misma pestaña; PC: pestaña de WhatsApp Web). Los intents de WhatsApp Business llegaban vacíos o cortados: no usarlos.
9. **Reglas de cobro (Ley 2300 de 2023):** lun-vie 7:00-19:00, sáb 8:00-15:00, nunca domingos ni festivos; no si pidió que no lo llamen, si ya se le llamó hoy, si tiene promesa de pago vigente o si se le cobró en los últimos 7 días. Si no se puede, pregunta y abre el chat **sin texto**. `settings.collection_hours_off_until` (una fecha y hora) apaga la regla de horario hasta esa hora, para pruebas; solo afecta los botones del CRM y se vence sola.
10. **«Por vencer»:** «Hoy y mañana» = hoy + el siguiente día hábil (si mañana es domingo o festivo, hasta el próximo hábil); «Vencidas 15 días» = vencimiento entre hoy-15 y ayer. El ✅ solo se pone si el mensaje salió. El buscador busca en todos los clientes, deban o no (máx. 20).
11. **Fuera de la ventana de 24 h de Meta** solo se pueden enviar plantillas (se cobran); por eso el cobro se hace abriendo WhatsApp a mano.
12. **Aviso de las 8:00:** lun-sáb sin festivos, una vez al día.
13. **Teléfonos:** a los celulares de 10 dígitos se les pone 57 adelante para que coincidan con WhatsApp.

---

## 8. Cómo se arranca, se despliega y se vuelve atrás

**Probar en local (CRM de prueba)**
1. `npm ci` (Node 22.5 o más nuevo).
2. `node tests/hoja-simulada.js` (otra terminal).
3. `npm run build`, luego `CRM_DB_PATH=/tmp/prueba.db INBOX_PASSWORD=prueba CARTERA_SHEET_URL=http://127.0.0.1:4112/exec CARTERA_SHEET_KEY=prueba npx next start -p 4102`
4. `node tests/cartera.e2e.js` → debe terminar en «Todo bien». Fotos en `tests/fotos/`.

**Servidor (como el original, Ubuntu 24.04)**
1. Con Node 22 ya instalado en /usr, `deploy/install.sh` (Ubuntu 24.04, sin Docker) instala el usuario `crm`, el código en `/opt/crm`, la base en `/var/lib/crm/crm.db`, las variables en `/etc/crm/crm.env`, el servicio `crm` (systemd) detrás de Caddy (HTTPS), copias diarias de la base a las 3:15 en `/var/backups/crm` (14 días) y el comando `crm-update`. Trae pasos de WhatsApp/Kapso de los otros módulos: quítalos si no los usas.
2. `bash /opt/crm/deploy/setup-cartera-hoja.sh` para conectar la hoja.
3. Para actualizar: `git -C /opt/crm status --short && crm-update`.

**Volver a la versión anterior**
- `crm-update` (`deploy/update.sh`) compila la versión nueva **aparte** (`.next-new`) mientras la actual sigue funcionando. Solo si compila: copia la base, cambia `.next` → `.next-old` y `.next-new` → `.next` y reinicia. Si no compila, no toca nada y regresa el código al commit anterior. Si la nueva no responde, vuelve sola a `.next-old` y al commit anterior.
- A mano: `cd /opt/crm && git log --oneline -5`, `git checkout <commit anterior>` y `crm-update`. La base se copia antes de cada actualización en `/var/backups/crm`.
- Apps Script: Gestionar implementaciones → lápiz → elegir la versión anterior → Implementar.
