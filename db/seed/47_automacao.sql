-- ═══════════════════════════════════════════════════════════
-- 47 · Automação de cobranças + suporte a alertas por e-mail
--   • contrato.dia_vencimento e gerar_automatico
--   • gerar_cobrancas_do_mes(): cria as parcelas do período atual
--   • contratos_vencendo_para_alerta(): contratos a avisar
--   • Registro de alertas já enviados (evita repetir)
-- Rodadas diariamente pelo worker.
-- ═══════════════════════════════════════════════════════════

-- Dia do mês para o vencimento das parcelas geradas (1..28) e
-- se o contrato entra na geração automática.
ALTER TABLE contrato ADD COLUMN IF NOT EXISTS dia_vencimento int NOT NULL DEFAULT 10
    CHECK (dia_vencimento BETWEEN 1 AND 28);
ALTER TABLE contrato ADD COLUMN IF NOT EXISTS gerar_automatico boolean NOT NULL DEFAULT true;

-- Controle de alertas já enviados (não repetir o mesmo aviso)
CREATE TABLE IF NOT EXISTS alerta_enviado (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tipo        text NOT NULL,           -- 'contrato_vencendo', etc.
    referencia  text NOT NULL,           -- chave única do evento
    enviado_em  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tipo, referencia)
);
GRANT SELECT, INSERT ON alerta_enviado TO api_app;

-- ── Gerar as cobranças do período atual ─────────────────────
-- Para cada contrato ativo, recorrente, marcado como automático,
-- cria a parcela da competência vigente se ainda não existir.
-- A competência de um contrato trimestral/semestral/anual só é
-- gerada nos meses múltiplos a partir do mês de início.
DROP FUNCTION IF EXISTS gerar_cobrancas_do_mes();
CREATE FUNCTION gerar_cobrancas_do_mes()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_qtd int := 0;
    r record;
    v_comp date := date_trunc('month', current_date)::date;
    v_intervalo int;
    v_meses_desde int;
BEGIN
    FOR r IN
        SELECT c.*, e.status AS emp_status
          FROM contrato c
          JOIN empresa e ON e.id = c.empresa_id
         WHERE c.ativo
           AND c.gerar_automatico
           AND c.periodicidade <> 'avulso'
           AND c.inicio <= current_date
           AND (c.fim IS NULL OR c.fim >= v_comp)
           AND e.status = 'ativa'
    LOOP
        -- intervalo em meses conforme a periodicidade
        v_intervalo := CASE r.periodicidade
            WHEN 'mensal' THEN 1 WHEN 'trimestral' THEN 3
            WHEN 'semestral' THEN 6 WHEN 'anual' THEN 12 ELSE 1 END;

        -- meses decorridos desde o início até a competência atual
        v_meses_desde := (extract(year FROM v_comp)::int - extract(year FROM date_trunc('month', r.inicio))::int) * 12
                       + (extract(month FROM v_comp)::int - extract(month FROM r.inicio)::int);

        -- só gera se este mês é um múltiplo do intervalo a partir do início
        IF v_meses_desde >= 0 AND (v_meses_desde % v_intervalo) = 0 THEN
            -- evita duplicar: já existe cobrança deste contrato nesta competência?
            IF NOT EXISTS (
                SELECT 1 FROM cobranca
                 WHERE contrato_id = r.id
                   AND date_trunc('month', competencia) = v_comp
            ) THEN
                INSERT INTO cobranca (empresa_id, contrato_id, competencia, vencimento, valor, status)
                VALUES (r.empresa_id, r.id, v_comp,
                        (v_comp + (r.dia_vencimento - 1) * interval '1 day')::date,
                        r.valor, 'pendente');
                v_qtd := v_qtd + 1;
            END IF;
        END IF;
    END LOOP;
    RETURN v_qtd;
END $$;
GRANT EXECUTE ON FUNCTION gerar_cobrancas_do_mes() TO api_app;

-- ── Contratos vencendo que ainda não foram avisados ─────────
-- Retorna contratos cujo fim está dentro de p_dias e que ainda
-- não tiveram alerta enviado para aquele vencimento.
DROP FUNCTION IF EXISTS contratos_vencendo_para_alerta(int);
CREATE FUNCTION contratos_vencendo_para_alerta(p_dias int DEFAULT 30)
RETURNS TABLE (
    contrato_id uuid, empresa_id uuid, empresa text, descricao text,
    fim date, dias_para_vencer int, referencia text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT c.id, c.empresa_id, e.razao_social, c.descricao, c.fim,
           (c.fim - current_date)::int,
           'contrato:' || c.id::text || ':' || c.fim::text
      FROM contrato c
      JOIN empresa e ON e.id = c.empresa_id
     WHERE c.ativo AND c.fim IS NOT NULL
       AND c.fim >= current_date
       AND c.fim <= current_date + (p_dias * interval '1 day')
       AND e.status = 'ativa'
       AND NOT EXISTS (
           SELECT 1 FROM alerta_enviado a
            WHERE a.tipo = 'contrato_vencendo'
              AND a.referencia = 'contrato:' || c.id::text || ':' || c.fim::text
       )
$$;
GRANT EXECUTE ON FUNCTION contratos_vencendo_para_alerta(int) TO api_app;

-- ── Destinatários (admin/RT) de uma empresa, para alertas ───
DROP FUNCTION IF EXISTS gestores_da_empresa(uuid);
CREATE FUNCTION gestores_da_empresa(p_empresa uuid)
RETURNS TABLE (nome text, email text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT u.nome, u.email FROM usuario u
     WHERE u.empresa_id = p_empresa AND u.ativo
       AND u.papel IN ('admin', 'responsavel_tecnico')
$$;
GRANT EXECUTE ON FUNCTION gestores_da_empresa(uuid) TO api_app;

-- Marca um alerta como enviado
DROP FUNCTION IF EXISTS marcar_alerta_enviado(text, text);
CREATE FUNCTION marcar_alerta_enviado(p_tipo text, p_ref text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    INSERT INTO alerta_enviado (tipo, referencia) VALUES (p_tipo, p_ref)
    ON CONFLICT (tipo, referencia) DO NOTHING
$$;
GRANT EXECUTE ON FUNCTION marcar_alerta_enviado(text, text) TO api_app;

-- ── sa_criar_contrato ampliada (dia de vencimento + automático) ──
DROP FUNCTION IF EXISTS sa_criar_contrato(uuid, text, numeric, text, date, date, text);
DROP FUNCTION IF EXISTS sa_criar_contrato(uuid, text, numeric, text, date, date, text, int, boolean);
CREATE FUNCTION sa_criar_contrato(
    p_empresa uuid, p_descricao text, p_valor numeric, p_periodicidade text,
    p_inicio date, p_fim date, p_obs text,
    p_dia_venc int DEFAULT 10, p_automatico boolean DEFAULT true)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
    INSERT INTO contrato (empresa_id, descricao, valor, periodicidade,
                          inicio, fim, observacao, dia_vencimento, gerar_automatico)
    VALUES (p_empresa, p_descricao, p_valor, p_periodicidade,
            p_inicio, p_fim, p_obs,
            LEAST(GREATEST(COALESCE(p_dia_venc, 10), 1), 28),
            COALESCE(p_automatico, true))
    RETURNING id INTO v_id;
    RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION sa_criar_contrato(uuid, text, numeric, text, date, date, text, int, boolean) TO api_app;

SELECT 'automação de cobranças e alertas adicionada' AS resultado;