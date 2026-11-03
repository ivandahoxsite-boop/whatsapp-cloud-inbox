/**
 * Xsite CRM: entrega al CRM las pestañas de cartera ("Cartera por vendedor", "Cartera Cali" y las de todos los vendedores). Solo lee; no cambia nada.
 * Va en un proyecto de Apps Script APARTE (script.google.com → Nuevo proyecto), nunca dentro del de la hoja:
 * así no toca el código que ya tenga la hoja. Lo instala deploy/setup-cartera-hoja.sh, que pone la hoja y la clave.
 */
const CRM_CLAVE = '__CLAVE__';
const CRM_HOJA = '__HOJA__';
// "Import_Extracto" / "Import_ExtractoCali" traen la cartera de TODOS los vendedores: el CRM filtra la del vendedor
// que se elija en el CRM, así el filtro "Vendedor" de "Cartera por vendedor" ya no decide qué carga cada CRM.
const CRM_PESTANAS = ['Cartera por vendedor', 'Cartera Cali', 'Import_Extracto', 'Import_ExtractoCali'];

function doGet(e) {
  const salida = (o) => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
  if (!e || !e.parameter || e.parameter.k !== CRM_CLAVE) return salida({ error: 'clave' });
  const libro = SpreadsheetApp.openById(CRM_HOJA);
  const zona = libro.getSpreadsheetTimeZone();
  const pestanas = {};
  const faltan = [];
  CRM_PESTANAS.forEach((nombre) => {
    const hoja = libro.getSheetByName(nombre);
    if (!hoja) return faltan.push(nombre);
    pestanas[nombre] = hoja.getDataRange().getValues().map((fila) =>
      fila.map((v) => (v instanceof Date ? Utilities.formatDate(v, zona, 'yyyy-MM-dd') : v))
    );
  });
  if (!pestanas[CRM_PESTANAS[0]]) return salida({ error: 'No existe la pestaña ' + CRM_PESTANAS[0] });
  return salida({ ok: true, pestana: CRM_PESTANAS[0], filas: pestanas[CRM_PESTANAS[0]], pestanas: pestanas, faltan: faltan });
}
