-- ═══════════════════════════════════════════════════════════
-- 42 · Login — informar o motivo real do bloqueio
--   auth_buscar_usuario passa a devolver o motivo_suspensao da
--   empresa, para o login diferenciar (APÓS validar a senha):
--   usuário bloqueado × empresa suspensa × credencial errada.
-- ═══════════════════════════════════════════════════════════

-- O tipo de retorno muda: DROP antes (lição das migrações 34/41)
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
    motivo_suspensao text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT u.id, u.empresa_id, u.nome, u.papel, u.senha_hash, u.ativo,
           e.razao_social, e.status, e.motivo_suspensao
      FROM usuario u
      JOIN empresa e ON e.id = u.empresa_id
     WHERE lower(u.email) = lower(p_email)
     LIMIT 1
$$;
REVOKE ALL ON FUNCTION auth_buscar_usuario(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_buscar_usuario(text) TO api_app;

SELECT 'login com motivo de bloqueio adicionado' AS resultado;
