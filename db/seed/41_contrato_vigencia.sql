-- ═══════════════════════════════════════════════════════════
-- 41 · Vigência de contratos — avisos e bloqueio automático
--   • empresa.dias_carencia_contrato (padrão 15) e motivo_suspensao
--   • sa_vigencia_contratos(): situação contratual de cada empresa
--   • sa_aplicar_bloqueio_contratos(): suspende após a carência
--   • minha_vigencia_contrato(): aviso no painel do admin/RT
-- Regra: empresa SEM nenhum contrato ativo cadastrado não é
-- monitorada (pode ser cortesia/interna). Vigente = existe
-- contrato ativo com fim NULL ou fim >= hoje.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE empresa ADD COLUMN IF NOT EXISTS dias_carencia_contrato int NOT NULL DEFAULT 15;
ALTER TABLE empresa ADD COLUMN IF NOT EXISTS motivo_suspensao text;

-- ── sa_empresa passa a devolver carência e motivo de suspensão ──
-- (o tipo de retorno muda, então precisa de DROP antes)
DROP FUNCTION IF EXISTS sa_empresa(uuid);
CREATE FUNCTION sa_empresa(p_id uuid)
RETURNS TABLE (
    id uuid, razao_social text, cnpj text, subdominio text, plano text,
    status text, limite_usuarios int, num_autorizacao text, prefixo_cert text,
    proximo_numero int, criado_em timestamptz,
    dias_carencia_contrato int, motivo_suspensao text,
    qtd_usuarios bigint, qtd_certificados bigint, qtd_clientes bigint,
    qtd_balancas bigint
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT e.id, e.razao_social, e.cnpj, e.subdominio, e.plano, e.status,
           e.limite_usuarios, e.num_autorizacao, e.prefixo_cert, e.proximo_numero,
           e.criado_em, e.dias_carencia_contrato, e.motivo_suspensao,
           (SELECT count(*) FROM usuario u WHERE u.empresa_id = e.id AND u.ativo),
           (SELECT count(*) FROM certificado c WHERE c.empresa_id = e.id AND c.status = 'emitido'),
           (SELECT count(*) FROM cliente cl WHERE cl.empresa_id = e.id AND cl.ativo),
           (SELECT count(*) FROM balanca b WHERE b.empresa_id = e.id AND b.ativa)
      FROM empresa e WHERE e.id = p_id
$$;

-- ── Situação contratual (visão do super-admin) ──────────────
DROP FUNCTION IF EXISTS sa_vigencia_contratos();
CREATE FUNCTION sa_vigencia_contratos()
RETURNS TABLE (
    id uuid, razao_social text, status text, motivo_suspensao text,
    fim_vigencia date, dias_para_vencer int, dias_vencido int,
    dias_carencia int, situacao text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT e.id, e.razao_social, e.status, e.motivo_suspensao,
           v.fim_vigencia,
           CASE WHEN v.fim_vigencia >= current_date
                THEN (v.fim_vigencia - current_date) END,
           CASE WHEN v.fim_vigencia < current_date
                THEN (current_date - v.fim_vigencia) END,
           e.dias_carencia_contrato,
           CASE
               WHEN v.tem_contrato = 0 THEN 'sem_contrato'
               WHEN e.status = 'suspensa' AND e.motivo_suspensao = 'contrato_vencido'
                    THEN 'suspensa_contrato'
               WHEN v.tem_vigente > 0 AND v.fim_vigencia IS NULL THEN 'vigente'
               WHEN v.tem_vigente > 0 AND (v.fim_vigencia - current_date) > 30 THEN 'vigente'
               WHEN v.tem_vigente > 0 THEN 'vencendo'
               ELSE 'vencido'
           END
      FROM empresa e
      LEFT JOIN LATERAL (
          SELECT count(*) AS tem_contrato,
                 count(*) FILTER (WHERE c.fim IS NULL OR c.fim >= current_date) AS tem_vigente,
                 -- fim da vigência: NULL se houver contrato sem fim; senão o maior fim
                 CASE WHEN bool_or(c.fim IS NULL) THEN NULL ELSE max(c.fim) END AS fim_vigencia
            FROM contrato c
           WHERE c.empresa_id = e.id AND c.ativo
      ) v ON true
     WHERE e.cnpj <> '99999999999999'
     ORDER BY
        CASE
            WHEN e.status = 'suspensa' AND e.motivo_suspensao = 'contrato_vencido' THEN 1
            WHEN v.tem_vigente = 0 AND v.tem_contrato > 0 THEN 0
            WHEN v.fim_vigencia IS NOT NULL AND (v.fim_vigencia - current_date) <= 30 THEN 2
            ELSE 3
        END, v.fim_vigencia NULLS LAST;
$$;

-- ── Bloqueio automático após a carência ─────────────────────
-- Suspende empresas ativas que têm contrato, mas nenhum vigente,
-- e cujo fim + carência já passou. Retorna quantas suspendeu.
DROP FUNCTION IF EXISTS sa_aplicar_bloqueio_contratos();
CREATE FUNCTION sa_aplicar_bloqueio_contratos()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_qtd int;
BEGIN
    UPDATE empresa e
       SET status = 'suspensa', motivo_suspensao = 'contrato_vencido'
     WHERE e.status = 'ativa'
       AND e.cnpj <> '99999999999999'
       AND EXISTS (SELECT 1 FROM contrato c
                    WHERE c.empresa_id = e.id AND c.ativo)
       AND NOT EXISTS (SELECT 1 FROM contrato c
                        WHERE c.empresa_id = e.id AND c.ativo
                          AND (c.fim IS NULL OR c.fim >= current_date))
       AND (SELECT max(c.fim) FROM contrato c
             WHERE c.empresa_id = e.id AND c.ativo)
           + (e.dias_carencia_contrato * interval '1 day') < current_date;
    GET DIAGNOSTICS v_qtd = ROW_COUNT;
    RETURN v_qtd;
END $$;
GRANT EXECUTE ON FUNCTION sa_aplicar_bloqueio_contratos() TO api_app;

-- ── Aviso para o admin/RT no painel da própria empresa ──────
-- Usa current_empresa_id(); só devolve algo se houver motivo de
-- atenção (vencendo em <=30 dias, vencido ou suspensa por contrato).
DROP FUNCTION IF EXISTS minha_vigencia_contrato();
CREATE FUNCTION minha_vigencia_contrato()
RETURNS TABLE (
    situacao text, fim_vigencia date,
    dias_para_vencer int, dias_vencido int, dias_carencia int
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT s.situacao, s.fim_vigencia, s.dias_para_vencer,
           s.dias_vencido, s.dias_carencia
      FROM (
        SELECT
            CASE
                WHEN v.tem_contrato = 0 THEN 'sem_contrato'
                WHEN e.status = 'suspensa' AND e.motivo_suspensao = 'contrato_vencido'
                     THEN 'suspensa_contrato'
                WHEN v.tem_vigente > 0 AND v.fim_vigencia IS NULL THEN 'vigente'
                WHEN v.tem_vigente > 0 AND (v.fim_vigencia - current_date) > 30 THEN 'vigente'
                WHEN v.tem_vigente > 0 THEN 'vencendo'
                ELSE 'vencido'
            END AS situacao,
            v.fim_vigencia,
            CASE WHEN v.fim_vigencia >= current_date
                 THEN (v.fim_vigencia - current_date) END AS dias_para_vencer,
            CASE WHEN v.fim_vigencia < current_date
                 THEN (current_date - v.fim_vigencia) END AS dias_vencido,
            e.dias_carencia_contrato AS dias_carencia
          FROM empresa e
          LEFT JOIN LATERAL (
              SELECT count(*) AS tem_contrato,
                     count(*) FILTER (WHERE c.fim IS NULL OR c.fim >= current_date) AS tem_vigente,
                     CASE WHEN bool_or(c.fim IS NULL) THEN NULL ELSE max(c.fim) END AS fim_vigencia
                FROM contrato c
               WHERE c.empresa_id = e.id AND c.ativo
          ) v ON true
         WHERE e.id = current_empresa_id()
      ) s
     WHERE s.situacao IN ('vencendo', 'vencido', 'suspensa_contrato');
$$;
GRANT EXECUTE ON FUNCTION minha_vigencia_contrato() TO api_app;

-- ── Reativação limpa o motivo; carência editável ────────────
-- A assinatura muda (novo parâmetro), então remove a anterior.
DROP FUNCTION IF EXISTS sa_atualizar_empresa(uuid, text, text, text, int, text, text, text);
CREATE FUNCTION sa_atualizar_empresa(
    p_id uuid, p_razao text, p_plano text, p_status text, p_limite int,
    p_subdominio text DEFAULT NULL,
    p_num_autorizacao text DEFAULT NULL,
    p_prefixo_cert text DEFAULT NULL,
    p_carencia int DEFAULT NULL)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    UPDATE empresa SET
        razao_social    = COALESCE(p_razao, razao_social),
        plano           = COALESCE(p_plano, plano),
        status          = COALESCE(p_status, status),
        -- Reativar limpa o motivo de suspensão automática
        motivo_suspensao = CASE WHEN p_status = 'ativa' THEN NULL ELSE motivo_suspensao END,
        limite_usuarios = COALESCE(p_limite, limite_usuarios),
        dias_carencia_contrato = COALESCE(p_carencia, dias_carencia_contrato),
        subdominio      = COALESCE(NULLIF(p_subdominio, ''), subdominio),
        num_autorizacao = COALESCE(p_num_autorizacao, num_autorizacao),
        prefixo_cert    = CASE
            WHEN NULLIF(p_prefixo_cert, '') IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM certificado c
                             WHERE c.empresa_id = p_id AND c.status = 'emitido')
            THEN p_prefixo_cert
            ELSE prefixo_cert
        END
     WHERE id = p_id
$$;

SELECT 'vigência de contratos (avisos + bloqueio automático) adicionada' AS resultado;
