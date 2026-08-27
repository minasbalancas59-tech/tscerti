-- ═══════════════════════════════════════════════════════════
-- 62 · Relatórios de clientes (admin / responsável técnico)
--   Rodam no contexto da empresa (RLS aplica o tenant do gestor).
--   1) rel_clientes          — todos os clientes + resumo
--   2) rel_clientes_balancas — cada balança de cada cliente
--   3) rel_clientes_inativos — clientes sem calibração há X meses
--                              (para reativação comercial)
-- ═══════════════════════════════════════════════════════════

-- ── 1. Todos os clientes (com contadores) ───────────────────
CREATE OR REPLACE FUNCTION rel_clientes()
RETURNS TABLE (
    cliente_id uuid, razao_social text, cnpj text, email text, telefone text,
    cidade text, uf text, qtd_balancas bigint, qtd_certificados bigint,
    ultima_calibracao date, proxima_calibracao date
) LANGUAGE sql STABLE AS $$
    SELECT c.id, c.razao_social, c.cnpj, c.email, c.telefone, c.cidade, c.uf,
           (SELECT count(*) FROM balanca b WHERE b.cliente_id = c.id),
           (SELECT count(*) FROM certificado ct
             WHERE ct.cliente_id = c.id AND ct.status = 'emitido'),
           (SELECT max(ct.data_calibracao) FROM certificado ct
             WHERE ct.cliente_id = c.id AND ct.status = 'emitido'),
           (SELECT min(ct.data_calibracao
                       + make_interval(months => COALESCE(b.periodicidade_meses, 12)))
              FROM certificado ct
              JOIN balanca b ON b.id = ct.balanca_id
             WHERE ct.cliente_id = c.id AND ct.status = 'emitido'
               AND ct.data_calibracao = (
                   SELECT max(ct2.data_calibracao) FROM certificado ct2
                    WHERE ct2.balanca_id = b.id AND ct2.status = 'emitido'))
      FROM cliente c
     ORDER BY c.razao_social;
$$;

-- ── 2. Clientes x balanças (uma linha por balança) ──────────
CREATE OR REPLACE FUNCTION rel_clientes_balancas()
RETURNS TABLE (
    cliente text, cnpj text, telefone text, cidade text, uf text,
    balanca text, marca text, modelo text, num_serie text, numero_inmetro text,
    capacidade numeric, classe text, periodicidade_meses int,
    ultima_calibracao date, proxima_calibracao date, situacao text
) LANGUAGE sql STABLE AS $$
    SELECT c.razao_social, c.cnpj, c.telefone, c.cidade, c.uf,
           b.identificacao, b.marca, b.modelo, b.num_serie, b.numero_inmetro,
           b.capacidade, b.classe_exatidao, b.periodicidade_meses,
           ult.data_calibracao,
           ult.data_calibracao + make_interval(months => COALESCE(b.periodicidade_meses, 12)),
           CASE
               WHEN ult.data_calibracao IS NULL THEN 'Sem calibração'
               WHEN ult.data_calibracao + make_interval(months => COALESCE(b.periodicidade_meses, 12)) < now()
                    THEN 'Vencida'
               WHEN ult.data_calibracao + make_interval(months => COALESCE(b.periodicidade_meses, 12)) < now() + interval '30 days'
                    THEN 'Vence em breve'
               ELSE 'Em dia'
           END
      FROM balanca b
      JOIN cliente c ON c.id = b.cliente_id
      LEFT JOIN LATERAL (
          SELECT ct.data_calibracao FROM certificado ct
           WHERE ct.balanca_id = b.id AND ct.status = 'emitido'
           ORDER BY ct.data_calibracao DESC LIMIT 1
      ) ult ON true
     ORDER BY c.razao_social, b.identificacao;
$$;

-- ── 3. Clientes inativos (sem calibração há X meses) ────────
--    Para ligar e reconquistar quem parou de calibrar conosco.
CREATE OR REPLACE FUNCTION rel_clientes_inativos(p_meses int DEFAULT 6)
RETURNS TABLE (
    cliente_id uuid, razao_social text, cnpj text, email text, telefone text,
    cidade text, uf text, qtd_balancas bigint, ultima_calibracao date,
    meses_desde_ultima int
) LANGUAGE sql STABLE AS $$
    SELECT c.id, c.razao_social, c.cnpj, c.email, c.telefone, c.cidade, c.uf,
           (SELECT count(*) FROM balanca b WHERE b.cliente_id = c.id),
           ult.data_calibracao,
           CASE WHEN ult.data_calibracao IS NULL THEN NULL
                ELSE (EXTRACT(YEAR FROM age(now(), ult.data_calibracao)) * 12
                    + EXTRACT(MONTH FROM age(now(), ult.data_calibracao)))::int
           END
      FROM cliente c
      LEFT JOIN LATERAL (
          SELECT max(ct.data_calibracao) AS data_calibracao FROM certificado ct
           WHERE ct.cliente_id = c.id AND ct.status = 'emitido'
      ) ult ON true
     WHERE ult.data_calibracao IS NULL
        OR ult.data_calibracao < now() - make_interval(months => p_meses)
     ORDER BY ult.data_calibracao ASC NULLS FIRST;
$$;

SELECT 'relatórios de clientes criados' AS resultado;
