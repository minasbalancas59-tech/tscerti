-- ═══════════════════════════════════════════════════════════
-- 69 · Pesquisa de satisfação (NPS) para ISO 9001
--   • pesquisa_pergunta  — perguntas configuráveis por empresa
--   • pesquisa_envio     — cada pesquisa enviada (token de acesso)
--   • pesquisa_resposta  — as notas dadas por pergunta
--   • config na empresa  — liga/desliga, periodicidade, anonimato
--   • funções de dashboard: NPS, evolução, médias por dimensão
-- ═══════════════════════════════════════════════════════════

-- ── Config na empresa ───────────────────────────────────────
ALTER TABLE empresa
    ADD COLUMN IF NOT EXISTS pesquisa_ativa      boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS pesquisa_freq_dias  int     NOT NULL DEFAULT 180,   -- periodicidade (semestral)
    ADD COLUMN IF NOT EXISTS pesquisa_anonima    boolean NOT NULL DEFAULT false; -- respostas anônimas?

-- ── Perguntas (configuráveis por empresa) ───────────────────
CREATE TABLE IF NOT EXISTS pesquisa_pergunta (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id  uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    texto       text NOT NULL,
    tipo        text NOT NULL DEFAULT 'nota' CHECK (tipo IN ('nps','nota')),  -- 'nps' = pergunta principal
    ordem       int  NOT NULL DEFAULT 0,
    ativa       boolean NOT NULL DEFAULT true,
    criado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pesq_pergunta_empresa ON pesquisa_pergunta(empresa_id, ordem);

ALTER TABLE pesquisa_pergunta ENABLE ROW LEVEL SECURITY;
ALTER TABLE pesquisa_pergunta FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pesquisa_pergunta;
CREATE POLICY tenant_isolation ON pesquisa_pergunta
    USING (empresa_id = current_empresa_id())
    WITH CHECK (empresa_id = current_empresa_id());

-- ── Envios (uma linha por pesquisa enviada; token de acesso) ─
CREATE TABLE IF NOT EXISTS pesquisa_envio (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id    uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    cliente_id    uuid REFERENCES cliente(id) ON DELETE SET NULL,
    certificado_id uuid REFERENCES certificado(id) ON DELETE SET NULL,  -- se ligada a um serviço
    token         text NOT NULL UNIQUE,       -- link direto sem login
    modo          text NOT NULL,              -- 'periodico' | 'manual'
    enviado_em    timestamptz NOT NULL DEFAULT now(),
    respondido_em timestamptz,                -- null enquanto não responde
    nps_nota      int,                        -- nota NPS (0-10) para agilizar dashboard
    comentario    text
);
CREATE INDEX IF NOT EXISTS idx_pesq_envio_empresa ON pesquisa_envio(empresa_id, enviado_em DESC);
CREATE INDEX IF NOT EXISTS idx_pesq_envio_cliente ON pesquisa_envio(cliente_id);

ALTER TABLE pesquisa_envio ENABLE ROW LEVEL SECURITY;
ALTER TABLE pesquisa_envio FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pesquisa_envio;
CREATE POLICY tenant_isolation ON pesquisa_envio
    USING (empresa_id = current_empresa_id())
    WITH CHECK (empresa_id = current_empresa_id());

-- ── Respostas (nota por pergunta) ───────────────────────────
CREATE TABLE IF NOT EXISTS pesquisa_resposta (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    envio_id    uuid NOT NULL REFERENCES pesquisa_envio(id) ON DELETE CASCADE,
    pergunta_id uuid NOT NULL REFERENCES pesquisa_pergunta(id) ON DELETE CASCADE,
    nota        int NOT NULL CHECK (nota BETWEEN 0 AND 10)
);
CREATE INDEX IF NOT EXISTS idx_pesq_resposta_envio ON pesquisa_resposta(envio_id);
CREATE INDEX IF NOT EXISTS idx_pesq_resposta_pergunta ON pesquisa_resposta(pergunta_id);

-- pesquisa_resposta não tem empresa_id direto; herda o isolamento via envio.
-- Acesso é sempre por SECURITY DEFINER (formulário público) ou via join com envio (RLS).

GRANT SELECT, INSERT, UPDATE, DELETE ON pesquisa_pergunta TO api_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON pesquisa_envio TO api_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON pesquisa_resposta TO api_app;

-- ═══════════════════════════════════════════════════════════
-- Funções para o formulário público (SECURITY DEFINER: sem tenant)
-- ═══════════════════════════════════════════════════════════

-- Carrega a pesquisa pelo token (dados + perguntas), se ainda não respondida
CREATE OR REPLACE FUNCTION pesquisa_por_token(p_token text)
RETURNS TABLE (
    envio_id uuid, empresa_nome text, empresa_logo text, empresa_cor text,
    cliente_nome text, ja_respondida boolean, perguntas jsonb
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT e.id, emp.razao_social, emp.logo_url, emp.cor_marca,
           c.razao_social, (e.respondido_em IS NOT NULL),
           (SELECT jsonb_agg(jsonb_build_object('id', p.id, 'texto', p.texto, 'tipo', p.tipo)
                             ORDER BY p.ordem)
              FROM pesquisa_pergunta p
             WHERE p.empresa_id = e.empresa_id AND p.ativa)
      FROM pesquisa_envio e
      JOIN empresa emp ON emp.id = e.empresa_id
      LEFT JOIN cliente c ON c.id = e.cliente_id
     WHERE e.token = p_token;
$$;

-- Grava as respostas (chamada pelo formulário público)
CREATE OR REPLACE FUNCTION pesquisa_responder(
    p_token text, p_respostas jsonb, p_comentario text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_envio uuid;
    v_nps int;
    r jsonb;
BEGIN
    SELECT id INTO v_envio FROM pesquisa_envio
     WHERE token = p_token AND respondido_em IS NULL;
    IF v_envio IS NULL THEN RETURN false; END IF;  -- token inválido ou já respondido

    -- Insere cada resposta; captura a nota da pergunta NPS
    FOR r IN SELECT * FROM jsonb_array_elements(p_respostas)
    LOOP
        INSERT INTO pesquisa_resposta (envio_id, pergunta_id, nota)
        VALUES (v_envio, (r->>'pergunta_id')::uuid, (r->>'nota')::int);

        IF EXISTS (SELECT 1 FROM pesquisa_pergunta
                    WHERE id = (r->>'pergunta_id')::uuid AND tipo = 'nps') THEN
            v_nps := (r->>'nota')::int;
        END IF;
    END LOOP;

    UPDATE pesquisa_envio
       SET respondido_em = now(), nps_nota = v_nps, comentario = p_comentario
     WHERE id = v_envio;
    RETURN true;
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- Funções de dashboard (admin/RT — usam RLS via current_empresa_id)
-- ═══════════════════════════════════════════════════════════

-- Resumo NPS do período: total respostas, promotores/neutros/detratores, NPS
CREATE OR REPLACE FUNCTION pesquisa_nps_resumo(
    p_de timestamptz DEFAULT NULL, p_ate timestamptz DEFAULT NULL)
RETURNS TABLE (
    respostas bigint, promotores bigint, neutros bigint, detratores bigint,
    nps numeric, enviadas bigint, taxa_resposta numeric
) LANGUAGE sql STABLE AS $$
    WITH base AS (
        SELECT nps_nota, respondido_em FROM pesquisa_envio
         WHERE empresa_id = current_empresa_id()
           AND (p_de  IS NULL OR enviado_em >= p_de)
           AND (p_ate IS NULL OR enviado_em <  p_ate)
    ), resp AS (SELECT nps_nota FROM base WHERE respondido_em IS NOT NULL AND nps_nota IS NOT NULL)
    SELECT
        (SELECT count(*) FROM resp),
        (SELECT count(*) FROM resp WHERE nps_nota >= 9),
        (SELECT count(*) FROM resp WHERE nps_nota BETWEEN 7 AND 8),
        (SELECT count(*) FROM resp WHERE nps_nota <= 6),
        CASE WHEN (SELECT count(*) FROM resp) > 0 THEN
            round(100.0 * ((SELECT count(*) FROM resp WHERE nps_nota >= 9)
                         - (SELECT count(*) FROM resp WHERE nps_nota <= 6))
                  / (SELECT count(*) FROM resp), 1)
        ELSE NULL END,
        (SELECT count(*) FROM base),
        CASE WHEN (SELECT count(*) FROM base) > 0 THEN
            round(100.0 * (SELECT count(*) FROM resp) / (SELECT count(*) FROM base), 1)
        ELSE NULL END;
$$;

-- Evolução do NPS por mês (para o gráfico)
CREATE OR REPLACE FUNCTION pesquisa_nps_evolucao(p_meses int DEFAULT 12)
RETURNS TABLE (mes text, respostas bigint, nps numeric) LANGUAGE sql STABLE AS $$
    SELECT to_char(date_trunc('month', respondido_em), 'YYYY-MM'),
           count(*),
           CASE WHEN count(*) > 0 THEN
               round(100.0 * (count(*) FILTER (WHERE nps_nota >= 9)
                            - count(*) FILTER (WHERE nps_nota <= 6)) / count(*), 1)
           ELSE NULL END
      FROM pesquisa_envio
     WHERE empresa_id = current_empresa_id()
       AND respondido_em IS NOT NULL AND nps_nota IS NOT NULL
       AND respondido_em >= date_trunc('month', now()) - make_interval(months => p_meses - 1)
     GROUP BY date_trunc('month', respondido_em)
     ORDER BY date_trunc('month', respondido_em);
$$;

-- Média por pergunta/dimensão
CREATE OR REPLACE FUNCTION pesquisa_medias_dimensao(
    p_de timestamptz DEFAULT NULL, p_ate timestamptz DEFAULT NULL)
RETURNS TABLE (pergunta text, tipo text, respostas bigint, media numeric) LANGUAGE sql STABLE AS $$
    SELECT p.texto, p.tipo, count(r.nota), round(avg(r.nota), 1)
      FROM pesquisa_pergunta p
      LEFT JOIN pesquisa_resposta r ON r.pergunta_id = p.id
      LEFT JOIN pesquisa_envio e ON e.id = r.envio_id
     WHERE p.empresa_id = current_empresa_id()
       AND (r.id IS NULL OR (
           (p_de  IS NULL OR e.enviado_em >= p_de) AND
           (p_ate IS NULL OR e.enviado_em <  p_ate)))
     GROUP BY p.id, p.texto, p.tipo, p.ordem
     ORDER BY p.ordem;
$$;

-- Lista de respostas (para a tabela do dashboard e exportação)
CREATE OR REPLACE FUNCTION pesquisa_respostas_lista(
    p_de timestamptz DEFAULT NULL, p_ate timestamptz DEFAULT NULL, p_limite int DEFAULT 1000)
RETURNS TABLE (
    respondido_em timestamptz, cliente text, nps_nota int, comentario text, anonima boolean
) LANGUAGE sql STABLE AS $$
    SELECT e.respondido_em,
           CASE WHEN emp.pesquisa_anonima THEN NULL ELSE c.razao_social END,
           e.nps_nota, e.comentario, emp.pesquisa_anonima
      FROM pesquisa_envio e
      JOIN empresa emp ON emp.id = e.empresa_id
      LEFT JOIN cliente c ON c.id = e.cliente_id
     WHERE e.empresa_id = current_empresa_id()
       AND e.respondido_em IS NOT NULL
       AND (p_de  IS NULL OR e.enviado_em >= p_de)
       AND (p_ate IS NULL OR e.enviado_em <  p_ate)
     ORDER BY e.respondido_em DESC
     LIMIT p_limite;
$$;

SELECT 'pesquisa de satisfação (NPS) criada' AS resultado;
