/* eslint-disable @typescript-eslint/no-require-imports -- plain Node scripts, run with `node` */
// Hoja de Google SIMULADA para probar sin tocar la hoja real: responde como el Apps Script (deploy/cartera-apps-script.gs).
// Todos los datos son INVENTADOS (clientes "DEMO", NIT de prueba). Las fechas se calculan desde hoy para que siempre
// haya facturas que vencen hoy, mañana, vencidas y viejas.
//   node tests/hoja-simulada.js            -> escucha en http://127.0.0.1:4112/exec (clave: prueba)
//   MODO=sin-cali | cali-danada | mitad    -> casos de error (sin pestaña Cali, Cali sin títulos, media hoja)
//   MODO=grande                           -> 111 facturas de 60 clientes en la principal (para probar el scroll en el celular)
//   TAB="Cartera Alfonso" TAB_CALI="Cartera Cali Ricardo" -> otros nombres de pestaña (por defecto los de la hoja real)
//   CALI_VENDEDOR="NOMBRE"                -> la pestaña Cali trae SOLO a ese vendedor (encabezado y filas), con 10 facturas,
//                                            como el reporte real de Cali (que cambia de vendedor según quién lo exporte)
// En el CRM de prueba: CARTERA_SHEET_URL=http://127.0.0.1:4112/exec CARTERA_SHEET_KEY=prueba
const http = require('http');

