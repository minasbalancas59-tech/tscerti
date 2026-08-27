-- 107: registro DO QUE FOI FEITO para corrigir cada erro + resolucao em lote
--      por IDs ou por PADRAO (mesmo erro repetido centenas de vezes).

ALTER TABLE erro_sistema ADD COLUMN IF NOT EXISTS correcao text;
ALTER TABLE erro_sistema ADD COLUMN IF NOT EXISTS corrigido_em timestamptz;

-- Resolve uma lista de IDs registrando a correcao aplicada
CREATE OR REPLACE FUNCTION public.sa_resolver_erros(p_ids bigint[], p_correcao text)
 RETURNS bigint
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    WITH upd AS (
        UPDATE erro_sistema
           SET resolvido = true,
               correcao = NULLIF(trim(p_correcao), ''),
               corrigido_em = now()
         WHERE id = ANY(p_ids)
         RETURNING 1)
    SELECT count(*) FROM upd;
$function$;

-- Resolve TODOS os erros que casam com um padrao (tipo/rota/trecho da
-- mensagem). Parametros NULL sao ignorados. Ideal para o mesmo erro repetido.
CREATE OR REPLACE FUNCTION public.sa_resolver_padrao(
    p_tipo text, p_rota text, p_mensagem_como text, p_correcao text)
 RETURNS bigint
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    WITH upd AS (
        UPDATE erro_sistema
           SET resolvido = true,
               correcao = NULLIF(trim(p_correcao), ''),
               corrigido_em = now()
         WHERE resolvido = false
           AND (p_tipo IS NULL OR tipo = p_tipo)
           AND (p_rota IS NULL OR rota = p_rota)
           AND (p_mensagem_como IS NULL OR mensagem ILIKE '%' || p_mensagem_como || '%')
         RETURNING 1)
    SELECT count(*) FROM upd;
$function$;

-- Exportacao para analise: erros abertos agrupados, com um exemplo de detalhe
CREATE OR REPLACE FUNCTION public.sa_erros_exportar(p_horas integer DEFAULT 168)
 RETURNS TABLE(tipo text, metodo text, rota text, mensagem text,
               qtd bigint, primeiro timestamptz, ultimo timestamptz,
               ids bigint[], detalhe_exemplo text, empresas text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT coalesce(e.tipo, '-'), coalesce(e.metodo, ''), coalesce(e.rota, '-'),
           coalesce(e.mensagem, ''),
           count(*), min(e.ocorrido_em), max(e.ocorrido_em),
           array_agg(e.id ORDER BY e.id),
           (array_agg(e.detalhe ORDER BY e.ocorrido_em DESC))[1],
           string_agg(DISTINCT emp.razao_social, ' · ')
      FROM erro_sistema e
      LEFT JOIN empresa emp ON emp.id = e.empresa_id
     WHERE e.resolvido = false
       AND e.ocorrido_em >= now() - make_interval(hours => p_horas)
     GROUP BY 1, 2, 3, 4
     ORDER BY count(*) DESC, max(e.ocorrido_em) DESC;
$function$;

-- A funcao sa_erros() tem tipo de retorno FIXO e nao devolveria as colunas
-- novas (correcao/corrigido_em). Nova versao para a tela, sem mexer na
-- original (que pode estar em uso em outro lugar).
CREATE OR REPLACE FUNCTION public.sa_erros_v2(p_abertos boolean DEFAULT false,
                                              p_limite integer DEFAULT 200)
 RETURNS TABLE(id bigint, ocorrido_em timestamptz, tipo text, metodo text,
               rota text, mensagem text, detalhe text, resolvido boolean,
               correcao text, corrigido_em timestamptz, empresa text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT e.id, e.ocorrido_em, e.tipo, e.metodo, e.rota, e.mensagem, e.detalhe,
           e.resolvido, e.correcao, e.corrigido_em, emp.razao_social
      FROM erro_sistema e
      LEFT JOIN empresa emp ON emp.id = e.empresa_id
     WHERE (p_abertos IS NOT TRUE OR e.resolvido = false)
     ORDER BY e.ocorrido_em DESC
     LIMIT LEAST(p_limite, 500);
$function$;
