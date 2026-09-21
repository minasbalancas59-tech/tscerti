-- ═══════════════════════════════════════════════════════════
-- 162 · Portal do cliente: um login enxerga TODAS as filiais
-- (mesma raiz de CNPJ) automaticamente, + vínculo manual (super-
-- admin) pra casos fora da raiz.
--
-- Hoje cada filial é um registro `cliente` com CNPJ completo
-- diferente (mesma razão social, raiz de 8 dígitos igual). O login
-- do portal (cliente_acesso) trava num único documento completo, e
-- todas as funções do portal filtram por igualdade EXATA — por isso
-- um gestor com um e-mail só via só a filial cujo CNPJ foi usado no
-- cadastro. Não muda nada em cliente_pode_cadastrar (portão de
-- segurança do auto-cadastro, continua exigindo e-mail+CNPJ exatos)
-- nem em cliente_criar_acesso (só grava, sem lógica de match).
-- ═══════════════════════════════════════════════════════════

-- 1) Raiz do CNPJ (8 primeiros dígitos) = grupo econômico (Receita
-- Federal nunca reaproveita raiz entre empresas não relacionadas).
-- CPF (11 dígitos) não tem filial: fica em igualdade exata.
CREATE OR REPLACE FUNCTION public.mesmo_grupo_cnpj(p_doc_a text, p_doc_b text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
    SELECT CASE
        WHEN length(so_digitos(p_doc_a)) = 14 AND length(so_digitos(p_doc_b)) = 14
            THEN substring(so_digitos(p_doc_a), 1, 8) = substring(so_digitos(p_doc_b), 1, 8)
        ELSE so_digitos(p_doc_a) = so_digitos(p_doc_b)
    END
$function$;

-- 2) Vínculos manuais extras por login do portal (fora da raiz).
CREATE TABLE IF NOT EXISTS public.cliente_acesso_documento (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_acesso_id uuid NOT NULL REFERENCES cliente_acesso(id) ON DELETE CASCADE,
    documento         text NOT NULL,
    criado_em         timestamptz NOT NULL DEFAULT now(),
    UNIQUE (cliente_acesso_id, documento)
);

-- 3) Helper composto: usado no lugar de "so_digitos(c.cnpj) =
-- so_digitos(p_documento)" em toda função de leitura/ação do portal.
CREATE OR REPLACE FUNCTION public.cliente_no_grupo(p_cnpj_cliente text, p_documento_login text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
    SELECT mesmo_grupo_cnpj(p_cnpj_cliente, p_documento_login)
        OR EXISTS (
            SELECT 1
              FROM cliente_acesso_documento cad
              JOIN cliente_acesso ca ON ca.id = cad.cliente_acesso_id
             WHERE so_digitos(ca.documento) = so_digitos(p_documento_login)
               AND mesmo_grupo_cnpj(p_cnpj_cliente, cad.documento)
        )
$function$;

-- 4) As 10 funções de leitura/ação do portal passam a usar
-- cliente_no_grupo() em vez de igualdade exata. Assinatura idêntica
-- em todas — zero mudança no C#/JWT.

-- cidade/uf são colunas novas no retorno: precisa dropar antes (o
-- tipo de retorno mudou, CREATE OR REPLACE não permite alterar o
-- shape das colunas de saída).
DROP FUNCTION IF EXISTS public.cliente_certificados(text);

