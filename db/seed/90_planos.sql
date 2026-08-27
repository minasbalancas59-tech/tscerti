-- 90: planos comerciais no contrato + controle de consumo + lembretes de cobranca
ALTER TABLE contrato ADD COLUMN IF NOT EXISTS plano text;
ALTER TABLE contrato ADD COLUMN IF NOT EXISTS max_usuarios integer;
ALTER TABLE contrato ADD COLUMN IF NOT EXISTS max_certs_mes integer;
-- momento do PRIMEIRO envio para aprovacao (base da contagem mensal do plano)
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS enviado_em timestamptz;
-- controle de lembretes por e-mail (evita duplicar)
ALTER TABLE cobranca ADD COLUMN IF NOT EXISTS lembrete_em timestamptz;
ALTER TABLE cobranca ADD COLUMN IF NOT EXISTS aviso_atraso_em timestamptz;
