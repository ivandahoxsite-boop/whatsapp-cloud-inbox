/* eslint-disable @typescript-eslint/no-require-imports -- plain Node scripts, run with `node` */
// Filtros por días, con Playwright, contra el CRM de PRUEBA ya cargado por tests/cartera.e2e.js (misma hoja simulada):
//   node tests/cartera.e2e.js && node tests/filtros.e2e.js
// Revisa: «Antigüedad de la deuda» filtra «Quién debe» (Cartera y Cartera Cali) y el filtro «Días» del Extracto.
// Hoja simulada: la factura 900102 (CLIENTE DEMO UNO SAS) lleva 75 días; en Cali la 800202 lleva 45.
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
  const p = await c.newPage();
  const errores = [];
  p.on('pageerror', (e) => errores.push(e.message));
  const vista = async (v, hash = '') => {
    await p.goto(`${URL_CRM}/crm`);
    await p.evaluate((x) => localStorage.setItem('crm-cartera-view', x), v);
    await p.goto(`${URL_CRM}/crm${hash}`);
    await p.reload();
    await p.waitForTimeout(2500);
  };

  // A) Cartera: tocar «61-90 días» deja en «Quién debe» solo a quien tiene facturas en ese rango.
  await vista('resumen');
  const antig = p.locator('section', { has: p.getByRole('heading', { name: 'Antigüedad de la deuda', exact: true }) });
  await antig.getByRole('button', { name: /61-90 días/ }).click();
  await p.waitForTimeout(1500);
  const quien = p.locator('section', { has: p.getByRole('heading', { name: /^Quién debe · 61-90 días/ }) });
  const textoQuien = (await quien.count()) ? await quien.innerText() : '';
  ok(textoQuien.includes('CLIENTE DEMO UNO') && !textoQuien.includes('CLIENTE DEMO DOS'), 'Cartera: «61-90 días» filtra «Quién debe»');
  await p.screenshot({ path: path.join(FOTOS, '5-filtro-antiguedad.png'), fullPage: true });

  // B) Cartera Cali: su propia antigüedad, y también filtra.
  await vista('resumen', '#cartera-cali');
  const antigCali = p.locator('section', { has: p.getByRole('heading', { name: 'Antigüedad de la deuda · Cali' }) });
  ok((await antigCali.count()) === 1, 'Cartera Cali: tiene «Antigüedad de la deuda · Cali»');
  await antigCali.getByRole('button', { name: /31-60 días/ }).click();
  await p.waitForTimeout(800);
  ok((await p.getByRole('heading', { name: /Quién debe · Cali · 31-60 días/ }).count()) === 1, 'Cartera Cali: «31-60 días» filtra «Quién debe · Cali»');

  // C) Extracto: el filtro «Días» deja solo las facturas de ese rango y rehace los totales.
  await vista('extracto');
  const tabla = p.locator('table').first();
  await p.getByRole('group', { name: 'Filtrar por días' }).getByRole('button', { name: '61-90 días' }).click();
  await p.waitForTimeout(500);
  const cuerpo = await tabla.locator('tbody').innerText();
  ok(cuerpo.includes('900102') && !cuerpo.includes('900101') && !cuerpo.includes('900104'), 'Extracto: «61-90 días» deja solo la factura de 75 días');
  ok((await tabla.locator('tfoot').innerText()).includes('Total filtrado'), 'Extracto: el total dice «Total filtrado»');
  await p.screenshot({ path: path.join(FOTOS, '6-extracto-filtro.png'), fullPage: true });
  await p.getByRole('group', { name: 'Filtrar por días' }).getByRole('button', { name: 'Todos' }).click();
  await p.waitForTimeout(300);
  ok((await tabla.locator('tbody').innerText()).includes('900101'), 'Extracto: «Todos» vuelve a mostrar todo');

  ok(errores.length === 0, `Sin errores en la página ${errores.length ? JSON.stringify(errores) : ''}`);
  await b.close();
  console.log(fallas ? `\n${fallas} prueba(s) fallaron` : '\nTodo bien');
  process.exit(fallas ? 1 : 0);
})();
