-- ================================================================
-- Carga inicial: erros máximos admissíveis por classe de exatidão
-- Referência: Portaria Inmetro 157/2022, Tabela 5, coluna VERIFICAÇÃO
--   (aplicável às verificações inicial e subsequente): 1e / 2e / 2e.
-- 'em_uso' = inspeção em serviço, item 2.5.3: dobro da verificação.
-- Valores confirmados contra a Tabela 5 em 16/07/2026 (Minas Balanças).
-- ================================================================

INSERT INTO ema_regra (classe_exatidao, contexto, faixa_min_e, faixa_max_e, ema_multiplo_e, norma_ref) VALUES
-- Classe I
('I',    'subsequente', 0,      50000,  1.0, 'Portaria Inmetro 157/2022 — Tabela 5 (Verificação)'),
('I',    'subsequente', 50000,  200000, 2.0, 'Portaria Inmetro 157/2022 — Tabela 5 (Verificação)'),
('I',    'subsequente', 200000, NULL,   2.0, 'Portaria Inmetro 157/2022 — Tabela 5 (Verificação)'),
('I',    'em_uso',      0,      50000,  2.0, 'Portaria Inmetro 157/2022 — item 2.5.3'),
('I',    'em_uso',      50000,  200000, 4.0, 'Portaria Inmetro 157/2022 — item 2.5.3'),
('I',    'em_uso',      200000, NULL,   4.0, 'Portaria Inmetro 157/2022 — item 2.5.3'),
-- Classe II
('II',   'subsequente', 0,      5000,   1.0, 'Portaria Inmetro 157/2022 — Tabela 5 (Verificação)'),
('II',   'subsequente', 5000,   20000,  2.0, 'Portaria Inmetro 157/2022 — Tabela 5 (Verificação)'),
('II',   'subsequente', 20000,  100000, 2.0, 'Portaria Inmetro 157/2022 — Tabela 5 (Verificação)'),
('II',   'em_uso',      0,      5000,   2.0, 'Portaria Inmetro 157/2022 — item 2.5.3'),
('II',   'em_uso',      5000,   20000,  4.0, 'Portaria Inmetro 157/2022 — item 2.5.3'),
('II',   'em_uso',      20000,  100000, 4.0, 'Portaria Inmetro 157/2022 — item 2.5.3'),
-- Classe III
('III',  'subsequente', 0,      500,    1.0, 'Portaria Inmetro 157/2022 — Tabela 5 (Verificação)'),
('III',  'subsequente', 500,    2000,   2.0, 'Portaria Inmetro 157/2022 — Tabela 5 (Verificação)'),
('III',  'subsequente', 2000,   10000,  2.0, 'Portaria Inmetro 157/2022 — Tabela 5 (Verificação)'),
('III',  'em_uso',      0,      500,    2.0, 'Portaria Inmetro 157/2022 — item 2.5.3'),
('III',  'em_uso',      500,    2000,   4.0, 'Portaria Inmetro 157/2022 — item 2.5.3'),
('III',  'em_uso',      2000,   10000,  4.0, 'Portaria Inmetro 157/2022 — item 2.5.3'),
-- Classe IIII
('IIII', 'subsequente', 0,      50,     1.0, 'Portaria Inmetro 157/2022 — Tabela 5 (Verificação)'),
('IIII', 'subsequente', 50,     200,    2.0, 'Portaria Inmetro 157/2022 — Tabela 5 (Verificação)'),
('IIII', 'subsequente', 200,    1000,   2.0, 'Portaria Inmetro 157/2022 — Tabela 5 (Verificação)'),
('IIII', 'em_uso',      0,      50,     2.0, 'Portaria Inmetro 157/2022 — item 2.5.3'),
('IIII', 'em_uso',      50,     200,    4.0, 'Portaria Inmetro 157/2022 — item 2.5.3'),
('IIII', 'em_uso',      200,    1000,   4.0, 'Portaria Inmetro 157/2022 — item 2.5.3');
