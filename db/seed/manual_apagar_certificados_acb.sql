-- ═══════════════════════════════════════════════════════════════
-- Apagar TODOS os certificados da ACB Balanças
--   empresa_id = 7bd64cff-30c5-41de-b2be-a123c076f0a7
-- Mantém: empresa, clientes, balanças, pesos, usuários.
-- Apaga: os 5 certificados + todas as tabelas filhas.
--
-- TRANSACIONAL: tudo ou nada. Se qualquer passo falhar, ROLLBACK.
-- Desabilita os 3 triggers de imutabilidade DENTRO da transação
-- (session_replication_role) e reabilita ao final.
-- ═══════════════════════════════════════════════════════════════
BEGIN;

-- trava o id da empresa numa variável de sessão (segurança)
\set emp '7bd64cff-30c5-41de-b2be-a123c076f0a7'

-- desabilita triggers (imutabilidade) só nesta sessão/transação
SET session_replication_role = replica;

-- CTE com os certificados-alvo (todos da ACB)
-- Apaga na ordem das FKs: filhas → certificado

-- 1) Ensaios (modelo Portaria 157)
DELETE FROM ensaio_indicacao      WHERE certificado_id IN (SELECT id FROM certificado WHERE empresa_id = :'emp');
DELETE FROM ensaio_excentricidade WHERE certificado_id IN (SELECT id FROM certificado WHERE empresa_id = :'emp');
DELETE FROM ensaio_repetibilidade WHERE certificado_id IN (SELECT id FROM certificado WHERE empresa_id = :'emp');
DELETE FROM ensaio_sensibilidade  WHERE certificado_id IN (SELECT id FROM certificado WHERE empresa_id = :'emp');

-- 2) Tabelas RBC
DELETE FROM leitura_rbc         WHERE certificado_id IN (SELECT id FROM certificado WHERE empresa_id = :'emp');
DELETE FROM incerteza_ponto_rbc WHERE certificado_id IN (SELECT id FROM certificado WHERE empresa_id = :'emp');
DELETE FROM excentricidade_rbc  WHERE certificado_id IN (SELECT id FROM certificado WHERE empresa_id = :'emp');
DELETE FROM mobilidade_rbc      WHERE certificado_id IN (SELECT id FROM certificado WHERE empresa_id = :'emp');
DELETE FROM carga_peso_rbc      WHERE certificado_id IN (SELECT id FROM certificado WHERE empresa_id = :'emp');

-- 3) Vínculos e registros do certificado
DELETE FROM certificado_peso     WHERE certificado_id IN (SELECT id FROM certificado WHERE empresa_id = :'emp');
DELETE FROM certificado_foto     WHERE certificado_id IN (SELECT id FROM certificado WHERE empresa_id = :'emp');
DELETE FROM anexo                WHERE certificado_id IN (SELECT id FROM certificado WHERE empresa_id = :'emp');
DELETE FROM consulta_certificado WHERE certificado_id IN (SELECT id FROM certificado WHERE empresa_id = :'emp');
DELETE FROM email_log            WHERE certificado_id IN (SELECT id FROM certificado WHERE empresa_id = :'emp');
DELETE FROM notificacao          WHERE certificado_id IN (SELECT id FROM certificado WHERE empresa_id = :'emp');
DELETE FROM pesquisa_envio       WHERE certificado_id IN (SELECT id FROM certificado WHERE empresa_id = :'emp');

-- 4) resolve a auto-referência de substituição (revisões) antes de apagar
UPDATE certificado SET substitui_id = NULL, substituido_por_id = NULL
 WHERE empresa_id = :'emp';

-- 5) Os certificados em si
DELETE FROM certificado WHERE empresa_id = :'emp';

-- reabilita os triggers
SET session_replication_role = DEFAULT;

-- confere: deve retornar 0
SELECT count(*) AS certificados_restantes_acb
  FROM certificado WHERE empresa_id = :'emp';

COMMIT;

SELECT 'Certificados da ACB apagados. Empresa/clientes/balanças/pesos mantidos.' AS resultado;
