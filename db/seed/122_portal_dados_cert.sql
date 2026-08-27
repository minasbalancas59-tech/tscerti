-- 122: o portal passa a mostrar o ESTADO do certificado e os dados que o
-- cliente precisa numa fiscalização.
--
-- MUDANÇA IMPORTANTE: antes a listagem trazia SÓ status='emitido'. Um
-- certificado CANCELADO ou SUBSTITUÍDO simplesmente sumia do portal — e o
-- cliente podia seguir usando um PDF que baixou semanas atrás e não vale
-- mais. Agora eles aparecem, com a tarja e o motivo.
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
