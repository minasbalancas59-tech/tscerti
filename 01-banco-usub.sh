#!/bin/bash
# ══ FASE 2 do lote de carga — parte 1: banco ══
# Marca a substituição por ponto no RBC e guarda o u_sub calculado.
# Fator configurável por empresa (padrão √n · s_rep) enquanto a
# referência normativa não é confirmada com a Cgcre.
set -e
cd /root/cert-saas
docker compose exec -T db psql -U certsaas -d certsaas <<'SQL'
-- onde ficam as leituras de cada ponto: marca degraus de substituição
ALTER TABLE leitura_rbc      ADD COLUMN IF NOT EXISTS degraus_sub integer;
ALTER TABLE incerteza_ponto_rbc ADD COLUMN IF NOT EXISTS u_sub numeric(18,9);
ALTER TABLE incerteza_ponto_rbc ADD COLUMN IF NOT EXISTS degraus_sub integer;

-- fator por empresa: contribuição de cada degrau (padrão 1,0 = s_rep integral)
ALTER TABLE empresa ADD COLUMN IF NOT EXISTS rbc_fator_sub numeric(6,3) NOT NULL DEFAULT 1.0;

COMMENT ON COLUMN empresa.rbc_fator_sub IS
  'Fator do componente u_sub por degrau de substituição: u_sub = fator * sqrt(n) * s_rep. '
  '1.0 = desvio-padrão integral (conservador). Ajustar conforme referência normativa adotada.';

SELECT razao_social, rbc_fator_sub FROM empresa WHERE acreditada ORDER BY 1;
SQL
echo "✓ banco pronto"
