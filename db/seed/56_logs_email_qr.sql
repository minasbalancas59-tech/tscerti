-- ═══════════════════════════════════════════════════════════
-- 56 · Logs de e-mail e de consultas por QR code
--   Três recursos para o super-admin:
--   1) Registro de todo e-mail enviado (para quem, motivo, status)
--   2) Status/erros de SMTP → alerta no topo do super-admin
--   3) Registro de cada consulta de certificado pelo QR code / link
--
--   "Confirmação de recebimento": o envio fica registrado (status
--   'enviado' ou 'erro'), e quando o cliente ACESSA o certificado
--   (QR/link), isso é registrado em consulta_certificado — evidência
--   real de que o certificado chegou e foi acessado.
-- ═══════════════════════════════════════════════════════════

-- ── 1. Log de e-mails enviados ──────────────────────────────
CREATE TABLE IF NOT EXISTS email_log (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id    uuid REFERENCES empresa(id) ON DELETE SET NULL,  -- null = e-mail do sistema (super-admin)
    cliente_id    uuid REFERENCES cliente(id) ON DELETE SET NULL,  -- quando o destinatário é um cliente
    certificado_id uuid REFERENCES certificado(id) ON DELETE SET NULL,
    destinatario  text NOT NULL,                 -- e-mail de destino
    nome_destino  text,
    assunto       text NOT NULL,
    motivo        text NOT NULL,                 -- 'certificado', 'convite', 'confirmacao_portal', 'chamado', 'contrato_vencendo', 'teste', ...
    status        text NOT NULL DEFAULT 'enviado' CHECK (status IN ('enviado','erro')),
    erro_detalhe  text,                          -- mensagem de erro quando status='erro'
    enviado_em    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_log_empresa ON email_log (empresa_id, enviado_em DESC);
CREATE INDEX IF NOT EXISTS idx_email_log_cliente ON email_log (cliente_id, enviado_em DESC);
CREATE INDEX IF NOT EXISTS idx_email_log_status  ON email_log (status, enviado_em DESC);

-- ── 2. Log de consultas de certificado (QR code / link público) ──
CREATE TABLE IF NOT EXISTS consulta_certificado (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    certificado_id uuid REFERENCES certificado(id) ON DELETE SET NULL,
    empresa_id     uuid REFERENCES empresa(id) ON DELETE SET NULL,
    cliente_id     uuid REFERENCES cliente(id) ON DELETE SET NULL,
    uuid_validacao uuid,                         -- guarda mesmo se o certificado sumir
    origem         text NOT NULL DEFAULT 'qrcode' CHECK (origem IN ('qrcode','link','portal')),
    ip             text,
    user_agent     text,
    consultado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_consulta_cert_empresa ON consulta_certificado (empresa_id, consultado_em DESC);
CREATE INDEX IF NOT EXISTS idx_consulta_cert_cliente ON consulta_certificado (cliente_id, consultado_em DESC);
CREATE INDEX IF NOT EXISTS idx_consulta_cert_cert    ON consulta_certificado (certificado_id, consultado_em DESC);

-- Estas tabelas são de âmbito do super-admin (visão global), sem RLS por tenant.
-- O acesso é restrito no endpoint (só super_admin).
GRANT SELECT, INSERT, UPDATE, DELETE ON email_log TO api_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON consulta_certificado TO api_app;

-- ── Funções de consulta para o super-admin (com filtros) ────

-- Log de e-mails com filtros opcionais (empresa, cliente, período)
CREATE OR REPLACE FUNCTION sa_email_log(
    p_empresa uuid, p_cliente uuid, p_de timestamptz, p_ate timestamptz, p_status text)
RETURNS TABLE (
    id uuid, empresa text, cliente text, destinatario text, nome_destino text,
    assunto text, motivo text, status text, erro_detalhe text,
    certificado_numero text, enviado_em timestamptz
) LANGUAGE sql STABLE AS $$
    SELECT el.id, e.razao_social, c.razao_social, el.destinatario, el.nome_destino,
           el.assunto, el.motivo, el.status, el.erro_detalhe,
           ct.numero, el.enviado_em
      FROM email_log el
      LEFT JOIN empresa e     ON e.id  = el.empresa_id
      LEFT JOIN cliente c     ON c.id  = el.cliente_id
      LEFT JOIN certificado ct ON ct.id = el.certificado_id
     WHERE (p_empresa IS NULL OR el.empresa_id = p_empresa)
       AND (p_cliente IS NULL OR el.cliente_id = p_cliente)
       AND (p_de  IS NULL OR el.enviado_em >= p_de)
       AND (p_ate IS NULL OR el.enviado_em <  p_ate)
       AND (p_status IS NULL OR el.status = p_status)
     ORDER BY el.enviado_em DESC
     LIMIT 500;
$$;

-- Log de consultas por QR com filtros
CREATE OR REPLACE FUNCTION sa_consulta_log(
    p_empresa uuid, p_cliente uuid, p_de timestamptz, p_ate timestamptz)
RETURNS TABLE (
    id uuid, empresa text, cliente text, certificado_numero text,
    origem text, ip text, consultado_em timestamptz
) LANGUAGE sql STABLE AS $$
    SELECT cc.id, e.razao_social, c.razao_social, ct.numero,
           cc.origem, cc.ip, cc.consultado_em
      FROM consulta_certificado cc
      LEFT JOIN empresa e      ON e.id  = cc.empresa_id
      LEFT JOIN cliente c      ON c.id  = cc.cliente_id
      LEFT JOIN certificado ct ON ct.id = cc.certificado_id
     WHERE (p_empresa IS NULL OR cc.empresa_id = p_empresa)
       AND (p_cliente IS NULL OR cc.cliente_id = p_cliente)
       AND (p_de  IS NULL OR cc.consultado_em >= p_de)
       AND (p_ate IS NULL OR cc.consultado_em <  p_ate)
     ORDER BY cc.consultado_em DESC
     LIMIT 500;
$$;

-- Resumo de saúde do e-mail para o alerta no topo (últimas 24h e 7 dias)
CREATE OR REPLACE FUNCTION sa_email_saude()
RETURNS TABLE (
    erros_24h bigint, total_24h bigint, erros_7d bigint,
    ultimo_erro_em timestamptz, ultimo_erro_detalhe text, ultimo_erro_destino text
) LANGUAGE sql STABLE AS $$
    SELECT
      (SELECT count(*) FROM email_log WHERE status='erro' AND enviado_em >= now()-interval '24 hours'),
      (SELECT count(*) FROM email_log WHERE enviado_em >= now()-interval '24 hours'),
      (SELECT count(*) FROM email_log WHERE status='erro' AND enviado_em >= now()-interval '7 days'),
      (SELECT enviado_em   FROM email_log WHERE status='erro' ORDER BY enviado_em DESC LIMIT 1),
      (SELECT erro_detalhe FROM email_log WHERE status='erro' ORDER BY enviado_em DESC LIMIT 1),
      (SELECT destinatario FROM email_log WHERE status='erro' ORDER BY enviado_em DESC LIMIT 1);
$$;

SELECT 'logs de email e QR criados' AS resultado;
