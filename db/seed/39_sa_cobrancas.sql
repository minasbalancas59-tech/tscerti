-- ═══════════════════════════════════════════════════════════
-- 39 · Super-admin — gestão completa de cobranças
--   Editar (valor, competência, vencimento, observação) e excluir.
-- ═══════════════════════════════════════════════════════════

-- Edita os dados de uma cobrança (para corrigir erros de digitação).
-- Parâmetros NULL mantêm o valor atual.
DROP FUNCTION IF EXISTS sa_atualizar_cobranca(uuid, date, date, numeric, text);
CREATE FUNCTION sa_atualizar_cobranca(
    p_id uuid, p_competencia date, p_vencimento date,
    p_valor numeric, p_obs text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    UPDATE cobranca SET
        competencia = COALESCE(p_competencia, competencia),
        vencimento  = COALESCE(p_vencimento, vencimento),
        valor       = COALESCE(p_valor, valor),
        observacao  = COALESCE(p_obs, observacao),
        -- Se estava "vencido" e o novo vencimento é futuro, volta a "pendente"
        status = CASE
            WHEN status = 'vencido' AND COALESCE(p_vencimento, vencimento) >= current_date
            THEN 'pendente' ELSE status
        END
     WHERE id = p_id
$$;

-- Exclui uma cobrança (para lançamentos criados por engano).
DROP FUNCTION IF EXISTS sa_excluir_cobranca(uuid);
CREATE FUNCTION sa_excluir_cobranca(p_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    DELETE FROM cobranca WHERE id = p_id
$$;

SELECT 'gestão de cobranças (editar/excluir) adicionada' AS resultado;
