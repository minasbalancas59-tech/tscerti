-- 103: portal do cliente final disponivel a partir do plano PROFISSIONAL.
-- Flag por empresa (permite excecao manual do super-admin) alimentada pelo
-- plano do contrato ativo. Empresa em avaliacao (sem contrato) TEM portal:
-- ela precisa conhecer o recurso para querer contrata-lo.

ALTER TABLE empresa ADD COLUMN IF NOT EXISTS portal_cliente_ativo boolean NOT NULL DEFAULT true;

-- Recalcula a flag pelo plano do contrato ativo (essencial = sem portal)
CREATE OR REPLACE FUNCTION public.empresa_portal_por_plano(p_empresa uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    UPDATE empresa e
       SET portal_cliente_ativo = COALESCE(
           (SELECT c.plano IS DISTINCT FROM 'essencial'
              FROM contrato c
             WHERE c.empresa_id = e.id AND c.ativo
             ORDER BY c.criado_em DESC LIMIT 1), true)
     WHERE e.id = p_empresa
     RETURNING portal_cliente_ativo;
$function$;

-- Aplica a regra a todas as empresas existentes
SELECT empresa_portal_por_plano(id) FROM empresa;

-- O e-mail/documento tem portal em ALGUMA empresa? (usado no autocadastro)
CREATE OR REPLACE FUNCTION public.cliente_portal_disponivel(p_email text, p_doc text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM cliente c
          JOIN empresa e ON e.id = c.empresa_id
         WHERE lower(trim(c.email)) = lower(trim(p_email))
           AND regexp_replace(COALESCE(c.cnpj, ''), '\D', '', 'g')
             = regexp_replace(COALESCE(p_doc, ''), '\D', '', 'g')
           AND e.portal_cliente_ativo);
$function$;

-- Super-admin liga/desliga manualmente (excecao comercial)
CREATE OR REPLACE FUNCTION public.sa_portal_empresa(p_empresa uuid, p_ativo boolean)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    UPDATE empresa SET portal_cliente_ativo = p_ativo
     WHERE id = p_empresa RETURNING portal_cliente_ativo;
$function$;

-- sa_dados_contrato passa a devolver a flag
DROP FUNCTION IF EXISTS public.sa_dados_contrato(uuid);
CREATE FUNCTION public.sa_dados_contrato(p_empresa uuid)
 RETURNS TABLE(razao_social text, cnpj text, endereco text, cep text, cidade_uf text,
               telefone text, email text, rep_legal_nome text, rep_legal_cpf text,
               dias_carencia_contrato integer, liberado_ate date,
               portal_cliente_ativo boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT razao_social, cnpj, endereco, cep, cidade_uf, telefone, email,
           rep_legal_nome, rep_legal_cpf, dias_carencia_contrato, liberado_ate,
           portal_cliente_ativo
      FROM empresa WHERE id = p_empresa;
$function$;
