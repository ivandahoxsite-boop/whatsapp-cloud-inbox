#!/usr/bin/env bash
# Installs the CRM on Ubuntu 24.04 without Docker and without touching OpenClaw.
#   - dedicated system user `crm`, app in /opt/crm, data in /var/lib/crm
#   - systemd service listening only on 127.0.0.1:4000
#   - Caddy as HTTPS reverse proxy (automatic certificate); /api/agent/* is NOT exposed publicly
#   - daily SQLite backup (14 days kept) and a `crm-update` command
# Usage (as root):  bash install.sh [domain]     e.g. bash install.sh crm.midominio.com
# Without a domain it uses <ip-with-dashes>.sslip.io, which resolves to this server.
# Safe to re-run: existing secrets in /etc/crm/crm.env are kept.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/ivandahoxsite-boop/whatsapp-cloud-inbox.git}"
BRANCH="${BRANCH:-ccr-a1c0a3f6-mh5l7b}"
APP=/opt/crm
DATA=/var/lib/crm
BACKUPS=/var/backups/crm
ENV_DIR=/etc/crm
ENV_FILE=$ENV_DIR/crm.env
PORT=4000

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Ejecuta como root."

# ---- 1. Node ---------------------------------------------------------------
say "Comprobando Node"
command -v node >/dev/null || die "Node no está instalado."
NODE_BIN=$(readlink -f "$(command -v node)")
case "$NODE_BIN" in /root/*) die "Node está en $NODE_BIN y el usuario 'crm' no puede usarlo. Instala Node 22 en /usr (NodeSource o apt) y vuelve a ejecutar." ;; esac
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=5)?0:1)' \
  || die "Hace falta Node 22.5 o superior (tienes $(node -v))."
NODE_DIR=$(dirname "$NODE_BIN")
echo "Node $(node -v) en $NODE_BIN"

# ---- 2. Domain -------------------------------------------------------------
PUBLIC_IP=$(curl -fsS --max-time 8 https://api.ipify.org || true)
DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  [ -n "$PUBLIC_IP" ] || die "No pude detectar la IP pública. Pasa el dominio como argumento."
  DOMAIN="$(echo "$PUBLIC_IP" | tr . -).sslip.io"
fi
RESOLVED=$(getent hosts "$DOMAIN" | awk '{print $1; exit}' || true)
echo "Dominio: $DOMAIN  (resuelve a: ${RESOLVED:-nada})  IP de este servidor: ${PUBLIC_IP:-?}"
if [ -n "$PUBLIC_IP" ] && [ "$RESOLVED" != "$PUBLIC_IP" ]; then
  echo "AVISO: el dominio no apunta a este servidor todavía; el certificado HTTPS fallará hasta que lo haga."
fi

# ---- 3. Packages and user --------------------------------------------------
say "Instalando Caddy y git (no se toca nada más)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq caddy git curl >/dev/null

id crm >/dev/null 2>&1 || useradd --system --home-dir "$APP" --shell /usr/sbin/nologin crm
mkdir -p "$DATA" "$BACKUPS" "$ENV_DIR"
chown crm:crm "$DATA" "$BACKUPS"

# ---- 4. Code and build -----------------------------------------------------
say "Descargando y compilando la aplicación ($BRANCH)"
if [ -d "$APP/.git" ]; then
  sudo -u crm -H git -C "$APP" fetch -q origin "$BRANCH"
  sudo -u crm -H git -C "$APP" checkout -q -B "$BRANCH" "origin/$BRANCH"
else
  mkdir -p "$APP"
  git clone -q --branch "$BRANCH" "$REPO_URL" "$APP" || die "No pude clonar $REPO_URL. Si el repositorio es privado, usa una URL con token de solo lectura: REPO_URL=https://USUARIO:TOKEN@github.com/... bash install.sh"
fi
chown -R crm:crm "$APP"
sudo -u crm -H env PATH="$NODE_DIR:/usr/bin:/bin" bash -c "cd '$APP' && npm ci --no-audit --no-fund && npm run build"

# ---- 5. Secrets ------------------------------------------------------------
if [ ! -f "$ENV_FILE" ]; then
  say "Configuración (Enter para dejar vacío y completarlo después en $ENV_FILE)"
  read -rsp "KAPSO_API_KEY: " KAPSO_API_KEY; echo
  read -rp "PHONE_NUMBER_ID de tu número de WhatsApp en Kapso: " PHONE_NUMBER_ID
  INBOX_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=\n' | cut -c1-20)
  umask 077
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
INBOX_USERNAME=admin
INBOX_PASSWORD=$INBOX_PASSWORD
KAPSO_API_KEY=${KAPSO_API_KEY// /}
PHONE_NUMBER_ID=${PHONE_NUMBER_ID// /}
KAPSO_WEBHOOK_SECRET=$(openssl rand -hex 24)
CRM_AGENT_TOKEN=$(openssl rand -hex 24)
INBOX_ACCESS_KEY=$(openssl rand -hex 24)
CRM_DB_PATH=$DATA/crm.db
EOF
  NEW_ENV=1
else
  say "Se conserva la configuración existente en $ENV_FILE"
  NEW_ENV=0
fi
chown root:crm "$ENV_FILE"; chmod 640 "$ENV_FILE"

# ---- 6. systemd ------------------------------------------------------------
say "Creando el servicio"
cat > /etc/systemd/system/crm.service <<EOF
[Unit]
Description=CRM (WhatsApp inbox + CRM)
After=network.target

[Service]
User=crm
Group=crm
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

# ---- 7. Caddy + firewall ---------------------------------------------------
say "Configurando HTTPS"
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
	# The agent API is only for OpenClaw on this same server (http://127.0.0.1:$PORT)
	@agent path /api/agent/*
	respond @agent 404
	encode zstd gzip
	reverse_proxy 127.0.0.1:$PORT
}
EOF
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  echo "ufw: abiertos 80 y 443 (el 22 y lo demás no se tocan)"
fi

# ---- 8. Backup and update helpers ------------------------------------------
cat > /usr/local/bin/crm-backup <<EOF
#!/usr/bin/env bash
set -euo pipefail
out="$BACKUPS/crm-\$(date +%F-%H%M).db"
"$NODE_BIN" --no-warnings -e "const {DatabaseSync}=require('node:sqlite'); new DatabaseSync('$DATA/crm.db').exec(\"VACUUM INTO '\" + process.argv[1] + \"'\")" "\$out"
find "$BACKUPS" -name 'crm-*.db' -mtime +14 -delete
echo "backup: \$out"
EOF
chmod 755 /usr/local/bin/crm-backup
echo "15 3 * * * crm /usr/local/bin/crm-backup >/dev/null 2>&1" > /etc/cron.d/crm-backup

# Thin wrapper: the real update logic lives in the repo, so it improves with every update.
cat > /usr/local/bin/crm-update <<'EOF'
#!/bin/sh
exec bash /opt/crm/deploy/update.sh "$@"
EOF
chmod 755 /usr/local/bin/crm-update

# ---- 9. Start --------------------------------------------------------------
say "Arrancando"
systemctl daemon-reload
systemctl enable --now crm >/dev/null
systemctl restart crm
systemctl restart caddy

set -a; . "$ENV_FILE"; set +a
ok=0
for _ in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -u "admin:$INBOX_PASSWORD" "http://127.0.0.1:$PORT/api/crm/fields" || true)
  [ "$code" = "200" ] && { ok=1; break; }
  sleep 1
done
[ "$ok" = 1 ] || die "El CRM no respondió. Mira: journalctl -u crm -n 50 --no-pager"
echo "CRM local: OK"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://$DOMAIN/" || true)
echo "HTTPS público https://$DOMAIN -> HTTP $code (401 = correcto, pide contraseña)"
agent=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://$DOMAIN/api/agent/customers" || true)
echo "API del agente desde internet -> HTTP $agent (404 = correcto, no expuesta)"

cat <<EOF

================ LISTO ================
CRM:         https://$DOMAIN/crm
Usuario:     admin
EOF
[ "$NEW_ENV" = 1 ] && echo "Contraseña:  $INBOX_PASSWORD   (anótala; NO la pegues en el chat)"
cat <<EOF

Webhook de Kapso (ejecútalo una vez):
  source $ENV_FILE
  curl -X POST "https://api.kapso.ai/platform/v1/whatsapp/phone_numbers/\$PHONE_NUMBER_ID/webhooks" \\
    -H "X-API-Key: \$KAPSO_API_KEY" -H "Content-Type: application/json" \\
    -d "{\\"whatsapp_webhook\\":{\\"url\\":\\"https://$DOMAIN/api/webhooks/kapso\\",\\"events\\":[\\"whatsapp.message.received\\",\\"whatsapp.message.sent\\"],\\"secret_key\\":\\"\$KAPSO_WEBHOOK_SECRET\\"}}"

OpenClaw (mismo servidor):  CRM_BASE_URL=http://127.0.0.1:$PORT   token en $ENV_FILE (CRM_AGENT_TOKEN)
Actualizar:  crm-update      Copia manual:  crm-backup      Logs:  journalctl -u crm -f
EOF
