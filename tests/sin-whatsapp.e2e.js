/* eslint-disable @typescript-eslint/no-require-imports -- plain Node scripts, run with `node` */
// Clientes de la hoja SIN WhatsApp: al tocarlos se ven sus facturas y el mensaje de cobro, y se puede enviar eligiendo el
// chat en WhatsApp (wa.me/?text=, sin número) o copiarlo. Contra el CRM de PRUEBA ya cargado por tests/cartera.e2e.js:
//   node tests/cartera.e2e.js && node tests/sin-whatsapp.e2e.js
// Hoja simulada: CLIENTE DEMO TRES debe la 900104 con 50 días; CLIENTE DEMO DOS la 900103 sin vencer;
// en Cali, CLIENTE CALI DEMO DOS debe la 800202 con 45 días.
const { chromium } = require('playwright');
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
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, httpCredentials: AUTH });
  let wa = '';
  for (const host of ['https://wa.me/**', 'https://web.whatsapp.com/**']) await c.route(host, (r) => ((wa = r.request().url()), r.fulfill({ body: 'WA', contentType: 'text/html' })));
  const p = await c.newPage();
  const errores = [];
  p.on('pageerror', (e) => errores.push(e.message));
  const api = (url) => p.evaluate((u) => fetch(u).then((r) => r.json()), url);

  await p.goto(`${URL_CRM}/crm`);
  // La regla de cobro de un cliente sin WhatsApp no debe exigir teléfono (las demás reglas sí aplican).
  const clientes = (await api('/api/crm/receivables/links')).clients;
  const tres = clientes.find((x) => x.name.includes('CLIENTE DEMO TRES'));
  const regla = await api(`/api/crm/collections/check?customerId=${tres.contactId}&sinTelefono=1`);
  ok(!regla.checks[0].reasons.includes('No tiene teléfono'), `Regla de cobro sin WhatsApp: no pide teléfono (${regla.checks[0].reasons.join(', ') || 'permitido'})`);
  const sinMarca = await api(`/api/crm/collections/check?customerId=${tres.contactId}`);
  ok(sinMarca.checks[0].reasons.includes('No tiene teléfono'), 'Sin la marca, la regla de siempre sigue pidiendo teléfono');

  // Las reglas de horario se prueban aparte: aquí se dejan pasar para revisar el mensaje a cualquier hora.
  await c.route('**/api/crm/collections/check*', (r) => r.fulfill({ json: { checks: [{ allowed: true, reasons: [] }] } }));
  await p.evaluate(() => localStorage.setItem('crm-cartera-view', 'resumen'));
  await p.reload();
  await p.waitForTimeout(2500);
  const seccion = p.locator('section', { has: p.getByRole('heading', { name: /Clientes de la hoja sin WhatsApp/ }) });
  const fila = seccion.locator('li', { hasText: 'CLIENTE DEMO TRES' }).first();
  await fila.getByRole('button', { name: /CLIENTE DEMO TRES/ }).click();
  await p.waitForTimeout(800);
  const panel = fila.getByTestId('sin-whatsapp-facturas');
  const textoPanel = await panel.innerText();
  ok(textoPanel.includes('900104') && /\b(49|50|51) días/.test(textoPanel), 'Al tocar el cliente se ven sus facturas con los días'); // 50 días ± el cambio de fecha a medianoche
  const msg = await panel.locator('pre').innerText();
  ok(msg.includes('900104') && msg.includes('Xsite Group'), 'Se ve el mensaje de cobro (texto aprobado de «Quién debe»)');
  await p.screenshot({ path: path.join(FOTOS, '7-sin-whatsapp.png'), fullPage: true });
  await panel.getByRole('link', { name: /Enviar por WhatsApp/ }).click();
  await p.waitForTimeout(1200);
  ok(wa.startsWith('https://wa.me/?text=') && new URL(wa).searchParams.get('text') === msg, 'Enviar: WhatsApp se abre SIN número y con el mensaje COMPLETO');

  // Menos de 30 días: no lleva mensaje de cobro (misma regla que «Quién debe»).
  if (!p.url().startsWith(URL_CRM)) await p.goto(`${URL_CRM}/crm`);
  await p.waitForTimeout(2000);
  const dos = p.locator('section', { has: p.getByRole('heading', { name: /Clientes de la hoja sin WhatsApp/ }) }).locator('li', { hasText: 'CLIENTE DEMO DOS' }).first();
  await dos.getByRole('button', { name: /CLIENTE DEMO DOS/ }).click();
  await p.waitForTimeout(800);
  ok((await dos.getByTestId('sin-whatsapp-facturas').innerText()).includes('menos de 30 días'), 'Menos de 30 días: avisa que no lleva mensaje de cobro');

  // Cali: sus facturas y el mensaje firmado por la sede Cali.
  await p.goto(`${URL_CRM}/crm#cartera-cali`);
  await p.evaluate(() => localStorage.setItem('crm-cali-view', 'resumen'));
  await p.reload();
  await p.waitForTimeout(2500);
  const caliFila = p.locator('li', { hasText: 'CLIENTE CALI DEMO DOS' }).filter({ has: p.getByRole('button', { name: /CLIENTE CALI DEMO DOS/ }) }).first();
  await caliFila.getByRole('button', { name: /CLIENTE CALI DEMO DOS/ }).click();
  await p.waitForTimeout(800);
  const caliMsg = await caliFila.getByTestId('sin-whatsapp-facturas').locator('pre').innerText().catch(() => '');
  ok(caliMsg.includes('800202') && caliMsg.includes('sede Cali'), 'Cali: facturas y mensaje firmado «sede Cali»');

  ok(errores.length === 0, `Sin errores en la página ${errores.length ? JSON.stringify(errores) : ''}`);
  await b.close();
  console.log(fallas ? `\n${fallas} prueba(s) fallaron` : '\nTodo bien');
  process.exit(fallas ? 1 : 0);
})();
