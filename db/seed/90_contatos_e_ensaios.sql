-- ═══════════════════════════════════════════════════════════════
-- 90 · Contatos do cliente + ensaios aplicáveis por balança
-- • cliente_contato: vários contatos por cliente (nome, cargo,
--   telefone, e-mail)
-- • balanca.faz_excentricidade / faz_sensibilidade: balanças
--   suspensas (de gancho/pendural) não realizam esses ensaios.
--   Default TRUE (comportamento atual preservado).
-- ═══════════════════════════════════════════════════════════════

-- ── Contatos do cliente ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS cliente_contato (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id  uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    cliente_id  uuid NOT NULL REFERENCES cliente(id) ON DELETE CASCADE,
    nome        text NOT NULL,
    cargo       text,
    telefone    text,
    email       text,
    observacao  text,
    criado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cliente_contato ON cliente_contato (cliente_id, nome);
ALTER TABLE cliente_contato ENABLE ROW LEVEL SECURITY;
ALTER TABLE cliente_contato FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON cliente_contato;
CREATE POLICY tenant_isolation ON cliente_contato
    USING (empresa_id = current_empresa_id())
    WITH CHECK (empresa_id = current_empresa_id());

-- ── Ensaios aplicáveis por balança ──────────────────────────
ALTER TABLE balanca ADD COLUMN IF NOT EXISTS faz_excentricidade boolean NOT NULL DEFAULT true;
ALTER TABLE balanca ADD COLUMN IF NOT EXISTS faz_sensibilidade  boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN balanca.faz_excentricidade IS
  'FALSE para instrumentos em que o ensaio não se aplica (ex.: balanças suspensas/de gancho). O certificado registra "Não aplicável".';
COMMENT ON COLUMN balanca.faz_sensibilidade IS
  'FALSE para instrumentos em que o ensaio não se aplica. O certificado registra "Não aplicável".';

SELECT 'Migração 90: cliente_contato + faz_excentricidade/faz_sensibilidade' AS resultado;
