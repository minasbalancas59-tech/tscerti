#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# atualizar.sh — rotina padrão para atualizar o TSCert com segurança.
#
# Faz, nesta ordem:
#   1. Backup do projeto no Google Drive (antes de qualquer mudança)
#   2. Limpeza das imagens/caches antigos do Docker (cada build deixa
#      a imagem anterior órfã e o disco enche com o tempo)
#   3. Limpeza dos patches já aplicados (os .patch enviados por
#      FileZilla não servem para mais nada depois do git commit)
#
# Uso:
#   ./atualizar.sh            → backup + limpeza
#   ./atualizar.sh --build    → backup + recompila api e worker + limpeza
#
# João, 28/08/2026.
# ═══════════════════════════════════════════════════════════════
set -u
cd /root/cert-saas || exit 1

BUILD=0
[ "${1:-}" = "--build" ] && BUILD=1

echo "══════════════════════════════════════════════"
echo " TSCert — rotina de atualização"
echo " $(date '+%d/%m/%Y %H:%M')"
echo "══════════════════════════════════════════════"

# Espaço em disco ANTES (para comparar no fim)
ANTES=$(df -h / | awk 'NR==2 {print $4}')
echo "→ Espaço livre no disco: $ANTES"

# ── 1. BACKUP NO DRIVE ────────────────────────────────────────
echo ""
echo "── 1/3 · Backup do projeto no Drive ──"
if ./backup-projeto.sh; then
    echo "  ✓ Backup concluído"
else
    echo "  ✗ FALHA NO BACKUP — abortando por segurança."
    echo "    Nada foi limpo. Verifique o rclone e tente de novo."
    exit 1
fi

# ── 2. BUILD (opcional) ───────────────────────────────────────
if [ "$BUILD" = "1" ]; then
    echo ""
    echo "── Recompilando api e worker ──"
    docker compose up -d --build api worker || {
        echo "  ✗ Falha ao recompilar. Limpeza não será feita."
        exit 1
    }
    echo "  ✓ Containers atualizados"
fi

# ── 3. LIMPEZA DO DOCKER ──────────────────────────────────────
# Só remove imagens SEM container usando (dangling) e cache de build.
# Os containers em execução e suas imagens não são tocados.
echo ""
echo "── 2/3 · Limpeza do Docker ──"
docker image prune -f      | tail -1
docker builder prune -f    | tail -1
echo "  ✓ Imagens órfãs e cache de build removidos"

# ── 4. LIMPEZA DOS PATCHES APLICADOS ──────────────────────────
# Um .patch já commitado não tem mais utilidade: o histórico está no
# Git. Só remove os que estão limpos no git (não versionados), nunca
# arquivos com alterações pendentes.
echo ""
echo "── 3/3 · Limpeza dos patches enviados ──"
QTD=0
for f in *.patch; do
    [ -e "$f" ] || continue
    # Segurança: se o patch estiver versionado no git, não mexe
    if git ls-files --error-unmatch "$f" >/dev/null 2>&1; then
        echo "  · $f está versionado no git — mantido"
        continue
    fi
    rm -f "$f" && QTD=$((QTD + 1))
done
if [ "$QTD" -gt 0 ]; then
    echo "  ✓ $QTD patch(es) removido(s)"
else
    echo "  · Nenhum patch para remover"
fi

# Logs de backup muito grandes (o backup.log cresce sem parar)
if [ -f backup.log ] && [ "$(stat -c%s backup.log)" -gt 5000000 ]; then
    tail -2000 backup.log > backup.log.tmp && mv backup.log.tmp backup.log
    echo "  ✓ backup.log truncado (mantidas as 2000 últimas linhas)"
fi

# ── Resumo ────────────────────────────────────────────────────
DEPOIS=$(df -h / | awk 'NR==2 {print $4}')
echo ""
echo "══════════════════════════════════════════════"
echo " Concluído."
echo "   Disco livre antes:  $ANTES"
echo "   Disco livre agora:  $DEPOIS"
echo "══════════════════════════════════════════════"
