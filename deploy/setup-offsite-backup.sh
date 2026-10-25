#!/usr/bin/env bash
# One-time setup of the nightly encrypted backup to YOUR Google Drive.
#   bash /opt/crm/deploy/setup-offsite-backup.sh
# You need two things, typed here and never sent to anyone:
#   1) the Google Drive token (a line of text that starts with {"access_token": ... made on your phone with Termux, see the guide)
#   2) a passphrase to encrypt the backups. WRITE IT DOWN SOMEWHERE SAFE: without it the backups cannot be opened.
set -euo pipefail

REMOTE_DRIVE=crm-gdrive
REMOTE_CRYPT=crm-backup-crypt
FOLDER=${CRM_OFFSITE_FOLDER:-CRM-backups}
[ "$(id -u)" -eq 0 ] || { echo "Ejecuta como root."; exit 1; }

if ! command -v rclone >/dev/null; then
  echo "Instalando rclone..."
  apt-get update -qq && apt-get install -y -qq rclone >/dev/null
fi
echo "rclone: $(rclone version | head -1)"

echo
read -rsp "Pega el token de Google Drive (una sola línea; no se verá al pegar) y pulsa Enter: " TOKEN; echo
case "$TOKEN" in *'"access_token"'*'"refresh_token"'*) ;; *) echo "Eso no parece un token de Drive (debe traer access_token y refresh_token). No se cambió nada."; exit 1;; esac

read -rsp "Frase para cifrar las copias (mínimo 12 caracteres): " PASS; echo
read -rsp "Repítela: " PASS2; echo
[ "$PASS" = "$PASS2" ] || { echo "No coinciden. No se cambió nada."; exit 1; }
[ "${#PASS}" -ge 12 ] || { echo "Muy corta (mínimo 12). No se cambió nada."; exit 1; }

# Only files this tool creates are visible to it (drive.file): it cannot read the rest of your Drive.
rclone config delete "$REMOTE_DRIVE" >/dev/null 2>&1 || true
rclone config delete "$REMOTE_CRYPT" >/dev/null 2>&1 || true
rclone config create "$REMOTE_DRIVE" drive scope=drive.file token="$TOKEN" --non-interactive >/dev/null
# File names stay readable in Drive (crm-2026-10-25-0345.db.gz.bin); the contents are encrypted.
rclone config create "$REMOTE_CRYPT" crypt remote="$REMOTE_DRIVE:$FOLDER" filename_encryption=off directory_name_encryption=false password="$PASS" --obscure --non-interactive >/dev/null
chmod 600 /root/.config/rclone/rclone.conf

echo "Probando con un archivo pequeño..."
T=$(mktemp); echo "prueba $(date -u +%FT%TZ)" > "$T"
rclone copyto "$T" "$REMOTE_CRYPT:prueba-crm.txt" || { echo "No se pudo subir a Drive. Revisa el token."; rm -f "$T"; exit 1; }
BACK=$(mktemp); rclone copyto "$REMOTE_CRYPT:prueba-crm.txt" "$BACK"
cmp -s "$T" "$BACK" || { echo "La prueba subió pero no se pudo recuperar igual."; exit 1; }
rclone deletefile "$REMOTE_CRYPT:prueba-crm.txt" || true
rm -f "$T" "$BACK"
echo "La prueba de subir, bajar y descifrar salió bien."

cat > /etc/cron.d/crm-offsite-backup <<CRON
# Nightly encrypted backup of the CRM database to Google Drive (after the local backup at 03:15)
45 3 * * * root /opt/crm/deploy/offsite-backup.sh >> /var/log/crm-offsite-backup.log 2>&1
CRON
chmod 644 /etc/cron.d/crm-offsite-backup

echo "Haciendo la primera copia real ahora (puede tardar un minuto)..."
bash "$(dirname "$0")/offsite-backup.sh"
echo
echo "LISTO. Cada noche a las 3:45 se sube una copia cifrada a tu Drive, carpeta '$FOLDER'."
echo "Guarda tu frase de cifrado en un lugar seguro: sin ella no se pueden abrir las copias."
echo "Para ver las copias: abre Drive y busca la carpeta $FOLDER. Para recuperar una: bash /opt/crm/deploy/restore-offsite-backup.sh"
