-- ═══════════════════════════════════════════════════════════
-- 67 · Relatório de e-mails enviados (admin / RT) por empresa
--   A tabela email_log não tem RLS (é preenchida pelo Worker sem tenant),
--   então filtramos explicitamente pela empresa do contexto
--   (current_empresa_id()). Filtros: período, cliente, motivo, status.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION rel_emails_empresa(
    p_empresa uuid,                 -- empresa do gestor (passada pela API)
    p_de timestamptz DEFAULT NULL,
    p_ate timestamptz DEFAULT NULL,
    p_cliente uuid DEFAULT NULL,
    p_motivo text DEFAULT NULL,
    p_status text DEFAULT NULL,
    p_limite int DEFAULT 2000
)
RETURNS TABLE (
    enviado_em timestamptz, destinatario text, nome_destino text,
    assunto text, motivo text, status text, erro_detalhe text,
    cliente text, cliente_id uuid
) LANGUAGE sql STABLE AS $$
    SELECT el.enviado_em, el.destinatario, el.nome_destino,
           el.assunto, el.motivo, el.status, el.erro_detalhe,
           c.razao_social, el.cliente_id
      FROM email_log el
      LEFT JOIN cliente c ON c.id = el.cliente_id
     WHERE el.empresa_id = p_empresa       -- isolamento por empresa
       AND (p_de     IS NULL OR el.enviado_em >= p_de)
       AND (p_ate    IS NULL OR el.enviado_em <  p_ate)
       AND (p_cliente IS NULL OR el.cliente_id = p_cliente)
       AND (p_motivo IS NULL OR el.motivo = p_motivo)
       AND (p_status IS NULL OR el.status = p_status)
     ORDER BY el.enviado_em DESC
     LIMIT p_limite;
$$;

-- Resumo agregado (para os cartões de totais do relatório)
CREATE OR REPLACE FUNCTION rel_emails_empresa_resumo(
    p_empresa uuid,
    p_de timestamptz DEFAULT NULL,
    p_ate timestamptz DEFAULT NULL,
    p_cliente uuid DEFAULT NULL
)
RETURNS TABLE (total bigint, enviados bigint, erros bigint) LANGUAGE sql STABLE AS $$
    SELECT count(*),
           count(*) FILTER (WHERE status = 'enviado'),
           count(*) FILTER (WHERE status = 'erro')
      FROM email_log el
     WHERE el.empresa_id = p_empresa
       AND (p_de     IS NULL OR el.enviado_em >= p_de)
       AND (p_ate    IS NULL OR el.enviado_em <  p_ate)
       AND (p_cliente IS NULL OR el.cliente_id = p_cliente);
$$;

SELECT 'relatório de e-mails por empresa criado' AS resultado;
