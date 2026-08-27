using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using Amazon.S3;
using CertSaas.Api.Infra;
using Dapper;
using Npgsql;
using StackExchange.Redis;

namespace CertSaas.Api.Pesquisa;

public record PesquisaConfigRequest(bool Ativa, int FreqDias, bool Anonima);
public record PerguntaRequest(string Texto, string Tipo, int Ordem);
public record EnvioManualRequest(Guid? ClienteId);
public record PesquisaTesteRequest(string Email);
public record ResponderRequest(List<RespostaItem> Respostas, string? Comentario);
public record RespostaItem(Guid PerguntaId, int Nota);

public static class PesquisaEndpoints
{
    public static void Map(WebApplication app)
    {
        // ══ Configuração e perguntas (admin/RT) ═══════════════════
        var g = app.MapGroup("/api/pesquisa").RequireAuthorization();

        // Config
        g.MapGet("/config", async (ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var c = await conn.QuerySingleOrDefaultAsync(
                @"SELECT pesquisa_ativa AS ativa, pesquisa_freq_dias AS freqDias,
                         pesquisa_anonima AS anonima FROM empresa WHERE id = @id",
                new { id = Tenant.EmpresaId(user) });
            return Results.Ok(c);
        });

        g.MapPut("/config", async (PesquisaConfigRequest req, ClaimsPrincipal user,
            NpgsqlDataSource ds, HttpContext ctx) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            Tenant.GarantirNaoVisualizando(user);
            if (req.FreqDias < 1) return Results.BadRequest(new { erro = "Periodicidade inválida." });
            await using var conn = await Tenant.AbrirConexao(ds, user);
            await conn.ExecuteAsync(
                @"UPDATE empresa SET pesquisa_ativa = @Ativa, pesquisa_freq_dias = @FreqDias,
                         pesquisa_anonima = @Anonima WHERE id = @id",
                new { req.Ativa, req.FreqDias, req.Anonima, id = Tenant.EmpresaId(user) });
            await Auditoria.Registrar(conn, Tenant.EmpresaId(user), Tenant.UsuarioId(user),
                "empresa", Tenant.EmpresaId(user), "config_pesquisa", req, Auditoria.Ip(ctx));
            return Results.Ok(new { ok = true });
        });

        // Listar perguntas
        g.MapGet("/perguntas", async (ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var rows = await conn.QueryAsync(
                @"SELECT id, texto, tipo, ordem, ativa FROM pesquisa_pergunta
                   WHERE empresa_id = @id ORDER BY ordem",
                new { id = Tenant.EmpresaId(user) });
            return Results.Ok(rows);
        });

