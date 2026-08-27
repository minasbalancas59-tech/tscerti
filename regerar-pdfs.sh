#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Reenfileira a geração de PDF dos certificados EMITIDOS que estão
# sem arquivo — ou emitidos durante o período em que a geração
# esteve quebrada.
#
# Uso:  ./regerar-pdfs.sh            (só os SEM pdf_url)
#       ./regerar-pdfs.sh 3          (emitidos nos últimos 3 dias)
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
cd /root/cert-saas
DIAS="${1:-}"

if [ -z "$DIAS" ]; then
    FILTRO="ct.pdf_url IS NULL"
    DESC="sem PDF"
else
    FILTRO="ct.data_emissao >= now() - interval '$DIAS days'"
    DESC="emitidos nos últimos $DIAS dias"
fi

echo "═══ Certificados $DESC ═══"
IDS=$(docker compose exec -T db psql -U certsaas -d certsaas -t -A -c \
  "SELECT ct.id FROM certificado ct
    WHERE ct.status IN ('emitido','substituido') AND $FILTRO
    ORDER BY ct.data_emissao")

if [ -z "$IDS" ]; then echo "Nenhum certificado nessa condição. Nada a fazer."; exit 0; fi

QTD=$(echo "$IDS" | wc -l)
docker compose exec -T db psql -U certsaas -d certsaas -c \
  "SELECT ct.numero, ct.data_emissao::date AS emitido,
          (ct.pdf_url IS NULL) AS sem_pdf
     FROM certificado ct
    WHERE ct.status IN ('emitido','substituido') AND $FILTRO
    ORDER BY ct.data_emissao"

read -p "Reenfileirar a geração de $QTD PDF(s)? [s/N] " R
[ "$R" = "s" ] || [ "$R" = "S" ] || { echo "Cancelado."; exit 0; }

N=0
for ID in $IDS; do
    docker compose exec -T redis redis-cli LPUSH fila:tarefas \
      "{\"tipo\":\"gerar_pdf\",\"certificado_id\":\"$ID\"}" >/dev/null
    N=$((N+1))
done
echo "✓ $N tarefa(s) na fila. O worker processa uma a cada poucos segundos."
echo ""
echo "Acompanhe com:"
echo "  docker compose exec -T redis redis-cli LLEN fila:tarefas"
echo "  docker compose logs worker -f | grep -i pdf"
