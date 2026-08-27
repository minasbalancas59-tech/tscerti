-- ================================================================
-- ETAPA 4 · Função de emissão atualizada — Rodar UMA vez:
--   docker compose exec -T db psql -U certsaas -d certsaas < db/seed/14_emissao.sql
--
-- Substitui emitir_certificado(): agora também congela o método
-- de calibração vigente e valida a data de calibração dos pesos.
-- Continua transacional e com numeração sem furo.
-- ================================================================

CREATE OR REPLACE FUNCTION emitir_certificado(p_cert_id uuid) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
    v_num     integer;
    v_prefixo text;
    v_numero  text;
    v_emp     uuid;
    v_metodo  text;
BEGIN
    SELECT c.empresa_id, e.metodo_calibracao
      INTO v_emp, v_metodo
      FROM certificado c JOIN empresa e ON e.id = c.empresa_id
     WHERE c.id = p_cert_id AND c.status = 'aguardando_aprovacao'
     FOR UPDATE OF c;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Certificado não encontrado ou não está aguardando aprovação.';
    END IF;

    -- Bloqueio: peso padrão vencido impede emissão
    IF EXISTS (
        SELECT 1 FROM certificado_peso cp
        JOIN peso_padrao pp ON pp.id = cp.peso_padrao_id
        WHERE cp.certificado_id = p_cert_id
          AND pp.validade < CURRENT_DATE
    ) THEN
        RAISE EXCEPTION 'Há peso padrão com calibração vencida vinculado a este certificado.';
    END IF;

    -- Numeração única sob concorrência (lock de linha da empresa)
    UPDATE empresa
       SET proximo_numero = proximo_numero + 1
     WHERE id = v_emp
    RETURNING proximo_numero - 1, prefixo_cert INTO v_num, v_prefixo;

    v_numero := format('%s-%s/%s', v_prefixo,
                       to_char(now(), 'YYYY'), lpad(v_num::text, 4, '0'));

    -- Se este certificado é uma revisão de outro, acrescenta sufixo -R{n}
    -- e marca o original como substituído (vinculando os dois).
    DECLARE
        v_substitui uuid;
        v_rev       int;
    BEGIN
        SELECT substitui_id, revisao_num INTO v_substitui, v_rev
          FROM certificado WHERE id = p_cert_id;
        IF v_substitui IS NOT NULL THEN
            v_numero := v_numero || '-R' || v_rev::text;
            UPDATE certificado
               SET status = 'substituido', substituido_por_id = p_cert_id
             WHERE id = v_substitui;
        END IF;
    END;

    -- Congela a fotografia dos pesos padrão usados ANTES de emitir.
    -- (O trigger de imutabilidade bloqueia escrita em certificado_peso
    --  quando o certificado já está 'emitido'; por isso, primeiro os pesos.)
    UPDATE certificado_peso cp
       SET num_cert_peso    = pp.num_certificado,
           validade_na_data = pp.validade
      FROM peso_padrao pp
     WHERE pp.id = cp.peso_padrao_id
       AND cp.certificado_id = p_cert_id;

    -- Agora sim, marca como emitido (a partir daqui tudo fica imutável)
    UPDATE certificado
       SET numero          = v_numero,
           status          = 'emitido',
           data_emissao    = now(),
           metodo_snapshot = v_metodo
     WHERE id = p_cert_id;

    RETURN v_numero;
END $$;

SELECT 'função de emissão atualizada' AS resultado;

-- ── Função de validação pública (SECURITY DEFINER) ──────────────
-- A página /validar consulta sem tenant; o RLS bloquearia. Esta
-- função roda com privilégio elevado mas expõe SÓ dados não sensíveis
-- e apenas de certificados emitidos, filtrando pelo uuid_validacao.
CREATE OR REPLACE FUNCTION validar_certificado(p_uuid uuid)
RETURNS TABLE (
    numero text, data_calibracao date, data_emissao timestamptz,
    hash_sha256 text, empresa text, num_autorizacao text, cliente text,
    balanca text, marca text, modelo text, num_serie text,
    capacidade numeric, classe_exatidao text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT ct.numero, ct.data_calibracao, ct.data_emissao, ct.hash_sha256,
           e.razao_social, e.num_autorizacao, c.razao_social,
           b.identificacao, b.marca, b.modelo, b.num_serie,
           b.capacidade, b.classe_exatidao
      FROM certificado ct
      JOIN empresa e ON e.id = ct.empresa_id
      JOIN cliente c ON c.id = ct.cliente_id
      JOIN balanca b ON b.id = ct.balanca_id
     WHERE ct.uuid_validacao = p_uuid AND ct.status = 'emitido'
$$;
REVOKE ALL ON FUNCTION validar_certificado(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION validar_certificado(uuid) TO api_app;

SELECT 'função de validação criada' AS resultado;
