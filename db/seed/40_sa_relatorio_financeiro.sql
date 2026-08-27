-- ═══════════════════════════════════════════════════════════
-- 40 · Super-admin — relatório financeiro detalhado
--   Cobranças de todas as empresas, com filtros de período e
--   status, para exportação CSV/PDF.
-- ═══════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS sa_relatorio_financeiro(date, date, text);
CREATE FUNCTION sa_relatorio_financeiro(
    p_de date DEFAULT NULL, p_ate date DEFAULT NULL, p_status text DEFAULT NULL)
RETURNS TABLE (
    empresa text, contrato text, competencia date, vencimento date,
    valor numeric, status text, pago_em date, observacao text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT e.razao_social, ct.descricao, cb.competencia, cb.vencimento,
           cb.valor, cb.status, cb.pago_em, cb.observacao
      FROM cobranca cb
      JOIN contrato ct ON ct.id = cb.contrato_id
      JOIN empresa  e  ON e.id = cb.empresa_id
     WHERE (p_de  IS NULL OR cb.competencia >= p_de)
       AND (p_ate IS NULL OR cb.competencia <= p_ate)
       AND (p_status IS NULL OR cb.status = p_status)
     ORDER BY cb.competencia DESC, e.razao_social
$$;

SELECT 'relatório financeiro (super-admin) adicionado' AS resultado;
