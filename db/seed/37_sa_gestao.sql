-- ═══════════════════════════════════════════════════════════
-- 37 · Painel super-admin — gestão de SaaS (Tier 1)
--   • Dashboard financeiro (MRR, faturado, em aberto, vencido)
--   • Log de atividade por empresa (último certificado, uso)
-- Todas SECURITY DEFINER: atravessam o isolamento por empresa,
-- e os endpoints validam EhSuperAdmin antes de chamar.
-- ═══════════════════════════════════════════════════════════

-- ── Dashboard financeiro ────────────────────────────────────
-- MRR = soma dos contratos ativos normalizados para valor mensal.
-- Faturado no mês = cobranças pagas na competência atual.
-- Em aberto / vencido = somas por status.
DROP FUNCTION IF EXISTS sa_financeiro();
CREATE FUNCTION sa_financeiro()
RETURNS TABLE (
    mrr numeric,
    faturado_mes numeric,
    total_aberto numeric,
    total_vencido numeric,
    pago_12m numeric,
    contratos_ativos int
)
LANGUAGE sql SECURITY DEFINER AS $$
    SELECT
        -- MRR: normaliza cada contrato ativo para valor mensal
        COALESCE((
            SELECT sum(
                CASE periodicidade
                    WHEN 'mensal'     THEN valor
                    WHEN 'trimestral' THEN valor / 3.0
                    WHEN 'semestral'  THEN valor / 6.0
                    WHEN 'anual'      THEN valor / 12.0
                    ELSE 0  -- avulso não entra no recorrente
                END)
            FROM contrato
            WHERE ativo = true
        ), 0)::numeric(12,2),
        -- Faturado no mês corrente (cobranças pagas nesta competência)
        COALESCE((
            SELECT sum(valor) FROM cobranca
            WHERE status = 'pago'
              AND date_trunc('month', competencia) = date_trunc('month', current_date)
        ), 0)::numeric(12,2),
        -- Em aberto (pendente, ainda não vencido)
        COALESCE((
            SELECT sum(valor) FROM cobranca WHERE status = 'pendente'
        ), 0)::numeric(12,2),
        -- Vencido
        COALESCE((
            SELECT sum(valor) FROM cobranca WHERE status = 'vencido'
        ), 0)::numeric(12,2),
        -- Pago nos últimos 12 meses
        COALESCE((
            SELECT sum(valor) FROM cobranca
            WHERE status = 'pago' AND pago_em >= current_date - interval '12 months'
        ), 0)::numeric(12,2),
        -- Contratos ativos
        (SELECT count(*)::int FROM contrato WHERE ativo = true);
$$;

-- ── Faturamento mês a mês (últimos 6 meses) para mini-gráfico ─
DROP FUNCTION IF EXISTS sa_faturamento_mensal();
CREATE FUNCTION sa_faturamento_mensal()
RETURNS TABLE (competencia text, total numeric)
LANGUAGE sql SECURITY DEFINER AS $$
    SELECT to_char(m.mes, 'MM/YYYY') AS competencia,
           COALESCE(sum(cb.valor), 0)::numeric(12,2) AS total
      FROM generate_series(
               date_trunc('month', current_date) - interval '5 months',
               date_trunc('month', current_date),
               interval '1 month') AS m(mes)
      LEFT JOIN cobranca cb
             ON date_trunc('month', cb.competencia) = m.mes
            AND cb.status = 'pago'
     GROUP BY m.mes
     ORDER BY m.mes;
$$;

-- ── Log de atividade por empresa ────────────────────────────
-- Para cada empresa: quando emitiu o último certificado, quantos
-- emitiu nos últimos 30 dias, e um "estado" de atividade.
DROP FUNCTION IF EXISTS sa_atividade_empresas();
CREATE FUNCTION sa_atividade_empresas()
RETURNS TABLE (
    id uuid,
    razao_social text,
    status text,
    ultimo_certificado timestamptz,
    dias_sem_emitir int,
    certs_30d bigint,
    certs_total bigint,
    estado text
)
LANGUAGE sql SECURITY DEFINER AS $$
    SELECT e.id, e.razao_social, e.status,
           u.ultimo,
           CASE WHEN u.ultimo IS NULL THEN NULL
                ELSE extract(day FROM current_date - u.ultimo)::int END,
           COALESCE(u.c30, 0),
           COALESCE(u.ctot, 0),
           CASE
               WHEN e.status <> 'ativa'                      THEN e.status
               WHEN u.ultimo IS NULL                          THEN 'nunca_emitiu'
               WHEN u.ultimo >= current_date - interval '30 days' THEN 'ativa_uso'
               WHEN u.ultimo >= current_date - interval '90 days' THEN 'em_risco'
               ELSE 'inativa_uso'
           END AS estado
      FROM empresa e
      LEFT JOIN LATERAL (
          SELECT max(c.data_emissao) AS ultimo,
                 count(*) FILTER (WHERE c.data_emissao >= current_date - interval '30 days') AS c30,
                 count(*) AS ctot
            FROM certificado c
           WHERE c.empresa_id = e.id AND c.status = 'emitido'
      ) u ON true
     WHERE e.cnpj <> '99999999999999'   -- exclui a empresa SISTEMA
     ORDER BY u.ultimo ASC NULLS FIRST;
$$;

-- ── Reenviar convite ao admin de uma empresa ────────────────
-- Encontra o admin da empresa (mais antigo), gera novo token de
-- convite (7 dias) e retorna o id do usuário para o e-mail ser
-- disparado. Retorna NULL se a empresa não tiver admin.
DROP FUNCTION IF EXISTS sa_reenviar_convite_admin(uuid);
CREATE FUNCTION sa_reenviar_convite_admin(p_empresa uuid)
RETURNS TABLE (usuario_id uuid, nome text, email text)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_id uuid;
BEGIN
    SELECT u.id INTO v_id
      FROM usuario u
     WHERE u.empresa_id = p_empresa AND u.papel = 'admin'
     ORDER BY u.id ASC
     LIMIT 1;

    IF v_id IS NULL THEN
        RETURN;  -- sem admin: retorna vazio
    END IF;

    UPDATE usuario
       SET token_convite = encode(gen_random_bytes(24), 'hex'),
           token_convite_expira = now() + interval '7 days'
     WHERE id = v_id;

    RETURN QUERY
        SELECT u.id, u.nome, u.email FROM usuario u WHERE u.id = v_id;
END;
$$;

SELECT 'gestão super-admin (financeiro + atividade) adicionada' AS resultado;