#!/bin/bash
# Assinatura obrigatória + aviso de calibração recente (30 dias)
set -e
BASE="/root/cert-saas"
STAMP=$(date +%Y%m%d-%H%M%S)
for f in patch-assinatura.py patch-recente.py patch-aviso.py endpoint-recente.cs; do
  [ -f "./$f" ] || { echo "❌ Falta: $f"; exit 1; }
done
cp "$BASE/src/Api/Certificados/AprovacaoEndpoints.cs" "/root/AprovacaoEndpoints.cs.bak-reg-$STAMP"
cp "$BASE/src/Api/Balancas/BalancaEndpoints.cs" "/root/BalancaEndpoints.cs.bak-reg-$STAMP"
cp "$BASE/src/Api/wwwroot/app.js" "/root/app.js.bak-reg-$STAMP"
echo "✓ backups ($STAMP)"
python3 ./patch-assinatura.py
python3 ./patch-recente.py
python3 ./patch-aviso.py
if command -v node >/dev/null 2>&1; then
  node --check "$BASE/src/Api/wwwroot/app.js" && echo "✓ app.js validado" || {
    echo "❌ erro JS! restaurando"; cp /root/app.js.bak-reg-$STAMP "$BASE/src/Api/wwwroot/app.js"; exit 1; }
fi
echo ""
echo "✅ Aplicado! ⚠️  REBUILD: docker compose up -d --build api"
echo "Reverter: /root/*.bak-reg-$STAMP"
