-- 126: FIX — download de PDF pelo portal nunca funcionou (RLS).
--
-- O endpoint checava a posse por função SECURITY DEFINER (passava) e depois
-- buscava o pdf_url com SELECT DIRETO na tabela. Esse SELECT roda sob RLS;
-- como o portal não tem empresa no contexto, voltava VAZIO — e o código
-- entendia "PDF indisponível", mesmo com o arquivo lá.
--
-- Solução: uma função por tipo, SECURITY DEFINER, que já faz a GUARDA e
-- devolve a URL. Verificação e leitura no mesmo lugar, sem brecha.

BEGIN;

-- PDF do certificado: só se pertencer ao documento do cliente
CREATE OR REPLACE FUNCTION public.cliente_pdf_certificado(p_documento text, p_cert uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT ct.pdf_url
      FROM certificado ct
      JOIN cliente c ON c.id = ct.cliente_id
     WHERE ct.id = p_cert
       AND ct.status IN ('emitido', 'substituido')   -- cancelado não baixa
       AND so_digitos(c.cnpj) = so_digitos(p_documento);
$function$;

-- PDF do peso-padrão: só se o peso foi usado em certificado do cliente
CREATE OR REPLACE FUNCTION public.cliente_pdf_peso(p_documento text, p_peso uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT DISTINCT pp.certificado_pdf_url
      FROM peso_padrao pp
      JOIN certificado_peso cp ON cp.peso_padrao_id = pp.id
      JOIN certificado ct ON ct.id = cp.certificado_id
      JOIN cliente c ON c.id = ct.cliente_id
     WHERE pp.id = p_peso
       AND ct.status IN ('emitido', 'substituido')
       AND so_digitos(c.cnpj) = so_digitos(p_documento)
     LIMIT 1;
$function$;

COMMIT;

\echo '--- prova: URLs que o portal conseguiria baixar agora ---'
SELECT 'certificado' AS tipo,
       cliente_pdf_certificado(
           (SELECT regexp_replace(COALESCE(c.cnpj,''),'\D','','g')
              FROM certificado ct JOIN cliente c ON c.id=ct.cliente_id
             WHERE ct.pdf_url IS NOT NULL AND ct.status='emitido' LIMIT 1),
           (SELECT ct.id FROM certificado ct
             WHERE ct.pdf_url IS NOT NULL AND ct.status='emitido' LIMIT 1)) AS url;
