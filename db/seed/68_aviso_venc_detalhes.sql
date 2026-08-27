-- ═══════════════════════════════════════════════════════════
-- 68 · Enriquece o aviso de vencimento
--   Acrescenta marca, modelo e capacidade de cada balança ao JSON,
--   para o e-mail exibir mais detalhes do equipamento.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION avisos_vencimento_pendentes(
    p_max_dias int,
    p_freq_dias int,
    p_respeitar_freq boolean DEFAULT true,
    p_cliente uuid DEFAULT NULL
)
RETURNS TABLE (
    cliente_id uuid, cliente text, email text, qtd bigint, balancas jsonb
) LANGUAGE sql STABLE AS $$
    WITH venc AS (
        SELECT c.id AS cliente_id, c.razao_social, c.email,
               b.identificacao, b.tipo, b.marca, b.modelo, b.capacidade,
               (ult.data_calibracao + make_interval(months => COALESCE(b.periodicidade_meses, 12)))::date AS vence_em
          FROM balanca b
          JOIN cliente c ON c.id = b.cliente_id
          LEFT JOIN LATERAL (
              SELECT ct.data_calibracao FROM certificado ct
               WHERE ct.balanca_id = b.id AND ct.status = 'emitido'
               ORDER BY ct.data_calibracao DESC LIMIT 1
          ) ult ON true
         WHERE b.ativa AND c.ativo
           AND ult.data_calibracao IS NOT NULL
           AND (p_cliente IS NULL OR c.id = p_cliente)
           AND (ult.data_calibracao + make_interval(months => COALESCE(b.periodicidade_meses, 12)))::date
               BETWEEN now()::date AND (now()::date + p_max_dias)
    )
    SELECT v.cliente_id, v.razao_social, v.email, count(*),
           jsonb_agg(jsonb_build_object(
               'balanca', v.identificacao, 'tipo', v.tipo,
               'marca', v.marca, 'modelo', v.modelo, 'capacidade', v.capacidade,
               'vence_em', v.vence_em)
               ORDER BY v.vence_em)
      FROM venc v
     WHERE NOT p_respeitar_freq OR NOT EXISTS (
         SELECT 1 FROM aviso_vencimento av
          WHERE av.cliente_id = v.cliente_id
            AND av.enviado_em > now() - make_interval(days => p_freq_dias))
     GROUP BY v.cliente_id, v.razao_social, v.email
     ORDER BY v.razao_social;
$$;

SELECT 'aviso de vencimento enriquecido (marca/modelo/capacidade)' AS resultado;
