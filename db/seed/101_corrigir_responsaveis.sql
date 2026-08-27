-- 101: EXCECAO ESTREITA a imutabilidade do certificado emitido.
--
-- O gatilho trg_cert_imutavel bloqueia UPDATE em certificado emitido (e deve
-- continuar assim). Esta funcao permite corrigir APENAS tecnico_id e
-- aprovador_id -- o registro de QUEM executou e QUEM aprovou -- quando esse
-- dado foi gravado errado. Nenhuma medicao, data, cliente ou numero pode ser
-- alterado por aqui. A chamada e sempre registrada na auditoria pela API,
-- com os nomes anteriores e a justificativa do administrador.
--
-- SECURITY DEFINER + session_replication_role: mesmo padrao ja usado por
-- cancelar_certificado (desligar gatilho exige rodar como dono da tabela).
CREATE OR REPLACE FUNCTION public.corrigir_responsaveis_certificado(
    p_cert uuid, p_tecnico uuid, p_aprovador uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET session_replication_role TO 'replica'
AS $function$
DECLARE
    v_emp uuid;
BEGIN
    SELECT empresa_id INTO v_emp FROM certificado WHERE id = p_cert;
    IF v_emp IS NULL THEN
        RAISE EXCEPTION 'Certificado nao encontrado.';
    END IF;
    -- trava de tenant: so a propria empresa (a funcao roda fora do RLS)
    IF v_emp <> current_empresa_id() THEN
        RAISE EXCEPTION 'Certificado de outra empresa.';
    END IF;

    IF p_tecnico IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM usuario WHERE id = p_tecnico AND empresa_id = v_emp AND ativo) THEN
        RAISE EXCEPTION 'Tecnico invalido ou inativo.';
    END IF;

    IF p_aprovador IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM usuario WHERE id = p_aprovador AND empresa_id = v_emp AND ativo
           AND papel IN ('admin', 'responsavel_tecnico')) THEN
        RAISE EXCEPTION 'Responsavel tecnico invalido.';
    END IF;

    -- SOMENTE estas duas colunas
    UPDATE certificado
       SET tecnico_id   = COALESCE(p_tecnico, tecnico_id),
           aprovador_id = COALESCE(p_aprovador, aprovador_id)
     WHERE id = p_cert;

    RETURN true;
END;
$function$;
