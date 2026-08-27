-- ═══════════════════════════════════════════════════════════
-- 61 · Corrige o registro de consultas por QR code
--   O endpoint público de validação não tem tenant (app.empresa_id),
--   então o RLS bloqueava a leitura direta da tabela certificado —
--   por isso o log de consultas ficava sem certificado/empresa/cliente.
--   Esta função SECURITY DEFINER busca os IDs ignorando o RLS.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION pub_ids_certificado(p_uuid uuid)
RETURNS TABLE (certificado_id uuid, empresa_id uuid, cliente_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT id, empresa_id, cliente_id
      FROM certificado
     WHERE uuid_validacao = p_uuid;
$$;

REVOKE ALL ON FUNCTION pub_ids_certificado(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pub_ids_certificado(uuid) TO api_app;

SELECT 'função pub_ids_certificado criada' AS resultado;
