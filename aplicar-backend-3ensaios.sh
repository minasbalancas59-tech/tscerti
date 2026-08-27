#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# FASE 3 (backend 3 ensaios) — substitui o RbcEndpoints.cs
# O antigo (leituras-rbc) vira o novo (coleta-rbc) com os 3 ensaios
# + composição de pesos. O registro no Program.cs continua o mesmo
# (RbcEndpoints.Map já está lá).
# ═══════════════════════════════════════════════════════════════
set -e
BASE="/root/cert-saas"
DEST="$BASE/src/Api/Certificados/RbcEndpoints.cs"
STAMP=$(date +%Y%m%d-%H%M%S)
[ -f ./RbcEndpoints.cs ] || { echo "❌ Falta: RbcEndpoints.cs (suba junto)"; exit 1; }
[ -f "$DEST" ] && cp "$DEST" "/root/RbcEndpoints.cs.bak-3ens-$STAMP" && echo "✓ backup do antigo ($STAMP)"
cp ./RbcEndpoints.cs "$DEST"
echo "✓ RbcEndpoints.cs (3 ensaios) instalado"
echo ""
echo "Confirma que o Program.cs ainda registra (deve já estar lá):"
grep -n "RbcEndpoints.Map" "$BASE/src/Api/Program.cs" || echo "⚠️  RbcEndpoints.Map NÃO encontrado — precisa registrar!"
echo ""
echo "✅ Pronto! ⚠️  REBUILD (API):"
echo "   docker compose up -d --build api"
echo ""
echo "   Novos endpoints (substituem leituras-rbc):"
echo "     PUT /api/certificados/{id}/coleta-rbc  (3 ensaios + pesos + cálculo)"
echo "     GET /api/certificados/{id}/coleta-rbc  (lê tudo)"
echo ""
echo "Reverter: cp /root/RbcEndpoints.cs.bak-3ens-$STAMP $DEST"
