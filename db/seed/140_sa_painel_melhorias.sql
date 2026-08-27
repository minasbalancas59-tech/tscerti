-- Painel SA: plano vem do CONTRATO ativo (Imperium mostrava trial do cadastro),
-- coluna ultima_emissao na lista, e sa_resumo ganha rascunhos/aguardando
-- (o front lia campos que nao existiam — sempre 0) + emissoes de hoje/7 dias.
-- Joao, 22/08/2026.

DROP FUNCTION IF EXISTS public.sa_listar_empresas();
CREATE FUNCTION public.sa_listar_empresas()
 RETURNS TABLE(id uuid, razao_social text, cnpj text, plano text, status text,
               limite_usuarios integer, qtd_usuarios bigint, qtd_certificados bigint,
               criado_em timestamp with time zone, cobrancas_pendentes bigint,
               ultima_emissao timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT e.id, e.razao_social, e.cnpj,
           -- Fonte da verdade do plano: contrato ATIVO mais recente; cai no
           -- campo do cadastro quando a empresa nao tem contrato.
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
             WHERE c2.empresa_id = e.id AND c2.status IN ('emitido','substituido'))
      FROM empresa e
     ORDER BY e.razao_social
$function$;
GRANT EXECUTE ON FUNCTION public.sa_listar_empresas() TO certsaas, api_app;

DROP FUNCTION IF EXISTS public.sa_resumo();
CREATE FUNCTION public.sa_resumo()
 RETURNS TABLE(total_empresas bigint, empresas_ativas bigint, empresas_suspensas bigint,
               total_certificados bigint, receita_mes numeric, inadimplencia numeric,
               rascunhos bigint, aguardando bigint,
               certs_hoje bigint, empresas_hoje bigint, certs_7d bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT
        (SELECT count(*) FROM empresa),
        (SELECT count(*) FROM empresa WHERE status = 'ativa'),
        (SELECT count(*) FROM empresa WHERE status = 'suspensa'),
        (SELECT count(*) FROM certificado WHERE status = 'emitido'),
        (SELECT COALESCE(sum(valor),0) FROM cobranca
          WHERE status = 'pago' AND date_trunc('month', pago_em) = date_trunc('month', current_date)),
        (SELECT COALESCE(sum(valor),0) FROM cobranca WHERE status IN ('pendente','vencido')),
        (SELECT count(*) FROM certificado WHERE status = 'rascunho'),
        (SELECT count(*) FROM certificado WHERE status = 'aguardando_aprovacao'),
        (SELECT count(*) FROM certificado
          WHERE status IN ('emitido','substituido') AND data_emissao::date = current_date),
        (SELECT count(DISTINCT empresa_id) FROM certificado
          WHERE status IN ('emitido','substituido') AND data_emissao::date = current_date),
        (SELECT count(*) FROM certificado
          WHERE status IN ('emitido','substituido')
            AND data_emissao >= current_date - interval '6 days')
$function$;
GRANT EXECUTE ON FUNCTION public.sa_resumo() TO certsaas, api_app;
