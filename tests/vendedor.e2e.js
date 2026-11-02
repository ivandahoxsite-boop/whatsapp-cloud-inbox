// Prueba del filtro por vendedor (CARTERA_SELLER) contra un CRM de PRUEBA y la hoja simulada. No carga nada: solo
// pide la vista previa. Arranque el CRM de prueba con CARTERA_SELLER="vendedor demo" (en minúsculas a propósito:
// se compara sin mayúsculas ni tildes) y luego:  node tests/vendedor.e2e.js
// Con CARTERA_SELLER="NADIE" debe frenar la carga:  ESPERA=nadie node tests/vendedor.e2e.js
// Con CARTERA_CALI_SELLER="otro vendedor demo" (Cali con otro vendedor):  ESPERA=cali-otro node tests/vendedor.e2e.js
const URL_CRM = process.env.CRM_URL || 'http://127.0.0.1:4102';
const AUTH = 'Basic ' + Buffer.from(`${process.env.CRM_USER || 'admin'}:${process.env.CRM_PASSWORD || 'prueba'}`).toString('base64');
let fallas = 0;
const ok = (cond, que) => {
  console.log(`${cond ? '✅' : '❌'} ${que}`);
  if (!cond) fallas++;
};

(async () => {
  const r = await fetch(`${URL_CRM}/api/crm/receivables/sheet`, {
    method: 'POST',
    headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'preview' })
  });
  const { plan } = await r.json();
  if (process.env.ESPERA === 'nadie') {
    ok(plan.invoices === 0, `Vendedor que no existe: 0 facturas (${plan.invoices})`);
    ok(plan.blockers.some((b) => b.includes('no trae facturas del vendedor')), `Vendedor que no existe: la carga se frena (${plan.blockers.join(' | ')})`);
    ok(!plan.cali && /no trae facturas del vendedor/.test(plan.caliError || ''), `Cali con vendedor que no existe: se deja la copia anterior (${plan.caliError})`);
  } else {
    // Hoja simulada: 3 facturas de VENDEDOR DEMO; de OTRO VENDEDOR DEMO, 2 facturas y 1 nota crédito.
    ok(plan.seller === 'VENDEDOR DEMO', `Filtro activo: ${plan.seller}`);
    ok(plan.invoices === 3, `Solo las facturas de ese vendedor: ${plan.invoices} (deben ser 3)`);
    ok(plan.otherSellers === 3, `Filas de otros vendedores que no se cargan: ${plan.otherSellers} (deben ser 3)`);
    ok(plan.creditNotes === 0, `La nota crédito del otro vendedor no entra: ${plan.creditNotes}`);
    // Cali: con CARTERA_CALI_SELLER="otro vendedor demo" solo entra su factura; sin esa variable, Cali usa CARTERA_SELLER.
    const caliEsperadas = process.env.ESPERA === 'cali-otro' ? 1 : 3;
    ok(plan.cali && plan.cali.invoices === caliEsperadas, `Cali filtrada: ${plan.cali?.invoices} facturas (deben ser ${caliEsperadas})`);
    ok(plan.blockers.length === 0, `Sin bloqueos: ${JSON.stringify(plan.blockers)}`);
  }
  console.log(fallas ? `\n${fallas} prueba(s) fallaron` : '\nTodo bien');
  process.exit(fallas ? 1 : 0);
})();
