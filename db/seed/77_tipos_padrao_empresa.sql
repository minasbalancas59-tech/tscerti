-- ═══════════════════════════════════════════════════════════
-- 77 · Empresa nova nasce com 6 tipos de balança pré-cadastrados
-- (Eletrônica, Mecânica, Analítica, Bancada, Plataforma, Rodoviária)
-- Recria sa_criar_empresa adicionando a inserção dos tipos.
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION sa_criar_empresa(
    p_razao text, p_cnpj text, p_subdominio text, p_prefixo text,
    p_plano text, p_limite int,
    p_admin_nome text, p_admin_email text, p_token text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_empresa uuid;
BEGIN
    INSERT INTO empresa (razao_social, cnpj, subdominio, prefixo_cert,
                         plano, status, limite_usuarios)
    VALUES (p_razao, p_cnpj, p_subdominio, p_prefixo, p_plano, 'ativa', p_limite)
    RETURNING id INTO v_empresa;

    INSERT INTO usuario (empresa_id, nome, email, senha_hash, papel,
                         token_convite, token_convite_expira)
    VALUES (v_empresa, p_admin_nome, lower(p_admin_email),
            'convite-pendente', 'admin',
            p_token, now() + interval '7 days');

    -- Tipos de balança padrão (toda empresa nova já nasce com eles)
    INSERT INTO tipo_balanca (empresa_id, nome) VALUES
        (v_empresa, 'Eletrônica'),
        (v_empresa, 'Mecânica'),
        (v_empresa, 'Analítica'),
        (v_empresa, 'Bancada'),
        (v_empresa, 'Plataforma'),
        (v_empresa, 'Rodoviária')
    ON CONFLICT (empresa_id, nome) DO NOTHING;

    RETURN v_empresa;
END $$;

SELECT 'sa_criar_empresa agora semeia 6 tipos de balança' AS resultado;
