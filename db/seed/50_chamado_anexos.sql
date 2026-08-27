-- ═══════════════════════════════════════════════════════════
-- 50 · Anexos de imagem nos chamados
--   Cada mensagem de chamado pode ter imagens anexadas (prints,
--   fotos). Os arquivos ficam no MinIO; aqui guardamos os metadados.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS chamado_anexo (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    chamado_id   uuid NOT NULL REFERENCES chamado(id) ON DELETE CASCADE,
    mensagem_id  uuid REFERENCES chamado_mensagem(id) ON DELETE CASCADE,
    empresa_id   uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    nome_arquivo text NOT NULL,
    content_type text NOT NULL,
    tamanho      int  NOT NULL,
    chave_s3     text NOT NULL,      -- s3://bucket/chave
    criado_em    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chamado_anexo_chamado ON chamado_anexo (chamado_id);
CREATE INDEX IF NOT EXISTS idx_chamado_anexo_msg ON chamado_anexo (mensagem_id);

-- RLS: cada empresa só vê os próprios anexos (mesmo padrão dos chamados)
ALTER TABLE chamado_anexo ENABLE ROW LEVEL SECURITY;
ALTER TABLE chamado_anexo FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON chamado_anexo;
CREATE POLICY tenant_isolation ON chamado_anexo
    USING (empresa_id = current_empresa_id())
    WITH CHECK (empresa_id = current_empresa_id());

GRANT SELECT, INSERT, DELETE ON chamado_anexo TO api_app;

-- Função SECURITY DEFINER para o super-admin listar/baixar anexos
-- (o super-admin atravessa o RLS via funções, como nos demais casos)
DROP FUNCTION IF EXISTS sa_chamado_anexo(uuid);
CREATE FUNCTION sa_chamado_anexo(p_anexo uuid)
RETURNS TABLE (chave_s3 text, nome_arquivo text, content_type text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT chave_s3, nome_arquivo, content_type FROM chamado_anexo WHERE id = p_anexo
$$;

DROP FUNCTION IF EXISTS sa_chamado_anexos(uuid);
CREATE FUNCTION sa_chamado_anexos(p_chamado uuid)
RETURNS TABLE (id uuid, mensagem_id uuid, nome_arquivo text, content_type text, tamanho int)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT id, mensagem_id, nome_arquivo, content_type, tamanho
      FROM chamado_anexo WHERE chamado_id = p_chamado ORDER BY criado_em
$$;

SELECT 'anexos de chamado adicionados' AS resultado;
