#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Restauração do backup do sistema de certificados
#   Uso: ./restaurar.sh <arquivo_db.sql.gz> [arquivo_minio.tar.gz]
#
#   ATENÇÃO: a restauração do banco SOBRESCREVE os dados atuais.
#   Confirme que é isso que você quer antes de rodar.
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

PROJETO="/root/cert-saas"
DB_USER="certsaas"
DB_NAME="certsaas"
MINIO_BUCKET="certificados"

cd "$PROJETO"

ARQ_DB="${1:-}"
ARQ_MINIO="${2:-}"

if [ -z "$ARQ_DB" ]; then
    echo "Uso: ./restaurar.sh <arquivo_db.sql.gz> [arquivo_minio.tar.gz]"
    echo ""
    echo "Backups disponíveis localmente:"
    ls -lh /root/backups/*.gz 2>/dev/null || echo "  (nenhum backup local — baixe do Drive com: rclone copy gdrive:cert-saas-backups/ /root/backups/)"
    exit 1
fi

if [ ! -f "$ARQ_DB" ]; then
    echo "ERRO: arquivo não encontrado: $ARQ_DB"
    exit 1
fi

echo "╔════════════════════════════════════════════════════════╗"
echo "║  ATENÇÃO: isto vai SOBRESCREVER o banco de dados atual  ║"
echo "║  Todos os dados atuais serão substituídos pelo backup.  ║"
echo "╚════════════════════════════════════════════════════════╝"
echo "Banco a restaurar: $ARQ_DB"
[ -n "$ARQ_MINIO" ] && echo "MinIO a restaurar: $ARQ_MINIO"
echo ""
read -p "Digite 'CONFIRMO' para prosseguir: " resp
[ "$resp" = "CONFIRMO" ] || { echo "Cancelado."; exit 1; }

# ── Restaura o banco ──
echo "Restaurando o banco…"
gunzip -c "$ARQ_DB" | docker compose exec -T db psql -U "$DB_USER" "$DB_NAME"
echo "Banco restaurado."

# ── Restaura o MinIO (se fornecido) ──
if [ -n "$ARQ_MINIO" ] && [ -f "$ARQ_MINIO" ]; then
    echo "Restaurando arquivos do MinIO…"
    docker compose exec -T minio sh -c "cd /data && tar xzf -" < "$ARQ_MINIO"
    echo "MinIO restaurado."
fi

echo "═══ Restauração concluída ═══"
echo "Recomendado reiniciar os serviços: docker compose restart api worker"
