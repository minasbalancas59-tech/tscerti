-- ═══════════════════════════════════════════════════════════
-- 81 · Coleta RBC — estrutura de dados (Fase 3a)
-- Tabela de N leituras por ponto de carga (fluxo RBC separado).
-- config: quantas leituras por ponto (3 ou 5).
-- O certificado.emitir_rbc já existe (migração 79).
-- Nada do fluxo Portaria 157 é alterado.
-- ═══════════════════════════════════════════════════════════

-- Quantas leituras por ponto (empresa acreditada escolhe 3 ou 5)
ALTER TABLE empresa ADD COLUMN IF NOT EXISTS rbc_num_leituras int NOT NULL DEFAULT 3;

-- N leituras por ponto de carga (coleta de repetibilidade do RBC)
CREATE TABLE IF NOT EXISTS leitura_rbc (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id     uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    certificado_id uuid NOT NULL REFERENCES certificado(id) ON DELETE CASCADE,
    ordem_ponto    int  NOT NULL,          -- qual ponto de carga (1,2,3…)
    carga          numeric(14,4) NOT NULL, -- valor da carga aplicada
    ordem_leitura  int  NOT NULL,          -- 1..N (a repetição)
    indicacao      numeric(14,4) NOT NULL, -- a leitura observada
    criado_em      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (certificado_id, ordem_ponto, ordem_leitura)
);

CREATE INDEX IF NOT EXISTS idx_leitura_rbc_cert
    ON leitura_rbc (certificado_id, ordem_ponto, ordem_leitura);

ALTER TABLE leitura_rbc ENABLE ROW LEVEL SECURITY;
ALTER TABLE leitura_rbc FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON leitura_rbc;
CREATE POLICY tenant_isolation ON leitura_rbc
    USING (empresa_id = current_empresa_id())
    WITH CHECK (empresa_id = current_empresa_id());

-- Orçamento de incerteza calculado por ponto (guardado para auditoria)
CREATE TABLE IF NOT EXISTS incerteza_ponto_rbc (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id     uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    certificado_id uuid NOT NULL REFERENCES certificado(id) ON DELETE CASCADE,
    ordem_ponto    int  NOT NULL,
    carga          numeric(14,4) NOT NULL,
    media          numeric(14,6),
    erro           numeric(14,6),
    s_rep          numeric(14,8),  -- desvio padrão das leituras
    u_rep          numeric(14,8),
    u_res          numeric(14,8),
    u_pad          numeric(14,8),
    u_exc          numeric(14,8),
    u_buoy         numeric(14,8),
    u_c            numeric(14,8),
    veff           numeric(14,4),
    k              numeric(8,4),
    u_expandida    numeric(14,8),
    criado_em      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (certificado_id, ordem_ponto)
);

ALTER TABLE incerteza_ponto_rbc ENABLE ROW LEVEL SECURITY;
ALTER TABLE incerteza_ponto_rbc FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON incerteza_ponto_rbc;
CREATE POLICY tenant_isolation ON incerteza_ponto_rbc
    USING (empresa_id = current_empresa_id())
    WITH CHECK (empresa_id = current_empresa_id());

SELECT 'Fase 3a: tabelas leitura_rbc + incerteza_ponto_rbc criadas, empresa.rbc_num_leituras adicionada' AS resultado;
