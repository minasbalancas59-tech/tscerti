-- ================================================================
-- SaaS de Certificados de Calibração — Schema completo
-- PostgreSQL 16 · Multiempresa com Row-Level Security
-- ================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- gen_random_uuid()

-- ================================================================
-- BLOCO 1 — Núcleo multiempresa
-- ================================================================

CREATE TABLE empresa (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    razao_social     text        NOT NULL,
    cnpj             text        NOT NULL UNIQUE,
    subdominio       text        NOT NULL UNIQUE,
    logo_url         text,
    acreditada       boolean     NOT NULL DEFAULT false,
    num_autorizacao  text,
    prefixo_cert     text        NOT NULL,              -- ex.: 'MB'
    proximo_numero   integer     NOT NULL DEFAULT 1,
    plano            text        NOT NULL DEFAULT 'trial',
    status           text        NOT NULL DEFAULT 'ativa'
                     CHECK (status IN ('ativa','suspensa','cancelada')),
    criado_em        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE usuario (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id       uuid        NOT NULL REFERENCES empresa(id),
    nome             text        NOT NULL,
    email            text        NOT NULL UNIQUE,
    senha_hash       text        NOT NULL,              -- bcrypt/argon2
    papel            text        NOT NULL
                     CHECK (papel IN ('admin','responsavel_tecnico','tecnico')),
    registro_prof    text,                              -- CRT etc.
    assinatura_url   text,                              -- imagem da assinatura
    ativo            boolean     NOT NULL DEFAULT true,
    criado_em        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cliente (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id       uuid        NOT NULL REFERENCES empresa(id),
    razao_social     text        NOT NULL,
    cnpj             text,
    email            text,
    telefone         text,
    endereco         text,
    cidade           text,
    uf               char(2),
    criado_em        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (empresa_id, cnpj)
);

-- Login do portal do cliente: vinculado ao CLIENTE, não à equipe
CREATE TABLE usuario_portal (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id       uuid        NOT NULL REFERENCES empresa(id),
    cliente_id       uuid        NOT NULL REFERENCES cliente(id),
    email            text        NOT NULL UNIQUE,
    senha_hash       text        NOT NULL,
    ativo            boolean     NOT NULL DEFAULT true,
    criado_em        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE balanca (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id          uuid    NOT NULL REFERENCES empresa(id),
    cliente_id          uuid    NOT NULL REFERENCES cliente(id),
    identificacao       text    NOT NULL,               -- ex.: 'BAL-01'
    tipo                text    NOT NULL DEFAULT 'plataforma'
                        CHECK (tipo IN ('rodoviaria','plataforma','bancada',
                                        'suspensa','ferroviaria','outra')),
    marca               text,
    modelo              text,
    num_serie           text,
    capacidade          numeric(12,3) NOT NULL,         -- kg
    divisao_e           numeric(12,4) NOT NULL,         -- kg
    divisao_d           numeric(12,4),                  -- kg (se difere de e)
    classe_exatidao     text    NOT NULL DEFAULT 'III'
                        CHECK (classe_exatidao IN ('I','II','III','IIII')),
    local_instalacao    text,
    periodicidade_meses integer NOT NULL DEFAULT 12,
    ativa               boolean NOT NULL DEFAULT true,
    criado_em           timestamptz NOT NULL DEFAULT now(),
    UNIQUE (empresa_id, cliente_id, identificacao)
);

CREATE TABLE peso_padrao (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id       uuid          NOT NULL REFERENCES empresa(id),
    identificacao    text          NOT NULL,            -- ex.: 'MB-P01'
    valor_nominal    numeric(12,4) NOT NULL,            -- kg
    classe           text          NOT NULL,            -- M1, M2, F1...
    num_certificado  text,                              -- cert. do próprio peso
    laboratorio      text,
    validade         date          NOT NULL,
    ativo            boolean       NOT NULL DEFAULT true,
    criado_em        timestamptz   NOT NULL DEFAULT now(),
    UNIQUE (empresa_id, identificacao)
);

-- ================================================================
-- BLOCO 2 — Certificado e ensaios
-- ================================================================

CREATE TABLE certificado (
    id                uuid PRIMARY KEY,                 -- UUID gerado no CLIENTE
                                                        -- (PWA) p/ sync idempotente
    empresa_id        uuid NOT NULL REFERENCES empresa(id),
    cliente_id        uuid NOT NULL REFERENCES cliente(id),
    balanca_id        uuid NOT NULL REFERENCES balanca(id),
    tecnico_id        uuid NOT NULL REFERENCES usuario(id),
    aprovador_id      uuid REFERENCES usuario(id),
    numero            text,                             -- só na emissão
    revisao           integer NOT NULL DEFAULT 0,
    cert_original_id  uuid REFERENCES certificado(id),
    status            text NOT NULL DEFAULT 'rascunho'
                      CHECK (status IN ('rascunho','aguardando_aprovacao',
                                        'emitido','cancelado')),
    data_calibracao   date,
    data_emissao      timestamptz,
    temperatura       numeric(5,2),
    umidade           numeric(5,2),
    incerteza_k       numeric(4,2) DEFAULT 2.00,
    dados_rascunho    jsonb,                            -- estado do PWA offline
    pdf_url           text,
    hash_sha256       text,                             -- impressão digital do PDF
    uuid_validacao    uuid UNIQUE DEFAULT gen_random_uuid(),  -- vai no QR Code
    email_enviado_em  timestamptz,
    criado_em         timestamptz NOT NULL DEFAULT now(),
    atualizado_em     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (empresa_id, numero)
);

CREATE TABLE ensaio_indicacao (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id      uuid NOT NULL REFERENCES empresa(id),
    certificado_id  uuid NOT NULL REFERENCES certificado(id) ON DELETE CASCADE,
    ordem           integer NOT NULL,
    carga_aplicada  numeric(12,3) NOT NULL,
    indicacao       numeric(12,3) NOT NULL,
    erro            numeric(12,3) NOT NULL,
    incerteza       numeric(12,4),
    ema             numeric(12,3),
    aprovado        boolean,
    UNIQUE (certificado_id, ordem)
);

CREATE TABLE ensaio_excentricidade (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id      uuid NOT NULL REFERENCES empresa(id),
    certificado_id  uuid NOT NULL REFERENCES certificado(id) ON DELETE CASCADE,
    posicao         text NOT NULL,                      -- 'centro','secao_1'...
    carga           numeric(12,3) NOT NULL,
    indicacao       numeric(12,3) NOT NULL,
    erro            numeric(12,3) NOT NULL
);

CREATE TABLE ensaio_repetibilidade (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id      uuid NOT NULL REFERENCES empresa(id),
    certificado_id  uuid NOT NULL REFERENCES certificado(id) ON DELETE CASCADE,
    medicao_num     integer NOT NULL,
    carga           numeric(12,3) NOT NULL,
    indicacao       numeric(12,3) NOT NULL,
    UNIQUE (certificado_id, medicao_num)
);

-- Fotografia dos pesos usados na data (não referência viva)
CREATE TABLE certificado_peso (
    certificado_id   uuid NOT NULL REFERENCES certificado(id) ON DELETE CASCADE,
    peso_padrao_id   uuid NOT NULL REFERENCES peso_padrao(id),
    empresa_id       uuid NOT NULL REFERENCES empresa(id),
    num_cert_peso    text,                              -- congelado na emissão
    validade_na_data date,                              -- congelada na emissão
    PRIMARY KEY (certificado_id, peso_padrao_id)
);

CREATE TABLE anexo (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id      uuid NOT NULL REFERENCES empresa(id),
    certificado_id  uuid NOT NULL REFERENCES certificado(id) ON DELETE CASCADE,
    tipo            text NOT NULL DEFAULT 'foto',
    url             text NOT NULL,
    criado_em       timestamptz NOT NULL DEFAULT now()
);

-- ================================================================
-- BLOCO 3 — Apoio
-- ================================================================

-- GLOBAL (sem empresa_id): a Portaria vale para todos os tenants
CREATE TABLE ema_regra (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    classe_exatidao  text NOT NULL CHECK (classe_exatidao IN ('I','II','III','IIII')),
    contexto         text NOT NULL CHECK (contexto IN ('subsequente','em_uso')),
    faixa_min_e      numeric(14,2) NOT NULL,            -- em múltiplos de e
    faixa_max_e      numeric(14,2),                     -- NULL = sem limite
    ema_multiplo_e   numeric(6,2) NOT NULL,             -- EMA em múltiplos de e
    norma_ref        text NOT NULL,
    vigencia_inicio  date NOT NULL DEFAULT '2000-01-01'
);

CREATE TABLE notificacao (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id      uuid NOT NULL REFERENCES empresa(id),
    certificado_id  uuid REFERENCES certificado(id),
    tipo            text NOT NULL,   -- 'certificado_emitido','vencimento_30d'...
    destinatario    text NOT NULL,
    status          text NOT NULL DEFAULT 'pendente'
                    CHECK (status IN ('pendente','enviado','falha')),
    tentativas      integer NOT NULL DEFAULT 0,
    enviado_em      timestamptz,
    criado_em       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE log_auditoria (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    empresa_id    uuid,
    usuario_id    uuid,
    entidade      text NOT NULL,
    entidade_id   uuid,
    acao          text NOT NULL,     -- 'insert','update','delete','emissao','login'
    dados_antes   jsonb,
    dados_depois  jsonb,
    ip_origem     text,
    criado_em     timestamptz NOT NULL DEFAULT now()
);

-- ================================================================
-- ÍNDICES
-- ================================================================

CREATE INDEX idx_cert_empresa_status ON certificado (empresa_id, status);
CREATE INDEX idx_cert_balanca_data   ON certificado (balanca_id, data_calibracao DESC);
CREATE INDEX idx_cert_cliente        ON certificado (cliente_id);
CREATE INDEX idx_peso_validade       ON peso_padrao (empresa_id, validade);
CREATE INDEX idx_balanca_cliente     ON balanca (cliente_id);
CREATE INDEX idx_notif_pendentes     ON notificacao (status) WHERE status = 'pendente';
CREATE INDEX idx_audit_entidade      ON log_auditoria (entidade, entidade_id);

-- ================================================================
-- ROW-LEVEL SECURITY
-- A API executa, a cada request:
--   SET app.empresa_id = '<uuid vindo do JWT>';
-- O Postgres então filtra TUDO sozinho.
-- ================================================================

CREATE OR REPLACE FUNCTION current_empresa_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.empresa_id', true), '')::uuid
$$;

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'usuario','cliente','usuario_portal','balanca','peso_padrao',
        'certificado','ensaio_indicacao','ensaio_excentricidade',
        'ensaio_repetibilidade','certificado_peso','anexo','notificacao'
    ] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I
             USING (empresa_id = current_empresa_id())
             WITH CHECK (empresa_id = current_empresa_id())', t);
    END LOOP;
END $$;

-- empresa: o tenant só enxerga a si mesmo
ALTER TABLE empresa ENABLE ROW LEVEL SECURITY;
ALTER TABLE empresa FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_self ON empresa
    USING (id = current_empresa_id());

-- IMPORTANTE: crie um usuário de aplicação SEM bypass de RLS.
-- O superusuário (postgres) ignora RLS — a API nunca deve conectar com ele.
--   CREATE ROLE app_user LOGIN PASSWORD '...' NOSUPERUSER;
--   GRANT USAGE ON SCHEMA public TO app_user;
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;

-- ================================================================
-- IMUTABILIDADE: certificado emitido não muda nunca mais
-- (única exceção: registrar email_enviado_em)
-- ================================================================

CREATE OR REPLACE FUNCTION bloqueia_certificado_emitido() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'emitido' THEN
            RAISE EXCEPTION 'Certificado emitido não pode ser excluído (nº %)', OLD.numero;
        END IF;
        RETURN OLD;
    END IF;
    IF OLD.status = 'emitido'
       AND (to_jsonb(NEW) - 'email_enviado_em' - 'atualizado_em')
           IS DISTINCT FROM
           (to_jsonb(OLD) - 'email_enviado_em' - 'atualizado_em') THEN
        RAISE EXCEPTION 'Certificado emitido é imutável (nº %). Emita uma revisão.', OLD.numero;
    END IF;
    NEW.atualizado_em := now();
    RETURN NEW;
END $$;

CREATE TRIGGER trg_cert_imutavel
    BEFORE UPDATE OR DELETE ON certificado
    FOR EACH ROW EXECUTE FUNCTION bloqueia_certificado_emitido();

-- Filhos (ensaios) travam junto com o pai
CREATE OR REPLACE FUNCTION bloqueia_ensaio_de_emitido() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_status text;
BEGIN
    SELECT status INTO v_status FROM certificado
     WHERE id = COALESCE(NEW.certificado_id, OLD.certificado_id);
    IF v_status = 'emitido' THEN
        RAISE EXCEPTION 'Ensaios de certificado emitido são imutáveis.';
    END IF;
    RETURN COALESCE(NEW, OLD);
END $$;

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'ensaio_indicacao','ensaio_excentricidade',
        'ensaio_repetibilidade','certificado_peso'
    ] LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_%s_imutavel
             BEFORE INSERT OR UPDATE OR DELETE ON %I
             FOR EACH ROW EXECUTE FUNCTION bloqueia_ensaio_de_emitido()', t, t);
    END LOOP;
END $$;

-- ================================================================
-- EMISSÃO: numeração transacional sem furo nem duplicata
-- Chamar DENTRO da transação que finaliza o certificado:
--   SELECT emitir_certificado('<uuid do certificado>');
-- ================================================================

CREATE OR REPLACE FUNCTION emitir_certificado(p_cert_id uuid) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
    v_num     integer;
    v_prefixo text;
    v_numero  text;
    v_emp     uuid;
BEGIN
    SELECT empresa_id INTO v_emp FROM certificado
     WHERE id = p_cert_id AND status = 'aguardando_aprovacao'
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Certificado não encontrado ou não está aguardando aprovação.';
    END IF;

    -- Bloqueio: peso padrão vencido impede emissão
    IF EXISTS (
        SELECT 1 FROM certificado_peso cp
        JOIN peso_padrao pp ON pp.id = cp.peso_padrao_id
        WHERE cp.certificado_id = p_cert_id
          AND pp.validade < CURRENT_DATE
    ) THEN
        RAISE EXCEPTION 'Há peso padrão com calibração vencida vinculado a este certificado.';
    END IF;

    -- Lock de linha da empresa garante numeração única sob concorrência
    UPDATE empresa
       SET proximo_numero = proximo_numero + 1
     WHERE id = v_emp
    RETURNING proximo_numero - 1, prefixo_cert INTO v_num, v_prefixo;

    v_numero := format('%s-%s/%s', v_prefixo,
                       to_char(now(), 'YYYY'), lpad(v_num::text, 4, '0'));

    UPDATE certificado
       SET numero       = v_numero,
           status       = 'emitido',
           data_emissao = now()
     WHERE id = p_cert_id;

    -- Congela a fotografia dos pesos padrão usados
    UPDATE certificado_peso cp
       SET num_cert_peso    = pp.num_certificado,
           validade_na_data = pp.validade
      FROM peso_padrao pp
     WHERE pp.id = cp.peso_padrao_id
       AND cp.certificado_id = p_cert_id;

    RETURN v_numero;
END $$;
