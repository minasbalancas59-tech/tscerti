using System.Security.Claims;
using Amazon.S3;
using Amazon.S3.Model;
using CertSaas.Api.Infra;
using Dapper;
using Npgsql;
using SkiaSharp;

namespace CertSaas.Api.Certificados;

/// <summary>
/// Fotos das leituras do display da balança, anexadas a um certificado.
/// Servem de evidência visual de que os valores conferem. Visíveis
/// apenas para usuários do sistema (técnicos/gestores) — NUNCA no
/// portal do cliente nem na validação pública por QR.
/// As imagens são comprimidas no upload (SkiaSharp) e expurgadas
/// automaticamente após 2 anos (rotina no Worker).
/// </summary>
public static class FotoEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/certificados").RequireAuthorization();

        // ── Upload de foto (comprimida) ──
        g.MapPost("/{id:guid}/fotos", async (Guid id, HttpRequest http,
            ClaimsPrincipal user, NpgsqlDataSource ds, IConfiguration cfg) =>
        {
            if (!http.HasFormContentType)
                return Results.BadRequest(new { erro = "Envie a foto como formulário." });
            var form = await http.ReadFormAsync();
            var arquivo = form.Files["arquivo"];
            if (arquivo is null || arquivo.Length == 0)
                return Results.BadRequest(new { erro = "Nenhuma foto enviada." });

            var tipo = arquivo.ContentType?.ToLowerInvariant() ?? "";
            if (!tipo.StartsWith("image/"))
                return Results.BadRequest(new { erro = "Apenas imagens são aceitas." });
            if (arquivo.Length > 15 * 1024 * 1024)
                return Results.BadRequest(new { erro = "A foto deve ter no máximo 15 MB." });

            await using var conn = await Tenant.AbrirConexao(ds, user);
            var empresaId = Tenant.EmpresaId(user);
            var existe = await conn.ExecuteScalarAsync<bool>(
                "SELECT EXISTS(SELECT 1 FROM certificado WHERE id=@id)", new { id });
            if (!existe) return Results.NotFound();

            // Comprime: redimensiona para no máx. 1600px no maior lado e
            // recodifica como JPEG qualidade 72 (bom equilíbrio evidência/espaço).
            byte[] comprimida;
            string contentTypeFinal = "image/jpeg";
            try
            {
                // Lê todo o stream para memória (permite reprocessar se preciso)
                using var buffer = new MemoryStream();
                using (var origem = arquivo.OpenReadStream())
                    await origem.CopyToAsync(buffer);
                var bytesOriginais = buffer.ToArray();

                using var bitmap = SKBitmap.Decode(bytesOriginais);
                if (bitmap is null)
                {
                    // O SkiaSharp não decodificou (ex.: HEIC do iPhone). Guarda o
                    // original como está — a evidência é mais importante que a compressão.
                    if (bytesOriginais.Length > 8 * 1024 * 1024)
                        return Results.BadRequest(new { erro =
                            "Formato de imagem não suportado para compressão e maior que 8 MB. " +
                            "Converta para JPG/PNG e tente novamente." });
                    comprimida = bytesOriginais;
                    contentTypeFinal = tipo;   // mantém o content-type original
                }
                else
                {
                    const int maxLado = 1600;
                    var escala = Math.Min(1f, (float)maxLado / Math.Max(bitmap.Width, bitmap.Height));
                    using var redimensionada = escala < 1f
                        ? bitmap.Resize(new SKImageInfo(
                            (int)(bitmap.Width * escala), (int)(bitmap.Height * escala)),
                            SKFilterQuality.Medium)
                        : bitmap;
                    using var img = SKImage.FromBitmap(redimensionada ?? bitmap);
                    using var dados = img.Encode(SKEncodedImageFormat.Jpeg, 72);
                    comprimida = dados.ToArray();
                }
            }
            catch (Exception ex)
            {
                app.Logger.LogWarning(ex, "Falha ao comprimir foto de certificado");
                return Results.BadRequest(new { erro = "Não foi possível processar a imagem. " +
                    "Tente uma foto em JPG ou PNG." });
            }

            var fotoId = Guid.NewGuid();
            var extFinal = contentTypeFinal == "image/jpeg" ? "jpg"
                : contentTypeFinal.Replace("image/", "");
            var chave = $"certificados-fotos/{empresaId}/{id}/{fotoId}.{extFinal}";
            var bucket = cfg["S3:Bucket"] ?? "certificados";
            var s3 = ClienteS3(cfg);

            using (var up = new MemoryStream(comprimida))
                await s3.PutObjectAsync(new PutObjectRequest
                {
                    BucketName = bucket, Key = chave, InputStream = up,
                    ContentType = contentTypeFinal
                });

            var legenda = form["legenda"].ToString();
            var url = $"s3://{bucket}/{chave}";
            await conn.ExecuteAsync("""
                INSERT INTO certificado_foto (id, certificado_id, empresa_id, legenda,
                    content_type, tamanho, chave_s3, criado_por)
                VALUES (@fotoId, @id, current_empresa_id(), @legenda,
                    @ct, @tam, @url, @uid)
                """, new { fotoId, id, legenda = string.IsNullOrWhiteSpace(legenda) ? null : legenda,
                    ct = contentTypeFinal, tam = comprimida.Length, url, uid = Tenant.UsuarioId(user) });

            return Results.Ok(new { id = fotoId, tamanho = comprimida.Length });
        }).DisableAntiforgery();

        // ── Listar fotos de um certificado ──
        g.MapGet("/{id:guid}/fotos", async (Guid id, ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var fotos = await conn.QueryAsync("""
                SELECT f.id, f.legenda, f.tamanho, f.criado_em, u.nome AS criado_por
                  FROM certificado_foto f
                  LEFT JOIN usuario u ON u.id = f.criado_por
                 WHERE f.certificado_id = @id
                 ORDER BY f.criado_em
                """, new { id });
            return Results.Ok(fotos);
        });

        // ── Ver a imagem (stream) — só usuário autenticado do sistema ──
        g.MapGet("/fotos/{fotoId:guid}", async (Guid fotoId,
            ClaimsPrincipal user, NpgsqlDataSource ds, IConfiguration cfg) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var reg = await conn.QuerySingleOrDefaultAsync<(string chave, string ct)>(
                "SELECT chave_s3 AS chave, content_type AS ct FROM certificado_foto WHERE id=@fotoId",
                new { fotoId });
            if (reg.chave is null) return Results.NotFound();

            var bucket = cfg["S3:Bucket"] ?? "certificados";
            var key = reg.chave.Replace($"s3://{bucket}/", "");
            try
            {
                using var r = await ClienteS3(cfg).GetObjectAsync(bucket, key);
                using var ms = new MemoryStream();
                await r.ResponseStream.CopyToAsync(ms);
                return Results.File(ms.ToArray(), reg.ct ?? "image/jpeg");
            }
            catch (AmazonS3Exception) { return Results.NotFound(); }
        });

        // ── Excluir uma foto (do banco e do MinIO) ──
        g.MapDelete("/fotos/{fotoId:guid}", async (Guid fotoId,
            ClaimsPrincipal user, NpgsqlDataSource ds, IConfiguration cfg, HttpContext ctx) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var chave = await conn.ExecuteScalarAsync<string?>(
                "SELECT chave_s3 FROM certificado_foto WHERE id=@fotoId", new { fotoId });
            if (chave is null) return Results.NotFound();

            var bucket = cfg["S3:Bucket"] ?? "certificados";
            var key = chave.Replace($"s3://{bucket}/", "");
            try { await ClienteS3(cfg).DeleteObjectAsync(bucket, key); } catch { /* segue */ }
            await conn.ExecuteAsync("DELETE FROM certificado_foto WHERE id=@fotoId", new { fotoId });

            await Auditoria.Registrar(conn, Tenant.EmpresaId(user), Tenant.UsuarioId(user),
                "certificado_foto", fotoId, "delete", null, Auditoria.Ip(ctx));
            return Results.Ok(new { ok = true });
        });
    }

    static IAmazonS3 ClienteS3(IConfiguration cfg) =>
        new AmazonS3Client(cfg["S3:AccessKey"], cfg["S3:SecretKey"],
            new AmazonS3Config
            {
                ServiceURL = cfg["S3:Endpoint"] ?? "http://minio:9000",
                ForcePathStyle = true, AuthenticationRegion = "us-east-1"
            });
}
