-- Lista de empresas do SA: + nome_fantasia (exibicao e busca) e
-- dias_avaliacao (dias desde o cadastro, para o badge de trial nas
-- empresas sem contrato ativo). Joao, 22/08/2026.
DROP FUNCTION IF EXISTS public.sa_listar_empresas();
CREATE FUNCTION public.sa_listar_empresas()
 RETURNS TABLE(id uuid, razao_social text, cnpj text, plano text, status text,
               limite_usuarios integer, qtd_usuarios bigint, qtd_certificados bigint,
               criado_em timestamp with time zone, cobrancas_pendentes bigint,
               ultima_emissao timestamp with time zone, cidade_uf text,
               nome_fantasia text, tem_contrato boolean)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT e.id, e.razao_social, e.cnpj,
           COALESCE((SELECT ct.plano FROM contrato ct
                      WHERE ct.empresa_id = e.id AND ct.ativo
                      ORDER BY ct.inicio DESC LIMIT 1), e.plano) AS plano,
           e.status, e.limite_usuarios,
           (SELECT count(*) FROM usuario u WHERE u.empresa_id = e.id AND u.ativo),
           (SELECT count(*) FROM certificado c WHERE c.empresa_id = e.id AND c.status = 'emitido'),
           e.criado_em,
           (SELECT count(*) FROM cobranca cb WHERE cb.empresa_id = e.id
              AND cb.status IN ('pendente','vencido')),
           (SELECT max(c2.data_emissao) FROM certificado c2
             WHERE c2.empresa_id = e.id AND c2.status IN ('emitido','substituido')),
           e.cidade_uf, e.nome_fantasia,
           EXISTS(SELECT 1 FROM contrato ct2 WHERE ct2.empresa_id = e.id AND ct2.ativo)
      FROM empresa e
     ORDER BY e.razao_social
$function$;
GRANT EXECUTE ON FUNCTION public.sa_listar_empresas() TO certsaas, api_app;
