-- Sem leitura tambem no campo "antes do ajuste": a balanca chegou sem
-- indicacao, foi ajustada e passou a ler — a conformidade e avaliada
-- sobre a leitura FINAL (sem_leitura_antes nao reprova). Joao, 23/08/2026.
ALTER TABLE ensaio_indicacao ADD COLUMN IF NOT EXISTS sem_leitura_antes boolean NOT NULL DEFAULT false;
