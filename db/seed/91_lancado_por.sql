-- ═══════════════════════════════════════════════════════════════
-- 91 · "Ensaio executado por" x "lançado por"
-- Caso de uso: o técnico faz a calibração em campo SEM internet e
-- anota os dados; o responsável técnico lança no sistema depois.
--
-- tecnico_id      = quem EXECUTOU o ensaio (vai no certificado)
-- lancado_por     = quem REGISTROU no sistema (quando diferente)
-- Ambos ficam no certificado e na auditoria — transparência total,
-- que é o que sustenta o documento numa auditoria do Inmetro/Cgcre.
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS lancado_por uuid REFERENCES usuario(id);

COMMENT ON COLUMN certificado.lancado_por IS
  'Usuário que registrou o ensaio no sistema, quando diferente do técnico executor (ex.: ensaio feito em campo sem internet). NULL = quem executou também lançou.';

SELECT 'Migração 91: certificado.lancado_por' AS resultado;
