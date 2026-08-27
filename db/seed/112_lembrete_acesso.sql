-- 112: lembrete amigavel para empresa em AVALIACAO que nao esta acessando.
-- Objetivo comercial: avaliacao sem uso = venda perdida. O aviso e gentil,
-- espacado e limitado (no maximo 3 por empresa).

ALTER TABLE empresa ADD COLUMN IF NOT EXISTS lembrete_acesso_em date;
ALTER TABLE empresa ADD COLUMN IF NOT EXISTS lembretes_acesso integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.empresas_lembrete_acesso()
 RETURNS TABLE(empresa_id uuid, empresa text, admin_nome text, admin_email text,
               dias_cadastro integer, dias_sem_login integer,
               nunca_entrou boolean, lembretes integer,
               tem_certificado boolean, usuarios integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    WITH aval AS (
        SELECT e.id, e.razao_social, e.criado_em, e.lembretes_acesso, e.lembrete_acesso_em,
               (SELECT max(la.criado_em) FROM log_auditoria la
                 WHERE la.empresa_id = e.id AND la.acao = 'login_ok') AS ultimo_login,
               EXISTS (SELECT 1 FROM certificado c WHERE c.empresa_id = e.id) AS tem_cert,
               (SELECT count(*) FROM usuario u WHERE u.empresa_id = e.id AND u.ativo) AS qtd_usuarios
          FROM empresa e
         WHERE e.status = 'ativa'
           -- em avaliacao = sem contrato ativo
           AND NOT EXISTS (SELECT 1 FROM contrato c WHERE c.empresa_id = e.id AND c.ativo)
           -- nunca a empresa do sistema nem a propria Minas
           AND e.id NOT IN ('00000000-0000-0000-0000-000000000001',
                            '4fe3cf5d-e3dc-49f3-99fd-962af6815a86')
    )
    SELECT a.id, a.razao_social, u.nome, u.email,
           (current_date - a.criado_em::date)::int,
           COALESCE((current_date - a.ultimo_login::date)::int, 999),
           a.ultimo_login IS NULL,
           a.lembretes_acesso,
           a.tem_cert,
           a.qtd_usuarios::int
      FROM aval a
      JOIN usuario u ON u.empresa_id = a.id AND u.papel = 'admin' AND u.ativo
                    AND u.email IS NOT NULL AND u.email <> ''
     WHERE a.lembretes_acesso < 3
       -- no maximo 1 lembrete a cada 5 dias
       AND (a.lembrete_acesso_em IS NULL OR a.lembrete_acesso_em <= current_date - 5)
       -- 2 dias de folga apos o cadastro (deixa a pessoa respirar)
       AND (current_date - a.criado_em::date) >= 2
       -- so quem esta FRIO: 3+ dias sem entrar
       AND COALESCE((current_date - a.ultimo_login::date)::int, 999) >= 3
       -- avaliacao ja encerrada (30 dias) nao recebe convite para usar
       AND (current_date - a.criado_em::date) <= 30
     ORDER BY a.criado_em;
$function$;

CREATE OR REPLACE FUNCTION public.marcar_lembrete_acesso(p_empresa uuid)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    UPDATE empresa
       SET lembrete_acesso_em = current_date,
           lembretes_acesso = lembretes_acesso + 1
     WHERE id = p_empresa
     RETURNING lembretes_acesso;
$function$;
