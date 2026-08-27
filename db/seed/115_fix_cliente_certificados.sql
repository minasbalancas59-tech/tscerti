-- 115: FIX — a aba "Meus certificados" do portal do cliente nunca funcionou.
--
-- Erro: 42883 "function cliente_certificados(text) does not exist".
-- O endpoint /api/portal/certificados chamava uma funcao que NUNCA foi criada
-- no banco. Como nenhum cliente final chegou a ter conta, essa listagem jamais
-- foi executada e o problema ficou invisivel desde a construcao do portal.
--
-- A funcao segue exatamente o padrao da irma que existe (cliente_pesos):
-- SECURITY DEFINER (roda fora do RLS, pois o portal nao tem empresa no
-- contexto) e filtro pelo DOCUMENTO do cliente autenticado, com so_digitos()
-- para casar CNPJ formatado com nao formatado.

DROP FUNCTION IF EXISTS public.cliente_certificados(text);

CREATE FUNCTION public.cliente_certificados(p_documento text)
 RETURNS TABLE(id uuid, numero text, data_calibracao date,
               balanca text, num_serie text, marca text, modelo text,
               empresa text, tem_pdf boolean)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT ct.id, ct.numero, ct.data_calibracao,
           b.identificacao, b.num_serie, b.marca, b.modelo,
           e.razao_social,
           (ct.pdf_url IS NOT NULL)
      FROM certificado ct
      JOIN cliente c ON c.id = ct.cliente_id
      JOIN empresa e ON e.id = ct.empresa_id
      JOIN balanca b ON b.id = ct.balanca_id
     WHERE so_digitos(c.cnpj) = so_digitos(p_documento)
       AND ct.status = 'emitido'
     ORDER BY ct.data_calibracao DESC NULLS LAST, ct.numero DESC;
$function$;

-- Guarda usada no download do PDF: o certificado e mesmo deste documento?
-- (criada aqui tambem por seguranca — se faltar, o download quebraria igual)
CREATE OR REPLACE FUNCTION public.cliente_possui_certificado(p_documento text, p_cert uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM certificado ct
          JOIN cliente c ON c.id = ct.cliente_id
         WHERE ct.id = p_cert AND ct.status = 'emitido'
           AND so_digitos(c.cnpj) = so_digitos(p_documento));
$function$;

-- Conferencia: o que existe agora para o portal
SELECT p.proname AS funcao,
       pg_get_function_identity_arguments(p.oid) AS argumentos
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname LIKE 'cliente_%'
 ORDER BY 1;
