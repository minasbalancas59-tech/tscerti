-- ================================================================
-- ETAPA 3 · Migração — Rodar UMA vez:
--   docker compose exec -T db psql -U certsaas -d certsaas < db/seed/12_migracao_etapa3.sql
--
-- Adiciona o contexto de avaliação do EMA por certificado
-- (selecionável na tela: 'subsequente' ou 'em_uso').
-- ================================================================

ALTER TABLE certificado
    ADD COLUMN IF NOT EXISTS contexto_ema text NOT NULL DEFAULT 'subsequente'
    CHECK (contexto_ema IN ('subsequente','em_uso'));

SELECT 'migração etapa 3 aplicada' AS resultado;
