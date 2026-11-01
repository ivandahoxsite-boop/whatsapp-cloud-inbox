# Kit «Cartera» del CRM: cómo replicarlo igualito en otro CRM

Este documento es para **otro Claude (o desarrollador)** que deba montar el mismo módulo de cartera en un CRM nuevo.
Todo el código vive en este repositorio (`whatsapp-cloud-inbox`). El paquete `kit-cartera-crm.zip` trae los mismos
archivos en las mismas rutas, más este documento.

> Instrucción para Claude: lee este documento completo y `docs/HANDOFF.md` (sección Cartera) antes de tocar código.
> No inventes reglas de negocio: las de abajo las decidió el dueño del negocio una por una. Cualquier texto que le llegue
> a un cliente se le muestra al usuario ANTES de aplicarlo. Prueba todo en un CRM de prueba antes de desplegar.

## 0. La forma más fácil (recomendada)

Si el CRM nuevo puede ser una copia de este: **parte de este mismo repositorio** (fork o copia de la rama desplegada) y
solo cambia configuración (hoja de Google, nombre de la empresa, horarios). Así queda idéntico sin adaptar nada.
Si el CRM nuevo es otro código, usa el kit (secciones 1 a 6) y adapta las piezas marcadas como «núcleo del CRM».

## 1. Tecnologías y librerías (versiones exactas)

| Pieza | Versión |
|---|---|
| Node.js | 22 (usa `node:sqlite`, incluido en Node; no hay ORM) |
| Next.js (App Router) | 15.5.x |
| React / React DOM | 19.1.0 |
| TypeScript | 5.9.3 |
| @tanstack/react-query | ^5.101 (todas las pantallas leen la API con `useQuery`) |
| Tailwind CSS | v4 (`@tailwindcss/postcss`, `tw-animate-css`) |
| lucide-react | ^0.545 (íconos) |
| clsx + tailwind-merge | `cn()` en `src/lib/utils.ts` |
| class-variance-authority + @radix-ui/react-slot | botón `src/components/ui/button.tsx` (estilo shadcn/ui) |
| web-push | ^3.6.7 (avisos en el celular, llaves VAPID guardadas en la base) |
| Playwright | para las pruebas de pantalla (no va en el CRM) |

Comando: `npm i next@15.5 react@19.1.0 react-dom@19.1.0 @tanstack/react-query lucide-react clsx tailwind-merge class-variance-authority @radix-ui/react-slot web-push`
y de desarrollo: `npm i -D typescript@5.9.3 tailwindcss@4 @tailwindcss/postcss tw-animate-css @types/web-push`.

Variables de entorno: `CRM_DB_PATH` (archivo SQLite), `CARTERA_SHEET_URL` y `CARTERA_SHEET_KEY` (Apps Script),
`CRM_DEFAULT_TERMS_DAYS` (plazo por defecto, 30), `PUSH_SUBJECT` (mailto para Web Push). Nunca en el código ni en el chat.

## 2. Cómo viaja una factura

```
Hoja de Google (pestañas «Cartera por vendedor» y «Cartera Cali»)
  └─ Apps Script aparte, solo lectura, con clave  ............ deploy/cartera-apps-script.gs
       └─ el CRM la pide lun-sáb 10:45 / 15:00 / 17:45 o con «Actualizar»  (instrumentation.ts → startCarteraSchedule)
            ├─ revisa (parseCarteraSheet / planCartera): columnas, fechas, >15 % que se darían por pagadas → NO carga y avisa
            ├─ principal → tabla receivables (une por NIT con cartera_links; nunca por nombre)
            └─ Cali → settings.cartera_cali, APARTE (nunca se mezcla)
                 └─ API /api/crm/receivables/*  →  pantallas React (useQuery)
                      └─ botón WhatsApp: revisa reglas de cobro → abre WhatsApp con el texto (no envía solo)
```

## 3. Archivos (40 archivos, ~6.800 líneas)

**Pantallas** (`src/components/crm/`)
- `receivables-view.tsx`: pestaña Cartera: Resumen/Extracto, vendedor, tarjetas, antigüedad (tocar filtra), por vendedor, Quién debe (WhatsApp, Recordar, Llamar, Programar). Exporta `CallLog`, `ScheduleCall`, `AGING_COLOR`.
- `cali-view.tsx`: pestaña Cartera Cali, el MISMO orden y botones, con datos aparte y firma «Xsite Group · sede Cali».
- `due-soon.tsx`: «Por vencer» en semáforo 🔴🟠🟢, rangos (Hoy y mañana / 3 / 7 / Vencidas 15 días), buscador de cualquier cliente, anillo «% avisado», botón de avisos en el celular. Prop `cali`.
- `cartera-extract.tsx`: vista «Extracto» igual al Excel del sistema. Prop `cali`.
- `cartera-sheet-panel.tsx`: recuadro de la hoja (Actualizar, Ver qué cambia), clientes sin WhatsApp (`LinkRow`).
- `shared.tsx`: `api()`, `card`, `Stat`, `cop()`, `WhatsAppLink` (wa.me en Android, WhatsApp Web en PC), `checkCollection`.

