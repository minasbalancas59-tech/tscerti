-- 110: FIX do erro 42P13 na pagina publica de validacao (23 ocorrencias).
--
-- CAUSA: pub_pesos_certificado declara "valor_nominal numeric", mas a coluna
-- peso_padrao.valor_nominal passou a ser TEXT no ciclo RBC (para aceitar
-- conjuntos, ex.: "1g a 200g / 11 pecas"). O Postgres valida o retorno em
-- TEMPO DE EXECUCAO -> 42P13 "return type mismatch" a cada abertura da pagina.
-- Efeito visivel: o bloco "Certificados dos pesos padrao utilizados" nao
-- carregava para quem abre o QR (o validar.html engole o erro no catch, entao
-- a pagina aparecia sem a rastreabilidade, sem mensagem).
--
-- CORRECAO: valor_nominal passa a text (o tipo real da coluna). A ordenacao
-- passa a ser por identificacao: com texto, "10 kg" vinha antes de "2 kg".
-- O tipo de retorno muda, entao e preciso DROP antes do CREATE.
DROP FUNCTION IF EXISTS public.pub_pesos_certificado(uuid);

CREATE FUNCTION public.pub_pesos_certificado(p_uuid uuid)
 RETURNS TABLE(id uuid, identificacao text, valor_nominal text, classe text,
               tem_pdf boolean)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT pp.id, pp.identificacao, pp.valor_nominal, pp.classe,
           (pp.certificado_pdf_url IS NOT NULL)
      FROM certificado ct
      JOIN empresa e ON e.id = ct.empresa_id
      JOIN certificado_peso cp ON cp.certificado_id = ct.id
      JOIN peso_padrao pp ON pp.id = cp.peso_padrao_id
     WHERE ct.uuid_validacao = p_uuid AND ct.status = 'emitido'
       AND e.validar_permite_download
     ORDER BY pp.identificacao
$function$;
