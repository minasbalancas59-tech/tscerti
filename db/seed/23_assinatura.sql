-- ================================================================
-- Assinatura manuscrita digitalizada (Nível 1) por usuário
--   docker compose exec -T db psql -U certsaas -d certsaas < db/seed/23_assinatura.sql
-- ================================================================

ALTER TABLE usuario
    ADD COLUMN IF NOT EXISTS assinatura_url text;

SELECT 'campo de assinatura do usuário adicionado' AS resultado;
