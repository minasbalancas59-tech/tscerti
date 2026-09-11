-- Geração automática de cobranças deixa de ter interruptor: passa a ser
-- sempre ativa (o flag financeiro_config.gerar_cobrancas_auto e o
-- endpoint PUT /financeiro/gerar-auto saem de uso). Claude, 11/09/2026.
CREATE OR REPLACE FUNCTION public.gerar_cobrancas_do_mes()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_qtd int := 0;
    r record;
    v_comp date := date_trunc('month', current_date)::date;
    v_intervalo int;
    v_meses_desde int;
    v_valor numeric;
BEGIN
    FOR r IN
        SELECT c.*, e.status AS emp_status
          FROM contrato c
          JOIN empresa e ON e.id = c.empresa_id
         WHERE c.ativo AND c.gerar_automatico AND c.periodicidade <> 'avulso'
           AND c.inicio <= current_date
           AND (c.fim IS NULL OR c.fim >= v_comp)
           AND e.status = 'ativa'
    LOOP
        v_intervalo := CASE r.periodicidade
            WHEN 'mensal' THEN 1 WHEN 'trimestral' THEN 3
            WHEN 'semestral' THEN 6 WHEN 'anual' THEN 12 ELSE 1 END;
        v_meses_desde := (extract(year FROM v_comp)::int - extract(year FROM date_trunc('month', r.inicio))::int) * 12
                       + (extract(month FROM v_comp)::int - extract(month FROM r.inicio)::int);
        IF v_meses_desde >= 0 AND (v_meses_desde % v_intervalo) = 0 THEN
            IF NOT EXISTS (
                SELECT 1 FROM cobranca
                 WHERE contrato_id = r.id
                   AND date_trunc('month', competencia) = v_comp
            ) THEN
                v_valor := r.valor;
                IF COALESCE(r.desconto_valor, 0) > 0
                   AND (r.desconto_ate IS NULL OR v_comp <= r.desconto_ate) THEN
                    IF r.desconto_tipo = 'percentual' THEN
                        v_valor := round(r.valor * (1 - LEAST(r.desconto_valor, 100) / 100.0), 2);
                    ELSE
                        v_valor := GREATEST(0, r.valor - r.desconto_valor);
                    END IF;
                END IF;
                INSERT INTO cobranca (empresa_id, contrato_id, competencia, vencimento, valor, status)
                VALUES (r.empresa_id, r.id, v_comp,
                        (v_comp + (r.dia_vencimento - 1) * interval '1 day')::date,
                        v_valor, 'pendente');
                v_qtd := v_qtd + 1;
            END IF;
        END IF;
    END LOOP;
    RETURN v_qtd;
END $function$;
