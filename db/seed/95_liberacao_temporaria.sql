-- 95: liberacao temporaria de empresa inadimplente (escudo contra as
--     suspensoes automaticas ate a data marcada pelo super-admin)

ALTER TABLE empresa ADD COLUMN IF NOT EXISTS liberado_ate date;

CREATE OR REPLACE FUNCTION public.sa_liberar_empresa(p_empresa uuid, p_ate date)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    UPDATE empresa
       SET liberado_ate = p_ate,
           -- se estava suspensa por motivo AUTOMATICO, reativa na hora;
           -- suspensao manual do super-admin nao e revertida por aqui
           status = CASE WHEN p_ate IS NOT NULL AND status = 'suspensa'
                          AND motivo_suspensao IN ('contrato_vencido', 'avaliacao_encerrada')
                         THEN 'ativa' ELSE status END,
           motivo_suspensao = CASE WHEN p_ate IS NOT NULL AND status = 'suspensa'
                          AND motivo_suspensao IN ('contrato_vencido', 'avaliacao_encerrada')
                         THEN NULL ELSE motivo_suspensao END
     WHERE id = p_empresa
     RETURNING true;
$function$;

-- dados-contrato passa a informar a liberacao (para exibir no super-admin)
DROP FUNCTION IF EXISTS public.sa_dados_contrato(uuid);
CREATE FUNCTION public.sa_dados_contrato(p_empresa uuid)
 RETURNS TABLE(razao_social text, cnpj text, endereco text, cep text, cidade_uf text,
               telefone text, email text, rep_legal_nome text, rep_legal_cpf text,
               dias_carencia_contrato integer, liberado_ate date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT razao_social, cnpj, endereco, cep, cidade_uf, telefone, email,
           rep_legal_nome, rep_legal_cpf, dias_carencia_contrato, liberado_ate
      FROM empresa WHERE id = p_empresa;
$function$;
