-- ================================================================
-- PAINEL DE SUPER-ADMINISTRAÇÃO (gestão comercial multiempresa)
--   docker compose exec -T db psql -U certsaas -d certsaas < db/seed/35_superadmin.sql
--
-- O super_admin é um papel que atravessa o isolamento por empresa,
-- via funções SECURITY DEFINER (como a validação pública já faz).
-- Ele NÃO usa o RLS por tenant — opera sobre todas as empresas.
-- ================================================================

-- 1. Aceitar o novo papel na constraint
ALTER TABLE usuario DROP CONSTRAINT IF EXISTS usuario_papel_check;
ALTER TABLE usuario ADD CONSTRAINT usuario_papel_check
    CHECK (papel IN ('super_admin','admin','responsavel_tecnico','tecnico'));

-- 2. Limite de usuários por empresa (0 = ilimitado)
ALTER TABLE empresa
    ADD COLUMN IF NOT EXISTS limite_usuarios integer NOT NULL DEFAULT 0;

-- 3. Contratos de manutenção
CREATE TABLE IF NOT EXISTS contrato (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id     uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    descricao      text NOT NULL,
    valor          numeric(12,2) NOT NULL,
    periodicidade  text NOT NULL DEFAULT 'mensal'
                   CHECK (periodicidade IN ('mensal','trimestral','semestral','anual','avulso')),
    inicio         date NOT NULL,
    fim            date,
    ativo          boolean NOT NULL DEFAULT true,
    observacao     text,
    criado_em      timestamptz NOT NULL DEFAULT now()
);

