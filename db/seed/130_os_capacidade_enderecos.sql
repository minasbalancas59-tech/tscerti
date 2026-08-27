-- 130: três pedidos do campo
--   (a) ORDEM DE SERVIÇO no certificado (não sai no PDF; serve para buscar)
--   (b) ENDEREÇOS ADICIONAIS do cliente (escolhido na calibração)
--   (c) base para a trava de carga acima da capacidade (só validação, sem schema)
BEGIN;

-- ── (a) Ordem de serviço ───────────────────────────────────
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS ordem_servico text;
CREATE INDEX IF NOT EXISTS idx_cert_os
    ON certificado (empresa_id, ordem_servico)
    WHERE ordem_servico IS NOT NULL;
-- busca por trecho da OS (o técnico digita "1234" e acha "OS-1234/26")
CREATE INDEX IF NOT EXISTS idx_cert_os_trgm
    ON certificado (empresa_id, lower(ordem_servico))
    WHERE ordem_servico IS NOT NULL;

-- ── (b) Endereços do cliente ───────────────────────────────
-- O endereço principal continua em cliente.endereco (nada muda para quem tem
-- um só). Esta tabela guarda os ADICIONAIS: filiais, unidades, plantas.
CREATE TABLE IF NOT EXISTS cliente_endereco (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id  uuid NOT NULL REFERENCES empresa(id),
    cliente_id  uuid NOT NULL REFERENCES cliente(id) ON DELETE CASCADE,
    apelido     text NOT NULL,              -- "Matriz", "Filial Betim", "Planta 2"
    endereco    text,
    cidade      text,
    uf          char(2),
    cep         text,
    observacao  text,
    ativo       boolean NOT NULL DEFAULT true,
    criado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cliente_endereco ON cliente_endereco (cliente_id, apelido);

ALTER TABLE cliente_endereco ENABLE ROW LEVEL SECURITY;
ALTER TABLE cliente_endereco FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON cliente_endereco;
CREATE POLICY tenant_isolation ON cliente_endereco
    USING (empresa_id = current_empresa_id())
    WITH CHECK (empresa_id = current_empresa_id());

-- o certificado guarda QUAL endereço foi usado (texto congelado + referência)
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS cliente_endereco_id uuid
    REFERENCES cliente_endereco(id);
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS endereco_calibracao text;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'api_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE cliente_endereco TO api_app;
    END IF;
END $$;

-- Endereços do cliente: o principal (do cadastro) + os adicionais.
-- Devolve SEMPRE o principal na primeira posição.
CREATE OR REPLACE FUNCTION public.cliente_enderecos(p_cliente uuid)
 RETURNS TABLE(id uuid, apelido text, endereco text, cidade text, uf text,
               cep text, principal boolean, texto text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
    SELECT NULL::uuid, 'Endereço do cadastro'::text, c.endereco, c.cidade,
           c.uf::text, c.cep, true,
           NULLIF(concat_ws(' · ', NULLIF(c.endereco,''),
                  NULLIF(concat_ws('/', NULLIF(c.cidade,''), NULLIF(c.uf::text,'')), '')), '')
      FROM cliente c WHERE c.id = p_cliente
    UNION ALL
    SELECT ce.id, ce.apelido, ce.endereco, ce.cidade, ce.uf::text, ce.cep, false,
           NULLIF(concat_ws(' · ', NULLIF(ce.endereco,''),
                  NULLIF(concat_ws('/', NULLIF(ce.cidade,''), NULLIF(ce.uf::text,'')), '')), '')
      FROM cliente_endereco ce
     WHERE ce.cliente_id = p_cliente AND ce.ativo
     ORDER BY 7 DESC, 2;
$function$;

COMMIT;

\echo '--- prova ---'
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'certificado'
   AND column_name IN ('ordem_servico','cliente_endereco_id','endereco_calibracao')
 ORDER BY 1;
SELECT apelido, texto FROM cliente_enderecos((SELECT id FROM cliente LIMIT 1));
