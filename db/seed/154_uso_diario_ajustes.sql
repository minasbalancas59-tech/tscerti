-- Ajustes na tela de uso diário (João, 05/09/2026):
--
-- 1. "trial" passa a ser decidido pelo CONTRATO, não pelo campo plano.
--    A IMPERIUM aparecia como trial tendo contrato ativo: o campo plano
--    só é atualizado quando alguém edita o contrato na tela, então fica
--    desatualizado. É a mesma divergência já corrigida em 12/08 na lista
--    de empresas. Empresa sem contrato vigente = em avaliação.
--
-- 2. A empresa SISTEMA (a do super-admin) sai das duas listas: ela não é
--    cliente e só polui o acompanhamento.

DROP FUNCTION IF EXISTS sa_uso_dia(date);

CREATE FUNCTION sa_uso_dia(p_dia date DEFAULT CURRENT_DATE)
RETURNS TABLE(
    empresa_id       uuid,
    empresa          text,
    plano            text,
    em_trial         boolean,
    empresa_status   text,
    usuarios_ativos  int,
    total_logins     int,
    falhas           int,
    primeiro_acesso  timestamptz,
    ultimo_acesso    timestamptz,
    certificados_dia int,
    usuarios         jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
    WITH logins AS (
        SELECT la.empresa_id, la.usuario_id, la.acao, la.criado_em
          FROM log_auditoria la
         WHERE la.acao IN ('login_ok', 'login_falha', 'login_bloqueado')
           AND la.criado_em >= p_dia::timestamptz
           AND la.criado_em <  (p_dia + 1)::timestamptz
    ),
    por_usuario AS (
        SELECT l.empresa_id, l.usuario_id,
               count(*)::int AS acessos,
               max(l.criado_em) AS ultimo
          FROM logins l
         WHERE l.usuario_id IS NOT NULL AND l.acao = 'login_ok'
         GROUP BY l.empresa_id, l.usuario_id
    ),
    certs AS (
        SELECT c.empresa_id, count(*)::int AS qtd
          FROM certificado c
         WHERE c.criado_em >= p_dia::timestamptz
           AND c.criado_em <  (p_dia + 1)::timestamptz
         GROUP BY c.empresa_id
    ),
    com_contrato AS (
        -- Mesmo critério da lista de empresas (migração 147): contrato ativo.
        -- Não usar o campo empresa.plano: ele só é atualizado quando alguém
        -- edita o contrato na tela e fica desatualizado — foi o que fez a
        -- IMPERIUM aparecer como trial tendo contrato.
        SELECT DISTINCT ct.empresa_id FROM contrato ct WHERE ct.ativo
    )
    SELECT
        e.id,
        COALESCE(NULLIF(e.nome_fantasia, ''), e.razao_social),
        e.plano,
        (cc.empresa_id IS NULL),   -- sem contrato vigente = em avaliação
        e.status,
        count(DISTINCT l.usuario_id) FILTER (WHERE l.acao = 'login_ok')::int,
        count(*) FILTER (WHERE l.acao = 'login_ok')::int,
        count(*) FILTER (WHERE l.acao <> 'login_ok')::int,
        min(l.criado_em) FILTER (WHERE l.acao = 'login_ok'),
        max(l.criado_em) FILTER (WHERE l.acao = 'login_ok'),
        COALESCE(max(ct2.qtd), 0),
        COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                       'nome', u.nome, 'email', u.email, 'papel', u.papel,
                       'acessos', pu.acessos, 'ultimo', pu.ultimo)
                     ORDER BY pu.ultimo DESC)
              FROM por_usuario pu
              JOIN usuario u ON u.id = pu.usuario_id
             WHERE pu.empresa_id = e.id
        ), '[]'::jsonb)
      FROM logins l
      JOIN empresa e ON e.id = l.empresa_id
      LEFT JOIN certs ct2       ON ct2.empresa_id = e.id
      LEFT JOIN com_contrato cc ON cc.empresa_id  = e.id
     -- A empresa do super-admin não é cliente: fora do acompanhamento
     WHERE upper(e.razao_social) <> 'SISTEMA'
     GROUP BY e.id, e.nome_fantasia, e.razao_social, e.plano, e.status, cc.empresa_id
     ORDER BY (cc.empresa_id IS NULL) DESC, max(l.criado_em) DESC
$function$;

REVOKE ALL ON FUNCTION sa_uso_dia(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sa_uso_dia(date) TO api_app;


DROP FUNCTION IF EXISTS sa_trial_sem_acesso(int);

CREATE FUNCTION sa_trial_sem_acesso(p_dias int DEFAULT 7)
RETURNS TABLE(
    empresa_id      uuid,
    empresa         text,
    plano           text,
    em_trial        boolean,
    criada_em       timestamptz,
    ultimo_acesso   timestamptz,
    dias_sem_acesso int,
    certificados    int
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
    SELECT e.id,
           COALESCE(NULLIF(e.nome_fantasia, ''), e.razao_social),
           e.plano,
           NOT EXISTS (SELECT 1 FROM contrato ct
                        WHERE ct.empresa_id = e.id AND ct.ativo),
           e.criado_em,
           ult.quando,
           CASE WHEN ult.quando IS NULL THEN NULL
                ELSE EXTRACT(day FROM now() - ult.quando)::int END,
           COALESCE(c.qtd, 0)
      FROM empresa e
      LEFT JOIN LATERAL (
            SELECT max(la.criado_em) AS quando
              FROM log_auditoria la
             WHERE la.empresa_id = e.id AND la.acao = 'login_ok'
      ) ult ON true
      LEFT JOIN LATERAL (
            SELECT count(*)::int AS qtd FROM certificado ct WHERE ct.empresa_id = e.id
      ) c ON true
     WHERE e.status = 'ativa'
       AND upper(e.razao_social) <> 'SISTEMA'
       AND (ult.quando IS NULL OR ult.quando < now() - make_interval(days => p_dias))
     ORDER BY 4 DESC, ult.quando NULLS FIRST
$function$;

REVOKE ALL ON FUNCTION sa_trial_sem_acesso(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sa_trial_sem_acesso(int) TO api_app;

SELECT 'Migração 154: uso diário — trial pelo contrato, sem a empresa SISTEMA' AS resultado;
