using System.Security.Claims;
using Amazon.S3;
using CertSaas.Api.Infra;
using Dapper;
using Npgsql;

namespace CertSaas.Api.Certificados;

public static class PdfDownloadEndpoints
{
    public static void Map(WebApplication app)
    {
        // Download autenticado do PDF do certificado
        app.MapGet("/api/certificados/{id:guid}/pdf", async (Guid id,
            ClaimsPrincipal user, NpgsqlDataSource ds, IConfiguration cfg) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var pdfUrl = await conn.ExecuteScalarAsync<string?>(
                "SELECT pdf_url FROM certificado WHERE id=@id AND status='emitido'",
                new { id });
            if (pdfUrl is null)
                return Results.NotFound(new { erro = "PDF ainda não disponível." });

            // pdf_url no formato s3://bucket/chave
            var semPrefixo = pdfUrl.Replace("s3://", "");
            var barra = semPrefixo.IndexOf('/');
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
                using var ms = new MemoryStream();
                await r.ResponseStream.CopyToAsync(ms);
                var nome = chave.Split('/').Last();
                return Results.File(ms.ToArray(), "application/pdf", nome);
            }
            catch (AmazonS3Exception)
            {
                return Results.NotFound(new { erro = "Arquivo não encontrado no storage." });
            }
        }).RequireAuthorization();
    }
}
