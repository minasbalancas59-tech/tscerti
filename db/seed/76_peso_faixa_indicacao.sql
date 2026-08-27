-- ═══════════════════════════════════════════════════════════
-- 76 · Peso padrão: valor_nominal (numeric) → texto "faixa de indicação"
-- Preserva os pesos existentes (numeric vira texto: 500.0000 → "500.0000").
-- ═══════════════════════════════════════════════════════════
-- remove a obrigatoriedade e o tipo numérico
ALTER TABLE peso_padrao ALTER COLUMN valor_nominal DROP NOT NULL;
ALTER TABLE peso_padrao ALTER COLUMN valor_nominal TYPE text
    USING trim(trailing '.' FROM trim(trailing '0' FROM valor_nominal::text));

SELECT 'valor_nominal agora é texto (faixa de indicação)' AS resultado,
       identificacao, valor_nominal FROM peso_padrao ORDER BY identificacao;
