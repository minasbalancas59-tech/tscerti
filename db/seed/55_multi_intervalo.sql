-- ═══════════════════════════════════════════════════════════
-- 55 · Balanças multi-intervalo (múltiplas divisões por faixa)
--   Um instrumento multi-intervalo tem a divisão (e) que muda
--   conforme a carga. Ex.: 30 kg → até 6 kg: e=2 g; até 15 kg:
--   e=5 g; acima: e=10 g.
--   O EMA é calculado com o "e" da FAIXA onde a carga está
--   (OIML R76, instrumento multi-intervalo).
--
--   Compatibilidade: balanças SEM faixas cadastradas continuam
--   usando o divisao_e único (comportamento atual preservado).
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS balanca_faixa (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    balanca_id   uuid NOT NULL REFERENCES balanca(id) ON DELETE CASCADE,
    empresa_id   uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    ordem        int  NOT NULL,              -- 1, 2, 3
    limite_sup   numeric(12,3) NOT NULL,     -- carga máxima desta faixa (kg)
    divisao_e    numeric(12,4) NOT NULL,     -- "e" desta faixa (kg)
    UNIQUE (balanca_id, ordem)
);
CREATE INDEX IF NOT EXISTS idx_balanca_faixa ON balanca_faixa (balanca_id, ordem);

-- Marca se a balança é multi-intervalo (tem faixas). Facilita consultas.
ALTER TABLE balanca ADD COLUMN IF NOT EXISTS multi_intervalo boolean NOT NULL DEFAULT false;

-- Guarda, em cada ponto de indicação do certificado, o "e" usado
-- naquele ponto (congela a divisão da faixa no momento da emissão).
ALTER TABLE ensaio_indicacao ADD COLUMN IF NOT EXISTS divisao_e_ponto numeric(12,4);

-- RLS: mesma política de isolamento por empresa das demais tabelas
ALTER TABLE balanca_faixa ENABLE ROW LEVEL SECURITY;
ALTER TABLE balanca_faixa FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON balanca_faixa;
CREATE POLICY tenant_isolation ON balanca_faixa
    USING (empresa_id = current_empresa_id())
    WITH CHECK (empresa_id = current_empresa_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON balanca_faixa TO api_app;

SELECT 'balanças multi-intervalo adicionadas' AS resultado;
