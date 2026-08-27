-- ═══════════════════════════════════════════════════════════
-- 64 · Relatórios de clientes — filtros e ordenação
--   Substitui as funções da migração 62 acrescentando:
--   • rel_clientes: ordenação (nome / último certificado / cidade-uf / tipo)
--   • rel_clientes_balancas: filtros (cliente, tipo, situação, período
--     da última calibração)
--   rel_clientes_inativos permanece como está (migração 62).
-- ═══════════════════════════════════════════════════════════

-- ── 1. Todos os clientes (com ordenação) ────────────────────
CREATE OR REPLACE FUNCTION rel_clientes(
    p_ordem text DEFAULT 'nome'   -- nome | ultimo | cidade | tipo
)
RETURNS TABLE (
    cliente_id uuid, razao_social text, cnpj text, email text, telefone text,
    cidade text, uf text, qtd_balancas bigint, qtd_certificados bigint,
    ultima_calibracao date, proxima_calibracao date, tipos_balanca text
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
                    WHERE ct2.balanca_id = b.id AND ct2.status = 'emitido')),
           (SELECT string_agg(DISTINCT b.tipo, ', ' ORDER BY b.tipo)
              FROM balanca b WHERE b.cliente_id = c.id)
      FROM cliente c
     ORDER BY
       CASE WHEN p_ordem = 'cidade' THEN c.uf END NULLS LAST,
       CASE WHEN p_ordem = 'cidade' THEN c.cidade END NULLS LAST,
       CASE WHEN p_ordem = 'ultimo' THEN
           (SELECT max(ct.data_calibracao) FROM certificado ct
             WHERE ct.cliente_id = c.id AND ct.status = 'emitido')
       END DESC NULLS LAST,
       CASE WHEN p_ordem = 'tipo' THEN
           (SELECT string_agg(DISTINCT b.tipo, ',' ORDER BY b.tipo)
              FROM balanca b WHERE b.cliente_id = c.id)
       END NULLS LAST,
       c.razao_social;   -- desempate/padrão sempre por nome
$$;

-- ── 2. Clientes x balanças (com filtros) ────────────────────
CREATE OR REPLACE FUNCTION rel_clientes_balancas(
    p_cliente uuid DEFAULT NULL,      -- filtra um cliente
    p_tipo text DEFAULT NULL,         -- tipo de balança
    p_situacao text DEFAULT NULL,     -- 'Em dia'|'Vencida'|'Vence em breve'|'Sem calibração'
    p_de date DEFAULT NULL,           -- última calibração a partir de
    p_ate date DEFAULT NULL           -- última calibração até
)
RETURNS TABLE (
    cliente text, cnpj text, telefone text, cidade text, uf text,
    balanca text, tipo text, marca text, modelo text, num_serie text, numero_inmetro text,
    capacidade numeric, classe text, periodicidade_meses int,
    ultima_calibracao date, proxima_calibracao date, situacao text
) LANGUAGE sql STABLE AS $$
    SELECT * FROM (
        SELECT c.razao_social, c.cnpj, c.telefone, c.cidade, c.uf,
               b.identificacao, b.tipo, b.marca, b.modelo, b.num_serie, b.numero_inmetro,
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
               END AS situacao
          FROM balanca b
          JOIN cliente c ON c.id = b.cliente_id
          LEFT JOIN LATERAL (
              SELECT ct.data_calibracao FROM certificado ct
               WHERE ct.balanca_id = b.id AND ct.status = 'emitido'
               ORDER BY ct.data_calibracao DESC LIMIT 1
          ) ult ON true
         WHERE (p_cliente IS NULL OR b.cliente_id = p_cliente)
           AND (p_tipo IS NULL OR b.tipo = p_tipo)
           AND (p_de  IS NULL OR ult.data_calibracao >= p_de)
           AND (p_ate IS NULL OR ult.data_calibracao <= p_ate)
    ) q
    WHERE (p_situacao IS NULL OR q.situacao = p_situacao)
    ORDER BY q.razao_social, q.identificacao;
$$;

SELECT 'relatórios de clientes com filtros/ordenação atualizados' AS resultado;
