-- 123: FIM DO FLOOD DE E-MAIL A CADA REBUILD.
--
-- O worker guardava "já rodei hoje" em variáveis de MEMÓRIA. Todo rebuild
-- zerava tudo e as rotinas diárias disparavam de novo — numa sessão com
-- vários deploys, o mesmo resumo saía várias vezes.
-- Agora o controle fica no BANCO: sobrevive a restart, rebuild e reboot.

CREATE TABLE IF NOT EXISTS rotina_execucao (
    nome      text PRIMARY KEY,
    ultima_em timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'api_app') THEN
        GRANT SELECT, INSERT, UPDATE ON TABLE rotina_execucao TO api_app;
    END IF;
END $$;

-- Rotina de 1x POR DIA. Devolve true (e marca) só na primeira vez do dia.
-- INSERT..ON CONFLICT com WHERE: é atômico, então nem duas instâncias do
-- worker rodando junto conseguiriam duplicar.
CREATE OR REPLACE FUNCTION public.rotina_marcar_dia(p_nome text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ok boolean;
BEGIN
    INSERT INTO rotina_execucao (nome, ultima_em)
    VALUES (p_nome, now())
    ON CONFLICT (nome) DO UPDATE SET ultima_em = now()
     WHERE rotina_execucao.ultima_em::date < current_date
    RETURNING true INTO v_ok;
    RETURN COALESCE(v_ok, false);
END;
$function$;

-- Rotina por INTERVALO (ex.: alerta de pico, no máximo 1x por hora)
CREATE OR REPLACE FUNCTION public.rotina_marcar_intervalo(p_nome text, p_intervalo interval)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ok boolean;
BEGIN
    INSERT INTO rotina_execucao (nome, ultima_em)
    VALUES (p_nome, now())
    ON CONFLICT (nome) DO UPDATE SET ultima_em = now()
     WHERE rotina_execucao.ultima_em < now() - p_intervalo
    RETURNING true INTO v_ok;
    RETURN COALESCE(v_ok, false);
END;
$function$;

-- ── PAUSA MANUAL dos e-mails automáticos (para janelas de manutenção) ──
-- Sempre COM PRAZO: pausa esquecida ligada é pior que flood.
CREATE OR REPLACE FUNCTION public.sistema_pausar_emails(p_minutos integer DEFAULT 60)
 RETURNS timestamptz
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ate timestamptz;
BEGIN
    v_ate := CASE WHEN p_minutos <= 0 THEN now() - interval '1 second'
                  ELSE now() + make_interval(mins => LEAST(p_minutos, 720)) END;
    INSERT INTO rotina_execucao (nome, ultima_em) VALUES ('emails_pausados_ate', v_ate)
    ON CONFLICT (nome) DO UPDATE SET ultima_em = v_ate;
    RETURN v_ate;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sistema_emails_pausados()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT COALESCE((SELECT ultima_em > now() FROM rotina_execucao
                      WHERE nome = 'emails_pausados_ate'), false);
$function$;

-- Semeia as rotinas com a data de HOJE para que o primeiro deploy não
-- dispare tudo de uma vez (as de hoje já rodaram antes desta migração).
INSERT INTO rotina_execucao (nome, ultima_em)
VALUES ('processamento_diario', now()), ('aviso_aprovacoes', now()),
       ('resumo_erros', now()), ('resumo_emails', now()),
       ('lembrete_acesso', now()), ('aviso_backup', now()),
       ('expurgo_log', now())
ON CONFLICT (nome) DO NOTHING;
