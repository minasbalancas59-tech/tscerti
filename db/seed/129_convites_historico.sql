-- 129: histórico dos convites do portal, visível para a empresa, com a
-- SITUAÇÃO DE ENTREGA do e-mail e o LINK para reenviar por outro canal.
-- Motivo: e-mail que não chega mata o convite em silêncio. Com o link em
-- mãos, a empresa manda por WhatsApp e resolve na hora.
BEGIN;

CREATE OR REPLACE FUNCTION public.cliente_convites_historico(p_cliente uuid)
 RETURNS TABLE(id uuid, email text, nome_contato text, token text,
               criado_em timestamptz, expira_em timestamptz, usado_em timestamptz,
               criado_por_nome text, situacao text,
               email_status text, email_em timestamptz, email_erro text,
               ja_tem_acesso boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
    SELECT cv.id, cv.email,
           COALESCE((SELECT ct.nome FROM cliente_contato ct
                      WHERE ct.cliente_id = cv.cliente_id
                        AND lower(trim(ct.email)) = lower(cv.email) LIMIT 1),
                    (SELECT c.razao_social FROM cliente c WHERE c.id = cv.cliente_id)),
           cv.token, cv.criado_em, cv.expira_em, cv.usado_em,
           (SELECT u.nome FROM usuario u WHERE u.id = cv.criado_por),
           CASE WHEN cv.usado_em IS NOT NULL THEN 'usado'
                WHEN cv.expira_em <= now()   THEN 'expirado'
                ELSE 'pendente' END,
           -- como foi a entrega do e-mail do convite
           (SELECT el.status FROM email_log el
             WHERE lower(el.destinatario) = lower(cv.email)
               AND el.motivo = 'convite_portal'
               AND el.enviado_em >= cv.criado_em - interval '2 minutes'
             ORDER BY el.enviado_em DESC LIMIT 1),
           (SELECT el.enviado_em FROM email_log el
             WHERE lower(el.destinatario) = lower(cv.email)
               AND el.motivo = 'convite_portal'
               AND el.enviado_em >= cv.criado_em - interval '2 minutes'
             ORDER BY el.enviado_em DESC LIMIT 1),
           (SELECT left(coalesce(el.erro_detalhe, ''), 120) FROM email_log el
             WHERE lower(el.destinatario) = lower(cv.email)
               AND el.motivo = 'convite_portal' AND el.status = 'erro'
               AND el.enviado_em >= cv.criado_em - interval '2 minutes'
             ORDER BY el.enviado_em DESC LIMIT 1),
           EXISTS (SELECT 1 FROM cliente_acesso a
                    WHERE lower(a.email) = lower(cv.email))
      FROM cliente_convite cv
     WHERE cv.cliente_id = p_cliente
     ORDER BY cv.criado_em DESC;
$function$;

COMMIT;

\echo '--- prova: convites ja enviados ---'
SELECT email, situacao, email_status, ja_tem_acesso
  FROM cliente_convites_historico(
      (SELECT cliente_id FROM cliente_convite ORDER BY criado_em DESC LIMIT 1));
