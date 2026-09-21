-- ═══════════════════════════════════════════════════════════
-- 163 · Vínculo manual de filiais no portal, também pela própria
-- empresa (laboratório) — antes só o super-admin conseguia (162).
--
-- Fica restrito a filiais que já são CLIENTE da própria empresa
-- (current_empresa_id(), nunca um parâmetro que o chamador poderia
-- forjar) — diferente da ferramenta do super-admin, aqui não dá pra
-- digitar um CNPJ qualquer, só escolher entre os próprios clientes
-- cadastrados. Isso fecha a questão de segurança "como provar que o
-- documento é dele mesmo": os dois lados do vínculo já são clientes
-- que a empresa cadastrou.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.cliente_portal_vinculo(p_cliente_id uuid)
 RETURNS TABLE(acesso_id uuid, email text, documento text, origem text, criado_em timestamptz)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    WITH alvo AS (
        SELECT cnpj FROM cliente
         WHERE id = p_cliente_id AND empresa_id = current_empresa_id()
    ),
    acesso AS (
        SELECT ca.id, ca.email, ca.criado_em
          FROM cliente_acesso ca, alvo
         WHERE cliente_no_grupo(alvo.cnpj, ca.documento)
         ORDER BY ca.criado_em LIMIT 1
    )
    SELECT a.id, a.email, ca.documento, 'ancora', ca.criado_em
      FROM acesso a JOIN cliente_acesso ca ON ca.id = a.id
    UNION ALL
    SELECT a.id, a.email, cad.documento, 'manual', cad.criado_em
      FROM acesso a JOIN cliente_acesso_documento cad ON cad.cliente_acesso_id = a.id
     ORDER BY 5;
$function$;

-- Retorna NULL quando deu certo, ou uma mensagem de erro amigável
-- (o C# devolve isso direto como { erro } pro front).
CREATE OR REPLACE FUNCTION public.cliente_portal_vincular(p_cliente_id uuid, p_cliente_alvo_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_cnpj_origem text;
    v_cnpj_alvo   text;
    v_acesso_id   uuid;
BEGIN
    SELECT cnpj INTO v_cnpj_origem FROM cliente
     WHERE id = p_cliente_id AND empresa_id = current_empresa_id();
    IF v_cnpj_origem IS NULL THEN RETURN 'Cliente não encontrado.'; END IF;

    SELECT cnpj INTO v_cnpj_alvo FROM cliente
     WHERE id = p_cliente_alvo_id AND empresa_id = current_empresa_id();
    IF v_cnpj_alvo IS NULL THEN RETURN 'Filial a vincular não encontrada.'; END IF;

    IF mesmo_grupo_cnpj(v_cnpj_origem, v_cnpj_alvo) THEN
        RETURN 'Essas duas filiais já compartilham a mesma raiz de CNPJ — já aparecem juntas automaticamente, não precisa vincular.';
    END IF;

    SELECT ca.id INTO v_acesso_id FROM cliente_acesso ca
     WHERE cliente_no_grupo(v_cnpj_origem, ca.documento)
     ORDER BY ca.criado_em LIMIT 1;
    IF v_acesso_id IS NULL THEN
        RETURN 'Esse cliente ainda não criou acesso ao portal — peça para ele se cadastrar primeiro (ou convide pelo botão 🔗 Portal).';
    END IF;

    INSERT INTO cliente_acesso_documento (cliente_acesso_id, documento)
    VALUES (v_acesso_id, so_digitos(v_cnpj_alvo))
    ON CONFLICT (cliente_acesso_id, documento) DO NOTHING;
    RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.cliente_portal_desvincular(p_cliente_id uuid, p_documento text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_cnpj      text;
    v_acesso_id uuid;
BEGIN
    SELECT cnpj INTO v_cnpj FROM cliente
     WHERE id = p_cliente_id AND empresa_id = current_empresa_id();
    IF v_cnpj IS NULL THEN RETURN 'Cliente não encontrado.'; END IF;

    SELECT ca.id INTO v_acesso_id FROM cliente_acesso ca
     WHERE cliente_no_grupo(v_cnpj, ca.documento)
     ORDER BY ca.criado_em LIMIT 1;
    IF v_acesso_id IS NULL THEN RETURN 'Esse cliente não tem acesso ao portal.'; END IF;

    DELETE FROM cliente_acesso_documento
     WHERE cliente_acesso_id = v_acesso_id AND documento = so_digitos(p_documento);
    RETURN NULL;
END $function$;

SELECT 'Vinculo manual de filiais no portal, tambem pela empresa' AS resultado;
