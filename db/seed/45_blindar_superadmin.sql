-- ═══════════════════════════════════════════════════════════
-- 45 · Blindar o super-admin contra bloqueio automático
--   A empresa que hospeda um super_admin (SISTEMA) nunca deve
--   ser suspensa pela regra de contrato vencido. Reforça a
--   proteção por PAPEL, não só pelo CNPJ fixo — assim continua
--   segura mesmo que o CNPJ da SISTEMA mude um dia.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION sa_aplicar_bloqueio_contratos()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_qtd int;
BEGIN
    UPDATE empresa e
       SET status = 'suspensa', motivo_suspensao = 'contrato_vencido'
     WHERE e.status = 'ativa'
       AND e.cnpj <> '99999999999999'
       -- Nunca bloquear empresa que tenha um super_admin (SISTEMA)
       AND NOT EXISTS (SELECT 1 FROM usuario u
                        WHERE u.empresa_id = e.id AND u.papel = 'super_admin')
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

-- Garante que a empresa SISTEMA esteja ativa (corrige um eventual
-- bloqueio anterior que a tenha atingido)
UPDATE empresa
   SET status = 'ativa', motivo_suspensao = NULL
 WHERE EXISTS (SELECT 1 FROM usuario u
                WHERE u.empresa_id = empresa.id AND u.papel = 'super_admin')
   AND status <> 'ativa';

SELECT 'super-admin blindado contra bloqueio automático' AS resultado;
