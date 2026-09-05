-- Painel de USO DIÁRIO: quem entrou no sistema em um dia, agrupado por
-- empresa. Serve para acompanhar a adoção — principalmente das empresas
-- em trial, onde a falta de acesso é o primeiro sinal de que o cliente
-- não engatou. João, 05/09/2026.

DROP FUNCTION IF EXISTS sa_uso_dia(date);

CREATE FUNCTION sa_uso_dia(p_dia date DEFAULT CURRENT_DATE)
RETURNS TABLE(
    empresa_id       uuid,
    empresa          text,
    plano            text,
    empresa_status   text,
    usuarios_ativos  int,      -- quantos usuários distintos entraram
    total_logins     int,      -- entradas bem-sucedidas
    falhas           int,      -- tentativas que falharam
    primeiro_acesso  timestamptz,
    ultimo_acesso    timestamptz,
    certificados_dia int,      -- calibrações criadas no mesmo dia
    usuarios         jsonb     -- detalhe: nome, e-mail, papel, nº de acessos
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
               count(*) FILTER (WHERE l.acao = 'login_ok')::int AS acessos,
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
    )
    SELECT
        e.id,
        COALESCE(NULLIF(e.nome_fantasia, ''), e.razao_social),
        e.plano,
        e.status,
        count(DISTINCT l.usuario_id) FILTER (WHERE l.acao = 'login_ok')::int,
        count(*) FILTER (WHERE l.acao = 'login_ok')::int,
        count(*) FILTER (WHERE l.acao <> 'login_ok')::int,
        min(l.criado_em) FILTER (WHERE l.acao = 'login_ok'),
        max(l.criado_em) FILTER (WHERE l.acao = 'login_ok'),
        COALESCE(max(ct.qtd), 0),
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
      JOIN empresa e  ON e.id = l.empresa_id
      LEFT JOIN certs ct ON ct.empresa_id = e.id
     GROUP BY e.id, e.nome_fantasia, e.razao_social, e.plano, e.status
     -- trial primeiro: é onde o acompanhamento importa mais
     ORDER BY (e.plano = 'trial') DESC, max(l.criado_em) DESC
$function$;

REVOKE ALL ON FUNCTION sa_uso_dia(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sa_uso_dia(date) TO api_app;

-- Empresas em trial que NÃO acessaram no período: o outro lado da moeda,
-- e o que realmente indica risco de abandono.
DROP FUNCTION IF EXISTS sa_trial_sem_acesso(int);

CREATE FUNCTION sa_trial_sem_acesso(p_dias int DEFAULT 7)
RETURNS TABLE(
    empresa_id      uuid,
    empresa         text,
    plano           text,
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
       AND (ult.quando IS NULL OR ult.quando < now() - make_interval(days => p_dias))
     ORDER BY (e.plano = 'trial') DESC, ult.quando NULLS FIRST
$function$;

REVOKE ALL ON FUNCTION sa_trial_sem_acesso(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sa_trial_sem_acesso(int) TO api_app;

SELECT 'Migração 153: sa_uso_dia + sa_trial_sem_acesso' AS resultado;
