-- ═══════════════════════════════════════════════════════════
-- 161 · auth_buscar_usuario() passa a retornar também
-- pode_criar_cliente/pode_criar_balanca.
-- Bug: essas permissões já existiam na tabela usuario e eram
-- salvas corretamente pelo admin (tela Cadastros → Usuários),
-- mas o login nunca as devolvia pro front — o objeto "usuario"
-- guardado no navegador sempre vinha com esses campos undefined,
-- então o botão "+ Cadastrar cliente" nunca aparecia pro
-- técnico no celular, mesmo com a permissão habilitada no banco.
-- Não cria coluna nova, só expõe as que já existem.
-- ═══════════════════════════════════════════════════════════

-- Precisa dropar antes: o tipo de retorno mudou (novas colunas OUT),
-- e CREATE OR REPLACE não permite alterar o shape do retorno.
DROP FUNCTION IF EXISTS public.auth_buscar_usuario(text);

CREATE FUNCTION public.auth_buscar_usuario(p_email text)
 RETURNS TABLE(
    id uuid, empresa_id uuid, nome text, papel text, senha_hash text,
    ativo boolean, empresa text, empresa_status text, motivo_suspensao text,
    tentativas_login integer, bloqueado_login boolean,
    pode_criar_cliente boolean, pode_criar_balanca boolean)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT u.id, u.empresa_id, u.nome, u.papel, u.senha_hash, u.ativo,
           e.razao_social, e.status, e.motivo_suspensao,
           u.tentativas_login, u.bloqueado_login,
           COALESCE(u.pode_criar_cliente, false),
           COALESCE(u.pode_criar_balanca, true)
      FROM usuario u
      JOIN empresa e ON e.id = u.empresa_id
     WHERE lower(u.email) = lower(p_email)
     LIMIT 1
$function$;

SELECT 'auth_buscar_usuario agora retorna permissoes do tecnico' AS resultado;
