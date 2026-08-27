#!/bin/bash
# ══ PESQUISA DO TSCERT (produto) — parte 1: banco ══
# Perguntas por papel, envios com token, respostas, config e alerta de detrator.
set -e
cd /root/cert-saas
docker compose exec -T db psql -U certsaas -d certsaas <<'SQL'
-- ── perguntas (globais do produto, por papel) ──
CREATE TABLE IF NOT EXISTS psaas_pergunta (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    papel     text NOT NULL CHECK (papel IN ('todos','admin','responsavel_tecnico','tecnico')),
    texto     text NOT NULL,
    tipo      text NOT NULL DEFAULT 'nota' CHECK (tipo IN ('nps','nota','texto')),
    ordem     integer NOT NULL DEFAULT 0,
    ativa     boolean NOT NULL DEFAULT true,
    criado_em timestamptz NOT NULL DEFAULT now()
);

-- ── envios (um por usuário, com token pessoal) ──
CREATE TABLE IF NOT EXISTS psaas_envio (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id    uuid NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
    empresa_id    uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    papel         text NOT NULL,
    token         text NOT NULL UNIQUE,
    modo          text NOT NULL DEFAULT 'manual',
    enviado_em    timestamptz NOT NULL DEFAULT now(),
    respondido_em timestamptz,
    nps           integer
);
CREATE INDEX IF NOT EXISTS idx_psaas_envio_usuario ON psaas_envio (usuario_id, enviado_em DESC);

