#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Backup do PROJETO (código + configs + senhas) → Google Drive
#   Diferente do backup.sh (que salva os DADOS: banco + PDFs),
#   este salva o código-fonte e a configuração do projeto.
#
#   Rode sempre que fizer alterações grandes no código.
#   Uso: ./backup-projeto.sh
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

RAIZ="/root"
PROJETO="cert-saas"
TRABALHO="/root/backups"
REMOTE="gdrive:cert-saas-backups/projeto"
RETENCAO_DIAS=60                       # mantém 60 dias de histórico de projeto
DATA=$(date +%Y-%m-%d_%H-%M)
ARQ="$TRABALHO/projeto_${DATA}.tar.gz"
LOG="$RAIZ/$PROJETO/backup.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

mkdir -p "$TRABALHO"
cd "$RAIZ"

log "═══ Backup do PROJETO $DATA ═══"

# ── Compacta o projeto (excluindo o que é regenerável/pesado) ──
log "Compactando o projeto…"
tar czf "$ARQ" \
  --exclude="$PROJETO/**/bin" \
  --exclude="$PROJETO/**/obj" \
  --exclude="$PROJETO/**/node_modules" \
  --exclude="$PROJETO/.git" \
  "$PROJETO"

TAM=$(du -h "$ARQ" | cut -f1)
log "Projeto compactado: $ARQ ($TAM)"

# ── Envia ao Drive ──
log "Enviando ao Drive ($REMOTE)…"
rclone copy "$TRABALHO/" "$REMOTE/" --include "projeto_*.tar.gz" -v 2>&1 | tee -a "$LOG"
log "Enviado ao Drive"

# ── Rotação: remove backups de projeto antigos (local e Drive) ──
log "Limpando backups de projeto locais com mais de $RETENCAO_DIAS dias…"
find "$TRABALHO" -name 'projeto_*.tar.gz' -mtime +$RETENCAO_DIAS -delete 2>/dev/null || true

log "Limpando backups de projeto no Drive com mais de $RETENCAO_DIAS dias…"
rclone delete --min-age ${RETENCAO_DIAS}d "$REMOTE/" 2>/dev/null || true

log "═══ Backup do projeto concluído ═══"
echo ""
echo "✓ Backup do projeto salvo no Drive: $REMOTE/projeto_${DATA}.tar.gz ($TAM)"
