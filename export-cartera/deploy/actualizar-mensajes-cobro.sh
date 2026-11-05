#!/usr/bin/env bash
# Pone los 4 mensajes de cobro por días de mora (aprobados el 5-nov-2026) en un CRM armado con este paquete de
# cartera, sin tocar nada más. Seguro: solo cambia src/lib/crm/collection-messages.ts y nunca deja el CRM dañado.
#   1. Comprueba que ese archivo sea EXACTAMENTE el del paquete original; si alguien lo cambió, no hace nada.
#   2. Descarga el archivo nuevo y comprueba que sea EXACTAMENTE el probado.
#   3. Guarda una copia del archivo actual, compila APARTE (.next-new) mientras el CRM sigue funcionando.
#   4. Solo si compila: cambia la versión y reinicia. Si no compila o no arranca, vuelve solo a como estaba.
# Uso (como root):  bash actualizar-mensajes-cobro.sh            (por defecto el CRM en /opt/crm-cartera, puerto 4100)
set -euo pipefail

APP=${APP:-/opt/crm-cartera}
SVC=${SVC:-crm-cartera}
PORT=${PORT:-4100}
RUN_AS=${RUN_AS:-crm-cartera}
FILE="$APP/src/lib/crm/collection-messages.ts"
SHA_ORIGINAL=4b4e0d0ef1b4b0e60224b017eb7eb9d482d793d10749a199d508f7ed767fea9b
SHA_NUEVO=bf0bdc68c995ef51c517896a81986b551c3ad242d76c50737f5c0484397911ab
URL=${URL:-https://raw.githubusercontent.com/ivandahoxsite-boop/whatsapp-cloud-inbox/export/cartera-medellin/export-cartera/src/lib/crm/collection-messages.ts}

say() { printf '\n▶ %s\n' "$*"; }
die() { printf '\n✖ %s\n' "$*"; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Ejecuta como root."
[ -f "$FILE" ] || die "No encuentro $FILE. No cambié nada."
grep -q NEXT_DIST_DIR "$APP"/next.config.* || die "Este CRM no compila aparte (falta NEXT_DIST_DIR en next.config). No cambié nada."

ACTUAL=$(sha256sum "$FILE" | cut -d' ' -f1)
[ "$ACTUAL" = "$SHA_NUEVO" ] && { echo "✅ Los mensajes nuevos ya estaban puestos. No hay nada que hacer."; exit 0; }
[ "$ACTUAL" = "$SHA_ORIGINAL" ] || die "El archivo de mensajes de este CRM fue cambiado por alguien y no es el del paquete. No cambié nada, para no pisar esos cambios."

say "Descargando los mensajes nuevos"
TMP=$(mktemp -d)
curl -fsSL "$URL" -o "$TMP/cm.ts" || die "No pude descargar el archivo. No cambié nada."
[ "$(sha256sum "$TMP/cm.ts" | cut -d' ' -f1)" = "$SHA_NUEVO" ] || die "El archivo descargado no es el que se probó. No cambié nada."

STAMP=$(date +%Y%m%d-%H%M)
COPIA="$FILE.antes-$STAMP"
cp -p "$FILE" "$COPIA"
echo "Copia del archivo actual: $COPIA"
install -o "$RUN_AS" -g "$RUN_AS" -m 644 "$TMP/cm.ts" "$FILE"

restore_file() { cp -p "$COPIA" "$FILE"; }

say "Compilando aparte (el CRM sigue funcionando mientras tanto; tarda 1 o 2 minutos)"
cd "$APP"
rm -rf "$APP/.next-new"
if ! sudo -u "$RUN_AS" -H env NEXT_DIST_DIR=.next-new /usr/bin/node node_modules/next/dist/bin/next build > "$TMP/build.log" 2>&1; then
  restore_file
  rm -rf "$APP/.next-new"
  tail -20 "$TMP/build.log"
  die "No compiló. Dejé todo como estaba; el CRM sigue funcionando sin cambios."
fi

say "Cambiando a la versión nueva y reiniciando"
rm -rf "$APP/.next-old"
mv "$APP/.next" "$APP/.next-old"
mv "$APP/.next-new" "$APP/.next"
systemctl restart "$SVC"

ok=0
for _ in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/crm" || true)
  case "$code" in 200|302|307|401) ok=1; break ;; esac
  sleep 2
done
if [ "$ok" -ne 1 ]; then
  say "La versión nueva no respondió: volviendo a la anterior"
  systemctl stop "$SVC" || true
  rm -rf "$APP/.next-fallida"
  mv "$APP/.next" "$APP/.next-fallida"
  mv "$APP/.next-old" "$APP/.next"
  restore_file
  systemctl start "$SVC"
  die "Volví a la versión anterior. El CRM quedó como estaba."
fi

rm -rf "$TMP"
echo
echo "✅ Listo: el CRM ($SVC) ya tiene los 4 mensajes nuevos de cobro y responde bien."
echo "   Si quiere deshacerlo: cp -p $COPIA $FILE  y vuelva a compilar."
