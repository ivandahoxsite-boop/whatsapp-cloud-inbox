/* eslint-disable @typescript-eslint/no-require-imports -- plain Node scripts, run with `node` */
// Que en un CELULAR (pantalla táctil) se pueda deslizar hasta «Quién debe», en Cartera y en Cartera Cali.
// Contra el CRM de PRUEBA ya cargado (mejor con la hoja simulada en MODO=grande):  node tests/scroll.e2e.js
// Ojo: una foto de página completa sale bien aunque la página no se pueda deslizar; por eso aquí se desliza de verdad.
const { chromium, devices } = require('playwright');

const URL_CRM = process.env.CRM_URL || 'http://127.0.0.1:4102';
const AUTH = { username: process.env.CRM_USER || 'admin', password: process.env.CRM_PASSWORD || 'prueba' };
let fallas = 0;
const ok = (cond, que) => {
  console.log(`${cond ? '✅' : '❌'} ${que}`);
  if (!cond) fallas++;
};

(async () => {
  const b = await chromium.launch();
  const c = await b.newContext({ ...devices['Pixel 7'], httpCredentials: AUTH });
  const p = await c.newPage();
  for (const [hash, titulo] of [['', /^Quién debe/], ['#cartera-cali', /^Quién debe · Cali/]]) {
    await p.goto(`${URL_CRM}/crm`);
    await p.evaluate(() => {
      localStorage.setItem('crm-cartera-view', 'resumen');
      localStorage.setItem('crm-cali-view', 'resumen');
    });
    await p.goto(`${URL_CRM}/crm${hash}`);
    await p.reload();
    await p.waitForTimeout(2500);
    const h = p.getByRole('heading', { name: titulo }).first();
    // Deslizar con la rueda en el centro de la pantalla, como un dedo (no se usa scrollIntoView, que mueve aunque no se deba).
    for (let i = 0; i < 40; i++) {
      const box = await h.boundingBox();
      if (box && box.y >= 0 && box.y < 800) break;
      await p.mouse.move(200, 400);
      await p.mouse.wheel(0, 600);
      await p.waitForTimeout(80);
    }
    const box = await h.boundingBox();
    ok(!!box && box.y >= 0 && box.y < 800, `${hash ? 'Cartera Cali' : 'Cartera'}: se puede deslizar hasta «${await h.innerText().catch(() => '?')}»`);
  }
  await b.close();
  console.log(fallas ? `\n${fallas} prueba(s) fallaron` : '\nTodo bien');
  process.exit(fallas ? 1 : 0);
})();
