#!/bin/bash
# Prévia do PDF antes de aprovar (marca d'água AGUARDANDO APROVAÇÃO)
set -e
BASE="/root/cert-saas"
STAMP=$(date +%Y%m%d-%H%M%S)
for f in patch-worker.py patch-api-previa.py patch-appjs-previa.py endpoints-previa.cs; do
  [ -f "./$f" ] || { echo "❌ Falta: $f"; exit 1; }
done
cp "$BASE/src/Worker/Program.cs" "/root/Program.cs.bak-prev-$STAMP"
cp "$BASE/src/Api/Certificados/AprovacaoEndpoints.cs" "/root/AprovacaoEndpoints.cs.bak-prev-$STAMP"
cp "$BASE/src/Api/wwwroot/app.js" "/root/app.js.bak-prev-$STAMP"
echo "✓ backups ($STAMP)"

python3 ./patch-worker.py
python3 ./patch-api-previa.py
python3 ./patch-appjs-previa.py

if command -v node >/dev/null 2>&1; then
  node --check "$BASE/src/Api/wwwroot/app.js" && echo "✓ app.js validado" || {
    echo "❌ erro JS! restaurando"; cp /root/app.js.bak-prev-$STAMP "$BASE/src/Api/wwwroot/app.js"; exit 1; }
fi
echo ""
echo "✅ Aplicado! ⚠️  REBUILD DOS DOIS (API + Worker):"
echo "   docker compose up -d --build api worker"
echo ""
echo "Reverter: /root/*.bak-prev-$STAMP"
