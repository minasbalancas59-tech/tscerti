-- ═══════════════════════════════════════════════════════════════
-- 85 · Limpeza de certificados com filtro por TIPO (RBC / padrão)
-- Substitui sa_limpar_certificados por uma versão com p_tipo:
--   'todos' | 'rbc' | 'padrao'
-- Mantém o arquivamento (recuperável) e as proteções.
-- ═══════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS sa_limpar_certificados(uuid, uuid);

CREATE OR REPLACE FUNCTION sa_limpar_certificados(
    p_empresa_id uuid,
    p_usuario_id uuid,
    p_tipo text DEFAULT 'todos'
) RETURNS TABLE(qtd int, identificacao text)
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_nome  text;
    v_qtd   int;
    v_snap  jsonb;
    v_ident text;
    v_rbc   boolean;   -- NULL = todos; true = só RBC; false = só padrão
BEGIN
    IF p_empresa_id = '00000000-0000-0000-0000-000000000001' THEN
        RAISE EXCEPTION 'A empresa SISTEMA não pode ser limpa.';
    END IF;
    v_rbc := CASE lower(coalesce(p_tipo,'todos'))
                  WHEN 'rbc' THEN true
                  WHEN 'padrao' THEN false
                  ELSE NULL END;

    SELECT razao_social INTO v_nome FROM empresa WHERE id = p_empresa_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Empresa não encontrada.'; END IF;

    -- certificados-alvo (conforme o tipo)
    CREATE TEMP TABLE _alvo ON COMMIT DROP AS
      SELECT id FROM certificado
       WHERE empresa_id = p_empresa_id
         AND (v_rbc IS NULL OR coalesce(emitir_rbc,false) = v_rbc);

    SELECT count(*) INTO v_qtd FROM _alvo;
    IF v_qtd = 0 THEN
        RAISE EXCEPTION 'Nenhum certificado deste tipo para limpar.';
    END IF;

    v_ident := 'limpeza-' || regexp_replace(coalesce(v_nome,'empresa'), '[^a-zA-Z0-9]', '', 'g')
               || '-' || lower(coalesce(p_tipo,'todos'))
               || '-' || to_char(now(), 'YYYYMMDD-HH24MI');

    SELECT jsonb_build_object(
        'tipo', p_tipo,
        'certificados', (SELECT jsonb_agg(to_jsonb(c)) FROM certificado c WHERE c.id IN (SELECT id FROM _alvo)),
        'ensaio_indicacao', (SELECT jsonb_agg(to_jsonb(t)) FROM ensaio_indicacao t WHERE t.certificado_id IN (SELECT id FROM _alvo)),
        'ensaio_excentricidade', (SELECT jsonb_agg(to_jsonb(t)) FROM ensaio_excentricidade t WHERE t.certificado_id IN (SELECT id FROM _alvo)),
        'ensaio_repetibilidade', (SELECT jsonb_agg(to_jsonb(t)) FROM ensaio_repetibilidade t WHERE t.certificado_id IN (SELECT id FROM _alvo)),
        'ensaio_sensibilidade', (SELECT jsonb_agg(to_jsonb(t)) FROM ensaio_sensibilidade t WHERE t.certificado_id IN (SELECT id FROM _alvo)),
        'certificado_peso', (SELECT jsonb_agg(to_jsonb(t)) FROM certificado_peso t WHERE t.certificado_id IN (SELECT id FROM _alvo)),
        'leitura_rbc', (SELECT jsonb_agg(to_jsonb(t)) FROM leitura_rbc t WHERE t.certificado_id IN (SELECT id FROM _alvo)),
        'incerteza_ponto_rbc', (SELECT jsonb_agg(to_jsonb(t)) FROM incerteza_ponto_rbc t WHERE t.certificado_id IN (SELECT id FROM _alvo)),
        'excentricidade_rbc', (SELECT jsonb_agg(to_jsonb(t)) FROM excentricidade_rbc t WHERE t.certificado_id IN (SELECT id FROM _alvo)),
        'mobilidade_rbc', (SELECT jsonb_agg(to_jsonb(t)) FROM mobilidade_rbc t WHERE t.certificado_id IN (SELECT id FROM _alvo)),
        'carga_peso_rbc', (SELECT jsonb_agg(to_jsonb(t)) FROM carga_peso_rbc t WHERE t.certificado_id IN (SELECT id FROM _alvo))
    ) INTO v_snap;

    INSERT INTO certificado_arquivo (empresa_id, empresa_nome, acao, qtd_certificados, dados, feito_por, identificacao)
    VALUES (p_empresa_id, v_nome, 'limpeza_certificados_' || lower(coalesce(p_tipo,'todos')),
            v_qtd, v_snap, p_usuario_id, v_ident);

    PERFORM set_config('session_replication_role', 'replica', true);

    DELETE FROM ensaio_indicacao      WHERE certificado_id IN (SELECT id FROM _alvo);
    DELETE FROM ensaio_excentricidade WHERE certificado_id IN (SELECT id FROM _alvo);
    DELETE FROM ensaio_repetibilidade WHERE certificado_id IN (SELECT id FROM _alvo);
    DELETE FROM ensaio_sensibilidade  WHERE certificado_id IN (SELECT id FROM _alvo);
    DELETE FROM leitura_rbc           WHERE certificado_id IN (SELECT id FROM _alvo);
    DELETE FROM incerteza_ponto_rbc   WHERE certificado_id IN (SELECT id FROM _alvo);
    DELETE FROM excentricidade_rbc    WHERE certificado_id IN (SELECT id FROM _alvo);
    DELETE FROM mobilidade_rbc        WHERE certificado_id IN (SELECT id FROM _alvo);
    DELETE FROM carga_peso_rbc        WHERE certificado_id IN (SELECT id FROM _alvo);
    DELETE FROM certificado_peso      WHERE certificado_id IN (SELECT id FROM _alvo);
    DELETE FROM certificado_foto      WHERE certificado_id IN (SELECT id FROM _alvo);
    DELETE FROM anexo                 WHERE certificado_id IN (SELECT id FROM _alvo);
    DELETE FROM consulta_certificado  WHERE certificado_id IN (SELECT id FROM _alvo);
    DELETE FROM email_log             WHERE certificado_id IN (SELECT id FROM _alvo);
    DELETE FROM notificacao           WHERE certificado_id IN (SELECT id FROM _alvo);
    DELETE FROM pesquisa_envio        WHERE certificado_id IN (SELECT id FROM _alvo);
    UPDATE certificado SET substitui_id = NULL, substituido_por_id = NULL
     WHERE id IN (SELECT id FROM _alvo)
        OR substitui_id IN (SELECT id FROM _alvo)
        OR substituido_por_id IN (SELECT id FROM _alvo);
    DELETE FROM certificado WHERE id IN (SELECT id FROM _alvo);

    PERFORM set_config('session_replication_role', 'origin', true);

    qtd := v_qtd;
    identificacao := v_ident;
    RETURN NEXT;
