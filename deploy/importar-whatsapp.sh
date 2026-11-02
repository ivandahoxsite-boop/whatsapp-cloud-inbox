#!/usr/bin/env bash
# Copies to this cartera CRM the WhatsApp of customers already linked by NIT in the original CRM (read-only there).
#   bash /opt/crm-cartera/deploy/importar-whatsapp.sh
set -euo pipefail
DIR=$(cd "$(dirname "$0")" && pwd)
. "$DIR/instance.sh"
[ "$(id -u)" -eq 0 ] || { echo "Ejecuta como root."; exit 1; }
CRM_ENV_FILE="$ENV_FILE" CRM_PORT="$PORT" node --no-warnings "$DIR/importar-whatsapp.mjs"
