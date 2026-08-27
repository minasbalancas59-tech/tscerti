-- ================================================================
-- ETAPA 2 · Script 2 — Rodar manualmente UMA vez:
--   docker compose exec -T db psql -U certsaas -d certsaas < db/seed/11_empresas.sql
--
-- Cadastra a Minas Balanças (tenant real) e uma empresa fictícia
-- usada só pra provar o isolamento multiempresa (teste de fogo).
--
-- ⚠️ ANTES DE RODAR, edite os campos marcados com EDITE_AQUI:
--    - CNPJ real da Minas Balanças (só dígitos)
--    - email do admin (será seu login)
-- As senhas iniciais estão no fim deste arquivo — troque-as no
-- primeiro login via PUT /api/auth/senha.
-- ================================================================

DO $$
DECLARE
    v_mb    uuid;
    v_teste uuid;
BEGIN
    -- ── Minas Balanças ──────────────────────────────────────────
    INSERT INTO empresa (razao_social, cnpj, subdominio, acreditada,
                         num_autorizacao, prefixo_cert, plano, status)
    VALUES ('Minas Balanças Ltda',
            'EDITE_AQUI_CNPJ_SO_DIGITOS',          -- ex.: 12345678000199
            'minasbalancas',
            false,                                  -- não acreditada RBC
            '20000077',                             -- autorização Inmetro
            'MB', 'piloto', 'ativa')
    RETURNING id INTO v_mb;

    INSERT INTO usuario (empresa_id, nome, email, senha_hash, papel)
    VALUES (v_mb, 'João',
            'EDITE_AQUI_email_do_admin',            -- ex.: joao@minasbalancas.com.br
            crypt('MudarJa!2026', gen_salt('bf', 12)),
            'admin');

    -- ── Empresa Teste (só pro teste de isolamento) ──────────────
    INSERT INTO empresa (razao_social, cnpj, subdominio, acreditada,
                         prefixo_cert, plano, status)
    VALUES ('Empresa Teste Ltda', '00000000000000', 'teste',
            false, 'TS', 'piloto', 'ativa')
    RETURNING id INTO v_teste;

    INSERT INTO usuario (empresa_id, nome, email, senha_hash, papel)
    VALUES (v_teste, 'Usuário Teste', 'admin@teste.local',
            crypt('Teste!2026', gen_salt('bf', 12)),
            'admin');

    -- Um cliente fictício dentro da Empresa Teste: é ele que NÃO
    -- pode aparecer quando você estiver logado na Minas Balanças
    INSERT INTO cliente (empresa_id, razao_social, cidade, uf)
    VALUES (v_teste, 'Cliente Secreto da Outra Empresa', 'São Paulo', 'SP');

    RAISE NOTICE 'Empresas criadas: Minas Balanças (%) e Teste (%)', v_mb, v_teste;
END $$;

-- Senhas iniciais (troque no primeiro uso!):
--   admin Minas Balanças ..... MudarJa!2026
--   admin@teste.local ........ Teste!2026
