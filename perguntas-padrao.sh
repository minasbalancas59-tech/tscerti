#!/bin/bash
# ══ Pesquisa de satisfação: conjunto padrão de 5 perguntas ══
# (João, 12/08/2026) Aplica em quem não tem nenhuma e faz as empresas
# novas nascerem com elas, via trigger. Não toca em quem já personalizou.
set -e
cd /root/cert-saas

echo "── existe campo de comentário livre na resposta? ──"
docker compose exec -T db psql -U certsaas -d certsaas -c "\d pesquisa_resposta" | head -14
docker compose exec -T db psql -U certsaas -d certsaas -c "\d pesquisa_envio" | grep -i "coment\|obs\|texto" || echo "(sem campo de comentário aparente)"

echo
echo "── aplicando o padrão ──"
docker compose exec -T db psql -U certsaas -d certsaas <<'SQL'
-- SECURITY DEFINER: mexe em dados de outras empresas (RLS forçada)
CREATE OR REPLACE FUNCTION public.pesquisa_semear_padrao(p_empresa uuid)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE n integer;
BEGIN
    -- só semeia se a empresa não tiver NENHUMA pergunta (não sobrescreve)
    IF EXISTS (SELECT 1 FROM pesquisa_pergunta WHERE empresa_id = p_empresa) THEN
        RETURN 0;
    END IF;
    INSERT INTO pesquisa_pergunta (empresa_id, texto, tipo, ordem, ativa) VALUES
      (p_empresa, 'De 0 a 10, qual a probabilidade de você recomendar nossos serviços a um colega ou parceiro?', 'nps',  1, true),
      (p_empresa, 'Como você avalia o atendimento e a pontualidade da nossa equipe técnica?',                   'nota', 2, true),
      (p_empresa, 'Como você avalia a qualidade técnica do serviço executado?',                                 'nota', 3, true),
      (p_empresa, 'Como você avalia o certificado recebido, quanto à clareza e ao prazo de entrega?',            'nota', 4, true),
      (p_empresa, 'Como você avalia a facilidade de contato e a agilidade das nossas respostas (agendamento, dúvidas e solicitações)?', 'nota', 5, true);
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END;
$function$;

-- Empresas NOVAS já nascem com o padrão (qualquer caminho de criação)
CREATE OR REPLACE FUNCTION public.trg_empresa_pesquisa_padrao()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
    PERFORM pesquisa_semear_padrao(NEW.id);
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS empresa_pesquisa_padrao ON empresa;
CREATE TRIGGER empresa_pesquisa_padrao
    AFTER INSERT ON empresa
    FOR EACH ROW EXECUTE FUNCTION trg_empresa_pesquisa_padrao();

-- Aplica nas empresas atuais que ainda não têm perguntas
SELECT e.razao_social,
       pesquisa_semear_padrao(e.id) AS perguntas_criadas
  FROM empresa e
 WHERE e.id <> '00000000-0000-0000-0000-000000000001'
 ORDER BY e.razao_social;
SQL

echo
echo "── resultado por empresa ──"
docker compose exec -T db psql -U certsaas -d certsaas -c "
SELECT e.razao_social, count(p.id) AS perguntas,
       count(*) FILTER (WHERE p.tipo = 'nps') AS nps
  FROM empresa e LEFT JOIN pesquisa_pergunta p ON p.empresa_id = e.id
 GROUP BY e.razao_social ORDER BY e.razao_social;"
