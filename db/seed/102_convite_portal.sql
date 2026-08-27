-- 102: CONVITE ao portal do cliente final.
-- A empresa convida o cliente (em vez de esperar o autocadastro): o link vai
-- para o e-mail JA cadastrado do cliente, entao ao definir a senha o acesso
-- ja nasce com o e-mail VALIDADO (a posse do e-mail foi provada na entrega).

CREATE TABLE IF NOT EXISTS cliente_convite (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id  uuid NOT NULL REFERENCES empresa(id),
    cliente_id  uuid NOT NULL REFERENCES cliente(id) ON DELETE CASCADE,
    email       text NOT NULL,
    documento   text NOT NULL,
    token       text NOT NULL UNIQUE,
    expira_em   timestamptz NOT NULL,
    criado_em   timestamptz NOT NULL DEFAULT now(),
    criado_por  uuid REFERENCES usuario(id),
    usado_em    timestamptz
);
CREATE INDEX IF NOT EXISTS idx_cliente_convite_cli ON cliente_convite(cliente_id);

ALTER TABLE cliente_convite ENABLE ROW LEVEL SECURITY;
ALTER TABLE cliente_convite FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON cliente_convite;
CREATE POLICY tenant_isolation ON cliente_convite
    USING (empresa_id = current_empresa_id())
    WITH CHECK (empresa_id = current_empresa_id());

-- permissoes para o usuario da API (o mesmo padrao das demais tabelas)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'api_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE cliente_convite TO api_app;
    END IF;
END $$;

-- ── Empresa cria o convite (roda na conexao do tenant: RLS protege) ──
CREATE OR REPLACE FUNCTION public.cliente_convite_criar(p_cliente uuid, p_usuario uuid)
 RETURNS TABLE(token text, email text, nome text, ja_tem_acesso boolean)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
    v_cli   record;
    v_token text;
BEGIN
    SELECT c.id, c.empresa_id, c.email, c.cnpj, c.razao_social
      INTO v_cli
      FROM cliente c WHERE c.id = p_cliente;      -- RLS: so a propria empresa
    IF v_cli.id IS NULL THEN
        RAISE EXCEPTION 'Cliente nao encontrado.';
    END IF;
    IF COALESCE(trim(v_cli.email), '') = '' THEN
        RAISE EXCEPTION 'Cadastre o e-mail do cliente antes de convidar.';
    END IF;
    IF COALESCE(trim(v_cli.cnpj), '') = '' THEN
        RAISE EXCEPTION 'Cadastre o CNPJ/CPF do cliente antes de convidar.';
    END IF;

    v_token := encode(gen_random_bytes(24), 'hex');

    -- um convite valido por cliente: descarta os anteriores nao usados
    DELETE FROM cliente_convite
     WHERE cliente_id = p_cliente AND usado_em IS NULL;

    INSERT INTO cliente_convite (empresa_id, cliente_id, email, documento,
                                 token, expira_em, criado_por)
    VALUES (v_cli.empresa_id, p_cliente, lower(trim(v_cli.email)),
            regexp_replace(v_cli.cnpj, '\D', '', 'g'),
            v_token, now() + interval '3 days', p_usuario);

    RETURN QUERY SELECT v_token, lower(trim(v_cli.email)), v_cli.razao_social,
        EXISTS(SELECT 1 FROM cliente_acesso a
                WHERE lower(a.email) = lower(trim(v_cli.email)));
END;
$function$;

-- ── Portal le o convite pelo token (publico, fora do RLS) ──
CREATE OR REPLACE FUNCTION public.cliente_convite_ver(p_token text)
 RETURNS TABLE(email text, nome text, documento text, empresa text,
               valido boolean, ja_tem_acesso boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT cv.email, c.razao_social, cv.documento, e.razao_social,
           (cv.usado_em IS NULL AND cv.expira_em > now()),
           EXISTS(SELECT 1 FROM cliente_acesso a WHERE lower(a.email) = lower(cv.email))
      FROM cliente_convite cv
      JOIN cliente c ON c.id = cv.cliente_id
      JOIN empresa e ON e.id = cv.empresa_id
     WHERE cv.token = p_token;
$function$;

-- ── Portal usa o convite: cria o acesso JA VALIDADO ──
CREATE OR REPLACE FUNCTION public.cliente_convite_usar(p_token text, p_hash text,
                                                       p_nome text DEFAULT NULL)
 RETURNS TABLE(ok boolean, email text, erro text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_cv record;
BEGIN
    SELECT * INTO v_cv FROM cliente_convite WHERE token = p_token;
    IF v_cv.id IS NULL THEN
        RETURN QUERY SELECT false, NULL::text, 'Convite invalido.'; RETURN;
    END IF;
    IF v_cv.usado_em IS NOT NULL THEN
        RETURN QUERY SELECT false, v_cv.email, 'Este convite ja foi usado.'; RETURN;
    END IF;
    IF v_cv.expira_em <= now() THEN
        RETURN QUERY SELECT false, v_cv.email, 'Convite expirado. Peca um novo a empresa.'; RETURN;
    END IF;
    IF EXISTS(SELECT 1 FROM cliente_acesso a WHERE lower(a.email) = lower(v_cv.email)) THEN
        RETURN QUERY SELECT false, v_cv.email,
            'Ja existe acesso com este e-mail. Entre normalmente ou use "Esqueci minha senha".';
        RETURN;
    END IF;

    INSERT INTO cliente_acesso (documento, email, nome, senha_hash,
                                ativo, email_validado)
    VALUES (v_cv.documento, lower(v_cv.email),
            COALESCE(NULLIF(trim(p_nome), ''), (SELECT razao_social FROM cliente WHERE id = v_cv.cliente_id)),
            p_hash, true, true);   -- validado: o convite chegou no e-mail dele

    UPDATE cliente_convite SET usado_em = now() WHERE id = v_cv.id;

    RETURN QUERY SELECT true, lower(v_cv.email), NULL::text;
END;
$function$;
