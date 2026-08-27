-- 127: pesos-padrão AGRUPADOS no portal (antes repetia o mesmo peso uma vez
-- por calibração em que foi usado).
--
-- Aproveita para responder ao que o auditor realmente verifica: o certificado
-- do peso estava VÁLIDO NA DATA em que a calibração foi feita? Peso com
-- certificado vencido no momento do uso compromete a rastreabilidade daquele
-- ensaio — e isso não se enxerga olhando só a data de validade de hoje.
BEGIN;

CREATE OR REPLACE FUNCTION public.cliente_pesos_agrupado(p_documento text)
 RETURNS TABLE(peso_padrao_id uuid, identificacao text, num_certificado text,
               validade date, tem_pdf boolean,
               usos integer, certificados text, ultimo_uso date,
               valido_nos_usos boolean, vencido_hoje boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT pp.id, pp.identificacao, pp.num_certificado, pp.validade,
           (pp.certificado_pdf_url IS NOT NULL),
           count(DISTINCT ct.id)::int,
           -- lista os números, no máximo 6 (com reticências se houver mais)
           CASE WHEN count(DISTINCT ct.id) > 6
                THEN (array_to_string((array_agg(DISTINCT ct.numero))[1:6], ', ') || ', …')
                ELSE array_to_string(array_agg(DISTINCT ct.numero), ', ')
           END,
           max(ct.data_calibracao)::date,
           -- estava válido em TODAS as calibrações em que foi usado?
           bool_and(pp.validade IS NULL OR ct.data_calibracao IS NULL
                    OR pp.validade >= ct.data_calibracao),
           (pp.validade IS NOT NULL AND pp.validade < current_date)
      FROM peso_padrao pp
      JOIN certificado_peso cp ON cp.peso_padrao_id = pp.id
      JOIN certificado ct ON ct.id = cp.certificado_id
      JOIN cliente c ON c.id = ct.cliente_id
     WHERE so_digitos(c.cnpj) = so_digitos(p_documento)
       AND ct.status IN ('emitido', 'substituido')
     GROUP BY pp.id, pp.identificacao, pp.num_certificado, pp.validade,
              pp.certificado_pdf_url
     ORDER BY pp.identificacao;
$function$;

COMMIT;

\echo '--- prova: pesos agrupados de um cliente real ---'
SELECT identificacao, num_certificado, validade, usos, certificados,
       valido_nos_usos, vencido_hoje
  FROM cliente_pesos_agrupado(
      (SELECT regexp_replace(COALESCE(c.cnpj,''),'\D','','g')
         FROM certificado ct JOIN cliente c ON c.id=ct.cliente_id
        WHERE ct.status='emitido' LIMIT 1))
 LIMIT 8;
