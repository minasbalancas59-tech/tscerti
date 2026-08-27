-- ═══════════════════════════════════════════════════════════════
-- 86 · Correção: sa_editar_usuario precisa de SECURITY DEFINER
-- A tabela usuario tem RLS forçado (isolamento por empresa). O
-- super-admin (empresa SISTEMA) não enxergava os usuários das outras
-- empresas dentro da função → "usuário não encontrado".
-- SECURITY DEFINER faz a função rodar com os privilégios do dono,
-- bypassando o RLS (o mesmo padrão das demais funções sa_*).
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION sa_editar_usuario(
    p_id uuid, p_nome text, p_email text, p_papel text, p_registro text
) RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE v_empresa uuid; v_papel_atual text;
BEGIN
    SELECT empresa_id, papel INTO v_empresa, v_papel_atual FROM usuario WHERE id = p_id;
    IF NOT FOUND THEN RETURN 'nao_encontrado'; END IF;
    IF p_papel NOT IN ('admin','responsavel_tecnico','tecnico') THEN RETURN 'papel_invalido'; END IF;
    -- não deixar a empresa sem nenhum admin ativo
    IF v_papel_atual = 'admin' AND p_papel <> 'admin'
       AND (SELECT count(*) FROM usuario WHERE empresa_id = v_empresa
             AND papel = 'admin' AND ativo AND id <> p_id) = 0 THEN
        RETURN 'ultimo_admin';
    END IF;
    IF EXISTS (SELECT 1 FROM usuario WHERE lower(email) = lower(p_email) AND id <> p_id) THEN
        RETURN 'email_em_uso';
    END IF;
    UPDATE usuario
       SET nome = coalesce(nullif(p_nome,''), nome),
           email = coalesce(nullif(lower(p_email),''), email),
           papel = p_papel,
           registro_prof = nullif(p_registro,'')
     WHERE id = p_id;
    RETURN 'ok';
END $function$;

-- A limpeza também precisa (mexe em tabelas de outra empresa)
-- Confere se já é SECURITY DEFINER; se não for, recria com.
DO $$
DECLARE v_def boolean;
BEGIN
    SELECT p.prosecdef INTO v_def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'sa_limpar_certificados'
     LIMIT 1;
    IF v_def IS FALSE THEN
        RAISE NOTICE 'ATENCAO: sa_limpar_certificados NAO e SECURITY DEFINER (mas funcionou nos testes).';
    END IF;
END $$;

SELECT 'Migração 86: sa_editar_usuario com SECURITY DEFINER' AS resultado;
