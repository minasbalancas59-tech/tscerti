-- ═══════════════════════════════════════════════════════════
-- 49 · Log de logins (super-admin)
--   Consulta os eventos de login já registrados em log_auditoria
--   (login_ok, login_falha, login_bloqueado), juntando os dados
--   de cadastro do usuário e da empresa. Filtro por e-mail.
-- ═══════════════════════════════════════════════════════════

-- Índice para acelerar a consulta por ações de login
CREATE INDEX IF NOT EXISTS idx_log_login
    ON log_auditoria (acao, criado_em DESC)
    WHERE acao IN ('login_ok', 'login_falha', 'login_bloqueado');

-- ── Log de logins com dados do usuário (super-admin) ────────
-- Filtros opcionais: e-mail/nome, empresa, papel, resultado, período.
DROP FUNCTION IF EXISTS sa_logins(text, int);
DROP FUNCTION IF EXISTS sa_logins(text, uuid, text, text, timestamptz, timestamptz, int);
CREATE FUNCTION sa_logins(
    p_busca text DEFAULT NULL,         -- e-mail ou nome (ILIKE)
    p_empresa uuid DEFAULT NULL,       -- id da empresa
    p_papel text DEFAULT NULL,         -- admin/responsavel_tecnico/tecnico/super_admin
    p_resultado text DEFAULT NULL,     -- login_ok/login_falha/login_bloqueado
    p_de timestamptz DEFAULT NULL,     -- início do período
    p_ate timestamptz DEFAULT NULL,    -- fim do período
    p_limite int DEFAULT 300
)
RETURNS TABLE (
    id bigint,
    ocorrido_em timestamptz,
    acao text,
    ip text,
    detalhe jsonb,
    usuario_id uuid,
    nome text,
    email text,
    papel text,
    usuario_ativo boolean,
    empresa text,
    empresa_status text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT
        la.id, la.criado_em, la.acao, la.ip_origem, la.dados_depois,
        u.id, u.nome, u.email, u.papel, u.ativo,
        e.razao_social, e.status
      FROM log_auditoria la
      LEFT JOIN usuario u ON u.id = la.usuario_id
      LEFT JOIN empresa e ON e.id = la.empresa_id
     WHERE la.acao IN ('login_ok', 'login_falha', 'login_bloqueado')
       AND (p_busca     IS NULL OR u.email ILIKE '%' || p_busca || '%'
                                 OR u.nome  ILIKE '%' || p_busca || '%')
       AND (p_empresa   IS NULL OR la.empresa_id = p_empresa)
       AND (p_papel     IS NULL OR u.papel = p_papel)
       AND (p_resultado IS NULL OR la.acao = p_resultado)
       AND (p_de        IS NULL OR la.criado_em >= p_de)
       AND (p_ate       IS NULL OR la.criado_em <= p_ate)
     ORDER BY la.criado_em DESC
     LIMIT p_limite
$$;

-- Lista de empresas para o seletor do filtro
DROP FUNCTION IF EXISTS sa_empresas_filtro();
CREATE FUNCTION sa_empresas_filtro()
RETURNS TABLE (id uuid, razao_social text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT id, razao_social FROM empresa ORDER BY razao_social
$$;

-- ── Detalhe completo do cadastro de um usuário (super-admin) ─
DROP FUNCTION IF EXISTS sa_usuario_detalhe(uuid);
CREATE FUNCTION sa_usuario_detalhe(p_id uuid)
RETURNS TABLE (
    id uuid, nome text, email text, papel text, ativo boolean,
    criado_em timestamptz, empresa text, empresa_cnpj text,
    empresa_status text, ultimo_login timestamptz, total_logins bigint
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT
        u.id, u.nome, u.email, u.papel, u.ativo,
        u.criado_em, e.razao_social, e.cnpj, e.status,
        (SELECT max(la.criado_em) FROM log_auditoria la
          WHERE la.usuario_id = u.id AND la.acao = 'login_ok'),
        (SELECT count(*) FROM log_auditoria la
          WHERE la.usuario_id = u.id AND la.acao = 'login_ok')
      FROM usuario u
      LEFT JOIN empresa e ON e.id = u.empresa_id
     WHERE u.id = p_id
$$;

SELECT 'log de logins para o super-admin adicionado' AS resultado;
