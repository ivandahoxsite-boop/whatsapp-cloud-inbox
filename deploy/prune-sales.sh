#!/usr/bin/env bash
# Deletes the sales older than a date (default: everything before 2024-01-01) and keeps the rest.
#   bash /opt/crm/deploy/prune-sales.sh                    shows what would go, asks you to type BORRAR
#   bash /opt/crm/deploy/prune-sales.sh --before 2025-01-01
# It makes a backup first and prints how to go back. Customers, chats and receivables are NOT touched.
set -euo pipefail

BEFORE=2024-01-01
[ "${1:-}" = "--before" ] && BEFORE=${2:-}
[[ "$BEFORE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { echo "Fecha inválida. Usa AAAA-MM-DD, por ejemplo: --before 2024-01-01"; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo "Ejecuta como root."; exit 1; }

ENV_FILE=${CRM_ENV_FILE:-/etc/crm/crm.env}
[ -f "$ENV_FILE" ] && { set -a; . "$ENV_FILE"; set +a; }
DB="${CRM_DB_PATH:-/opt/crm/data/crm.db}"
[ -f "$DB" ] || { echo "No encuentro la base: $DB"; exit 1; }
NODE_BIN=$(readlink -f "$(command -v node)")
# Write as the CRM's own user so the database files keep their owner.
RUN=(); id crm >/dev/null 2>&1 && RUN=(runuser -u crm --)

WORK=$(mktemp -d); chmod 755 "$WORK"; trap 'rm -rf "$WORK"' EXIT

cat > "$WORK/preview.js" <<'EOF'
const { DatabaseSync } = require('node:sqlite');
const d = new DatabaseSync(process.argv[2], { readOnly: true });
const b = process.argv[3];
const one = (s, ...a) => d.prepare(s).get(...a);
const f = (n) => Math.round(n).toLocaleString('es-CO');
const del = one('SELECT COUNT(*) n, COALESCE(SUM(amount),0) m FROM sales WHERE sold_at < ?', b);
const keep = one('SELECT COUNT(*) n, COALESCE(SUM(amount),0) m FROM sales WHERE sold_at >= ?', b);
console.log('\nSE BORRAN : ' + f(del.n) + ' ventas  $' + f(del.m));
console.log('SE QUEDAN : ' + f(keep.n) + ' ventas  $' + f(keep.m));
console.table(
  d.prepare("SELECT substr(sold_at,1,4) AS anio, COUNT(*) AS ventas, ROUND(SUM(amount)) AS monto, MIN(sold_at) AS desde, MAX(sold_at) AS hasta FROM sales GROUP BY 1 ORDER BY 1").all()
    .map((r) => ({ ...r, destino: r.hasta < b ? 'se borra' : r.desde >= b ? 'se queda' : 'parte' }))
);
const orphan = one(
  'SELECT COUNT(*) n FROM contacts c WHERE EXISTS (SELECT 1 FROM sales s WHERE s.contact_id=c.id AND s.sold_at < ?) AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.contact_id=c.id AND s.sold_at >= ?)', b, b);
console.log(f(orphan.n) + ' clientes se quedan SIN ventas (siguen en el CRM como prospectos, con su chat y sus datos).');
process.exit(del.n === 0 ? 3 : 0);
EOF

cat > "$WORK/delete.js" <<'EOF'
const { DatabaseSync } = require('node:sqlite');
const d = new DatabaseSync(process.argv[2]);
const b = process.argv[3];
d.exec('PRAGMA busy_timeout=15000');
d.exec('BEGIN');
const r = d.prepare('DELETE FROM sales WHERE sold_at < ?').run(b);
const left = d.prepare('SELECT COUNT(*) n, COALESCE(SUM(amount),0) m, MIN(sold_at) a, MAX(sold_at) z FROM sales').get();
d.exec('COMMIT');
console.log('\nBorradas: ' + r.changes + ' ventas.  Quedan: ' + left.n + ' ventas, $' + Math.round(left.m).toLocaleString('es-CO') + ' (de ' + left.a + ' a ' + left.z + ')');
EOF

echo "Base: $DB   |   Se borran las ventas anteriores a $BEFORE"
set +e; "${RUN[@]}" "$NODE_BIN" --no-warnings "$WORK/preview.js" "$DB" "$BEFORE"; RC=$?; set -e
[ "$RC" -eq 3 ] && { echo; echo "No hay nada que borrar."; exit 0; }
[ "$RC" -eq 0 ] || { echo "No pude leer la base."; exit 1; }

echo
read -rp "Para confirmar escribe BORRAR (cualquier otra cosa cancela): " OK
[ "$OK" = "BORRAR" ] || { echo "Cancelado. No se borró nada."; exit 0; }

BACKUP_OUT=$(/usr/local/bin/crm-backup 2>&1) || { echo "La copia de seguridad falló, NO se borró nada: $BACKUP_OUT"; exit 1; }
echo "$BACKUP_OUT"

"${RUN[@]}" "$NODE_BIN" --no-warnings "$WORK/delete.js" "$DB" "$BEFORE"
BK=$(echo "$BACKUP_OUT" | grep -o '/[^ ]*\.db' | tail -1 || true)
echo
echo "Listo. Recarga el CRM (cierra y abre la pestaña)."
[ -n "$BK" ] && echo "Para VOLVER ATRÁS existe la copia: $BK  (pídeme el comando para restaurarla)."
