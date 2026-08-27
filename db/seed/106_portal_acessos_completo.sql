-- 106: visao completa dos acessos do portal para o super-admin — mostra
--      QUAIS CLIENTES FINAIS estao por tras de cada login, de quais empresas
--      eles sao clientes, e o volume (balancas/certificados).
--      O portal liga o acesso ao cliente pelo DOCUMENTO (CNPJ/CPF em digitos).
CREATE OR REPLACE FUNCTION public.sa_portal_acessos_completo()
 RETURNS TABLE(email text, nome text, documento text, email_validado boolean,
               ativo boolean, criado_em timestamptz, ultimo_acesso timestamptz,
               clientes text, empresas text, balancas bigint, certificados bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT a.email, a.nome, a.documento, a.email_validado, a.ativo,
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
