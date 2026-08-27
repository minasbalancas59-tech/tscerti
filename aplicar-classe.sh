#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Correção do bug de classificação de classe (50kg/10g → III)
# + memória de cálculo da classe no botão "?"
# ═══════════════════════════════════════════════════════════════
set -e
BASE="/root/cert-saas"
STAMP=$(date +%Y%m%d-%H%M%S)
[ -f ./Classificador.cs ] || { echo "❌ Falta Classificador.cs"; exit 1; }
[ -f ./patch-frontend.py ] || { echo "❌ Falta patch-frontend.py"; exit 1; }

cp "$BASE/src/Api/Balancas/Classificador.cs" "/root/Classificador.cs.bak-$STAMP"
cp "$BASE/src/Api/wwwroot/app.js" "/root/app.js.bak-classe-$STAMP"
echo "✓ backups ($STAMP)"

cp ./Classificador.cs "$BASE/src/Api/Balancas/Classificador.cs"
echo "✓ Classificador.cs corrigido instalado"

python3 ./patch-frontend.py

if command -v node >/dev/null 2>&1; then
  node --check "$BASE/src/Api/wwwroot/app.js" && echo "✓ app.js validado" || {
    echo "❌ erro JS! restaurando"; cp /root/app.js.bak-classe-$STAMP "$BASE/src/Api/wwwroot/app.js"; exit 1; }
fi

echo ""
echo "✅ Correção aplicada! ⚠️  REBUILD:"
echo "   docker compose up -d --build api"
echo ""
echo "TESTAR depois do rebuild (Ctrl+Shift+R):"
echo "  1) Cadastro de balança: 50 kg, divisão 10 g → deve sugerir III"
echo "  2) Clique no '?' ao lado da Classe → memória de cálculo aparece"
echo ""
echo "Reverter: cp /root/Classificador.cs.bak-$STAMP e app.js.bak-classe-$STAMP"
