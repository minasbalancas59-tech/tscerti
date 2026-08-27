-- Validacao publica de certificado SUBSTITUIDO (Joao, 20/08/2026)
-- 1) validar_certificado: aceita status substituido e devolve id/status
-- 2) pub_vigente_certificado: segue a cadeia substituido_por_id ate o vigente
-- 3) validar_certificado_estado: estado proprio "substituido" + vigente_numero/uuid
-- Aplicado manualmente via psql em 20/08/2026; este arquivo e o registro.

DROP FUNCTION IF EXISTS public.validar_certificado(uuid);
CREATE FUNCTION public.validar_certificado(p_uuid uuid)
 RETURNS TABLE(id uuid, numero text, status text, data_calibracao date, data_emissao timestamp with time zone,
               hash_sha256 text, empresa text, num_autorizacao text, cliente text, balanca text,
               marca text, modelo text, num_serie text, capacidade numeric, classe_exatidao text,
               periodicidade_meses integer, permite_download boolean)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT ct.id, ct.numero, ct.status, ct.data_calibracao, ct.data_emissao, ct.hash_sha256,
           e.razao_social, e.num_autorizacao, c.razao_social,
           b.identificacao, b.marca, b.modelo, b.num_serie,
           b.capacidade, b.classe_exatidao, b.periodicidade_meses,
           e.validar_permite_download
      FROM certificado ct
      JOIN empresa e ON e.id = ct.empresa_id
      JOIN cliente c ON c.id = ct.cliente_id
      JOIN balanca b ON b.id = ct.balanca_id
     WHERE ct.uuid_validacao = p_uuid AND ct.status IN ('emitido', 'substituido')
$function$;
GRANT EXECUTE ON FUNCTION public.validar_certificado(uuid) TO certsaas, api_app;

CREATE OR REPLACE FUNCTION public.pub_vigente_certificado(p_id uuid)
 RETURNS TABLE(numero text, uuid_validacao uuid)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    WITH RECURSIVE cadeia AS (
        SELECT id, numero, status, uuid_validacao, substituido_por_id, 1 AS profundidade
          FROM certificado WHERE id = p_id
        UNION ALL
        SELECT c2.id, c2.numero, c2.status, c2.uuid_validacao, c2.substituido_por_id,
               cadeia.profundidade + 1
          FROM certificado c2
          JOIN cadeia ON c2.id = cadeia.substituido_por_id
         WHERE cadeia.profundidade < 10
    )
    SELECT numero, uuid_validacao FROM cadeia
     WHERE status = 'emitido'
     ORDER BY profundidade DESC LIMIT 1
$function$;
GRANT EXECUTE ON FUNCTION public.pub_vigente_certificado(uuid) TO certsaas, api_app;

DROP FUNCTION IF EXISTS public.validar_certificado_estado(uuid);
CREATE FUNCTION public.validar_certificado_estado(p_uuid uuid)
 RETURNS TABLE(estado text, numero text, data_calibracao date, data_emissao timestamp with time zone,
               hash_sha256 text, empresa text, logo_url text, num_autorizacao text, cliente text,
               balanca text, marca text, modelo text, num_serie text, capacidade numeric,
               classe_exatidao text, periodicidade_meses integer, status text,
               cancelado_em timestamp with time zone, motivo_cancelamento text,
               vigente_numero text, vigente_uuid uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT
        CASE
            WHEN ct.status = 'emitido' THEN 'valido'
            WHEN ct.status = 'cancelado' THEN 'cancelado'
            WHEN ct.status = 'substituido' THEN 'substituido'
            WHEN ct.status IN ('rascunho', 'aguardando_aprovacao') THEN 'processando'
            ELSE 'indisponivel'
        END AS estado,
        ct.numero, ct.data_calibracao,
        CASE WHEN ct.status IN ('emitido','cancelado','substituido') THEN ct.data_emissao END,
        CASE WHEN ct.status = 'emitido' THEN ct.hash_sha256 END,
        e.razao_social, e.logo_url, e.num_autorizacao, c.razao_social,
        b.identificacao, b.marca, b.modelo, b.num_serie,
        b.capacidade, b.classe_exatidao, b.periodicidade_meses,
        ct.status, ct.cancelado_em, ct.motivo_cancelamento,
        vig.numero, vig.uuid_validacao
      FROM certificado ct
      JOIN empresa e ON e.id = ct.empresa_id
      JOIN cliente c ON c.id = ct.cliente_id
      JOIN balanca b ON b.id = ct.balanca_id
      LEFT JOIN LATERAL (
          SELECT * FROM pub_vigente_certificado(ct.id)
           WHERE ct.status = 'substituido'
      ) vig ON true
     WHERE ct.uuid_validacao = p_uuid;
$function$;
GRANT EXECUTE ON FUNCTION public.validar_certificado_estado(uuid) TO certsaas, api_app;
