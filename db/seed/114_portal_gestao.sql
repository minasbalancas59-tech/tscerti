-- 114: gestao do portal do cliente final
--   (a) convite para QUALQUER contato cadastrado do cliente
--   (b) reenvio do link de validacao (autoatendimento)
--   (c) diagnostico das tentativas de acesso para o super-admin

-- ── (a) convite por e-mail escolhido (principal ou um dos contatos) ──
CREATE OR REPLACE FUNCTION public.cliente_contatos_portal(p_cliente uuid)
 RETURNS TABLE(email text, nome text, cargo text, origem text,
               ja_tem_acesso boolean, convite_pendente boolean,
               convite_expira timestamptz)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    WITH cands AS (
        SELECT lower(trim(c.email)) AS email, c.razao_social AS nome,
               'cadastro do cliente'::text AS cargo, 'principal'::text AS origem
          FROM cliente c
         WHERE c.id = p_cliente AND coalesce(trim(c.email), '') <> ''
        UNION
        SELECT lower(trim(ct.email)), ct.nome, coalesce(ct.cargo, ''), 'contato'
          FROM cliente_contato ct
         WHERE ct.cliente_id = p_cliente AND coalesce(trim(ct.email), '') <> ''
    )
    SELECT k.email, k.nome, k.cargo, k.origem,
           EXISTS (SELECT 1 FROM cliente_acesso a WHERE lower(a.email) = k.email),
           EXISTS (SELECT 1 FROM cliente_convite cv
                    WHERE lower(cv.email) = k.email AND cv.usado_em IS NULL
                      AND cv.expira_em > now()),
           (SELECT max(cv.expira_em) FROM cliente_convite cv
             WHERE lower(cv.email) = k.email AND cv.usado_em IS NULL)
      FROM cands k
     ORDER BY (k.origem = 'principal') DESC, k.nome;
$function$;

-- Cria convite para um e-mail especifico do cliente (valida que pertence a ele)
CREATE OR REPLACE FUNCTION public.cliente_convite_criar_para(
    p_cliente uuid, p_email text, p_usuario uuid)
 RETURNS TABLE(token text, email text, nome text, ja_tem_acesso boolean)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
    v_cli   record;
    v_email text := lower(trim(p_email));
    v_nome  text;
    v_token text;
BEGIN
    SELECT c.id, c.empresa_id, c.cnpj, c.razao_social, lower(trim(c.email)) AS email
      INTO v_cli FROM cliente c WHERE c.id = p_cliente;   -- RLS protege
    IF v_cli.id IS NULL THEN RAISE EXCEPTION 'Cliente nao encontrado.'; END IF;
    IF coalesce(trim(v_cli.cnpj), '') = '' THEN
        RAISE EXCEPTION 'Cadastre o CNPJ/CPF do cliente antes de convidar.';
    END IF;

    -- o e-mail precisa ser o principal OU um contato cadastrado deste cliente
    IF v_email = v_cli.email THEN
        v_nome := v_cli.razao_social;
    ELSE
        SELECT ct.nome INTO v_nome FROM cliente_contato ct
         WHERE ct.cliente_id = p_cliente AND lower(trim(ct.email)) = v_email
         LIMIT 1;
        IF v_nome IS NULL THEN
            RAISE EXCEPTION 'Este e-mail nao esta no cadastro do cliente.';
        END IF;
    END IF;

    v_token := encode(gen_random_bytes(24), 'hex');
    DELETE FROM cliente_convite
     WHERE cliente_id = p_cliente AND lower(email) = v_email AND usado_em IS NULL;
    INSERT INTO cliente_convite (empresa_id, cliente_id, email, documento,
                                 token, expira_em, criado_por)
    VALUES (v_cli.empresa_id, p_cliente, v_email,
            regexp_replace(v_cli.cnpj, '\D', '', 'g'),
            v_token, now() + interval '7 days', p_usuario);

    RETURN QUERY SELECT v_token, v_email, v_nome,
        EXISTS (SELECT 1 FROM cliente_acesso a WHERE lower(a.email) = v_email);
END;
$function$;

