#!/bin/bash
# 2 bugs: botão Voltar da edição manual + 404 na nova calibração
set -e
BASE="/root/cert-saas"
STAMP=$(date +%Y%m%d-%H%M%S)
[ -f ./patch-404.py ] || { echo "❌ Falta patch-404.py"; exit 1; }
cp "$BASE/src/Api/wwwroot/app.js" "/root/app.js.bak-2bugs-$STAMP"
echo "✓ backup ($STAMP)"
python3 ./patch-404.py
if command -v node >/dev/null 2>&1; then
  node --check "$BASE/src/Api/wwwroot/app.js" && echo "✓ app.js validado" || {
    echo "❌ erro JS! restaurando"; cp /root/app.js.bak-2bugs-$STAMP "$BASE/src/Api/wwwroot/app.js"; exit 1; }
fi
echo ""
echo "✅ Aplicado! ⚠️  REBUILD: docker compose up -d --build api"
echo "Reverter: cp /root/app.js.bak-2bugs-$STAMP $BASE/src/Api/wwwroot/app.js"
