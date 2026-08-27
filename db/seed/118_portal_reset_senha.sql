-- 118: "Esqueci minha senha" no portal do cliente final.
-- Token proprio (nao reaproveita o de validacao de e-mail), vida curta de
-- 1 hora e USO UNICO — e apagado assim que a senha e trocada.

ALTER TABLE cliente_acesso ADD COLUMN IF NOT EXISTS token_reset text;
ALTER TABLE cliente_acesso ADD COLUMN IF NOT EXISTS token_reset_expira timestamptz;

-- Gera o token. Devolve NULL se nao existe conta ativa com esse e-mail —
-- a API responde igual nos dois casos, para nao revelar quem tem cadastro.
CREATE OR REPLACE FUNCTION public.cliente_reset_criar(p_email text)
 RETURNS TABLE(token text, nome text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_token text := encode(gen_random_bytes(24), 'hex');
    v_nome  text;
BEGIN
    UPDATE cliente_acesso
       SET token_reset = v_token,
           token_reset_expira = now() + interval '1 hour'
     WHERE lower(email) = lower(trim(p_email)) AND ativo
     RETURNING cliente_acesso.nome INTO v_nome;
    IF NOT FOUND THEN RETURN; END IF;      -- sem linha: e-mail sem conta ativa
    RETURN QUERY SELECT v_token, v_nome;
END;
$function$;

-- Dados da tela de nova senha (o e-mail aparece preenchido e travado)
CREATE OR REPLACE FUNCTION public.cliente_reset_ver(p_token text)
 RETURNS TABLE(email text, nome text, valido boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT a.email, a.nome,
           (a.token_reset_expira > now() AND a.ativo)
      FROM cliente_acesso a
     WHERE a.token_reset = p_token;
$function$;

-- Troca a senha. O token e de uso unico: some no mesmo UPDATE.
-- Aproveita para marcar o e-mail como validado: quem clicou no link do
-- e-mail provou a posse dele.
CREATE OR REPLACE FUNCTION public.cliente_reset_usar(p_token text, p_hash text)
 RETURNS TABLE(ok boolean, email text, erro text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_a record;
BEGIN
    SELECT * INTO v_a FROM cliente_acesso WHERE token_reset = p_token;
    IF v_a.id IS NULL THEN
        RETURN QUERY SELECT false, NULL::text, 'Link invalido ou ja utilizado.'; RETURN;
    END IF;
    IF NOT v_a.ativo THEN
        RETURN QUERY SELECT false, v_a.email, 'Este acesso esta desativado.'; RETURN;
    END IF;
    IF v_a.token_reset_expira <= now() THEN
        RETURN QUERY SELECT false, v_a.email,
            'Link expirado. Peca um novo em "Esqueci minha senha".'; RETURN;
    END IF;

    UPDATE cliente_acesso
       SET senha_hash = p_hash,
           email_validado = true,
           token_reset = NULL,
           token_reset_expira = NULL
     WHERE id = v_a.id;

    RETURN QUERY SELECT true, v_a.email, NULL::text;
END;
$function$;
