-- 105: visao completa de manutencao no super-admin (dados da empresa e dos
--      CLIENTES FINAIS dela). SECURITY DEFINER: o super-admin consulta dados
--      de qualquer empresa, fora do RLS.

-- Clientes finais da empresa, com contadores e situacao no portal
CREATE OR REPLACE FUNCTION public.sa_empresa_clientes(p_empresa uuid)
 RETURNS TABLE(id uuid, razao_social text, nome_fantasia text, cnpj text,
               tipo_pessoa text, email text, telefone text, endereco text,
               cep text, cidade text, uf text, ativo boolean,
               criado_em timestamptz,
               balancas bigint, certificados bigint, ultimo_cert date,
               portal_email text, portal_validado boolean,
               portal_ativo boolean, portal_ultimo_acesso timestamptz)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT c.id, c.razao_social, c.nome_fantasia, c.cnpj, c.tipo_pessoa,
           c.email, c.telefone, c.endereco, c.cep, c.cidade, c.uf::text,
           c.ativo, c.criado_em,
           (SELECT count(*) FROM balanca b WHERE b.cliente_id = c.id),
           (SELECT count(*) FROM certificado ct WHERE ct.cliente_id = c.id),
           (SELECT max(ct.data_calibracao)::date FROM certificado ct
             WHERE ct.cliente_id = c.id AND ct.status = 'emitido'),
           a.email, a.email_validado, a.ativo, a.ultimo_acesso
      FROM cliente c
      LEFT JOIN cliente_acesso a
             ON lower(trim(a.email)) = lower(trim(COALESCE(c.email, '')))
     WHERE c.empresa_id = p_empresa
     ORDER BY c.razao_social;
$function$;

-- Balancas de um cliente (SETOF: acompanha o schema, sem listar colunas)
CREATE OR REPLACE FUNCTION public.sa_cliente_balancas(p_cliente uuid)
 RETURNS SETOF balanca
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT * FROM balanca WHERE cliente_id = p_cliente ORDER BY identificacao;
$function$;

-- Panorama de manutencao da empresa (contadores de tudo)
CREATE OR REPLACE FUNCTION public.sa_empresa_panorama(p_empresa uuid)
 RETURNS TABLE(usuarios bigint, usuarios_ativos bigint,
               clientes bigint, clientes_ativos bigint,
               balancas bigint, pesos bigint,
               cert_rascunho bigint, cert_aguardando bigint,
               cert_emitido bigint, cert_substituido bigint, cert_cancelado bigint,
               acessos_portal bigint, acessos_validados bigint,
               primeiro_cert date, ultimo_cert date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT
      (SELECT count(*) FROM usuario u WHERE u.empresa_id = p_empresa),
      (SELECT count(*) FROM usuario u WHERE u.empresa_id = p_empresa AND u.ativo),
      (SELECT count(*) FROM cliente c WHERE c.empresa_id = p_empresa),
      (SELECT count(*) FROM cliente c WHERE c.empresa_id = p_empresa AND c.ativo),
      (SELECT count(*) FROM balanca b WHERE b.empresa_id = p_empresa),
      (SELECT count(*) FROM peso_padrao p WHERE p.empresa_id = p_empresa),
      (SELECT count(*) FROM certificado ct WHERE ct.empresa_id = p_empresa AND ct.status = 'rascunho'),
      (SELECT count(*) FROM certificado ct WHERE ct.empresa_id = p_empresa AND ct.status = 'aguardando_aprovacao'),
      (SELECT count(*) FROM certificado ct WHERE ct.empresa_id = p_empresa AND ct.status = 'emitido'),
      (SELECT count(*) FROM certificado ct WHERE ct.empresa_id = p_empresa AND ct.status = 'substituido'),
      (SELECT count(*) FROM certificado ct WHERE ct.empresa_id = p_empresa AND ct.status = 'cancelado'),
      (SELECT count(*) FROM cliente_acesso a
         WHERE EXISTS (SELECT 1 FROM cliente c WHERE c.empresa_id = p_empresa
                        AND lower(trim(c.email)) = lower(trim(a.email)))),
      (SELECT count(*) FROM cliente_acesso a
         WHERE a.email_validado AND EXISTS (SELECT 1 FROM cliente c
                WHERE c.empresa_id = p_empresa
                  AND lower(trim(c.email)) = lower(trim(a.email)))),
      (SELECT min(ct.data_calibracao)::date FROM certificado ct
        WHERE ct.empresa_id = p_empresa AND ct.status = 'emitido'),
      (SELECT max(ct.data_calibracao)::date FROM certificado ct
        WHERE ct.empresa_id = p_empresa AND ct.status = 'emitido');
$function$;
