#!/usr/bin/env bash
# Connects the CRM to the Google Sheet tab "Cartera por vendedor": the CRM reads it by itself (lun-sáb 10:45, 15:00
# and 17:45) instead of OpenClaw loading it. Read-only: a small Apps Script in the sheet hands the tab to the CRM.
#   bash /opt/crm/deploy/setup-cartera-hoja.sh
set -euo pipefail

ENV_FILE=${CRM_ENV_FILE:-/etc/crm/crm.env}
PORT=${CRM_PORT:-4000}
DIR=$(cd "$(dirname "$0")" && pwd)
[ "$(id -u)" -eq 0 ] || { echo "Ejecuta como root."; exit 1; }
[ -f "$ENV_FILE" ] || { echo "No encuentro $ENV_FILE"; exit 1; }

set_var() { # set_var NAME VALUE: replaces the line, keeps the file's owner and permissions
  local tmp; tmp=$(mktemp)
  grep -v "^$1=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$1" "$2" >> "$tmp"
  cat "$tmp" > "$ENV_FILE"; rm -f "$tmp"
}

# Same key as before if it was already set up (the Apps Script keeps working), else a new one.
KEY=$(grep -E '^CARTERA_SHEET_KEY=' "$ENV_FILE" | tail -1 | cut -d= -f2- || true)
[[ "$KEY" =~ ^[0-9a-f]{48}$ ]] || KEY=$(openssl rand -hex 24)

cat <<MSG

PASO 1. Abre la hoja "WP bot Iván" en el PC → menú Extensiones → Apps Script.
PASO 2. Borra lo que haya en el editor y pega TODO lo que está entre las dos rayas:
────────────────────────────────────────────────────────────
MSG
sed "s/__CLAVE__/$KEY/" "$DIR/cartera-apps-script.gs"
cat <<'MSG'
────────────────────────────────────────────────────────────
PASO 3. Guarda (ícono del disquete).
PASO 4. Botón azul "Implementar" → "Nueva implementación" → engranaje → "Aplicación web".
        Ejecutar como: "Yo"   ·   Quién tiene acceso: "Cualquier persona"  → "Implementar".
        Google pedirá permiso: "Autorizar acceso" → tu cuenta → "Configuración avanzada" →
        "Ir a ... (no seguro)" → "Permitir". (Es tu propio script; solo puede leer esta hoja.)
PASO 5. Copia la "URL de la aplicación web" (termina en /exec) y pégala aquí abajo.

MSG
ok=""
for intento in 1 2 3; do
  read -rp "URL de la aplicación web: " URL; URL=$(printf '%s' "$URL" | tr -d '[:space:]')
  if ! [[ "$URL" =~ ^https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec$ ]]; then
    echo "Esa no parece la URL (https://script.google.com/macros/s/.../exec). Pégala otra vez."; continue
  fi
  echo "Probando la lectura de la hoja..."
  # Without the key first: an Apps Script reachable by anyone answers {"error":"clave"} and shows no data.
  PUB=$(curl -sL --max-time 60 "$URL" || true)
  if ! printf '%s' "$PUB" | grep -q '"error"'; then
    if printf '%s' "$PUB" | grep -qi 'accounts.google.com\|ServiceLogin\|signin'; then
      echo "❌ Google pide iniciar sesión: la implementación NO está con acceso \"Cualquier persona\"."
      echo "   Implementar → Gestionar implementaciones → lápiz → Quién tiene acceso: \"Cualquier persona\" (no \"con cuenta de Google\") → Implementar."
    elif [ -z "$PUB" ]; then
      echo "❌ Google no respondió (¿sin internet en el servidor?)."
    else
      echo "❌ Google respondió otra cosa: $(printf '%s' "$PUB" | tr -s '[:space:]' ' ' | sed 's/<[^>]*>//g' | head -c 200)"
    fi
    continue
  fi
  # The key goes to curl through stdin, so it never shows in the list of running processes.
  OUT=$(printf 'url = "%s?k=%s"\n' "$URL" "$KEY" | curl -sL --max-time 60 -K - || true)
  if printf '%s' "$OUT" | grep -Eq '"error": ?"clave"'; then
    echo "❌ La hoja responde, pero con otra clave: pega el código de arriba (con ESTA clave), guarda y haz una NUEVA implementación."; continue
  fi
  if ! printf '%s' "$OUT" | grep -Eq '"ok": ?true'; then echo "❌ La hoja respondió: $(printf '%s' "$OUT" | head -c 200)"; continue; fi
  printf '%s' "$OUT" | grep -q '"Documento"' || { echo "❌ La pestaña no trae la columna Documento."; continue; }
  ok=1; break
done
[ -n "$ok" ] || { echo "No se cambió nada."; exit 1; }
echo "   ✅ La hoja responde."

set_var CARTERA_SHEET_URL "$URL"
set_var CARTERA_SHEET_KEY "$KEY"
systemctl restart crm
for _ in $(seq 1 30); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PORT/api/crm/version 2>/dev/null)" != 000 ] && break; sleep 1
done
cat <<'MSG'
✅ Listo. Ahora:
   1. Abre el CRM → pestaña Cartera → "🔄 Traer ahora de la hoja".
   2. Revisa la vista previa (qué facturas cambian de cliente) y toca "Confirmar y cargar".
   3. En "Clientes de la hoja sin WhatsApp" di quién es cada uno (una sola vez).
   Desde ahora el CRM la lee solo, lun-sáb 10:45, 3:00 y 5:45 p. m.
MSG
