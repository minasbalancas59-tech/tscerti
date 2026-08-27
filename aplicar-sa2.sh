#!/bin/bash
# Super-admin: editar usuários + limpeza por tipo (RBC/padrão)
set -e
BASE="/root/cert-saas"
STAMP=$(date +%Y%m%d-%H%M%S)
for f in 85_limpeza_por_tipo.sql patch-backend-sa2.py patch-frontend-sa2.py endpoints-sa2.cs funcoes-sa2.js; do
  [ -f "./$f" ] || { echo "❌ Falta: $f"; exit 1; }
done
cp "$BASE/src/Api/Sistema/SuperAdminEndpoints.cs" "/root/SuperAdminEndpoints.cs.bak-sa2-$STAMP"
cp "$BASE/src/Api/wwwroot/app.js" "/root/app.js.bak-sa2-$STAMP"
cp ./85_limpeza_por_tipo.sql "$BASE/db/seed/"
sed -i 's/\r$//' "$BASE/db/seed/85_limpeza_por_tipo.sql"
echo "✓ backups ($STAMP) + SQL copiado"

python3 ./patch-backend-sa2.py
python3 ./patch-frontend-sa2.py

if command -v node >/dev/null 2>&1; then
  node --check "$BASE/src/Api/wwwroot/app.js" && echo "✓ app.js validado" || {
    echo "❌ erro JS! restaurando"; cp /root/app.js.bak-sa2-$STAMP "$BASE/src/Api/wwwroot/app.js"; exit 1; }
fi
echo ""
echo "✅ Aplicado! Agora:"
echo "   docker compose exec -T db psql -U certsaas -d certsaas < db/seed/85_limpeza_por_tipo.sql"
echo "   docker compose up -d --build api"
echo ""
echo "Reverter: /root/*.bak-sa2-$STAMP"
