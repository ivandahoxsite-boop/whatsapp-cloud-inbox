#!/usr/bin/env bash
# Updates the CRM code without touching its data. Called by /usr/local/bin/crm-update.
#   - shows how many contacts/messages/sales the database holds before and after
#   - builds the new version in a separate folder (.next-new) while the current one keeps running
#   - only if the build works: backs up the database, swaps the folders, restarts and waits until the CRM answers
#   - if the build fails or the new version does not answer, goes back to the previous version by itself
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
  as_crm() { sudo -u crm -H env PATH="$NODE_DIR:/usr/bin:/bin" bash -c "cd '$APP' && $1"; }
  local PREV LOCK_OLD LOCK_NEW
  PREV=$(sudo -u crm -H git -C "$APP" rev-parse HEAD)
  LOCK_OLD=$(cat "$APP/node_modules/.crm-lock-hash" 2>/dev/null || true)

  # Puts the source (and, if they changed, the dependencies) back as they were. The running CRM was never touched.
  undo_source() {
    sudo -u crm -H git -C "$APP" checkout -q -B "$BRANCH" "$PREV"
    rm -rf "$APP/.next-new"
    if [ "$(sha256sum "$APP/package-lock.json" | cut -d' ' -f1)" != "$(cat "$APP/node_modules/.crm-lock-hash" 2>/dev/null || true)" ]; then
      echo "Restaurando las dependencias anteriores..."
      as_crm "npm ci --no-audit --no-fund && sha256sum package-lock.json | cut -d' ' -f1 > node_modules/.crm-lock-hash" >>"$LOG" 2>&1 || true
    fi
  }

  echo "Descargando la versión nueva ($BRANCH)..."
  sudo -u crm -H git -C "$APP" fetch -q origin "$BRANCH"
  sudo -u crm -H git -C "$APP" checkout -q -B "$BRANCH" "origin/$BRANCH"
  LOCK_NEW=$(sha256sum "$APP/package-lock.json" | cut -d' ' -f1)
  echo "Compilando aparte (1-2 minutos). El CRM sigue funcionando mientras tanto..."
  : >"$LOG" # written by root (the redirections run outside the crm user's shell)
  # Dependencies are reinstalled only when package-lock.json changed: reinstalling deletes node_modules under the running CRM.
  if [ "$LOCK_NEW" != "$LOCK_OLD" ]; then
    if ! as_crm "npm ci --no-audit --no-fund && echo '$LOCK_NEW' > node_modules/.crm-lock-hash" >>"$LOG" 2>&1; then
      tail -n 30 "$LOG"; undo_source
      echo "ERROR: falló la instalación de dependencias. El CRM sigue con la versión anterior y tus datos no se tocaron."
      exit 1
    fi
  fi
  if ! as_crm "rm -rf .next-new && NEXT_DIST_DIR=.next-new npm run build" >>"$LOG" 2>&1; then
    tail -n 30 "$LOG"; undo_source
    echo "ERROR: falló la compilación. El CRM sigue con la versión anterior y tus datos no se tocaron."
    exit 1
  fi
  [ -x /usr/local/bin/crm-backup ] && /usr/local/bin/crm-backup || true
  rm -rf "$APP/.next-old"
  [ -d "$APP/.next" ] && mv "$APP/.next" "$APP/.next-old"
  mv "$APP/.next-new" "$APP/.next"
  systemctl restart crm

  answers() {
    for _ in $(seq 1 60); do
      [ "$(curl -s -o /dev/null -w '%{http_code}' -u "${INBOX_USERNAME:-admin}:$INBOX_PASSWORD" "http://127.0.0.1:$PORT/api/crm/fields")" = 200 ] && return 0
      sleep 1
    done
    return 1
  }
  if ! answers; then
    echo "ERROR: la versión nueva no respondió. Vuelvo a la anterior..."
    journalctl -u crm -n 20 --no-pager || true
    if [ -d "$APP/.next-old" ]; then
      rm -rf "$APP/.next-failed"; mv "$APP/.next" "$APP/.next-failed"; mv "$APP/.next-old" "$APP/.next"
      undo_source
      systemctl restart crm
      answers && echo "Listo: el CRM volvió a la versión anterior y funciona. Tus datos no se tocaron." || echo "El CRM no responde. Mira: journalctl -u crm -n 50 --no-pager"
    fi
    exit 1
  fi
  echo "Datos DESPUÉS:  $(counts)"

  if [ -n "${KAPSO_API_KEY:-}" ] && [ -n "${PHONE_NUMBER_ID:-}" ]; then
    curl -s -o /dev/null -u "${INBOX_USERNAME:-admin}:$INBOX_PASSWORD" -H 'Content-Type: application/json' \
      -X POST "http://127.0.0.1:$PORT/api/crm/sync-kapso" -d '{"mode":"incremental"}' || true
    echo "Trayendo de Kapso los mensajes nuevos en segundo plano."
  fi
  echo "CRM actualizado."
}

main "$@"
