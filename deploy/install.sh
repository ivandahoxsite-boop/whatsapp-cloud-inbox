#!/usr/bin/env bash
# Installs this cartera-only CRM on Ubuntu 24.04, NEXT TO the original CRM on the same server, without touching it.
#   - its own system user, folders, env file, port and systemd service (see deploy/instance.sh)
#   - its own HTTPS site in Caddy, in a separate file; the existing Caddyfile only gains one `import` line
#     (a copy is kept, the config is validated before reloading and restored if anything fails)
#   - daily SQLite backup (14 days kept) and the commands crm-cartera-update / crm-cartera-backup
#   - at the end it checks that the original CRM still answers exactly as before
# Usage (as root):  bash install.sh [domain]
# Without a domain it uses cartera.<ip-with-dashes>.sslip.io, which resolves to this server.
# Safe to re-run: existing secrets in the env file are kept.
set -euo pipefail

DIR=$(cd "$(dirname "$0")" && pwd)
. "$DIR/instance.sh"
REPO_URL="${REPO_URL:-https://github.com/ivandahoxsite-boop/whatsapp-cloud-inbox.git}"
BRANCH="${BRANCH:-claude/gallant-cerf-q36pfa}"

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Ejecuta como root."
case "$APP" in /opt/crm|/opt/crm/) die "APP=$APP es la carpeta del CRM original. No se toca." ;; esac
[ "$SERVICE" != crm ] && [ "$RUN_USER" != crm ] && [ "$ENV_FILE" != /etc/crm/crm.env ] || die "Esos nombres son los del CRM original. Revisa deploy/instance.sh."