END $function$;

-- ── Editar usuário pelo super-admin ──────────────────────────
CREATE OR REPLACE FUNCTION sa_editar_usuario(
    p_id uuid, p_nome text, p_email text, p_papel text, p_registro text
) RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE v_empresa uuid; v_papel_atual text;
BEGIN
    SELECT empresa_id, papel INTO v_empresa, v_papel_atual FROM usuario WHERE id = p_id;
    IF NOT FOUND THEN RETURN 'nao_encontrado'; END IF;
    IF p_papel NOT IN ('admin','responsavel_tecnico','tecnico') THEN RETURN 'papel_invalido'; END IF;
    -- não deixar a empresa sem nenhum admin ativo
    IF v_papel_atual = 'admin' AND p_papel <> 'admin'
       AND (SELECT count(*) FROM usuario WHERE empresa_id = v_empresa
             AND papel = 'admin' AND ativo AND id <> p_id) = 0 THEN
        RETURN 'ultimo_admin';
    END IF;
    IF EXISTS (SELECT 1 FROM usuario WHERE lower(email) = lower(p_email) AND id <> p_id) THEN
        RETURN 'email_em_uso';
    END IF;
    UPDATE usuario
       SET nome = coalesce(nullif(p_nome,''), nome),
           email = coalesce(nullif(lower(p_email),''), email),
           papel = p_papel,
           registro_prof = nullif(p_registro,'')
     WHERE id = p_id;
    RETURN 'ok';
END $function$;

SELECT 'Migração 85: limpeza por tipo + edição de usuário pelo SA' AS resultado;
