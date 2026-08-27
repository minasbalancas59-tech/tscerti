using System.Security.Claims;
using Amazon.S3;
using Amazon.S3.Model;
using CertSaas.Api.Infra;
using Dapper;
using Npgsql;

namespace CertSaas.Api.Pesos;

public static class PesoPdfEndpoints
{
    private const long MaxBytes = 15 * 1024 * 1024;   // 15 MB

    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/pesos").RequireAuthorization();

        // ── Upload do certificado (PDF) do peso ─────────────────
        g.MapPost("/{id:guid}/certificado", async (Guid id, HttpRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds, IConfiguration cfg) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            if (!req.HasFormContentType)
                return Results.BadRequest(new { erro = "Envie o arquivo como multipart/form-data." });

            var form = await req.ReadFormAsync();
            var arquivo = form.Files.GetFile("arquivo");
            if (arquivo is null || arquivo.Length == 0)
                return Results.BadRequest(new { erro = "Nenhum arquivo enviado." });
            if (arquivo.Length > MaxBytes)
                return Results.BadRequest(new { erro = "Arquivo maior que 15 MB." });

            // Só PDF — valida pela assinatura mágica %PDF, não só pela extensão
            await using var s = arquivo.OpenReadStream();
            var cabecalho = new byte[5];
            var lido = await s.ReadAsync(cabecalho.AsMemory(0, 5));
            if (lido < 5 || cabecalho[0] != 0x25 || cabecalho[1] != 0x50 ||
                cabecalho[2] != 0x44 || cabecalho[3] != 0x46)   // %PDF
                return Results.BadRequest(new { erro = "O arquivo precisa ser um PDF válido." });

            using var ms = new MemoryStream();
            s.Position = 0;
            await s.CopyToAsync(ms);
            var bytes = ms.ToArray();

            await using var conn = await Tenant.AbrirConexao(ds, user);
            var existe = await conn.ExecuteScalarAsync<bool>(
                "SELECT EXISTS(SELECT 1 FROM peso_padrao WHERE id=@id)", new { id });
            if (!existe) return Results.NotFound();

            var empresaId = Tenant.EmpresaId(user);
            var chave = $"pesos/{empresaId}/{id}.pdf";
            var s3 = Cliente(cfg);
            var bucket = cfg["S3:Bucket"] ?? "certificados";
            await GarantirBucket(s3, bucket);
            using (var up = new MemoryStream(bytes))
                await s3.PutObjectAsync(new PutObjectRequest
                {
                    BucketName = bucket, Key = chave, InputStream = up,
                    ContentType = "application/pdf"
                });

            var url = $"s3://{bucket}/{chave}";
            await conn.ExecuteAsync(
                "UPDATE peso_padrao SET certificado_pdf_url=@url WHERE id=@id",
                new { url, id });
            await Auditoria.Registrar(conn, empresaId, Tenant.UsuarioId(user),
                "peso_padrao", id, "upload_certificado", null, Auditoria.Ip(req.HttpContext));

            return Results.Ok(new { id, enviado = true });
        }).DisableAntiforgery();

        // ── Download/visualização do PDF do peso ────────────────
        g.MapGet("/{id:guid}/certificado", async (Guid id, ClaimsPrincipal user,
            NpgsqlDataSource ds, IConfiguration cfg) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var url = await conn.ExecuteScalarAsync<string?>(
                "SELECT certificado_pdf_url FROM peso_padrao WHERE id=@id", new { id });
            if (url is null) return Results.NotFound(new { erro = "Sem certificado anexado." });

            var semPrefixo = url.Replace("s3://", "");
            var barra = semPrefixo.IndexOf('/');
            var bucket = semPrefixo[..barra];
            var chave = semPrefixo[(barra + 1)..];
            try
            {
                using var r = await Cliente(cfg).GetObjectAsync(bucket, chave);
                using var ms = new MemoryStream();
                await r.ResponseStream.CopyToAsync(ms);
                return Results.File(ms.ToArray(), "application/pdf",
                    enableRangeProcessing: true);
            }
            catch (AmazonS3Exception)
            {
                return Results.NotFound(new { erro = "Arquivo não encontrado." });
            }
        });
    }

    private static AmazonS3Client Cliente(IConfiguration cfg) =>
        new(cfg["S3:AccessKey"], cfg["S3:SecretKey"], new AmazonS3Config
        {
            ServiceURL = cfg["S3:Endpoint"] ?? "http://minio:9000",
            ForcePathStyle = true, AuthenticationRegion = "us-east-1"
        });

    private static async Task GarantirBucket(AmazonS3Client s3, string bucket)
    {
        try
        {
            if (!await Amazon.S3.Util.AmazonS3Util.DoesS3BucketExistV2Async(s3, bucket))
                await s3.PutBucketAsync(new PutBucketRequest { BucketName = bucket });
        }
        catch { /* bucket provavelmente já existe */ }
    }
}
