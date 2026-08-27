-- ================================================================
-- CORREÇÃO METROLÓGICA: EMA conforme Tabela 5 da Portaria 157/2022
--
-- Antes: a tabela usava os valores da coluna "Aprovação de Modelo"
--        (0,5e / 1,0e / 1,5e) como se fossem os da verificação.
-- Agora: coluna "Verificação" (inicial e subsequente): 1e / 2e / 2e
--        Inspeção em serviço (item 2.5.3): o dobro:     2e / 4e / 4e
--
-- Confirmado por João (Minas Balanças) contra a Tabela 5 em 16/07/2026.
-- Certificados já emitidos NÃO são afetados (EMA congelado por ponto).
--
--   docker compose exec -T db psql -U certsaas -d certsaas < db/seed/25_ema_tabela5.sql
-- ================================================================

BEGIN;

DELETE FROM ema_regra;

INSERT INTO ema_regra (classe_exatidao, contexto, faixa_min_e, faixa_max_e, ema_multiplo_e, norma_ref) VALUES
-- Classe I
('I',    'subsequente', 0,      50000,  1.0, 'Portaria Inmetro 157/2022 — Tabela 5 (Verificação)'),
('I',    'subsequente', 50000,  200000, 2.0, 'Portaria Inmetro 157/2022 — Tabela 5 (Verificação)'),
('I',    'subsequente', 200000, NULL,   2.0, 'Portaria Inmetro 157/2022 — Tabela 5 (Verificação)'),
('I',    'em_uso',      0,      50000,  2.0, 'Portaria Inmetro 157/2022 — item 2.5.3 (dobro da verificação)'),
('I',    'em_uso',      50000,  200000, 4.0, 'Portaria Inmetro 157/2022 — item 2.5.3 (dobro da verificação)'),
('I',    'em_uso',      200000, NULL,   4.0, 'Portaria Inmetro 157/2022 — item 2.5.3 (dobro da verificação)'),
-- Classe II
('II',   'subsequente', 0,      5000,   1.0, 'Portaria Inmetro 157/2022 — Tabela 5 (Verificação)'),
('II',   'subsequente', 5000,   20000,  2.0, 'Portaria Inmetro 157/2022 — Tabela 5 (Verificação)'),
('II',   'subsequente', 20000,  100000, 2.0, 'Portaria Inmetro 157/2022 — Tabela 5 (Verificação)'),
('II',   'em_uso',      0,      5000,   2.0, 'Portaria Inmetro 157/2022 — item 2.5.3 (dobro da verificação)'),
('II',   'em_uso',      5000,   20000,  4.0, 'Portaria Inmetro 157/2022 — item 2.5.3 (dobro da verificação)'),
('II',   'em_uso',      20000,  100000, 4.0, 'Portaria Inmetro 157/2022 — item 2.5.3 (dobro da verificação)'),
-- Classe III (rodoviárias, plataformas industriais)
('III',  'subsequente', 0,      500,    1.0, 'Portaria Inmetro 157/2022 — Tabela 5 (Verificação)'),
('III',  'subsequente', 500,    2000,   2.0, 'Portaria Inmetro 157/2022 — Tabela 5 (Verificação)'),
('III',  'subsequente', 2000,   10000,  2.0, 'Portaria Inmetro 157/2022 — Tabela 5 (Verificação)'),
('III',  'em_uso',      0,      500,    2.0, 'Portaria Inmetro 157/2022 — item 2.5.3 (dobro da verificação)'),
('III',  'em_uso',      500,    2000,   4.0, 'Portaria Inmetro 157/2022 — item 2.5.3 (dobro da verificação)'),
('III',  'em_uso',      2000,   10000,  4.0, 'Portaria Inmetro 157/2022 — item 2.5.3 (dobro da verificação)'),
-- Classe IIII
('IIII', 'subsequente', 0,      50,     1.0, 'Portaria Inmetro 157/2022 — Tabela 5 (Verificação)'),
('IIII', 'subsequente', 50,     200,    2.0, 'Portaria Inmetro 157/2022 — Tabela 5 (Verificação)'),
('IIII', 'subsequente', 200,    1000,   2.0, 'Portaria Inmetro 157/2022 — Tabela 5 (Verificação)'),
('IIII', 'em_uso',      0,      50,     2.0, 'Portaria Inmetro 157/2022 — item 2.5.3 (dobro da verificação)'),
('IIII', 'em_uso',      50,     200,    4.0, 'Portaria Inmetro 157/2022 — item 2.5.3 (dobro da verificação)'),
('IIII', 'em_uso',      200,    1000,   4.0, 'Portaria Inmetro 157/2022 — item 2.5.3 (dobro da verificação)');

COMMIT;

SELECT classe_exatidao, contexto, faixa_min_e, faixa_max_e, ema_multiplo_e
  FROM ema_regra ORDER BY classe_exatidao, contexto, faixa_min_e;
