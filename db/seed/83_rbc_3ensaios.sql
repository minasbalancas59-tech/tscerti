-- ═══════════════════════════════════════════════════════════
-- 83 · Coleta RBC — 3 ensaios + composição de pesos
-- Adiciona as tabelas que faltavam para a estrutura definitiva:
--   • excentricidade_rbc  (posições × N leituras)
--   • mobilidade_rbc      (N repetições — registro/caracterização)
--   • carga_peso_rbc      (composição: quais pontos compõem cada carga,
--                          com snapshot para rastreabilidade imutável)
-- Segue o padrão da leitura_rbc (RLS forçado, FK CASCADE).
-- Não altera nada do fluxo Portaria 157.
-- ═══════════════════════════════════════════════════════════

-- ── EXCENTRICIDADE: posições do prato × N leituras ──────────
CREATE TABLE IF NOT EXISTS excentricidade_rbc (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id     uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    certificado_id uuid NOT NULL REFERENCES certificado(id) ON DELETE CASCADE,
    ordem_posicao  int  NOT NULL,          -- 1=centro, 2..N = posições
    nome_posicao   text NOT NULL,          -- 'centro', 'frente-esq', etc.
    carga          numeric(14,4),          -- carga usada na excentricidade
    ordem_leitura  int  NOT NULL,          -- 1..N
    indicacao      numeric(14,4) NOT NULL,
    criado_em      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (certificado_id, ordem_posicao, ordem_leitura)
);
CREATE INDEX IF NOT EXISTS idx_exc_rbc_cert
    ON excentricidade_rbc (certificado_id, ordem_posicao, ordem_leitura);
ALTER TABLE excentricidade_rbc ENABLE ROW LEVEL SECURITY;
ALTER TABLE excentricidade_rbc FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON excentricidade_rbc;
CREATE POLICY tenant_isolation ON excentricidade_rbc
    USING (empresa_id = current_empresa_id())
    WITH CHECK (empresa_id = current_empresa_id());

-- ── MOBILIDADE: N repetições (registro, não entra no cálculo) ─
CREATE TABLE IF NOT EXISTS mobilidade_rbc (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id        uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    certificado_id    uuid NOT NULL REFERENCES certificado(id) ON DELETE CASCADE,
    carga_referencia  numeric(14,4),       -- carga de referência
    divisao_e         numeric(14,4),       -- 1 divisão adicionada
    esperado          numeric(14,4),       -- carga_ref + e
    ordem_leitura     int  NOT NULL,        -- 1..N
    display_leu       numeric(14,4) NOT NULL,
    criado_em         timestamptz NOT NULL DEFAULT now(),
    UNIQUE (certificado_id, ordem_leitura)
);
CREATE INDEX IF NOT EXISTS idx_mob_rbc_cert
    ON mobilidade_rbc (certificado_id, ordem_leitura);
ALTER TABLE mobilidade_rbc ENABLE ROW LEVEL SECURITY;
ALTER TABLE mobilidade_rbc FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON mobilidade_rbc;
CREATE POLICY tenant_isolation ON mobilidade_rbc
    USING (empresa_id = current_empresa_id())
    WITH CHECK (empresa_id = current_empresa_id());

-- ── COMPOSIÇÃO: quais pontos de peso compõem cada carga ─────
-- Cada linha = um ponto de peso usado numa carga da indicação.
-- Guarda SNAPSHOT (valor/incerteza/certificado) para rastreabilidade
-- imutável, mesmo que o peso seja alterado ou excluído depois.
CREATE TABLE IF NOT EXISTS carga_peso_rbc (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id         uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    certificado_id     uuid NOT NULL REFERENCES certificado(id) ON DELETE CASCADE,
    ordem_ponto        int  NOT NULL,       -- a carga da indicação (1,2,3…)
    peso_ponto_rbc_id  uuid,                -- o ponto do peso usado (pode ser null se snapshot manual)
    -- snapshot para rastreabilidade (não muda se o peso mudar):
    peso_identificacao text,                -- ex.: "CP01-B"
    valor_nominal      text,                -- ex.: "500 kg"
    valor_convencional numeric,             -- massa real do ponto
    incerteza          numeric,             -- U do ponto
    k                  numeric,             -- k do ponto
    num_certificado    text,                -- nº do certificado do peso (rastreabilidade)
    criado_em          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_carga_peso_cert
    ON carga_peso_rbc (certificado_id, ordem_ponto);
ALTER TABLE carga_peso_rbc ENABLE ROW LEVEL SECURITY;
ALTER TABLE carga_peso_rbc FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON carga_peso_rbc;
CREATE POLICY tenant_isolation ON carga_peso_rbc
    USING (empresa_id = current_empresa_id())
    WITH CHECK (empresa_id = current_empresa_id());

-- ── Config: nº de posições da excentricidade (mín. 4, configurável) ─
ALTER TABLE empresa ADD COLUMN IF NOT EXISTS rbc_num_posicoes_exc int NOT NULL DEFAULT 5;

SELECT 'Fase 3 estrutura: excentricidade_rbc + mobilidade_rbc + carga_peso_rbc criadas' AS resultado;
