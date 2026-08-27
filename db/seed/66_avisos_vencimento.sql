-- ═══════════════════════════════════════════════════════════
-- 66 · Avisos de vencimento de calibração (automático + manual)
--   • Config por empresa (liga/desliga, prazos, frequência, cópia gestor)
--   • Log de avisos enviados (controla frequência / evita spam)
--   • Função que agrupa, por cliente, as balanças a vencer
-- ═══════════════════════════════════════════════════════════

-- ── 1. Configuração na empresa ──────────────────────────────
ALTER TABLE empresa
    ADD COLUMN IF NOT EXISTS aviso_venc_ativo      boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS aviso_venc_dias        text   NOT NULL DEFAULT '30,15,7',  -- marcos (dias antes)
    ADD COLUMN IF NOT EXISTS aviso_venc_freq_dias   int    NOT NULL DEFAULT 30,          -- reenvio mínimo (dias) por cliente
    ADD COLUMN IF NOT EXISTS aviso_venc_copia_gestor boolean NOT NULL DEFAULT true;

-- ── 2. Log de avisos de vencimento ──────────────────────────
CREATE TABLE IF NOT EXISTS aviso_vencimento (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    empresa_id   uuid NOT NULL REFERENCES empresa(id),
    cliente_id   uuid NOT NULL REFERENCES cliente(id),
    enviado_em   timestamptz NOT NULL DEFAULT now(),
    modo         text NOT NULL,                 -- 'automatico' | 'manual'
    qtd_balancas int  NOT NULL,
    email_para   text,
    usuario_id   uuid                            -- quem disparou (manual); null no automático
);
CREATE INDEX IF NOT EXISTS idx_aviso_venc_cliente ON aviso_vencimento(cliente_id, enviado_em DESC);

-- RLS (mesma política das demais tabelas por tenant)
ALTER TABLE aviso_vencimento ENABLE ROW LEVEL SECURITY;
ALTER TABLE aviso_vencimento FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON aviso_vencimento;
CREATE POLICY tenant_isolation ON aviso_vencimento
    USING (empresa_id = current_empresa_id())
    WITH CHECK (empresa_id = current_empresa_id());

-- ── 3. Clientes com balanças a vencer, agrupados ────────────
-- Retorna uma linha por cliente que tem ao menos uma balança dentro
-- do maior marco (dias). O detalhe das balanças vem em JSON para o e-mail.
-- Respeita a frequência: só inclui clientes não avisados nos últimos
-- p_freq_dias dias (quando p_respeitar_freq = true, usado no automático).
CREATE OR REPLACE FUNCTION avisos_vencimento_pendentes(
    p_max_dias int,              -- maior marco (ex.: 30)
    p_freq_dias int,             -- intervalo mínimo entre avisos ao mesmo cliente
    p_respeitar_freq boolean DEFAULT true,
    p_cliente uuid DEFAULT NULL  -- filtra um cliente (envio manual)
)
RETURNS TABLE (
    cliente_id uuid, cliente text, email text, qtd bigint, balancas jsonb
) LANGUAGE sql STABLE AS $$
    WITH venc AS (
        SELECT c.id AS cliente_id, c.razao_social, c.email,
               b.identificacao, b.tipo,
               (ult.data_calibracao + make_interval(months => COALESCE(b.periodicidade_meses, 12)))::date AS vence_em
          FROM balanca b
          JOIN cliente c ON c.id = b.cliente_id
          LEFT JOIN LATERAL (
              SELECT ct.data_calibracao FROM certificado ct
               WHERE ct.balanca_id = b.id AND ct.status = 'emitido'
               ORDER BY ct.data_calibracao DESC LIMIT 1
          ) ult ON true
         WHERE b.ativa AND c.ativo
           AND ult.data_calibracao IS NOT NULL
           AND (p_cliente IS NULL OR c.id = p_cliente)
           -- dentro do marco: vence entre hoje e hoje+p_max_dias
           AND (ult.data_calibracao + make_interval(months => COALESCE(b.periodicidade_meses, 12)))::date
               BETWEEN now()::date AND (now()::date + p_max_dias)
    )
    SELECT v.cliente_id, v.razao_social, v.email, count(*),
           jsonb_agg(jsonb_build_object(
               'balanca', v.identificacao, 'tipo', v.tipo, 'vence_em', v.vence_em)
               ORDER BY v.vence_em)
      FROM venc v
     WHERE NOT p_respeitar_freq OR NOT EXISTS (
         SELECT 1 FROM aviso_vencimento av
          WHERE av.cliente_id = v.cliente_id
            AND av.enviado_em > now() - make_interval(days => p_freq_dias))
     GROUP BY v.cliente_id, v.razao_social, v.email
     ORDER BY v.razao_social;
$$;

SELECT 'avisos de vencimento criados' AS resultado;
