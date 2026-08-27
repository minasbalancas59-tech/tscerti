-- ═══════════════════════════════════════════════════════════
-- 44 · Log de erros do sistema
--   Erros não-tratados (500) da API são gravados aqui e ficam
--   visíveis no painel super-admin. Tabela GLOBAL (sem RLS):
--   só o super-admin acessa, via funções SECURITY DEFINER.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS erro_sistema (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ocorrido_em timestamptz NOT NULL DEFAULT now(),
    rota        text,
    metodo      text,
    tipo        text,          -- classe da exceção
    mensagem    text,
    detalhe     text,          -- stack trace (limitado)
    empresa_id  uuid,          -- empresa do usuário logado (se houver)
    usuario_id  uuid,          -- usuário logado (se houver)
    resolvido   boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_erro_data ON erro_sistema (ocorrido_em DESC);
CREATE INDEX IF NOT EXISTS idx_erro_resolvido ON erro_sistema (resolvido, ocorrido_em DESC);

-- A API grava com a role api_app; precisa de INSERT direto.
GRANT INSERT ON erro_sistema TO api_app;

-- ── Registrar um erro (chamada pela API) ────────────────────
DROP FUNCTION IF EXISTS registrar_erro(text, text, text, text, text, uuid, uuid);
CREATE FUNCTION registrar_erro(
    p_rota text, p_metodo text, p_tipo text, p_mensagem text,
    p_detalhe text, p_empresa uuid, p_usuario uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    INSERT INTO erro_sistema (rota, metodo, tipo, mensagem, detalhe, empresa_id, usuario_id)
    VALUES (p_rota, p_metodo, p_tipo, p_mensagem, left(p_detalhe, 4000), p_empresa, p_usuario)
$$;
GRANT EXECUTE ON FUNCTION registrar_erro(text, text, text, text, text, uuid, uuid) TO api_app;

-- ── Listar erros (super-admin) ──────────────────────────────
DROP FUNCTION IF EXISTS sa_erros(boolean, int);
CREATE FUNCTION sa_erros(p_apenas_abertos boolean DEFAULT false, p_limite int DEFAULT 100)
RETURNS TABLE (
    id bigint, ocorrido_em timestamptz, rota text, metodo text,
    tipo text, mensagem text, detalhe text,
    empresa text, resolvido boolean
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT e.id, e.ocorrido_em, e.rota, e.metodo, e.tipo, e.mensagem, e.detalhe,
           emp.razao_social, e.resolvido
      FROM erro_sistema e
      LEFT JOIN empresa emp ON emp.id = e.empresa_id
     WHERE NOT p_apenas_abertos OR e.resolvido = false
     ORDER BY e.ocorrido_em DESC
     LIMIT p_limite
$$;

-- ── Contagem de erros não resolvidos (badge) ────────────────
DROP FUNCTION IF EXISTS sa_erros_abertos();
CREATE FUNCTION sa_erros_abertos()
RETURNS int
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT count(*)::int FROM erro_sistema WHERE resolvido = false
$$;

-- ── Marcar erro como resolvido / reabrir ────────────────────
DROP FUNCTION IF EXISTS sa_resolver_erro(bigint, boolean);
CREATE FUNCTION sa_resolver_erro(p_id bigint, p_resolvido boolean)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    UPDATE erro_sistema SET resolvido = p_resolvido WHERE id = p_id
$$;

-- ── Limpar erros resolvidos com mais de N dias ──────────────
DROP FUNCTION IF EXISTS sa_limpar_erros(int);
CREATE FUNCTION sa_limpar_erros(p_dias int DEFAULT 30)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_qtd int;
BEGIN
    DELETE FROM erro_sistema
     WHERE resolvido = true
       AND ocorrido_em < current_date - (p_dias * interval '1 day');
    GET DIAGNOSTICS v_qtd = ROW_COUNT;
    RETURN v_qtd;
END $$;

SELECT 'log de erros do sistema adicionado' AS resultado;
