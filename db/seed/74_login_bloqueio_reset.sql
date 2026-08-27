-- ═══════════════════════════════════════════════════════════
-- 74 · Bloqueio por tentativas + reset de senha (esqueci a senha)
-- ═══════════════════════════════════════════════════════════

-- Colunas de controle
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS tentativas_login   integer NOT NULL DEFAULT 0;
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS bloqueado_login    boolean NOT NULL DEFAULT false;
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS token_reset        text;
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS token_reset_expira timestamptz;

-- auth_buscar_usuario passa a devolver também tentativas e bloqueio.
-- (tipo muda → DROP antes, lição das migrações anteriores)
DROP FUNCTION IF EXISTS auth_buscar_usuario(text);
CREATE FUNCTION auth_buscar_usuario(p_email text)
RETURNS TABLE (
    id               uuid,
    empresa_id       uuid,
    nome             text,
    papel            text,
    senha_hash       text,
    ativo            boolean,
    empresa          text,
    empresa_status   text,
    motivo_suspensao text,
    tentativas_login integer,
    bloqueado_login  boolean
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT u.id, u.empresa_id, u.nome, u.papel, u.senha_hash, u.ativo,
           e.razao_social, e.status, e.motivo_suspensao,
           u.tentativas_login, u.bloqueado_login
      FROM usuario u
      JOIN empresa e ON e.id = u.empresa_id
     WHERE lower(u.email) = lower(p_email)
     LIMIT 1
$$;
REVOKE ALL ON FUNCTION auth_buscar_usuario(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_buscar_usuario(text) TO api_app;

-- Registra um erro de senha: incrementa e bloqueia ao atingir o limite (5).
-- Retorna o total de tentativas e se ficou bloqueado.
CREATE OR REPLACE FUNCTION auth_erro_senha(p_id uuid, p_limite integer DEFAULT 5)
RETURNS TABLE (tentativas integer, bloqueado boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE usuario
       SET tentativas_login = tentativas_login + 1,
           bloqueado_login  = (tentativas_login + 1) >= p_limite
     WHERE id = p_id
    RETURNING tentativas_login, bloqueado_login INTO tentativas, bloqueado;
    RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION auth_erro_senha(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_erro_senha(uuid,integer) TO api_app;

-- Zera as tentativas (chamado ao logar com sucesso)
CREATE OR REPLACE FUNCTION auth_zerar_tentativas(p_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    UPDATE usuario SET tentativas_login = 0 WHERE id = p_id AND tentativas_login <> 0;
$$;
REVOKE ALL ON FUNCTION auth_zerar_tentativas(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_zerar_tentativas(uuid) TO api_app;

-- Inicia o reset de senha: gera token e devolve nome/email para o e-mail.
-- Não falha se o e-mail não existir (o endpoint responde genérico).
CREATE OR REPLACE FUNCTION auth_iniciar_reset(p_email text)
RETURNS TABLE (id uuid, nome text, email text, token text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_tok text;
BEGIN
    SELECT u.id INTO v_id FROM usuario u
     WHERE lower(u.email) = lower(p_email) AND u.ativo = true
     LIMIT 1;
    IF v_id IS NULL THEN RETURN; END IF;

    v_tok := encode(gen_random_bytes(24), 'hex');
    UPDATE usuario
       SET token_reset = v_tok,
           token_reset_expira = now() + interval '1 hour'
     WHERE id = v_id;

    RETURN QUERY
      SELECT u.id, u.nome, u.email, v_tok FROM usuario u WHERE u.id = v_id;
END $$;
REVOKE ALL ON FUNCTION auth_iniciar_reset(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_iniciar_reset(text) TO api_app;

-- Valida o token de reset (para a tela de redefinir mostrar o formulário)
CREATE OR REPLACE FUNCTION auth_reset_valido(p_token text)
RETURNS TABLE (id uuid, nome text, email text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT u.id, u.nome, u.email FROM usuario u
     WHERE u.token_reset = p_token
       AND u.token_reset_expira > now()
     LIMIT 1;
$$;
REVOKE ALL ON FUNCTION auth_reset_valido(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_reset_valido(text) TO api_app;

-- Redefine a senha pelo token: troca o hash, DESBLOQUEIA e zera tentativas,
-- e invalida o token. Retorna true se aplicou.
CREATE OR REPLACE FUNCTION auth_redefinir_senha(p_token text, p_hash text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
    SELECT id INTO v_id FROM usuario
     WHERE token_reset = p_token AND token_reset_expira > now()
     LIMIT 1;
    IF v_id IS NULL THEN RETURN false; END IF;

    UPDATE usuario
       SET senha_hash = p_hash,
           tentativas_login = 0,
           bloqueado_login = false,
           token_reset = NULL,
           token_reset_expira = NULL
     WHERE id = v_id;
    RETURN true;
END $$;
REVOKE ALL ON FUNCTION auth_redefinir_senha(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_redefinir_senha(text,text) TO api_app;

SELECT 'bloqueio por tentativas + reset de senha adicionados' AS resultado;
