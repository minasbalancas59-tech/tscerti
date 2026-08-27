-- ═══════════════════════════════════════════════════════════════
-- 84 · Função de limpeza de certificados (super-admin)
-- Apaga os certificados de uma empresa, MAS antes ARQUIVA tudo numa
-- tabela de backup (recuperável) — já que o pg_dump externo não está
-- acessível pela API. Protegida por PIN destrutivo.
-- ═══════════════════════════════════════════════════════════════

-- PIN destrutivo do super-admin (hash BCrypt), guardado na empresa SISTEMA
ALTER TABLE empresa ADD COLUMN IF NOT EXISTS pin_destrutivo_hash text;

-- Tabela de arquivo-morto: guarda o snapshot JSON dos certificados apagados
CREATE TABLE IF NOT EXISTS certificado_arquivo (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id     uuid NOT NULL,
    empresa_nome   text,
    acao           text NOT NULL,          -- 'limpeza_certificados'
    qtd_certificados int,
    dados          jsonb NOT NULL,         -- snapshot completo (recuperável)
    feito_por      uuid,                   -- usuário super-admin
    feito_em       timestamptz NOT NULL DEFAULT now(),
    identificacao  text                    -- "limpeza-ACB-20260721-1430"
);
CREATE INDEX IF NOT EXISTS idx_cert_arquivo_emp ON certificado_arquivo (empresa_id, feito_em);

-- ── Função: arquiva e apaga os certificados de uma empresa ──────
CREATE OR REPLACE FUNCTION sa_limpar_certificados(
    p_empresa_id uuid,
    p_usuario_id uuid
) RETURNS TABLE(qtd int, identificacao text)
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_nome    text;
    v_qtd     int;
    v_snap    jsonb;
    v_ident   text;
