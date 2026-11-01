# Where THIS cartera CRM lives on the server. Every deploy script reads this file.
# It runs on the same server as the original CRM (/opt/crm, user crm, service crm, port 4000, /etc/crm), so every
# name and folder here is different on purpose: installing, updating or breaking this one never touches that one.
# Each value can be overridden with an environment variable of the same name.
NAME=${NAME:-crm-cartera}
APP=${APP:-/opt/crm-cartera}
DATA=${DATA:-/var/lib/crm-cartera}
BACKUPS=${BACKUPS:-/var/backups/crm-cartera}
ENV_DIR=${ENV_DIR:-/etc/crm-cartera}
ENV_FILE=${CRM_ENV_FILE:-$ENV_DIR/crm.env}
PORT=${CRM_PORT:-4100}
SERVICE=${SERVICE:-crm-cartera}
RUN_USER=${RUN_USER:-crm-cartera}
# Caddy: this CRM's site goes in its own file, pulled into the main Caddyfile with one `import` line.
CADDY_SITE=${CADDY_SITE:-/etc/caddy/crm-cartera.caddy}
# Health check used after (re)starting: needs the login, answers 200 when the app is up.
HEALTH_PATH=/api/crm/version
