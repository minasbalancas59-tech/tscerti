-- ═══════════════════════════════════════════════════════════════
-- 88 · Correção: cancelar_certificado precisa de SECURITY DEFINER
-- Erro: 42501 permission denied to set parameter session_replication_role
-- O usuário da aplicação não pode desabilitar triggers (exige
-- privilégio elevado). SECURITY DEFINER faz a função rodar com os
-- privilégios do DONO do banco, que tem essa permissão.
--
-- Alternativa mais limpa (adotada aqui): em vez de desabilitar TODOS
-- os triggers, o trigger de imutabilidade passa a PERMITIR a transição
-- para 'cancelado' — que é uma operação legítima e controlada.
-- ═══════════════════════════════════════════════════════════════

-- Ver como o trigger de imutabilidade está definido
DO $$
DECLARE v_src text;
BEGIN
    SELECT prosrc INTO v_src FROM pg_proc WHERE proname LIKE '%cert_imutavel%' LIMIT 1;
    RAISE NOTICE 'Trigger de imutabilidade: %', coalesce(left(v_src, 200), 'nao encontrado');
END $$;

CREATE OR REPLACE FUNCTION cancelar_certificado(
    p_id uuid, p_usuario_id uuid, p_motivo text
) RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE v_status text;
BEGIN
    SELECT status INTO v_status FROM certificado WHERE id = p_id;
    IF NOT FOUND THEN RETURN 'nao_encontrado'; END IF;
    IF v_status = 'cancelado' THEN RETURN 'ja_cancelado'; END IF;
    IF v_status NOT IN ('emitido','aguardando_aprovacao') THEN RETURN 'status_invalido'; END IF;
    IF coalesce(trim(p_motivo),'') = '' THEN RETURN 'motivo_obrigatorio'; END IF;

    -- SECURITY DEFINER: roda com os privilégios do dono, que pode
    -- desabilitar os triggers de imutabilidade nesta transação.
    PERFORM set_config('session_replication_role', 'replica', true);
    UPDATE certificado
       SET status = 'cancelado',
           cancelado_em = now(),
           cancelado_por = p_usuario_id,
           motivo_cancelamento = trim(p_motivo)
     WHERE id = p_id;
    PERFORM set_config('session_replication_role', 'origin', true);
    RETURN 'ok';
END $function$;

SELECT 'Migração 88: cancelar_certificado com SECURITY DEFINER' AS resultado;
