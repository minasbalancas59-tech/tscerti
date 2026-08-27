-- ═══════════════════════════════════════════════════════════
-- 80 · Pontos de calibração do peso padrão (RBC)
-- Cada peso pode ter 1..N pontos (peso simples = 1 linha;
-- conjunto como CP01-B/PE-20 = N linhas). Cada ponto traz o
-- valor convencional e a incerteza do certificado daquele ponto.
-- Substitui o uso dos campos únicos incerteza_certificado /
-- valor_convencional (que ficam no peso mas deixam de ser usados).
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS peso_ponto_rbc (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id         uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    peso_padrao_id     uuid NOT NULL REFERENCES peso_padrao(id) ON DELETE CASCADE,
    ordem              int  NOT NULL DEFAULT 1,
    valor_nominal      text,                 -- ex.: "1 g", "500 kg" (livre, como no cadastro do peso)
    valor_convencional numeric,              -- massa real do certificado (ex.: 1.00000)
    incerteza          numeric,              -- incerteza expandida U do certificado (ex.: 0.00003)
    k                  numeric DEFAULT 2,    -- fator k daquele ponto
    criado_em          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_peso_ponto_peso ON peso_ponto_rbc (peso_padrao_id, ordem);

ALTER TABLE peso_ponto_rbc ENABLE ROW LEVEL SECURITY;
ALTER TABLE peso_ponto_rbc FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON peso_ponto_rbc;
CREATE POLICY tenant_isolation ON peso_ponto_rbc
    USING (empresa_id = current_empresa_id())
    WITH CHECK (empresa_id = current_empresa_id());

SELECT 'Tabela peso_ponto_rbc criada (pontos de calibração do peso, com RLS)' AS resultado;
