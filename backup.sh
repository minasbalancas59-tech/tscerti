#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Backup do sistema de certificados → Google Drive (via rclone)
#   • Dump do PostgreSQL (todos os dados)
#   • Cópia dos arquivos do MinIO (PDFs, logotipos)
#   • Envia para o Drive e mantém histórico com rotação
#   • BLINDADO contra falha silenciosa: verifica tamanho e
#     integridade do dump antes de dar o backup como concluído
#
# Uso: ./backup.sh
# Agendado via cron (ver instruções). Loga em /root/cert-saas/backup.log
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

# ── Configuração ──
PROJETO="/root/cert-saas"
TRABALHO="/root/backups"                 # pasta local temporária
REMOTE="gdrive:cert-saas-backups"        # destino no Drive (rclone)
DB_USER="certsaas"
DB_NAME="certsaas"
MINIO_BUCKET="certificados"              # ajuste se o bucket tiver outro nome
RETENCAO_DIAS=30                         # apaga backups locais mais antigos que isso
TAMANHO_MINIMO_DB=51200                  # 50 KB: dump menor que isso = suspeito (banco real tem centenas de KB)
DATA=$(date +%Y-%m-%d_%H-%M)
LOG="$PROJETO/backup.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

falha() {
    log "❌ ERRO FATAL: $*"
    log "═══ BACKUP FALHOU — verificar urgente ═══"
    exit 1
}

mkdir -p "$TRABALHO"
cd "$PROJETO"

log "═══ Início do backup $DATA ═══"

# ── 1. Dump do banco de dados ──
ARQ_DB="$TRABALHO/db_${DATA}.sql.gz"
log "Gerando dump do banco…"
if ! docker compose exec -T db pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$ARQ_DB"; then
    rm -f "$ARQ_DB"
    falha "pg_dump retornou erro (arquivo parcial removido)"
fi

# Blindagem 1: tamanho mínimo (pega o clássico arquivo de 0 bytes)
TAM_BYTES=$(stat -c%s "$ARQ_DB")
if [ "$TAM_BYTES" -lt "$TAMANHO_MINIMO_DB" ]; then
    falha "dump com apenas ${TAM_BYTES} bytes (mínimo esperado: ${TAMANHO_MINIMO_DB}) — banco vazio ou dump quebrado"
fi

# Blindagem 2: o gzip está íntegro e o conteúdo parece um dump do Postgres?
gzip -t "$ARQ_DB" || falha "arquivo gzip corrompido"
# (o "|| true" mascara o SIGPIPE do zcat/head quando o grep acha cedo — sob
# pipefail, sem isso o teste falharia mesmo com o dump PERFEITO)
{ zcat "$ARQ_DB" 2>/dev/null || true; } | { head -5 || true; } \
    | grep -q "PostgreSQL database dump" \
    || falha "conteúdo não parece um dump do PostgreSQL"

TAM=$(du -h "$ARQ_DB" | cut -f1)
log "Banco salvo e VERIFICADO: $ARQ_DB ($TAM)"

# ── 2. Arquivos do MinIO (PDFs) ──
ARQ_MINIO="$TRABALHO/minio_${DATA}.tar.gz"
log "Copiando arquivos do MinIO…"
# O MinIO guarda os dados num volume Docker; copiamos o conteúdo do bucket
if docker compose exec -T minio tar czf - -C /data "$MINIO_BUCKET" > "$ARQ_MINIO" 2>/dev/null \
   && [ "$(stat -c%s "$ARQ_MINIO")" -gt 1024 ]; then
    TAM=$(du -h "$ARQ_MINIO" | cut -f1)
    log "MinIO salvo: $ARQ_MINIO ($TAM)"
else
    log "AVISO: não consegui copiar o MinIO pelo container; tentando pelo volume…"
    # fallback: copia direto do volume Docker
    VOL=$(docker volume ls -q | grep -i minio | head -1 || true)
    if [ -n "$VOL" ]; then
        PONTO=$(docker volume inspect "$VOL" --format '{{ .Mountpoint }}')
        tar czf "$ARQ_MINIO" -C "$PONTO" . && log "MinIO salvo pelo volume ($VOL)"
    else
        rm -f "$ARQ_MINIO"
        log "AVISO: MinIO não encontrado — backup seguirá só com o banco"
    fi
fi

# ── 3. Envia para o Google Drive ──
log "Enviando para o Drive ($REMOTE)…"
rclone mkdir "$REMOTE" 2>/dev/null || true
if rclone copy "$ARQ_DB" "$REMOTE/"; then
    # Blindagem 3: confirma que o arquivo chegou no Drive com o mesmo tamanho
    TAM_DRIVE=$(rclone size "$REMOTE/" --include "$(basename "$ARQ_DB")" --json | grep -o '"bytes":[0-9]*' | cut -d: -f2)
    [ "$TAM_DRIVE" = "$TAM_BYTES" ] \
        && log "Banco enviado ao Drive (tamanho conferido: $TAM_DRIVE bytes)" \
        || log "AVISO: tamanho no Drive ($TAM_DRIVE) difere do local ($TAM_BYTES) — conferir"
else
    falha "não consegui enviar o dump do banco ao Drive"
fi
[ -f "$ARQ_MINIO" ] && rclone copy "$ARQ_MINIO" "$REMOTE/" && log "MinIO enviado ao Drive"

# ── 4. Rotação: remove backups antigos (local e no Drive) ──
log "Limpando backups locais com mais de $RETENCAO_DIAS dias…"
find "$TRABALHO" -name '*.gz' -mtime +$RETENCAO_DIAS -delete 2>/dev/null || true

log "Limpando backups no Drive com mais de $RETENCAO_DIAS dias…"
rclone delete --min-age ${RETENCAO_DIAS}d "$REMOTE/" 2>/dev/null || true

log "═══ Backup concluído com sucesso ═══"
