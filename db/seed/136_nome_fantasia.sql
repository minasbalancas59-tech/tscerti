-- 92: nome fantasia da empresa (etiqueta + cabeçalho do certificado)
ALTER TABLE empresa ADD COLUMN IF NOT EXISTS nome_fantasia text;
