-- ═══════════════════════════════════════════════════════════
-- 168 · Portal: pontos individuais de um certificado (pra gráfico
-- erro×carga vs EMA e gráfico de tendência/deriva ao longo do tempo).
--
-- Unifica Conformidade (ensaio_indicacao) e RBC (incerteza_ponto_rbc)
-- num shape só, pra um único endpoint/gráfico no front tratar os dois
-- (com pequenas diferenças de rótulo — RBC não tem EMA nem veredito
-- de aprovação, é declaração de erro+incerteza, não pass/fail).
--
-- Mesma checagem de segurança de cliente_pdf_certificado: só devolve
-- linhas se o documento do portal estiver no grupo do CNPJ do cliente
-- dono do certificado — senão devolve vazio (não erro), como o resto
-- das funções do portal já fazem.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.cliente_pontos_certificado(p_documento text, p_cert uuid)
 RETURNS TABLE(ordem integer, carga numeric, indicacao numeric, erro numeric,
               incerteza numeric, ema numeric, aprovado boolean, rbc boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_rbc boolean;
    v_ok  boolean;
BEGIN
    SELECT ct.emitir_rbc, cliente_no_grupo(c.cnpj, p_documento)
      INTO v_rbc, v_ok
      FROM certificado ct
      JOIN cliente c ON c.id = ct.cliente_id
     WHERE ct.id = p_cert;

    IF v_ok IS NOT TRUE THEN
        RETURN;   -- sem acesso a este certificado: vazio, não erro
    END IF;

    IF v_rbc THEN
        RETURN QUERY
            SELECT r.ordem_ponto, r.carga, r.media, r.erro,
                   r.u_expandida, NULL::numeric, NULL::boolean, true
              FROM incerteza_ponto_rbc r
             WHERE r.certificado_id = p_cert
             ORDER BY r.ordem_ponto;
    ELSE
        RETURN QUERY
            SELECT ei.ordem, ei.carga_aplicada, ei.indicacao, ei.erro,
                   ei.incerteza, ei.ema, ei.aprovado, false
              FROM ensaio_indicacao ei
             WHERE ei.certificado_id = p_cert AND ei.sem_leitura = false
             ORDER BY ei.ordem;
    END IF;
END $function$;

SELECT 'Portal: pontos de ensaio por certificado (grafico erro x EMA)' AS resultado;
