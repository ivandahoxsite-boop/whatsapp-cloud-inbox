#!/usr/bin/env bash
# Read-only VPS diagnostic for the CRM deployment. Installs nothing, changes nothing.
# It never prints environment variables, tokens or config file contents.
# Usage: bash diagnose.sh [crm.yourdomain.com]
DOMAIN="${1:-}"
have() { command -v "$1" >/dev/null 2>&1; }
sec() { printf '\n== %s ==\n' "$1"; }

sec "Sistema"
. /etc/os-release 2>/dev/null && echo "OS: $PRETTY_NAME"
echo "Kernel: $(uname -r)  Arch: $(uname -m)"
echo "CPU cores: $(nproc)"
free -m | awk 'NR==1||/Mem|Swap/'
echo "Uptime: $(uptime -p)"
echo "Usuario: $(id -un)  sudo sin clave: $(sudo -n true 2>/dev/null && echo si || echo no)"

sec "Disco"
df -h / | tail -n +1
[ -d /var/lib/docker ] && echo "docker dir: $(du -sh /var/lib/docker 2>/dev/null | cut -f1)"

sec "Herramientas (version)"
for t in node npm git docker caddy nginx apache2 certbot pm2 curl openssl; do
  if have "$t"; then
    case "$t" in
      node) v=$(node -v) ;;
      docker) v=$(docker --version 2>/dev/null) ;;
      caddy) v=$(caddy version 2>/dev/null | head -1) ;;
      nginx) v=$(nginx -v 2>&1) ;;
      openssl) v=$(openssl version) ;;
      *) v=$("$t" --version 2>&1 | head -1) ;;
    esac
    echo "$t: $v"
  else
    echo "$t: NO instalado"
  fi
done
have node && node -e 'const [a,b]=process.versions.node.split(".").map(Number);console.log("node:sqlite disponible (>=22.5):",a>22||(a===22&&b>=5)?"si":"NO")'
have docker && echo "docker compose: $(docker compose version 2>/dev/null | head -1 || echo NO)"

sec "Puertos en escucha (proceso)"
(ss -ltnpH 2>/dev/null || netstat -ltnp 2>/dev/null) | awk '{print $1, $4, $NF}' | sort -u
for p in 80 443 4000 18789; do
  (ss -ltnH 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]$p$") && echo "puerto $p: OCUPADO" || echo "puerto $p: libre"
done

sec "Firewall"
have ufw && sudo -n ufw status 2>/dev/null | head -12 || echo "ufw: no disponible o requiere sudo"
have iptables && echo "reglas iptables INPUT: $(sudo -n iptables -S INPUT 2>/dev/null | wc -l)"

sec "Docker (solo nombres, sin variables de entorno)"
have docker && docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}' 2>/dev/null || echo "sin acceso a docker"

sec "OpenClaw (solo detección)"
found=$(pgrep -af -i 'openclaw|clawdbot|moltbot' | grep -v -E "^($$|$PPID) |pgrep|diagnose" | cut -c1-120 | sed -E 's/(--?token|--?password|--?key)[= ][^ ]*/\1=***/' | head -5)
[ -n "$found" ] && echo "proceso: $found" || echo "sin proceso de OpenClaw en ejecucion"
for d in "$HOME/.openclaw" "$HOME/.clawdbot" "$HOME/.moltbot"; do [ -d "$d" ] && echo "carpeta: $d  (skills: $(ls "$d/workspace/skills" 2>/dev/null | wc -l))"; done
systemctl list-units --type=service --no-pager 2>/dev/null | grep -i -E 'claw|molt' || echo "sin servicio systemd de OpenClaw"
have openclaw && echo "cli: $(openclaw --version 2>&1 | head -1)"

sec "Red"
echo "IP publica: $(curl -s --max-time 5 https://api.ipify.org || echo 'no se pudo obtener')"
for u in https://api.kapso.ai https://registry.npmjs.org https://api.telegram.org; do
  echo "$u -> HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$u")"
done
if [ -n "$DOMAIN" ]; then
  echo "DNS $DOMAIN -> $(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || true)"
fi

sec "Zona horaria / hora"
timedatectl 2>/dev/null | grep -E 'Time zone|synchronized' || date
echo; echo "Listo. Copia todo lo anterior y pegalo en el chat (puedes ocultar la IP si prefieres)."
