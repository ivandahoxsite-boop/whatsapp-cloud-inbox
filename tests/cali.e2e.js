/* eslint-disable @typescript-eslint/no-require-imports -- plain Node scripts, run with `node` */
// «Cartera Cali» con SU PROPIO vendedor (distinto al de Medellín), como en el CRM real, en un celular táctil.
// CRM de PRUEBA con CARTERA_SELLER="VENDEDOR DEMO" y CARTERA_CALI_SELLER="RICARDO DEMO". Dos fases:
//   1) hoja simulada con CALI_VENDEDOR="IVAN DEMO"   -> FASE=1 node tests/cali.e2e.js  (Cali no se mezcla: aviso y vacía)
//   2) hoja simulada con CALI_VENDEDOR="RICARDO DEMO" -> FASE=2 node tests/cali.e2e.js  (todo lo de Medellín, en Cali)
const { chromium, devices } = require('playwright');
const path = require('path');

const URL_CRM = process.env.CRM_URL || 'http://127.0.0.1:4102';
const AUTH = { username: process.env.CRM_USER || 'admin', password: process.env.CRM_PASSWORD || 'prueba' };
const FOTOS = path.join(__dirname, 'fotos');
const FASE = process.env.FASE || '2';
let fallas = 0;
const ok = (cond, que) => {
  console.log(`${cond ? '✅' : '❌'} ${que}`);
  if (!cond) fallas++;
};

