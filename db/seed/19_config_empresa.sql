-- ================================================================
-- Configuração de parâmetros de ensaio por empresa + local do ensaio
--   docker compose exec -T db psql -U certsaas -d certsaas < db/seed/19_config_empresa.sql
-- ================================================================

-- Parâmetros de como a empresa trabalha (um registro por empresa)
ALTER TABLE empresa
    ADD COLUMN IF NOT EXISTS usa_excentricidade  boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS usa_repetibilidade   boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS num_repeticoes       int     NOT NULL DEFAULT 3,
    ADD COLUMN IF NOT EXISTS exige_temp_umidade   boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS exige_lacre_selo     boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS fator_abrangencia    numeric NOT NULL DEFAULT 2,
    ADD COLUMN IF NOT EXISTS titulo_documento     text    NOT NULL DEFAULT 'CERTIFICADO DE CONFORMIDADE';

-- Local onde a calibração foi realizada (por certificado)
ALTER TABLE certificado
    ADD COLUMN IF NOT EXISTS local_ensaio text NOT NULL DEFAULT 'cliente'
        CHECK (local_ensaio IN ('cliente','empresa'));

-- Garantir num_repeticoes válido (3, 5 ou 10)
ALTER TABLE empresa DROP CONSTRAINT IF EXISTS empresa_num_repeticoes_check;
ALTER TABLE empresa ADD CONSTRAINT empresa_num_repeticoes_check
    CHECK (num_repeticoes IN (1,3,5,10));

SELECT 'configuração de empresa e local do ensaio adicionados' AS resultado;
