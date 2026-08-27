-- ================================================================
-- Opção: permitir download de certificados na tela de validação pública
--   docker compose exec -T db psql -U certsaas -d certsaas < db/seed/33_validar_download.sql
-- ================================================================
ALTER TABLE empresa
    ADD COLUMN IF NOT EXISTS validar_permite_download boolean NOT NULL DEFAULT true;
SELECT 'validar_permite_download adicionada' AS resultado;
