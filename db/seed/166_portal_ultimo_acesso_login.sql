-- ═══════════════════════════════════════════════════════════
-- 166 · cliente_buscar_acesso passa a devolver ultimo_acesso —
-- usado no /login pra mandar pro front o "último acesso ANTERIOR"
-- (antes de cliente_marcar_acesso atualizar pra agora), base do
-- aviso "novos certificados desde sua última visita".
-- ═══════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.cliente_buscar_acesso(text);

CREATE FUNCTION public.cliente_buscar_acesso(p_email text)
 RETURNS TABLE(id uuid, documento text, email text, nome text, senha_hash text, ativo boolean, email_validado boolean, ultimo_acesso timestamptz)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT id, documento, email, nome, senha_hash, ativo, email_validado, ultimo_acesso
      FROM cliente_acesso WHERE lower(email) = lower(p_email) LIMIT 1
$function$;

SELECT 'cliente_buscar_acesso agora traz ultimo_acesso' AS resultado;
