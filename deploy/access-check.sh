#!/usr/bin/env bash
# Shows what the CRM receives from browsers (status, path, whether credentials were sent).
# Never prints passwords: Caddy redacts the Authorization header.
#   bash access-check.sh on     enable request logging in Caddy
#   bash access-check.sh show   list the last requests (default)
#   bash access-check.sh off    disable request logging (URLs with ?key= would otherwise be logged)
set -euo pipefail
case "${1:-show}" in
  on)
    grep -qP '^\tlog$' /etc/caddy/Caddyfile || sed -i 's|^\treverse_proxy|\tlog\n\treverse_proxy|' /etc/caddy/Caddyfile
    caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1 || { echo "Caddyfile inválido, no se recargó"; exit 1; }
    systemctl reload caddy
    echo "Registro activado. Intenta entrar al CRM desde el celular y luego ejecuta: bash $0 show"
    ;;
  show)
    journalctl -u caddy --since "-20min" -o cat --no-pager | python3 -c '
import sys, json, re
rows = []
for line in sys.stdin:
    try:
        d = json.loads(line)
    except ValueError:
        continue
    if d.get("msg") != "handled request":
        continue
    r = d["request"]
    h = r.get("headers", {})
    uri = re.sub(r"key=[^&]*", "key=***", r.get("uri", ""))[:30]
    rows.append("%s %-4s %-30s clave/pass:%-3s cookie:%-3s %s" % (
        d.get("status"), r.get("method"), uri,
        "si" if "Authorization" in h else "no",
        "si" if "Cookie" in h else "no",
        (h.get("User-Agent") or [""])[0][:26]))
print("\n".join(rows[-12:]) if rows else "No hay peticiones registradas en los últimos 20 min.")
'
    ;;
  off)
    sed -i '/^\tlog$/d' /etc/caddy/Caddyfile
    systemctl reload caddy
    echo "Registro desactivado."
    ;;
  *) echo "uso: bash $0 on|show|off"; exit 1 ;;
esac
