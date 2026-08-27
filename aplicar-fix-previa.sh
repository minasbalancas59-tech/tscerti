#!/bin/bash
# Corrige o botão "Aprovar e emitir" dentro da prévia do PDF
set -e
BASE="/root/cert-saas"
STAMP=$(date +%Y%m%d-%H%M%S)
[ -f ./patch-fix-previa.py ] || { echo "❌ Falta o patch"; exit 1; }
cp "$BASE/src/Api/wwwroot/app.js" "/root/app.js.bak-fprev-$STAMP"
echo "✓ backup ($STAMP)"
python3 ./patch-fix-previa.py
if command -v node >/dev/null 2>&1; then
  node --check "$BASE/src/Api/wwwroot/app.js" && echo "✓ app.js validado" || {
    echo "❌ erro JS! restaurando"; cp /root/app.js.bak-fprev-$STAMP "$BASE/src/Api/wwwroot/app.js"; exit 1; }
fi
echo ""
echo "✅ Aplicado! ⚠️  REBUILD: docker compose up -d --build api"
echo "Reverter: cp /root/app.js.bak-fprev-$STAMP $BASE/src/Api/wwwroot/app.js"
