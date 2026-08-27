-- ================================================================
-- Opção: mostrar periodicidade/próxima calibração no PDF
--   docker compose exec -T db psql -U certsaas -d certsaas < db/seed/26_validade_pdf.sql
-- ================================================================

ALTER TABLE empresa
    ADD COLUMN IF NOT EXISTS mostra_validade boolean NOT NULL DEFAULT false;

SELECT 'mostra_validade adicionada à empresa' AS resultado;
