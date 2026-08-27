#!/bin/bash
# Badge RBC nas listagens + rascunho RBC reabre na tela RBC
# com a coleta salva carregada (abre direto no resumo).
# INCLUI o rbc.js completo (wizard + médias + reabertura).
set -e
BASE="/root/cert-saas"
STAMP=$(date +%Y%m%d-%H%M%S)
for f in patch-backend-rbc.py patch-appjs-rbc.py rbc.js.b64; do
  [ -f "./$f" ] || { echo "❌ Falta: $f"; exit 1; }
done
cp "$BASE/src/Api/Certificados/CertificadoEndpoints.cs" "/root/CertificadoEndpoints.cs.bak-tipo-$STAMP"
cp "$BASE/src/Api/wwwroot/app.js" "/root/app.js.bak-tipo-$STAMP"
cp "$BASE/src/Api/wwwroot/rbc.js" "/root/rbc.js.bak-tipo-$STAMP" 2>/dev/null || true
echo "✓ backups ($STAMP)"

python3 ./patch-backend-rbc.py
python3 ./patch-appjs-rbc.py
base64 -d ./rbc.js.b64 > "$BASE/src/Api/wwwroot/rbc.js"
echo "OK - rbc.js atualizado (wizard + reabertura com coleta salva)"

if command -v node >/dev/null 2>&1; then
  node --check "$BASE/src/Api/wwwroot/app.js" && node --check "$BASE/src/Api/wwwroot/rbc.js" \
    && echo "✓ JS validado" || { echo "❌ erro JS! restaurando"; \
      cp /root/app.js.bak-tipo-$STAMP "$BASE/src/Api/wwwroot/app.js"; \
      cp /root/rbc.js.bak-tipo-$STAMP "$BASE/src/Api/wwwroot/rbc.js" 2>/dev/null; exit 1; }
fi
echo ""
echo "✅ Aplicado! ⚠️  REBUILD: docker compose up -d --build api"
echo "Reverter: /root/*.bak-tipo-$STAMP"
