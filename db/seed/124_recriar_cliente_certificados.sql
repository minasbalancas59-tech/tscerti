-- 124: RECRIA cliente_certificados — e desta vez DENTRO DE UMA TRANSAÇÃO.
--
-- O QUE DEU ERRADO: a migração 122 fazia DROP e depois CREATE, soltos. Se o
-- CREATE falhar (por qualquer motivo), o DROP já aconteceu e o sistema fica
-- SEM a função — foi o que derrubou a aba "Meus certificados" do portal.
-- Com BEGIN/COMMIT, uma falha no CREATE desfaz o DROP: ou tudo funciona, ou
-- nada muda. Nunca mais fica no meio do caminho.

BEGIN;

DROP FUNCTION IF EXISTS public.cliente_certificados(text);

CREATE FUNCTION public.cliente_certificados(p_documento text)
 RETURNS TABLE(id uuid, numero text, data_calibracao date,
               balanca text, num_serie text, marca text, modelo text,
               empresa text, tem_pdf boolean,
               periodicidade_meses integer, vence_em date,
               uuid_validacao uuid, dados_balanca jsonb,
               status text, cancelado_em timestamptz, motivo_cancelamento text,
               substituido_por text, revisao_de text,
               numero_lacre text, selo_inmetro text, acreditado boolean,
               local_tipo text, local_detalhe text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT ct.id, ct.numero, ct.data_calibracao,
           b.identificacao, b.num_serie, b.marca, b.modelo,
           e.razao_social,
           (ct.pdf_url IS NOT NULL),
           b.periodicidade_meses,
           CASE WHEN COALESCE(b.periodicidade_meses, 0) > 0
                     AND ct.data_calibracao IS NOT NULL
                THEN (ct.data_calibracao
                      + make_interval(months => b.periodicidade_meses))::date
           END,
           ct.uuid_validacao,
           to_jsonb(b) - 'empresa_id' - 'cliente_id' - 'id' - 'criado_em',
           ct.status, ct.cancelado_em, ct.motivo_cancelamento,
           (SELECT s.numero FROM certificado s WHERE s.id = ct.substituido_por_id),
           (SELECT o.numero FROM certificado o WHERE o.id = ct.substitui_id),
           ct.numero_lacre, ct.selo_inmetro, ct.emitir_rbc,
           ct.local_tipo, ct.local_detalhe
      FROM certificado ct
      JOIN cliente c ON c.id = ct.cliente_id
      JOIN empresa e ON e.id = ct.empresa_id
      JOIN balanca b ON b.id = ct.balanca_id
     WHERE so_digitos(c.cnpj) = so_digitos(p_documento)
       AND ct.status IN ('emitido', 'substituido', 'cancelado')
     ORDER BY ct.data_calibracao DESC NULLS LAST, ct.numero DESC;
$function$;

COMMIT;

-- Prova de que ficou no ar: tem que listar a função e devolver linhas
-- (ou zero linhas, mas SEM erro) para um documento qualquer.
\echo '--- funcao existe? ---'
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'cliente_certificados';

\echo '--- teste de execucao com um CNPJ real ---'
SELECT count(*) AS certificados_encontrados
  FROM cliente_certificados(
      (SELECT regexp_replace(COALESCE(cnpj,''), '\D', '', 'g')
         FROM cliente WHERE COALESCE(cnpj,'') <> '' LIMIT 1));
