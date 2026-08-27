-- ================================================================
-- Conformidade no ensaio de excentricidade (erro vs EMA da carga)
--   docker compose exec -T db psql -U certsaas -d certsaas < db/seed/29_exc_conformidade.sql
-- ================================================================
ALTER TABLE ensaio_excentricidade
    ADD COLUMN IF NOT EXISTS ema numeric,
    ADD COLUMN IF NOT EXISTS aprovado boolean;
SELECT 'conformidade da excentricidade adicionada' AS resultado;
