-- ═══════════════════════════════════════════════════════════
-- 70 · Logo da empresa pelo token da pesquisa (formulário público)
--   Permite a página pública exibir o logo sem login.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION pesquisa_logo_por_token(p_token text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT emp.logo_url
      FROM pesquisa_envio e
      JOIN empresa emp ON emp.id = e.empresa_id
     WHERE e.token = p_token;
$$;

SELECT 'função de logo por token criada' AS resultado;
