-- ═══════════════════════════════════════════════════════════
-- 169 · Ponto de trabalho + sugestão de cargas em degrau redondo
--
-- Duas colunas novas, ambas opcionais e desligadas/nulas por padrão —
-- zero mudança de comportamento pra quem não usar (sistema em produção
-- com clientes reais, motivo da cautela).
--
-- empresa.usar_ponto_trabalho: liga a nova matemática de sugestão de
-- carga (degrau redondo em vez de 25/50/75/100% exato da capacidade) e
-- o fluxo de perguntar o ponto de trabalho na primeira calibração de
-- cada balança. Vale também pra balança rodoviária, que hoje tem uma
-- sugestão fixa (1.000 a 10.000 kg) que ignora a capacidade real.
--
-- balanca.ponto_trabalho: carga máxima que será de fato testada nessa
-- balança (pode ser menor que a capacidade nominal, por falta de
-- peso-padrão suficiente). Perguntado uma vez, na primeira calibração;
-- fica salvo e reaproveitado silenciosamente depois.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE empresa ADD COLUMN IF NOT EXISTS usar_ponto_trabalho
    boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN empresa.usar_ponto_trabalho IS
    'Quando true, a sugestao de cargas (Conformidade, inclusive rodoviaria)
     usa o degrau redondo (capacidade/4 arredondado) e mira o ponto de
     trabalho da balanca em vez da capacidade cheia. Padrao false =
     comportamento historico (25/50/75/100% da capacidade).';

ALTER TABLE balanca ADD COLUMN IF NOT EXISTS ponto_trabalho numeric(14,4);
COMMENT ON COLUMN balanca.ponto_trabalho IS
    'Carga maxima que sera de fato testada nesta balanca (pode ser menor
     que a capacidade nominal, quando nao ha peso-padrao suficiente pra
     testar ate o limite do equipamento). Perguntado ao tecnico na
     primeira calibracao, quando a empresa tem usar_ponto_trabalho ligado.
     NULL = usa a capacidade cheia (comportamento de sempre).';

SELECT 'Ponto de trabalho: colunas novas em empresa e balanca (padrao desligado/nulo)' AS resultado;
