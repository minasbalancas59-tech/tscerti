#!/bin/bash
# ══════════════════════════════════════════════════════════════
#  BACKUP RÁPIDO DO BANCO (João, 14/08/2026)
#  Só o PostgreSQL (17 MB) — leve o bastante para rodar de 2 em
#  2 horas. Reduz a perda máxima de 24h para 2h.
#  Complementa (não substitui) o backup completo diário das 3h,
#  que também guarda os PDFs do MinIO.
# ══════════════════════════════════════════════════════════════
set -e
cd /root/cert-saas
DATA=$(date +%Y-%m-%d_%Hh%M)
DEST=/root/backups/banco
ARQ="$DEST/banco_$DATA.sql.gz"
REMOTO="gdrive:cert-saas-backups/banco"
mkdir -p "$DEST"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# ── dump comprimido ──
docker compose exec -T db pg_dump -U certsaas -d certsaas --clean --if-exists \
  | gzip -9 > "$ARQ"

TAM=$(du -h "$ARQ" | cut -f1)
# sanidade: dump muito pequeno indica falha
BYTES=$(stat -c%s "$ARQ")
if [ "$BYTES" -lt 10000 ]; then
  log "ERRO: dump com apenas $BYTES bytes — algo falhou. Arquivo mantido para análise."
  exit 1
fi
log "Dump gerado: $ARQ ($TAM)"

# ── envia ao Drive ──
if command -v rclone >/dev/null 2>&1; then
  rclone copy "$ARQ" "$REMOTO" 2>/dev/null && log "Enviado ao Drive: $REMOTO"
else
  log "AVISO: rclone ausente — cópia apenas local."
fi

# ── retenção: 3 dias local (36 arquivos), 7 dias no Drive ──
find "$DEST" -name 'banco_*.sql.gz' -mtime +3 -delete 2>/dev/null || true
command -v rclone >/dev/null 2>&1 && rclone delete "$REMOTO" --min-age 7d 2>/dev/null || true

log "Concluído ($(ls -1 "$DEST" | wc -l) cópias locais)"
