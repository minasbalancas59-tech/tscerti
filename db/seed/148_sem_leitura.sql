-- Ensaio de indicacao: ponto "SEM LEITURA" (o visor nao indicou na carga).
-- indicacao/erro passam a aceitar nulo nesse caso; o ponto e reprovado.
-- Joao, 22/08/2026.
ALTER TABLE ensaio_indicacao ADD COLUMN IF NOT EXISTS sem_leitura boolean NOT NULL DEFAULT false;
ALTER TABLE ensaio_indicacao ALTER COLUMN indicacao DROP NOT NULL;
ALTER TABLE ensaio_indicacao ALTER COLUMN erro DROP NOT NULL;
