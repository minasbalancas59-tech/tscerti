using System.Security.Claims;
using System.Security.Cryptography;
using Amazon.S3;
using Amazon.S3.Model;
using CertSaas.Api.Clientes;
using CertSaas.Api.Infra;
using Dapper;
using Npgsql;
using StackExchange.Redis;

namespace CertSaas.Api.Usuarios;

public record UsuarioRequest(string Nome, string Email, string Papel,
    string? RegistroProf, bool PodeCriarCliente = false, bool PodeCriarBalanca = false);
public record NovoUsuarioRequest(string Nome, string Email, string Papel,
    string? RegistroProf, string? SenhaInicial = null);
public record ResetSenhaRequest(string NovaSenha);
public record AssinaturaRequest(string ImagemBase64);

public static class UsuarioEndpoints
{
    private static readonly string[] Papeis =
        { "admin", "responsavel_tecnico", "tecnico" };

    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/usuarios").RequireAuthorization();

        g.MapGet("/", async (ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Tenant.EhAdmin(user)) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var rows = await conn.QueryAsync("""
                SELECT id, nome, email, papel, pode_criar_cliente, pode_criar_balanca, registro_prof, ativo, criado_em
                  FROM usuario ORDER BY nome
                """);
            return Results.Ok(rows);
        });

        // Equipe da empresa para seletores (admin E responsável técnico).
        // Só o essencial: sem e-mail nem dados sensíveis.
        g.MapGet("/equipe", async (ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            return Results.Ok(await conn.QueryAsync("""
                SELECT u.id, u.nome, u.papel,
                       (u.assinatura_url IS NOT NULL) AS tem_assinatura
                  FROM usuario u
                 WHERE u.ativo AND u.papel IN ('admin', 'responsavel_tecnico', 'tecnico')
                 ORDER BY u.nome
                """));
        });

        g.MapPost("/", async (NovoUsuarioRequest req, ClaimsPrincipal user,
            NpgsqlDataSource ds, HttpContext ctx, IConfiguration cfg,
            IConnectionMultiplexer redis) =>
        {
            if (!Tenant.EhAdmin(user)) return Results.Forbid();
            if (string.IsNullOrWhiteSpace(req.Nome) ||
                string.IsNullOrWhiteSpace(req.Email))
                return Results.BadRequest(new { erro = "Nome e email são obrigatórios." });
            if (!Papeis.Contains(req.Papel))
                return Results.BadRequest(new
                    { erro = $"Papel inválido. Use: {string.Join(", ", Papeis)}." });
            if (req.SenhaInicial is not null && req.SenhaInicial.Length < 8)
                return Results.BadRequest(new { erro = "Senha inicial: mínimo 8 caracteres." });

            await using var conn = await Tenant.AbrirConexao(ds, user);
            var empresaId = Tenant.EmpresaId(user);

            // ── Limite de usuários do plano contratado ──
            var maxUsu = await conn.ExecuteScalarAsync<int?>("""
                SELECT max_usuarios FROM contrato
                 WHERE empresa_id = @empresaId AND ativo
                 ORDER BY criado_em DESC LIMIT 1
                """, new { empresaId });
            if (maxUsu is int limite)
            {
                var ativos = await conn.ExecuteScalarAsync<int>(
                    "SELECT COUNT(*) FROM usuario WHERE ativo");
                if (ativos >= limite)
                    return Results.BadRequest(new { erro =
                        $"Seu plano permite {limite} usuário(s) ativo(s) e todos já estão em uso. " +
                        "Desative um usuário ou fale com a Total Scale para ampliar o plano." });
            }

            // Sem senha informada: fluxo de convite (o usuário define a própria)
            var token = req.SenhaInicial is null ? NovoToken() : null;
            var hashSenha = BCrypt.Net.BCrypt.HashPassword(
                req.SenhaInicial ?? Guid.NewGuid().ToString("N"), 12);
            try
            {
                var id = await conn.ExecuteScalarAsync<Guid>("""
                    INSERT INTO usuario (empresa_id, nome, email, senha_hash,
                                         papel, registro_prof,
                                         token_convite, token_convite_expira)
                    VALUES (@empresaId, @Nome, @email, @hash, @Papel, @RegistroProf,
                            @token, CASE WHEN @token IS NULL THEN NULL
                                         ELSE now() + interval '7 days' END)
                    RETURNING id
                    """, new { empresaId, req.Nome,
                        email = req.Email.Trim().ToLowerInvariant(),
                        hash = hashSenha, req.Papel, req.RegistroProf, token });

                await Auditoria.Registrar(conn, empresaId, Tenant.UsuarioId(user),
                    "usuario", id, "insert",
                    new { req.Nome, req.Email, req.Papel }, Auditoria.Ip(ctx));

                string? link = null;
                if (token is not null)
                {
                    link = LinkConvite(cfg, token);
                    await redis.GetDatabase().ListLeftPushAsync("fila:tarefas",
                        $"{{\"tipo\":\"email_convite\",\"usuario_id\":\"{id}\"}}");
                }
                return Results.Created($"/api/usuarios/{id}", new { id, linkConvite = link });
            }
            catch (PostgresException e) when (e.SqlState == "23505")
            {
                return Results.Conflict(new { erro = "Já existe usuário com esse email." });
            }
        });

        g.MapPut("/{id:guid}", async (Guid id, UsuarioRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds, HttpContext ctx) =>
        {
            if (!Tenant.EhAdmin(user)) return Results.Forbid();
            if (!Papeis.Contains(req.Papel))
                return Results.BadRequest(new { erro = "Papel inválido." });

            await using var conn = await Tenant.AbrirConexao(ds, user);
            var n = await conn.ExecuteAsync("""
                UPDATE usuario SET nome = @Nome,
                       email = @email, papel = @Papel, registro_prof = @RegistroProf,
                       pode_criar_cliente = @PodeCriarCliente,
                       pode_criar_balanca = @PodeCriarBalanca
                 WHERE id = @id
                """, new { id, req.Nome,
                    email = req.Email.Trim().ToLowerInvariant(),
                    req.Papel, req.RegistroProf,
                    req.PodeCriarCliente, req.PodeCriarBalanca });
            if (n == 0) return Results.NotFound();

            await Auditoria.Registrar(conn, Tenant.EmpresaId(user),
                Tenant.UsuarioId(user), "usuario", id, "update", req, Auditoria.Ip(ctx));
            return Results.Ok(new { id });
        });

        g.MapPut("/{id:guid}/senha", async (Guid id, ResetSenhaRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds, HttpContext ctx) =>
        {
            if (!Tenant.EhAdmin(user)) return Results.Forbid();
            if (req.NovaSenha.Length < 8)
                return Results.BadRequest(new { erro = "Senha: mínimo 8 caracteres." });

            await using var conn = await Tenant.AbrirConexao(ds, user);
            var n = await conn.ExecuteAsync(
                "UPDATE usuario SET senha_hash = @hash WHERE id = @id",
                new { id, hash = BCrypt.Net.BCrypt.HashPassword(req.NovaSenha, 12) });
            if (n == 0) return Results.NotFound();

            await Auditoria.Registrar(conn, Tenant.EmpresaId(user),
                Tenant.UsuarioId(user), "usuario", id, "reset_senha", null,
                Auditoria.Ip(ctx));
            return Results.Ok(new { id });
        });

        g.MapPut("/{id:guid}/ativo", async (Guid id, AtivoRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds, HttpContext ctx) =>
        {
            if (!Tenant.EhAdmin(user)) return Results.Forbid();
            if (id == Tenant.UsuarioId(user) && !req.Ativo)
                return Results.BadRequest(new { erro = "Você não pode inativar a si mesmo." });

            await using var conn = await Tenant.AbrirConexao(ds, user);
            var n = await conn.ExecuteAsync(
                "UPDATE usuario SET ativo = @ativo WHERE id = @id",
                new { id, ativo = req.Ativo });
            if (n == 0) return Results.NotFound();

            await Auditoria.Registrar(conn, Tenant.EmpresaId(user),
                Tenant.UsuarioId(user), "usuario", id,
                req.Ativo ? "reativar" : "inativar", null, Auditoria.Ip(ctx));
            return Results.Ok(new { id, req.Ativo });
        });

        // ── (Re)enviar convite: gera novo token e envia o email ──
        // Usado tanto para reenviar o convite quanto para "resetar a
        // senha" — o usuário define a nova senha pelo link.
        g.MapPost("/{id:guid}/convite", async (Guid id, ClaimsPrincipal user,
            NpgsqlDataSource ds, HttpContext ctx, IConfiguration cfg,
            IConnectionMultiplexer redis) =>
        {
            if (!Tenant.EhAdmin(user)) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var token = NovoToken();
            var n = await conn.ExecuteAsync("""
                UPDATE usuario
                   SET token_convite = @token,
                       token_convite_expira = now() + interval '7 days'
                 WHERE id = @id AND ativo
                """, new { id, token });
            if (n == 0) return Results.NotFound();

            await Auditoria.Registrar(conn, Tenant.EmpresaId(user),
                Tenant.UsuarioId(user), "usuario", id, "enviar_convite", null,
                Auditoria.Ip(ctx));
            await redis.GetDatabase().ListLeftPushAsync("fila:tarefas",
                $"{{\"tipo\":\"email_convite\",\"usuario_id\":\"{id}\"}}");
            return Results.Ok(new { linkConvite = LinkConvite(cfg, token) });
        });

        // ── Minha assinatura (desenho do canvas OU upload) ──────
        // Recebe a imagem PNG (base64) e guarda no MinIO, vinculada
        // ao próprio usuário logado. Vale para todos os certificados
        // que ele assinar dali em diante.
        g.MapPut("/eu/assinatura", async (AssinaturaRequest req, ClaimsPrincipal user,
            NpgsqlDataSource ds, IConfiguration cfg) =>
        {
            if (string.IsNullOrWhiteSpace(req.ImagemBase64))
                return Results.BadRequest(new { erro = "Assinatura vazia." });
            // Aceita "data:image/png;base64,XXXX" ou só o base64
            var b64 = req.ImagemBase64;
            var virgula = b64.IndexOf(',');
            if (b64.StartsWith("data:") && virgula > 0) b64 = b64[(virgula + 1)..];
            byte[] bytes;
            try { bytes = Convert.FromBase64String(b64); }
            catch { return Results.BadRequest(new { erro = "Imagem inválida." }); }
            if (bytes.Length > 1_000_000)
                return Results.BadRequest(new { erro = "Assinatura muito grande (máx. 1 MB)." });

            var uid = Tenant.UsuarioId(user);
            var chave = $"assinaturas/{uid}.png";
            var s3 = ClienteS3(cfg);
            var bucket = cfg["S3:Bucket"] ?? "certificados";
            await GarantirBucketS3(s3, bucket);
            using (var up = new MemoryStream(bytes))
                await s3.PutObjectAsync(new PutObjectRequest
                {
                    BucketName = bucket, Key = chave, InputStream = up, ContentType = "image/png"
                });

            await using var conn = await Tenant.AbrirConexao(ds, user);
            await conn.ExecuteAsync(
                "UPDATE usuario SET assinatura_url=@url WHERE id=@uid",
                new { url = $"s3://{bucket}/{chave}", uid });
            return Results.Ok(new { salvo = true });
        }).DisableAntiforgery();

        // Servir a minha assinatura (para pré-visualizar na tela)
        g.MapGet("/eu/assinatura", async (ClaimsPrincipal user, NpgsqlDataSource ds,
            IConfiguration cfg) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var url = await conn.ExecuteScalarAsync<string?>(
                "SELECT assinatura_url FROM usuario WHERE id=@uid",
                new { uid = Tenant.UsuarioId(user) });
            if (string.IsNullOrEmpty(url)) return Results.NotFound();
            var semPrefixo = url.Replace("s3://", "");
            var barra = semPrefixo.IndexOf('/');
            var s3 = ClienteS3(cfg);
            try
            {
                using var r = await s3.GetObjectAsync(semPrefixo[..barra], semPrefixo[(barra + 1)..]);
                using var mem = new MemoryStream();
                await r.ResponseStream.CopyToAsync(mem);
                return Results.File(mem.ToArray(), "image/png");
            }
            catch (AmazonS3Exception) { return Results.NotFound(); }
        });
    }

    private static string NovoToken() =>
        Convert.ToHexString(RandomNumberGenerator.GetBytes(24)).ToLowerInvariant();

    private static string LinkConvite(IConfiguration cfg, string token) =>
        $"{cfg["App:UrlBase"] ?? "https://certificados.minasbalancas.com.br"}/#convite={token}";

    private static AmazonS3Client ClienteS3(IConfiguration cfg) =>
        new(cfg["S3:AccessKey"], cfg["S3:SecretKey"], new AmazonS3Config
        {
            ServiceURL = cfg["S3:Endpoint"] ?? "http://minio:9000",
            ForcePathStyle = true, AuthenticationRegion = "us-east-1"
        });

    private static async Task GarantirBucketS3(AmazonS3Client s3, string bucket)
    {
        try
        {
            if (!await Amazon.S3.Util.AmazonS3Util.DoesS3BucketExistV2Async(s3, bucket))
                await s3.PutBucketAsync(new PutBucketRequest { BucketName = bucket });
        }
        catch { /* bucket provavelmente já existe */ }
    }
}
