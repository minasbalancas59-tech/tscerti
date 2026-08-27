#!/bin/bash
# ══ PESQUISA DO TSCERT — parte 2: endpoints (SA + público) ══
set -e
cd /root/cert-saas
python3 - <<'PY'
p = 'src/Api/Sistema/SuperAdminEndpoints.cs'
s = open(p, encoding='utf-8').read()
if 'psaas' in s:
    print('API: JA APLICADO'); raise SystemExit

v = '        // ── Log de consultas por QR code (com filtros) ──'
assert v in s and s.count(v) == 1, 'ANCORA sa'
novo = '''        // ══ PESQUISA DO TSCERT (produto) — super admin ══════════
        g.MapGet("/psaas", async (ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            var resumo = await conn.QuerySingleOrDefaultAsync("SELECT * FROM psaas_resumo()");
            var usuarios = await conn.QueryAsync("SELECT * FROM psaas_usuarios_alvo()");
            var respostas = await conn.QueryAsync("SELECT * FROM psaas_respostas_lista()");
            var cfg = await conn.QuerySingleOrDefaultAsync("SELECT * FROM psaas_config WHERE id");
            var perguntas = await conn.QueryAsync(
                "SELECT id, papel, texto, tipo, ordem, ativa FROM psaas_pergunta ORDER BY papel, ordem");
            return Results.Ok(new { resumo, usuarios, respostas, cfg, perguntas });
        });

        g.MapPut("/psaas/config", async (JsonElement body, ClaimsPrincipal user,
            NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            string? Txt(string k) => body.TryGetProperty(k, out var v2)
                && v2.ValueKind == JsonValueKind.String ? v2.GetString() : null;
            await conn.ExecuteAsync("""
                UPDATE psaas_config SET
                    ativo = @ativo, freq_dias = @freq, dias_ativo = @diasAtivo,
                    alerta_email = @alerta, convite_titulo = @titulo, convite_texto = @texto
                 WHERE id
                """, new {
                    ativo = body.GetProperty("ativo").GetBoolean(),
                    freq = body.GetProperty("freqDias").GetInt32(),
                    diasAtivo = body.TryGetProperty("diasAtivo", out var da) ? da.GetInt32() : 30,
                    alerta = Txt("alertaEmail"), titulo = Txt("conviteTitulo"), texto = Txt("conviteTexto") });
            return Results.Ok(new { ok = true });
        });

        // Envio manual: lista de usuários selecionados
        g.MapPost("/psaas/enviar", async (JsonElement body, ClaimsPrincipal user,
            NpgsqlDataSource ds, IConnectionMultiplexer redis) =>
        {
            if (!Ok(user)) return Results.Forbid();
            var ids = body.GetProperty("usuarios").EnumerateArray()
                .Select(x => Guid.Parse(x.GetString()!)).Distinct().ToList();
            if (ids.Count == 0) return Results.BadRequest(new { erro = "Selecione ao menos um usuário." });
            if (ids.Count > 100) return Results.BadRequest(new { erro = "Máximo de 100 por envio." });
            await redis.GetDatabase().ListLeftPushAsync("fila:tarefas",
                System.Text.Json.JsonSerializer.Serialize(new {
                    tipo = "psaas_enviar",
                    usuarios = ids.Select(i => i.ToString()).ToList(), modo = "manual" }));
            return Results.Ok(new { enfileirado = ids.Count });
        });

''' + v
s = s.replace(v, novo, 1)
open(p, 'w', encoding='utf-8').write(s)
print('API SA: APLICADO')

# ── endpoints públicos (mesmo arquivo da pesquisa do cliente) ──
p = 'src/Api/Pesquisa/PesquisaEndpoints.cs'
s = open(p, encoding='utf-8').read()
if 'psaas-publica' in s:
    print('API publica: JA APLICADO')
else:
    v = '        app.MapGet("/api/pesquisa-publica/{token}"'
    assert v in s and s.count(v) == 1, 'ANCORA publica'
    novo = '''        // ══ Pesquisa do TSCERT (produto) — pública, por token ══
        app.MapGet("/api/psaas-publica/{token}", async (string token, NpgsqlDataSource ds) =>
        {
            await using var conn = await ds.OpenConnectionAsync();
            var e = await conn.QuerySingleOrDefaultAsync("SELECT * FROM psaas_por_token(@t)",
                new { t = token });
            if (e is null) return Results.NotFound();
            var perguntas = await conn.QueryAsync(
                "SELECT * FROM psaas_perguntas_do_papel(@p)", new { p = (string)e.papel });
            var intro = await conn.ExecuteScalarAsync<string?>(
                "SELECT convite_texto FROM psaas_config WHERE id");
            return Results.Ok(new { nome = e.nome, empresa = e.empresa, papel = e.papel,
                respondido = e.respondido, perguntas, intro });
        });

        app.MapPost("/api/psaas-publica/{token}", async (string token, JsonElement body,
            NpgsqlDataSource ds, IConnectionMultiplexer redis) =>
        {
            await using var conn = await ds.OpenConnectionAsync();
            var json = body.GetProperty("respostas").GetRawText();
            var r = await conn.QuerySingleOrDefaultAsync(
                "SELECT * FROM psaas_gravar(@t, @r::jsonb)", new { t = token, r = json });
            if (r is null || !(bool)r.ok) return Results.BadRequest(new { erro = "Link inválido ou já respondido." });
            // Detrator (nota <= 6): avisa na hora
            if (r.nps is int n && n <= 6)
                await redis.GetDatabase().ListLeftPushAsync("fila:tarefas",
                    System.Text.Json.JsonSerializer.Serialize(new {
                        tipo = "psaas_alerta_detrator", nome = (string?)r.nome,
                        empresa = (string?)r.empresa, papel = (string?)r.papel, nota = n }));
            return Results.Ok(new { ok = true });
        });

''' + v
    s = s.replace(v, novo, 1)
    if 'using System.Text.Json;' not in s: s = 'using System.Text.Json;\n' + s
    if 'using StackExchange.Redis;' not in s: s = 'using StackExchange.Redis;\n' + s
    open(p, 'w', encoding='utf-8').write(s)
    print('API publica: APLICADO')
PY

# rota amigável /pesquisa-tscert/{token} → página
python3 - <<'PY'
import os
p = 'src/Api/Program.cs'
if not os.path.exists(p):
    print('Program.cs da API nao encontrado — pulando rota amigavel'); raise SystemExit
s = open(p, encoding='utf-8').read()
if 'pesquisa-tscert' in s:
    print('rota: JA APLICADO'); raise SystemExit
import re
m = re.search(r'\napp\.Run\(\);', s)
assert m, 'app.Run() nao encontrado'
rota = '''
// Página da pesquisa do TSCert (produto), acessada pelo token do convite
app.MapGet("/pesquisa-tscert/{token}", (string token) =>
    Results.File("wwwroot/psaas.html", "text/html"));
'''
s = s[:m.start()] + rota + s[m.start():]
open(p, 'w', encoding='utf-8').write(s)
print('rota amigavel: APLICADA')
PY
echo
echo "── rebuild ──"
docker compose up -d --build api && ./backup-projeto.sh
