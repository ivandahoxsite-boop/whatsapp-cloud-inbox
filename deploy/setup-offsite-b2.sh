#!/usr/bin/env bash
# One-time setup of the nightly encrypted backup to Backblaze B2 (works from Termius: no Google sign-in step).
#   bash /opt/crm/deploy/setup-offsite-b2.sh
# You type here (never in a chat): the B2 keyID and applicationKey, the bucket name, and a passphrase that encrypts
# the copies. WRITE THE PASSPHRASE DOWN SOMEWHERE SAFE: without it the copies cannot be opened, not even by you.
set -euo pipefail

REMOTE_B2=crm-b2
REMOTE_CRYPT=crm-backup-crypt
FOLDER=${CRM_OFFSITE_FOLDER:-CRM-backups}
[ "$(id -u)" -eq 0 ] || { echo "Ejecuta como root."; exit 1; }

if ! command -v rclone >/dev/null; then
  echo "Instalando rclone..."
  apt-get update -qq && apt-get install -y -qq rclone >/dev/null
fi
echo "rclone: $(rclone version | head -1)"
echo

read -rp "Nombre del bucket de B2 (el que creaste, ej: crm-xsite-copias): " BUCKET
[[ "$BUCKET" =~ ^[A-Za-z0-9-]{6,50}$ ]] || { echo "Nombre de bucket inválido. No se cambió nada."; exit 1; }
read -rsp "keyID (no se verá al pegar): " KEY_ID; echo
read -rsp "applicationKey (no se verá al pegar): " APP_KEY; echo
[ -n "$KEY_ID" ] && [ -n "$APP_KEY" ] || { echo "Faltan las claves. No se cambió nada."; exit 1; }

read -rsp "Frase para cifrar las copias (mínimo 12 caracteres): " PASS; echo
read -rsp "Repítela: " PASS2; echo
[ "$PASS" = "$PASS2" ] || { echo "No coinciden. No se cambió nada."; exit 1; }
[ "${#PASS}" -ge 12 ] || { echo "Muy corta (mínimo 12). No se cambió nada."; exit 1; }

rclone config delete "$REMOTE_B2" >/dev/null 2>&1 || true
rclone config delete "$REMOTE_CRYPT" >/dev/null 2>&1 || true
# hard_delete: copies older than 30 days are really removed (B2 otherwise keeps hidden versions that still count as space).
rclone config create "$REMOTE_B2" b2 account="$KEY_ID" key="$APP_KEY" hard_delete=true --non-interactive >/dev/null
# File names stay readable in B2 (crm-2026-10-25-0345.db.gz.bin); the contents are encrypted.
rclone config create "$REMOTE_CRYPT" crypt remote="$REMOTE_B2:$BUCKET/$FOLDER" filename_encryption=off directory_name_encryption=false password="$PASS" --obscure --non-interactive >/dev/null
chmod 600 /root/.config/rclone/rclone.conf

echo "Probando con un archivo pequeño..."
T=$(mktemp); echo "prueba $(date -u +%FT%TZ)" > "$T"
if ! rclone copyto "$T" "$REMOTE_CRYPT:prueba-crm.txt" 2>/tmp/crm-b2-test.log; then
  tail -n 3 /tmp/crm-b2-test.log; rm -f "$T"
  rclone config delete "$REMOTE_B2" >/dev/null 2>&1 || true; rclone config delete "$REMOTE_CRYPT" >/dev/null 2>&1 || true
  echo "No se pudo subir a B2: revisa el keyID, el applicationKey y el nombre del bucket. No quedó nada configurado."
  exit 1
fi
BACK=$(mktemp); rclone copyto "$REMOTE_CRYPT:prueba-crm.txt" "$BACK"
cmp -s "$T" "$BACK" || { echo "La prueba subió pero no se pudo recuperar igual."; exit 1; }
rclone deletefile "$REMOTE_CRYPT:prueba-crm.txt" || true
rm -f "$T" "$BACK" /tmp/crm-b2-test.log
echo "La prueba de subir, bajar y descifrar salió bien."

cat > /etc/cron.d/crm-offsite-backup <<CRON
# Nightly encrypted backup of the CRM database to Backblaze B2 (after the local backup at 03:15)
45 3 * * * root /opt/crm/deploy/offsite-backup.sh >> /var/log/crm-offsite-backup.log 2>&1
CRON
chmod 644 /etc/cron.d/crm-offsite-backup

echo "Haciendo la primera copia real ahora (puede tardar un minuto)..."
bash "$(dirname "$0")/offsite-backup.sh"
echo
echo "LISTO. Cada noche a las 3:45 se sube una copia cifrada a B2 (bucket '$BUCKET', carpeta '$FOLDER') y se guardan 30 días."
echo "Guarda tu frase de cifrado en un lugar seguro: sin ella no se pueden abrir las copias."
echo "Para recuperar una copia: bash /opt/crm/deploy/restore-offsite-backup.sh"
