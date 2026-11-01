/* eslint-disable @typescript-eslint/no-require-imports -- plain Node scripts, run with `node` */
// Prueba de punta a punta del módulo de cartera con Playwright, contra un CRM de PRUEBA y la hoja simulada.
//   1) node tests/hoja-simulada.js
//   2) CRM de prueba: CRM_DB_PATH=/tmp/prueba.db INBOX_PASSWORD=prueba CARTERA_SHEET_URL=http://127.0.0.1:4112/exec \
//      CARTERA_SHEET_KEY=prueba npx next start -p 4102
//   3) node tests/cartera.e2e.js            (CRM_URL, CRM_USER, CRM_PASSWORD para cambiar los datos de entrada)
// Revisa: vista previa sin cambiar nada, carga, Cartera y Cartera Cali, el semáforo, y que el mensaje llegue COMPLETO
// al enlace de WhatsApp (sin enviarlo: el enlace se intercepta). Deja fotos en tests/fotos/.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL_CRM = process.env.CRM_URL || 'http://127.0.0.1:4102';
const AUTH = { username: process.env.CRM_USER || 'admin', password: process.env.CRM_PASSWORD || 'prueba' };
const FOTOS = path.join(__dirname, 'fotos');
let fallas = 0;
const ok = (cond, que) => {
  console.log(`${cond ? '✅' : '❌'} ${que}`);
  if (!cond) fallas++;
};

