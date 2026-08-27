-- 99: log de logins passa a mostrar o E-MAIL DIGITADO tambem quando o
--     usuario nao existe (tentativa com e-mail nao cadastrado).
--     Mesmo tipo de retorno -> CREATE OR REPLACE (mantem os GRANTs).
CREATE OR REPLACE FUNCTION public.sa_logins(
    p_busca text DEFAULT NULL::text, p_empresa uuid DEFAULT NULL::uuid,
    p_papel text DEFAULT NULL::text, p_resultado text DEFAULT NULL::text,
    p_de timestamp with time zone DEFAULT NULL::timestamp with time zone,
    p_ate timestamp with time zone DEFAULT NULL::timestamp with time zone,
    p_limite integer DEFAULT 300)
 RETURNS TABLE(id bigint, ocorrido_em timestamp with time zone, acao text,
               ip text, detalhe jsonb, usuario_id uuid, nome text, email text,
               papel text, usuario_ativo boolean, empresa text, empresa_status text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT
        la.id, la.criado_em, la.acao, la.ip_origem, la.dados_depois,
        u.id, u.nome,
        -- e-mail do cadastro OU, se o usuario nao existe, o que foi digitado
        COALESCE(u.email, lower(NULLIF(trim(la.dados_depois->>'email'), ''))),
        u.papel, u.ativo,
        e.razao_social, e.status
      FROM log_auditoria la
      LEFT JOIN usuario u ON u.id = la.usuario_id
      LEFT JOIN empresa e ON e.id = la.empresa_id
     WHERE la.acao IN ('login_ok', 'login_falha', 'login_bloqueado')
       AND (p_busca     IS NULL OR u.email ILIKE '%' || p_busca || '%'
                                 OR u.nome  ILIKE '%' || p_busca || '%'
                                 -- busca tambem no e-mail digitado
                                 OR la.dados_depois->>'email' ILIKE '%' || p_busca || '%')
       AND (p_empresa   IS NULL OR la.empresa_id = p_empresa)
       AND (p_papel     IS NULL OR u.papel = p_papel)
       AND (p_resultado IS NULL OR la.acao = p_resultado)
       AND (p_de        IS NULL OR la.criado_em >= p_de)
       AND (p_ate       IS NULL OR la.criado_em <= p_ate)
     ORDER BY la.criado_em DESC
     LIMIT p_limite
$function$;
