/**
 * Xsite CRM: entrega al CRM la pestaña "Cartera por vendedor". Solo lee; no cambia nada.
 * Va en un proyecto de Apps Script APARTE (script.google.com → Nuevo proyecto), nunca dentro del de la hoja:
 * así no toca el código que ya tenga la hoja. Lo instala deploy/setup-cartera-hoja.sh, que pone la hoja y la clave.
 */
const CRM_CLAVE = '__CLAVE__';
const CRM_HOJA = '__HOJA__';
const CRM_PESTANA = 'Cartera por vendedor';

function doGet(e) {
  const salida = (o) => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
  if (!e || !e.parameter || e.parameter.k !== CRM_CLAVE) return salida({ error: 'clave' });
  const libro = SpreadsheetApp.openById(CRM_HOJA);
  const hoja = libro.getSheetByName(CRM_PESTANA);
  if (!hoja) return salida({ error: 'No existe la pestaña ' + CRM_PESTANA });
  const zona = libro.getSpreadsheetTimeZone();
  const filas = hoja.getDataRange().getValues().map((fila) =>
    fila.map((v) => (v instanceof Date ? Utilities.formatDate(v, zona, 'yyyy-MM-dd') : v))
  );
  return salida({ ok: true, pestana: CRM_PESTANA, filas: filas });
}
