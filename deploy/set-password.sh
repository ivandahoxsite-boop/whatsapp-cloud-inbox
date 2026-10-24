#!/usr/bin/env bash
# Changes the CRM password (INBOX_PASSWORD) without ever showing or logging it.
#   bash /opt/crm/deploy/set-password.sh              asks for the new password (typing is hidden)
#   bash /opt/crm/deploy/set-password.sh --rotate-key also replaces the private access link key
# Restarts the CRM and checks that the new password works and the old one no longer does.
set -euo pipefail

ENV_FILE=${CRM_ENV_FILE:-/etc/crm/crm.env}
PORT=${CRM_PORT:-4000}
[ "$(id -u)" -eq 0 ] || { echo "Ejecuta como root."; exit 1; }
[ -f "$ENV_FILE" ] || { echo "No encuentro $ENV_FILE"; exit 1; }

get() { grep -m1 "^$1=" "$ENV_FILE" | cut -d= -f2- || true; }
set_var() { # set_var NAME VALUE: replaces the line, keeps the file's owner and permissions
  local tmp; tmp=$(mktemp)
  grep -v "^$1=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$1" "$2" >> "$tmp"
  cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
}

read -rsp "Nueva contraseña (mín. 12 caracteres, solo letras, números y . _ @ % + = , : -): " NEW; echo
read -rsp "Repítela: " AGAIN; echo
[ "$NEW" = "$AGAIN" ] || { echo "No coinciden. No se cambió nada."; exit 1; }
[ "${#NEW}" -ge 12 ] || { echo "Muy corta (mínimo 12). No se cambió nada."; exit 1; }
[[ "$NEW" =~ ^[A-Za-z0-9._@%+=,:-]+$ ]] || { echo "Tiene caracteres no permitidos. No se cambió nada."; exit 1; }

USER_NAME=$(get INBOX_USERNAME); USER_NAME=${USER_NAME:-admin}
OLD=$(get INBOX_PASSWORD)
BACKUP=$(mktemp "${ENV_FILE}.bak.XXXXXX"); chmod 600 "$BACKUP"; cat "$ENV_FILE" > "$BACKUP"

set_var INBOX_PASSWORD "$NEW"
ROTATED=""
if [ "${1:-}" = "--rotate-key" ]; then
  KEY=$(openssl rand -hex 24)
  set_var INBOX_ACCESS_KEY "$KEY"
  ROTATED=1
fi
systemctl restart crm

status() { curl -s -o /dev/null -w '%{http_code}' -u "$USER_NAME:$1" "http://127.0.0.1:$PORT/api/crm/fields" || true; }
ok=""
for _ in $(seq 1 30); do [ "$(status "$NEW")" = 200 ] && { ok=1; break; }; sleep 1; done
if [ -z "$ok" ]; then
  cat "$BACKUP" > "$ENV_FILE"; systemctl restart crm
  echo "ERROR: el CRM no aceptó la contraseña nueva. Dejé la anterior (copia: $BACKUP)."
  exit 1
fi
[ -n "$OLD" ] && [ "$OLD" != "$NEW" ] && [ "$(status "$OLD")" = 401 ] && echo "La contraseña anterior ya no funciona."
echo "Listo: contraseña cambiada. Usuario: $USER_NAME"
if [ -n "$ROTATED" ]; then
  HOST=$(grep -o '[a-z0-9.-]*\.sslip\.io' /etc/caddy/Caddyfile 2>/dev/null | head -1 || true)
  echo "Nuevo enlace privado (guárdalo; el anterior dejó de servir): https://${HOST:-TU-DOMINIO}/crm?key=$KEY"
fi
echo "Copia del archivo anterior: $BACKUP  (bórrala cuando confirmes que entras bien: rm $BACKUP)"
