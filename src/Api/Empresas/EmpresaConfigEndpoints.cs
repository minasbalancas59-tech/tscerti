using System.Security.Claims;
using Amazon.S3;
using Amazon.S3.Model;
using CertSaas.Api.Infra;
using Dapper;
using Npgsql;

namespace CertSaas.Api.Empresas;

public record DispensarGuiaRequest(bool Dispensar);

public record ConfigEmpresaRequest(
    // Dados do emissor
    string RazaoSocial, string? Endereco, string? CidadeUf, string? Telefone,
    string? Email, string? NumAutorizacao, string? MetodoCalibracao,
    string? TextoPeriodicidade, string? TextoRodape, string? TituloDocumento,
    // Parâmetros do ensaio
    bool UsaExcentricidade, bool UsaRepetibilidade, int NumRepeticoes,
    bool ExigeTempUmidade, bool ExigeLacreSelo, decimal FatorAbrangencia,
    // Personalização visual (Nível 1)
    string? CorMarca, bool UsaAjuste, string? TextoAutorizacao, bool MostraValidade,
    string? EtiquetaTamanho, bool ValidarPermiteDownload, string? ModeloCertificado,
    bool? MarcaSistemaPdf,
    // Acreditação RBC (ISO/IEC 17025)
    bool Acreditada = false, string? NumAcreditacao = null,
    // Logo no PDF (tamanho e posição, ajustáveis nas Configurações)
    int LogoLargura = 90, int LogoAltura = 55, string? LogoAlinhamento = null,
    // Nome fantasia (etiqueta + cabeçalho do certificado)
    string? NomeFantasia = null,
    string? ClausulaSubstituicao = null, bool? EnviaEmailAutomatico = null,
    // Instrução de calibração (IT + revisão) — fixa por empresa, usada no Modelo 4
    string? InstrucaoIt = null, string? InstrucaoRev = null);

