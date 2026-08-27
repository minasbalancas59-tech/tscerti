-- 97: visao das tentativas de login para o super-admin
--     (o e-mail tentado ja e gravado no log_auditoria pelo AuthEndpoints)
CREATE OR REPLACE FUNCTION public.sa_tentativas_login(p_limite integer DEFAULT 100)
 RETURNS TABLE(quando timestamptz, email_tentado text, acao text,
               ip text, empresa text, usuario_existe boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT la.criado_em,
           COALESCE(la.dados_depois->>'email', '(não informado)'),
           la.acao,
           COALESCE(la.ip_origem, '—'),
           e.razao_social,
           la.usuario_id IS NOT NULL
      FROM log_auditoria la
      LEFT JOIN empresa e ON e.id = la.empresa_id
     WHERE la.acao IN ('login_falha', 'login_bloqueado')
     ORDER BY la.criado_em DESC
     LIMIT LEAST(p_limite, 500);
$function$;
