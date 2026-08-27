-- ═══════════════════════════════════════════════════════════
-- 82 · Numeração separada para certificados RBC (ISO/IEC 17025)
-- A norma exige identificação única e distinção do documento
-- acreditado. Portanto:
--   • contador dedicado ao RBC (proximo_numero_rbc)
--   • marcador "RBC-" no início do número
--   • conformidade segue INALTERADA (formato PREFIXO-ANO/0001)
-- Toda a lógica original (revisões, congelamento de pesos, bloqueios)
-- é preservada — só se adiciona a bifurcação por emitir_rbc.
-- ═══════════════════════════════════════════════════════════

-- Contador dedicado ao RBC (independente do de conformidade)
ALTER TABLE empresa ADD COLUMN IF NOT EXISTS proximo_numero_rbc integer NOT NULL DEFAULT 1;

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
    v_rbc       boolean;
BEGIN
    SELECT c.empresa_id, e.metodo_calibracao, COALESCE(c.emitir_rbc, false)
      INTO v_emp, v_metodo, v_rbc
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
    UPDATE certificado
       SET numero          = v_numero,
           status          = 'emitido',
           data_emissao    = now(),
           metodo_snapshot = v_metodo
     WHERE id = p_cert_id;
    RETURN v_numero;
END $function$;

SELECT 'Numeração RBC separada: contador proximo_numero_rbc + marcador RBC- no início' AS resultado;
