-- ================================================================
-- Modelo de certificado selecionável + teste de sensibilidade
--   docker compose exec -T db psql -U certsaas -d certsaas < db/seed/36_modelo_sensibilidade.sql
-- ================================================================

-- Modelo do PDF: 'classico' (o atual) ou 'completo' (estilo TBF, com
-- sensibilidade, TUR, k e veff)
ALTER TABLE empresa
    ADD COLUMN IF NOT EXISTS modelo_certificado text NOT NULL DEFAULT 'classico';

-- Teste de sensibilidade (uma linha por certificado): aplica-se uma
-- carga de referência, adiciona-se 1 divisão (e) e verifica-se o display
CREATE TABLE IF NOT EXISTS ensaio_sensibilidade (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id      uuid NOT NULL REFERENCES empresa(id),
    certificado_id  uuid NOT NULL REFERENCES certificado(id) ON DELETE CASCADE,
    carga_referencia numeric(12,3) NOT NULL,
    adicao          numeric(12,3) NOT NULL,   -- normalmente 1e
    resultado_display numeric(12,3) NOT NULL,
    UNIQUE (certificado_id)
);

-- RLS igual aos outros ensaios (isolamento por empresa)
ALTER TABLE ensaio_sensibilidade ENABLE ROW LEVEL SECURITY;
ALTER TABLE ensaio_sensibilidade FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ensaio_sensibilidade;
CREATE POLICY tenant_isolation ON ensaio_sensibilidade
    USING (empresa_id = current_empresa_id())
    WITH CHECK (empresa_id = current_empresa_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON ensaio_sensibilidade TO api_app;

SELECT 'modelo de certificado e sensibilidade adicionados' AS resultado;
