-- ================================================================
-- Leitura antes/depois do ajuste (as-found/as-left) + autorização livre
--   docker compose exec -T db psql -U certsaas -d certsaas < db/seed/22_ajuste_autorizacao.sql
-- ================================================================

-- Parâmetro configurável: a empresa usa registro de ajuste?
ALTER TABLE empresa
    ADD COLUMN IF NOT EXISTS usa_ajuste boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS texto_autorizacao text;

-- Migra a autorização antiga (número) para o texto livre, se estiver vazio
UPDATE empresa
   SET texto_autorizacao = 'Autorização Inmetro nº ' || num_autorizacao
 WHERE texto_autorizacao IS NULL AND num_autorizacao IS NOT NULL
       AND num_autorizacao <> '';

-- No certificado: houve ajuste nesta calibração?
ALTER TABLE certificado
    ADD COLUMN IF NOT EXISTS houve_ajuste boolean NOT NULL DEFAULT false;

-- Na indicação: guardar a leitura "antes do ajuste" (as-found).
-- A coluna 'indicacao' existente passa a ser a leitura final (depois).
ALTER TABLE ensaio_indicacao
    ADD COLUMN IF NOT EXISTS indicacao_antes numeric;

SELECT 'ajuste (as-found/as-left) e autorização livre adicionados' AS resultado;
