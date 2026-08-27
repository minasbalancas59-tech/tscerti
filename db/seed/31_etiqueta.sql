-- ================================================================
-- Tamanho de etiqueta de calibração (config da empresa)
--   docker compose exec -T db psql -U certsaas -d certsaas < db/seed/31_etiqueta.sql
-- ================================================================
ALTER TABLE empresa
    ADD COLUMN IF NOT EXISTS etiqueta_tamanho text NOT NULL DEFAULT '40x60';
SELECT 'etiqueta_tamanho adicionada' AS resultado;
