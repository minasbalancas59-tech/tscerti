-- ═══════════════════════════════════════════════════════════
-- 59 · Log robusto de usuários (super-admin)
--   1) sa_usuarios_completo — cadastro de TODOS os usuários com
--      empresa, papel, status, datas e contadores de atividade.
--   2) sa_atividade_usuarios — histórico de ações (login + auditoria)
--      de todos os usuários, com filtros. Mais amplo que sa_logins.
--   Ambas alimentam a exportação (CSV/Excel) no super-admin.
-- ═══════════════════════════════════════════════════════════

-- ── 1. Cadastro completo de usuários ────────────────────────
CREATE OR REPLACE FUNCTION sa_usuarios_completo(
    p_busca text DEFAULT NULL,       -- nome ou e-mail (ILIKE)
    p_empresa uuid DEFAULT NULL,
    p_papel text DEFAULT NULL,
    p_ativo boolean DEFAULT NULL      -- true=ativos, false=inativos, null=todos
)
RETURNS TABLE (
    usuario_id uuid, nome text, email text, papel text, registro_prof text,
    ativo boolean, empresa text, empresa_id uuid, criado_em timestamptz,
    ultimo_login timestamptz, total_logins bigint, certificados_emitidos bigint
) LANGUAGE sql STABLE AS $$
    SELECT u.id, u.nome, u.email, u.papel, u.registro_prof,
           u.ativo, e.razao_social, e.id, u.criado_em,
           (SELECT max(la.criado_em) FROM log_auditoria la
             WHERE la.usuario_id = u.id AND la.acao = 'login'),
           (SELECT count(*) FROM log_auditoria la
             WHERE la.usuario_id = u.id AND la.acao = 'login'),
           (SELECT count(*) FROM certificado ct
             WHERE ct.tecnico_id = u.id AND ct.status = 'emitido')
      FROM usuario u
      JOIN empresa e ON e.id = u.empresa_id
     WHERE (p_busca IS NULL OR u.nome ILIKE '%'||p_busca||'%' OR u.email ILIKE '%'||p_busca||'%')
       AND (p_empresa IS NULL OR u.empresa_id = p_empresa)
       AND (p_papel IS NULL OR u.papel = p_papel)
       AND (p_ativo IS NULL OR u.ativo = p_ativo)
     ORDER BY e.razao_social, u.nome;
$$;

-- ── 2. Histórico de atividade (login + ações de auditoria) ──
CREATE OR REPLACE FUNCTION sa_atividade_usuarios(
    p_busca text DEFAULT NULL,       -- nome ou e-mail do usuário
    p_empresa uuid DEFAULT NULL,
    p_usuario uuid DEFAULT NULL,     -- filtrar um usuário específico
    p_acao text DEFAULT NULL,        -- login, insert, update, delete, emissao...
    p_de timestamptz DEFAULT NULL,
    p_ate timestamptz DEFAULT NULL,
    p_limite int DEFAULT 1000
)
RETURNS TABLE (
    id bigint, ocorrido_em timestamptz, acao text, entidade text,
    entidade_id uuid, ip text, usuario_id uuid, nome text, email text,
    papel text, empresa text
) LANGUAGE sql STABLE AS $$
    SELECT la.id, la.criado_em, la.acao, la.entidade, la.entidade_id,
           la.ip_origem, u.id, u.nome, u.email, u.papel, e.razao_social
      FROM log_auditoria la
      LEFT JOIN usuario u ON u.id = la.usuario_id
      LEFT JOIN empresa e ON e.id = la.empresa_id
     WHERE (p_busca IS NULL OR u.nome ILIKE '%'||p_busca||'%' OR u.email ILIKE '%'||p_busca||'%')
       AND (p_empresa IS NULL OR la.empresa_id = p_empresa)
       AND (p_usuario IS NULL OR la.usuario_id = p_usuario)
       AND (p_acao IS NULL OR la.acao = p_acao)
       AND (p_de  IS NULL OR la.criado_em >= p_de)
       AND (p_ate IS NULL OR la.criado_em <  p_ate)
     ORDER BY la.criado_em DESC
     LIMIT p_limite;
$$;

SELECT 'log robusto de usuários criado' AS resultado;
