-- 96: valor da implantacao no contrato -> vira cobranca no financeiro
ALTER TABLE contrato ADD COLUMN IF NOT EXISTS valor_implantacao numeric(12,2) NOT NULL DEFAULT 0;