public static class EmpresaConfigEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/empresa").RequireAuthorization();

        // ── Exportacao de dados da empresa (backup completo / offboarding) ──
        // O super-admin usa o mesmo fluxo entrando via "Visualizar como Admin".
        g.MapPost("/exportar", async (ClaimsPrincipal user, NpgsqlDataSource ds,
            StackExchange.Redis.IConnectionMultiplexer redis, HttpContext ctx) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var ja = await conn.ExecuteScalarAsync<int>(
                "SELECT count(*) FROM exportacao_empresa WHERE status IN ('pendente','gerando')");
            if (ja > 0)
                return Results.Conflict(new { erro = "Já existe uma exportação em andamento. Aguarde ela terminar." });
            var idExp = Guid.NewGuid();
            await conn.ExecuteAsync("""
                INSERT INTO exportacao_empresa (id, empresa_id, solicitado_por, status)
                VALUES (@idExp, current_empresa_id(), @uid, 'pendente')
                """, new { idExp, uid = Tenant.UsuarioId(user) });
            await redis.GetDatabase().ListLeftPushAsync("fila:tarefas",
                System.Text.Json.JsonSerializer.Serialize(new { tipo = "exportar_empresa", exportacao_id = idExp }));
            await Auditoria.Registrar(conn, Tenant.EmpresaId(user), Tenant.UsuarioId(user),
                "exportacao_empresa", idExp, "solicitar", null, Auditoria.Ip(ctx));
            return Results.Ok(new { id = idExp, status = "pendente" });
        });

        g.MapGet("/exportacoes", async (ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            return Results.Ok(await conn.QueryAsync("""
                SELECT id, status, tamanho_bytes, erro, criado_em, pronto_em, expira_em
                  FROM exportacao_empresa ORDER BY criado_em DESC LIMIT 10
                """));
        });

        g.MapGet("/exportacao/{id:guid}/download", async (Guid id, ClaimsPrincipal user,
            NpgsqlDataSource ds, IConfiguration cfg) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var e = await conn.QuerySingleOrDefaultAsync(
                "SELECT arquivo_url, status FROM exportacao_empresa WHERE id = @id", new { id });
            if (e is null || (string?)e.status != "pronto" || (string?)e.arquivo_url is null)
                return Results.NotFound();
            var sp = ((string)e.arquivo_url).Replace("s3://", "");
            var i = sp.IndexOf('/');
            if (i <= 0) return Results.NotFound();
            var s3 = new AmazonS3Client(cfg["S3:AccessKey"], cfg["S3:SecretKey"],
                new AmazonS3Config
                {
                    ServiceURL = cfg["S3:Endpoint"] ?? "http://minio:9000",
                    ForcePathStyle = true, AuthenticationRegion = "us-east-1"
                });
            try
            {
                var obj = await s3.GetObjectAsync(sp[..i], sp[(i + 1)..]);
                return Results.Stream(obj.ResponseStream, "application/zip",
                    $"backup-empresa-{DateTime.UtcNow:yyyyMMdd}.zip");
            }
            catch (AmazonS3Exception) { return Results.NotFound(); }
        });

        // Aviso de vigência do contrato (só admin/RT; vazio se está tudo em dia)
        g.MapGet("/contrato-vigencia", async (ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Ok(Array.Empty<object>());
            await using var conn = await Tenant.AbrirConexao(ds, user);
            try
            {
                return Results.Ok(await conn.QueryAsync("SELECT * FROM minha_vigencia_contrato()"));
            }
            catch { return Results.Ok(Array.Empty<object>()); }
        });

        // Ler a configuração da empresa do usuário logado
        g.MapGet("/config", async (ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var cfg = await conn.QuerySingleOrDefaultAsync("""
                SELECT razao_social, nome_fantasia, endereco, cidade_uf, telefone, email,
                       num_autorizacao, metodo_calibracao, texto_periodicidade,
                       texto_rodape, titulo_documento,
                       usa_excentricidade, usa_repetibilidade, num_repeticoes,
                       exige_temp_umidade, exige_lacre_selo, fator_abrangencia,
                       cor_marca, logo_url, logo_largura, logo_altura, logo_alinhamento,
                       usa_ajuste, texto_autorizacao, mostra_validade,
                         etiqueta_tamanho, validar_permite_download, modelo_certificado,
                         marca_sistema_pdf AS "MarcaSistemaPdf",
                       clausula_substituicao AS "ClausulaSubstituicao",
                       envia_email_automatico AS "EnviaEmailAutomatico",
                         acreditada, num_acreditacao, selo_rbc_url,
                         rbc_num_leituras, rbc_num_posicoes_exc,
                         instrucao_it, instrucao_rev
                  FROM empresa WHERE id = @id
                """, new { id = Tenant.EmpresaId(user) });
            return cfg is null ? Results.NotFound() : Results.Ok(cfg);
        });

        // Salvar (só admin)
        g.MapPut("/config", async (ConfigEmpresaRequest req, ClaimsPrincipal user,
            NpgsqlDataSource ds, HttpContext ctx) =>
        {
            if (!Tenant.EhAdmin(user)) return Results.Forbid();
            if (string.IsNullOrWhiteSpace(req.RazaoSocial))
                return Results.BadRequest(new { erro = "Razão social é obrigatória." });
            if (req.NumRepeticoes is not (1 or 3 or 5 or 10))
                return Results.BadRequest(new { erro = "Nº de repetições deve ser 1, 3, 5 ou 10." });
            if (req.FatorAbrangencia <= 0 || req.FatorAbrangencia > 5)
                return Results.BadRequest(new { erro = "Fator de abrangência (k) inválido." });
            if (req.LogoLargura is < 30 or > 200 || req.LogoAltura is < 20 or > 120)
                return Results.BadRequest(new { erro = "Logo: largura deve estar entre 30 e 200 e altura entre 20 e 120." });
            if (req.LogoAlinhamento is not (null or "" or "topo" or "centro" or "base"))
                return Results.BadRequest(new { erro = "Alinhamento do logo inválido." });

            await using var conn = await Tenant.AbrirConexao(ds, user);
            await conn.ExecuteAsync("""
                UPDATE empresa SET
                    razao_social = @RazaoSocial, nome_fantasia = @NomeFantasia,
                    clausula_substituicao = COALESCE(NULLIF(@ClausulaSubstituicao, ''), clausula_substituicao),
                    envia_email_automatico = COALESCE(@EnviaEmailAutomatico, envia_email_automatico),
                    endereco = @Endereco,
                    cidade_uf = @CidadeUf, telefone = @Telefone, email = @Email,
                    num_autorizacao = @NumAutorizacao, metodo_calibracao = @MetodoCalibracao,
                    texto_periodicidade = @TextoPeriodicidade, texto_rodape = @TextoRodape,
                    titulo_documento = COALESCE(NULLIF(@TituloDocumento,''), titulo_documento),
                    usa_excentricidade = @UsaExcentricidade,
                    usa_repetibilidade = @UsaRepetibilidade,
                    num_repeticoes = @NumRepeticoes,
                    exige_temp_umidade = @ExigeTempUmidade,
                    exige_lacre_selo = @ExigeLacreSelo,
                    fator_abrangencia = @FatorAbrangencia,
                    cor_marca = COALESCE(NULLIF(@CorMarca,''), cor_marca),
                    logo_largura = @LogoLargura, logo_altura = @LogoAltura,
                    logo_alinhamento = COALESCE(NULLIF(@LogoAlinhamento,''), logo_alinhamento),
                    usa_ajuste = @UsaAjuste,
                    texto_autorizacao = @TextoAutorizacao,
                    mostra_validade = @MostraValidade,
                    etiqueta_tamanho = COALESCE(@EtiquetaTamanho, etiqueta_tamanho),
                    marca_sistema_pdf = COALESCE(@MarcaSistemaPdf, marca_sistema_pdf),
                    validar_permite_download = @ValidarPermiteDownload,
                    modelo_certificado = COALESCE(@ModeloCertificado, modelo_certificado),
                    acreditada = @Acreditada,
                    instrucao_it = @InstrucaoIt,
                    instrucao_rev = @InstrucaoRev,
                    num_acreditacao = @NumAcreditacao
                 WHERE id = @id
                """, new
                {
                    id = Tenant.EmpresaId(user),
                    req.RazaoSocial, req.NomeFantasia, req.ClausulaSubstituicao, req.EnviaEmailAutomatico, req.Endereco, req.CidadeUf, req.Telefone, req.Email,
                    req.NumAutorizacao, req.MetodoCalibracao, req.TextoPeriodicidade,
                    req.TextoRodape, req.TituloDocumento, req.UsaExcentricidade,
                    req.UsaRepetibilidade, req.NumRepeticoes, req.ExigeTempUmidade,
                    req.ExigeLacreSelo, req.FatorAbrangencia, req.CorMarca,
                    req.UsaAjuste, req.TextoAutorizacao, req.MostraValidade,
                    req.EtiquetaTamanho, req.ValidarPermiteDownload, req.ModeloCertificado,
                    req.Acreditada, req.NumAcreditacao, req.MarcaSistemaPdf,
                    req.LogoLargura, req.LogoAltura, req.LogoAlinhamento,
                    req.InstrucaoIt, req.InstrucaoRev
                });
            await Auditoria.Registrar(conn, Tenant.EmpresaId(user), Tenant.UsuarioId(user),
                "empresa", Tenant.EmpresaId(user), "config", req, Auditoria.Ip(ctx));
            return Results.Ok(new { salvo = true });
        });

        // ── Plano e cobranças (aba do admin da empresa) ──────────
        g.MapGet("/cobrancas", async (ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            // Valores e cobranças: SOMENTE o admin da empresa (RT não vê)
            if (!Tenant.EhAdmin(user)) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var empresaId = Tenant.EmpresaId(user);
            var contrato = await conn.QuerySingleOrDefaultAsync("""
                SELECT descricao, plano, valor, periodicidade, dia_vencimento,
                       inicio, fim, desconto_tipo, desconto_valor, desconto_ate,
                       max_usuarios, max_certs_mes
                  FROM contrato
                 WHERE empresa_id = @empresaId AND ativo
                 ORDER BY criado_em DESC LIMIT 1
                """, new { empresaId });
            var cobrancas = await conn.QueryAsync("""
                SELECT competencia, vencimento, valor, status, pago_em
                  FROM cobranca
                 WHERE empresa_id = @empresaId AND status <> 'cancelado'
                 ORDER BY competencia DESC LIMIT 24
                """, new { empresaId });
            return Results.Ok(new { contrato, cobrancas });
        });

        // ── Plano contratado + consumo (card "Seu plano" do painel) ──
        // Contador de visitas à landing vindas do sistema (público, sem auth:
        // quem clica no rodapé da validação não tem login). Só incrementa um
        // contador por dia/origem — nenhum dado pessoal.
        app.MapPost("/api/marketing/visita", async (string? origem, NpgsqlDataSource ds) =>
        {
            try
            {
                await using var conn = await ds.OpenConnectionAsync();
                await conn.ExecuteAsync("SELECT marketing_registrar_visita(@o)",
                    new { o = origem });
            }
            catch { /* nunca atrapalhar a navegação do visitante */ }
            return Results.NoContent();
        }).AllowAnonymous();

        // ── Primeiros passos: o que falta para emitir o 1º certificado ──
        g.MapGet("/primeiros-passos", async (ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var json = await conn.ExecuteScalarAsync<string>(
                "SELECT empresa_primeiros_passos(@u)::text",
                new { u = Tenant.UsuarioId(user) }) ?? "{}";
            return Results.Content(json, "application/json");
        });

        g.MapPut("/primeiros-passos/dispensar", async (DispensarGuiaRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var st = await conn.ExecuteScalarAsync<bool>(
                "SELECT usuario_dispensar_guia(@u, @Dispensar)",
                new { u = Tenant.UsuarioId(user), req.Dispensar });
            return Results.Ok(new { dispensado = st });
        });

        g.MapGet("/plano", async (ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Ok(new { plano = (string?)null });
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var empresaId = Tenant.EmpresaId(user);
            var contrato = await conn.QuerySingleOrDefaultAsync("""
                SELECT plano, max_usuarios, max_certs_mes FROM contrato
                 WHERE empresa_id = @empresaId AND ativo
                 ORDER BY criado_em DESC LIMIT 1
                """, new { empresaId });
            var usuarios = await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM usuario WHERE ativo");
            var certsMes = await conn.ExecuteScalarAsync<int>("""
                SELECT COUNT(*) FROM certificado
                 WHERE enviado_em >= date_trunc('month', now())
                   AND status <> 'cancelado'
                """);
            // Cobrança em atraso? (banner de pendência financeira para o admin)
            var vencida = await conn.ExecuteScalarAsync<bool>("""
                SELECT EXISTS(SELECT 1 FROM cobranca
                 WHERE empresa_id = @empresaId
                   AND (status = 'vencido' OR (status = 'pendente' AND vencimento < current_date)))
                """, new { empresaId });
            // Sem contrato ativo: período de avaliação de 30 dias desde o cadastro
            bool semContrato = contrato is null;
            int? diasRestantes = null;
            if (semContrato)
            {
                try
                {
                    var criadoEm = await conn.ExecuteScalarAsync<DateTime>(
                        "SELECT criado_em FROM empresa WHERE id = @empresaId", new { empresaId });
                    diasRestantes = 30 - (int)(DateTime.UtcNow - criadoEm).TotalDays;
                }
                catch { /* coluna ausente: sem contagem, só o aviso */ }
            }
            return Results.Ok(new
            {
                plano = (string?)contrato?.plano,
                maxUsuarios = (int?)contrato?.max_usuarios,
                maxCertsMes = (int?)contrato?.max_certs_mes,
                usuarios, certsMes, cobrancaVencida = vencida,
                semContrato, diasRestantes
            });
        });

        // Upload do logotipo (só admin) → MinIO
        g.MapPost("/logo", async (HttpRequest req, ClaimsPrincipal user,
            NpgsqlDataSource ds, IConfiguration cfg) =>
        {
            if (!Tenant.EhAdmin(user)) return Results.Forbid();
            if (!req.HasFormContentType) return Results.BadRequest(new { erro = "Envie uma imagem." });
            var form = await req.ReadFormAsync();
            var arquivo = form.Files.GetFile("logo");
            if (arquivo is null || arquivo.Length == 0)
                return Results.BadRequest(new { erro = "Arquivo vazio." });
            if (arquivo.Length > 2 * 1024 * 1024)
                return Results.BadRequest(new { erro = "Logo deve ter até 2 MB." });
            var tipo = arquivo.ContentType;
            if (tipo is not ("image/png" or "image/jpeg" or "image/jpg"))
                return Results.BadRequest(new { erro = "Use PNG ou JPG." });

            using var ms = new MemoryStream();
            await arquivo.CopyToAsync(ms);
            var bytes = ms.ToArray();

            var empresaId = Tenant.EmpresaId(user);
            var ext = tipo == "image/png" ? "png" : "jpg";
            var chave = $"logos/{empresaId}.{ext}";
            var s3 = Cliente(cfg);
            var bucket = cfg["S3:Bucket"] ?? "certificados";
            await GarantirBucket(s3, bucket);
            using (var up = new MemoryStream(bytes))
                await s3.PutObjectAsync(new PutObjectRequest
                {
                    BucketName = bucket, Key = chave, InputStream = up, ContentType = tipo
                });

            var url = $"s3://{bucket}/{chave}";
            await using var conn = await Tenant.AbrirConexao(ds, user);
            await conn.ExecuteAsync("UPDATE empresa SET logo_url=@url WHERE id=@id",
                new { url, id = empresaId });
            return Results.Ok(new { enviado = true });
        }).DisableAntiforgery();

        // Upload do SELO RBC (só admin, empresa acreditada) → MinIO
        g.MapPost("/selo-rbc", async (HttpRequest req, ClaimsPrincipal user,
            NpgsqlDataSource ds, IConfiguration cfg) =>
        {
            if (!Tenant.EhAdmin(user)) return Results.Forbid();
            if (!req.HasFormContentType) return Results.BadRequest(new { erro = "Envie um arquivo." });
            var form = await req.ReadFormAsync();
            var file = form.Files.GetFile("file");
            if (file is null || file.Length == 0) return Results.BadRequest(new { erro = "Arquivo vazio." });
            var tipo = file.ContentType;
            if (tipo is not ("image/png" or "image/jpeg"))
                return Results.BadRequest(new { erro = "Use PNG ou JPEG." });
            using var ms = new MemoryStream();
            await file.CopyToAsync(ms);
            var bytes = ms.ToArray();

            var empresaId = Tenant.EmpresaId(user);
            var ext = tipo == "image/png" ? "png" : "jpg";
            var chave = $"selos/{empresaId}.{ext}";
            var s3 = Cliente(cfg);
            var bucket = cfg["S3:Bucket"] ?? "certificados";
            await GarantirBucket(s3, bucket);
            using (var up = new MemoryStream(bytes))
                await s3.PutObjectAsync(new PutObjectRequest
                {
                    BucketName = bucket, Key = chave, InputStream = up, ContentType = tipo
                });

            var url = $"s3://{bucket}/{chave}";
            await using var conn = await Tenant.AbrirConexao(ds, user);
            await conn.ExecuteAsync("UPDATE empresa SET selo_rbc_url=@url WHERE id=@id",
                new { url, id = empresaId });
            return Results.Ok(new { enviado = true });
        }).DisableAntiforgery();

        // Servir o logo (para exibir na tela de config)
        g.MapGet("/logo", async (ClaimsPrincipal user, NpgsqlDataSource ds,
            IConfiguration cfg) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var url = await conn.ExecuteScalarAsync<string?>(
                "SELECT logo_url FROM empresa WHERE id=@id",
                new { id = Tenant.EmpresaId(user) });
            if (string.IsNullOrEmpty(url)) return Results.NotFound();
            var semPrefixo = url.Replace("s3://", "");
            var barra = semPrefixo.IndexOf('/');
            var bucket = semPrefixo[..barra];
            var chave = semPrefixo[(barra + 1)..];
            var s3 = Cliente(cfg);
            try
            {
                using var r = await s3.GetObjectAsync(bucket, chave);
                using var mem = new MemoryStream();
                await r.ResponseStream.CopyToAsync(mem);
                return Results.File(mem.ToArray(), r.Headers.ContentType ?? "image/png");
            }
            catch (AmazonS3Exception) { return Results.NotFound(); }
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
