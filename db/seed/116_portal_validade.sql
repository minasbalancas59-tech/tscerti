-- 116: portal do cliente — situacao de validade e contato da empresa
--
-- (a) cliente_certificados passa a devolver a PERIODICIDADE da balanca e a
--     data de VENCIMENTO calculada (data da calibracao + periodicidade).
--     Balanca sem periodicidade (0 ou nula) devolve vence_em NULL — a tela
--     mostra "sem periodicidade definida" em vez de inventar uma data.
-- (b) cliente_empresas_contato: quem procurar quando precisar de ajuda.

DROP FUNCTION IF EXISTS public.cliente_certificados(text);

CREATE FUNCTION public.cliente_certificados(p_documento text)
 RETURNS TABLE(id uuid, numero text, data_calibracao date,
               balanca text, num_serie text, marca text, modelo text,
               empresa text, tem_pdf boolean,
               periodicidade_meses integer, vence_em date,
               uuid_validacao uuid)
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
           ct.uuid_validacao
      FROM certificado ct
      JOIN cliente c ON c.id = ct.cliente_id
      JOIN empresa e ON e.id = ct.empresa_id
      JOIN balanca b ON b.id = ct.balanca_id
     WHERE so_digitos(c.cnpj) = so_digitos(p_documento)
       AND ct.status = 'emitido'
     ORDER BY ct.data_calibracao DESC NULLS LAST, ct.numero DESC;
$function$;

-- Empresas que atendem este cliente, com o contato delas
CREATE OR REPLACE FUNCTION public.cliente_empresas_contato(p_documento text)
 RETURNS TABLE(empresa text, telefone text, email text, cidade_uf text,
               certificados bigint, ultimo_cert date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT e.razao_social, e.telefone, e.email, e.cidade_uf,
           count(ct.id),
           max(ct.data_calibracao)::date
      FROM cliente c
      JOIN empresa e ON e.id = c.empresa_id
      LEFT JOIN certificado ct ON ct.cliente_id = c.id AND ct.status = 'emitido'
     WHERE so_digitos(c.cnpj) = so_digitos(p_documento)
     GROUP BY e.razao_social, e.telefone, e.email, e.cidade_uf
     ORDER BY count(ct.id) DESC;
$function$;
