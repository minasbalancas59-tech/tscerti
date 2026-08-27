-- ================================================================
-- Downloads públicos via uuid de validação (SECURITY DEFINER,
-- contornam o RLS como a validar_certificado já faz).
--   docker compose exec -T db psql -U certsaas -d certsaas < db/seed/32_download_publico.sql
-- ================================================================

-- PDF do certificado pelo uuid (retorna a chave S3)
CREATE OR REPLACE FUNCTION pub_pdf_certificado(p_uuid uuid)
RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT pdf_url FROM certificado
     WHERE uuid_validacao = p_uuid AND status = 'emitido'
$$;

-- Pesos padrão que rastreiam o certificado do uuid
CREATE OR REPLACE FUNCTION pub_pesos_certificado(p_uuid uuid)
RETURNS TABLE (id uuid, identificacao text, valor_nominal numeric,
               classe text, tem_pdf boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT pp.id, pp.identificacao, pp.valor_nominal, pp.classe,
           (pp.certificado_pdf_url IS NOT NULL)
      FROM certificado ct
      JOIN certificado_peso cp ON cp.certificado_id = ct.id
      JOIN peso_padrao pp ON pp.id = cp.peso_padrao_id
     WHERE ct.uuid_validacao = p_uuid AND ct.status = 'emitido'
     ORDER BY pp.valor_nominal
$$;

-- PDF de um peso, SÓ se rastreia o certificado do uuid (evita varredura)
CREATE OR REPLACE FUNCTION pub_pdf_peso(p_uuid uuid, p_peso uuid)
RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT pp.certificado_pdf_url
      FROM certificado ct
      JOIN certificado_peso cp ON cp.certificado_id = ct.id
      JOIN peso_padrao pp ON pp.id = cp.peso_padrao_id
     WHERE ct.uuid_validacao = p_uuid AND ct.status = 'emitido'
       AND pp.id = p_peso
$$;

REVOKE ALL ON FUNCTION pub_pdf_certificado(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION pub_pesos_certificado(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION pub_pdf_peso(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pub_pdf_certificado(uuid) TO api_app;
GRANT EXECUTE ON FUNCTION pub_pesos_certificado(uuid) TO api_app;
GRANT EXECUTE ON FUNCTION pub_pdf_peso(uuid, uuid) TO api_app;

SELECT 'funções de download público criadas' AS resultado;
