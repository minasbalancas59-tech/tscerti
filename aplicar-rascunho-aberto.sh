#!/bin/bash
# Aviso de ensaio em andamento ao iniciar nova calibração
set -e
BASE="/root/cert-saas"
STAMP=$(date +%Y%m%d-%H%M%S)
for f in patch-backend-rasc.py patch-frontend-rasc.py endpoint-rascunho.cs; do
  [ -f "./$f" ] || { echo "❌ Falta: $f"; exit 1; }
done
cp "$BASE/src/Api/Balancas/BalancaEndpoints.cs" "/root/BalancaEndpoints.cs.bak-ra-$STAMP"
cp "$BASE/src/Api/wwwroot/app.js" "/root/app.js.bak-ra-$STAMP"
echo "✓ backups ($STAMP)"
python3 ./patch-backend-rasc.py
python3 ./patch-frontend-rasc.py
if command -v node >/dev/null 2>&1; then
  node --check "$BASE/src/Api/wwwroot/app.js" && echo "✓ app.js validado" || {
    echo "❌ erro JS! restaurando"; cp /root/app.js.bak-ra-$STAMP "$BASE/src/Api/wwwroot/app.js"; exit 1; }
fi
echo ""
echo "✅ Aplicado! ⚠️  REBUILD: docker compose up -d --build api"
echo "Reverter: /root/*.bak-ra-$STAMP"
