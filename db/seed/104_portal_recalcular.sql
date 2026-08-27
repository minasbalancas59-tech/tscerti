-- 104: reaplica a regra do Portal do Cliente de forma DETERMINISTICA.
-- A migracao 103 rodava "SELECT empresa_portal_por_plano(id) FROM empresa",
-- ou seja, um UPDATE dentro de um SELECT sobre a MESMA tabela - o resultado
-- e imprevisivel no Postgres e algumas empresas podem ter ficado com o
-- portal desligado indevidamente (ex.: contrato Enterprise barrado).
UPDATE empresa e
   SET portal_cliente_ativo = COALESCE(
       (SELECT c.plano IS DISTINCT FROM 'essencial'
          FROM contrato c
         WHERE c.empresa_id = e.id AND c.ativo
         ORDER BY c.criado_em DESC
         LIMIT 1), true);

-- conferencia (aparece na saida do psql)
SELECT razao_social,
       portal_cliente_ativo AS portal,
       (SELECT plano FROM contrato c
         WHERE c.empresa_id = e.id AND c.ativo
         ORDER BY c.criado_em DESC LIMIT 1) AS plano_ativo
  FROM empresa e
 ORDER BY razao_social;
