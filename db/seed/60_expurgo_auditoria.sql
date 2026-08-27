-- ═══════════════════════════════════════════════════════════
-- 60 · Expurgo do log de auditoria (após 1 ano)
--   Remove registros antigos de atividade para o log não inflar,
--   MAS preserva tudo que se refere a certificados (emissão,
--   revisão, edição manual, reprovação) — registro importante
--   para rastreabilidade metrológica, guardado para sempre.
--
--   Rodado pela rotina diária do Worker.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION expurgar_log_auditoria(p_meses int DEFAULT 12)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
    removidos bigint;
BEGIN
    WITH apagados AS (
        DELETE FROM log_auditoria
         WHERE criado_em < now() - make_interval(months => p_meses)
           -- PRESERVA tudo ligado a certificado (rastreabilidade permanente)
           AND entidade IS DISTINCT FROM 'certificado'
        RETURNING id
    )
    SELECT count(*) INTO removidos FROM apagados;
    RETURN removidos;
END;
$$;

SELECT 'expurgo de log de auditoria criado (preserva certificados)' AS resultado;
