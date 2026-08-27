-- ================================================================
-- Adiciona periodicidade à validação pública (para calcular vencimento)
--   docker compose exec -T db psql -U certsaas -d certsaas < db/seed/30_validar_periodicidade.sql
-- ================================================================
CREATE OR REPLACE FUNCTION validar_certificado(p_uuid uuid)
RETURNS TABLE (
    numero text, data_calibracao date, data_emissao timestamptz,
    hash_sha256 text, empresa text, num_autorizacao text, cliente text,
    balanca text, marca text, modelo text, num_serie text,
    capacidade numeric, classe_exatidao text, periodicidade_meses int
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT ct.numero, ct.data_calibracao, ct.data_emissao, ct.hash_sha256,
           e.razao_social, e.num_autorizacao, c.razao_social,
           b.identificacao, b.marca, b.modelo, b.num_serie,
           b.capacidade, b.classe_exatidao, b.periodicidade_meses
      FROM certificado ct
      JOIN empresa e ON e.id = ct.empresa_id
      JOIN cliente c ON c.id = ct.cliente_id
      JOIN balanca b ON b.id = ct.balanca_id
     WHERE ct.uuid_validacao = p_uuid AND ct.status = 'emitido'
$$;
REVOKE ALL ON FUNCTION validar_certificado(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION validar_certificado(uuid) TO api_app;
SELECT 'validação com periodicidade' AS resultado;
