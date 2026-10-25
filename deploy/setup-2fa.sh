#!/usr/bin/env bash
# Turns on two-step verification for the CRM: after the password, a 6-digit code from an authenticator app
# (Google Authenticator, Authy, Microsoft Authenticator) is needed once per browser.
#   bash /opt/crm/deploy/setup-2fa.sh          turn on (or replace the secret)
#   bash /opt/crm/deploy/setup-2fa.sh --off    turn off
# It only turns it on after you type a valid code from your app, so you cannot lock yourself out.
set -euo pipefail

ENV_FILE=${CRM_ENV_FILE:-/etc/crm/crm.env}
PORT=${CRM_PORT:-4000}
[ "$(id -u)" -eq 0 ] || { echo "Ejecuta como root."; exit 1; }
[ -f "$ENV_FILE" ] || { echo "No encuentro $ENV_FILE"; exit 1; }
command -v python3 >/dev/null || { echo "Falta python3."; exit 1; }

set_var() { # replaces/removes a line in the env file (keeps owner and permissions)
  local tmp; tmp=$(mktemp)
  grep -v "^$1=" "$ENV_FILE" > "$tmp" || true
  [ -n "${2:-}" ] && printf '%s=%s\n' "$1" "$2" >> "$tmp"
  cat "$tmp" > "$ENV_FILE"; rm -f "$tmp"
}
restart_and_check() {
  systemctl restart crm
  . <(grep -E '^(INBOX_USERNAME|INBOX_PASSWORD)=' "$ENV_FILE" | sed 's/^/export /')
  for _ in $(seq 1 30); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' -u "${INBOX_USERNAME:-admin}:$INBOX_PASSWORD" "http://127.0.0.1:$PORT/api/crm/fields" || true)" = 200 ] && return 0
    sleep 1
  done
  return 1
}

if [ "${1:-}" = "--off" ]; then
  cp "$ENV_FILE" "$ENV_FILE.bak"; chmod 600 "$ENV_FILE.bak"
  set_var CRM_TOTP_SECRET ""
  restart_and_check && echo "Verificación en dos pasos DESACTIVADA." || echo "El CRM no respondió; revisa: journalctl -u crm -n 50 --no-pager"
  exit 0
fi

SECRET=$(python3 -c 'import os,base64;print(base64.b32encode(os.urandom(20)).decode().rstrip("="))')
HOST=$(grep -o '[a-z0-9.-]*\.sslip\.io' /etc/caddy/Caddyfile 2>/dev/null | head -1 || true)
echo
echo "1) En tu app de autenticación elige 'Agregar cuenta' → 'Ingresar clave de configuración'."
echo "2) Nombre: CRM    Clave (basada en tiempo):"
echo
echo "      $SECRET"
echo
echo "   (o abre este enlace en el celular: otpauth://totp/CRM:${HOST:-admin}?secret=$SECRET&issuer=CRM )"
echo

check() { # check SECRET CODE -> exit 0 when the code is valid now (±30 s)
  python3 - "$1" "$2" <<'PY'
import sys, hmac, hashlib, struct, time, base64
secret, code = sys.argv[1], sys.argv[2]
key = base64.b32decode(secret + "=" * (-len(secret) % 8))
def otp(step):
    h = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
    o = h[19] & 15
    return "%06d" % ((struct.unpack(">I", h[o:o+4])[0] & 0x7fffffff) % 1000000)
now = int(time.time() // 30)
sys.exit(0 if any(otp(now + d) == code for d in (-1, 0, 1)) else 1)
PY
}

for try in 1 2 3; do
  read -rp "Escribe el código de 6 números que muestra la app: " CODE
  if [[ "$CODE" =~ ^[0-9]{6}$ ]] && check "$SECRET" "$CODE"; then OK=1; break; fi
  echo "Ese código no coincide."
done
[ "${OK:-}" = 1 ] || { echo "No se activó nada. Vuelve a ejecutar el script cuando tengas la app lista."; exit 1; }

cp "$ENV_FILE" "$ENV_FILE.bak"; chmod 600 "$ENV_FILE.bak"
set_var CRM_TOTP_SECRET "$SECRET"
if restart_and_check; then
  echo "Listo: verificación en dos pasos ACTIVADA. Al entrar al CRM te pedirá el código (una vez por navegador, 30 días)."
  echo "Para desactivarla: bash $0 --off"
else
  cat "$ENV_FILE.bak" > "$ENV_FILE"; systemctl restart crm
  echo "ERROR: el CRM no respondió. Dejé la configuración anterior."; exit 1
fi
