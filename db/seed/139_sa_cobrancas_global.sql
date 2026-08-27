-- Financeiro global do SA: consulta cross-empresa precisa de SECURITY DEFINER
-- (a query direta em cobranca voltava vazia por RLS). Devolve jsonb para o
-- endpoint repassar sem depender dos tipos exatos das colunas. Joao, 20/08/2026.
CREATE OR REPLACE FUNCTION public.sa_cobrancas_global(
    p_de date DEFAULT NULL, p_ate date DEFAULT NULL,
    p_empresa uuid DEFAULT NULL, p_por_pagamento boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.vencimento, x.empresa), '[]'::jsonb)
      FROM (
        SELECT cb.id, cb.competencia, cb.vencimento, cb.valor, cb.status,
               cb.pago_em, cb.observacao, cb.emitida_em, cb.documento,
               cb.forma_pagamento, cb.banco, cb.valor_pago,
               e.razao_social AS empresa, e.id AS empresa_id,
               ct.descricao AS contrato_descricao, ct.plano
          FROM cobranca cb
          JOIN empresa e ON e.id = cb.empresa_id
          JOIN contrato ct ON ct.id = cb.contrato_id
         WHERE (p_de IS NULL OR
                (CASE WHEN p_por_pagamento THEN cb.pago_em ELSE cb.vencimento END) >= p_de)
           AND (p_ate IS NULL OR
                (CASE WHEN p_por_pagamento THEN cb.pago_em ELSE cb.vencimento END) <= p_ate)
           AND (p_empresa IS NULL OR cb.empresa_id = p_empresa)
      ) x
$function$;
GRANT EXECUTE ON FUNCTION public.sa_cobrancas_global(date, date, uuid, boolean) TO certsaas, api_app;
