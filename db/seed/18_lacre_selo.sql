-- ================================================================
-- Campos de número de lacre e selo Inmetro no certificado
--   docker compose exec -T db psql -U certsaas -d certsaas < db/seed/18_lacre_selo.sql
-- ================================================================

ALTER TABLE certificado
    ADD COLUMN IF NOT EXISTS numero_lacre text,
    ADD COLUMN IF NOT EXISTS selo_inmetro text;

SELECT 'campos lacre e selo adicionados' AS resultado;
