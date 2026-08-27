using Amazon.S3;
using Amazon.S3.Model;

namespace CertSaas.Worker;

/// <summary>Salva arquivos no MinIO (ou qualquer S3) e devolve a chave.</summary>
public sealed class Armazenamento
{
    private readonly IAmazonS3 _s3;
    private readonly string _bucket;
    private readonly ILogger<Armazenamento> _log;

    public Armazenamento(IConfiguration cfg, ILogger<Armazenamento> log)
    {
        _log = log;
        _bucket = cfg["S3:Bucket"] ?? "certificados";
        _s3 = new AmazonS3Client(
            cfg["S3:AccessKey"], cfg["S3:SecretKey"],
            new AmazonS3Config
            {
                ServiceURL = cfg["S3:Endpoint"] ?? "http://minio:9000",
                ForcePathStyle = true,          // exigido pelo MinIO
                AuthenticationRegion = "us-east-1"
            });
    }

    public async Task<string> Salvar(string chave, byte[] conteudo, string contentType)
    {
        await GarantirBucket();
        using var ms = new MemoryStream(conteudo);
        await _s3.PutObjectAsync(new PutObjectRequest
        {
            BucketName = _bucket, Key = chave, InputStream = ms, ContentType = contentType
        });
        // Guardamos só a chave; o download é sempre via API autenticada
        return $"s3://{_bucket}/{chave}";
    }

    public async Task<byte[]?> Ler(string chave)
    {
        try
        {
            using var r = await _s3.GetObjectAsync(_bucket, chave);
            using var ms = new MemoryStream();
            await r.ResponseStream.CopyToAsync(ms);
            return ms.ToArray();
        }
        catch (AmazonS3Exception e) when (e.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return null;
        }
    }

    /// <summary>Remove um objeto do bucket (usado no expurgo de fotos antigas).</summary>
    public async Task Deletar(string chave)
    {
        try { await _s3.DeleteObjectAsync(_bucket, chave); }
        catch (Exception ex) { _log.LogWarning(ex, "Falha ao deletar {Chave} do S3.", chave); }
    }

    private async Task GarantirBucket()
    {
        try
        {
            var existe = await Amazon.S3.Util.AmazonS3Util
                .DoesS3BucketExistV2Async(_s3, _bucket);
            if (!existe)
            {
                await _s3.PutBucketAsync(new PutBucketRequest { BucketName = _bucket });
                _log.LogInformation("Bucket '{Bucket}' criado.", _bucket);
            }
        }
        catch (Exception ex) { _log.LogWarning(ex, "Não foi possível verificar/criar o bucket."); }
    }
}
