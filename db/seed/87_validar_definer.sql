-- 87: validar_certificado_estado precisa de SECURITY DEFINER.
-- Consulta PUBLICA (QR code, sem login): sem DEFINER o RLS esconde o
-- certificado e a validacao devolve 'indisponivel' para certificados validos.

CREATE OR REPLACE FUNCTION public.validar_certificado_estado(p_uuid uuid)
 RETURNS TABLE(estado text, numero text, data_calibracao date, data_emissao timestamptz,
               hash_sha256 text, empresa text, logo_url text, num_autorizacao text,
               cliente text, balanca text, marca text, modelo text, num_serie text,
               capacidade numeric, classe_exatidao text, periodicidade_meses integer,
               status text, cancelado_em timestamptz, motivo_cancelamento text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT
        CASE
            WHEN ct.status = 'emitido' THEN 'valido'
            WHEN ct.status = 'cancelado' THEN 'cancelado'
            WHEN ct.status IN ('rascunho', 'aguardando_aprovacao') THEN 'processando'
            ELSE 'indisponivel'
        END AS estado,
        ct.numero, ct.data_calibracao,
        CASE WHEN ct.status IN ('emitido','cancelado') THEN ct.data_emissao END,
        CASE WHEN ct.status = 'emitido' THEN ct.hash_sha256 END,
        e.razao_social, e.logo_url, e.num_autorizacao, c.razao_social,
        b.identificacao, b.marca, b.modelo, b.num_serie,
        b.capacidade, b.classe_exatidao, b.periodicidade_meses,
        ct.status, ct.cancelado_em, ct.motivo_cancelamento
      FROM certificado ct
      JOIN empresa e ON e.id = ct.empresa_id
      JOIN cliente c ON c.id = ct.cliente_id
      JOIN balanca b ON b.id = ct.balanca_id
     WHERE ct.uuid_validacao = p_uuid;
$function$;
