-- ================================================================
-- MELHORIA · Upload do certificado (PDF) do peso padrão
--   docker compose exec -T db psql -U certsaas -d certsaas < db/seed/16_peso_pdf.sql
-- ================================================================

ALTER TABLE peso_padrao
    ADD COLUMN IF NOT EXISTS certificado_pdf_url text;

SELECT 'coluna certificado_pdf_url adicionada' AS resultado;
