-- sa_resumo: + receita_ano (cobrancas PAGAS no ano corrente). Receita do mes
-- e do ano passam a somar o VALOR PAGO real quando informado (fallback no
-- valor da cobranca). Joao, 22/08/2026.
DROP FUNCTION IF EXISTS public.sa_resumo();
CREATE FUNCTION public.sa_resumo()
 RETURNS TABLE(total_empresas bigint, empresas_ativas bigint, empresas_suspensas bigint,
               total_certificados bigint, receita_mes numeric, inadimplencia numeric,
               rascunhos bigint, aguardando bigint,
               certs_hoje bigint, empresas_hoje bigint, certs_7d bigint,
               receita_ano numeric)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT
        (SELECT count(*) FROM empresa),
        (SELECT count(*) FROM empresa WHERE status = 'ativa'),
        (SELECT count(*) FROM empresa WHERE status = 'suspensa'),
        (SELECT count(*) FROM certificado WHERE status = 'emitido'),
        (SELECT COALESCE(sum(COALESCE(valor_pago, valor)),0) FROM cobranca
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
            AND data_emissao >= current_date - interval '6 days'),
        (SELECT COALESCE(sum(COALESCE(valor_pago, valor)),0) FROM cobranca
          WHERE status = 'pago' AND date_trunc('year', pago_em) = date_trunc('year', current_date))
$function$;
GRANT EXECUTE ON FUNCTION public.sa_resumo() TO certsaas, api_app;
