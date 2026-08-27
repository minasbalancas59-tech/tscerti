#!/bin/bash
# Alinhamento das tabelas na tela de aprovação (cabeçalhos + células)
set -e
BASE="/root/cert-saas"
STAMP=$(date +%Y%m%d-%H%M%S)
[ -f ./patch-alinha.py ] || { echo "❌ Falta patch-alinha.py"; exit 1; }
cp "$BASE/src/Api/wwwroot/styles.css" "/root/styles.css.bak-alin-$STAMP"
cp "$BASE/src/Api/wwwroot/app.js" "/root/app.js.bak-alin-$STAMP"
echo "✓ backups ($STAMP)"
python3 ./patch-alinha.py
if command -v node >/dev/null 2>&1; then
  node --check "$BASE/src/Api/wwwroot/app.js" && echo "✓ app.js validado" || {
    echo "❌ erro JS! restaurando"; cp /root/app.js.bak-alin-$STAMP "$BASE/src/Api/wwwroot/app.js"; exit 1; }
fi
echo ""
echo "✅ Aplicado! ⚠️  REBUILD: docker compose up -d --build api"
echo "Reverter: /root/*.bak-alin-$STAMP"
