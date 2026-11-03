#!/usr/bin/env bash
# Squares the sheet against this cartera CRM: why the sheet's total Saldo and the CRM's «Por cobrar» differ. READ-ONLY.
# Prints only document types, counts and amounts (and document numbers of the rows left out): no customer names,
# NIT, phones, keys or passwords.
#   bash /opt/crm-cartera/deploy/cuadre.sh
set -uo pipefail
DIR=$(cd "$(dirname "$0")" && pwd)
. "$DIR/instance.sh"
[ "$(id -u)" -eq 0 ] || { echo "Ejecuta como root."; exit 1; }
set -a; . "$ENV_FILE"; set +a
DB="${CRM_DB_PATH:-$DATA/crm.db}"

TMP=$(mktemp); trap 'rm -f "$TMP"' EXIT
printf 'url = "%s?k=%s"\n' "$CARTERA_SHEET_URL" "$CARTERA_SHEET_KEY" | curl -sL --max-time 90 -K - > "$TMP"
CRM_TOTALS=$(node --no-warnings -e "
const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1],{readOnly:true});
const m=d.prepare(\"SELECT COUNT(*) n, COALESCE(SUM(balance),0) s FROM receivables WHERE status='open' AND source='cartera'\").get();
const r=d.prepare(\"SELECT value FROM settings WHERE key='cartera_cali'\").get();let c={invoices:[],credits:[]};try{c=r?JSON.parse(r.value):c}catch{}
const docs=d.prepare(\"SELECT external_id FROM receivables WHERE status='open' AND source='cartera'\").all().map(x=>x.external_id);
console.log(JSON.stringify({n:m.n,s:m.s,cn:c.invoices.length,cs:c.invoices.reduce((a,i)=>a+i.balance,0),docs}));" "$DB")

CRM_TOTALS="$CRM_TOTALS" CARTERA_TAB="${CARTERA_TAB:-}" CARTERA_CALI_TAB="${CARTERA_CALI_TAB:-Cartera Cali}" \
CARTERA_SELLER="${CARTERA_SELLER:-}" CARTERA_CALI_SELLER="${CARTERA_CALI_SELLER:-}" python3 - "$TMP" <<'PY'
import sys, json, os, re, unicodedata, collections
money = lambda n: '$' + f'{round(n):,}'.replace(',', '.')
def key(s): return re.sub(r'\s+', ' ', unicodedata.normalize('NFD', str(s)).encode('ascii', 'ignore').decode().upper()).strip()
def num(v):
    if isinstance(v, (int, float)): return float(v)
    t = str(v).strip().replace('$', '').replace(' ', '')
    if not t: return float('nan')
    neg = t.startswith('(') and t.endswith(')') or t.startswith('-')
    t = t.strip('()-')
    if re.fullmatch(r'\d{1,3}(\.\d{3})+(,\d+)?', t): t = t.replace('.', '').replace(',', '.')
    elif re.fullmatch(r'\d{1,3}(,\d{3})+(\.\d+)?', t): t = t.replace(',', '')
    else: t = t.replace(',', '.')
    try: x = float(t)
    except ValueError: return float('nan')
    return -x if neg else x
try: b = json.load(open(sys.argv[1]))
except Exception: print('No pude leer la hoja.'); sys.exit()
if b.get('error'): print('ERROR de la hoja:', b['error']); sys.exit()
crm = json.loads(os.environ['CRM_TOTALS'])
crm_docs = set(crm['docs'])
tabs = b.get('pestanas') or {}
main_name = b.get('pestana') or os.environ['CARTERA_TAB']
cali_name = os.environ['CARTERA_CALI_TAB']

def cuadre(nombre, filas, seller):
    h = next((i for i, f in enumerate(filas) if 'Documento' in [str(c).strip() for c in f] and 'Cliente' in [str(c).strip() for c in f]), None)
    if h is None: print('   no encuentro la fila de títulos'); return 0
    t = [str(c).strip() for c in filas[h]]
    col = lambda n: t.index(n) if n in t else -1
    iDoc, iTipo, iSaldo, iVend = col('Documento'), col('T_Dcto'), col('Saldo'), col('Nombre_Vendedor')
    enc = [str(c).strip() for f in filas[:h] for c in f]
    vend_enc = enc[enc.index('Vendedor') + 1] if 'Vendedor' in enc else ''
    total = 0.0; por_tipo = collections.defaultdict(lambda: [0, 0.0]); fuera = collections.defaultdict(lambda: [0, 0.0, []])
    for f in filas[h + 1:]:
        doc = str(f[iDoc]).strip() if iDoc < len(f) else ''
        saldo = num(f[iSaldo]) if iSaldo < len(f) else float('nan')
        tipo = str(f[iTipo]).strip().upper() if iTipo >= 0 and iTipo < len(f) else ''
        if not doc:
            if saldo == saldo and saldo != 0: fuera['fila sin número de Documento (¿fila de total o subtotal?)'][0] += 1; fuera['fila sin número de Documento (¿fila de total o subtotal?)'][1] += saldo
            continue
        if saldo != saldo: fuera['saldo que no se pudo leer'][0] += 1; fuera['saldo que no se pudo leer'][2].append(doc); continue
        v = (str(f[iVend]).strip() if iVend >= 0 and iVend < len(f) else '') or vend_enc
        total += saldo
        por_tipo[tipo or '(vacío)'][0] += 1; por_tipo[tipo or '(vacío)'][1] += saldo
        if seller and key(v) != key(seller): r = f'otro vendedor ({v})'
        elif tipo.startswith('N') or saldo < 0: r = f'tipo {tipo or "?"} (empieza por N o saldo negativo: el CRM lo trata como NOTA CRÉDITO)'
        else: continue
        fuera[r][0] += 1; fuera[r][1] += saldo; fuera[r][2].append(doc)
    print(f'   Total columna Saldo en la hoja: {money(total)}')
    print('   Por tipo de documento (T_Dcto):')
    for k, (n, s) in sorted(por_tipo.items(), key=lambda x: -abs(x[1][1])): print(f'      {k:<8} {n:>4} filas  {money(s)}')
    if fuera:
        print('   Lo que NO entra a la deuda del CRM:')
        for k, (n, s, docs) in fuera.items():
            print(f'      {n} fila(s) · {money(s)} · {k}' + (f' · docs: {", ".join(docs[:8])}{"…" if len(docs) > 8 else ""}' if docs else ''))
    return total

print(f'== Medellín · pestaña «{main_name}»')
tm = cuadre(main_name, b.get('filas') or tabs.get(main_name) or [], os.environ['CARTERA_SELLER'])
print(f'   En el CRM («Por cobrar» de Cartera): {crm["n"]} facturas · {money(crm["s"])}')
print(f'   Diferencia hoja − CRM: {money(tm - crm["s"])}')
if cali_name in tabs:
    print(f'== Cali · pestaña «{cali_name}»')
    tc = cuadre(cali_name, tabs[cali_name], os.environ['CARTERA_CALI_SELLER'] or os.environ['CARTERA_SELLER'])
    print(f'   En el CRM («Por cobrar · Cali»): {crm["cn"]} facturas · {money(crm["cs"])}')
    print(f'   Diferencia hoja − CRM: {money(tc - crm["cs"])}')
    print(f'== Medellín + Cali en la hoja: {money(tm + tc)}  ·  en el CRM: {money(crm["s"] + crm["cs"])}')
PY
