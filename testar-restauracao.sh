#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# TESTE DE RESTAURAÇÃO — prova que o backup do banco volta mesmo
#
# Sobe um PostgreSQL TEMPORÁRIO (container separado, porta interna),
# restaura o dump mais recente nele e COMPARA as contagens com a
# produção. Não toca no banco em uso em nenhum momento.
#
# Uso:  ./testar-restauracao.sh              (usa o dump mais recente)
#       ./testar-restauracao.sh /root/backups/db_2026-07-28_03-00.sql.gz
# ═══════════════════════════════════════════════════════════════
set -uo pipefail

PROJETO="/root/cert-saas"
TRABALHO="/root/backups"
CONT="cert-restauracao-teste"
DB_TESTE="certsaas_restore"
cd "$PROJETO"

azul()  { echo -e "\033[1;34m$*\033[0m"; }
verde() { echo -e "\033[1;32m$*\033[0m"; }
verm()  { echo -e "\033[1;31m$*\033[0m"; }

ARQ="${1:-$(ls -1t $TRABALHO/db_*.sql.gz 2>/dev/null | head -1)}"
[ -z "$ARQ" ] && { verm "Nenhum dump encontrado em $TRABALHO"; exit 1; }
[ -f "$ARQ" ] || { verm "Arquivo não existe: $ARQ"; exit 1; }

azul "═══ TESTE DE RESTAURAÇÃO ═══"
echo "Dump: $ARQ  ($(du -h "$ARQ" | cut -f1), de $(date -r "$ARQ" '+%d/%m/%Y %H:%M'))"

# ── 1. Imagem igual à da produção (mesma versão do Postgres) ──
IMG=$(docker inspect "$(docker compose ps -q db)" --format '{{.Config.Image}}' 2>/dev/null)
[ -z "$IMG" ] && { verm "Não achei o container do banco em produção"; exit 1; }
echo "Imagem: $IMG"

# ── 2. Sobe o banco temporário ──
docker rm -f "$CONT" >/dev/null 2>&1 || true
azul "\n[1/4] Subindo PostgreSQL temporário…"
docker run -d --name "$CONT" \
    -e POSTGRES_USER=certsaas -e POSTGRES_PASSWORD=teste_restauracao \
    -e POSTGRES_DB="$DB_TESTE" "$IMG" >/dev/null || { verm "falha ao subir"; exit 1; }

echo -n "aguardando ficar pronto"
for i in $(seq 1 60); do
    docker exec "$CONT" pg_isready -U certsaas >/dev/null 2>&1 && break
    echo -n "."; sleep 1
done
echo ""
docker exec "$CONT" pg_isready -U certsaas >/dev/null 2>&1 \
    || { verm "banco temporário não subiu"; docker rm -f "$CONT" >/dev/null; exit 1; }

# papéis que o dump referencia (GRANTs) — sem eles, ruído de erro no log
docker exec -i "$CONT" psql -U certsaas -d "$DB_TESTE" -q \
    -c "DO \$\$ BEGIN CREATE ROLE api_app; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$;" \
    >/dev/null 2>&1 || true

# ── 3. Restaura ──
azul "[2/4] Restaurando o dump…"
LOG_REST="/tmp/restauracao_teste.log"
zcat "$ARQ" | docker exec -i "$CONT" psql -U certsaas -d "$DB_TESTE" \
    -v ON_ERROR_STOP=0 --quiet > "$LOG_REST" 2>&1
ERROS=$(grep -c "^ERRO\|^ERROR" "$LOG_REST" || true)
echo "erros relatados pelo psql: $ERROS  (log completo em $LOG_REST)"

# ── 4. Compara produção x restaurado ──
azul "[3/4] Conferindo os dados restaurados…"
TABELAS="empresa usuario cliente balanca certificado peso_padrao contrato cobranca certificado_peso"
printf "\n%-20s %12s %12s   %s\n" "TABELA" "PRODUÇÃO" "RESTAURADO" "RESULTADO"
printf "%s\n" "──────────────────────────────────────────────────────────────"
# REGRA: o dump e de um momento PASSADO. A producao so cresce, entao
# "restaurado MENOR que producao" e NORMAL (movimento apos o backup).
# Problema mesmo e tabela ZERADA ou restaurado MAIOR que a producao.
PROBLEMA=0; ATRASO=0; TOTAL_PROD=0; TOTAL_REST=0
for t in $TABELAS; do
    P=$(docker compose exec -T db psql -U certsaas -d certsaas -t -A \
        -c "SELECT count(*) FROM $t" 2>/dev/null || echo "-")
    R=$(docker exec -i "$CONT" psql -U certsaas -d "$DB_TESTE" -t -A \
        -c "SELECT count(*) FROM $t" 2>/dev/null || echo "-")
    if [ "$P" = "-" ] || [ "$R" = "-" ]; then
        printf "%-20s %12s %12s   ⚠️  NAO CONSEGUI LER\n" "$t" "$P" "$R"
        PROBLEMA=$((PROBLEMA+1))
    elif [ "$P" = "$R" ]; then
        printf "%-20s %12s %12s   ✅\n" "$t" "$P" "$R"
    elif [ "$R" -eq 0 ] && [ "$P" -gt 0 ]; then
        printf "%-20s %12s %12s   ❌ VAZIA no backup!\n" "$t" "$P" "$R"
        PROBLEMA=$((PROBLEMA+1))
    elif [ "$R" -lt "$P" ]; then
        printf "%-20s %12s %12s   ✅ (+%s após o backup)\n" "$t" "$P" "$R" "$((P-R))"
        ATRASO=$((ATRASO+1))
    else
        printf "%-20s %12s %12s   ❌ backup com MAIS que a produção\n" "$t" "$P" "$R"
        PROBLEMA=$((PROBLEMA+1))
    fi
    [ "$P" != "-" ] && TOTAL_PROD=$((TOTAL_PROD + P))
    [ "$R" != "-" ] && TOTAL_REST=$((TOTAL_REST + R))
