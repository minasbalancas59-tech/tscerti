#!/bin/bash
# Local em branco (força escolha) + alinhamento das tabelas + prévia melhor
set -e
BASE="/root/cert-saas"
STAMP=$(date +%Y%m%d-%H%M%S)
[ -f ./patch-tres.py ] || { echo "❌ Falta patch-tres.py"; exit 1; }
cp "$BASE/src/Api/wwwroot/index.html" "/root/index.html.bak-3fix-$STAMP"
cp "$BASE/src/Api/wwwroot/app.js" "/root/app.js.bak-3fix-$STAMP"
cp "$BASE/src/Api/Certificados/CertificadoEndpoints.cs" "/root/CertificadoEndpoints.cs.bak-3fix-$STAMP"
echo "✓ backups ($STAMP)"
python3 ./patch-tres.py
if command -v node >/dev/null 2>&1; then
  node --check "$BASE/src/Api/wwwroot/app.js" && echo "✓ app.js validado" || {
    echo "❌ erro JS! restaurando"; cp /root/app.js.bak-3fix-$STAMP "$BASE/src/Api/wwwroot/app.js"; exit 1; }
fi
echo ""
echo "✅ Aplicado! ⚠️  REBUILD: docker compose up -d --build api"
echo "Reverter: /root/*.bak-3fix-$STAMP"
