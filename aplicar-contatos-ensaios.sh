#!/bin/bash
# Contatos do cliente + ensaios aplicáveis por balança
set -e
BASE="/root/cert-saas"; WWW="$BASE/src/Api/wwwroot"
STAMP=$(date +%Y%m%d-%H%M%S)
for f in 90_contatos_e_ensaios.sql patch-backend-contatos.py patch-backend-ensaios.py patch-frontend-contatos.py endpoints-contatos.cs funcoes-contatos.js; do
  [ -f "./$f" ] || { echo "❌ Falta: $f"; exit 1; }
done
cp "$BASE/src/Api/Clientes/ClienteEndpoints.cs" "/root/ClienteEndpoints.cs.bak-ct-$STAMP"
cp "$BASE/src/Api/Balancas/BalancaEndpoints.cs" "/root/BalancaEndpoints.cs.bak-ct-$STAMP"
cp "$BASE/src/Api/Certificados/CertificadoEndpoints.cs" "/root/CertificadoEndpoints.cs.bak-ct-$STAMP"
cp "$WWW/app.js" "/root/app.js.bak-ct-$STAMP"
cp ./90_contatos_e_ensaios.sql "$BASE/db/seed/"
sed -i 's/\r$//' "$BASE/db/seed/90_contatos_e_ensaios.sql"
echo "✓ backups ($STAMP) + SQL copiado"

python3 ./patch-backend-contatos.py
python3 ./patch-backend-ensaios.py
python3 ./patch-frontend-contatos.py

if command -v node >/dev/null 2>&1; then
  node --check "$WWW/app.js" && echo "✓ app.js validado" || {
    echo "❌ erro JS! restaurando"; cp /root/app.js.bak-ct-$STAMP "$WWW/app.js"; exit 1; }
fi
echo ""
echo "✅ Aplicado! Agora:"
echo "   docker compose exec -T db psql -U certsaas -d certsaas < db/seed/90_contatos_e_ensaios.sql"
echo "   docker compose up -d --build api"
echo ""
echo "Reverter: /root/*.bak-ct-$STAMP"
