-- ═══════════════════════════════════════════════════════════
-- 48 · Portal do cliente final
--   Login próprio do cliente final (dono da balança) para baixar
--   seus certificados e os certificados dos pesos-padrão usados.
--   Visão UNIFICADA por documento (CNPJ/CPF): vê certificados de
--   todas as empresas cujo cliente tenha aquele documento.
--
--   Segurança (Opção B): só se cadastra com um e-mail que JÁ conste
--   no cadastro de algum cliente — prova o vínculo sem quebrar
--   isolamento. A tabela é global (fora do RLS por empresa); todo
--   acesso aos dados passa por funções SECURITY DEFINER que filtram
--   estritamente pelo documento do cliente autenticado.
-- ═══════════════════════════════════════════════════════════

-- Normaliza documento: mantém só dígitos (para casar 12.345/0001-99 com 12345000199)
CREATE OR REPLACE FUNCTION so_digitos(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT regexp_replace(coalesce(p, ''), '\D', '', 'g')
$$;

CREATE TABLE IF NOT EXISTS cliente_acesso (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    documento     text NOT NULL,               -- CNPJ/CPF (só dígitos)
    email         text NOT NULL UNIQUE,
    nome          text,
    senha_hash    text NOT NULL,
    ativo         boolean NOT NULL DEFAULT true,
    email_validado boolean NOT NULL DEFAULT false,
    token_validacao text,                       -- link de ativação
    token_expira  timestamptz,
    criado_em     timestamptz NOT NULL DEFAULT now(),
    ultimo_acesso timestamptz
);
CREATE INDEX IF NOT EXISTS idx_cliente_acesso_doc ON cliente_acesso (documento);

-- Log de acessos do cliente final (visível ao super-admin)
CREATE TABLE IF NOT EXISTS cliente_acesso_log (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    acesso_id     uuid REFERENCES cliente_acesso(id) ON DELETE SET NULL,
    documento     text,
    email         text,
    evento        text NOT NULL,               -- 'login','cadastro','download','validacao'
    detalhe       text,
    ip            text,
    ocorrido_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cliente_log_data ON cliente_acesso_log (ocorrido_em DESC);

-- A API acessa estas tabelas por funções SECURITY DEFINER (abaixo).
-- Não concede acesso direto de tabela ao api_app: tudo mediado.

-- ── Registro de evento no log ───────────────────────────────
DROP FUNCTION IF EXISTS cliente_log(uuid, text, text, text, text, text);
CREATE FUNCTION cliente_log(p_acesso uuid, p_doc text, p_email text,
    p_evento text, p_detalhe text, p_ip text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    INSERT INTO cliente_acesso_log (acesso_id, documento, email, evento, detalhe, ip)
    VALUES (p_acesso, p_doc, p_email, p_evento, p_detalhe, p_ip)
$$;
GRANT EXECUTE ON FUNCTION cliente_log(uuid, text, text, text, text, text) TO api_app;

-- ── Autocadastro (Opção B): valida vínculo por e-mail já cadastrado ──
-- Retorna o documento do cliente se o e-mail existir em algum cadastro
-- de cliente E o documento informado casar. NULL caso contrário.
DROP FUNCTION IF EXISTS cliente_pode_cadastrar(text, text);
CREATE FUNCTION cliente_pode_cadastrar(p_email text, p_documento text)
RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT so_digitos(c.cnpj)
      FROM cliente c
     WHERE lower(c.email) = lower(p_email)
       AND so_digitos(c.cnpj) = so_digitos(p_documento)
       AND c.cnpj IS NOT NULL
     LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION cliente_pode_cadastrar(text, text) TO api_app;

-- Cria o acesso (pendente de validação). Só chame após cliente_pode_cadastrar.
DROP FUNCTION IF EXISTS cliente_criar_acesso(text, text, text, text, text);
CREATE FUNCTION cliente_criar_acesso(
    p_documento text, p_email text, p_nome text, p_senha_hash text, p_token text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
    INSERT INTO cliente_acesso (documento, email, nome, senha_hash,
                                email_validado, token_validacao, token_expira, ativo)
    VALUES (so_digitos(p_documento), lower(p_email), p_nome, p_senha_hash,
            false, p_token, now() + interval '3 days', true)
    RETURNING id INTO v_id;
    RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION cliente_criar_acesso(text, text, text, text, text) TO api_app;

-- Valida o e-mail pelo token
DROP FUNCTION IF EXISTS cliente_validar_email(text);
CREATE FUNCTION cliente_validar_email(p_token text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
    SELECT id INTO v_id FROM cliente_acesso
     WHERE token_validacao = p_token AND token_expira > now() AND NOT email_validado;
    IF v_id IS NULL THEN RETURN false; END IF;
    UPDATE cliente_acesso
       SET email_validado = true, token_validacao = NULL, token_expira = NULL
     WHERE id = v_id;
    RETURN true;
END $$;
GRANT EXECUTE ON FUNCTION cliente_validar_email(text) TO api_app;

-- ── Login do cliente final ──────────────────────────────────
DROP FUNCTION IF EXISTS cliente_buscar_acesso(text);
CREATE FUNCTION cliente_buscar_acesso(p_email text)
RETURNS TABLE (id uuid, documento text, email text, nome text,
    senha_hash text, ativo boolean, email_validado boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT id, documento, email, nome, senha_hash, ativo, email_validado
      FROM cliente_acesso WHERE lower(email) = lower(p_email) LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION cliente_buscar_acesso(text) TO api_app;

DROP FUNCTION IF EXISTS cliente_marcar_acesso(uuid);
CREATE FUNCTION cliente_marcar_acesso(p_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    UPDATE cliente_acesso SET ultimo_acesso = now() WHERE id = p_id
$$;
GRANT EXECUTE ON FUNCTION cliente_marcar_acesso(uuid) TO api_app;

-- ── Certificados do cliente (UNIFICADO por documento) ───────
-- Atravessa o isolamento por empresa DE PROPÓSITO: retorna os
-- certificados emitidos de todas as empresas cujo cliente tenha
-- o mesmo documento. Só certificados EMITIDOS.
DROP FUNCTION IF EXISTS cliente_certificados(text);
CREATE FUNCTION cliente_certificados(p_documento text)
RETURNS TABLE (
    id uuid, numero text, data_emissao timestamptz, data_calibracao date,
    empresa text, balanca text, num_serie text, modelo_cert text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT ct.id, ct.numero, ct.data_emissao, ct.data_calibracao,
           e.razao_social, b.identificacao, b.num_serie, ct.modelo_certificado
      FROM certificado ct
      JOIN cliente c ON c.id = ct.cliente_id
      JOIN empresa e ON e.id = ct.empresa_id
      JOIN balanca b ON b.id = ct.balanca_id
     WHERE so_digitos(c.cnpj) = so_digitos(p_documento)
       AND ct.status = 'emitido'
     ORDER BY ct.data_emissao DESC NULLS LAST
$$;
GRANT EXECUTE ON FUNCTION cliente_certificados(text) TO api_app;

-- Confirma que um certificado pertence ao documento (guarda p/ download)
DROP FUNCTION IF EXISTS cliente_possui_certificado(text, uuid);
CREATE FUNCTION cliente_possui_certificado(p_documento text, p_cert uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM certificado ct JOIN cliente c ON c.id = ct.cliente_id
         WHERE ct.id = p_cert AND ct.status = 'emitido'
           AND so_digitos(c.cnpj) = so_digitos(p_documento)
    )
$$;
GRANT EXECUTE ON FUNCTION cliente_possui_certificado(text, uuid) TO api_app;

-- ── Pesos-padrão usados nos certificados do cliente ─────────
-- Lista os certificados dos pesos-padrão (rastreabilidade) que
-- foram usados nas calibrações do cliente.
DROP FUNCTION IF EXISTS cliente_pesos(text);
CREATE FUNCTION cliente_pesos(p_documento text)
RETURNS TABLE (
    peso_padrao_id uuid, identificacao text, num_cert_peso text,
    validade date, empresa text, usado_em_certificado text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT DISTINCT pp.id, pp.identificacao, cp.num_cert_peso,
           cp.validade_na_data, e.razao_social, ct.numero
      FROM certificado_peso cp
      JOIN certificado ct ON ct.id = cp.certificado_id
      JOIN cliente c ON c.id = ct.cliente_id
      JOIN empresa e ON e.id = cp.empresa_id
      JOIN peso_padrao pp ON pp.id = cp.peso_padrao_id
     WHERE so_digitos(c.cnpj) = so_digitos(p_documento)
       AND ct.status = 'emitido'
     ORDER BY ct.numero DESC
$$;
GRANT EXECUTE ON FUNCTION cliente_pesos(text) TO api_app;

-- ── Log de acessos para o super-admin ───────────────────────
DROP FUNCTION IF EXISTS sa_cliente_acessos(int);
CREATE FUNCTION sa_cliente_acessos(p_limite int DEFAULT 200)
RETURNS TABLE (
    ocorrido_em timestamptz, email text, documento text,
    evento text, detalhe text, ip text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT ocorrido_em, email, documento, evento, detalhe, ip
      FROM cliente_acesso_log
     ORDER BY ocorrido_em DESC
     LIMIT p_limite
$$;

-- Lista de clientes finais cadastrados (super-admin)
DROP FUNCTION IF EXISTS sa_cliente_acessos_lista();
CREATE FUNCTION sa_cliente_acessos_lista()
RETURNS TABLE (
    id uuid, nome text, email text, documento text, ativo boolean,
    email_validado boolean, criado_em timestamptz, ultimo_acesso timestamptz,
    qtd_certificados bigint
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT ca.id, ca.nome, ca.email, ca.documento, ca.ativo,
           ca.email_validado, ca.criado_em, ca.ultimo_acesso,
           (SELECT count(*) FROM certificado ct
              JOIN cliente c ON c.id = ct.cliente_id
             WHERE so_digitos(c.cnpj) = ca.documento AND ct.status = 'emitido')
      FROM cliente_acesso ca
     ORDER BY ca.criado_em DESC
$$;

SELECT 'portal do cliente final adicionado' AS resultado;