-- ── (b) reenvio do link de validacao (quando a conta existe mas nao validou)
CREATE OR REPLACE FUNCTION public.cliente_novo_token_validacao(p_email text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_token text;
BEGIN
    SELECT encode(gen_random_bytes(24), 'hex') INTO v_token;
    UPDATE cliente_acesso
       SET token_validacao = v_token, token_expira = now() + interval '3 days'
     WHERE lower(email) = lower(trim(p_email)) AND ativo AND NOT email_validado;
    IF NOT FOUND THEN RETURN NULL; END IF;   -- nao existe ou ja validou
    RETURN v_token;
END;
$function$;

-- ── (c) diagnostico para o super-admin ─────────────────────
CREATE OR REPLACE FUNCTION public.sa_portal_diagnostico(p_dias integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH base AS (
    SELECT l.*, coalesce(l.detalhe, '(sem detalhe)') AS motivo
      FROM cliente_acesso_log l
     WHERE l.ocorrido_em >= now() - make_interval(days => p_dias)
),
resumo AS (
    SELECT count(*) FILTER (WHERE evento = 'login')        AS logins,
           count(*) FILTER (WHERE evento = 'login_falha')  AS falhas,
           count(*) FILTER (WHERE evento = 'cadastro')     AS cadastros,
           count(*) FILTER (WHERE evento = 'validacao')    AS validacoes,
           count(DISTINCT email)                           AS pessoas
      FROM base
),
por_motivo AS (
    SELECT evento, motivo, count(*) AS qtd,
           count(DISTINCT email) AS pessoas, max(ocorrido_em) AS ultimo
      FROM base WHERE evento <> 'login'
     GROUP BY 1, 2 ORDER BY count(*) DESC LIMIT 20
),
recentes AS (
    SELECT ocorrido_em, email, evento, motivo, ip
      FROM base ORDER BY ocorrido_em DESC LIMIT 60
),
contas AS (
    SELECT count(*) AS total,
           count(*) FILTER (WHERE NOT email_validado) AS nao_validadas,
           count(*) FILTER (WHERE NOT ativo) AS desativadas,
           count(*) FILTER (WHERE ultimo_acesso IS NULL) AS nunca_entraram
      FROM cliente_acesso
),
convites AS (
    SELECT count(*) FILTER (WHERE usado_em IS NULL AND expira_em > now()) AS pendentes,
           count(*) FILTER (WHERE usado_em IS NULL AND expira_em <= now()) AS expirados,
           count(*) FILTER (WHERE usado_em IS NOT NULL) AS usados
      FROM cliente_convite
)
SELECT jsonb_build_object(
  'dias', p_dias,
  'resumo', (SELECT to_jsonb(r) FROM resumo r),
  'contas', (SELECT to_jsonb(c) FROM contas c),
  'convites', (SELECT to_jsonb(v) FROM convites v),
  'por_motivo', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM por_motivo x), '[]'::jsonb),
  'recentes', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM recentes x), '[]'::jsonb));
$function$;

