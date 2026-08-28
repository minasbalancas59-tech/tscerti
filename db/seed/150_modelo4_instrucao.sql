-- Modelo 4 de certificado (formato formulario, no estilo do usado pela
-- Balancas Gaucha): layout em caixas com bordas, secoes de ensaio lado a
-- lado e o resultado geral em CONFORME / NAO-CONFORME.
--
-- A "instrucao de calibracao" (IT + revisao) e fixa por empresa: todo
-- certificado sai com a mesma, definida nas Configuracoes. Joao, 28/08/2026.
ALTER TABLE empresa ADD COLUMN IF NOT EXISTS instrucao_it text;
ALTER TABLE empresa ADD COLUMN IF NOT EXISTS instrucao_rev text;
