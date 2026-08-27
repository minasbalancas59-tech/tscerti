#!/bin/bash
# "Ensaio executado por" — registra quem mediu e quem lançou
set -e
BASE="/root/cert-saas"; WWW="$BASE/src/Api/wwwroot"
STAMP=$(date +%Y%m%d-%H%M%S)
for f in 91_lancado_por.sql patch-backend-exec.py patch-frontend-exec.py funcoes-exec.js; do
  [ -f "./$f" ] || { echo "❌ Falta: $f"; exit 1; }
done
cp "$BASE/src/Api/Certificados/CertificadoEndpoints.cs" "/root/CertificadoEndpoints.cs.bak-ex-$STAMP"
cp "$WWW/app.js" "/root/app.js.bak-ex-$STAMP"
cp "$WWW/index.html" "/root/index.html.bak-ex-$STAMP"
cp ./91_lancado_por.sql "$BASE/db/seed/"
sed -i 's/\r$//' "$BASE/db/seed/91_lancado_por.sql"
echo "✓ backups ($STAMP) + SQL copiado"
python3 ./patch-backend-exec.py
python3 ./patch-frontend-exec.py
if command -v node >/dev/null 2>&1; then
  node --check "$WWW/app.js" && echo "✓ app.js validado" || {
    echo "❌ erro JS! restaurando"; cp /root/app.js.bak-ex-$STAMP "$WWW/app.js"; exit 1; }
fi
echo ""
echo "✅ Aplicado! Agora:"
echo "   docker compose exec -T db psql -U certsaas -d certsaas < db/seed/91_lancado_por.sql"
echo "   docker compose up -d --build api"
echo ""
echo "Reverter: /root/*.bak-ex-$STAMP"
