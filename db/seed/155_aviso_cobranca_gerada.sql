-- Aviso de mensalidade disponível: dispara no mesmo dia em que a cobrança é
-- gerada (dia 1º), avisando o cliente antes do lembrete de vencimento (que só
-- chega 5 dias antes). Mesmo padrão de lembrete_em / aviso_atraso_em, para não
-- reenviar duas vezes. João, 09/09/2026.
ALTER TABLE cobranca ADD COLUMN IF NOT EXISTS aviso_gerada_em timestamptz;

-- Cobrancas ja existentes (competencia anterior a hoje) nao devem disparar o
-- aviso de "disponivel" retroativamente — isso mandaria e-mail de mes ja
-- vencido dizendo "acabou de ficar disponivel", o que confunde o cliente.
UPDATE cobranca
   SET aviso_gerada_em = now()
 WHERE aviso_gerada_em IS NULL
   AND competencia < date_trunc('month', current_date)::date;
