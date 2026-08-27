-- ═══════════════════════════════════════════════════════════
-- 73 · CRUD de contratos (super-admin): editar, ativar, excluir
-- ═══════════════════════════════════════════════════════════

-- Editar todos os campos do contrato
CREATE OR REPLACE FUNCTION sa_editar_contrato(
    p_id uuid, p_descricao text, p_valor numeric, p_periodicidade text,
    p_inicio date, p_fim date, p_obs text, p_dia_venc integer, p_automatico boolean)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE contrato
       SET descricao = p_descricao, valor = p_valor, periodicidade = p_periodicidade,
           inicio = p_inicio, fim = p_fim, observacao = p_obs,
           dia_vencimento = p_dia_venc, gerar_automatico = p_automatico
     WHERE id = p_id;
    RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION sa_editar_contrato(uuid,text,numeric,text,date,date,text,integer,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sa_editar_contrato(uuid,text,numeric,text,date,date,text,integer,boolean) TO api_app;

-- Encerrar (ativo=false) ou reativar (ativo=true)
CREATE OR REPLACE FUNCTION sa_ativar_contrato(p_id uuid, p_ativo boolean)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE contrato SET ativo = p_ativo WHERE id = p_id;
    RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION sa_ativar_contrato(uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sa_ativar_contrato(uuid,boolean) TO api_app;

-- Excluir: só se NÃO houver cobranças (senão orienta encerrar)
CREATE OR REPLACE FUNCTION sa_excluir_contrato(p_id uuid)
RETURNS text  -- 'ok' | 'tem_cobrancas' | 'nao_encontrado'
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n int;
BEGIN
    SELECT count(*) INTO v_n FROM cobranca WHERE contrato_id = p_id;
    IF v_n > 0 THEN
        RETURN 'tem_cobrancas';
    END IF;
    DELETE FROM contrato WHERE id = p_id;
    IF NOT FOUND THEN RETURN 'nao_encontrado'; END IF;
    RETURN 'ok';
END $$;
REVOKE ALL ON FUNCTION sa_excluir_contrato(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sa_excluir_contrato(uuid) TO api_app;

SELECT 'CRUD de contratos criado' AS resultado;
