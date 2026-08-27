-- ================================================================
-- Nível 1 (logo + cor da marca) e local de calibração detalhado
--   docker compose exec -T db psql -U certsaas -d certsaas < db/seed/21_nivel1_local.sql
-- ================================================================

-- Personalização visual do certificado (por empresa)
ALTER TABLE empresa
    ADD COLUMN IF NOT EXISTS logo_url    text,
    ADD COLUMN IF NOT EXISTS cor_marca   text NOT NULL DEFAULT '#0d3b2e';

-- Local da calibração: tipo fixo (in loco / laboratório) + detalhe livre.
-- Substitui o antigo local_ensaio ('cliente'/'empresa') por termos corretos.
ALTER TABLE certificado
    ADD COLUMN IF NOT EXISTS local_tipo     text NOT NULL DEFAULT 'in_loco'
        CHECK (local_tipo IN ('in_loco','laboratorio')),
    ADD COLUMN IF NOT EXISTS local_detalhe  text;

-- Migra o valor antigo, se existia (cliente -> in_loco, empresa -> laboratorio)
UPDATE certificado SET local_tipo =
    CASE WHEN local_ensaio = 'empresa' THEN 'laboratorio' ELSE 'in_loco' END
 WHERE local_tipo IS NULL OR local_tipo = 'in_loco';

SELECT 'nível 1 (logo/cor) e local de calibração adicionados' AS resultado;
