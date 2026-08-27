-- ================================================================
-- Expõe a flag de download na validação pública
--   docker compose exec -T db psql -U certsaas -d certsaas < db/seed/34_validar_download_flag.sql
-- ================================================================
CREATE OR REPLACE FUNCTION validar_certificado(p_uuid uuid)
RETURNS TABLE (
    numero text, data_calibracao date, data_emissao timestamptz,
    hash_sha256 text, empresa text, num_autorizacao text, cliente text,
    balanca text, marca text, modelo text, num_serie text,
    capacidade numeric, classe_exatidao text, periodicidade_meses int,
    permite_download boolean
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT ct.numero, ct.data_calibracao, ct.data_emissao, ct.hash_sha256,
           e.razao_social, e.num_autorizacao, c.razao_social,
           b.identificacao, b.marca, b.modelo, b.num_serie,
           b.capacidade, b.classe_exatidao, b.periodicidade_meses,
           e.validar_permite_download
      FROM certificado ct
      JOIN empresa e ON e.id = ct.empresa_id
      JOIN cliente c ON c.id = ct.cliente_id
      JOIN balanca b ON b.id = ct.balanca_id
     WHERE ct.uuid_validacao = p_uuid AND ct.status = 'emitido'
$$;
REVOKE ALL ON FUNCTION validar_certificado(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION validar_certificado(uuid) TO api_app;
SELECT 'flag de download na validação' AS resultado;

-- Downloads públicos respeitam a flag da empresa (defesa no backend,
-- não só esconder o botão)
CREATE OR REPLACE FUNCTION pub_pdf_certificado(p_uuid uuid)
RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT ct.pdf_url FROM certificado ct
      JOIN empresa e ON e.id = ct.empresa_id
     WHERE ct.uuid_validacao = p_uuid AND ct.status = 'emitido'
       AND e.validar_permite_download
$$;

CREATE OR REPLACE FUNCTION pub_pesos_certificado(p_uuid uuid)
RETURNS TABLE (id uuid, identificacao text, valor_nominal numeric,
               classe text, tem_pdf boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT pp.id, pp.identificacao, pp.valor_nominal, pp.classe,
           (pp.certificado_pdf_url IS NOT NULL)
      FROM certificado ct
      JOIN empresa e ON e.id = ct.empresa_id
      JOIN certificado_peso cp ON cp.certificado_id = ct.id
      JOIN peso_padrao pp ON pp.id = cp.peso_padrao_id
     WHERE ct.uuid_validacao = p_uuid AND ct.status = 'emitido'
       AND e.validar_permite_download
     ORDER BY pp.valor_nominal
$$;

CREATE OR REPLACE FUNCTION pub_pdf_peso(p_uuid uuid, p_peso uuid)
RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT pp.certificado_pdf_url
      FROM certificado ct
      JOIN empresa e ON e.id = ct.empresa_id
      JOIN certificado_peso cp ON cp.certificado_id = ct.id
      JOIN peso_padrao pp ON pp.id = cp.peso_padrao_id
     WHERE ct.uuid_validacao = p_uuid AND ct.status = 'emitido'
       AND pp.id = p_peso AND e.validar_permite_download
$$;

GRANT EXECUTE ON FUNCTION pub_pdf_certificado(uuid) TO api_app;
GRANT EXECUTE ON FUNCTION pub_pesos_certificado(uuid) TO api_app;
GRANT EXECUTE ON FUNCTION pub_pdf_peso(uuid, uuid) TO api_app;
SELECT 'downloads públicos com flag' AS resultado;
