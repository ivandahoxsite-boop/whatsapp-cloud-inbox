#!/usr/bin/env bash
# Makes Caddy compress what it sends (the customer list drops from ~700 KB to ~80 KB on the phone).
# Safe to run twice: it only adds the line when missing and keeps the old Caddyfile if the new one is invalid.
set -euo pipefail
FILE=/etc/caddy/Caddyfile
[ "$(id -u)" -eq 0 ] || { echo "Ejecuta como root."; exit 1; }
grep -q '^\s*encode ' "$FILE" && { echo "Ya estaba activada la compresión."; exit 0; }
cp "$FILE" "$FILE.bak"
sed -i 's|^\treverse_proxy|\tencode zstd gzip\n\treverse_proxy|' "$FILE"
if ! caddy validate --config "$FILE" >/dev/null 2>&1; then
  cp "$FILE.bak" "$FILE"
  echo "El Caddyfile quedó inválido; dejé el original. No se cambió nada."
  exit 1
fi
systemctl reload caddy
echo "Compresión activada. (Copia del Caddyfile anterior: $FILE.bak)"
