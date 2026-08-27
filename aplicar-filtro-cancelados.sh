#!/bin/bash
# Filtro "Cancelados" na tela inicial
set -e
BASE="/root/cert-saas"
STAMP=$(date +%Y%m%d-%H%M%S)
[ -f ./patch-filtro-cancelados.py ] || { echo "❌ Falta o patch"; exit 1; }
cp "$BASE/src/Api/wwwroot/app.js" "/root/app.js.bak-fcanc-$STAMP"
echo "✓ backup ($STAMP)"
python3 ./patch-filtro-cancelados.py
if command -v node >/dev/null 2>&1; then
  node --check "$BASE/src/Api/wwwroot/app.js" && echo "✓ app.js validado" || {
    echo "❌ erro JS! restaurando"; cp /root/app.js.bak-fcanc-$STAMP "$BASE/src/Api/wwwroot/app.js"; exit 1; }
fi
echo ""
echo "✅ Aplicado! ⚠️  REBUILD: docker compose up -d --build api"
echo "Reverter: cp /root/app.js.bak-fcanc-$STAMP $BASE/src/Api/wwwroot/app.js"