        // Criar pergunta
        g.MapPost("/perguntas", async (PerguntaRequest req, ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            Tenant.GarantirNaoVisualizando(user);
            if (string.IsNullOrWhiteSpace(req.Texto)) return Results.BadRequest(new { erro = "Texto obrigatório." });
            var tipo = req.Tipo == "nps" ? "nps" : "nota";
            await using var conn = await Tenant.AbrirConexao(ds, user);
            // Só pode existir 1 pergunta NPS por empresa
            if (tipo == "nps")
            {
                var jaTem = await conn.ExecuteScalarAsync<bool>(
                    @"SELECT EXISTS(SELECT 1 FROM pesquisa_pergunta
                        WHERE empresa_id = @id AND tipo = 'nps' AND ativa)",
                    new { id = Tenant.EmpresaId(user) });
                if (jaTem) return Results.BadRequest(new { erro = "Já existe uma pergunta NPS principal. Edite a existente." });
            }
            var id = await conn.ExecuteScalarAsync<Guid>(
                @"INSERT INTO pesquisa_pergunta (empresa_id, texto, tipo, ordem)
                  VALUES (@emp, @Texto, @tipo, @Ordem) RETURNING id",
                new { emp = Tenant.EmpresaId(user), req.Texto, tipo, req.Ordem });
            return Results.Ok(new { id });
        });

        // Editar pergunta
        g.MapPut("/perguntas/{id:guid}", async (Guid id, PerguntaRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            Tenant.GarantirNaoVisualizando(user);
            await using var conn = await Tenant.AbrirConexao(ds, user);
            await conn.ExecuteAsync(
                @"UPDATE pesquisa_pergunta SET texto = @Texto, ordem = @Ordem
                   WHERE id = @id AND empresa_id = @emp",
                new { id, req.Texto, req.Ordem, emp = Tenant.EmpresaId(user) });
            return Results.Ok(new { ok = true });
        });

        // Remover (desativar) pergunta
        g.MapDelete("/perguntas/{id:guid}", async (Guid id, ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            Tenant.GarantirNaoVisualizando(user);
            await using var conn = await Tenant.AbrirConexao(ds, user);
            await conn.ExecuteAsync(
                @"UPDATE pesquisa_pergunta SET ativa = false WHERE id = @id AND empresa_id = @emp",
                new { id, emp = Tenant.EmpresaId(user) });
            return Results.Ok(new { ok = true });
        });

        // ══ Envio manual ═════════════════════════════════════════
        g.MapPost("/enviar", async (EnvioManualRequest req, ClaimsPrincipal user,
            NpgsqlDataSource ds, IConnectionMultiplexer redis) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            Tenant.GarantirNaoVisualizando(user);
            await redis.GetDatabase().ListLeftPushAsync("fila:tarefas",
                JsonSerializer.Serialize(new
                {
                    tipo = "pesquisa_manual",
                    empresa_id = Tenant.EmpresaId(user).ToString(),
                    cliente_id = req.ClienteId?.ToString()
                }));
            return Results.Ok(new { enfileirado = true });
        });

        // Prévia: clientes que receberiam a pesquisa (têm e-mail)
        g.MapGet("/previa", async (ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var rows = await conn.QueryAsync(
                @"SELECT id AS cliente_id, razao_social AS cliente, email
                    FROM cliente WHERE ativo ORDER BY razao_social");
            return Results.Ok(rows);
        });

        // Enviar um E-MAIL DE TESTE da pesquisa (para conferir visual/chegada).
        // O envio é marcado como modo='teste' e não entra nas estatísticas.
        g.MapPost("/teste", async (PesquisaTesteRequest req, ClaimsPrincipal user,
            IConnectionMultiplexer redis) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            Tenant.GarantirNaoVisualizando(user);
            var email = (req.Email ?? "").Trim();
            if (!email.Contains('@') || email.Length < 5)
                return Results.BadRequest(new { erro = "Informe um e-mail válido." });
            await redis.GetDatabase().ListLeftPushAsync("fila:tarefas",
                JsonSerializer.Serialize(new
                {
                    tipo = "pesquisa_teste",
                    empresa_id = Tenant.EmpresaId(user).ToString(),
                    email
                }));
            return Results.Ok(new { enfileirado = true });
        });

        // Gera um link de PRÉVIA da pesquisa (token modo='teste'): abre a
        // página pública REAL, com as perguntas atuais, sem afetar o NPS.
        g.MapPost("/previa-link", async (ClaimsPrincipal user, NpgsqlDataSource ds,
            IConfiguration config) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var temPergunta = await conn.ExecuteScalarAsync<bool>(
                @"SELECT EXISTS(SELECT 1 FROM pesquisa_pergunta
                    WHERE empresa_id = @id AND ativa)", new { id = Tenant.EmpresaId(user) });
            if (!temPergunta)
                return Results.BadRequest(new { erro = "Cadastre ao menos uma pergunta antes de ver a prévia." });
            var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(24)).ToLowerInvariant();
            await conn.ExecuteAsync(
                @"INSERT INTO pesquisa_envio (empresa_id, cliente_id, token, modo)
                  VALUES (@emp, NULL, @token, 'teste')",
                new { emp = Tenant.EmpresaId(user), token });
            var baseUrl = config["App:PortalUrl"] ?? "https://portalclientes.totalscale.com.br";
            return Results.Ok(new { link = $"{baseUrl}/pesquisa.html?t={token}" });
        });

        // Últimos envios (acompanhamento na própria tela de configuração)
        g.MapGet("/envios", async (ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var rows = await conn.QueryAsync(
                @"SELECT e.enviado_em, e.modo, e.respondido_em, e.nps_nota,
                         c.razao_social AS cliente
                    FROM pesquisa_envio e
                    LEFT JOIN cliente c ON c.id = e.cliente_id
                   WHERE e.empresa_id = @id
                   ORDER BY e.enviado_em DESC LIMIT 20",
                new { id = Tenant.EmpresaId(user) });
            return Results.Ok(rows);
        });

        // ══ Dashboard (admin/RT) ══════════════════════════════════
        g.MapGet("/dashboard", async (DateTime? de, DateTime? ate,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var resumo = await conn.QuerySingleOrDefaultAsync(
                "SELECT * FROM pesquisa_nps_resumo(@de, @ate)", new { de, ate });
            var evolucao = await conn.QueryAsync(
                "SELECT * FROM pesquisa_nps_evolucao(12)");
            var dimensoes = await conn.QueryAsync(
                "SELECT * FROM pesquisa_medias_dimensao(@de, @ate)", new { de, ate });
            return Results.Ok(new { resumo, evolucao, dimensoes });
        });

        // Lista de respostas + exportação
        g.MapGet("/respostas", async (DateTime? de, DateTime? ate, string? formato,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var rows = (await conn.QueryAsync(
                "SELECT * FROM pesquisa_respostas_lista(@de, @ate, 2000)", new { de, ate })).ToList();

            if (formato == "csv" || formato == "pdf")
            {
                var cab = new[] { "Data", "Cliente", "Nota NPS", "Classificação", "Comentário" };
                string[] Campos(dynamic r) => new string[] {
                    CertSaas.Api.Certificados.RelCsv.DHora(r.respondido_em),
                    (bool)r.anonima ? "(anônima)" : ((string?)r.cliente ?? "—"),
                    r.nps_nota?.ToString() ?? "—",
                    ClassificaNps(r.nps_nota), (string?)r.comentario ?? "" };
                var dados = rows.Select(Campos).ToList();
                if (formato == "pdf")
                {
                    var nome = await conn.QuerySingleOrDefaultAsync<string>(
                        "SELECT COALESCE(NULLIF(nome_fantasia,''), razao_social) FROM empresa LIMIT 1") ?? "Relatório";
                    var pesos = new[] { 1.4f, 2.4f, 1f, 1.4f, 4f };
                    var cols = cab.Select((t, i) => new CertSaas.Api.Certificados.RelPdf.Coluna(t, pesos[i])).ToList();
                    var pdf = CertSaas.Api.Certificados.RelPdf.Gerar(nome,
                        "Pesquisa de Satisfação — Respostas", null, cols, dados);
                    return Results.File(pdf, "application/pdf", $"pesquisa_{DateTime.Now:yyyyMMdd}.pdf");
                }
                return CertSaas.Api.Certificados.RelCsv.File(cab,
                    dados.Select(l => CertSaas.Api.Certificados.RelCsv.Join(l)),
                    $"pesquisa_{DateTime.Now:yyyyMMdd}.csv");
            }
            return Results.Ok(rows);
        });

        // Logo da empresa pelo token (para a página pública exibir)
        app.MapGet("/api/pesquisa-logo/{token}", async (string token, NpgsqlDataSource ds,
            IConfiguration cfg) =>
        {
            await using var conn = await ds.OpenConnectionAsync();
            var url = await conn.ExecuteScalarAsync<string?>(
                "SELECT pesquisa_logo_por_token(@t)", new { t = token });
            if (string.IsNullOrEmpty(url)) return Results.NotFound();
            var semPrefixo = url.Replace("s3://", "");
            var barra = semPrefixo.IndexOf('/');
            if (barra <= 0) return Results.NotFound();
            var bucket = semPrefixo[..barra];
            var chave = semPrefixo[(barra + 1)..];
            var s3 = new AmazonS3Client(cfg["S3:AccessKey"], cfg["S3:SecretKey"],
                new AmazonS3Config
                {
                    ServiceURL = cfg["S3:Endpoint"] ?? "http://minio:9000",
                    ForcePathStyle = true, AuthenticationRegion = "us-east-1"
                });
            try
            {
                using var r = await s3.GetObjectAsync(bucket, chave);
                using var mem = new MemoryStream();
                await r.ResponseStream.CopyToAsync(mem);
                return Results.File(mem.ToArray(), r.Headers.ContentType ?? "image/png");
            }
            catch (AmazonS3Exception) { return Results.NotFound(); }
        });

        // ══ Formulário PÚBLICO (sem login, via token) ═════════════
        // Carregar a pesquisa pelo token
        // ══ Pesquisa do TSCERT (produto) — pública, por token ══
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

        app.MapGet("/api/pesquisa-publica/{token}", async (string token, NpgsqlDataSource ds) =>
        {
            await using var conn = await ds.OpenConnectionAsync();
            var p = await conn.QuerySingleOrDefaultAsync(
                "SELECT * FROM pesquisa_por_token(@t)", new { t = token });
            if (p is null) return Results.NotFound(new { erro = "Pesquisa não encontrada." });
            return Results.Ok(p);
        });

        // Responder a pesquisa
        app.MapPost("/api/pesquisa-publica/{token}", async (string token, ResponderRequest req,
            NpgsqlDataSource ds) =>
        {
            await using var conn = await ds.OpenConnectionAsync();
            var respostasJson = JsonSerializer.Serialize(
                req.Respostas.Select(r => new { pergunta_id = r.PerguntaId, nota = r.Nota }));
            var ok = await conn.ExecuteScalarAsync<bool>(
                "SELECT pesquisa_responder(@t, @r::jsonb, @c)",
                new { t = token, r = respostasJson, c = req.Comentario });
            return ok ? Results.Ok(new { ok = true })
                      : Results.BadRequest(new { erro = "Pesquisa já respondida ou inválida." });
        });
    }

    static string ClassificaNps(int? nota) => nota switch
    {
        >= 9 => "Promotor",
        >= 7 => "Neutro",
        >= 0 => "Detrator",
        _ => "—"
    };
}
