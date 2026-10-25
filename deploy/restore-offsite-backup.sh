#!/usr/bin/env bash
# Lists the encrypted backups in your Google Drive, downloads the one you pick and decrypts it into
# /var/backups/crm/restored-*.db. It does NOT touch the live database: it tells you how to put it in place.
#   bash /opt/crm/deploy/restore-offsite-backup.sh
set -euo pipefail
REMOTE=${CRM_OFFSITE_REMOTE:-crm-backup-crypt}
DEST=${CRM_RESTORE_DIR:-/var/backups/crm}
[ "$(id -u)" -eq 0 ] || { echo "Ejecuta como root."; exit 1; }
command -v rclone >/dev/null || { echo "Falta rclone. En un servidor nuevo, ejecuta primero setup-offsite-backup.sh con el mismo token y la MISMA frase de cifrado."; exit 1; }

mapfile -t FILES < <(rclone lsf "$REMOTE:" --include 'crm-*.db.gz*' | sort -r)
[ "${#FILES[@]}" -gt 0 ] || { echo "No hay copias en Drive."; exit 1; }
echo "Copias en Drive (la más reciente primero):"
for i in "${!FILES[@]}"; do printf '  %2d) %s\n' "$((i+1))" "${FILES[$i]}"; [ "$i" -ge 14 ] && { echo "  ... (y más antiguas)"; break; }; done
read -rp "¿Cuál? (número, Enter = la más reciente): " N
N=${N:-1}
[[ "$N" =~ ^[0-9]+$ ]] && [ "$N" -ge 1 ] && [ "$N" -le "${#FILES[@]}" ] || { echo "Número inválido."; exit 1; }
F=${FILES[$((N-1))]}

mkdir -p "$DEST"
TMP=$(mktemp)
rclone copyto "$REMOTE:$F" "$TMP"
OUT="$DEST/restored-$(basename "${F%.gz*}")"
gzip -dc "$TMP" > "$OUT" || { echo "No se pudo descomprimir: ¿la frase de cifrado es la misma?"; rm -f "$TMP"; exit 1; }
rm -f "$TMP"

NODE_BIN=$(readlink -f "$(command -v node)")
"$NODE_BIN" --no-warnings -e "
const {DatabaseSync}=require('node:sqlite'); const d=new DatabaseSync(process.argv[1],{readOnly:true});
const n=(t)=>d.prepare('SELECT COUNT(*) n FROM '+t).get().n;
console.log('\nContenido de la copia: '+n('contacts')+' contactos, '+n('sales')+' ventas, '+n('activities')+' registros de chat/notas');
" "$OUT"
echo "Copia lista en: $OUT"
echo
echo "Para ponerla en uso (SOLO si de verdad quieres volver a esa copia):"
echo "  systemctl stop crm"
echo "  cp /var/lib/crm/crm.db /var/lib/crm/crm.db.antes-de-restaurar"
echo "  cp $OUT /var/lib/crm/crm.db && chown crm:crm /var/lib/crm/crm.db"
echo "  rm -f /var/lib/crm/crm.db-wal /var/lib/crm/crm.db-shm"
echo "  systemctl start crm"
