#!/usr/bin/env bash
# Nightly: takes a fresh consistent copy of the CRM database, compresses it, encrypts it (rclone crypt) and uploads it
# to Google Drive, deletes the uploaded copies older than 30 days, and records the result in a small status file
# that the CRM reads (the 8:00 brief warns if no copy went up for more than a day and a half).
#   bash /opt/crm/deploy/offsite-backup.sh          run it now
# Set up once with: bash /opt/crm/deploy/setup-offsite-backup.sh
set -euo pipefail

REMOTE=${CRM_OFFSITE_REMOTE:-crm-backup-crypt}
STATUS=${CRM_OFFSITE_STATUS:-/var/lib/crm/offsite-backup.json}
KEEP_DAYS=${CRM_OFFSITE_KEEP_DAYS:-30}
LOCAL_BACKUP=${CRM_LOCAL_BACKUP_CMD:-/usr/local/bin/crm-backup}
[ "$(id -u)" -eq 0 ] || { echo "Ejecuta como root."; exit 1; }
command -v rclone >/dev/null || { echo "Falta rclone: ejecuta primero setup-offsite-backup.sh"; exit 1; }

exec 9>/var/lock/crm-offsite-backup.lock
flock -n 9 || { echo "Ya hay una copia en curso."; exit 0; }

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
last_ok() { grep -o '"lastOk": *"[^"]*"' "$STATUS" 2>/dev/null | head -1 | sed 's/.*: *"\(.*\)"/\1/' || true; }
write_status() { # write_status OK|ERROR message bytes file
  local ok; ok=$(last_ok)
  [ "$1" = OK ] && ok=$(now)
  local msg=${2//\"/\'}
  mkdir -p "$(dirname "$STATUS")"
  printf '{"lastOk": "%s", "lastAttempt": "%s", "lastError": %s, "bytes": %s, "file": "%s"}\n' \
    "$ok" "$(now)" "$([ "$1" = OK ] && echo null || echo "\"$msg\"")" "${3:-0}" "${4:-}" > "$STATUS"
  chmod 644 "$STATUS"; chown crm:crm "$STATUS" 2>/dev/null || true
}
fail() { echo "ERROR: $1"; write_status ERROR "$1"; exit 1; }
trap 'fail "falló un paso de la copia (revisa /var/log/crm-offsite-backup.log)"' ERR

WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT

echo "$(now) copia local..."
OUT=$("$LOCAL_BACKUP") || fail "no se pudo crear la copia local"
SRC=$(echo "$OUT" | sed -n 's/^backup: //p' | tail -1)
[ -f "$SRC" ] || fail "no encuentro la copia local ($SRC)"

NAME="$(basename "$SRC").gz"
gzip -c "$SRC" > "$WORK/$NAME"
BYTES=$(stat -c %s "$WORK/$NAME")

echo "$(now) subiendo $NAME ($BYTES bytes)..."
rclone copyto "$WORK/$NAME" "$REMOTE:$NAME" --retries 3 || fail "no se pudo subir a Drive (¿token vencido o sin espacio?)"
# Check it is really there before we call it done.
rclone lsjson "$REMOTE:$NAME" | grep -q '"Size"' || fail "subió pero no aparece en Drive"

echo "$(now) borrando copias de más de $KEEP_DAYS días en Drive..."
rclone delete "$REMOTE:" --min-age "${KEEP_DAYS}d" --include 'crm-*.db.gz*' || true

write_status OK "" "$BYTES" "$NAME"
echo "$(now) listo: $NAME"
