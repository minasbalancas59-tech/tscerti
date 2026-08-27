-- ═══════════════════════════════════════════════════════════
-- 78 · Cliente: pessoa física ou jurídica
-- Adiciona tipo_pessoa (PJ padrão). A coluna cnpj (text, sem
-- constraint) passa a guardar CNPJ ou CPF, e já aceita letras
-- (preparada para o CNPJ alfanumérico da Receita, 2026).
-- ═══════════════════════════════════════════════════════════
ALTER TABLE cliente ADD COLUMN IF NOT EXISTS tipo_pessoa text NOT NULL DEFAULT 'PJ';

SELECT 'coluna tipo_pessoa adicionada (default PJ)' AS resultado;
