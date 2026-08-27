-- Exportacao de dados da empresa (backup/offboarding) — Joao, 20/08/2026
CREATE TABLE IF NOT EXISTS exportacao_empresa (
    id             uuid PRIMARY KEY,
    empresa_id     uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    solicitado_por uuid REFERENCES usuario(id),
    status         text NOT NULL DEFAULT 'pendente'
                   CHECK (status IN ('pendente','gerando','pronto','erro','expirado')),
    arquivo_url    text,
    tamanho_bytes  bigint,
    erro           text,
    criado_em      timestamptz NOT NULL DEFAULT now(),
    pronto_em      timestamptz,
    expira_em      timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_exportacao_ativa
    ON exportacao_empresa (empresa_id) WHERE status IN ('pendente','gerando');
ALTER TABLE exportacao_empresa ENABLE ROW LEVEL SECURITY;
ALTER TABLE exportacao_empresa FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON exportacao_empresa;
CREATE POLICY tenant_isolation ON exportacao_empresa
    USING (empresa_id = current_empresa_id())
    WITH CHECK (empresa_id = current_empresa_id());
GRANT SELECT, INSERT, UPDATE ON exportacao_empresa TO api_app;
