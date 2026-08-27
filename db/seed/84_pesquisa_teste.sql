-- 84: envios de TESTE (modo='teste') ficam fora das estatísticas do NPS.
-- pesquisa_por_token e pesquisa_responder NÃO filtram: o link de teste
-- precisa abrir e poder ser respondido para validar o fluxo ponta a ponta.

CREATE OR REPLACE FUNCTION public.pesquisa_nps_resumo(p_de timestamptz DEFAULT NULL, p_ate timestamptz DEFAULT NULL)
 RETURNS TABLE(respostas bigint, promotores bigint, neutros bigint, detratores bigint, nps numeric, enviadas bigint, taxa_resposta numeric)
 LANGUAGE sql STABLE
AS $function$
    WITH base AS (
        SELECT nps_nota, respondido_em FROM pesquisa_envio
         WHERE empresa_id = current_empresa_id()
           AND modo <> 'teste'
           AND (p_de  IS NULL OR enviado_em >= p_de)
           AND (p_ate IS NULL OR enviado_em <  p_ate)
    ), resp AS (SELECT nps_nota FROM base WHERE respondido_em IS NOT NULL AND nps_nota IS NOT NULL)
    SELECT
        (SELECT count(*) FROM resp),
        (SELECT count(*) FROM resp WHERE nps_nota >= 9),
        (SELECT count(*) FROM resp WHERE nps_nota BETWEEN 7 AND 8),
        (SELECT count(*) FROM resp WHERE nps_nota <= 6),
        CASE WHEN (SELECT count(*) FROM resp) > 0 THEN
            round(100.0 * ((SELECT count(*) FROM resp WHERE nps_nota >= 9)
                         - (SELECT count(*) FROM resp WHERE nps_nota <= 6))
                  / (SELECT count(*) FROM resp), 1)
        ELSE NULL END,
        (SELECT count(*) FROM base),
        CASE WHEN (SELECT count(*) FROM base) > 0 THEN
            round(100.0 * (SELECT count(*) FROM resp) / (SELECT count(*) FROM base), 1)
        ELSE NULL END;
$function$;

CREATE OR REPLACE FUNCTION public.pesquisa_nps_evolucao(p_meses integer DEFAULT 12)
 RETURNS TABLE(mes text, respostas bigint, nps numeric)
 LANGUAGE sql STABLE
AS $function$
    SELECT to_char(date_trunc('month', respondido_em), 'YYYY-MM'),
           count(*),
           CASE WHEN count(*) > 0 THEN
               round(100.0 * (count(*) FILTER (WHERE nps_nota >= 9)
                            - count(*) FILTER (WHERE nps_nota <= 6)) / count(*), 1)
           ELSE NULL END
      FROM pesquisa_envio
     WHERE empresa_id = current_empresa_id()
       AND modo <> 'teste'
       AND respondido_em IS NOT NULL AND nps_nota IS NOT NULL
       AND respondido_em >= date_trunc('month', now()) - make_interval(months => p_meses - 1)
     GROUP BY date_trunc('month', respondido_em)
     ORDER BY date_trunc('month', respondido_em);
$function$;

CREATE OR REPLACE FUNCTION public.pesquisa_medias_dimensao(p_de timestamptz DEFAULT NULL, p_ate timestamptz DEFAULT NULL)
 RETURNS TABLE(pergunta text, tipo text, respostas bigint, media numeric)
 LANGUAGE sql STABLE
AS $function$
    SELECT p.texto, p.tipo, count(r.nota), round(avg(r.nota), 1)
      FROM pesquisa_pergunta p
      LEFT JOIN pesquisa_resposta r ON r.pergunta_id = p.id
      LEFT JOIN pesquisa_envio e ON e.id = r.envio_id
     WHERE p.empresa_id = current_empresa_id()
       AND (r.id IS NULL OR (
           e.modo <> 'teste' AND
           (p_de  IS NULL OR e.enviado_em >= p_de) AND
           (p_ate IS NULL OR e.enviado_em <  p_ate)))
     GROUP BY p.id, p.texto, p.tipo, p.ordem
     ORDER BY p.ordem;
$function$;

CREATE OR REPLACE FUNCTION public.pesquisa_respostas_lista(p_de timestamptz DEFAULT NULL, p_ate timestamptz DEFAULT NULL, p_limite integer DEFAULT 1000)
 RETURNS TABLE(respondido_em timestamptz, cliente text, nps_nota integer, comentario text, anonima boolean)
 LANGUAGE sql STABLE
AS $function$
    SELECT e.respondido_em,
           CASE WHEN emp.pesquisa_anonima THEN NULL ELSE c.razao_social END,
           e.nps_nota, e.comentario, emp.pesquisa_anonima
      FROM pesquisa_envio e
      JOIN empresa emp ON emp.id = e.empresa_id
      LEFT JOIN cliente c ON c.id = e.cliente_id
     WHERE e.empresa_id = current_empresa_id()
       AND e.modo <> 'teste'
       AND e.respondido_em IS NOT NULL
       AND (p_de  IS NULL OR e.enviado_em >= p_de)
       AND (p_ate IS NULL OR e.enviado_em <  p_ate)
     ORDER BY e.respondido_em DESC
     LIMIT p_limite;
$function$;
