#!/bin/bash
# ══ Permissões do técnico: criar cliente / criar equipamento ══
# (João, 19/08/2026) Só CRIAR — editar e excluir seguem com admin/RT.
set -e
cd /root/cert-saas
docker compose exec -T db psql -U certsaas -d certsaas <<'SQL'
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS pode_criar_cliente boolean NOT NULL DEFAULT false;
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS pode_criar_balanca boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN usuario.pode_criar_cliente IS
  'Técnico pode CRIAR clientes (não edita nem exclui). Admin/RT sempre podem.';
COMMENT ON COLUMN usuario.pode_criar_balanca IS
  'Técnico pode CRIAR balanças (não edita nem exclui). Admin/RT sempre podem.';
SQL
echo "✓ colunas criadas"

python3 - <<'PY'
# ── helper no Tenant ──
import glob, re
alvo = None
for p in glob.glob('src/Api/Infra/*.cs'):
    s = open(p, encoding='utf-8').read()
    if 'public static bool EhGestor' in s:
        alvo = p; break
assert alvo, 'Tenant/EhGestor nao encontrado'
s = open(alvo, encoding='utf-8').read()
if 'PodeCriarCliente' in s:
    print('Tenant: JA APLICADO')
else:
    m = re.search(r'    public static bool EhGestor\(ClaimsPrincipal user\)[^\n]*\n(?:[^\n]*\n)?', s)
    assert m, 'assinatura do EhGestor nao localizada'
    novo = '''
    /// <summary>Gestor sempre pode; técnico depende da permissão no cadastro
    /// (João, 19/08/2026). Só CRIAR — editar/excluir seguem restritos.</summary>
    public static async Task<bool> PodeCriarCliente(NpgsqlConnection conn, ClaimsPrincipal user)
    {
        if (EhGestor(user)) return true;
        return await conn.ExecuteScalarAsync<bool>(
            "SELECT COALESCE(pode_criar_cliente, false) FROM usuario WHERE id = @id",
            new { id = UsuarioId(user) });
    }

    public static async Task<bool> PodeCriarBalanca(NpgsqlConnection conn, ClaimsPrincipal user)
    {
        if (EhGestor(user)) return true;
        return await conn.ExecuteScalarAsync<bool>(
            "SELECT COALESCE(pode_criar_balanca, false) FROM usuario WHERE id = @id",
            new { id = UsuarioId(user) });
    }
'''
    s = s[:m.end()] + novo + s[m.end():]
    if 'using Dapper;' not in s: s = 'using Dapper;\n' + s
    if 'using Npgsql;' not in s: s = 'using Npgsql;\n' + s
    open(alvo, 'w', encoding='utf-8').write(s)
    print('Tenant: helpers adicionados em', alvo)

# ── criação de CLIENTE aceita técnico com permissão ──
p = 'src/Api/Clientes/ClienteEndpoints.cs'
s = open(p, encoding='utf-8').read()
if 'PodeCriarCliente' in s:
    print('ClienteEndpoints: JA APLICADO')
else:
    i = s.find('g.MapPost("/", async (ClienteRequest req, ClaimsPrincipal user,')
    assert i > 0, 'MapPost de cliente nao encontrado'
    j = s.find('if (!Tenant.EhGestor(user)) return Results.Forbid();', i)
    assert j > 0 and j - i < 900, 'guarda do MapPost nao localizada'
    fim = j + len('if (!Tenant.EhGestor(user)) return Results.Forbid();')
    conn_pos = s.find('await using var conn = await Tenant.AbrirConexao(ds, user);', fim)
    assert conn_pos > 0, 'abertura de conexao nao encontrada'
    conn_fim = conn_pos + len('await using var conn = await Tenant.AbrirConexao(ds, user);')
    s = (s[:j] + '// gestor OU técnico com permissão de criar cliente'
         + s[fim:conn_fim]
         + '\n            if (!await Tenant.PodeCriarCliente(conn, user)) return Results.Forbid();'
         + s[conn_fim:])
    open(p, 'w', encoding='utf-8').write(s)
    print('ClienteEndpoints: APLICADO')

# ── criação de BALANÇA ──
p = 'src/Api/Balancas/BalancaEndpoints.cs'
s = open(p, encoding='utf-8').read()
if 'PodeCriarBalanca' in s:
    print('BalancaEndpoints: JA APLICADO')
else:
    i = s.find('porCliente.MapPost("/", async (Guid clienteId, BalancaRequest req,')
    assert i > 0, 'MapPost de balanca nao encontrado'
    j = s.find('if (!Tenant.EhGestor(user)) return Results.Forbid();', i)
    if j > 0 and j - i < 900:
        fim = j + len('if (!Tenant.EhGestor(user)) return Results.Forbid();')
        conn_pos = s.find('await using var conn = await Tenant.AbrirConexao(ds, user);', fim)
        conn_fim = conn_pos + len('await using var conn = await Tenant.AbrirConexao(ds, user);')
        s = (s[:j] + '// gestor OU técnico com permissão de criar equipamento'
             + s[fim:conn_fim]
             + '\n            if (!await Tenant.PodeCriarBalanca(conn, user)) return Results.Forbid();'
             + s[conn_fim:])
        open(p, 'w', encoding='utf-8').write(s)
        print('BalancaEndpoints: APLICADO')
    else:
        print('BalancaEndpoints: sem guarda EhGestor no POST (ja permitia tecnico) — nada a fazer')

# ── usuário: grava e devolve as permissões ──
import glob
for p in glob.glob('src/Api/**/UsuarioEndpoints.cs', recursive=True) or glob.glob('src/Api/**/Usuarios*.cs', recursive=True):
    s = open(p, encoding='utf-8').read()
    if 'pode_criar_cliente' in s:
        print(p, ': JA APLICADO'); continue
    mudou = False
    # record
    m = re.search(r'record \w*Usuario\w*Request\(([^)]*)\)', s, re.S)
    if m:
        s = s[:m.end()-1] + ', bool PodeCriarCliente = false, bool PodeCriarBalanca = false' + s[m.end()-1:]
        mudou = True
    # selects
    s2 = re.sub(r'(SELECT id, nome, email, papel)', r'\1, pode_criar_cliente, pode_criar_balanca', s)
    if s2 != s: s, mudou = s2, True
    if mudou:
        open(p, 'w', encoding='utf-8').write(s)
        print(p, ': ajustado (confira o build)')
PY
docker compose exec -T db psql -U certsaas -d certsaas -c "
SELECT nome, papel, pode_criar_cliente, pode_criar_balanca FROM usuario WHERE papel='tecnico' ORDER BY nome;"
echo
docker compose up -d --build api && ./backup-projeto.sh
