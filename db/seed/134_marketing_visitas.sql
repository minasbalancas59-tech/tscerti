-- 134: contador de visitas à landing vindas do sistema.
-- Só agregado por dia e origem — sem IP, sem identificação de pessoa.
-- Interessa saber SE a estratégia funciona, não quem clicou.
BEGIN;

CREATE TABLE IF NOT EXISTS marketing_visita (
    dia    date NOT NULL,
    origem text NOT NULL,
    visitas bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (dia, origem)
);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'api_app') THEN
        GRANT SELECT, INSERT, UPDATE ON TABLE marketing_visita TO api_app;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.marketing_registrar_visita(p_origem text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    INSERT INTO marketing_visita (dia, origem, visitas)
    VALUES (current_date, left(coalesce(nullif(trim(p_origem), ''), 'direto'), 30), 1)
    ON CONFLICT (dia, origem) DO UPDATE SET visitas = marketing_visita.visitas + 1;
$function$;

-- Resumo para o super-admin
CREATE OR REPLACE FUNCTION public.sa_marketing_visitas(p_dias integer DEFAULT 90)
 RETURNS TABLE(origem text, total bigint, ultimos_30 bigint,
               primeiro date, ultimo date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT origem, sum(visitas),
           sum(visitas) FILTER (WHERE dia >= current_date - 30),
           min(dia), max(dia)
      FROM marketing_visita
     WHERE dia >= current_date - p_dias
     GROUP BY origem
     ORDER BY 2 DESC;
$function$;

COMMIT;
\echo '--- pronto ---'
SELECT 'marketing_visita criada' AS status;