done

# funções e um dado real, para provar que não é só estrutura
FUNC_P=$(docker compose exec -T db psql -U certsaas -d certsaas -t -A -c \
    "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'")
FUNC_R=$(docker exec -i "$CONT" psql -U certsaas -d "$DB_TESTE" -t -A -c \
    "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'")
if [ "$FUNC_P" = "$FUNC_R" ]; then
    printf "%-20s %12s %12s   ✅\n" "funções (public)" "$FUNC_P" "$FUNC_R"
elif [ "$FUNC_R" -lt "$FUNC_P" ]; then
    printf "%-20s %12s %12s   ✅ (+%s criadas após o backup)\n" \
        "funções (public)" "$FUNC_P" "$FUNC_R" "$((FUNC_P-FUNC_R))"
else
    printf "%-20s %12s %12s   ❌ conferir\n" "funções (public)" "$FUNC_P" "$FUNC_R"
    PROBLEMA=$((PROBLEMA+1))
fi

echo ""
azul "[4/4] Amostra de dados de verdade (do banco restaurado):"
docker exec -i "$CONT" psql -U certsaas -d "$DB_TESTE" -c \
"SELECT e.razao_social AS empresa, count(ct.id) AS certificados,
        max(ct.data_calibracao) AS ultimo
   FROM empresa e LEFT JOIN certificado ct ON ct.empresa_id = e.id
  GROUP BY 1 ORDER BY 2 DESC LIMIT 5;" 2>/dev/null

# ── Veredito ──
echo ""
if [ "$PROBLEMA" -eq 0 ] && [ "$ERROS" -eq 0 ] && [ "$TOTAL_REST" -gt 0 ]; then
    verde "═══ ✅ BACKUP VÁLIDO — restaurou sem erros e com os dados ═══"
    echo   "    Total restaurado: $TOTAL_REST registros nas tabelas conferidas."
    if [ "$ATRASO" -gt 0 ]; then
        echo "    $ATRASO tabela(s) com menos linhas que a produção — esperado:"
        echo "    o dump é de $(date -r "$ARQ" '+%d/%m %H:%M') e o sistema seguiu rodando."
    fi
    verde "    Se o servidor morrer hoje, este arquivo traz o sistema de volta."
    RET=0
else
    verm "═══ ❌ PROBLEMA — $PROBLEMA item(ns) com falha real e $ERROS erro(s) no psql ═══"
    verm "    Isto NÃO é diferença de horário: é tabela vazia, ilegível ou"
    verm "    com mais linhas no backup que na produção. Log: $LOG_REST"
    RET=1
fi

# ── Registra no banco, para o worker avisar junto com os resumos das 7h ──
DUMP_EM=$(date -r "$ARQ" '+%Y-%m-%d %H:%M:%S')
RESULTADO=$([ "$RET" -eq 0 ] && echo ok || echo falha)
DETALHE="tabelas conferidas: $(echo $TABELAS | wc -w); atraso normal em $ATRASO; problemas: $PROBLEMA; erros psql: $ERROS"
docker compose exec -T db psql -U certsaas -d certsaas -q -c \
  "SELECT registrar_teste_backup('$(basename "$ARQ")', '$DUMP_EM'::timestamptz, \
   '$RESULTADO', $PROBLEMA, $ERROS, $TOTAL_REST, '$DETALHE')" >/dev/null 2>&1 \
   && echo "resultado registrado (o aviso sai no resumo das 7h)" \
   || echo "AVISO: não consegui registrar o resultado no banco"

# ── Limpeza ──
azul "\nRemovendo o banco temporário…"
docker rm -f "$CONT" >/dev/null 2>&1
echo "pronto."
exit $RET
