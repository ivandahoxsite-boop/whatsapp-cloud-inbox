#!/usr/bin/env bash
# Updates this cartera CRM without touching its data (nor the original CRM). Called by /usr/local/bin/crm-cartera-update.
#   - shows how many customers and invoices the database holds before and after
#   - builds the new version in a separate folder (.next-new) while the current one keeps running
#   - only if the build works: backs up the database, swaps the folders, restarts and waits until the CRM answers
#   - if the build fails or the new version does not answer, goes back to the previous version by itself
# The body is a function so bash parses it completely before git replaces this file.
set -euo pipefail

main() {
  local DIR; DIR=$(cd "$(dirname "$0")" && pwd)
  . "$DIR/instance.sh"
  [ "$(id -u)" -eq 0 ] || { echo "Ejecuta como root."; exit 1; }
  set -a; . "$ENV_FILE"; set +a
  local DB="${CRM_DB_PATH:-$DATA/crm.db}"
  local NODE_BIN NODE_DIR BRANCH LOG
  NODE_BIN=$(readlink -f "$(command -v node)")
  NODE_DIR=$(dirname "$NODE_BIN")
  BRANCH=$(sudo -u "$RUN_USER" -H git -C "$APP" rev-parse --abbrev-ref HEAD)
  LOG=/tmp/$NAME-build.log

  counts() {
    "$NODE_BIN" --no-warnings -e "
      const {DatabaseSync}=require('node:sqlite');
      try { const d=new DatabaseSync(process.argv[1], { readOnly: true }); const n=(t,w='')=>d.prepare('SELECT COUNT(*) n FROM '+t+w).get().n;
        console.log(n('contacts')+' clientes, '+n('receivables',\" WHERE status = 'open'\")+' facturas abiertas, '+n('outbox',\" WHERE status = 'pending'\")+' en Aprobaciones'); }
      catch (e) { console.log('(sin datos todavía)'); }" "$DB"
  }

  echo "Datos ANTES:    $(counts)   [$DB]"
  as_app() { sudo -u "$RUN_USER" -H env PATH="$NODE_DIR:/usr/bin:/bin" bash -c "cd '$APP' && $1"; }
  local PREV LOCK_OLD LOCK_NEW
  PREV=$(sudo -u "$RUN_USER" -H git -C "$APP" rev-parse HEAD)
  LOCK_OLD=$(cat "$APP/node_modules/.crm-lock-hash" 2>/dev/null || true)

  # Puts the source (and, if they changed, the dependencies) back as they were. The running CRM was never touched.
  undo_source() {
    sudo -u "$RUN_USER" -H git -C "$APP" checkout -q -B "$BRANCH" "$PREV"
    rm -rf "$APP/.next-new"
    if [ "$(sha256sum "$APP/package-lock.json" | cut -d' ' -f1)" != "$(cat "$APP/node_modules/.crm-lock-hash" 2>/dev/null || true)" ]; then
      echo "Restaurando las dependencias anteriores..."
      as_app "npm ci --no-audit --no-fund && sha256sum package-lock.json | cut -d' ' -f1 > node_modules/.crm-lock-hash" >>"$LOG" 2>&1 || true
    fi
  }

  echo "Descargando la versión nueva ($BRANCH)..."
  sudo -u "$RUN_USER" -H git -C "$APP" fetch -q origin "$BRANCH"
  sudo -u "$RUN_USER" -H git -C "$APP" checkout -q -B "$BRANCH" "origin/$BRANCH"
  LOCK_NEW=$(sha256sum "$APP/package-lock.json" | cut -d' ' -f1)
  echo "Compilando aparte (1-2 minutos). El CRM sigue funcionando mientras tanto..."
  : >"$LOG"
  # Dependencies are reinstalled only when package-lock.json changed: reinstalling deletes node_modules under the running CRM.
  if [ "$LOCK_NEW" != "$LOCK_OLD" ]; then
    if ! as_app "npm ci --no-audit --no-fund && echo '$LOCK_NEW' > node_modules/.crm-lock-hash" >>"$LOG" 2>&1; then
      tail -n 30 "$LOG"; undo_source
      echo "ERROR: falló la instalación de dependencias. El CRM sigue con la versión anterior y sus datos no se tocaron."
      exit 1
    fi
  fi
  if ! as_app "rm -rf .next-new && NEXT_DIST_DIR=.next-new npm run build" >>"$LOG" 2>&1; then
    tail -n 30 "$LOG"; undo_source
    echo "ERROR: falló la compilación. El CRM sigue con la versión anterior y sus datos no se tocaron."
    exit 1
  fi
  [ -x "/usr/local/bin/$NAME-backup" ] && "/usr/local/bin/$NAME-backup" || true
  rm -rf "$APP/.next-old"
  [ -d "$APP/.next" ] && mv "$APP/.next" "$APP/.next-old"
  mv "$APP/.next-new" "$APP/.next"
  systemctl restart "$SERVICE"

  answers() {
    for _ in $(seq 1 60); do
      [ "$(curl -s -o /dev/null -w '%{http_code}' -u "${INBOX_USERNAME:-admin}:$INBOX_PASSWORD" "http://127.0.0.1:$PORT$HEALTH_PATH")" = 200 ] && return 0
      sleep 1
    done
    return 1
  }
  if ! answers; then
    echo "ERROR: la versión nueva no respondió. Vuelvo a la anterior..."
    journalctl -u "$SERVICE" -n 20 --no-pager || true
    if [ -d "$APP/.next-old" ]; then
      rm -rf "$APP/.next-failed"; mv "$APP/.next" "$APP/.next-failed"; mv "$APP/.next-old" "$APP/.next"
      undo_source
      systemctl restart "$SERVICE"
      answers && echo "Listo: el CRM volvió a la versión anterior y funciona. Sus datos no se tocaron." || echo "El CRM no responde. Mira: journalctl -u $SERVICE -n 50 --no-pager"
    fi
    exit 1
  fi
  echo "Datos DESPUÉS:  $(counts)"
  echo "CRM de cartera actualizado."
}

main "$@"
