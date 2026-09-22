-- ═══════════════════════════════════════════════════════════
-- 165 · Portal: cliente_certificados ganha data_emissao — usado
-- pro aviso "novos certificados desde sua última visita" (compara
-- com cliente_acesso.ultimo_acesso, devolvido agora no /login).
-- ═══════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.cliente_certificados(text);

CREATE FUNCTION public.cliente_certificados(p_documento text)
 RETURNS TABLE(id uuid, numero text, data_calibracao date, balanca text, num_serie text, marca text, modelo text, empresa text, tem_pdf boolean, periodicidade_meses integer, vence_em date, uuid_validacao uuid, dados_balanca jsonb, status text, cancelado_em timestamp with time zone, motivo_cancelamento text, substituido_por text, revisao_de text, numero_lacre text, selo_inmetro text, acreditado boolean, local_tipo text, local_detalhe text, conforme boolean, pontos_fora integer, pontos_total integer, houve_ajuste boolean, cidade text, uf text, cnpj text, data_emissao timestamptz)
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
           c.cidade, c.uf, c.cnpj, ct.data_emissao
      FROM certificado ct
      JOIN cliente c ON c.id = ct.cliente_id
      JOIN empresa e ON e.id = ct.empresa_id
      JOIN balanca b ON b.id = ct.balanca_id
     WHERE cliente_no_grupo(c.cnpj, p_documento)
       AND ct.status IN ('emitido', 'substituido', 'cancelado')
     ORDER BY ct.data_calibracao DESC NULLS LAST, ct.numero DESC;
$function$;

SELECT 'Portal: cliente_certificados agora traz data_emissao' AS resultado;
