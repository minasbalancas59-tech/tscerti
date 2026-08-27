-- ═══════════════════════════════════════════════════════════
-- 79 · Certificado RBC — FASE 1 (fundação)
-- Empresa: nº acreditação + selo (acreditada já existe).
-- Peso padrão: componentes de incerteza (só usados no modo RBC).
-- Certificado: flag emitir_rbc (para as próximas fases).
-- Empresa NÃO acreditada não usa nada disto — tudo opcional.
-- ═══════════════════════════════════════════════════════════
ALTER TABLE empresa     ADD COLUMN IF NOT EXISTS num_acreditacao text;
ALTER TABLE empresa     ADD COLUMN IF NOT EXISTS selo_rbc_url     text;

ALTER TABLE peso_padrao ADD COLUMN IF NOT EXISTS incerteza_certificado numeric;
ALTER TABLE peso_padrao ADD COLUMN IF NOT EXISTS k_certificado         numeric DEFAULT 2;
ALTER TABLE peso_padrao ADD COLUMN IF NOT EXISTS valor_convencional    numeric;
ALTER TABLE peso_padrao ADD COLUMN IF NOT EXISTS densidade_material    numeric DEFAULT 8000;

ALTER TABLE certificado ADD COLUMN IF NOT EXISTS emitir_rbc boolean NOT NULL DEFAULT false;

SELECT 'Fase 1 RBC: campos de acreditação, incerteza do peso e flag do certificado adicionados' AS resultado;
