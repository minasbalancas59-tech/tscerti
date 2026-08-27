-- 119: registro do TESTE DE RESTAURACAO do backup, para o worker avisar
-- junto com os resumos das 7h.
CREATE TABLE IF NOT EXISTS backup_teste (
    id            bigserial PRIMARY KEY,
    executado_em  timestamptz NOT NULL DEFAULT now(),
    arquivo       text,
    dump_em       timestamptz,
    resultado     text NOT NULL CHECK (resultado IN ('ok', 'falha')),
    problemas     integer NOT NULL DEFAULT 0,
    erros_psql    integer NOT NULL DEFAULT 0,
    total_restaurado integer NOT NULL DEFAULT 0,
    detalhe       text,
    avisado_em    timestamptz          -- quando o worker mandou o e-mail
);
CREATE INDEX IF NOT EXISTS idx_backup_teste_data ON backup_teste(executado_em DESC);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'api_app') THEN
        GRANT SELECT, INSERT, UPDATE ON TABLE backup_teste TO api_app;
        GRANT USAGE, SELECT ON SEQUENCE backup_teste_id_seq TO api_app;
    END IF;
END $$;

-- Chamada pelo script de teste
CREATE OR REPLACE FUNCTION public.registrar_teste_backup(
    p_arquivo text, p_dump_em timestamptz, p_resultado text,
    p_problemas integer, p_erros integer, p_total integer, p_detalhe text)
 RETURNS bigint
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    INSERT INTO backup_teste (arquivo, dump_em, resultado, problemas,
                              erros_psql, total_restaurado, detalhe)
    VALUES (p_arquivo, p_dump_em, p_resultado, p_problemas, p_erros, p_total, p_detalhe)
    RETURNING id;
$function$;

-- Usada pelo worker: ha teste novo para avisar? ha teste vencido?
CREATE OR REPLACE FUNCTION public.backup_teste_pendente()
 RETURNS TABLE(id bigint, executado_em timestamptz, arquivo text, dump_em timestamptz,
               resultado text, problemas integer, erros_psql integer,
               total_restaurado integer, detalhe text,
               dias_desde_ultimo_ok integer, motivo text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    -- (a) teste executado e ainda nao avisado
    SELECT t.id, t.executado_em, t.arquivo, t.dump_em, t.resultado, t.problemas,
           t.erros_psql, t.total_restaurado, t.detalhe,
           (current_date - (SELECT max(executado_em)::date FROM backup_teste
                             WHERE resultado = 'ok'))::int,
           'novo'::text
      FROM backup_teste t
     WHERE t.avisado_em IS NULL
     ORDER BY t.executado_em DESC
     LIMIT 1;
$function$;

-- Ha quantos dias nao passa um teste? (para o lembrete)
CREATE OR REPLACE FUNCTION public.backup_teste_atraso()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT COALESCE(
        (current_date - (SELECT max(executado_em)::date
                           FROM backup_teste WHERE resultado = 'ok'))::int,
        9999);   -- 9999 = nunca houve teste bem-sucedido
$function$;

CREATE OR REPLACE FUNCTION public.backup_teste_marcar_avisado(p_id bigint)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    UPDATE backup_teste SET avisado_em = now() WHERE id = p_id RETURNING true;
$function$;
