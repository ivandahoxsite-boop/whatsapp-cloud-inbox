#!/usr/bin/env bash
# Connects the CRM to your Twilio account for click-to-call ("Llamar": Twilio rings YOUR phone, then the customer).
#   bash /opt/crm/deploy/setup-twilio.sh
# Asks for the Account SID, Auth Token (hidden), the Twilio number and your own phone. Nothing is shown or logged.
# It checks the credentials with Twilio BEFORE saving anything, then can make a test call to your phone.
set -euo pipefail

ENV_FILE=${CRM_ENV_FILE:-/etc/crm/crm.env}
PORT=${CRM_PORT:-4000}
[ "$(id -u)" -eq 0 ] || { echo "Ejecuta como root."; exit 1; }
[ -f "$ENV_FILE" ] || { echo "No encuentro $ENV_FILE"; exit 1; }

set_var() { # set_var NAME VALUE: replaces the line, keeps the file's owner and permissions
  local tmp; tmp=$(mktemp)
  grep -v "^$1=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$1" "$2" >> "$tmp"
  cat "$tmp" > "$ENV_FILE"; rm -f "$tmp"
}
e164() { local d; d=$(printf '%s' "$1" | tr -cd '0-9+'); [[ "$d" =~ ^3[0-9]{9}$ ]] && d="+57$d"; [[ "$d" == +* ]] || d="+$d"; printf '%s' "$d"; }
# The credentials go to curl through stdin, so they never appear in the list of running processes.
tw() { # tw METHOD PATH [curl args...] -> prints the HTTP code on the last line
  local m=$1 p=$2; shift 2
  printf 'user = "%s:%s"\n' "$SID" "$TOKEN" | curl -s -K - -X "$m" -w '\n%{http_code}' "${TWILIO_API_URL:-https://api.twilio.com}/2010-04-01/Accounts/$SID$p" "$@"
}

echo "Datos de Twilio (console.twilio.com → Account Info). Nada de esto se muestra ni se envía a otro lado."
read -rp  "Account SID (empieza con AC): " SID; SID=$(printf '%s' "$SID" | tr -d '[:space:]')
[[ "$SID" =~ ^AC[0-9a-fA-F]{32}$ ]] || { echo "Ese no parece un Account SID (AC + 32 caracteres). No se cambió nada."; exit 1; }
read -rsp "Auth Token (no se verá al pegar): " TOKEN; echo; TOKEN=$(printf '%s' "$TOKEN" | tr -d '[:space:]')
[[ "$TOKEN" =~ ^[0-9a-fA-F]{32}$ ]] || { echo "Ese no parece un Auth Token (32 caracteres). No se cambió nada."; exit 1; }
read -rp  "Número de Twilio desde el que se llama (ej: +12025550123): " FROM; FROM=$(e164 "$FROM")
read -rp  "TU celular, donde Twilio te llama primero (ej: 3001234567): " AGENT; AGENT=$(e164 "$AGENT")
[[ "$FROM" =~ ^\+[0-9]{8,15}$ && "$AGENT" =~ ^\+[0-9]{8,15}$ ]] || { echo "Algún número no es válido. No se cambió nada."; exit 1; }

echo "Comprobando con Twilio..."
OUT=$(tw GET .json); CODE=${OUT##*$'\n'}
[ "$CODE" = 200 ] || { echo "Twilio rechazó el SID o el token (HTTP $CODE). Revísalos. No se cambió nada."; exit 1; }
TYPE=$(printf '%s' "$OUT" | grep -o '"type": *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
STATUS=$(printf '%s' "$OUT" | grep -o '"status": *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
echo "   cuenta: ${TYPE:-?} · estado: ${STATUS:-?}"
[ "$TYPE" = Trial ] && echo "   ⚠️ Cuenta de prueba: solo puede llamar a números verificados y suena un aviso en inglés."

OWN=$(tw GET /IncomingPhoneNumbers.json -G --data-urlencode "PhoneNumber=$FROM"); OWNCODE=${OWN##*$'\n'}
if [ "$OWNCODE" != 200 ] || ! printf '%s' "$OWN" | grep -q '"phone_number"'; then
  VER=$(tw GET /OutgoingCallerIds.json -G --data-urlencode "PhoneNumber=$FROM")
  printf '%s' "$VER" | grep -q '"phone_number"' || { echo "El número $FROM no es de esta cuenta de Twilio ni está verificado. No se cambió nada."; exit 1; }
  echo "   $FROM es un número verificado de la cuenta."
else
  echo "   $FROM es un número de la cuenta. ✅"
fi

BACKUP=$(mktemp "${ENV_FILE}.bak.XXXXXX"); chmod 600 "$BACKUP"; cat "$ENV_FILE" > "$BACKUP"
set_var TWILIO_ACCOUNT_SID "$SID"
set_var TWILIO_AUTH_TOKEN "$TOKEN"
set_var TWILIO_FROM "$FROM"
set_var TWILIO_AGENT_PHONE "$AGENT"
systemctl restart crm
for _ in $(seq 1 30); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PORT/api/crm/version 2>/dev/null)" != 000 ] && break; sleep 1
done
rm -f "$BACKUP"
echo "✅ Twilio conectado al CRM. Te llamará a $AGENT y luego al cliente desde $FROM."

read -rp "¿Hacer ahora una llamada de prueba a TU celular? (s/n): " T
if [[ "$T" =~ ^[sS] ]]; then
  R=$(tw POST /Calls.json --data-urlencode "To=$AGENT" --data-urlencode "From=$FROM" \
    --data-urlencode 'Twiml=<Response><Say language="es-MX">Hola. Esta es una prueba de llamadas del CRM de Xsite Group. Todo funciona correctamente.</Say></Response>')
  RC=${R##*$'\n'}
  if [ "$RC" = 201 ]; then echo "📞 Llamando a $AGENT... contesta para oír el mensaje de prueba."
  else
    echo "La llamada de prueba falló (HTTP $RC): $(printf '%s' "$R" | grep -o '"message": *"[^"]*"' | head -1)"
    printf '%s' "$R" | grep -q '"code": *21215' && echo "   → En Twilio activa Colombia en Voice → Settings → Geo permissions."
  fi
fi
