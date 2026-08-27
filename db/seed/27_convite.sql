-- ================================================================
-- Convite por email: usuário define a própria senha
--   docker compose exec -T db psql -U certsaas -d certsaas < db/seed/27_convite.sql
-- ================================================================
ALTER TABLE usuario
    ADD COLUMN IF NOT EXISTS token_convite text,
    ADD COLUMN IF NOT EXISTS token_convite_expira timestamptz;

-- Define a senha a partir do token de convite (endpoint público, pré-login):
-- SECURITY DEFINER contorna o RLS, como a auth_buscar_usuario do login.
CREATE OR REPLACE FUNCTION auth_definir_senha_por_token(p_token text, p_hash text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
    IF p_token IS NULL OR length(p_token) < 16 THEN
        RETURN NULL;
    END IF;
    UPDATE usuario
       SET senha_hash = p_hash,
           token_convite = NULL,
           token_convite_expira = NULL
     WHERE token_convite = p_token
       AND token_convite_expira > now()
       AND ativo
    RETURNING id INTO v_id;
    RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION auth_definir_senha_por_token(text, text) TO api_app;

SELECT 'convite + função de definição de senha criados' AS resultado;
