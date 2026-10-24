#!/usr/bin/env bash
# Shows what the CRM receives from browsers (status, path, whether credentials were sent).
# Never prints passwords: Caddy redacts the Authorization header.
#   bash access-check.sh on     enable request logging in Caddy
#   bash access-check.sh show   list the last requests (default)
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
import sys, json
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
    rows.append("%s  %-5s %-34s %s  %s" % (
        d.get("status"), r.get("method"), r.get("uri", "")[:34],
        "con-credenciales" if "Authorization" in h else "SIN-credenciales",
        (h.get("User-Agent") or [""])[0][:38]))
print("\n".join(rows[-12:]) if rows else "No hay peticiones registradas en los últimos 20 min.")
'
    ;;
  *) echo "uso: bash $0 on|show"; exit 1 ;;
esac