-- Acesso do portal por id, para o super-admin abrir "como o cliente"
CREATE OR REPLACE FUNCTION public.sa_portal_acesso(p_id uuid)
 RETURNS TABLE(id uuid, email text, nome text, documento text,
               ativo boolean, email_validado boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT id, email, nome, documento, ativo, email_validado
      FROM cliente_acesso WHERE id = p_id;
$function$;

-- A lista de acessos precisa devolver o ID (para o botao "ver como cliente")
DROP FUNCTION IF EXISTS public.sa_portal_acessos_completo();
CREATE FUNCTION public.sa_portal_acessos_completo()
 RETURNS TABLE(id uuid, email text, nome text, documento text, email_validado boolean,
               ativo boolean, criado_em timestamptz, ultimo_acesso timestamptz,
               clientes text, empresas text, balancas bigint, certificados bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT a.id, a.email, a.nome, a.documento, a.email_validado, a.ativo,
           a.criado_em, a.ultimo_acesso,
           (SELECT string_agg(DISTINCT c.razao_social, ' · ')
              FROM cliente c
             WHERE regexp_replace(COALESCE(c.cnpj, ''), '\D', '', 'g') = a.documento),
           (SELECT string_agg(DISTINCT e.razao_social, ' · ')
              FROM cliente c JOIN empresa e ON e.id = c.empresa_id
             WHERE regexp_replace(COALESCE(c.cnpj, ''), '\D', '', 'g') = a.documento),
           (SELECT count(*) FROM balanca b JOIN cliente c ON c.id = b.cliente_id
             WHERE regexp_replace(COALESCE(c.cnpj, ''), '\D', '', 'g') = a.documento),
           (SELECT count(*) FROM certificado ct JOIN cliente c ON c.id = ct.cliente_id
             WHERE regexp_replace(COALESCE(c.cnpj, ''), '\D', '', 'g') = a.documento
               AND ct.status = 'emitido')
      FROM cliente_acesso a
     ORDER BY a.ultimo_acesso DESC NULLS LAST, a.criado_em DESC;
$function$;

-- Dados minimos do cliente para o super-admin abrir o portal dele
CREATE OR REPLACE FUNCTION public.sa_cliente_para_portal(p_cliente uuid)
 RETURNS TABLE(id uuid, empresa_id uuid, razao_social text, email text,
               documento text, certificados bigint, tem_acesso boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT c.id, c.empresa_id, c.razao_social, c.email,
           regexp_replace(COALESCE(c.cnpj, ''), '\D', '', 'g'),
           (SELECT count(*) FROM certificado ct
             WHERE ct.cliente_id = c.id AND ct.status = 'emitido'),
           EXISTS (SELECT 1 FROM cliente_acesso a
                    WHERE a.documento = regexp_replace(COALESCE(c.cnpj, ''), '\D', '', 'g'))
      FROM cliente c WHERE c.id = p_cliente;
$function$;

-- ── Clientes finais AGRUPADOS POR DOCUMENTO ────────────────
-- O portal e unificado por CNPJ/CPF: o mesmo cliente pode ser atendido por
-- varias empresas e ve os certificados de todas. Esta lista reflete isso.
CREATE OR REPLACE FUNCTION public.sa_clientes_documento(p_empresa uuid DEFAULT NULL)
 RETURNS TABLE(documento text, nomes text, empresas text, cadastros integer,
               balancas bigint, certificados bigint, ultimo_cert date,
               tem_acesso boolean, acesso_emails text, ultimo_acesso timestamptz)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    WITH base AS (
        SELECT c.id, c.razao_social, e.razao_social AS emp,
               regexp_replace(COALESCE(c.cnpj, ''), '\D', '', 'g') AS doc
          FROM cliente c
          JOIN empresa e ON e.id = c.empresa_id
         WHERE (p_empresa IS NULL OR c.empresa_id = p_empresa)
           AND COALESCE(trim(c.cnpj), '') <> ''
           AND c.ativo
    ),
    agg AS (
        SELECT doc,
               string_agg(DISTINCT razao_social, ' · ') AS nomes,
               string_agg(DISTINCT emp, ' · ') AS empresas,
               count(*)::int AS cadastros,
               array_agg(id) AS ids
          FROM base GROUP BY doc
    )
    SELECT a.doc, a.nomes, a.empresas, a.cadastros,
           (SELECT count(*) FROM balanca b WHERE b.cliente_id = ANY(a.ids)),
           (SELECT count(*) FROM certificado ct
             WHERE ct.cliente_id = ANY(a.ids) AND ct.status = 'emitido'),
           (SELECT max(ct.data_calibracao)::date FROM certificado ct
             WHERE ct.cliente_id = ANY(a.ids) AND ct.status = 'emitido'),
           EXISTS (SELECT 1 FROM cliente_acesso ca WHERE ca.documento = a.doc),
           (SELECT string_agg(ca.email, ' · ') FROM cliente_acesso ca WHERE ca.documento = a.doc),
           (SELECT max(ca.ultimo_acesso) FROM cliente_acesso ca WHERE ca.documento = a.doc)
      FROM agg a
     ORDER BY a.nomes;
$function$;

-- Dados para abrir o portal a partir do DOCUMENTO
CREATE OR REPLACE FUNCTION public.sa_documento_para_portal(p_doc text)
 RETURNS TABLE(nome text, certificados bigint, empresas text, tem_acesso boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    WITH cli AS (
        SELECT c.id, c.razao_social, e.razao_social AS emp
          FROM cliente c JOIN empresa e ON e.id = c.empresa_id
         WHERE regexp_replace(COALESCE(c.cnpj, ''), '\D', '', 'g')
             = regexp_replace(COALESCE(p_doc, ''), '\D', '', 'g')
    )
    SELECT (SELECT string_agg(DISTINCT razao_social, ' · ') FROM cli),
           (SELECT count(*) FROM certificado ct
             WHERE ct.cliente_id IN (SELECT id FROM cli) AND ct.status = 'emitido'),
           (SELECT string_agg(DISTINCT emp, ' · ') FROM cli),
           EXISTS (SELECT 1 FROM cliente_acesso a
                    WHERE a.documento = regexp_replace(COALESCE(p_doc, ''), '\D', '', 'g'));
$function$;
