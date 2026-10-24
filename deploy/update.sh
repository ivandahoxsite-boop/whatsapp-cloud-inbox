#!/usr/bin/env bash
# Updates the CRM code without touching its data. Called by /usr/local/bin/crm-update.
#   - shows how many contacts/messages/sales the database holds before and after
#   - backs up the database, rebuilds, restarts and waits until the CRM answers
#   - then fetches from Kapso the messages that arrived while it was restarting
# The body is a function so bash parses it completely before git replaces this file.
set -euo pipefail

main() {
  local APP=/opt/crm ENV_FILE=/etc/crm/crm.env PORT=4000
  [ "$(id -u)" -eq 0 ] || { echo "Ejecuta como root."; exit 1; }
  set -a; . "$ENV_FILE"; set +a
  local DB="${CRM_DB_PATH:-$APP/data/crm.db}"
  local NODE_BIN NODE_DIR BRANCH LOG
  NODE_BIN=$(readlink -f "$(command -v node)")
  NODE_DIR=$(dirname "$NODE_BIN")
  BRANCH=$(sudo -u crm -H git -C "$APP" rev-parse --abbrev-ref HEAD)
  LOG=/tmp/crm-build.log

  counts() {
    "$NODE_BIN" --no-warnings -e "
      const {DatabaseSync}=require('node:sqlite');
      try { const d=new DatabaseSync(process.argv[1]); const n=(t,w='')=>d.prepare('SELECT COUNT(*) n FROM '+t+w).get().n;
        console.log(n('contacts')+' contactos, '+n('activities',\" WHERE kind IN ('whatsapp_in','whatsapp_out')\")+' mensajes, '+n('sales')+' ventas'); }
      catch (e) { console.log('(sin datos todavía)'); }" "$DB"
  }

  echo "Datos ANTES:    $(counts)   [$DB]"
  echo "Descargando la versión nueva ($BRANCH)..."
  sudo -u crm -H git -C "$APP" fetch -q origin "$BRANCH"
  sudo -u crm -H git -C "$APP" checkout -q -B "$BRANCH" "origin/$BRANCH"
  echo "Compilando (1-2 minutos)..."
  if ! sudo -u crm -H env PATH="$NODE_DIR:/usr/bin:/bin" bash -c "cd '$APP' && npm ci --no-audit --no-fund && npm run build" >"$LOG" 2>&1; then
    tail -n 30 "$LOG"
    echo "ERROR: falló la compilación. El CRM sigue con la versión anterior y tus datos no se tocaron."
    exit 1
  fi
  [ -x /usr/local/bin/crm-backup ] && /usr/local/bin/crm-backup || true
  systemctl restart crm

  local ok=0
  for _ in $(seq 1 60); do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' -u "${INBOX_USERNAME:-admin}:$INBOX_PASSWORD" "http://127.0.0.1:$PORT/api/crm/fields")" = 200 ]; then ok=1; break; fi
    sleep 1
  done
  [ "$ok" = 1 ] || { echo "ERROR: el CRM no respondió. Mira: journalctl -u crm -n 50 --no-pager"; exit 1; }
  echo "Datos DESPUÉS:  $(counts)"

  if [ -n "${KAPSO_API_KEY:-}" ] && [ -n "${PHONE_NUMBER_ID:-}" ]; then
    curl -s -o /dev/null -u "${INBOX_USERNAME:-admin}:$INBOX_PASSWORD" -H 'Content-Type: application/json' \
      -X POST "http://127.0.0.1:$PORT/api/crm/sync-kapso" -d '{"mode":"incremental"}' || true
    echo "Trayendo de Kapso los mensajes nuevos en segundo plano."
  fi
  echo "CRM actualizado."
}

main "$@"
