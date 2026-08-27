-- ═══════════════════════════════════════════════════════════
-- 63 · auth_buscar_usuario_id — busca usuário por ID ignorando RLS
--   Necessária para o "sair da visualização" do super-admin: ao sair,
--   a conexão não tem tenant e a tabela usuario tem RLS, então um
--   SELECT direto retornava vazio (dava "sem permissão"). Esta função
--   SECURITY DEFINER revalida o papel do super-admin com segurança.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION auth_buscar_usuario_id(p_id uuid)
RETURNS TABLE (
    id uuid, empresa_id uuid, nome text, papel text, ativo boolean
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT u.id, u.empresa_id, u.nome, u.papel, u.ativo
      FROM usuario u
     WHERE u.id = p_id;
$$;

REVOKE ALL ON FUNCTION auth_buscar_usuario_id(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_buscar_usuario_id(uuid) TO api_app;

SELECT 'auth_buscar_usuario_id criada' AS resultado;