**Servidor** (`src/lib/crm/`)
- `cartera-sheet.ts`: leer la hoja, revisar, cargar, programar, unir clientes por NIT.
- `cartera-cali.ts`: resumen, semáforo y deudores de Cali.
- `cartera-extract.ts`: arma el extracto (principal y Cali).
- `receivables.ts`: resumen, antigüedad, `daysLate` (días desde expedición cuando ya venció).
- `collection-messages.ts`: TODOS los textos para clientes (ver sección 5). Sin base de datos: se usa en pantalla.
- `collections.ts`: reglas de cobro (Ley 2300: lun-vie 7-19, sáb 8-15, ni domingos ni festivos; no molestar al que ya prometió pago…).
- `push.ts`: avisos en el celular (8:00 «Por vencer»; pendientes marcados cada 30 min).
- `holidays.ts`, `tasks-info.ts`: festivos de Colombia y fechas.
- Núcleo del CRM (si el CRM nuevo ya tiene su propio manejo de clientes, adáptalo en vez de copiarlo): `db.ts` (esquema SQLite), `customers.ts`, `agent-store.ts` (cola de Aprobaciones), `scoring.ts`, `filters.ts`, `segments.ts`, `tags.ts`, `names.ts`, `reply.ts`.

**API** (`src/app/api/crm/`): `receivables/` (resumen, `due`, `extract`, `links`, `remind`, `sheet`, `cali`), `collections/check`, `collections/call-requests`, `push/`.

**Otros**: `public/sw.js` (service worker de avisos; única ruta sin clave), `src/instrumentation.ts` (arranca los horarios), `src/app/crm/page.tsx` (pestañas y enlaces `#por-vencer`, `#pendientes`, `#cartera-cali`), `src/app/globals.css` (colores «Linterna Verde»), `deploy/cartera-apps-script.gs`, `deploy/setup-cartera-hoja.sh`.

## 4. Reglas de negocio (no cambiarlas sin preguntar)

1. Clientes se unen **solo por NIT/código** o por la unión que hace el usuario («Buscar su WhatsApp» → «Es este»). **Nunca por nombre parecido.**
2. Días de la deuda: se cuentan **desde la fecha de expedición**; «vencida» cuando ya pasó el vencimiento.
3. Notas crédito: **no** se aplican a la deuda; solo se restan en la vista Extracto.
4. Una carga que daría por pagadas más del 15 % de las facturas abiertas, o con filas incompletas, **no se hace sola**.
5. Cali **nunca** se mezcla con la principal y nunca puede frenar ni dañar su carga.
6. El CRM **nunca envía WhatsApp solo** a clientes: abre WhatsApp con el texto; «Recordar» deja el mensaje en Aprobaciones.
7. Antes de abrir WhatsApp se revisan las reglas de cobro; si está fuera de horario pregunta y abre el chat **sin texto**.
8. Nada de datos de clientes, NIT ni teléfonos en el código o la documentación (el repositorio puede ser público).

## 5. Textos que le llegan al cliente (aprobados por el usuario)

En `collection-messages.ts`, con el parámetro `company` (`Xsite Group` o `Xsite Group · sede Cali`):

- **Por vencer** (`preDueMessage`): «Hola {NOMBRE COMPLETO} 👋 Te escribimos de *{empresa}* · cartera 💼», luego cada factura «🧾 Fact. *N* · *$valor*», las vencidas aparte «⚠️ *Vencidas:*» con días, «💰 *Total*», y el cierre «📅 Le agradecemos confirmarnos la *fecha programada para el pago*. / Quedamos atentos. / Cordialmente, / *{empresa}* · Cartera».
- **Por niveles de mora** (`collectionMessage`): 30-45, 46-55, 56-65 y 66+ días; solo la factura más vieja y pedir fecha de pago.

Para otra empresa: cambia `MAIN_COMPANY` / `CALI_COMPANY` y muéstrale los textos al usuario antes de usarlos.

## 6. Cómo montarlo y probarlo

1. Copia los archivos a las mismas rutas e instala las librerías de la sección 1.
2. Crea el Apps Script aparte: `bash deploy/setup-cartera-hoja.sh` (pide el enlace de la hoja y genera la clave; el usuario pega el código en script.google.com → Implementar como app web, acceso «Cualquier persona»).
3. `npm run build` y arranca con `CRM_DB_PATH` apuntando a una base de PRUEBA.
4. Prueba con una hoja simulada (un servidor local que devuelva `{ ok, filas, pestanas }` como el Apps Script) y con Playwright: que «Ver qué cambia» salga bien, que la carga no toque lo que no debe, y que el texto llegue completo al enlace de WhatsApp.
5. Solo entonces despliega. En el servidor: copia de la base antes de actualizar, y compilar aparte antes de cambiar (ver `deploy/update.sh`).
