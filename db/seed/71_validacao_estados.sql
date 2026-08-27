-- ═══════════════════════════════════════════════════════════
-- 71 · Validação com ESTADOS (etiqueta colada antes da aprovação)
--   Permite colar a etiqueta na balança na hora da visita.
--   O mesmo QR mostra:
--     • 'processando' — rascunho ou aguardando aprovação
--     • 'valido'      — certificado emitido
--     • 'indisponivel'— reprovado/cancelado ou inexistente
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION validar_certificado_estado(p_uuid uuid)
RETURNS TABLE (
    estado text,               -- 'processando' | 'valido' | 'indisponivel'
    numero text, data_calibracao date, data_emissao timestamptz,
    hash_sha256 text, empresa text, empresa_logo text, num_autorizacao text,
    cliente text, balanca text, marca text, modelo text, num_serie text,
    capacidade numeric, classe_exatidao text, periodicidade_meses int,
    status_cert text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT
        CASE
            WHEN ct.status = 'emitido' THEN 'valido'
            WHEN ct.status IN ('rascunho', 'aguardando_aprovacao') THEN 'processando'
            ELSE 'indisponivel'
        END AS estado,
        ct.numero, ct.data_calibracao,
        -- só expõe a data de emissão e o hash quando emitido
        CASE WHEN ct.status = 'emitido' THEN ct.data_emissao END,
        CASE WHEN ct.status = 'emitido' THEN ct.hash_sha256 END,
        e.razao_social, e.logo_url, e.num_autorizacao, c.razao_social,
        b.identificacao, b.marca, b.modelo, b.num_serie,
        b.capacidade, b.classe_exatidao, b.periodicidade_meses,
        ct.status
      FROM certificado ct
      JOIN empresa e ON e.id = ct.empresa_id
      JOIN cliente c ON c.id = ct.cliente_id
      JOIN balanca b ON b.id = ct.balanca_id
     WHERE ct.uuid_validacao = p_uuid;
$$;
REVOKE ALL ON FUNCTION validar_certificado_estado(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION validar_certificado_estado(uuid) TO api_app;

-- Dados para a etiqueta (número + validade), a partir do uuid.
-- Funciona desde o rascunho, pois o uuid existe desde a criação.
CREATE OR REPLACE FUNCTION etiqueta_por_uuid(p_uuid uuid)
RETURNS TABLE (
    numero text, data_calibracao date, periodicidade_meses int,
    balanca text, empresa text, status_cert text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT ct.numero, ct.data_calibracao, b.periodicidade_meses,
           b.identificacao, e.razao_social, ct.status
      FROM certificado ct
      JOIN empresa e ON e.id = ct.empresa_id
      JOIN balanca b ON b.id = ct.balanca_id
     WHERE ct.uuid_validacao = p_uuid;
$$;
REVOKE ALL ON FUNCTION etiqueta_por_uuid(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION etiqueta_por_uuid(uuid) TO api_app;

SELECT 'validação com estados criada' AS resultado;
