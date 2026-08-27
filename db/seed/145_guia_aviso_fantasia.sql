-- (1) Guia de primeiros passos ganha o item "aviso de vencimento" e
-- (2) funcao SA para editar o nome fantasia (RLS exige SECURITY DEFINER).
-- Joao, 22/08/2026.

CREATE OR REPLACE FUNCTION public.empresa_primeiros_passos(p_usuario uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
    SELECT jsonb_build_object(
      'assinatura',   (SELECT u.assinatura_url IS NOT NULL FROM usuario u WHERE u.id = p_usuario),
      'dispensado',   (SELECT u.guia_dispensado_em IS NOT NULL FROM usuario u WHERE u.id = p_usuario),
      'pesos',        (SELECT count(*) FROM peso_padrao WHERE ativo),
      'clientes',     (SELECT count(*) FROM cliente WHERE ativo),
      'balancas',     (SELECT count(*) FROM balanca WHERE ativa),
      'certificados', (SELECT count(*) FROM certificado),
      'emitidos',     (SELECT count(*) FROM certificado WHERE status = 'emitido'),
      'logo',         (SELECT logo_url IS NOT NULL FROM empresa WHERE id = current_empresa_id()),
      'pesos_vencidos', (SELECT count(*) FROM peso_padrao
                          WHERE ativo AND validade < current_date),
      'aviso_venc',   (SELECT COALESCE(aviso_venc_ativo, false) FROM empresa
                        WHERE id = current_empresa_id())
    );
$function$;

CREATE OR REPLACE FUNCTION public.sa_editar_nome_fantasia(p_id uuid, p_nome text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    UPDATE empresa SET nome_fantasia = NULLIF(trim(p_nome), '') WHERE id = p_id;
$function$;
GRANT EXECUTE ON FUNCTION public.sa_editar_nome_fantasia(uuid, text) TO certsaas, api_app;
