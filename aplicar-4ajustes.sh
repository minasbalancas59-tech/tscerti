#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# 4 ajustes do RBC:
#  1. Selo à direita do nº de acreditação (PDF)
#  2. Rastreabilidade: cada padrão uma vez (PDF)
#  3. Alerta de divergência entre pesos e carga (tela)
#  4. Bloqueio do envio com divergência > 1% (backend)
# ═══════════════════════════════════════════════════════════════
set -e
BASE="/root/cert-saas"; WWW="$BASE/src/Api/wwwroot"
STAMP=$(date +%Y%m%d-%H%M%S)
for f in patch-pdf-ajustes.py patch-bloqueio.py patch-edicao-rbc.py rbc.js.b64; do
  [ -f "./$f" ] || { echo "❌ Falta: $f"; exit 1; }
done
cp "$BASE/src/Worker/GeradorPdf.cs" "/root/GeradorPdf.cs.bak-4aj-$STAMP"
cp "$BASE/src/Api/Certificados/RbcEndpoints.cs" "/root/RbcEndpoints.cs.bak-4aj-$STAMP"
cp "$WWW/rbc.js" "/root/rbc.js.bak-4aj-$STAMP"
cp "$WWW/app.js" "/root/app.js.bak-4aj-$STAMP"
echo "✓ backups ($STAMP)"

python3 ./patch-pdf-ajustes.py
python3 ./patch-bloqueio.py
python3 ./patch-edicao-rbc.py
base64 -d ./rbc.js.b64 > "$WWW/rbc.js"
echo "OK - rbc.js atualizado (alertas de divergência)"

if command -v node >/dev/null 2>&1; then
  node --check "$WWW/rbc.js" && node --check "$WWW/app.js" && echo "✓ JS validado" || {
    echo "❌ erro JS! restaurando"; cp /root/rbc.js.bak-4aj-$STAMP "$WWW/rbc.js";
    cp /root/app.js.bak-4aj-$STAMP "$WWW/app.js"; exit 1; }
fi
echo ""
echo "✅ Aplicado! ⚠️  REBUILD DOS DOIS:"
echo "   docker compose up -d --build api worker"
echo ""
echo "Reverter: /root/*.bak-4aj-$STAMP"
