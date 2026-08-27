-- 117: portal — dados completos da balanca para exibicao e BUSCA.
-- Em vez de listar coluna por coluna (e quebrar se o schema mudar), devolve
-- a linha inteira da balanca como jsonb: a tela usa o que existir (serie,
-- capacidade, numero Inmetro, marca, modelo, classe...) e ignora o resto.
DROP FUNCTION IF EXISTS public.cliente_certificados(text);

CREATE FUNCTION public.cliente_certificados(p_documento text)
 RETURNS TABLE(id uuid, numero text, data_calibracao date,
               balanca text, num_serie text, marca text, modelo text,
               empresa text, tem_pdf boolean,
               periodicidade_meses integer, vence_em date,
               uuid_validacao uuid, dados_balanca jsonb)
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
           to_jsonb(b) - 'empresa_id' - 'cliente_id' - 'id' - 'criado_em'
      FROM certificado ct
      JOIN cliente c ON c.id = ct.cliente_id
      JOIN empresa e ON e.id = ct.empresa_id
      JOIN balanca b ON b.id = ct.balanca_id
     WHERE so_digitos(c.cnpj) = so_digitos(p_documento)
       AND ct.status = 'emitido'
     ORDER BY ct.data_calibracao DESC NULLS LAST, ct.numero DESC;
$function$;
