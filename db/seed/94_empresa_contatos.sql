-- 94: endereco completo (CEP) + cadastro de CONTATOS da empresa (super-admin)

ALTER TABLE empresa ADD COLUMN IF NOT EXISTS cep text;

CREATE TABLE IF NOT EXISTS empresa_contato (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id  uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    nome        text NOT NULL,
    email       text,
    telefone    text,
    cargo       text,
    criado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_empresa_contato ON empresa_contato(empresa_id);

-- dados-contrato ganha o CEP (tipo de retorno muda: drop + create)
DROP FUNCTION IF EXISTS public.sa_dados_contrato(uuid);
CREATE FUNCTION public.sa_dados_contrato(p_empresa uuid)
 RETURNS TABLE(razao_social text, cnpj text, endereco text, cep text, cidade_uf text,
               telefone text, email text, rep_legal_nome text, rep_legal_cpf text,
               dias_carencia_contrato integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT razao_social, cnpj, endereco, cep, cidade_uf, telefone, email,
           rep_legal_nome, rep_legal_cpf, dias_carencia_contrato
      FROM empresa WHERE id = p_empresa;
$function$;

-- edicao do endereco/contato principal da empresa pelo super-admin
CREATE OR REPLACE FUNCTION public.sa_editar_dados_contato(
    p_empresa uuid, p_endereco text, p_cep text, p_cidade_uf text,
    p_telefone text, p_email text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    UPDATE empresa
       SET endereco  = NULLIF(trim(p_endereco), ''),
           cep       = NULLIF(trim(p_cep), ''),
           cidade_uf = NULLIF(trim(p_cidade_uf), ''),
           telefone  = NULLIF(trim(p_telefone), ''),
           email     = NULLIF(trim(p_email), '')
     WHERE id = p_empresa
     RETURNING true;
$function$;
