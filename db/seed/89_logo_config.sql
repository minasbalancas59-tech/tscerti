-- 89: tamanho e alinhamento do logo no PDF, ajustaveis nas Configuracoes
ALTER TABLE empresa ADD COLUMN IF NOT EXISTS logo_largura integer NOT NULL DEFAULT 90;
ALTER TABLE empresa ADD COLUMN IF NOT EXISTS logo_altura integer NOT NULL DEFAULT 55;
ALTER TABLE empresa ADD COLUMN IF NOT EXISTS logo_alinhamento text NOT NULL DEFAULT 'topo';
