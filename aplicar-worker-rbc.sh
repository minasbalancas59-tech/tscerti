#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# FASE 4 (parte 2) — o Worker busca os dados RBC e usa o modelo RBC
# (o modelo no GeradorPdf.cs já foi aplicado; faltava esta parte)
# ═══════════════════════════════════════════════════════════════
set -e
BASE="/root/cert-saas"
STAMP=$(date +%Y%m%d-%H%M%S)
for f in patch-worker-rbc.py sql-rbc.txt selo-rbc.txt; do
  [ -f "./$f" ] || { echo "❌ Falta: $f"; exit 1; }
done
cp "$BASE/src/Worker/Program.cs" "/root/Program.cs.bak-rbc2-$STAMP"
echo "✓ backup ($STAMP)"

# confirma que o modelo RBC já está no gerador
if ! grep -q "GerarModeloRbc" "$BASE/src/Worker/GeradorPdf.cs"; then
  echo "⚠️  O modelo RBC NÃO está no GeradorPdf.cs — aplique antes o patch-gerador.py"
  exit 1
fi
echo "✓ modelo RBC presente no gerador"

python3 ./patch-worker-rbc.py
echo ""
echo "✅ Aplicado! ⚠️  REBUILD DO WORKER:"
echo "   docker compose up -d --build worker"
echo ""
echo "Reverter: cp /root/Program.cs.bak-rbc2-$STAMP $BASE/src/Worker/Program.cs"
