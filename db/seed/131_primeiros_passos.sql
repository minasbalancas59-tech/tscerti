-- 131: assistente de primeiros passos.
-- Diz o que falta para a empresa emitir o primeiro certificado, e guarda
-- se o usuário escolheu dispensar o guia.
BEGIN;

ALTER TABLE usuario ADD COLUMN IF NOT EXISTS guia_dispensado_em timestamptz;

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
                          WHERE ativo AND validade < current_date)
    );
$function$;

CREATE OR REPLACE FUNCTION public.usuario_dispensar_guia(p_usuario uuid, p_dispensar boolean)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
    UPDATE usuario
       SET guia_dispensado_em = CASE WHEN p_dispensar THEN now() ELSE NULL END
     WHERE id = p_usuario
     RETURNING guia_dispensado_em IS NOT NULL;
$function$;

COMMIT;

\echo '--- prova: o que falta em cada empresa ---'
SELECT e.razao_social,
       (SELECT count(*) FROM peso_padrao p WHERE p.empresa_id = e.id AND p.ativo) AS pesos,
       (SELECT count(*) FROM cliente c WHERE c.empresa_id = e.id AND c.ativo) AS clientes,
       (SELECT count(*) FROM balanca b WHERE b.empresa_id = e.id AND b.ativa) AS balancas,
       (SELECT count(*) FROM certificado ct WHERE ct.empresa_id = e.id) AS certificados
  FROM empresa e ORDER BY 5, 1;
