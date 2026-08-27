#!/bin/bash
# Cancelamento de certificado (registro permanece + validação pública avisa)
set -e
BASE="/root/cert-saas"; WWW="$BASE/src/Api/wwwroot"
STAMP=$(date +%Y%m%d-%H%M%S)
for f in 87_cancelar_certificado.sql patch-backend-cancelar.py patch-frontend-cancelar.py endpoint-cancelar.cs funcoes-cancelar.js css-cancelado.css; do
  [ -f "./$f" ] || { echo "❌ Falta: $f"; exit 1; }
done
cp "$BASE/src/Api/Certificados/CertificadoEndpoints.cs" "/root/CertificadoEndpoints.cs.bak-canc-$STAMP"
cp "$WWW/app.js" "/root/app.js.bak-canc-$STAMP"
cp "$WWW/styles.css" "/root/styles.css.bak-canc-$STAMP"
cp ./87_cancelar_certificado.sql "$BASE/db/seed/"
sed -i 's/\r$//' "$BASE/db/seed/87_cancelar_certificado.sql"
echo "✓ backups ($STAMP) + SQL copiado"

python3 ./patch-backend-cancelar.py
python3 ./patch-frontend-cancelar.py

if ! grep -q "st-cancelado" "$WWW/styles.css"; then
  cat ./css-cancelado.css >> "$WWW/styles.css"
  echo "OK - CSS do badge cancelado"
fi

if command -v node >/dev/null 2>&1; then
  node --check "$WWW/app.js" && echo "✓ app.js validado" || {
    echo "❌ erro JS! restaurando"; cp /root/app.js.bak-canc-$STAMP "$WWW/app.js"; exit 1; }
fi
echo ""
echo "✅ Aplicado! Agora:"
echo "   docker compose exec -T db psql -U certsaas -d certsaas < db/seed/87_cancelar_certificado.sql"
echo "   docker compose up -d --build api"
echo ""
echo "Reverter: /root/*.bak-canc-$STAMP"
