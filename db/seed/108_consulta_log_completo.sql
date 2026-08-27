-- 108: FIX + enriquecimento do log de consultas por QR code.
--
-- CAUSA DO "—" NA TELA: sa_consulta_log NAO era SECURITY DEFINER. Ela roda
-- com RLS ativo; o super-admin nao tem empresa no contexto, entao os
-- LEFT JOIN para empresa/cliente/certificado devolviam NULL — mesmo com os
-- dados corretamente gravados (44 de 52 registros tinham certificado_id).
-- (Licao recorrente do projeto: funcao que le dados de outra empresa precisa
-- de SECURITY DEFINER.)
--
-- Alem do fix, a funcao passa a devolver: status do certificado, balanca,
-- codigo consultado (uuid_validacao), user_agent e a marca de "encontrado".
DROP FUNCTION IF EXISTS public.sa_consulta_log(uuid, uuid, timestamptz, timestamptz);

CREATE FUNCTION public.sa_consulta_log(p_empresa uuid, p_cliente uuid,
                                       p_de timestamptz, p_ate timestamptz)
 RETURNS TABLE(id uuid, empresa text, cliente text, certificado_numero text,
               certificado_status text, balanca text, uuid_validacao uuid,
               origem text, ip text, user_agent text, encontrado boolean,
               consultado_em timestamptz)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT cc.id, e.razao_social, c.razao_social, ct.numero, ct.status,
           b.identificacao, cc.uuid_validacao,
           cc.origem, cc.ip, cc.user_agent,
           cc.certificado_id IS NOT NULL,
           cc.consultado_em
      FROM consulta_certificado cc
      LEFT JOIN empresa e      ON e.id  = cc.empresa_id
      LEFT JOIN cliente c      ON c.id  = cc.cliente_id
      LEFT JOIN certificado ct ON ct.id = cc.certificado_id
      LEFT JOIN balanca b      ON b.id  = ct.balanca_id
     WHERE (p_empresa IS NULL OR cc.empresa_id = p_empresa)
       AND (p_cliente IS NULL OR cc.cliente_id = p_cliente)
       AND (p_de  IS NULL OR cc.consultado_em >= p_de)
       AND (p_ate IS NULL OR cc.consultado_em <  p_ate)
     ORDER BY cc.consultado_em DESC
     LIMIT 500;
$function$;
