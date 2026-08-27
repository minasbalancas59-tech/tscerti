-- ================================================================
-- ETAPA 2 · Script 1 — Rodar manualmente UMA vez:
--   docker compose exec -T db psql -U certsaas -d certsaas < db/seed/10_app_role.sql
--
-- 1) Cria o usuário de banco da APLICAÇÃO (api_app).
--    Motivo: o usuário 'certsaas' criado pelo container é SUPERUSUÁRIO,
--    e superusuário IGNORA Row-Level Security. Conectando como api_app,
--    o isolamento multiempresa passa a valer de verdade.
-- 2) Cria a função de login (SECURITY DEFINER), necessária porque
--    antes do login não há tenant na sessão e o RLS bloquearia a
--    leitura da tabela usuario.
-- 3) Migração: coluna 'ativo' em cliente.
-- ================================================================

-- ⚠️ EDITE A SENHA ABAIXO antes de rodar (a mesma vai no .env em APP_DB_PASSWORD)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'api_app') THEN
        CREATE ROLE api_app LOGIN PASSWORD 'EDITE_AQUI_senha_do_api_app';
    END IF;
END $$;

GRANT USAGE ON SCHEMA public TO api_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO api_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO api_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO api_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO api_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO api_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT EXECUTE ON FUNCTIONS TO api_app;

-- ── Função de login ─────────────────────────────────────────────
-- SECURITY DEFINER: executa com os privilégios de quem a criou
-- (o superusuário), permitindo achar o usuário pelo email antes de
-- existir tenant na sessão. Retorna apenas o necessário pro login.
CREATE OR REPLACE FUNCTION auth_buscar_usuario(p_email text)
RETURNS TABLE (
    id             uuid,
    empresa_id     uuid,
    nome           text,
    papel          text,
    senha_hash     text,
    ativo          boolean,
    empresa        text,
    empresa_status text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT u.id, u.empresa_id, u.nome, u.papel, u.senha_hash, u.ativo,
           e.razao_social, e.status
      FROM usuario u
      JOIN empresa e ON e.id = u.empresa_id
     WHERE lower(u.email) = lower(p_email)
     LIMIT 1
$$;

REVOKE ALL ON FUNCTION auth_buscar_usuario(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_buscar_usuario(text) TO api_app;

-- ── Migração: soft-delete de cliente ────────────────────────────
ALTER TABLE cliente ADD COLUMN IF NOT EXISTS ativo boolean NOT NULL DEFAULT true;

SELECT 'app_role e função de login criados com sucesso' AS resultado;
