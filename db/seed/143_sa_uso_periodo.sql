-- Monitor de uso: serie historica de emissoes por empresa e periodo,
-- com agrupamento dia/semana/mes. SECURITY DEFINER (cross-empresa).
-- Joao, 22/08/2026.
CREATE OR REPLACE FUNCTION public.sa_uso_periodo(
    p_de date, p_ate date, p_grupo text DEFAULT 'dia', p_empresa uuid DEFAULT NULL)
 RETURNS TABLE(periodo date, empresa_id uuid, empresa text, qtd bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT date_trunc(CASE WHEN p_grupo IN ('dia','semana','mes') THEN
                           CASE p_grupo WHEN 'dia' THEN 'day'
                                        WHEN 'semana' THEN 'week'
                                        ELSE 'month' END
                      ELSE 'day' END, ct.data_emissao)::date AS periodo,
           ct.empresa_id, e.razao_social, count(*) AS qtd
      FROM certificado ct
      JOIN empresa e ON e.id = ct.empresa_id
     WHERE ct.status IN ('emitido','substituido')
       AND ct.data_emissao::date BETWEEN p_de AND p_ate
       AND (p_empresa IS NULL OR ct.empresa_id = p_empresa)
     GROUP BY 1, 2, 3
     ORDER BY 1, 3
$function$;
GRANT EXECUTE ON FUNCTION public.sa_uso_periodo(date, date, text, uuid) TO certsaas, api_app;
