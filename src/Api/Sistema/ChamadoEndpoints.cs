using System.Security.Claims;
using Amazon.S3;
using Amazon.S3.Model;
using CertSaas.Api.Infra;
using Dapper;
using Npgsql;
using StackExchange.Redis;

namespace CertSaas.Api.Sistema;

public record NovoChamadoRequest(string Assunto, string Categoria,
    string Prioridade, string Mensagem);
public record MensagemChamadoRequest(string Mensagem);

/// <summary>
/// Chamados de suporte — lado do cliente (tenant). O usuário abre
/// o chamado, conversa e pode fechar. O RLS garante que cada
/// empresa só enxerga os próprios chamados.
/// </summary>
public static class ChamadoEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/chamados").RequireAuthorization();

        // Meus chamados (da empresa)
        g.MapGet("", async (ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            return Results.Ok(await conn.QueryAsync("""
                SELECT c.id, c.numero, c.assunto, c.categoria, c.prioridade,
                       c.status, c.criado_por_nome, c.criado_em, c.atualizado_em,
                       (SELECT count(*) FROM chamado_mensagem m WHERE m.chamado_id = c.id) AS qtd_mensagens
                  FROM chamado c
                 ORDER BY (c.status IN ('aberto','em_atendimento','aguardando_cliente')) DESC,
                          c.atualizado_em DESC
                """));
        });

        // Abrir um chamado
        g.MapPost("", async (NovoChamadoRequest req, ClaimsPrincipal user,
            NpgsqlDataSource ds, HttpContext ctx) =>
        {
            if (string.IsNullOrWhiteSpace(req.Assunto) || string.IsNullOrWhiteSpace(req.Mensagem))
                return Results.BadRequest(new { erro = "Assunto e mensagem são obrigatórios." });
            if (req.Categoria is not ("duvida" or "problema" or "financeiro" or "melhoria" or "outro"))
                return Results.BadRequest(new { erro = "Categoria inválida." });
            if (req.Prioridade is not ("baixa" or "normal" or "alta" or "urgente"))
                return Results.BadRequest(new { erro = "Prioridade inválida." });

            await using var conn = await Tenant.AbrirConexao(ds, user);
            var nome = user.FindFirstValue("nome") ?? user.Identity?.Name ?? "Usuário";
            var (id, numero) = await conn.QuerySingleAsync<(Guid, int)>("""
                INSERT INTO chamado (empresa_id, assunto, categoria, prioridade,
                                     criado_por, criado_por_nome)
                VALUES (current_empresa_id(), @Assunto, @Categoria, @Prioridade,
                        @uid, @nome)
                RETURNING id, numero
                """, new { req.Assunto, req.Categoria, req.Prioridade,
                           uid = Tenant.UsuarioId(user), nome });
            await conn.ExecuteAsync("""
                INSERT INTO chamado_mensagem (chamado_id, empresa_id, autor_tipo, autor_nome, mensagem)
                VALUES (@id, current_empresa_id(), 'cliente', @nome, @Mensagem)
                """, new { id, nome, req.Mensagem });
            await Auditoria.Registrar(conn, Tenant.EmpresaId(user),
                Tenant.UsuarioId(user), "chamado", id, "abrir",
                new { req.Assunto }, Auditoria.Ip(ctx));
            return Results.Ok(new { id, numero });
        });

        // Detalhe + mensagens
        g.MapGet("/{id:guid}", async (Guid id, ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var c = await conn.QuerySingleOrDefaultAsync(
                "SELECT id, numero, assunto, categoria, prioridade, status, criado_em FROM chamado WHERE id = @id",
                new { id });
            if (c is null) return Results.NotFound();
            var msgs = await conn.QueryAsync("""
                SELECT autor_tipo, autor_nome, mensagem, criado_em
                  FROM chamado_mensagem WHERE chamado_id = @id ORDER BY criado_em
                """, new { id });
            return Results.Ok(new { chamado = c, mensagens = msgs });
        });

        // Responder (cliente). Se estava aguardando o cliente, volta para atendimento.
        g.MapPost("/{id:guid}/mensagens", async (Guid id, MensagemChamadoRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds, IConnectionMultiplexer redis) =>
        {
            if (string.IsNullOrWhiteSpace(req.Mensagem))
                return Results.BadRequest(new { erro = "Escreva a mensagem." });
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var nome = user.FindFirstValue("nome") ?? "Usuário";
            var n = await conn.ExecuteAsync("""
                INSERT INTO chamado_mensagem (chamado_id, empresa_id, autor_tipo, autor_nome, mensagem)
                SELECT id, empresa_id, 'cliente', @nome, @Mensagem
                  FROM chamado WHERE id = @id
                """, new { id, nome, req.Mensagem });
            if (n == 0) return Results.NotFound();
            await conn.ExecuteAsync("""
                UPDATE chamado SET atualizado_em = now(),
                       status = CASE WHEN status IN ('aguardando_cliente','resolvido')
                                     THEN 'em_atendimento' ELSE status END
                 WHERE id = @id
                """, new { id });
            // avisa o suporte por e-mail (assíncrono, via fila)
            await redis.GetDatabase().ListLeftPushAsync("fila:tarefas",
                $"{{\"tipo\":\"email_chamado\",\"chamado_id\":\"{id}\",\"destino\":\"suporte\"}}");
            return Results.Ok(new { enviado = true });
        });

        // Fechar o próprio chamado
        g.MapPut("/{id:guid}/fechar", async (Guid id, ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var n = await conn.ExecuteAsync("""
                UPDATE chamado SET status = 'fechado', fechado_em = now(),
                       atualizado_em = now()
                 WHERE id = @id AND status <> 'fechado'
                """, new { id });
            return n > 0 ? Results.Ok(new { fechado = true }) : Results.NotFound();
        });

        // ── Anexar imagem a um chamado ──────────────────────────
        g.MapPost("/{id:guid}/anexos", async (Guid id, HttpRequest http,
            ClaimsPrincipal user, NpgsqlDataSource ds, IConfiguration cfg) =>
        {
            if (!http.HasFormContentType)
                return Results.BadRequest(new { erro = "Envie o arquivo como formulário." });
            var form = await http.ReadFormAsync();
            var arquivo = form.Files["arquivo"];
            if (arquivo is null || arquivo.Length == 0)
                return Results.BadRequest(new { erro = "Nenhum arquivo enviado." });

            // Só imagens, até 5 MB
            var tipo = arquivo.ContentType?.ToLowerInvariant() ?? "";
            if (!tipo.StartsWith("image/"))
                return Results.BadRequest(new { erro = "Apenas imagens são aceitas (PNG, JPG, etc.)." });
            if (arquivo.Length > 5 * 1024 * 1024)
                return Results.BadRequest(new { erro = "A imagem deve ter no máximo 5 MB." });

            await using var conn = await Tenant.AbrirConexao(ds, user);
            var empresaId = Tenant.EmpresaId(user);
            // confirma que o chamado é da empresa (RLS já garante, mas checamos)
            var existe = await conn.ExecuteScalarAsync<bool>(
                "SELECT EXISTS(SELECT 1 FROM chamado WHERE id=@id)", new { id });
            if (!existe) return Results.NotFound();

            var anexoId = Guid.NewGuid();
            var ext = Path.GetExtension(arquivo.FileName);
            var chave = $"chamados/{empresaId}/{id}/{anexoId}{ext}";
            var bucket = cfg["S3:Bucket"] ?? "certificados";
            var s3 = ClienteS3(cfg);

            using (var up = arquivo.OpenReadStream())
                await s3.PutObjectAsync(new PutObjectRequest
                {
                    BucketName = bucket, Key = chave, InputStream = up,
                    ContentType = arquivo.ContentType
                });

            var url = $"s3://{bucket}/{chave}";
            await conn.ExecuteAsync("""
                INSERT INTO chamado_anexo (id, chamado_id, empresa_id, nome_arquivo,
                                           content_type, tamanho, chave_s3)
                VALUES (@anexoId, @id, current_empresa_id(), @nome, @tipo, @tam, @url)
                """, new { anexoId, id, nome = arquivo.FileName,
                           tipo = arquivo.ContentType, tam = (int)arquivo.Length, url });

            return Results.Ok(new { id = anexoId, nome = arquivo.FileName });
        }).DisableAntiforgery();

        // Listar anexos de um chamado
        g.MapGet("/{id:guid}/anexos", async (Guid id, ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            return Results.Ok(await conn.QueryAsync("""
                SELECT id, nome_arquivo, content_type, tamanho, criado_em
                  FROM chamado_anexo WHERE chamado_id = @id ORDER BY criado_em
                """, new { id }));
        });

        // Baixar/visualizar um anexo
        g.MapGet("/anexos/{anexoId:guid}", async (Guid anexoId, ClaimsPrincipal user,
            NpgsqlDataSource ds, IConfiguration cfg) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var a = await conn.QuerySingleOrDefaultAsync("""
                SELECT chave_s3, nome_arquivo, content_type
                  FROM chamado_anexo WHERE id = @anexoId
                """, new { anexoId });
            if (a is null) return Results.NotFound();
            return await BaixarAnexo((string)a.chave_s3, (string)a.content_type,
                (string)a.nome_arquivo, cfg);
        });
    }

    // ── Helpers de S3 para anexos ──
    static IAmazonS3 ClienteS3(IConfiguration cfg) =>
        new AmazonS3Client(cfg["S3:AccessKey"], cfg["S3:SecretKey"],
            new AmazonS3Config
            {
                ServiceURL = cfg["S3:Endpoint"] ?? "http://minio:9000",
                ForcePathStyle = true, AuthenticationRegion = "us-east-1"
            });

    static async Task<IResult> BaixarAnexo(string url, string contentType,
        string nome, IConfiguration cfg)
    {
        var semPrefixo = url.Replace("s3://", "");
        var barra = semPrefixo.IndexOf('/');
        var bucket = semPrefixo[..barra];
        var chave = semPrefixo[(barra + 1)..];
        try
        {
            using var r = await ClienteS3(cfg).GetObjectAsync(bucket, chave);
            using var ms = new MemoryStream();
            await r.ResponseStream.CopyToAsync(ms);
            return Results.File(ms.ToArray(), contentType, nome);
        }
        catch (AmazonS3Exception)
        {
            return Results.NotFound(new { erro = "Arquivo não encontrado." });
        }
    }
}
