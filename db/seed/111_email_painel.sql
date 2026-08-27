-- 111: painel de e-mails para o super-admin — tudo numa chamada (jsonb).
CREATE OR REPLACE FUNCTION public.sa_email_painel(p_dias integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH base AS (
    SELECT el.id, el.empresa_id, el.destinatario, el.motivo, el.status,
           el.erro_detalhe, el.enviado_em, el.assunto,
           coalesce(e.razao_social, '(sem empresa)') AS empresa
      FROM email_log el
      LEFT JOIN empresa e ON e.id = el.empresa_id
     WHERE el.enviado_em >= current_date - make_interval(days => p_dias)
),
hoje AS (
    SELECT count(*) AS total, count(*) FILTER (WHERE status = 'erro') AS erros
      FROM base WHERE enviado_em::date = current_date
),
ontem AS (
    SELECT count(*) AS total, count(*) FILTER (WHERE status = 'erro') AS erros
      FROM base WHERE enviado_em::date = current_date - 1
),
periodo AS (
    SELECT count(*) AS total, count(*) FILTER (WHERE status = 'erro') AS erros,
           count(DISTINCT destinatario) AS destinatarios,
           count(DISTINCT empresa_id) AS empresas
      FROM base
),
por_empresa AS (
    SELECT empresa, count(*) AS total,
           count(*) FILTER (WHERE status = 'erro') AS erros,
           count(DISTINCT destinatario) AS destinatarios,
           max(enviado_em) AS ultimo
      FROM base GROUP BY 1 ORDER BY count(*) DESC LIMIT 40
),
por_motivo AS (
    SELECT coalesce(motivo, '-') AS motivo, count(*) AS total,
           count(*) FILTER (WHERE status = 'erro') AS erros
      FROM base GROUP BY 1 ORDER BY count(*) DESC LIMIT 30
),
por_status AS (
    SELECT coalesce(status, '-') AS status, count(*) AS total
      FROM base GROUP BY 1 ORDER BY count(*) DESC
),
serie AS (   -- ultimos 14 dias, independente do filtro de periodo
    SELECT g::date AS dia,
           count(el.id) AS total,
           count(el.id) FILTER (WHERE el.status = 'erro') AS erros
      FROM generate_series(current_date - 13, current_date, interval '1 day') g
      LEFT JOIN email_log el ON el.enviado_em::date = g::date
     GROUP BY 1 ORDER BY 1
),
por_hora AS (  -- distribuicao de HOJE por hora
    SELECT extract(hour FROM enviado_em)::int AS hora, count(*) AS total
      FROM base WHERE enviado_em::date = current_date
     GROUP BY 1 ORDER BY 1
),
falhas AS (
    SELECT enviado_em, destinatario, coalesce(motivo, '-') AS motivo,
           left(coalesce(erro_detalhe, 'sem detalhe'), 180) AS erro,
           empresa, left(coalesce(assunto, ''), 80) AS assunto
      FROM base WHERE status = 'erro'
     ORDER BY enviado_em DESC LIMIT 25
),
top_falhas AS (   -- enderecos que falham SEMPRE = cadastro errado
    SELECT destinatario, count(*) AS qtd, max(enviado_em) AS ultimo,
           string_agg(DISTINCT empresa, ' · ') AS empresas
      FROM base WHERE status = 'erro'
     GROUP BY 1 HAVING count(*) >= 2
     ORDER BY count(*) DESC LIMIT 12
)
SELECT jsonb_build_object(
    'dias', p_dias,
    'hoje', (SELECT to_jsonb(h) FROM hoje h),
    'ontem', (SELECT to_jsonb(o) FROM ontem o),
    'periodo', (SELECT to_jsonb(p) FROM periodo p),
    'por_empresa', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM por_empresa x), '[]'::jsonb),
    'por_motivo', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM por_motivo x), '[]'::jsonb),
    'por_status', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM por_status x), '[]'::jsonb),
    'serie', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM serie x), '[]'::jsonb),
    'por_hora', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM por_hora x), '[]'::jsonb),
    'falhas', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM falhas x), '[]'::jsonb),
    'top_falhas', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM top_falhas x), '[]'::jsonb)
);
$function$;