-- ── respostas ──
CREATE TABLE IF NOT EXISTS psaas_resposta (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    envio_id    uuid NOT NULL REFERENCES psaas_envio(id) ON DELETE CASCADE,
    pergunta_id uuid NOT NULL REFERENCES psaas_pergunta(id) ON DELETE CASCADE,
    nota        integer,
    texto       text,
    criado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_psaas_resp_envio ON psaas_resposta (envio_id);

-- ── configuração (linha única) ──
CREATE TABLE IF NOT EXISTS psaas_config (
    id           boolean PRIMARY KEY DEFAULT true CHECK (id),
    ativo        boolean NOT NULL DEFAULT false,
    freq_dias    integer NOT NULL DEFAULT 180,
    dias_ativo   integer NOT NULL DEFAULT 30,
    alerta_email text,
    convite_titulo text,
    convite_texto  text
);
INSERT INTO psaas_config (id) VALUES (true) ON CONFLICT DO NOTHING;

-- ── perguntas padrão (só na primeira vez) ──
INSERT INTO psaas_pergunta (papel, texto, tipo, ordem)
SELECT * FROM (VALUES
 ('todos','De 0 a 10, o quanto você recomendaria o TSCert a um colega do setor?','nps',1),
 ('todos','O sistema é fácil de usar no seu dia a dia?','nota',2),
 ('todos','Quando precisou de suporte, como foi o atendimento?','nota',3),
 ('tecnico','Preencher o ensaio no celular ou tablet, em campo, é prático?','nota',10),
 ('tecnico','A impressão da etiqueta funciona bem no seu aparelho?','nota',11),
 ('tecnico','O que mais te atrapalha ou toma tempo hoje no sistema?','texto',12),
 ('responsavel_tecnico','A revisão e a aprovação de certificados atendem sua necessidade?','nota',10),
 ('responsavel_tecnico','Os cálculos e o certificado emitido passam confiança metrológica?','nota',11),
 ('responsavel_tecnico','Que recurso técnico falta no TSCert?','texto',12),
 ('admin','Os relatórios e o painel dão a visão que você precisa?','nota',10),
 ('admin','O TSCert vale o que custa para a sua empresa?','nota',11),
 ('admin','O que faria você usar mais o sistema?','texto',12)
) v WHERE NOT EXISTS (SELECT 1 FROM psaas_pergunta);

-- ── funções (SECURITY DEFINER: dados de todos os tenants) ──
CREATE OR REPLACE FUNCTION public.psaas_usuarios_alvo()
 RETURNS TABLE(usuario_id uuid, nome text, email text, papel text,
               empresa_id uuid, empresa text, visto_em timestamptz,
               ultimo_envio timestamptz, respondeu boolean)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
    SELECT u.id, u.nome, u.email, u.papel, e.id, e.razao_social, u.visto_em,
           ult.enviado_em, ult.respondido_em IS NOT NULL
      FROM usuario u
      JOIN empresa e ON e.id = u.empresa_id
      LEFT JOIN LATERAL (
          SELECT enviado_em, respondido_em FROM psaas_envio
           WHERE usuario_id = u.id ORDER BY enviado_em DESC LIMIT 1) ult ON true
     WHERE u.ativo AND u.papel IN ('admin','responsavel_tecnico','tecnico')
       AND COALESCE(u.email,'') <> '' AND e.status = 'ativa'
       AND e.id <> '00000000-0000-0000-0000-000000000001'
     ORDER BY e.razao_social, u.nome
$function$;

CREATE OR REPLACE FUNCTION public.psaas_perguntas_do_papel(p_papel text)
 RETURNS TABLE(id uuid, texto text, tipo text, ordem integer)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
    SELECT id, texto, tipo, ordem FROM psaas_pergunta
     WHERE ativa AND papel IN ('todos', p_papel) ORDER BY ordem
$function$;

CREATE OR REPLACE FUNCTION public.psaas_criar_envio(p_usuario uuid, p_modo text)
 RETURNS TABLE(envio_id uuid, token text, nome text, email text, papel text, empresa text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_tok text; v_id uuid; r record;
BEGIN
    SELECT u.nome, u.email, u.papel, u.empresa_id, e.razao_social AS emp
      INTO r FROM usuario u JOIN empresa e ON e.id = u.empresa_id WHERE u.id = p_usuario;
    IF r IS NULL THEN RETURN; END IF;
    v_tok := encode(gen_random_bytes(24), 'hex');
    INSERT INTO psaas_envio (usuario_id, empresa_id, papel, token, modo)
    VALUES (p_usuario, r.empresa_id, r.papel, v_tok, p_modo) RETURNING id INTO v_id;
    RETURN QUERY SELECT v_id, v_tok, r.nome, r.email, r.papel, r.emp;
END;
$function$;

-- resposta pública (sem login, pelo token)
CREATE OR REPLACE FUNCTION public.psaas_por_token(p_token text)
 RETURNS TABLE(envio_id uuid, nome text, papel text, empresa text, respondido boolean)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
    SELECT en.id, u.nome, en.papel, e.razao_social, en.respondido_em IS NOT NULL
      FROM psaas_envio en JOIN usuario u ON u.id = en.usuario_id
      JOIN empresa e ON e.id = en.empresa_id
     WHERE en.token = p_token
$function$;

CREATE OR REPLACE FUNCTION public.psaas_gravar(p_token text, p_respostas jsonb)
 RETURNS TABLE(ok boolean, nps integer, nome text, empresa text, papel text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_envio uuid; v_nps integer; it jsonb; v_nome text; v_emp text; v_papel text;
BEGIN
    SELECT en.id, u.nome, e.razao_social, en.papel INTO v_envio, v_nome, v_emp, v_papel
      FROM psaas_envio en JOIN usuario u ON u.id = en.usuario_id
      JOIN empresa e ON e.id = en.empresa_id
     WHERE en.token = p_token AND en.respondido_em IS NULL;
    IF v_envio IS NULL THEN RETURN QUERY SELECT false, NULL::integer, NULL::text, NULL::text, NULL::text; RETURN; END IF;
    FOR it IN SELECT * FROM jsonb_array_elements(p_respostas) LOOP
        INSERT INTO psaas_resposta (envio_id, pergunta_id, nota, texto)
        VALUES (v_envio, (it->>'pergunta')::uuid,
                NULLIF(it->>'nota','')::integer, NULLIF(it->>'texto',''));
        IF (SELECT tipo FROM psaas_pergunta WHERE id = (it->>'pergunta')::uuid) = 'nps' THEN
            v_nps := NULLIF(it->>'nota','')::integer;
        END IF;
    END LOOP;
    UPDATE psaas_envio SET respondido_em = now(), nps = v_nps WHERE id = v_envio;
    RETURN QUERY SELECT true, v_nps, v_nome, v_emp, v_papel;
END;
$function$;

-- painel do super admin
CREATE OR REPLACE FUNCTION public.psaas_resumo()
 RETURNS TABLE(enviadas bigint, respondidas bigint, nps numeric,
               promotores bigint, neutros bigint, detratores bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
    SELECT count(*), count(respondido_em),
           CASE WHEN count(nps) = 0 THEN NULL ELSE
             round(100.0 * (count(*) FILTER (WHERE nps >= 9)
                          - count(*) FILTER (WHERE nps <= 6)) / count(nps), 0) END,
           count(*) FILTER (WHERE nps >= 9),
           count(*) FILTER (WHERE nps BETWEEN 7 AND 8),
           count(*) FILTER (WHERE nps <= 6)
      FROM psaas_envio
$function$;

CREATE OR REPLACE FUNCTION public.psaas_respostas_lista()
 RETURNS TABLE(envio_id uuid, quando timestamptz, nome text, papel text, empresa text,
               nps integer, respostas jsonb)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
    SELECT en.id, en.respondido_em, u.nome, en.papel, e.razao_social, en.nps,
           (SELECT jsonb_agg(jsonb_build_object('pergunta', p.texto, 'tipo', p.tipo,
                    'nota', r.nota, 'texto', r.texto) ORDER BY p.ordem)
              FROM psaas_resposta r JOIN psaas_pergunta p ON p.id = r.pergunta_id
             WHERE r.envio_id = en.id)
      FROM psaas_envio en JOIN usuario u ON u.id = en.usuario_id
      JOIN empresa e ON e.id = en.empresa_id
     WHERE en.respondido_em IS NOT NULL
     ORDER BY en.respondido_em DESC LIMIT 200
$function$;
SQL
echo
echo "✓ banco pronto"
docker compose exec -T db psql -U certsaas -d certsaas -c "
SELECT papel, count(*) FROM psaas_pergunta GROUP BY papel ORDER BY papel;"
