-- ═══════════════════════════════════════════════════════════
-- 58 · Normaliza unidades de massa para minúsculo (kg, g, t)
--   Corrige registros cadastrados como "KG", "Kg", "G", "T" etc.
--   As unidades de massa, por convenção do SI, são sempre minúsculas.
-- ═══════════════════════════════════════════════════════════

UPDATE balanca      SET unidade = lower(trim(unidade))
 WHERE unidade IS DISTINCT FROM lower(trim(unidade));

UPDATE peso_padrao  SET unidade = lower(trim(unidade))
 WHERE unidade IS DISTINCT FROM lower(trim(unidade));

SELECT 'unidades normalizadas para minúsculo' AS resultado;
