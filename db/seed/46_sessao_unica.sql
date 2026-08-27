-- ═══════════════════════════════════════════════════════════
-- 46 · Sessão única por usuário (login novo derruba o antigo)
--   Cada login grava um identificador de sessão (sessao_atual).
--   O token carrega esse id; se não bater com o do banco, a
--   sessão foi substituída por um login mais recente.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE usuario ADD COLUMN IF NOT EXISTS sessao_atual uuid;

-- Define uma nova sessão no login e devolve o id gerado.
DROP FUNCTION IF EXISTS auth_nova_sessao(uuid);
CREATE FUNCTION auth_nova_sessao(p_usuario uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sid uuid := gen_random_uuid();
BEGIN
    UPDATE usuario SET sessao_atual = v_sid WHERE id = p_usuario;
    RETURN v_sid;
END $$;
GRANT EXECUTE ON FUNCTION auth_nova_sessao(uuid) TO api_app;

-- Verifica se a sessão do token ainda é a vigente.
DROP FUNCTION IF EXISTS auth_sessao_valida(uuid, uuid);
CREATE FUNCTION auth_sessao_valida(p_usuario uuid, p_sid uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM usuario
         WHERE id = p_usuario AND sessao_atual = p_sid
    )
$$;
GRANT EXECUTE ON FUNCTION auth_sessao_valida(uuid, uuid) TO api_app;

SELECT 'sessão única por usuário adicionada' AS resultado;