CREATE FUNCTION public.cliente_certificados(p_documento text)
 RETURNS TABLE(id uuid, numero text, data_calibracao date, balanca text, num_serie text, marca text, modelo text, empresa text, tem_pdf boolean, periodicidade_meses integer, vence_em date, uuid_validacao uuid, dados_balanca jsonb, status text, cancelado_em timestamp with time zone, motivo_cancelamento text, substituido_por text, revisao_de text, numero_lacre text, selo_inmetro text, acreditado boolean, local_tipo text, local_detalhe text, conforme boolean, pontos_fora integer, pontos_total integer, houve_ajuste boolean, cidade text, uf text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT ct.id, ct.numero, ct.data_calibracao,
           b.identificacao, b.num_serie, b.marca, b.modelo,
           e.razao_social,
           (ct.pdf_url IS NOT NULL),
           b.periodicidade_meses,
           CASE WHEN COALESCE(b.periodicidade_meses, 0) > 0
                     AND ct.data_calibracao IS NOT NULL
                THEN (ct.data_calibracao
                      + make_interval(months => b.periodicidade_meses))::date
           END,
           ct.uuid_validacao,
           to_jsonb(b) - 'empresa_id' - 'cliente_id' - 'id' - 'criado_em',
           ct.status, ct.cancelado_em, ct.motivo_cancelamento,
           (SELECT s.numero FROM certificado s WHERE s.id = ct.substituido_por_id),
           (SELECT o.numero FROM certificado o WHERE o.id = ct.substitui_id),
           ct.numero_lacre, ct.selo_inmetro, ct.emitir_rbc,
           ct.local_tipo, ct.local_detalhe,
           -- conformidade: mesma regra dos relatórios da empresa
           CASE WHEN NOT EXISTS (SELECT 1 FROM ensaio_indicacao ei
                                  WHERE ei.certificado_id = ct.id)
                     AND NOT EXISTS (SELECT 1 FROM ensaio_excentricidade ex
                                      WHERE ex.certificado_id = ct.id)
                THEN NULL          -- sem pontos (RBC): não há veredito
                ELSE NOT (EXISTS (SELECT 1 FROM ensaio_indicacao ei
                                   WHERE ei.certificado_id = ct.id AND ei.aprovado = false)
                       OR EXISTS (SELECT 1 FROM ensaio_excentricidade ex
                                   WHERE ex.certificado_id = ct.id AND ex.aprovado = false))
           END,
           ((SELECT count(*) FROM ensaio_indicacao ei
              WHERE ei.certificado_id = ct.id AND ei.aprovado = false)
          + (SELECT count(*) FROM ensaio_excentricidade ex
              WHERE ex.certificado_id = ct.id AND ex.aprovado = false))::int,
           ((SELECT count(*) FROM ensaio_indicacao ei WHERE ei.certificado_id = ct.id)
          + (SELECT count(*) FROM ensaio_excentricidade ex WHERE ex.certificado_id = ct.id))::int,
           -- houve ajuste durante a calibração? (indicação "antes" registrada)
           EXISTS (SELECT 1 FROM ensaio_indicacao ei
                    WHERE ei.certificado_id = ct.id AND ei.indicacao_antes IS NOT NULL),
           c.cidade, c.uf
      FROM certificado ct
      JOIN cliente c ON c.id = ct.cliente_id
      JOIN empresa e ON e.id = ct.empresa_id
      JOIN balanca b ON b.id = ct.balanca_id
     WHERE cliente_no_grupo(c.cnpj, p_documento)
       AND ct.status IN ('emitido', 'substituido', 'cancelado')
     ORDER BY ct.data_calibracao DESC NULLS LAST, ct.numero DESC;
$function$;

DROP FUNCTION IF EXISTS public.cliente_certificados_vigentes(text);

CREATE FUNCTION public.cliente_certificados_vigentes(p_documento text)
 RETURNS TABLE(id uuid, numero text, data_calibracao date, vence_em date, balanca text, num_serie text, empresa text, pdf_url text, periodicidade_meses integer, cidade text, uf text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT DISTINCT ON (ct.balanca_id)
           ct.id, ct.numero, ct.data_calibracao,
           CASE WHEN COALESCE(b.periodicidade_meses, 0) > 0 AND ct.data_calibracao IS NOT NULL
                THEN (ct.data_calibracao + make_interval(months => b.periodicidade_meses))::date
           END,
           b.identificacao, b.num_serie, e.razao_social, ct.pdf_url,
           b.periodicidade_meses,
           c.cidade, c.uf
      FROM certificado ct
      JOIN cliente c ON c.id = ct.cliente_id
      JOIN empresa e ON e.id = ct.empresa_id
      JOIN balanca b ON b.id = ct.balanca_id
     WHERE cliente_no_grupo(c.cnpj, p_documento)
       AND ct.status = 'emitido' AND ct.pdf_url IS NOT NULL
     ORDER BY ct.balanca_id, ct.data_calibracao DESC NULLS LAST, ct.numero DESC;
$function$;

CREATE OR REPLACE FUNCTION public.cliente_pesos(p_documento text)
 RETURNS TABLE(peso_padrao_id uuid, identificacao text, num_cert_peso text, validade date, empresa text, usado_em_certificado text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT DISTINCT pp.id, pp.identificacao, cp.num_cert_peso,
           cp.validade_na_data, e.razao_social, ct.numero
      FROM certificado_peso cp
      JOIN certificado ct ON ct.id = cp.certificado_id
      JOIN cliente c ON c.id = ct.cliente_id
      JOIN empresa e ON e.id = cp.empresa_id
      JOIN peso_padrao pp ON pp.id = cp.peso_padrao_id
     WHERE cliente_no_grupo(c.cnpj, p_documento)
       AND ct.status = 'emitido'
     ORDER BY ct.numero DESC
$function$;

CREATE OR REPLACE FUNCTION public.cliente_pesos_pdf(p_documento text)
 RETURNS TABLE(id uuid, identificacao text, num_certificado text, validade date, empresa text, pdf_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT DISTINCT pp.id, pp.identificacao, pp.num_certificado, pp.validade,
           e.razao_social, pp.certificado_pdf_url
      FROM certificado_peso cp
      JOIN certificado ct ON ct.id = cp.certificado_id
      JOIN cliente c ON c.id = ct.cliente_id
      JOIN empresa e ON e.id = cp.empresa_id
      JOIN peso_padrao pp ON pp.id = cp.peso_padrao_id
     WHERE cliente_no_grupo(c.cnpj, p_documento)
       AND ct.status = 'emitido'
       AND pp.certificado_pdf_url IS NOT NULL
     ORDER BY pp.identificacao;
$function$;

CREATE OR REPLACE FUNCTION public.cliente_pesos_agrupado(p_documento text)
 RETURNS TABLE(peso_padrao_id uuid, identificacao text, num_certificado text, validade date, tem_pdf boolean, usos integer, certificados text, ultimo_uso date, valido_nos_usos boolean, vencido_hoje boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT pp.id, pp.identificacao, pp.num_certificado, pp.validade,
           (pp.certificado_pdf_url IS NOT NULL),
           count(DISTINCT ct.id)::int,
           -- lista os números, no máximo 6 (com reticências se houver mais)
           CASE WHEN count(DISTINCT ct.id) > 6
                THEN (array_to_string((array_agg(DISTINCT ct.numero))[1:6], ', ') || ', …')
                ELSE array_to_string(array_agg(DISTINCT ct.numero), ', ')
           END,
           max(ct.data_calibracao)::date,
           -- estava válido em TODAS as calibrações em que foi usado?
           bool_and(pp.validade IS NULL OR ct.data_calibracao IS NULL
                    OR pp.validade >= ct.data_calibracao),
           (pp.validade IS NOT NULL AND pp.validade < current_date)
      FROM peso_padrao pp
      JOIN certificado_peso cp ON cp.peso_padrao_id = pp.id
      JOIN certificado ct ON ct.id = cp.certificado_id
      JOIN cliente c ON c.id = ct.cliente_id
     WHERE cliente_no_grupo(c.cnpj, p_documento)
       AND ct.status IN ('emitido', 'substituido')
     GROUP BY pp.id, pp.identificacao, pp.num_certificado, pp.validade,
              pp.certificado_pdf_url
     ORDER BY pp.identificacao;
$function$;

CREATE OR REPLACE FUNCTION public.cliente_possui_certificado(p_documento text, p_cert uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM certificado ct
          JOIN cliente c ON c.id = ct.cliente_id
         WHERE ct.id = p_cert AND ct.status = 'emitido'
           AND cliente_no_grupo(c.cnpj, p_documento));
$function$;

CREATE OR REPLACE FUNCTION public.cliente_pdf_certificado(p_documento text, p_cert uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT ct.pdf_url
      FROM certificado ct
      JOIN cliente c ON c.id = ct.cliente_id
     WHERE ct.id = p_cert
       AND ct.status IN ('emitido', 'substituido')   -- cancelado não baixa
       AND cliente_no_grupo(c.cnpj, p_documento);
$function$;

CREATE OR REPLACE FUNCTION public.cliente_pdf_peso(p_documento text, p_peso uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT DISTINCT pp.certificado_pdf_url
      FROM peso_padrao pp
      JOIN certificado_peso cp ON cp.peso_padrao_id = pp.id
      JOIN certificado ct ON ct.id = cp.certificado_id
      JOIN cliente c ON c.id = ct.cliente_id
     WHERE pp.id = p_peso
       AND ct.status IN ('emitido', 'substituido')
       AND cliente_no_grupo(c.cnpj, p_documento)
     LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.cliente_empresas_contato(p_documento text)
 RETURNS TABLE(empresa text, telefone text, email text, cidade_uf text, certificados bigint, ultimo_cert date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT e.razao_social, e.telefone, e.email, e.cidade_uf,
           count(ct.id),
           max(ct.data_calibracao)::date
      FROM cliente c
      JOIN empresa e ON e.id = c.empresa_id
      LEFT JOIN certificado ct ON ct.cliente_id = c.id AND ct.status = 'emitido'
     WHERE cliente_no_grupo(c.cnpj, p_documento)
     GROUP BY e.razao_social, e.telefone, e.email, e.cidade_uf
     ORDER BY count(ct.id) DESC;
$function$;

CREATE OR REPLACE FUNCTION public.portal_solicitar_calibracao(p_documento text, p_solicitante text, p_balancas text, p_mensagem text)
 RETURNS TABLE(empresa_id uuid, empresa text, cliente text, solicitacao_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    r record;
    v_id uuid;
BEGIN
    FOR r IN
        SELECT DISTINCT c.empresa_id, c.id AS cliente_id, c.razao_social,
               e.razao_social AS emp
          FROM cliente c JOIN empresa e ON e.id = c.empresa_id
         WHERE cliente_no_grupo(c.cnpj, p_documento)
           AND c.ativo AND e.status = 'ativa'
    LOOP
        INSERT INTO solicitacao_calibracao
            (empresa_id, cliente_id, documento, solicitante, balancas, mensagem)
        VALUES (r.empresa_id, r.cliente_id, so_digitos(p_documento),
                p_solicitante, NULLIF(trim(p_balancas), ''), NULLIF(trim(p_mensagem), ''))
        RETURNING id INTO v_id;
        RETURN QUERY SELECT r.empresa_id, r.emp, r.razao_social, v_id;
    END LOOP;
END;
$function$;

-- 5) Gestão do vínculo manual (super-admin).
CREATE OR REPLACE FUNCTION public.sa_acesso_documentos(p_acesso_id uuid)
 RETURNS TABLE(documento text, origem text, criado_em timestamptz)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT ca.documento, 'ancora', ca.criado_em
      FROM cliente_acesso ca WHERE ca.id = p_acesso_id
    UNION ALL
    SELECT cad.documento, 'manual', cad.criado_em
      FROM cliente_acesso_documento cad
     WHERE cad.cliente_acesso_id = p_acesso_id
     ORDER BY 3;
$function$;

CREATE OR REPLACE FUNCTION public.sa_vincular_documento_acesso(p_acesso_id uuid, p_documento text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    INSERT INTO cliente_acesso_documento (cliente_acesso_id, documento)
    VALUES (p_acesso_id, so_digitos(p_documento))
    ON CONFLICT (cliente_acesso_id, documento) DO NOTHING;
$function$;

CREATE OR REPLACE FUNCTION public.sa_desvincular_documento_acesso(p_acesso_id uuid, p_documento text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    DELETE FROM cliente_acesso_documento
     WHERE cliente_acesso_id = p_acesso_id AND documento = so_digitos(p_documento);
$function$;

SELECT 'Portal: grupo de CNPJ (raiz automatica + vinculo manual) instalado' AS resultado;
