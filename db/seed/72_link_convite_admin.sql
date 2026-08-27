-- ═══════════════════════════════════════════════════════════
-- 72 · Recuperar o link de convite atual do admin (super-admin)
--   Retorna o token existente SEM gerar um novo (diferente do
--   reenvio, que gera token novo). Para o super-admin copiar o
--   link e enviar manualmente ao cliente.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION sa_link_convite_admin(p_empresa uuid)
RETURNS TABLE (nome text, email text, token text, expira timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT u.nome, u.email, u.token_convite, u.token_convite_expira
      FROM usuario u
     WHERE u.empresa_id = p_empresa AND u.papel = 'admin'
     ORDER BY u.id ASC
     LIMIT 1;
$$;
REVOKE ALL ON FUNCTION sa_link_convite_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sa_link_convite_admin(uuid) TO api_app;

SELECT 'função de link de convite criada' AS resultado;
