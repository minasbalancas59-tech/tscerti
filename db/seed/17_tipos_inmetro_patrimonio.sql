-- ================================================================
-- Tipos de balança (cadastro) + campos Inmetro e patrimônio
--   docker compose exec -T db psql -U certsaas -d certsaas < db/seed/17_tipos_inmetro_patrimonio.sql
-- ================================================================

-- Cadastro de tipos de balança (por empresa, texto livre)
CREATE TABLE IF NOT EXISTS tipo_balanca (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id  uuid NOT NULL REFERENCES empresa(id),
    nome        text NOT NULL,
    ativo       boolean NOT NULL DEFAULT true,
    criado_em   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (empresa_id, nome)
);

ALTER TABLE tipo_balanca ENABLE ROW LEVEL SECURITY;
ALTER TABLE tipo_balanca FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tipo_balanca;
CREATE POLICY tenant_isolation ON tipo_balanca
    USING (empresa_id = current_empresa_id())
    WITH CHECK (empresa_id = current_empresa_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON tipo_balanca TO api_app;

-- Novos campos na balança
ALTER TABLE balanca
    ADD COLUMN IF NOT EXISTS numero_inmetro text,
    ADD COLUMN IF NOT EXISTS patrimonio     text;

-- O 'tipo' já existe como text; agora é preenchido livremente
-- (ou a partir do cadastro tipo_balanca). Mantemos a coluna como está.
-- A checagem antiga de valores fixos precisa sair, se existir:
ALTER TABLE balanca DROP CONSTRAINT IF EXISTS balanca_tipo_check;

-- Semear os tipos que já eram fixos, pra cada empresa existente
INSERT INTO tipo_balanca (empresa_id, nome)
SELECT e.id, t.nome
  FROM empresa e
  CROSS JOIN (VALUES ('Rodoviária'),('Plataforma'),('Bancada'),
                     ('Suspensa'),('Ferroviária')) AS t(nome)
ON CONFLICT (empresa_id, nome) DO NOTHING;

SELECT 'tipos de balança, número Inmetro e patrimônio adicionados' AS resultado;
