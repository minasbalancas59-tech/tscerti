-- 98: detalhe do usuario para o super-admin (botao "👤 Ver" do log de logins)
--     A funcao ja existia com outro retorno -> DROP antes do CREATE.
--     SECURITY DEFINER: o super-admin consulta usuario de QUALQUER empresa,
--     entao a funcao precisa rodar fora do RLS.
DROP FUNCTION IF EXISTS public.sa_usuario_detalhe(uuid);

CREATE FUNCTION public.sa_usuario_detalhe(p_id uuid)
 RETURNS TABLE(nome text, email text, papel text, ativo boolean,
               empresa text, empresa_cnpj text, empresa_status text,
               criado_em timestamptz, ultimo_login timestamptz,
               total_logins bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT u.nome, u.email, u.papel, u.ativo,
           e.razao_social, e.cnpj, e.status,
           u.criado_em,
           (SELECT max(la.criado_em) FROM log_auditoria la
             WHERE la.usuario_id = u.id AND la.acao = 'login_ok'),
           (SELECT count(*) FROM log_auditoria la
             WHERE la.usuario_id = u.id AND la.acao = 'login_ok')
      FROM usuario u
      LEFT JOIN empresa e ON e.id = u.empresa_id
     WHERE u.id = p_id;
$function$;
