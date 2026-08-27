-- 93: representante legal da empresa + funcao que reune os dados para o
--     contrato de fornecimento preenchido (gerado no super-admin).

ALTER TABLE empresa ADD COLUMN IF NOT EXISTS rep_legal_nome text;
ALTER TABLE empresa ADD COLUMN IF NOT EXISTS rep_legal_cpf text;

CREATE OR REPLACE FUNCTION public.sa_editar_rep_legal(p_empresa uuid, p_nome text, p_cpf text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    UPDATE empresa SET rep_legal_nome = NULLIF(trim(p_nome), ''),
                       rep_legal_cpf  = NULLIF(trim(p_cpf), '')
     WHERE id = p_empresa
     RETURNING true;
$function$;

CREATE OR REPLACE FUNCTION public.sa_dados_contrato(p_empresa uuid)
 RETURNS TABLE(razao_social text, cnpj text, endereco text, cidade_uf text,
               telefone text, email text, rep_legal_nome text, rep_legal_cpf text,
               dias_carencia_contrato integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT razao_social, cnpj, endereco, cidade_uf, telefone, email,
           rep_legal_nome, rep_legal_cpf, dias_carencia_contrato
      FROM empresa WHERE id = p_empresa;
$function$;
