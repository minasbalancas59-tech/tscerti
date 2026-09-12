-- ═══════════════════════════════════════════════════════════
-- 159 · Método de calibração próprio do RBC (independente do
-- Conformidade) — João, 12/09/2026.
-- O certificado RBC sempre citava "Método: ..." com o texto
-- configurado pra Conformidade (empresa.metodo_calibracao), incluindo
-- a referência à Portaria Inmetro 157/2022 — que não é a base legal
-- de um documento acreditado ISO/IEC 17025. Agora RBC tem seu próprio
-- campo, com um texto padrão sensato; Conformidade continua
-- INALTERADA (mesma coluna, mesmo comportamento de sempre).
-- ═══════════════════════════════════════════════════════════

ALTER TABLE empresa ADD COLUMN IF NOT EXISTS metodo_calibracao_rbc text;
ALTER TABLE empresa ADD COLUMN IF NOT EXISTS texto_rodape_rbc text;

UPDATE empresa
   SET metodo_calibracao_rbc = 'PC-01 — conforme ISO/IEC 17025'
 WHERE metodo_calibracao_rbc IS NULL;

-- Rodapé RBC fica em branco por padrão (nem todo laboratório quer um
-- texto extra ali) — diferente do método, que sempre precisa de algo.

CREATE OR REPLACE FUNCTION public.emitir_certificado(p_cert_id uuid)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_num       integer;
    v_prefixo   text;
    v_numero    text;
    v_emp       uuid;
    v_metodo    text;
    v_metodo_rbc text;
    v_rbc       boolean;
BEGIN
    SELECT c.empresa_id, e.metodo_calibracao, e.metodo_calibracao_rbc,
           COALESCE(c.emitir_rbc, false)
      INTO v_emp, v_metodo, v_metodo_rbc, v_rbc
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

    -- Numeração única sob concorrência (lock de linha da empresa).
    -- RBC e conformidade usam CONTADORES SEPARADOS.
    IF v_rbc THEN
        UPDATE empresa
           SET proximo_numero_rbc = proximo_numero_rbc + 1
         WHERE id = v_emp
        RETURNING proximo_numero_rbc - 1, prefixo_cert INTO v_num, v_prefixo;
        -- Marcador "RBC-" no início (documento acreditado, ISO/IEC 17025)
        v_numero := format('RBC-%s-%s/%s', v_prefixo,
                           to_char(now(), 'YYYY'), lpad(v_num::text, 4, '0'));
    ELSE
        UPDATE empresa
           SET proximo_numero = proximo_numero + 1
         WHERE id = v_emp
        RETURNING proximo_numero - 1, prefixo_cert INTO v_num, v_prefixo;
        -- Formato de conformidade (INALTERADO)
        v_numero := format('%s-%s/%s', v_prefixo,
                           to_char(now(), 'YYYY'), lpad(v_num::text, 4, '0'));
    END IF;

    -- Revisão: acrescenta -R{n} e marca o original como substituído
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
    UPDATE certificado_peso cp
       SET num_cert_peso    = pp.num_certificado,
           validade_na_data = pp.validade
      FROM peso_padrao pp
     WHERE pp.id = cp.peso_padrao_id
       AND cp.certificado_id = p_cert_id;

    -- Marca como emitido (a partir daqui tudo fica imutável)
    -- Método: RBC usa o campo próprio (metodo_calibracao_rbc); o
    -- Conformidade continua usando metodo_calibracao, como sempre.
    UPDATE certificado
       SET numero          = v_numero,
           status          = 'emitido',
           data_emissao    = now(),
           metodo_snapshot = CASE WHEN v_rbc THEN COALESCE(v_metodo_rbc, v_metodo) ELSE v_metodo END
     WHERE id = p_cert_id;
    RETURN v_numero;
END $function$;

SELECT 'Método de calibração RBC independente do Conformidade' AS resultado;
