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
read -rp "URL de la aplicación web: " URL; URL=$(printf '%s' "$URL" | tr -d '[:space:]')
[[ "$URL" =~ ^https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec$ ]] || { echo "Esa no parece la URL (https://script.google.com/macros/s/.../exec). No se cambió nada."; exit 1; }

echo "Probando la lectura de la hoja..."
# The key goes to curl through stdin, so it never shows in the list of running processes.
OUT=$(printf 'url = "%s?k=%s"\n' "$URL" "$KEY" | curl -sL --max-time 60 -K - || true)
if ! printf '%s' "$OUT" | grep -q '"ok":true'; then
  if printf '%s' "$OUT" | grep -q '"error":"clave"'; then echo "La clave no coincide: vuelve a pegar el código del PASO 2 y crea una NUEVA implementación."
  elif printf '%s' "$OUT" | grep -q '"error"'; then echo "La hoja respondió: $(printf '%s' "$OUT" | head -c 200)"
  else echo "Google no devolvió la cartera. Revisa que en 'Quién tiene acceso' diga 'Cualquier persona'."; fi
  echo "No se cambió nada."; exit 1
fi
printf '%s' "$OUT" | grep -q '"Documento"' || { echo "La pestaña no trae la columna Documento. No se cambió nada."; exit 1; }
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
