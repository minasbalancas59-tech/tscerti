#!/bin/bash
# Botão "Atualizar" na tela inicial
set -e
BASE="/root/cert-saas"; WWW="$BASE/src/Api/wwwroot"
STAMP=$(date +%Y%m%d-%H%M%S)
[ -f ./patch-btn-atualizar.py ] || { echo "❌ Falta o patch"; exit 1; }
cp "$WWW/app.js" "/root/app.js.bak-btna-$STAMP"
cp "$WWW/index.html" "/root/index.html.bak-btna-$STAMP"
echo "✓ backups ($STAMP)"
python3 ./patch-btn-atualizar.py
if command -v node >/dev/null 2>&1; then
  node --check "$WWW/app.js" && echo "✓ app.js validado" || {
    echo "❌ erro JS! restaurando"; cp /root/app.js.bak-btna-$STAMP "$WWW/app.js"; exit 1; }
fi
echo ""
echo "✅ Aplicado! ⚠️  REBUILD: docker compose up -d --build api"
echo "Reverter: /root/*.bak-btna-$STAMP"
