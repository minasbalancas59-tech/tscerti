-- ═══════════════════════════════════════════════════════════
-- 51 · Métricas de saúde do sistema (super-admin)
--   Contadores e tamanho do banco, para o painel de saúde.
-- ═══════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS sa_saude_banco();
CREATE FUNCTION sa_saude_banco()
RETURNS TABLE (
    banco_bytes bigint,
    banco_tamanho text,
    total_empresas bigint,
    empresas_ativas bigint,
    total_usuarios bigint,
    total_certificados bigint,
    certificados_mes bigint,
    total_clientes bigint,
    total_balancas bigint,
    conexoes_ativas int,
    chamados_abertos bigint,
    erros_abertos bigint
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT
        pg_database_size(current_database()),
        pg_size_pretty(pg_database_size(current_database())),
        (SELECT count(*) FROM empresa),
        (SELECT count(*) FROM empresa WHERE status = 'ativa'),
        (SELECT count(*) FROM usuario),
        (SELECT count(*) FROM certificado WHERE status = 'emitido'),
        (SELECT count(*) FROM certificado
          WHERE status = 'emitido'
            AND data_emissao >= date_trunc('month', now())),
        (SELECT count(*) FROM cliente),
        (SELECT count(*) FROM balanca),
        (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database()),
        (SELECT count(*) FROM chamado WHERE status IN ('aberto','em_atendimento','aguardando_cliente')),
        (SELECT count(*) FROM erro_sistema WHERE resolvido = false)
$$;

-- Série dos últimos 12 meses de certificados emitidos (para gráfico)
DROP FUNCTION IF EXISTS sa_certificados_serie();
CREATE FUNCTION sa_certificados_serie()
RETURNS TABLE (mes text, total bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT to_char(m, 'YYYY-MM') AS mes,
           (SELECT count(*) FROM certificado c
             WHERE c.status = 'emitido'
               AND date_trunc('month', c.data_emissao) = m) AS total
      FROM generate_series(
             date_trunc('month', now()) - interval '11 months',
             date_trunc('month', now()),
             interval '1 month') m
     ORDER BY m
$$;

SELECT 'métricas de saúde adicionadas' AS resultado;
