-- 113: SUPRESSAO DE ENVIOS — para quando alguem pede para nao receber mais.
-- Dois niveis:
--   (a) POR ENDERECO: 'todos' bloqueia tudo; 'avisos' bloqueia lembretes e
--       resumos, mas mantem o transacional (certificado, convite, senha, cobranca)
--   (b) POR EMPRESA: suspende os e-mails ADMINISTRATIVOS que o TSCert manda
--       para a EQUIPE dela — sem afetar o que a empresa envia aos clientes dela
--       (certificado, aviso de vencimento, pesquisa continuam saindo)

CREATE TABLE IF NOT EXISTS email_supressao (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email      text NOT NULL,
    escopo     text NOT NULL DEFAULT 'todos'
               CHECK (escopo IN ('todos', 'avisos')),
    motivo     text,
    criado_em  timestamptz NOT NULL DEFAULT now(),
    criado_por uuid REFERENCES usuario(id),
    ativo      boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_supressao_email
    ON email_supressao (lower(email)) WHERE ativo;

ALTER TABLE empresa ADD COLUMN IF NOT EXISTS emails_suspensos boolean NOT NULL DEFAULT false;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'api_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE email_supressao TO api_app;
    END IF;
END $$;

-- Devolve NULL se pode enviar, ou o MOTIVO do bloqueio (texto) se nao pode.
CREATE OR REPLACE FUNCTION public.email_suprimido(p_email text, p_empresa uuid,
                                                  p_motivo text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_transacional boolean := coalesce(p_motivo, '') = ANY (ARRAY[
        'certificado', 'convite', 'convite_portal', 'confirmacao_portal',
        'portal_validacao', 'reset_senha', 'cadastro_concluido', 'teste',
        'chamado', 'cobranca', 'cobranca_atraso', 'cobranca_lembrete']);
    v_escopo text;
BEGIN
    IF coalesce(trim(p_email), '') = '' THEN RETURN 'endereco vazio'; END IF;

    -- (a) endereco na lista
    SELECT escopo INTO v_escopo FROM email_supressao
     WHERE lower(email) = lower(trim(p_email)) AND ativo LIMIT 1;
    IF v_escopo = 'todos' THEN
        RETURN 'endereco na lista de supressao (todos os envios)';
    END IF;
    IF v_escopo = 'avisos' AND NOT v_transacional THEN
        RETURN 'endereco na lista de supressao (avisos e lembretes)';
    END IF;

    -- (b) empresa com administrativos suspensos, e o destinatario e da EQUIPE dela
    IF p_empresa IS NOT NULL AND NOT v_transacional
       AND EXISTS (SELECT 1 FROM empresa e WHERE e.id = p_empresa AND e.emails_suspensos)
       AND EXISTS (SELECT 1 FROM usuario u WHERE u.empresa_id = p_empresa
                    AND lower(u.email) = lower(trim(p_email)))
    THEN
        RETURN 'empresa com avisos administrativos suspensos';
    END IF;

    RETURN NULL;
END;
$function$;

-- ── Gestao pelo super-admin ────────────────────────────────
CREATE OR REPLACE FUNCTION public.sa_supressoes()
 RETURNS TABLE(id uuid, email text, escopo text, motivo text,
               criado_em timestamptz, criado_por_nome text,
               suprimidos bigint, ultimo_bloqueio timestamptz)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT s.id, s.email, s.escopo, s.motivo, s.criado_em, u.nome,
           (SELECT count(*) FROM email_log el
             WHERE lower(el.destinatario) = lower(s.email) AND el.status = 'suprimido'),
           (SELECT max(el.enviado_em) FROM email_log el
             WHERE lower(el.destinatario) = lower(s.email) AND el.status = 'suprimido')
      FROM email_supressao s
      LEFT JOIN usuario u ON u.id = s.criado_por
     WHERE s.ativo
     ORDER BY s.criado_em DESC;
$function$;

CREATE OR REPLACE FUNCTION public.sa_suprimir_email(p_email text, p_escopo text,
                                                    p_motivo text, p_usuario uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
    UPDATE email_supressao SET ativo = false
     WHERE lower(email) = lower(trim(p_email)) AND ativo;
    INSERT INTO email_supressao (email, escopo, motivo, criado_por)
    VALUES (lower(trim(p_email)),
            CASE WHEN p_escopo IN ('todos', 'avisos') THEN p_escopo ELSE 'todos' END,
            NULLIF(trim(p_motivo), ''), p_usuario)
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sa_liberar_email(p_email text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    UPDATE email_supressao SET ativo = false
     WHERE lower(email) = lower(trim(p_email)) AND ativo
     RETURNING true;
$function$;

CREATE OR REPLACE FUNCTION public.sa_suspender_emails_empresa(p_empresa uuid, p_suspender boolean)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    UPDATE empresa SET emails_suspensos = p_suspender
     WHERE id = p_empresa RETURNING emails_suspensos;
$function$;

-- sa_dados_contrato passa a devolver a flag de e-mails suspensos
DROP FUNCTION IF EXISTS public.sa_dados_contrato(uuid);
CREATE FUNCTION public.sa_dados_contrato(p_empresa uuid)
 RETURNS TABLE(razao_social text, cnpj text, endereco text, cep text, cidade_uf text,
               telefone text, email text, rep_legal_nome text, rep_legal_cpf text,
               dias_carencia_contrato integer, liberado_ate date,
               portal_cliente_ativo boolean, emails_suspensos boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT razao_social, cnpj, endereco, cep, cidade_uf, telefone, email,
           rep_legal_nome, rep_legal_cpf, dias_carencia_contrato, liberado_ate,
           portal_cliente_ativo, emails_suspensos
      FROM empresa WHERE id = p_empresa;
$function$;
