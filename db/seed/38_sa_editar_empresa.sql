-- ═══════════════════════════════════════════════════════════
-- 38 · Super-admin — editar mais dados do cadastro da empresa
--   Amplia sa_atualizar_empresa para incluir subdomínio,
--   autorização Inmetro e prefixo do certificado.
-- ═══════════════════════════════════════════════════════════

-- Recria a função de atualização com os campos adicionais.
-- Todos os parâmetros usam COALESCE: o que vier NULL não altera.
CREATE OR REPLACE FUNCTION sa_atualizar_empresa(
    p_id uuid, p_razao text, p_plano text, p_status text, p_limite int,
    p_subdominio text DEFAULT NULL,
    p_num_autorizacao text DEFAULT NULL,
    p_prefixo_cert text DEFAULT NULL)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    UPDATE empresa SET
        razao_social    = COALESCE(p_razao, razao_social),
        plano           = COALESCE(p_plano, plano),
        status          = COALESCE(p_status, status),
        limite_usuarios = COALESCE(p_limite, limite_usuarios),
        subdominio      = COALESCE(NULLIF(p_subdominio, ''), subdominio),
        num_autorizacao = COALESCE(p_num_autorizacao, num_autorizacao),
        -- Prefixo só muda se a empresa AINDA NÃO emitiu certificados
        -- (protege a sequência de numeração, mesmo contra chamadas diretas)
        prefixo_cert    = CASE
            WHEN NULLIF(p_prefixo_cert, '') IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM certificado c
                             WHERE c.empresa_id = p_id AND c.status = 'emitido')
            THEN p_prefixo_cert
            ELSE prefixo_cert
        END
     WHERE id = p_id
$$;

-- ── Gestão de usuários de uma empresa (super-admin) ─────────
-- Lista os usuários com papel e status (não expõe senha).
DROP FUNCTION IF EXISTS sa_usuarios_empresa(uuid);
CREATE FUNCTION sa_usuarios_empresa(p_empresa uuid)
RETURNS TABLE (id uuid, nome text, email text, papel text, ativo boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT u.id, u.nome, u.email, u.papel, u.ativo
      FROM usuario u
     WHERE u.empresa_id = p_empresa
     ORDER BY (u.papel = 'admin') DESC, u.nome
$$;

-- Bloqueia ou reativa um usuário (ativo = false/true).
-- Impede bloquear o último admin ativo da empresa.
DROP FUNCTION IF EXISTS sa_bloquear_usuario(uuid, boolean);
CREATE FUNCTION sa_bloquear_usuario(p_usuario uuid, p_ativo boolean)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_empresa uuid;
    v_papel   text;
    v_admins  int;
BEGIN
    SELECT empresa_id, papel INTO v_empresa, v_papel
      FROM usuario WHERE id = p_usuario;
    IF v_empresa IS NULL THEN RETURN 'nao_encontrado'; END IF;

    -- Não deixar a empresa sem nenhum admin ativo
    IF p_ativo = false AND v_papel = 'admin' THEN
        SELECT count(*) INTO v_admins
          FROM usuario
         WHERE empresa_id = v_empresa AND papel = 'admin' AND ativo = true;
        IF v_admins <= 1 THEN RETURN 'ultimo_admin'; END IF;
    END IF;

    UPDATE usuario SET ativo = p_ativo WHERE id = p_usuario;
    RETURN 'ok';
END $$;

-- Exclui um usuário. Impede excluir o último admin ativo.
DROP FUNCTION IF EXISTS sa_excluir_usuario(uuid);
CREATE FUNCTION sa_excluir_usuario(p_usuario uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_empresa uuid;
    v_papel   text;
    v_admins  int;
BEGIN
    SELECT empresa_id, papel INTO v_empresa, v_papel
      FROM usuario WHERE id = p_usuario;
    IF v_empresa IS NULL THEN RETURN 'nao_encontrado'; END IF;

    IF v_papel = 'admin' THEN
        SELECT count(*) INTO v_admins
          FROM usuario
         WHERE empresa_id = v_empresa AND papel = 'admin' AND ativo = true;
        IF v_admins <= 1 THEN RETURN 'ultimo_admin'; END IF;
    END IF;

    DELETE FROM usuario WHERE id = p_usuario;
    RETURN 'ok';
END $$;

SELECT 'edição ampliada de empresa (super-admin) adicionada' AS resultado;