-- ═══════════════════════════════════════════════════════════
-- 164 · Portal: filtro/badge de filial passa a usar o CNPJ como
-- chave, não cidade/UF.
--
-- Bug real (achado testando com a PROVET-INSTITUTO BRASILEIRO DE
-- DIAGNOSTICOS, 3 filiais, mesma raiz de CNPJ): as 3 filiais estão
-- todas cadastradas em "SAO PAULO/SP" — mesma cidade, CNPJs
-- diferentes. O filtro/badge (migration 162) usava cidade/UF como
-- critério de "é mais de uma filial?", então nunca aparecia pra esse
-- cliente, mesmo os certificados das 3 já vindo juntos certinho.
-- CNPJ nunca colide (é a chave real de filial); cidade/UF colide
-- sempre que duas filiais ficam na mesma cidade — comum em capitais.
-- ═══════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.cliente_certificados(text);

CREATE FUNCTION public.cliente_certificados(p_documento text)
 RETURNS TABLE(id uuid, numero text, data_calibracao date, balanca text, num_serie text, marca text, modelo text, empresa text, tem_pdf boolean, periodicidade_meses integer, vence_em date, uuid_validacao uuid, dados_balanca jsonb, status text, cancelado_em timestamp with time zone, motivo_cancelamento text, substituido_por text, revisao_de text, numero_lacre text, selo_inmetro text, acreditado boolean, local_tipo text, local_detalhe text, conforme boolean, pontos_fora integer, pontos_total integer, houve_ajuste boolean, cidade text, uf text, cnpj text)
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
           ct.local_tipo, ct.local_detalhe,
           CASE WHEN NOT EXISTS (SELECT 1 FROM ensaio_indicacao ei
                                  WHERE ei.certificado_id = ct.id)
                     AND NOT EXISTS (SELECT 1 FROM ensaio_excentricidade ex
                                      WHERE ex.certificado_id = ct.id)
                THEN NULL
                ELSE NOT (EXISTS (SELECT 1 FROM ensaio_indicacao ei
                                   WHERE ei.certificado_id = ct.id AND ei.aprovado = false)
                       OR EXISTS (SELECT 1 FROM ensaio_excentricidade ex
                                   WHERE ex.certificado_id = ct.id AND ex.aprovado = false))
           END,
           ((SELECT count(*) FROM ensaio_indicacao ei
              WHERE ei.certificado_id = ct.id AND ei.aprovado = false)
          + (SELECT count(*) FROM ensaio_excentricidade ex
              WHERE ex.certificado_id = ct.id AND ex.aprovado = false))::int,
           ((SELECT count(*) FROM ensaio_indicacao ei WHERE ei.certificado_id = ct.id)
          + (SELECT count(*) FROM ensaio_excentricidade ex WHERE ex.certificado_id = ct.id))::int,
           EXISTS (SELECT 1 FROM ensaio_indicacao ei
                    WHERE ei.certificado_id = ct.id AND ei.indicacao_antes IS NOT NULL),
           c.cidade, c.uf, c.cnpj
      FROM certificado ct
      JOIN cliente c ON c.id = ct.cliente_id
      JOIN empresa e ON e.id = ct.empresa_id
      JOIN balanca b ON b.id = ct.balanca_id
     WHERE cliente_no_grupo(c.cnpj, p_documento)
       AND ct.status IN ('emitido', 'substituido', 'cancelado')
     ORDER BY ct.data_calibracao DESC NULLS LAST, ct.numero DESC;
$function$;

DROP FUNCTION IF EXISTS public.cliente_certificados_vigentes(text);

CREATE FUNCTION public.cliente_certificados_vigentes(p_documento text)
 RETURNS TABLE(id uuid, numero text, data_calibracao date, vence_em date, balanca text, num_serie text, empresa text, pdf_url text, periodicidade_meses integer, cidade text, uf text, cnpj text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT DISTINCT ON (ct.balanca_id)
           ct.id, ct.numero, ct.data_calibracao,
           CASE WHEN COALESCE(b.periodicidade_meses, 0) > 0 AND ct.data_calibracao IS NOT NULL
                THEN (ct.data_calibracao + make_interval(months => b.periodicidade_meses))::date
           END,
           b.identificacao, b.num_serie, e.razao_social, ct.pdf_url,
           b.periodicidade_meses,
           c.cidade, c.uf, c.cnpj
      FROM certificado ct
      JOIN cliente c ON c.id = ct.cliente_id
      JOIN empresa e ON e.id = ct.empresa_id
      JOIN balanca b ON b.id = ct.balanca_id
     WHERE cliente_no_grupo(c.cnpj, p_documento)
       AND ct.status = 'emitido' AND ct.pdf_url IS NOT NULL
     ORDER BY ct.balanca_id, ct.data_calibracao DESC NULLS LAST, ct.numero DESC;
$function$;

SELECT 'Portal: filtro de filial passa a usar CNPJ (nao cidade/UF)' AS resultado;