(async () => {
  const b = await chromium.launch();
  const c = await b.newContext({ ...devices['Pixel 7'], httpCredentials: AUTH });
  let wa = '';
  for (const host of ['https://wa.me/**', 'https://web.whatsapp.com/**']) await c.route(host, (r) => ((wa = r.request().url()), r.fulfill({ body: 'WA', contentType: 'text/html' })));
  // Las reglas de horario (Ley 2300) se prueban aparte: aquí se dejan pasar para revisar los mensajes a cualquier hora.
  await c.route('**/api/crm/collections/check*', (r) => r.fulfill({ json: { checks: [{ allowed: true, reasons: [] }] } }));
  const p = await c.newPage();
  const errores = [];
  p.on('pageerror', (e) => errores.push(e.message));
  p.on('dialog', (d) => d.accept());
  const abrirCali = async (vista = 'resumen') => {
    await p.goto(`${URL_CRM}/crm`);
    await p.evaluate((v) => localStorage.setItem('crm-cali-view', v), vista);
    await p.goto(`${URL_CRM}/crm#cartera-cali`);
    await p.reload();
    await p.waitForTimeout(2500);
  };
  // Desliza con el dedo (rueda) hasta que el elemento esté en pantalla.
  const bajarHasta = async (loc) => {
    for (let i = 0; i < 60; i++) {
      const box = await loc.boundingBox();
      if (box && box.y >= 60 && box.y < 700) return true;
      await p.mouse.move(200, 400);
      await p.mouse.wheel(0, box && box.y < 60 ? -300 : 400);
      await p.waitForTimeout(60);
    }
    return false;
  };

  // Se carga con el botón de la pantalla, como lo hace la persona.
  await abrirCali();
  await p.getByRole('button', { name: /Actualizar/ }).first().click();
  await p.waitForTimeout(800);
  const confirmar = p.getByRole('button', { name: 'Confirmar y cargar' });
  if (await confirmar.count()) await confirmar.click();
  await p.waitForTimeout(3000);
  await abrirCali();
  const cuerpo = await p.locator('body').innerText();

  if (FASE === '1') {
    ok(/no trae facturas del vendedor RICARDO DEMO/.test(cuerpo), 'Hoja con otro vendedor en Cali: el CRM avisa que no trae facturas de RICARDO');
    ok(!cuerpo.includes('IVAN DEMO'), 'No aparece nada de IVAN DEMO en Cali');
  } else {
    ok(!/no trae facturas del vendedor/.test(cuerpo), 'Con RICARDO en la hoja: Cali carga sin aviso');
    ok(cuerpo.includes('Vendedor: RICARDO DEMO') && !cuerpo.includes('IVAN DEMO'), 'Arriba dice «Vendedor: RICARDO DEMO» y nada de IVAN');
    ok(!(await p.locator('select[aria-label="Vendedor"]').count()), 'Sin selector de «Todos los vendedores»');
    ok(cuerpo.includes('Por cobrar · Cali') && /Facturas abiertas\s*9/.test(cuerpo), 'Tarjetas de Cali con sus 9 facturas (la nota crédito va aparte)');

    // Por vencer · Cali: rangos y burbujas.
    const pv = p.locator('#por-vencer-cali');
    await pv.getByRole('button', { name: 'Vencidas 15 días' }).click();
    await p.waitForTimeout(1200);
    ok((await pv.locator('button[aria-expanded]', { hasText: 'CLIENTE CALI DEMO CINCO' }).count()) === 1, 'Por vencer · Cali: «Vencidas 15 días» muestra al cliente vencido hace 3 días');
    await pv.getByRole('button', { name: '7 días' }).click();
    await p.waitForTimeout(1200);
    ok((await pv.locator('button[aria-expanded]', { hasText: 'CLIENTE CALI DEMO SEIS' }).count()) === 1, 'Por vencer · Cali: «7 días» muestra al que vence en 4 días');

    // Antigüedad · Cali filtra «Quién debe · Cali».
    const antig = p.locator('section', { has: p.getByRole('heading', { name: 'Antigüedad de la deuda · Cali' }) });
    ok(await bajarHasta(antig.getByRole('button', { name: /61-90 días/ })), 'Se puede deslizar hasta «Antigüedad de la deuda · Cali»');
    await antig.getByRole('button', { name: /61-90 días/ }).click();
    await p.waitForTimeout(800);
    const quien = p.locator('#quien-debe-cali');
    const tq = await quien.innerText();
    ok(/Quién debe · Cali · 61-90 días/.test(tq) && tq.includes('CLIENTE CALI DEMO DOS') && !tq.includes('CLIENTE CALI DEMO CUATRO'), 'Antigüedad · Cali: «61-90 días» filtra «Quién debe · Cali»');
    await quien.getByRole('button', { name: 'Quitar filtro' }).click();
    await p.waitForTimeout(500);
    ok(await bajarHasta(quien.getByRole('heading', { name: /^Quién debe · Cali/ })), 'Se puede deslizar hasta «Quién debe · Cali»');

    // Clientes de Cali sin WhatsApp: facturas y mensaje para enviar eligiendo el chat.
    const sin = p.locator('section', { has: p.getByRole('heading', { name: /Clientes de Cali sin WhatsApp/ }) });
    const fila = sin.locator('li', { hasText: 'CLIENTE CALI DEMO CUATRO' }).first();
    await bajarHasta(fila);
    await fila.getByRole('button', { name: /CLIENTE CALI DEMO CUATRO/ }).click();
    await p.waitForTimeout(1000);
    const panel = fila.getByTestId('sin-whatsapp-facturas');
    const msg = await panel.locator('pre').innerText().catch(() => '');
    ok((await panel.innerText()).includes('800206') && msg.includes('sede Cali'), 'Cali sin WhatsApp: se ven sus facturas y el mensaje firmado «sede Cali»');
    await p.screenshot({ path: path.join(FOTOS, '8-cali-sin-whatsapp.png') });
    wa = '';
    await panel.getByRole('link', { name: /Enviar por WhatsApp/ }).click();
    await p.waitForTimeout(1200);
    ok(wa.startsWith('https://wa.me/?text=') && new URL(wa).searchParams.get('text') === msg, 'Cali sin WhatsApp: el mensaje llega COMPLETO a WhatsApp (eligiendo el chat)');

    // Extracto de Cali: filtro de días y nota crédito restando.
    await abrirCali('extracto');
    const ex = await p.locator('table').first().innerText();
    ok(ex.includes('800206') && ex.includes('700210') && ex.includes('RICARDO DEMO') === false, 'Extracto Cali: trae sus facturas y la nota crédito');
    await p.getByRole('group', { name: 'Filtrar por días' }).getByRole('button', { name: 'Más de 90' }).click();
    await p.waitForTimeout(400);
    const ex90 = await p.locator('table').first().locator('tbody').innerText();
    ok(ex90.includes('800206') && !ex90.includes('800202'), 'Extracto Cali: «Más de 90» deja solo la factura de 95 días');
    await p.screenshot({ path: path.join(FOTOS, '9-cali-extracto.png') });

    // Al tocar un rango de «Antigüedad», la pantalla baja sola a «Quién debe» filtrado (no se queda en «sin WhatsApp»).
    const enPantalla = async (loc) => {
      const box = await loc.boundingBox();
      return !!box && box.y >= 0 && box.y < 420;
    };
    await abrirCali();
    await p.locator('section', { has: p.getByRole('heading', { name: 'Antigüedad de la deuda · Cali' }) }).getByRole('button', { name: /Más de 90/ }).click();
    await p.waitForTimeout(1500);
    ok(await enPantalla(p.getByRole('heading', { name: /Quién debe · Cali · Más de 90/ })), 'Cali: al tocar «Más de 90» la pantalla baja sola a «Quién debe · Cali · Más de 90»');
    await p.screenshot({ path: path.join(FOTOS, '10-cali-salto.png') });

    await p.goto(`${URL_CRM}/crm`);
    await p.evaluate(() => localStorage.setItem('crm-cartera-view', 'resumen'));
    await p.reload();
    await p.waitForTimeout(2500);
    await p.locator('section', { has: p.getByRole('heading', { name: 'Antigüedad de la deuda', exact: true }) }).getByRole('button', { name: /Más de 90/ }).click();
    await p.waitForTimeout(1500);
    const qd = p.getByRole('heading', { name: /^Quién debe · Más de 90/ });
    ok(await enPantalla(qd), 'Medellín: al tocar «Más de 90» la pantalla baja sola a «Quién debe · Más de 90»');
    const lista = await p.locator('#quien-debe').innerText();
    ok(/🧾 Fact\. \d+ · \d+ días/.test(lista) && !/al día/.test(lista), 'Medellín: «Quién debe» muestra cada factura con sus días (solo las del rango)');
    ok(lista.includes('Únelo con su WhatsApp'), 'Medellín: a los clientes sin WhatsApp les dice cómo unirlos');
    await p.screenshot({ path: path.join(FOTOS, '11-medellin-salto.png') });
  }
  ok(errores.length === 0, `Sin errores en la página ${errores.length ? JSON.stringify(errores) : ''}`);
  await b.close();
  console.log(fallas ? `\n${fallas} prueba(s) fallaron` : '\nTodo bien');
  process.exit(fallas ? 1 : 0);
})();
