-- Três bugs encontrados na BALANCAS MS ASSISTENCIA TECNICA LTDA
-- (09/09/2026): reportados pelo João depois de criar o contrato dela.

-- 1) sa_empresa() nunca devolvia nome_fantasia. A tela de edição do
--    super-admin carrega os dados dessa função — o campo sempre voltava
--    vazio, mesmo depois de salvo (a gravação funcionava; a LEITURA de
--    volta é que estava quebrada). Isso valia para todas as empresas,
--    não só esta.
DROP FUNCTION IF EXISTS sa_empresa(uuid);
CREATE FUNCTION sa_empresa(p_id uuid)
RETURNS TABLE (
    id uuid, razao_social text, nome_fantasia text, cnpj text, subdominio text,
    plano text, status text, limite_usuarios int, num_autorizacao text,
    prefixo_cert text, proximo_numero int, criado_em timestamptz,
    dias_carencia_contrato int, motivo_suspensao text,
    qtd_usuarios bigint, qtd_certificados bigint, qtd_clientes bigint,
    qtd_balancas bigint
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT e.id, e.razao_social, e.nome_fantasia, e.cnpj, e.subdominio, e.plano, e.status,
           e.limite_usuarios, e.num_autorizacao, e.prefixo_cert, e.proximo_numero,
           e.criado_em, e.dias_carencia_contrato, e.motivo_suspensao,
           (SELECT count(*) FROM usuario u WHERE u.empresa_id = e.id AND u.ativo),
           (SELECT count(*) FROM certificado c WHERE c.empresa_id = e.id AND c.status = 'emitido'),
           (SELECT count(*) FROM cliente cl WHERE cl.empresa_id = e.id AND cl.ativo),
           (SELECT count(*) FROM balanca b WHERE b.empresa_id = e.id AND b.ativa)
      FROM empresa e WHERE e.id = p_id
$$;
GRANT EXECUTE ON FUNCTION sa_empresa(uuid) TO api_app;

-- 2) Conserto pontual: a empresa tem contrato ativo cadastrado, então
--    reativa e limpa o motivo de suspensão. A próxima rodada diária do
--    Worker (não é preciso esperar dia 1º — a checagem roda todo dia) já
--    gera a cobrança do mês sozinha, sem mais nada manual.
UPDATE empresa
   SET status = 'ativa', motivo_suspensao = NULL
 WHERE cnpj = '11950499000114'
   AND status = 'suspensa';
