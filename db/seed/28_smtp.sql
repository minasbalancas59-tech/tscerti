-- ================================================================
-- Configuração global do sistema (SMTP) editável pelo painel
--   docker compose exec -T db psql -U certsaas -d certsaas < db/seed/28_smtp.sql
-- ================================================================
CREATE TABLE IF NOT EXISTS config_sistema (
    chave  text PRIMARY KEY,
    valor  text
);

GRANT SELECT, INSERT, UPDATE, DELETE ON config_sistema TO api_app;

SELECT 'config_sistema criada' AS resultado;
