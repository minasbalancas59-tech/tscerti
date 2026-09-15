-- ═══════════════════════════════════════════════════════════
-- 160 · RBC — temperatura/umidade no início e no término do ensaio
--   Opcional por empresa (rbc_temp_umid_inicio_fim, padrão desligado).
--   Desligado: certificado RBC continua com um único valor de
--   temperatura/umidade, como sempre foi (compatível com o que já
--   existe). Ligado: a coleta RBC também pede os valores do término,
--   guardados em temperatura_fim/umidade_fim, e o certificado mostra
--   os dois.
-- ═══════════════════════════════════════════════════════════
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS temperatura_fim numeric(5,2);
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS umidade_fim     numeric(5,2);
ALTER TABLE empresa     ADD COLUMN IF NOT EXISTS rbc_temp_umid_inicio_fim boolean NOT NULL DEFAULT false;

SELECT 'RBC: temperatura/umidade no inicio e termino do ensaio (opcional)' AS resultado;
