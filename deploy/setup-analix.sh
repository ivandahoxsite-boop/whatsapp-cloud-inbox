#!/usr/bin/env bash
# Connects the CRM straight to AnaliX: the CRM brings the sales by itself (Mon-Sat 11 p. m.) instead of OpenClaw.
#   bash /opt/crm/deploy/setup-analix.sh
# Asks for the AnaliX user and password (hidden), checks them with AnaliX BEFORE saving, then restarts the CRM.
set -euo pipefail

ENV_FILE=${CRM_ENV_FILE:-/etc/crm/crm.env}
PORT=${CRM_PORT:-4000}
API=${ANALIX_URL:-https://analix.xsitegroup.com.co/api/proxy}
STAMP=${ANALIX_TIMESTAMP:-1738622291798}
[ "$(id -u)" -eq 0 ] || { echo "Ejecuta como root."; exit 1; }
[ -f "$ENV_FILE" ] || { echo "No encuentro $ENV_FILE"; exit 1; }

set_var() { # set_var NAME VALUE: replaces the line, keeps the file's owner and permissions
  local tmp; tmp=$(mktemp)
  grep -v "^$1=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$1" "$2" >> "$tmp"
  cat "$tmp" > "$ENV_FILE"; rm -f "$tmp"
}

echo "Usuario y clave de AnaliX (los mismos con los que entras a analix.xsitegroup.com.co). Nada se muestra ni se envía a otro lado."
read -rp  "Usuario de AnaliX: " AU; AU=$(printf '%s' "$AU" | tr -d '\r\n')
read -rsp "Clave de AnaliX (no se verá al escribir): " AP; echo; AP=$(printf '%s' "$AP" | tr -d '\r\n')
[ -n "$AU" ] && [ -n "$AP" ] || { echo "Falta el usuario o la clave. No se cambió nada."; exit 1; }
# The env file cannot hold quotes or backslashes safely.
case "$AU$AP" in *\"*|*\'*|*\\*) echo "La clave tiene comillas o \\; el servidor no puede guardarla así. Cámbiala en AnaliX y vuelve a intentar. No se cambió nada."; exit 1;; esac

# ask STYLE TYPE -> AnaliX's answer. The URL carries the password: it goes to curl through stdin, never on the command line.
ask() {
  local url
  url=$(AU="$AU" AP="$AP" STYLE="$1" TYPE="$2" API="$API" STAMP="$STAMP" python3 -c '
import os, json, urllib.parse as u
e = os.environ
pair = json.dumps([e["AU"], e["AP"]], separators=(",", ":")) if e["STYLE"] == "json" else "[%s,%s]" % (e["AU"], e["AP"])
print(e["API"] + "?" + u.urlencode({"type": e["TYPE"], "values": pair, "timestamp": e["STAMP"]}))')
  printf 'url = "%s"\n' "$url" | curl -s --max-time 60 -K - -X POST -H 'Content-Type: application/json' || true
}

echo "Comprobando con AnaliX..."
STYLE=""
for s in json plain; do
  R=$(ask "$s" validate)
  if printf '%s' "$R" | tr -d '[:space:]' | grep -qi '^true$\|"valid":true\|"ok":true\|^"true"$'; then STYLE=$s; break; fi
done
if [ -z "$STYLE" ]; then
  echo "AnaliX no aceptó ese usuario y clave (respondió: $(printf '%s' "${R:-nada}" | head -c 80)). No se cambió nada."
  exit 1
fi
echo "   ✅ AnaliX aceptó el usuario."
echo "Probando que lleguen las ventas (puede tardar un minuto)..."
N=$(ask "$STYLE" getAllData | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin); d = d.get("data", d) if isinstance(d, dict) else {}
    print(len(d.get("productsData") or []))
except Exception:
    print(0)')
[ "${N:-0}" -gt 0 ] || { echo "AnaliX no devolvió ventas. No se cambió nada."; exit 1; }
echo "   ✅ Llegaron $N líneas de venta."

set_var ANALIX_USER "$AU"
set_var ANALIX_PASSWORD "$AP"
set_var ANALIX_VALUES_STYLE "$STYLE"
systemctl restart crm
for _ in $(seq 1 30); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PORT/api/crm/version 2>/dev/null)" != 000 ] && break; sleep 1
done
cat <<'MSG'
✅ AnaliX conectado al CRM. Ahora:
   1. Abre el CRM → pestaña Ventas → "🔄 Actualizar".
   2. En "Clientes de AnaliX sin WhatsApp" di quién es cada uno (una sola vez), empezando por los que más compran.
   Desde ahora el CRM trae las ventas solo, lunes a sábado a las 11:00 p. m.
MSG
