-- ═══════════════════════════════════════════════════════════
-- 54 · Pressão atmosférica nas condições ambientais
--   Adiciona o registro da pressão atmosférica (hPa) às condições
--   do certificado, junto de temperatura e umidade.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE certificado ADD COLUMN IF NOT EXISTS pressao numeric(7,2);

SELECT 'pressão atmosférica adicionada' AS resultado;
