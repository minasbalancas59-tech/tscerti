-- ═══════════════════════════════════════════════════════════════
-- 89 · Nº de série do INDICADOR + unicidade do nº de série por cliente
-- • num_serie_indicador: o cabeçote eletrônico pode ter série própria.
--   Campo OPCIONAL — quando vazio, não aparece em lugar nenhum.
--   A REFERÊNCIA OFICIAL do instrumento é sempre num_serie (plataforma),
--   que é a série vinculada à portaria de aprovação do Inmetro.
-- • Unicidade: o mesmo cliente não pode ter duas balanças com o mesmo
--   número de série de plataforma (evita cadastro duplicado).
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE balanca ADD COLUMN IF NOT EXISTS num_serie_indicador text;

COMMENT ON COLUMN balanca.num_serie_indicador IS
  'Nº de série do indicador/cabeçote (opcional). A referência oficial do instrumento é num_serie (plataforma).';

-- Índice único parcial: só vale para número preenchido (permite vários NULL/vazio)
CREATE UNIQUE INDEX IF NOT EXISTS uq_balanca_cliente_num_serie
    ON balanca (cliente_id, lower(trim(num_serie)))
 WHERE num_serie IS NOT NULL AND trim(num_serie) <> '';

SELECT 'Migração 89: num_serie_indicador + unicidade (cliente, num_serie)' AS resultado;
