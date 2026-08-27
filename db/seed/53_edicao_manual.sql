-- ═══════════════════════════════════════════════════════════
-- 53 · Edição manual de certificados (admin / RT)
--   Permite ao admin ou responsável técnico ajustar manualmente
--   qualquer valor do certificado antes de aprovar (ou gerar uma
--   revisão de um já emitido). Registra a edição para auditoria.
-- ═══════════════════════════════════════════════════════════

-- Observações do certificado (texto livre que sai no PDF)
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS observacao text;

-- Marca que o certificado teve valores editados manualmente
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS editado_manualmente boolean NOT NULL DEFAULT false;
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS editado_por uuid REFERENCES usuario(id);
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS editado_em timestamptz;

SELECT 'edição manual de certificados adicionada' AS resultado;