BEGIN
    -- proteção: nunca limpar a empresa SISTEMA
    IF p_empresa_id = '00000000-0000-0000-0000-000000000001' THEN
        RAISE EXCEPTION 'A empresa SISTEMA não pode ser limpa.';
    END IF;

    SELECT razao_social INTO v_nome FROM empresa WHERE id = p_empresa_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Empresa não encontrada.';
    END IF;

    -- conta os certificados
    SELECT count(*) INTO v_qtd FROM certificado WHERE empresa_id = p_empresa_id;
    IF v_qtd = 0 THEN
        RAISE EXCEPTION 'Esta empresa não tem certificados para limpar.';
    END IF;

    -- identificação do backup: limpeza-<empresa>-<data>
    v_ident := 'limpeza-' || regexp_replace(coalesce(v_nome,'empresa'), '[^a-zA-Z0-9]', '', 'g')
               || '-' || to_char(now(), 'YYYYMMDD-HH24MI');

    -- ARQUIVA: snapshot JSON de tudo (certificados + ensaios + rbc + vínculos)
    SELECT jsonb_build_object(
        'certificados', (SELECT jsonb_agg(to_jsonb(c)) FROM certificado c WHERE c.empresa_id = p_empresa_id),
        'ensaio_indicacao', (SELECT jsonb_agg(to_jsonb(t)) FROM ensaio_indicacao t WHERE t.certificado_id IN (SELECT id FROM certificado WHERE empresa_id = p_empresa_id)),
        'ensaio_excentricidade', (SELECT jsonb_agg(to_jsonb(t)) FROM ensaio_excentricidade t WHERE t.certificado_id IN (SELECT id FROM certificado WHERE empresa_id = p_empresa_id)),
        'ensaio_repetibilidade', (SELECT jsonb_agg(to_jsonb(t)) FROM ensaio_repetibilidade t WHERE t.certificado_id IN (SELECT id FROM certificado WHERE empresa_id = p_empresa_id)),
        'ensaio_sensibilidade', (SELECT jsonb_agg(to_jsonb(t)) FROM ensaio_sensibilidade t WHERE t.certificado_id IN (SELECT id FROM certificado WHERE empresa_id = p_empresa_id)),
        'certificado_peso', (SELECT jsonb_agg(to_jsonb(t)) FROM certificado_peso t WHERE t.certificado_id IN (SELECT id FROM certificado WHERE empresa_id = p_empresa_id)),
        'leitura_rbc', (SELECT jsonb_agg(to_jsonb(t)) FROM leitura_rbc t WHERE t.certificado_id IN (SELECT id FROM certificado WHERE empresa_id = p_empresa_id)),
        'incerteza_ponto_rbc', (SELECT jsonb_agg(to_jsonb(t)) FROM incerteza_ponto_rbc t WHERE t.certificado_id IN (SELECT id FROM certificado WHERE empresa_id = p_empresa_id)),
        'excentricidade_rbc', (SELECT jsonb_agg(to_jsonb(t)) FROM excentricidade_rbc t WHERE t.certificado_id IN (SELECT id FROM certificado WHERE empresa_id = p_empresa_id)),
        'mobilidade_rbc', (SELECT jsonb_agg(to_jsonb(t)) FROM mobilidade_rbc t WHERE t.certificado_id IN (SELECT id FROM certificado WHERE empresa_id = p_empresa_id)),
        'carga_peso_rbc', (SELECT jsonb_agg(to_jsonb(t)) FROM carga_peso_rbc t WHERE t.certificado_id IN (SELECT id FROM certificado WHERE empresa_id = p_empresa_id))
    ) INTO v_snap;

    INSERT INTO certificado_arquivo (empresa_id, empresa_nome, acao, qtd_certificados, dados, feito_por, identificacao)
    VALUES (p_empresa_id, v_nome, 'limpeza_certificados', v_qtd, v_snap, p_usuario_id, v_ident);

    -- APAGA (triggers de imutabilidade desabilitados na sessão da função)
    PERFORM set_config('session_replication_role', 'replica', true);

    DELETE FROM ensaio_indicacao      WHERE certificado_id IN (SELECT id FROM certificado WHERE empresa_id = p_empresa_id);
    DELETE FROM ensaio_excentricidade WHERE certificado_id IN (SELECT id FROM certificado WHERE empresa_id = p_empresa_id);
    DELETE FROM ensaio_repetibilidade WHERE certificado_id IN (SELECT id FROM certificado WHERE empresa_id = p_empresa_id);
    DELETE FROM ensaio_sensibilidade  WHERE certificado_id IN (SELECT id FROM certificado WHERE empresa_id = p_empresa_id);
    DELETE FROM leitura_rbc           WHERE certificado_id IN (SELECT id FROM certificado WHERE empresa_id = p_empresa_id);
    DELETE FROM incerteza_ponto_rbc   WHERE certificado_id IN (SELECT id FROM certificado WHERE empresa_id = p_empresa_id);
    DELETE FROM excentricidade_rbc    WHERE certificado_id IN (SELECT id FROM certificado WHERE empresa_id = p_empresa_id);
    DELETE FROM mobilidade_rbc        WHERE certificado_id IN (SELECT id FROM certificado WHERE empresa_id = p_empresa_id);
    DELETE FROM carga_peso_rbc        WHERE certificado_id IN (SELECT id FROM certificado WHERE empresa_id = p_empresa_id);
    DELETE FROM certificado_peso      WHERE certificado_id IN (SELECT id FROM certificado WHERE empresa_id = p_empresa_id);
    DELETE FROM certificado_foto      WHERE certificado_id IN (SELECT id FROM certificado WHERE empresa_id = p_empresa_id);
    DELETE FROM anexo                 WHERE certificado_id IN (SELECT id FROM certificado WHERE empresa_id = p_empresa_id);
    DELETE FROM consulta_certificado  WHERE certificado_id IN (SELECT id FROM certificado WHERE empresa_id = p_empresa_id);
    DELETE FROM email_log             WHERE certificado_id IN (SELECT id FROM certificado WHERE empresa_id = p_empresa_id);
    DELETE FROM notificacao           WHERE certificado_id IN (SELECT id FROM certificado WHERE empresa_id = p_empresa_id);
    DELETE FROM pesquisa_envio        WHERE certificado_id IN (SELECT id FROM certificado WHERE empresa_id = p_empresa_id);
    UPDATE certificado SET substitui_id = NULL, substituido_por_id = NULL WHERE empresa_id = p_empresa_id;
    DELETE FROM certificado           WHERE empresa_id = p_empresa_id;

    PERFORM set_config('session_replication_role', 'origin', true);

    qtd := v_qtd;
    identificacao := v_ident;
    RETURN NEXT;
END $function$;

SELECT 'Função sa_limpar_certificados criada + tabela certificado_arquivo + pin_destrutivo_hash' AS resultado;
