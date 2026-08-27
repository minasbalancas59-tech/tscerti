-- ═══════════════════════════════════════════════════════════
-- 43 · Chamados de suporte (helpdesk)
--   O usuário da empresa abre um chamado; o super-admin recebe,
--   responde e gerencia. Padrão de ticket profissional:
--   número sequencial, categoria, prioridade, status com fluxo,
--   e conversa em thread.
-- ═══════════════════════════════════════════════════════════

CREATE SEQUENCE IF NOT EXISTS chamado_numero_seq START 1;

CREATE TABLE IF NOT EXISTS chamado (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id  uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    numero      int  NOT NULL DEFAULT nextval('chamado_numero_seq'),
    assunto     text NOT NULL,
    categoria   text NOT NULL DEFAULT 'duvida'
                CHECK (categoria IN ('duvida','problema','financeiro','melhoria','outro')),
    prioridade  text NOT NULL DEFAULT 'normal'
                CHECK (prioridade IN ('baixa','normal','alta','urgente')),
    status      text NOT NULL DEFAULT 'aberto'
                CHECK (status IN ('aberto','em_atendimento','aguardando_cliente','resolvido','fechado')),
    criado_por  uuid NOT NULL,
    criado_por_nome text NOT NULL,
    criado_em   timestamptz NOT NULL DEFAULT now(),
    atualizado_em timestamptz NOT NULL DEFAULT now(),
    fechado_em  timestamptz
);
CREATE INDEX IF NOT EXISTS idx_chamado_empresa ON chamado (empresa_id, status);
CREATE INDEX IF NOT EXISTS idx_chamado_status ON chamado (status, atualizado_em DESC);

CREATE TABLE IF NOT EXISTS chamado_mensagem (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    chamado_id  uuid NOT NULL REFERENCES chamado(id) ON DELETE CASCADE,
    empresa_id  uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    autor_tipo  text NOT NULL CHECK (autor_tipo IN ('cliente','suporte')),
    autor_nome  text NOT NULL,
    mensagem    text NOT NULL,
    criado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chamado_msg ON chamado_mensagem (chamado_id, criado_em);

-- RLS: a empresa só vê os próprios chamados (padrão do sistema)
ALTER TABLE chamado ENABLE ROW LEVEL SECURITY;
ALTER TABLE chamado FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON chamado;
CREATE POLICY tenant_isolation ON chamado
    USING (empresa_id = current_empresa_id())
    WITH CHECK (empresa_id = current_empresa_id());
GRANT SELECT, INSERT, UPDATE ON chamado TO api_app;

ALTER TABLE chamado_mensagem ENABLE ROW LEVEL SECURITY;
ALTER TABLE chamado_mensagem FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON chamado_mensagem;
CREATE POLICY tenant_isolation ON chamado_mensagem
    USING (empresa_id = current_empresa_id())
    WITH CHECK (empresa_id = current_empresa_id());
GRANT SELECT, INSERT ON chamado_mensagem TO api_app;
GRANT USAGE ON SEQUENCE chamado_numero_seq TO api_app;

-- ═══ Funções do SUPER-ADMIN (atravessam o isolamento) ═══════

-- Lista de chamados (com filtro de status) + dados da empresa
DROP FUNCTION IF EXISTS sa_chamados(text);
CREATE FUNCTION sa_chamados(p_status text DEFAULT NULL)
RETURNS TABLE (
    id uuid, numero int, empresa text, assunto text, categoria text,
    prioridade text, status text, criado_por_nome text,
    criado_em timestamptz, atualizado_em timestamptz, qtd_mensagens bigint
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT c.id, c.numero, e.razao_social, c.assunto, c.categoria,
           c.prioridade, c.status, c.criado_por_nome,
           c.criado_em, c.atualizado_em,
           (SELECT count(*) FROM chamado_mensagem m WHERE m.chamado_id = c.id)
      FROM chamado c JOIN empresa e ON e.id = c.empresa_id
     WHERE p_status IS NULL OR c.status = p_status
     ORDER BY
        CASE c.prioridade WHEN 'urgente' THEN 0 WHEN 'alta' THEN 1
             WHEN 'normal' THEN 2 ELSE 3 END,
        c.atualizado_em DESC
$$;

-- Detalhe de um chamado + mensagens
DROP FUNCTION IF EXISTS sa_chamado_mensagens(uuid);
CREATE FUNCTION sa_chamado_mensagens(p_id uuid)
RETURNS TABLE (autor_tipo text, autor_nome text, mensagem text, criado_em timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT m.autor_tipo, m.autor_nome, m.mensagem, m.criado_em
      FROM chamado_mensagem m WHERE m.chamado_id = p_id
     ORDER BY m.criado_em
$$;

DROP FUNCTION IF EXISTS sa_chamado(uuid);
CREATE FUNCTION sa_chamado(p_id uuid)
RETURNS TABLE (
    id uuid, numero int, empresa text, assunto text, categoria text,
    prioridade text, status text, criado_por_nome text, criado_em timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT c.id, c.numero, e.razao_social, c.assunto, c.categoria,
           c.prioridade, c.status, c.criado_por_nome, c.criado_em
      FROM chamado c JOIN empresa e ON e.id = c.empresa_id
     WHERE c.id = p_id
$$;

-- Responder como suporte (marca aguardando_cliente se estava aberto/em_atendimento)
DROP FUNCTION IF EXISTS sa_responder_chamado(uuid, text, text);
CREATE FUNCTION sa_responder_chamado(p_id uuid, p_autor text, p_msg text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    INSERT INTO chamado_mensagem (chamado_id, empresa_id, autor_tipo, autor_nome, mensagem)
    SELECT c.id, c.empresa_id, 'suporte', p_autor, p_msg
      FROM chamado c WHERE c.id = p_id;
    UPDATE chamado SET atualizado_em = now(),
           status = CASE WHEN status IN ('aberto','em_atendimento')
                         THEN 'aguardando_cliente' ELSE status END
     WHERE id = p_id;
END $$;

-- Mudar status/prioridade
DROP FUNCTION IF EXISTS sa_status_chamado(uuid, text, text);
CREATE FUNCTION sa_status_chamado(p_id uuid, p_status text, p_prioridade text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    UPDATE chamado SET
        status = COALESCE(p_status, status),
        prioridade = COALESCE(p_prioridade, prioridade),
        atualizado_em = now(),
        fechado_em = CASE WHEN p_status IN ('resolvido','fechado')
                          THEN now() ELSE fechado_em END
     WHERE id = p_id
$$;

-- Contagem para o badge do painel
DROP FUNCTION IF EXISTS sa_chamados_abertos();
CREATE FUNCTION sa_chamados_abertos()
RETURNS int
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT count(*)::int FROM chamado
     WHERE status IN ('aberto','em_atendimento')
$$;

SELECT 'sistema de chamados (helpdesk) adicionado' AS resultado;
