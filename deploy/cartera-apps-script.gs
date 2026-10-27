/**
 * @OnlyCurrentDoc
 * Xsite CRM: entrega al CRM la pestaña "Cartera por vendedor" de esta hoja. Solo lee; no cambia nada.
 * Lo instala deploy/setup-cartera-hoja.sh, que pone la clave de abajo (la misma que guarda el CRM).
 */
const CLAVE = '__CLAVE__';
const PESTANA = 'Cartera por vendedor';

function doGet(e) {
  const salida = (o) => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
  if (!e || !e.parameter || e.parameter.k !== CLAVE) return salida({ error: 'clave' });
  const libro = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = libro.getSheetByName(PESTANA);
  if (!hoja) return salida({ error: 'No existe la pestaña ' + PESTANA });
  const zona = libro.getSpreadsheetTimeZone();
  const filas = hoja.getDataRange().getValues().map((fila) =>
    fila.map((v) => (v instanceof Date ? Utilities.formatDate(v, zona, 'yyyy-MM-dd') : v))
  );
  return salida({ ok: true, pestana: PESTANA, filas: filas });
}
