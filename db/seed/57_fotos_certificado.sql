-- ═══════════════════════════════════════════════════════════
-- 57 · Fotos das leituras do certificado + download pelo QR
--   1) Fotos (evidência visual das leituras no display da balança).
--      Visíveis só para técnicos/gestores do sistema — NUNCA no
--      portal do cliente nem na validação pública por QR.
--      Comprimidas no upload; expurgadas automaticamente após 2 anos.
--   2) Flag por empresa: permitir baixar o PDF na validação por QR.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS certificado_foto (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    certificado_id uuid NOT NULL REFERENCES certificado(id) ON DELETE CASCADE,
    empresa_id     uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    legenda        text,                    -- ex.: "Carga 10 kg", "Display faixa 2"
    content_type   text NOT NULL,
    tamanho        int  NOT NULL,           -- bytes (após compressão)
    chave_s3       text NOT NULL,           -- s3://bucket/certificados-fotos/...
    criado_por     uuid REFERENCES usuario(id) ON DELETE SET NULL,
    criado_em      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cert_foto_cert   ON certificado_foto (certificado_id, criado_em);
CREATE INDEX IF NOT EXISTS idx_cert_foto_data   ON certificado_foto (criado_em);   -- para o expurgo

-- RLS por empresa (mesma política das demais tabelas do tenant)
ALTER TABLE certificado_foto ENABLE ROW LEVEL SECURITY;
ALTER TABLE certificado_foto FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON certificado_foto;
CREATE POLICY tenant_isolation ON certificado_foto
    USING (empresa_id = current_empresa_id())
    WITH CHECK (empresa_id = current_empresa_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON certificado_foto TO api_app;

-- NOTA: o download pelo QR já é configurável por empresa através da
-- coluna empresa.validar_permite_download (migração 34). Não é
-- necessário criar outra flag.

-- Função para o Worker expurgar fotos antigas (retorna as chaves S3
-- a remover; o Worker apaga do MinIO e depois chama a remoção do banco).
CREATE OR REPLACE FUNCTION fotos_para_expurgar(p_meses int DEFAULT 24)
RETURNS TABLE (id uuid, chave_s3 text) LANGUAGE sql STABLE AS $$
    SELECT id, chave_s3 FROM certificado_foto
     WHERE criado_em < now() - make_interval(months => p_meses)
     LIMIT 500;
$$;

SELECT 'fotos de certificado + flag download QR criados' AS resultado;