-- 4. Parcelas / cobranças do contrato (controle de pagamento)
CREATE TABLE IF NOT EXISTS cobranca (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contrato_id    uuid NOT NULL REFERENCES contrato(id) ON DELETE CASCADE,
    empresa_id     uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    competencia    date NOT NULL,               -- mês/ano de referência
    vencimento     date NOT NULL,
    valor          numeric(12,2) NOT NULL,
    status         text NOT NULL DEFAULT 'pendente'
                   CHECK (status IN ('pendente','pago','vencido','cancelado')),
    pago_em        date,
    observacao     text,
    criado_em      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contrato_empresa ON contrato (empresa_id);
CREATE INDEX IF NOT EXISTS idx_cobranca_empresa ON cobranca (empresa_id, status);
CREATE INDEX IF NOT EXISTS idx_cobranca_contrato ON cobranca (contrato_id);

-- Contratos e cobranças NÃO têm RLS por tenant: são geridos só pelo
-- super_admin, sempre via funções SECURITY DEFINER abaixo.

-- ================================================================
-- 5. FUNÇÕES SECURITY DEFINER (só o super_admin as chama pela API,
--    que valida o papel no JWT antes)
-- ================================================================

-- Lista todas as empresas com métricas resumidas
CREATE OR REPLACE FUNCTION sa_listar_empresas()
RETURNS TABLE (
    id uuid, razao_social text, cnpj text, plano text, status text,
    limite_usuarios int, qtd_usuarios bigint, qtd_certificados bigint,
    criado_em timestamptz, cobrancas_pendentes bigint
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT e.id, e.razao_social, e.cnpj, e.plano, e.status, e.limite_usuarios,
           (SELECT count(*) FROM usuario u WHERE u.empresa_id = e.id AND u.ativo),
           (SELECT count(*) FROM certificado c WHERE c.empresa_id = e.id AND c.status = 'emitido'),
           e.criado_em,
           (SELECT count(*) FROM cobranca cb WHERE cb.empresa_id = e.id
              AND cb.status IN ('pendente','vencido'))
      FROM empresa e
     ORDER BY e.razao_social
$$;

-- Detalhe de uma empresa
CREATE OR REPLACE FUNCTION sa_empresa(p_id uuid)
RETURNS TABLE (
    id uuid, razao_social text, cnpj text, subdominio text, plano text,
    status text, limite_usuarios int, num_autorizacao text, prefixo_cert text,
    proximo_numero int, criado_em timestamptz,
    qtd_usuarios bigint, qtd_certificados bigint, qtd_clientes bigint,
    qtd_balancas bigint
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT e.id, e.razao_social, e.cnpj, e.subdominio, e.plano, e.status,
           e.limite_usuarios, e.num_autorizacao, e.prefixo_cert, e.proximo_numero,
           e.criado_em,
           (SELECT count(*) FROM usuario u WHERE u.empresa_id = e.id AND u.ativo),
           (SELECT count(*) FROM certificado c WHERE c.empresa_id = e.id AND c.status = 'emitido'),
           (SELECT count(*) FROM cliente cl WHERE cl.empresa_id = e.id AND cl.ativo),
           (SELECT count(*) FROM balanca b WHERE b.empresa_id = e.id AND b.ativa)
      FROM empresa e WHERE e.id = p_id
$$;

-- Certificados emitidos por período (para métricas de uso/cobrança)
CREATE OR REPLACE FUNCTION sa_uso_certificados(p_empresa uuid, p_de date, p_ate date)
RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT count(*) FROM certificado
     WHERE empresa_id = p_empresa AND status = 'emitido'
       AND (p_de IS NULL OR data_emissao >= p_de)
       AND (p_ate IS NULL OR data_emissao < (p_ate + 1))
$$;

-- Cria empresa + admin inicial (retorna o token de convite do admin)
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

    RETURN v_empresa;
END $$;

-- Atualiza dados/limite/plano/status de uma empresa
CREATE OR REPLACE FUNCTION sa_atualizar_empresa(
    p_id uuid, p_razao text, p_plano text, p_status text, p_limite int)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    UPDATE empresa SET
        razao_social = COALESCE(p_razao, razao_social),
        plano = COALESCE(p_plano, plano),
        status = COALESCE(p_status, status),
        limite_usuarios = COALESCE(p_limite, limite_usuarios)
     WHERE id = p_id
$$;

-- Contratos de uma empresa
CREATE OR REPLACE FUNCTION sa_contratos(p_empresa uuid)
RETURNS SETOF contrato
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT * FROM contrato WHERE empresa_id = p_empresa ORDER BY inicio DESC
$$;

CREATE OR REPLACE FUNCTION sa_criar_contrato(
    p_empresa uuid, p_descricao text, p_valor numeric, p_periodicidade text,
    p_inicio date, p_fim date, p_obs text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
    INSERT INTO contrato (empresa_id, descricao, valor, periodicidade,
                          inicio, fim, observacao)
    VALUES (p_empresa, p_descricao, p_valor, p_periodicidade, p_inicio, p_fim, p_obs)
    RETURNING id INTO v_id;
    RETURN v_id;
END $$;

-- Cobranças de uma empresa (com nome do contrato)
CREATE OR REPLACE FUNCTION sa_cobrancas(p_empresa uuid)
RETURNS TABLE (
    id uuid, contrato_id uuid, contrato text, competencia date,
    vencimento date, valor numeric, status text, pago_em date, observacao text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT cb.id, cb.contrato_id, ct.descricao, cb.competencia, cb.vencimento,
           cb.valor, cb.status, cb.pago_em, cb.observacao
      FROM cobranca cb
      JOIN contrato ct ON ct.id = cb.contrato_id
     WHERE cb.empresa_id = p_empresa
     ORDER BY cb.vencimento DESC
$$;

CREATE OR REPLACE FUNCTION sa_criar_cobranca(
    p_contrato uuid, p_competencia date, p_vencimento date,
    p_valor numeric, p_obs text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_empresa uuid;
BEGIN
    SELECT empresa_id INTO v_empresa FROM contrato WHERE id = p_contrato;
    INSERT INTO cobranca (contrato_id, empresa_id, competencia, vencimento, valor, observacao)
    VALUES (p_contrato, v_empresa, p_competencia, p_vencimento, p_valor, p_obs)
    RETURNING id INTO v_id;
    RETURN v_id;
END $$;

-- Muda o status de uma cobrança (pago/pendente/cancelado)
CREATE OR REPLACE FUNCTION sa_status_cobranca(p_id uuid, p_status text, p_pago_em date)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    UPDATE cobranca SET status = p_status,
           pago_em = CASE WHEN p_status = 'pago' THEN COALESCE(p_pago_em, current_date) ELSE NULL END
     WHERE id = p_id
$$;

-- Marca como vencidas as cobranças pendentes com vencimento passado
CREATE OR REPLACE FUNCTION sa_atualizar_vencidas()
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    UPDATE cobranca SET status = 'vencido'
     WHERE status = 'pendente' AND vencimento < current_date
$$;

-- Painel resumo (números globais do topo)
CREATE OR REPLACE FUNCTION sa_resumo()
RETURNS TABLE (
    total_empresas bigint, empresas_ativas bigint, empresas_suspensas bigint,
    total_certificados bigint, receita_mes numeric, inadimplencia numeric
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT
        (SELECT count(*) FROM empresa),
        (SELECT count(*) FROM empresa WHERE status = 'ativa'),
        (SELECT count(*) FROM empresa WHERE status = 'suspensa'),
        (SELECT count(*) FROM certificado WHERE status = 'emitido'),
        (SELECT COALESCE(sum(valor),0) FROM cobranca
          WHERE status = 'pago' AND date_trunc('month', pago_em) = date_trunc('month', current_date)),
        (SELECT COALESCE(sum(valor),0) FROM cobranca WHERE status IN ('pendente','vencido'))
$$;

-- Permissões: só o papel de app pode executar (a API valida o super_admin)
DO $$
DECLARE fn text;
BEGIN
    FOR fn IN
        SELECT 'sa_listar_empresas()' UNION ALL SELECT 'sa_empresa(uuid)'
        UNION ALL SELECT 'sa_uso_certificados(uuid,date,date)'
        UNION ALL SELECT 'sa_criar_empresa(text,text,text,text,text,int,text,text,text)'
        UNION ALL SELECT 'sa_atualizar_empresa(uuid,text,text,text,int)'
        UNION ALL SELECT 'sa_contratos(uuid)'
        UNION ALL SELECT 'sa_criar_contrato(uuid,text,numeric,text,date,date,text)'
        UNION ALL SELECT 'sa_cobrancas(uuid)'
        UNION ALL SELECT 'sa_criar_cobranca(uuid,date,date,numeric,text)'
        UNION ALL SELECT 'sa_status_cobranca(uuid,text,date)'
        UNION ALL SELECT 'sa_atualizar_vencidas()' UNION ALL SELECT 'sa_resumo()'
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO api_app', fn);
    END LOOP;
END $$;

SELECT 'painel super-admin: estrutura criada' AS resultado;

-- ================================================================
-- 6. Empresa "sistema" + primeiro super_admin
--    (o super_admin pertence a ela só para satisfazer o vínculo;
--     ele opera sobre TODAS as empresas via as funções sa_*)
-- ================================================================
INSERT INTO empresa (id, razao_social, cnpj, subdominio, prefixo_cert, plano, status)
VALUES ('00000000-0000-0000-0000-000000000001',
        'SISTEMA', '00000000000000', '_sistema', 'SYS', 'sistema', 'ativa')
ON CONFLICT (id) DO NOTHING;

-- Cria o super_admin inicial com um token de convite (define senha pelo link).
-- Troque o email abaixo pelo seu antes de rodar, ou rode o UPDATE ao final.
INSERT INTO usuario (empresa_id, nome, email, senha_hash, papel,
                     token_convite, token_convite_expira)
VALUES ('00000000-0000-0000-0000-000000000001',
        'Super Admin', 'admin@minasbalancas.com.br', 'convite-pendente',
        'super_admin',
        encode(gen_random_bytes(24), 'hex'), now() + interval '30 days')
ON CONFLICT (email) DO NOTHING;

-- Mostra o link de convite do super_admin recém-criado
SELECT 'Convite do super_admin — defina a senha em:' AS instrucao,
       '/#convite=' || token_convite AS link
  FROM usuario WHERE papel = 'super_admin' AND token_convite IS NOT NULL
 ORDER BY criado_em DESC LIMIT 1;
