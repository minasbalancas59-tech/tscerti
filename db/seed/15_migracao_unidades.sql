-- ================================================================
-- MELHORIA · Unidades de medida — Rodar UMA vez:
--   docker compose exec -T db psql -U certsaas -d certsaas < db/seed/15_migracao_unidades.sql
--
-- Adiciona unidade (g/kg/t) à balança e ao peso padrão.
-- Registros antigos herdam 'kg' automaticamente (default).
-- Os VALORES continuam guardados na unidade escolhida pelo usuário;
-- o cálculo de EMA é adimensional (múltiplos de e), então funciona
-- em qualquer unidade. A incerteza converte peso↔balança internamente.
-- ================================================================

ALTER TABLE balanca
    ADD COLUMN IF NOT EXISTS unidade text NOT NULL DEFAULT 'kg'
    CHECK (unidade IN ('g','kg','t'));

ALTER TABLE peso_padrao
    ADD COLUMN IF NOT EXISTS unidade text NOT NULL DEFAULT 'kg'
    CHECK (unidade IN ('g','kg','t'));

SELECT 'migração de unidades aplicada' AS resultado;
