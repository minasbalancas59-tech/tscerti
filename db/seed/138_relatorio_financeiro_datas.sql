-- Relatorio financeiro SA: filtro de datas passa a considerar VENCIMENTO
-- ou PAGAMENTO dentro do periodo (antes usava competencia, que e sempre
-- dia 01 — um intervalo no meio do mes voltava vazio). Joao, 20/08/2026.
CREATE OR REPLACE FUNCTION public.sa_relatorio_financeiro(
    p_de date DEFAULT NULL::date, p_ate date DEFAULT NULL::date,
    p_status text DEFAULT NULL::text)
 RETURNS TABLE(empresa text, contrato text, competencia date, vencimento date,
               valor numeric, status text, pago_em date, observacao text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT e.razao_social, ct.descricao, cb.competencia, cb.vencimento,
           cb.valor, cb.status, cb.pago_em, cb.observacao
      FROM cobranca cb
      JOIN contrato ct ON ct.id = cb.contrato_id
      JOIN empresa  e  ON e.id = cb.empresa_id
     WHERE ((p_de IS NULL AND p_ate IS NULL)
            OR cb.vencimento BETWEEN COALESCE(p_de, '-infinity'::date)
                                 AND COALESCE(p_ate, 'infinity'::date)
            OR cb.pago_em    BETWEEN COALESCE(p_de, '-infinity'::date)
                                 AND COALESCE(p_ate, 'infinity'::date))
       AND (p_status IS NULL OR cb.status = p_status)
     ORDER BY cb.vencimento DESC, e.razao_social
$function$;
