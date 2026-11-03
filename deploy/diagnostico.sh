#!/usr/bin/env bash
# Shows the state of this cartera CRM in one go, to find why a tab does not show what it should. READ-ONLY.
# Prints only seller names, counts and dates: no customers, NIT, phones, keys or passwords.
#   bash /opt/crm-cartera/deploy/diagnostico.sh
set -uo pipefail
DIR=$(cd "$(dirname "$0")" && pwd)
. "$DIR/instance.sh"
[ "$(id -u)" -eq 0 ] || { echo "Ejecuta como root."; exit 1; }
set -a; . "$ENV_FILE"; set +a

echo "== 1. Versión instalada";   sudo -u "$RUN_USER" git -C "$APP" log --oneline -1 </dev/null
echo "== 2. Servicio";            systemctl is-active "$SERVICE" </dev/null
echo "== 3. Vendedores configurados"
echo "   Cartera (Medellín): ${CARTERA_SELLER:-(todos)}"
echo "   Cartera Cali:       ${CARTERA_CALI_SELLER:-${CARTERA_SELLER:-(todos)}}"

echo "== 4. Lo que trae la hoja AHORA (vendedor -> filas)"
printf 'url = "%s?k=%s"\n' "$CARTERA_SHEET_URL" "$CARTERA_SHEET_KEY" | curl -sL --max-time 90 -K - | python3 -c "
import sys,json,collections
try: b=json.load(sys.stdin)
except Exception: print('   No pude leer la hoja (¿Apps Script caído?)'); sys.exit()
if b.get('error'): print('   ERROR de la hoja:',b['error']); sys.exit()
for nombre,filas in (b.get('pestanas') or {}).items():
  h=next((i for i,f in enumerate(filas) if 'Documento' in [str(c).strip() for c in f] and 'Cliente' in [str(c).strip() for c in f]),None)
  if h is None: print('  ',nombre,': no encuentro la fila de títulos'); continue
  t=[str(c).strip() for c in filas[h]]
  iv=t.index('Nombre_Vendedor') if 'Nombre_Vendedor' in t else -1
  idoc=t.index('Documento')
  c=collections.Counter((str(f[iv]).strip() if iv>=0 else '') or '(vacía)' for f in filas[h+1:] if str(f[idoc]).strip())
  print('  ',nombre+':',', '.join(f'{k} -> {n}' for k,n in c.most_common()) or 'sin filas')
print('   pestañas que faltan:',b.get('faltan') or 'ninguna')
"

echo "== 5. Lo que tiene el CRM"
node --no-warnings -e "
const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1],{readOnly:true});
const g=k=>{const r=d.prepare('SELECT value FROM settings WHERE key=?').get(k);try{return r?JSON.parse(r.value):null}catch{return null}};
const m={};for(const r of d.prepare(\"SELECT seller, COUNT(*) n FROM receivables WHERE status='open' GROUP BY seller\").all())m[r.seller]=r.n;
console.log('   Cartera (Medellín):',Object.entries(m).map(([k,n])=>k+' -> '+n).join(', ')||'sin facturas');
const c=g('cartera_cali');const cm={};for(const i of (c&&c.invoices)||[])cm[i.seller]=(cm[i.seller]||0)+1;
console.log('   Cartera Cali guardada:',Object.entries(cm).map(([k,n])=>k+' -> '+n).join(', ')||'sin facturas', c?'(leída '+c.at+')':'');
if(c&&c.error)console.log('   Aviso de Cali:',c.error);
const l=g('cartera_sheet_last');console.log('   Última carga:',l?l.at+' · '+(l.ok?'bien':'NO cargó: '+l.error)+(l.caliError?' · Cali: '+l.caliError:''):'ninguna');
const w=d.prepare(\"SELECT COUNT(*) n FROM cartera_links WHERE status='linked'\").get().n;console.log('   Clientes con WhatsApp unido:',w);
" "${CRM_DB_PATH:-$DATA/crm.db}"
