-- 120: o cliente pede a calibracao pelo proprio portal.
-- Fecha o ciclo: ele ve "vence em 25 dias" e pede a visita em 2 cliques.
CREATE TABLE IF NOT EXISTS solicitacao_calibracao (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id    uuid NOT NULL REFERENCES empresa(id),
    cliente_id    uuid REFERENCES cliente(id),
    documento     text NOT NULL,
    solicitante   text,                    -- e-mail de quem pediu (login do portal)
    balancas      text,                    -- identificacoes, separadas por virgula
    mensagem      text,
    situacao      text NOT NULL DEFAULT 'aberta'
                  CHECK (situacao IN ('aberta', 'em_andamento', 'concluida', 'cancelada')),
    criado_em     timestamptz NOT NULL DEFAULT now(),
    atendido_em   timestamptz,
    atendido_por  uuid REFERENCES usuario(id),
    observacao_interna text
);
CREATE INDEX IF NOT EXISTS idx_solic_empresa ON solicitacao_calibracao(empresa_id, situacao, criado_em DESC);

ALTER TABLE solicitacao_calibracao ENABLE ROW LEVEL SECURITY;
ALTER TABLE solicitacao_calibracao FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON solicitacao_calibracao;
CREATE POLICY tenant_isolation ON solicitacao_calibracao
    USING (empresa_id = current_empresa_id())
    WITH CHECK (empresa_id = current_empresa_id());

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'api_app') THEN
        GRANT SELECT, INSERT, UPDATE ON TABLE solicitacao_calibracao TO api_app;
    END IF;
END $$;

-- Cria a solicitacao a partir do PORTAL (fora do RLS: o portal nao tem empresa
-- no contexto). Devolve uma linha por EMPRESA envolvida, com quem avisar.
CREATE OR REPLACE FUNCTION public.portal_solicitar_calibracao(
    p_documento text, p_solicitante text, p_balancas text, p_mensagem text)
 RETURNS TABLE(empresa_id uuid, empresa text, cliente text, solicitacao_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    r record;
    v_id uuid;
BEGIN
    FOR r IN
        SELECT DISTINCT c.empresa_id, c.id AS cliente_id, c.razao_social,
               e.razao_social AS emp
          FROM cliente c JOIN empresa e ON e.id = c.empresa_id
         WHERE so_digitos(c.cnpj) = so_digitos(p_documento)
           AND c.ativo AND e.status = 'ativa'
    LOOP
        INSERT INTO solicitacao_calibracao
            (empresa_id, cliente_id, documento, solicitante, balancas, mensagem)
        VALUES (r.empresa_id, r.cliente_id, so_digitos(p_documento),
                p_solicitante, NULLIF(trim(p_balancas), ''), NULLIF(trim(p_mensagem), ''))
        RETURNING id INTO v_id;
        RETURN QUERY SELECT r.empresa_id, r.emp, r.razao_social, v_id;
    END LOOP;
END;
$function$;

-- Lista para a EMPRESA (roda no tenant, RLS protege)
CREATE OR REPLACE FUNCTION public.solicitacoes_abertas()
 RETURNS TABLE(id uuid, cliente text, solicitante text, balancas text,
               mensagem text, criado_em timestamptz, dias integer,
               telefone text, email_cliente text, cidade text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
    SELECT s.id, coalesce(c.razao_social, '(cliente removido)'), s.solicitante,
           s.balancas, s.mensagem, s.criado_em,
           (current_date - s.criado_em::date)::int,
           c.telefone, c.email, c.cidade
      FROM solicitacao_calibracao s
      LEFT JOIN cliente c ON c.id = s.cliente_id
     WHERE s.situacao = 'aberta'
     ORDER BY s.criado_em;
$function$;

CREATE OR REPLACE FUNCTION public.solicitacao_atender(p_id uuid, p_usuario uuid,
                                                      p_situacao text, p_obs text)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
    UPDATE solicitacao_calibracao
       SET situacao = CASE WHEN p_situacao IN ('em_andamento','concluida','cancelada')
                           THEN p_situacao ELSE 'concluida' END,
           atendido_em = now(), atendido_por = p_usuario,
           observacao_interna = NULLIF(trim(p_obs), '')
     WHERE id = p_id AND situacao = 'aberta'
     RETURNING true;
$function$;
