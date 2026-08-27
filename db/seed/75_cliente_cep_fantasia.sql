-- ═══════════════════════════════════════════════════════════
-- 75 · Cliente: campos CEP e Nome Fantasia
-- ═══════════════════════════════════════════════════════════
ALTER TABLE cliente ADD COLUMN IF NOT EXISTS nome_fantasia text;
ALTER TABLE cliente ADD COLUMN IF NOT EXISTS cep text;

SELECT 'campos cep e nome_fantasia adicionados ao cliente' AS resultado;