const PORT = Number(process.env.PORT || 4112);
const KEY = process.env.CLAVE || 'prueba';
const day = (n) => new Date(Date.now() - 5 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
const TITLES = ['Cliente', 'Nombre_Cliente', 'T_Dcto', 'Documento', 'F_Expedic', 'F_Vencim', 'DiasVc', 'Deuda', 'Pagado', 'Venc_91', 'Venc_61_90', 'Venc_31_60', 'Venc_0_30', 'Por_Venc', 'Vencido', 'Saldo', 'Nombre_Vendedor'];
// [nit, nombre, tipo, documento, días desde expedición, plazo en días, saldo, vendedor]
const row = ([nit, name, tipo, doc, ago, plazo, saldo, seller]) => [nit, name, tipo, doc, day(-ago), day(-ago + plazo), ago, Math.abs(saldo), 0, 0, 0, 0, 0, 0, 0, saldo, seller];
const head = (corte) => [['Fecha inicio', '2021/01/01', 'Fecha final', corte, 'Vendedor', 'VENDEDOR DEMO'], []];

const principal = [
  ['900000001-1', 'CLIENTE DEMO UNO SAS', 'FV', 900101, 30, 30, 1500000, 'VENDEDOR DEMO'], // vence hoy
  ['900000001-1', 'CLIENTE DEMO UNO SAS', 'FV', 900102, 75, 30, 820000, 'VENDEDOR DEMO'], // vencida 75 días
  ['900000002-2', 'CLIENTE DEMO DOS', 'FV', 900103, 29, 30, 640000, 'VENDEDOR DEMO'], // vence mañana
  ['900000003-3', 'CLIENTE DEMO TRES', 'FV', 900104, 50, 30, 2300000, 'OTRO VENDEDOR DEMO'], // vencida 50 días
  ['900000004-4', 'CLIENTE DEMO CUATRO', 'FV', 900105, 10, 30, 450000, 'OTRO VENDEDOR DEMO'], // al día
  ['900000003-3', 'CLIENTE DEMO TRES', 'NC', 700001, 20, 0, -100000, 'OTRO VENDEDOR DEMO'] // nota crédito
];
const cali = [
  ['900000011-1', 'CLIENTE CALI DEMO UNO', 'FC', 800201, 30, 30, 980000, 'VENDEDOR DEMO'],
  ['900000012-2', 'CLIENTE CALI DEMO DOS', 'FC', 800202, 45, 30, 1250000, 'VENDEDOR DEMO'],
  ['900000001-1', 'CLIENTE DEMO UNO SAS', 'FC', 800203, 29, 30, 300000, 'VENDEDOR DEMO'], // mismo NIT que en la principal
  ['900000013-3', 'CLIENTE CALI DEMO TRES', 'FC', 800204, 20, 30, 500000, 'OTRO VENDEDOR DEMO'] // otro vendedor (filtro CARTERA_SELLER)
];

function body() {
  const modo = process.env.MODO || '';
  // MODO=grande: muchas facturas inventadas, como una cartera real, para probar pantallas largas.
  const grande = Array.from({ length: 111 }, (_, i) => [`9000001${String(i % 60).padStart(2, '0')}-${i % 9}`, `CLIENTE DEMO ${i % 60}`, 'FV', 910000 + i, (i * 7) % 120, 30, 100000 + i * 1000, 'VENDEDOR DEMO']);
  const filasPrincipal = modo === 'mitad' ? principal.slice(0, 2) : modo === 'grande' ? [...principal, ...grande] : principal;
  const main = [...head(day(0)), TITLES, ...filasPrincipal.map(row)];
  const pestanas = { 'Cartera por vendedor': main };
  if (modo === 'cali-danada') pestanas['Cartera Cali'] = [['sin títulos']];
  else if (process.env.CALI_VENDEDOR) {
    // Report of ONE seller, as the real "Cartera Cali" tab: its name in the header and in every row.
    const v = process.env.CALI_VENDEDOR;
    const filas = [
      ['900000011-1', 'CLIENTE CALI DEMO UNO', 'FC', 800201, 30, 30, 980000], // vence hoy
      ['900000012-2', 'CLIENTE CALI DEMO DOS', 'FC', 800202, 45, 30, 1250000], // 45 días
      ['900000012-2', 'CLIENTE CALI DEMO DOS', 'FC', 800205, 70, 30, 410000], // 70 días
      ['900000014-4', 'CLIENTE CALI DEMO CUATRO', 'FC', 800206, 95, 30, 760000], // más de 90
      ['900000015-5', 'CLIENTE CALI DEMO CINCO', 'FC', 800207, 33, 30, 120000], // vencida hace 3 días
      ['900000016-6', 'CLIENTE CALI DEMO SEIS', 'FC', 800208, 26, 30, 230000], // vence en 4 días
      ['900000017-7', 'CLIENTE CALI DEMO SIETE', 'FC', 800209, 12, 30, 540000], // al día
      ['900000001-1', 'CLIENTE DEMO UNO SAS', 'FC', 800203, 29, 30, 300000], // mismo NIT que en la principal
      ['900000018-8', 'CLIENTE CALI DEMO OCHO', 'FC', 800210, 58, 30, 650000], // 58 días
      ['900000018-8', 'CLIENTE CALI DEMO OCHO', 'NC', 700210, 20, 0, -50000] // nota crédito
    ];
    pestanas['Cartera Cali'] = [['Fecha inicio', '2021/01/01', 'Fecha final', day(0), 'Vendedor', v], [], TITLES, ...filas.map((f) => row([...f, v]))];
  } else if (modo !== 'sin-cali') pestanas['Cartera Cali'] = [...head(day(0)), TITLES, ...cali.map(row)];
  // Other tab names (TAB, TAB_CALI), as an Apps Script with another CRM_PESTANAS would send them.
  const tab = process.env.TAB || 'Cartera por vendedor';
  const tabCali = process.env.TAB_CALI || 'Cartera Cali';
  const renamed = {};
  for (const [k, v] of Object.entries(pestanas)) renamed[k === 'Cartera por vendedor' ? tab : k === 'Cartera Cali' ? tabCali : k] = v;
  return { ok: true, pestana: tab, filas: main, pestanas: renamed, faltan: modo === 'sin-cali' ? [tabCali] : [] };
}

http
  .createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (u.searchParams.get('k') !== KEY) return res.end('{"error":"clave"}');
    res.end(JSON.stringify(body()));
  })
  .listen(PORT, () => console.log(`Hoja simulada en http://127.0.0.1:${PORT}/exec (clave: ${KEY})`));
