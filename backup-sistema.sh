#!/bin/bash
# ══════════════════════════════════════════════════════════════
#  BACKUP DAS CONFIGURAÇÕES DO SISTEMA (João, 14/08/2026)
#  Complementa os backups existentes:
#    backup-projeto.sh  → código e configs do TSCert
#    backup diário 3h   → banco + PDFs (MinIO)
#    ESTE               → o que faz o SERVIDOR funcionar
#  Sem isso, um servidor novo exige remontar nginx, SSL, cron e
#  firewall de memória.
# ══════════════════════════════════════════════════════════════
set -e
DATA=$(date +%Y-%m-%d_%H-%M)
TMP=/tmp/sistema_$DATA
DEST=/root/backups
ARQ=$DEST/sistema_$DATA.tar.gz
REMOTO="gdrive:cert-saas-backups/sistema"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
log "═══ Backup das CONFIGURAÇÕES DO SISTEMA ═══"
mkdir -p "$TMP" "$DEST"

# ── 1. nginx (proxy reverso e virtual hosts) ──
[ -d /etc/nginx ] && cp -a /etc/nginx "$TMP/nginx" && log "nginx copiado"

# ── 2. certificados SSL (Let's Encrypt) ──
[ -d /etc/letsencrypt ] && cp -a /etc/letsencrypt "$TMP/letsencrypt" && log "letsencrypt copiado"

# ── 3. agendamentos ──
mkdir -p "$TMP/cron"
[ -d /etc/cron.d ] && cp -a /etc/cron.d "$TMP/cron/cron.d"
crontab -l > "$TMP/cron/crontab-root.txt" 2>/dev/null || true
log "cron copiado"

# ── 4. firewall ──
mkdir -p "$TMP/firewall"
ufw status verbose > "$TMP/firewall/ufw-status.txt" 2>/dev/null || true
[ -d /etc/ufw ] && cp -a /etc/ufw "$TMP/firewall/ufw"
log "firewall copiado"

# ── 5. segredos e configuração do projeto ──
mkdir -p "$TMP/projeto"
for f in /root/cert-saas/.env /root/cert-saas/docker-compose.yml \
         /root/cert-saas/docker-compose.override.yml; do
  [ -f "$f" ] && cp -a "$f" "$TMP/projeto/"
done
log "env e compose copiados"

# ── 6. rclone (credencial do Google Drive) ──
[ -f /root/.config/rclone/rclone.conf ] && \
  mkdir -p "$TMP/rclone" && cp -a /root/.config/rclone/rclone.conf "$TMP/rclone/" && \
  log "rclone.conf copiado"

# ── 7. scripts operacionais da raiz do projeto ──
mkdir -p "$TMP/scripts"
cp -a /root/cert-saas/*.sh "$TMP/scripts/" 2>/dev/null || true

# ── 8. retrato do servidor (para reconstruir igual) ──
{
  echo "=== TSCert — retrato do servidor em $DATA ==="
  echo; echo "--- SO ---"; lsb_release -a 2>/dev/null | grep -v '^No LSB'
  uname -a
  echo; echo "--- Docker ---"; docker --version; docker compose version
  echo; echo "--- Containers ---"; cd /root/cert-saas && docker compose ps
  echo; echo "--- Imagens ---"; docker images --format '{{.Repository}}:{{.Tag}} ({{.Size}})'
  echo; echo "--- Volumes ---"; docker volume ls
  echo; echo "--- Disco ---"; df -h /
  echo; echo "--- Memória ---"; free -h
  echo; echo "--- Pacotes instalados manualmente ---"
  apt-mark showmanual 2>/dev/null | tr '\n' ' '
  echo; echo; echo "--- Portas em escuta ---"; ss -tlnp 2>/dev/null | head -20
  echo; echo "--- Serviços ativos ---"
  systemctl list-units --type=service --state=running --no-pager --no-legend 2>/dev/null | awk '{print $1}'
} > "$TMP/RETRATO-DO-SERVIDOR.txt" 2>/dev/null || true
log "retrato do servidor gerado"

# ── 9. compacta e envia ──
tar -czf "$ARQ" -C /tmp "sistema_$DATA"
rm -rf "$TMP"
TAM=$(du -h "$ARQ" | cut -f1)
log "Compactado: $ARQ ($TAM)"

if command -v rclone >/dev/null 2>&1; then
  rclone copy "$ARQ" "$REMOTO" 2>&1 | grep -v "^$" || true
  log "Enviado ao Drive: $REMOTO"
else
  log "AVISO: rclone não encontrado — o arquivo ficou apenas local."
fi

# ── 10. limpeza (mantém 60 dias) ──
find "$DEST" -name 'sistema_*.tar.gz' -mtime +60 -delete 2>/dev/null || true
command -v rclone >/dev/null 2>&1 && \
  rclone delete "$REMOTO" --min-age 60d 2>/dev/null || true

log "═══ Concluído ═══"
echo
echo "✓ Backup do sistema: $ARQ ($TAM)"
echo "  Contém: nginx, SSL, cron, firewall, .env, compose, rclone.conf,"
echo "  scripts e o retrato completo do servidor."
echo
echo "ATENÇÃO: este arquivo contém SENHAS (.env e rclone.conf)."
echo "Guarde com o mesmo cuidado das credenciais do servidor."
