-- 121: dados para o download em LOTE (ZIP) do portal do cliente.
-- Devolve o certificado VIGENTE (mais recente) de cada balanca, com o que
-- for preciso para nomear o arquivo e montar o indice.
CREATE OR REPLACE FUNCTION public.cliente_certificados_vigentes(p_documento text)
 RETURNS TABLE(id uuid, numero text, data_calibracao date, vence_em date,
               balanca text, num_serie text, empresa text, pdf_url text,
               periodicidade_meses integer)
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
           b.periodicidade_meses
      FROM certificado ct
      JOIN cliente c ON c.id = ct.cliente_id
      JOIN empresa e ON e.id = ct.empresa_id
      JOIN balanca b ON b.id = ct.balanca_id
     WHERE so_digitos(c.cnpj) = so_digitos(p_documento)
       AND ct.status = 'emitido' AND ct.pdf_url IS NOT NULL
     ORDER BY ct.balanca_id, ct.data_calibracao DESC NULLS LAST, ct.numero DESC;
$function$;

-- Pesos-padrao com PDF, para incluir no ZIP quando o cliente pedir
CREATE OR REPLACE FUNCTION public.cliente_pesos_pdf(p_documento text)
 RETURNS TABLE(id uuid, identificacao text, num_certificado text,
               validade date, empresa text, pdf_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT DISTINCT pp.id, pp.identificacao, pp.num_certificado, pp.validade,
           e.razao_social, pp.certificado_pdf_url
      FROM certificado_peso cp
      JOIN certificado ct ON ct.id = cp.certificado_id
      JOIN cliente c ON c.id = ct.cliente_id
      JOIN empresa e ON e.id = cp.empresa_id
      JOIN peso_padrao pp ON pp.id = cp.peso_padrao_id
     WHERE so_digitos(c.cnpj) = so_digitos(p_documento)
       AND ct.status = 'emitido'
       AND pp.certificado_pdf_url IS NOT NULL
     ORDER BY pp.identificacao;
$function$;
