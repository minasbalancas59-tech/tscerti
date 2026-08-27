#!/bin/bash
# Envio p/ aprovação no RBC + filtro por tipo + fundo diferenciado
set -e
BASE="/root/cert-saas"; WWW="$BASE/src/Api/wwwroot"
STAMP=$(date +%Y%m%d-%H%M%S)
for f in patch-rbcendpoints.py patch-appjs-envio.py enviar-rbc.cs rbc.js.b64; do
  [ -f "./$f" ] || { echo "❌ Falta: $f"; exit 1; }
done
cp "$BASE/src/Api/Certificados/RbcEndpoints.cs" "/root/RbcEndpoints.cs.bak-env-$STAMP"
cp "$WWW/app.js" "/root/app.js.bak-env-$STAMP"
cp "$WWW/rbc.js" "/root/rbc.js.bak-env-$STAMP" 2>/dev/null || true
cp "$WWW/styles.css" "/root/styles.css.bak-env-$STAMP"
echo "✓ backups ($STAMP)"

python3 ./patch-rbcendpoints.py
python3 ./patch-appjs-envio.py
base64 -d ./rbc.js.b64 > "$WWW/rbc.js"
echo "OK - rbc.js atualizado (envio para aprovacao)"

# CSS do fundo diferenciado (append idempotente)
if ! grep -q "item-rbc" "$WWW/styles.css"; then
cat >> "$WWW/styles.css" << 'CSSEOF'

/* Certificados RBC: fundo diferenciado nas listagens */
.item-cert.item-rbc { background:#eef7f2; border-left:4px solid #0a5c40; }
.item-cert.item-rbc:hover { background:#e2f1e9; }
CSSEOF
echo "OK - CSS do fundo RBC"
else
echo "  - CSS ja existe, pulando"
fi

if command -v node >/dev/null 2>&1; then
  node --check "$WWW/app.js" && node --check "$WWW/rbc.js" && echo "✓ JS validado" || {
    echo "❌ erro JS! restaurando"; cp /root/app.js.bak-env-$STAMP "$WWW/app.js";
    cp /root/rbc.js.bak-env-$STAMP "$WWW/rbc.js" 2>/dev/null; exit 1; }
fi
echo ""
echo "✅ Aplicado! ⚠️  REBUILD: docker compose up -d --build api"
echo "Reverter: /root/*.bak-env-$STAMP"