(async () => {
  fs.mkdirSync(FOTOS, { recursive: true });
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, httpCredentials: AUTH });
  let wa = '';
  for (const host of ['https://wa.me/**', 'https://web.whatsapp.com/**']) await c.route(host, (r) => ((wa = r.request().url()), r.fulfill({ body: 'WA', contentType: 'text/html' })));
  // Las reglas de horario (Ley 2300) se prueban aparte: aquí se dejan pasar para revisar el mensaje a cualquier hora.
  await c.route('**/api/crm/collections/check*', (r) => r.fulfill({ json: { checks: [{ allowed: true, reasons: [] }] } }));
  const p = await c.newPage();
  const errores = [];
  p.on('pageerror', (e) => errores.push(e.message));
  await p.goto(`${URL_CRM}/crm`);
  const api = (url, body) => p.evaluate(([u, b]) => fetch(u, b ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) } : undefined).then((r) => r.json()), [url, body]);

  const prev = await api('/api/crm/receivables/sheet', { action: 'preview' });
  ok(prev.plan && prev.plan.invoices > 0, `Vista previa: ${prev.plan?.invoices} facturas, ${prev.plan?.customers} clientes, bloqueos: ${JSON.stringify(prev.plan?.blockers)}`);
  ok(prev.plan?.cali && prev.plan.cali.invoices > 0, `Vista previa: Cali aparte con ${prev.plan?.cali?.invoices} facturas`);
  const carga = await api('/api/crm/receivables/sheet', { action: 'update' });
  ok(carga.ok, `Carga: ${carga.error || 'cargó'}`);

  await p.goto(`${URL_CRM}/crm#por-vencer`);
  await p.reload(); // la página se abrió antes de la carga: se vuelve a leer
  await p.waitForTimeout(3000);
  const titulos = (await p.locator('h2').allInnerTexts()).map((t) => t.split('\n')[0]);
  ok(titulos.filter((t) => /^Quién debe/.test(t)).length === 1, `Cartera: «Quién debe» una sola vez (${titulos.join(' › ')})`);
  const sem = p.locator('#por-vencer');
  const burbuja = sem.locator('button[aria-expanded]').first();
  ok((await burbuja.count()) > 0, 'Por vencer: hay burbujas');
  await p.screenshot({ path: path.join(FOTOS, '1-cartera.png') });
  // Un cliente necesita WhatsApp para cobrarle: en la prueba se une uno por NIT con un celular inventado.
  const link = await api('/api/crm/receivables/links', { key: '9000000011', phone: '3000000000', name: 'CLIENTE DEMO UNO SAS' });
  ok(link.ok, `Unir CLIENTE DEMO UNO SAS con un WhatsApp de prueba: ${link.error || 'unido'}`);
  await p.reload();
  await p.waitForTimeout(3000);
  await p.locator('#por-vencer button[aria-expanded]', { hasText: 'CLIENTE DEMO UNO' }).click();
  await p.waitForTimeout(400);
  const msg = await p.locator('#por-vencer pre').innerText();
  ok(msg.includes('Hola CLIENTE DEMO UNO SAS') && msg.includes('Cordialmente'), 'Mensaje «Por vencer» con nombre completo y cierre');
  await p.locator('#por-vencer').getByRole('link', { name: /Cobrar por WhatsApp/ }).click();
  await p.waitForTimeout(1200);
  ok(wa && new URL(wa).searchParams.get('text') === msg, 'El mensaje llega COMPLETO al enlace de WhatsApp');
  await p.screenshot({ path: path.join(FOTOS, '2-mensaje.png') });
  if (!p.url().startsWith(URL_CRM)) await p.goto(`${URL_CRM}/crm`); // en algunos equipos WhatsApp se abre en la misma pestaña
  await p.waitForTimeout(2500);

  // «Recordar» deja el mensaje en Aprobaciones; ahí se abre WhatsApp con el texto y solo cuenta como enviado al confirmarlo.
  p.once('dialog', (d) => d.accept());
  const fila = p.locator('div, li').filter({ hasText: 'CLIENTE DEMO UNO' }).filter({ has: p.getByRole('button', { name: 'Recordar', exact: true }) }).last();
  await fila.getByRole('button', { name: 'Recordar', exact: true }).click();
  await p.waitForTimeout(800);
  const cola = await api('/api/crm/outbox');
  const pendiente = (cola.pending || []).find((o) => o.contactName.includes('CLIENTE DEMO UNO'));
  ok(pendiente && pendiente.body.length > 20, 'Recordar: el mensaje quedó en Aprobaciones (no se envió)');
  await p.goto(`${URL_CRM}/crm#aprobaciones`);
  await p.waitForTimeout(1500);
  const tarjeta = p.locator('[data-testid="approvals-pending"] li').filter({ hasText: 'CLIENTE DEMO UNO' });
  ok((await tarjeta.count()) === 1 && (await tarjeta.innerText()).includes(pendiente?.body.split('\n')[0] || '¿?'), 'Aprobaciones: muestra el recordatorio con su texto');
  await p.screenshot({ path: path.join(FOTOS, '4-aprobaciones.png') });
  wa = '';
  await tarjeta.getByRole('link', { name: /Abrir WhatsApp/ }).click();
  await p.waitForTimeout(1200);
  ok(wa && new URL(wa).searchParams.get('text') === pendiente?.body, 'Aprobaciones: el texto llega COMPLETO al enlace de WhatsApp');
  // Al volver al CRM (Android abre WhatsApp en la misma pestaña) sigue la pregunta «¿Lo envió?».
  await p.goto(`${URL_CRM}/crm#aprobaciones`);
  await p.reload();
  await p.waitForTimeout(1500);
  const sigue = await api('/api/crm/outbox');
  ok((sigue.pending || []).some((o) => o.id === pendiente?.id), 'Aprobaciones: abrir WhatsApp NO lo marca como enviado');
  await tarjeta.getByRole('button', { name: 'Sí, ya lo envié' }).click();
  await p.waitForTimeout(800);
  const despues = await api('/api/crm/outbox');
  ok((despues.recent || []).some((o) => o.id === pendiente?.id && o.status === 'sent'), 'Aprobaciones: «Sí, ya lo envié» lo registra como enviado');

  await p.goto(`${URL_CRM}/crm#cartera-cali`);
  await p.waitForTimeout(3000);
  const cuerpo = await p.locator('body').innerText();
  ok(cuerpo.includes('Por cobrar · Cali') && cuerpo.includes('Quién debe · Cali'), 'Cartera Cali: resumen y «Quién debe · Cali»');
  await p.locator('#por-vencer-cali button[aria-expanded]', { hasText: 'CLIENTE DEMO UNO' }).click().catch(() => {});
  await p.waitForTimeout(400);
  const msgCali = await p.locator('#por-vencer-cali pre').innerText().catch(() => '');
  ok(msgCali.includes('Xsite Group · sede Cali'), 'Mensaje de Cali firmado «Xsite Group · sede Cali»');
  await p.screenshot({ path: path.join(FOTOS, '3-cali.png') });
  const principal = await api('/api/crm/receivables/extract');
  ok(!JSON.stringify(principal).includes('CALI DEMO'), 'El extracto de la cartera principal no tiene nada de Cali');

  ok(errores.length === 0, `Sin errores en la página ${errores.length ? JSON.stringify(errores) : ''}`);
  await b.close();
  console.log(fallas ? `\n${fallas} prueba(s) fallaron` : '\nTodo bien');
  process.exit(fallas ? 1 : 0);
})();
