#!/bin/bash
# Modo GUIADO da coleta RBC (ponto a ponto + resumo final)
# + casas decimais consistentes. Substitui só o rbc.js.
set -e
WWW="/root/cert-saas/src/Api/wwwroot"
STAMP=$(date +%Y%m%d-%H%M%S)
[ -f ./rbc.js.b64 ] || { echo "❌ Falta rbc.js.b64"; exit 1; }
cp "$WWW/rbc.js" "/root/rbc.js.bak-wiz-$STAMP"
base64 -d ./rbc.js.b64 > "$WWW/rbc.js"
echo "✓ rbc.js atualizado (backup: /root/rbc.js.bak-wiz-$STAMP)"
echo ""
echo "⚠️  REBUILD: docker compose up -d --build api"
