-- 88: leitura "antes do ajuste" tambem na excentricidade (como na indicacao)
ALTER TABLE ensaio_excentricidade ADD COLUMN IF NOT EXISTS indicacao_antes numeric;
