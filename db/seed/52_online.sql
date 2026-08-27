-- ═══════════════════════════════════════════════════════════
-- 52 · Última atividade do usuário (para "quem está online")
--   Grava o "visto por último" a cada requisição autenticada,
--   reaproveitando a função auth_sessao_valida (que já roda em
--   toda requisição). "Online agora" = atividade recente.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE usuario ADD COLUMN IF NOT EXISTS visto_em timestamptz;

-- auth_sessao_valida agora também grava o "visto por último".
-- Continua retornando se a sessão é válida (comportamento anterior).
DROP FUNCTION IF EXISTS auth_sessao_valida(uuid, uuid);
CREATE FUNCTION auth_sessao_valida(p_usuario uuid, p_sid uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ok boolean;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM usuario WHERE id = p_usuario AND sessao_atual = p_sid
    ) INTO v_ok;
    IF v_ok THEN
        -- registra atividade (no máximo 1 update por minuto para evitar escrita excessiva)
        UPDATE usuario
           SET visto_em = now()
         WHERE id = p_usuario
           AND (visto_em IS NULL OR visto_em < now() - interval '1 minute');
    END IF;
    RETURN v_ok;
END $$;
GRANT EXECUTE ON FUNCTION auth_sessao_valida(uuid, uuid) TO api_app;

-- ── Quem está online agora (super-admin) ────────────────────
-- Considera "online" quem teve atividade nos últimos p_minutos.
DROP FUNCTION IF EXISTS sa_online(int);
CREATE FUNCTION sa_online(p_minutos int DEFAULT 5)
RETURNS TABLE (
    usuario_id uuid, nome text, email text, papel text,
    empresa text, visto_em timestamptz, segundos_atras int
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT u.id, u.nome, u.email, u.papel, e.razao_social, u.visto_em,
           EXTRACT(EPOCH FROM (now() - u.visto_em))::int
      FROM usuario u
      LEFT JOIN empresa e ON e.id = u.empresa_id
     WHERE u.visto_em >= now() - make_interval(mins => p_minutos)
     ORDER BY u.visto_em DESC
$$;

-- Contagem rápida de online (para o cartão do painel)
DROP FUNCTION IF EXISTS sa_online_total(int);
CREATE FUNCTION sa_online_total(p_minutos int DEFAULT 5)
RETURNS int
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT count(*)::int FROM usuario
     WHERE visto_em >= now() - make_interval(mins => p_minutos)
$$;

SELECT 'rastreamento de atividade adicionado' AS resultado;
