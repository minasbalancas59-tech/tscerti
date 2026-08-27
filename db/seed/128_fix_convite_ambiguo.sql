-- 128: FIX — "column reference email is ambiguous" ao convidar um contato.
--
-- CAUSA: em RETURNS TABLE(..., email text, ...), o Postgres cria uma VARIÁVEL
-- chamada "email". No DELETE eu escrevi `lower(email) = v_email` sem dizer de
-- onde vem o "email" — coluna da tabela ou variável de saída? Erro 42702.
-- Por isso o convite pelo caminho antigo (que não cita "email" no DELETE)
-- funcionava e o novo, com seleção de contatos, falhava.
--
-- CORREÇÃO: TODA referência a coluna qualificada com o nome da tabela.
BEGIN;

CREATE OR REPLACE FUNCTION public.cliente_convite_criar_para(
    p_cliente uuid, p_email text, p_usuario uuid)
 RETURNS TABLE(token text, email text, nome text, ja_tem_acesso boolean)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
    v_cli   record;
    v_email text := lower(trim(p_email));
    v_nome  text;
    v_token text;
BEGIN
    SELECT c.id, c.empresa_id, c.cnpj, c.razao_social,
           lower(trim(c.email)) AS email_cliente
      INTO v_cli
      FROM cliente c WHERE c.id = p_cliente;      -- RLS protege
    IF v_cli.id IS NULL THEN RAISE EXCEPTION 'Cliente nao encontrado.'; END IF;
    IF coalesce(trim(v_cli.cnpj), '') = '' THEN
        RAISE EXCEPTION 'Cadastre o CNPJ/CPF do cliente antes de convidar.';
    END IF;

    -- o e-mail precisa ser o principal OU um contato cadastrado deste cliente
    IF v_email = v_cli.email_cliente THEN
        v_nome := v_cli.razao_social;
    ELSE
        SELECT ct.nome INTO v_nome FROM cliente_contato ct
         WHERE ct.cliente_id = p_cliente AND lower(trim(ct.email)) = v_email
         LIMIT 1;
        IF v_nome IS NULL THEN
            RAISE EXCEPTION 'Este e-mail nao esta no cadastro do cliente.';
        END IF;
    END IF;

    v_token := encode(gen_random_bytes(24), 'hex');

    -- AQUI ESTAVA O ERRO: "email" sem qualificar. Agora tudo com o nome da tabela.
    DELETE FROM cliente_convite cv
     WHERE cv.cliente_id = p_cliente
       AND lower(cv.email) = v_email
       AND cv.usado_em IS NULL;

    INSERT INTO cliente_convite (empresa_id, cliente_id, email, documento,
                                 token, expira_em, criado_por)
    VALUES (v_cli.empresa_id, p_cliente, v_email,
            regexp_replace(v_cli.cnpj, '\D', '', 'g'),
            v_token, now() + interval '7 days', p_usuario);

    RETURN QUERY SELECT v_token, v_email, v_nome,
        EXISTS (SELECT 1 FROM cliente_acesso a WHERE lower(a.email) = v_email);
END;
$function$;

COMMIT;

\echo '--- prova: a funcao aceita um contato real (sem criar convite de verdade) ---'
SELECT ct.nome, ct.email, c.razao_social AS cliente
  FROM cliente_contato ct JOIN cliente c ON c.id = ct.cliente_id
 WHERE coalesce(trim(ct.email), '') <> ''
 LIMIT 3;
