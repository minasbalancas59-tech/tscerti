-- ================================================================
-- ETAPA 4 · Migração — Rodar UMA vez:
--   docker compose exec -T db psql -U certsaas -d certsaas < db/seed/13_migracao_etapa4.sql
-- ================================================================

-- Data de calibração do peso padrão (ao lado da validade já existente)
ALTER TABLE peso_padrao
    ADD COLUMN IF NOT EXISTS data_calibracao date;

-- Configurações de emissão por empresa (método, textos da norma, assinatura A1)
ALTER TABLE empresa
    ADD COLUMN IF NOT EXISTS endereco          text,
    ADD COLUMN IF NOT EXISTS cidade_uf         text,
    ADD COLUMN IF NOT EXISTS telefone          text,
    ADD COLUMN IF NOT EXISTS email             text,
    ADD COLUMN IF NOT EXISTS metodo_calibracao text
        DEFAULT 'PC-01 — conforme Portaria Inmetro nº 157/2022',
    ADD COLUMN IF NOT EXISTS texto_periodicidade text
        DEFAULT 'O intervalo de calibração é definido em acordo com o cliente.',
    ADD COLUMN IF NOT EXISTS texto_rodape      text,
    -- Assinatura digital ICP-Brasil A1 (preenchido quando a empresa tiver o e-CNPJ)
    ADD COLUMN IF NOT EXISTS a1_arquivo_url    text,
    ADD COLUMN IF NOT EXISTS a1_senha          text,
    ADD COLUMN IF NOT EXISTS assinatura_habilitada boolean NOT NULL DEFAULT false;

-- Signatário: função/registro já existem em usuario (registro_prof).
-- Motivo da devolução de um certificado para rascunho (análise crítica)
ALTER TABLE certificado
    ADD COLUMN IF NOT EXISTS obs_reprovacao text,
    ADD COLUMN IF NOT EXISTS metodo_snapshot text;   -- método congelado na emissão

SELECT 'migração etapa 4 aplicada' AS resultado;
