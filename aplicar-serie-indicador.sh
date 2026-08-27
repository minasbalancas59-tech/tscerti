#!/bin/bash
# Nº de série do indicador + unicidade do nº de série por cliente
set -e
BASE="/root/cert-saas"; WWW="$BASE/src/Api/wwwroot"
STAMP=$(date +%Y%m%d-%H%M%S)
for f in 89_serie_indicador.sql patch-backend-serie.py patch-frontend-serie.py patch-pdf-serie.py patch-msg-duplicata.py; do
  [ -f "./$f" ] || { echo "❌ Falta: $f"; exit 1; }
done

# checagem: duplicatas impediriam a constraint
echo "Verificando duplicatas de número de série..."
DUP=$(docker compose exec -T db psql -U certsaas -d certsaas -tAc \
  "SELECT count(*) FROM (SELECT cliente_id, lower(trim(num_serie)) FROM balanca WHERE num_serie IS NOT NULL AND trim(num_serie) <> '' GROUP BY 1,2 HAVING count(*)>1) x;" 2>/dev/null | tr -d '[:space:]')
if [ "$DUP" != "0" ]; then
  echo "⚠️  Existem $DUP número(s) de série duplicado(s) no mesmo cliente."
  echo "    A migração criará a coluna mas o índice único FALHARÁ."
  echo "    Resolva as duplicatas antes (veja quais com:"
  echo "      SELECT cliente_id, num_serie, count(*) FROM balanca WHERE num_serie IS NOT NULL AND trim(num_serie)<>'' GROUP BY 1,2 HAVING count(*)>1;)"
  read -p "    Continuar assim mesmo? (s/N) " R
  [ "$R" = "s" ] || exit 1
fi

cp "$BASE/src/Api/Balancas/BalancaEndpoints.cs" "/root/BalancaEndpoints.cs.bak-si-$STAMP"
cp "$BASE/src/Api/Certificados/CertificadoEndpoints.cs" "/root/CertificadoEndpoints.cs.bak-si-$STAMP"
cp "$BASE/src/Worker/GeradorPdf.cs" "/root/GeradorPdf.cs.bak-si-$STAMP"
cp "$BASE/src/Worker/Program.cs" "/root/Program.cs.bak-si-$STAMP"
cp "$WWW/app.js" "/root/app.js.bak-si-$STAMP"
cp ./89_serie_indicador.sql "$BASE/db/seed/"
sed -i 's/\r$//' "$BASE/db/seed/89_serie_indicador.sql"
echo "✓ backups ($STAMP) + SQL copiado"

python3 ./patch-backend-serie.py
python3 ./patch-msg-duplicata.py
python3 ./patch-frontend-serie.py
python3 ./patch-pdf-serie.py

if command -v node >/dev/null 2>&1; then
  node --check "$WWW/app.js" && echo "✓ app.js validado" || {
    echo "❌ erro JS! restaurando"; cp /root/app.js.bak-si-$STAMP "$WWW/app.js"; exit 1; }
fi
echo ""
echo "✅ Aplicado! Agora:"
echo "   docker compose exec -T db psql -U certsaas -d certsaas < db/seed/89_serie_indicador.sql"
echo "   docker compose up -d --build api worker"
echo ""
echo "Reverter: /root/*.bak-si-$STAMP"
