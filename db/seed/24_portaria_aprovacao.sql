-- ================================================================
-- Campo "Portaria de aprovação" (texto livre) no cadastro da balança
--   docker compose exec -T db psql -U certsaas -d certsaas < db/seed/24_portaria_aprovacao.sql
-- ================================================================

ALTER TABLE balanca
    ADD COLUMN IF NOT EXISTS portaria_aprovacao text;

SELECT 'portaria_aprovacao adicionada à balança' AS resultado;
