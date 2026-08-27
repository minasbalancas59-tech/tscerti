#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# FASE 4 — Modelo RBC do PDF (certificado de calibração acreditado)
# ═══════════════════════════════════════════════════════════════
set -e
BASE="/root/cert-saas"
STAMP=$(date +%Y%m%d-%H%M%S)
for f in patch-gerador.py patch-worker-rbc.py records-rbc.cs modelo-rbc.cs; do
  [ -f "./$f" ] || { echo "❌ Falta: $f"; exit 1; }
done
cp "$BASE/src/Worker/GeradorPdf.cs" "/root/GeradorPdf.cs.bak-rbc-$STAMP"
cp "$BASE/src/Worker/Program.cs" "/root/Program.cs.bak-rbc-$STAMP"
echo "✓ backups ($STAMP)"

python3 ./patch-gerador.py
python3 ./patch-worker-rbc.py

echo ""
echo "✅ Aplicado! ⚠️  REBUILD DO WORKER:"
echo "   docker compose up -d --build worker"
echo ""
echo "Se der erro de compilação, me mande a mensagem."
echo "Reverter: cp /root/GeradorPdf.cs.bak-rbc-$STAMP e Program.cs.bak-rbc-$STAMP"