# ---- 1. Node ---------------------------------------------------------------
say "Comprobando Node"
command -v node >/dev/null || die "Node no está instalado."
NODE_BIN=$(readlink -f "$(command -v node)")
case "$NODE_BIN" in /root/*) die "Node está en $NODE_BIN y el usuario '$RUN_USER' no puede usarlo. Instala Node 22 en /usr." ;; esac
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=5)?0:1)' \
  || die "Hace falta Node 22.5 o superior (tienes $(node -v))."
NODE_DIR=$(dirname "$NODE_BIN")
echo "Node $(node -v) en $NODE_BIN"

# ---- 2. Port and domain ----------------------------------------------------
if ! systemctl is-active -q "$SERVICE" 2>/dev/null && ss -ltn "( sport = :$PORT )" | grep -q ":$PORT"; then
  die "El puerto $PORT ya lo usa otro programa. Elige otro: CRM_PORT=4101 bash install.sh"
fi
PUBLIC_IP=$(curl -fsS --max-time 8 https://api.ipify.org || true)
DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  [ -n "$PUBLIC_IP" ] || die "No pude detectar la IP pública. Pasa el dominio como argumento."
  DOMAIN="cartera.$(echo "$PUBLIC_IP" | tr . -).sslip.io"
fi
RESOLVED=$(getent hosts "$DOMAIN" | awk '{print $1; exit}' || true)
echo "Dominio: $DOMAIN  (resuelve a: ${RESOLVED:-nada})  IP de este servidor: ${PUBLIC_IP:-?}"
if [ -n "$PUBLIC_IP" ] && [ "$RESOLVED" != "$PUBLIC_IP" ]; then
  echo "AVISO: el dominio no apunta a este servidor todavía; el certificado HTTPS fallará hasta que lo haga."
fi

# How the sites already served by Caddy answer now, to compare at the end.
OTHER_SITES=$(grep -hoE '^[A-Za-z0-9.-]+\.[A-Za-z]{2,}' /etc/caddy/Caddyfile 2>/dev/null | grep -vx "$DOMAIN" | sort -u || true)
declare -A BEFORE=()
for s in $OTHER_SITES; do BEFORE[$s]=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$s/" || true); done

# ---- 3. Packages and user --------------------------------------------------
say "Comprobando Caddy y git (no se instala ni se actualiza nada que ya esté)"
command -v caddy >/dev/null && command -v git >/dev/null || {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq && apt-get install -y -qq caddy git curl >/dev/null
}

id "$RUN_USER" >/dev/null 2>&1 || useradd --system --home-dir "$APP" --shell /usr/sbin/nologin "$RUN_USER"
mkdir -p "$DATA" "$BACKUPS" "$ENV_DIR"
chown "$RUN_USER:$RUN_USER" "$DATA" "$BACKUPS"

# ---- 4. Code and build -----------------------------------------------------
say "Descargando y compilando la aplicación ($BRANCH) en $APP"
if [ -d "$APP/.git" ]; then
  sudo -u "$RUN_USER" -H git -C "$APP" fetch -q origin "$BRANCH"
  sudo -u "$RUN_USER" -H git -C "$APP" checkout -q -B "$BRANCH" "origin/$BRANCH"
else
  mkdir -p "$APP"
  git clone -q --branch "$BRANCH" "$REPO_URL" "$APP" || die "No pude clonar $REPO_URL."
fi
chown -R "$RUN_USER:$RUN_USER" "$APP"
sudo -u "$RUN_USER" -H env PATH="$NODE_DIR:/usr/bin:/bin" bash -c "cd '$APP' && npm ci --no-audit --no-fund && sha256sum package-lock.json | cut -d' ' -f1 > node_modules/.crm-lock-hash && npm run build"

# ---- 5. Secrets ------------------------------------------------------------
if [ ! -f "$ENV_FILE" ]; then
  say "Creando la configuración en $ENV_FILE"
  INBOX_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=\n' | cut -c1-20)
  umask 077
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
INBOX_USERNAME=admin
INBOX_PASSWORD=$INBOX_PASSWORD
INBOX_ACCESS_KEY=$(openssl rand -hex 24)
CRM_DB_PATH=$DATA/crm.db
CRM_DEFAULT_TERMS_DAYS=30
PUSH_SUBJECT=mailto:admin@$DOMAIN
EOF
  NEW_ENV=1
else
  say "Se conserva la configuración existente en $ENV_FILE"
  NEW_ENV=0
fi
chown "root:$RUN_USER" "$ENV_FILE"; chmod 640 "$ENV_FILE"

# ---- 6. systemd ------------------------------------------------------------
say "Creando el servicio $SERVICE (puerto $PORT, solo 127.0.0.1)"
cat > "/etc/systemd/system/$SERVICE.service" <<EOF
[Unit]
Description=CRM de cartera ($NAME)
After=network.target

[Service]
User=$RUN_USER
Group=$RUN_USER
WorkingDirectory=$APP
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_BIN $APP/node_modules/next/dist/bin/next start -H 127.0.0.1 -p $PORT
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

# ---- 7. Caddy (own file + one import line) ---------------------------------
say "Configurando HTTPS en un archivo aparte ($CADDY_SITE)"
CADDY_BAK="/etc/caddy/Caddyfile.antes-de-$NAME.$(date +%F-%H%M%S)"
cp -a /etc/caddy/Caddyfile "$CADDY_BAK"
[ -f "$CADDY_SITE" ] && cp -a "$CADDY_SITE" "$CADDY_SITE.bak"
cat > "$CADDY_SITE" <<EOF
$DOMAIN {
	encode zstd gzip
	reverse_proxy 127.0.0.1:$PORT
}
EOF
grep -qxF "import $CADDY_SITE" /etc/caddy/Caddyfile || printf '\nimport %s\n' "$CADDY_SITE" >> /etc/caddy/Caddyfile
if ! caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/tmp/$NAME-caddy.log 2>&1; then
  tail -n 15 /tmp/$NAME-caddy.log
  cp -a "$CADDY_BAK" /etc/caddy/Caddyfile
  rm -f "$CADDY_SITE"; [ -f "$CADDY_SITE.bak" ] && mv "$CADDY_SITE.bak" "$CADDY_SITE"
  die "La configuración de Caddy no es válida. Se dejó exactamente como estaba; el CRM original no se tocó."
fi
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
fi

# ---- 8. Backup and update helpers ------------------------------------------
cat > "/usr/local/bin/$NAME-backup" <<EOF
#!/usr/bin/env bash
set -euo pipefail
out="$BACKUPS/crm-\$(date +%F-%H%M).db"
"$NODE_BIN" --no-warnings -e "const {DatabaseSync}=require('node:sqlite'); new DatabaseSync('$DATA/crm.db').exec(\"VACUUM INTO '\" + process.argv[1] + \"'\")" "\$out"
find "$BACKUPS" -name 'crm-*.db' -mtime +14 -delete
echo "backup: \$out"
EOF
chmod 755 "/usr/local/bin/$NAME-backup"
echo "25 3 * * * $RUN_USER /usr/local/bin/$NAME-backup >/dev/null 2>&1" > "/etc/cron.d/$NAME-backup"

cat > "/usr/local/bin/$NAME-update" <<EOF
#!/bin/sh
exec bash $APP/deploy/update.sh "\$@"
EOF
chmod 755 "/usr/local/bin/$NAME-update"

# ---- 9. Start --------------------------------------------------------------
say "Arrancando"
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null
systemctl restart "$SERVICE"
# reload, not restart: the other sites keep serving without a cut
if ! systemctl reload caddy; then
  cp -a "$CADDY_BAK" /etc/caddy/Caddyfile
  rm -f "$CADDY_SITE"; [ -f "$CADDY_SITE.bak" ] && mv "$CADDY_SITE.bak" "$CADDY_SITE"
  systemctl reload caddy || true
  die "Caddy no aceptó el cambio. Se volvió a poner el Caddyfile anterior; los otros sitios siguen igual."
fi

set -a; . "$ENV_FILE"; set +a
ok=0
for _ in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -u "${INBOX_USERNAME:-admin}:$INBOX_PASSWORD" "http://127.0.0.1:$PORT$HEALTH_PATH" || true)
  [ "$code" = "200" ] && { ok=1; break; }
  sleep 1
done
[ "$ok" = 1 ] || die "El CRM de cartera no respondió. Mira: journalctl -u $SERVICE -n 50 --no-pager"
echo "CRM de cartera local: OK"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "https://$DOMAIN/" || true)
echo "HTTPS público https://$DOMAIN -> HTTP $code (401 = correcto, pide contraseña)"

say "Revisando que los otros sitios sigan igual"
for s in $OTHER_SITES; do
  now=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$s/" || true)
  if [ "$now" = "${BEFORE[$s]}" ]; then echo "  ✅ $s -> HTTP $now (igual que antes)"; else echo "  ⚠️ $s -> antes HTTP ${BEFORE[$s]}, ahora HTTP $now. Revísalo."; fi
done

cat <<EOF

================ LISTO ================
CRM de cartera:  https://$DOMAIN/crm
Usuario:         admin
EOF
[ "$NEW_ENV" = 1 ] && echo "Contraseña:      $INBOX_PASSWORD   (anótala; NO la pegues en el chat)"
cat <<EOF

Siguiente paso, conectar la hoja:  bash $APP/deploy/setup-cartera-hoja.sh
Actualizar:  $NAME-update      Copia manual:  $NAME-backup      Logs:  journalctl -u $SERVICE -f
Copia del Caddyfile anterior:  $CADDY_BAK
EOF
