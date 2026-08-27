-- 91: PDF do contrato assinado anexado ao contrato (chave no MinIO)
ALTER TABLE contrato ADD COLUMN IF NOT EXISTS arquivo_assinado text;
ALTER TABLE contrato ADD COLUMN IF NOT EXISTS arquivo_assinado_nome text;
ALTER TABLE contrato ADD COLUMN IF NOT EXISTS arquivo_assinado_em timestamptz;
