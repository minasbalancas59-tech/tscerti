using System.Security.Claims;
using System.Text.Json;
using CertSaas.Api.Infra;
using Dapper;
using Npgsql;
using StackExchange.Redis;

namespace CertSaas.Api.Certificados;

public record ReprovarRequest(string Observacao);

public static class AprovacaoEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/certificados").RequireAuthorization();

        // ── Detalhe completo pra revisão/aprovação ──────────────
        g.MapGet("/{id:guid}/revisao", async (Guid id, ClaimsPrincipal user,
            NpgsqlDataSource ds) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var ct = await conn.QuerySingleOrDefaultAsync("""
                SELECT ct.*, c.razao_social AS cliente, c.cidade, c.uf,
                       b.identificacao AS balanca, b.marca, b.modelo, b.num_serie,
                       b.capacidade, b.divisao_e, b.classe_exatidao, b.local_instalacao, b.unidade,
                       b.numero_inmetro, b.patrimonio, b.portaria_aprovacao,
                       u.nome AS tecnico
                  FROM certificado ct
                  JOIN cliente c ON c.id = ct.cliente_id
                  JOIN balanca b ON b.id = ct.balanca_id
                  JOIN usuario u ON u.id = ct.tecnico_id
                 WHERE ct.id = @id
                """, new { id });
            if (ct is null) return Results.NotFound();

            var ind = await conn.QueryAsync(
                "SELECT * FROM ensaio_indicacao WHERE certificado_id=@id ORDER BY ordem", new { id });
            var exc = await conn.QueryAsync(
                "SELECT * FROM ensaio_excentricidade WHERE certificado_id=@id", new { id });
            var rep = await conn.QueryAsync(
                "SELECT * FROM ensaio_repetibilidade WHERE certificado_id=@id ORDER BY medicao_num", new { id });
            var pesos = await conn.QueryAsync("""
                SELECT pp.identificacao, pp.valor_nominal, pp.classe,
                       pp.num_certificado, pp.data_calibracao, pp.validade, pp.laboratorio
                  FROM certificado_peso cp JOIN peso_padrao pp ON pp.id = cp.peso_padrao_id
                 WHERE cp.certificado_id = @id
                """, new { id });

            var faixas = await conn.QueryAsync("""
                SELECT ordem, limite_sup, divisao_e FROM balanca_faixa
                 WHERE balanca_id = @bid ORDER BY ordem
                """, new { bid = (Guid)ct.balanca_id });

            var sensibilidade = await conn.QuerySingleOrDefaultAsync("""
                SELECT id, carga_referencia, adicao, resultado_display
                  FROM ensaio_sensibilidade WHERE certificado_id = @id
                """, new { id });

            return Results.Ok(new { certificado = ct, indicacao = ind,
                excentricidade = exc, repetibilidade = rep, pesos, faixas, sensibilidade });
        });

        // ── Aprovar → emite (só responsável_tecnico ou admin) ───
        g.MapPost("/{id:guid}/aprovar", async (Guid id, ClaimsPrincipal user,
            NpgsqlDataSource ds, IConnectionMultiplexer redis, HttpContext ctx) =>
        {
            var papel = Tenant.Papel(user);
            if (papel is not ("admin" or "responsavel_tecnico"))
                return Results.Forbid();

            await using var conn = await Tenant.AbrirConexao(ds, user);
            // Empresa suspensa/cancelada não emite (efeito imediato)
            var statusEmp = await conn.ExecuteScalarAsync<string>(
                "SELECT status FROM empresa WHERE id = current_empresa_id()");
            if (statusEmp != "ativa")
                return Results.Json(new { erro = "Empresa suspensa. Regularize para emitir." }, statusCode: 403);

            // Assinatura obrigatoria: o certificado leva a assinatura do aprovador
            var assinAprovador = await conn.ExecuteScalarAsync<string?>(
                "SELECT assinatura_url FROM usuario WHERE id = @uid",
                new { uid = Tenant.UsuarioId(user) });
            if (string.IsNullOrWhiteSpace(assinAprovador))
                return Results.BadRequest(new { erro =
                    "Voce ainda nao cadastrou sua assinatura. Cadastre sua assinatura em " +
                    "\"Meu perfil\" antes de aprovar - o certificado emitido precisa dela." });

            // O tecnico executor tambem precisa ter assinatura
            var assinTecnico = await conn.ExecuteScalarAsync<string?>(
                "SELECT u.assinatura_url FROM usuario u " +
                "JOIN certificado ct ON ct.tecnico_id = u.id WHERE ct.id = @id", new { id });
            if (string.IsNullOrWhiteSpace(assinTecnico))
            {
                var nomeTec = await conn.ExecuteScalarAsync<string?>(
                    "SELECT u.nome FROM usuario u JOIN certificado ct ON ct.tecnico_id = u.id WHERE ct.id = @id",
                    new { id });
                return Results.BadRequest(new { erro =
                    $"O tecnico executor ({nomeTec ?? "responsavel"}) nao tem assinatura cadastrada. " +
                    "Pe\u00e7a que ele cadastre a assinatura em \"Meu perfil\" antes da aprovacao." });
            }

            await using var tx = await conn.BeginTransactionAsync();

            // Trava de integridade: não aprova com ponto de ensaio sem carga
            var semCarga = await conn.ExecuteScalarAsync<int>("""
                SELECT
                  (SELECT count(*) FROM ensaio_indicacao
                    WHERE certificado_id=@id AND (carga_aplicada IS NULL OR indicacao IS NULL))
                + (SELECT count(*) FROM ensaio_excentricidade
                    WHERE certificado_id=@id AND (carga IS NULL OR indicacao IS NULL))
                + (SELECT count(*) FROM ensaio_repetibilidade
                    WHERE certificado_id=@id AND (carga IS NULL OR indicacao IS NULL))
                """, new { id });
            if (semCarga > 0)
                return Results.BadRequest(new { erro =
                    "Não é possível aprovar: há ponto de ensaio com carga ou indicação em branco. Revise o certificado." });

            await conn.ExecuteAsync(
                "UPDATE certificado SET aprovador_id=@uid WHERE id=@id AND status='aguardando_aprovacao'",
                new { uid = Tenant.UsuarioId(user), id });

            string numero;
            try
            {
                numero = (await conn.ExecuteScalarAsync<string>(
                    "SELECT emitir_certificado(@id)", new { id }))!;
            }
            catch (PostgresException e)
            {
                return Results.BadRequest(new { erro = e.MessageText });
            }

            await Auditoria.Registrar(conn, Tenant.EmpresaId(user),
                Tenant.UsuarioId(user), "certificado", id, "emitir",
                new { numero }, Auditoria.Ip(ctx));
            await tx.CommitAsync();

            // Enfileira PDF + email (worker processa)
            var fila = redis.GetDatabase();
            await fila.ListLeftPushAsync("fila:tarefas",
                JsonSerializer.Serialize(new { tipo = "gerar_pdf", certificado_id = id }));

            // Revisao: avisa o cliente que o certificado anterior foi substituido
            // (o PDF antigo que ele guardou deixa de valer). Joao, 20/08/2026.
            var substituiId = await conn.ExecuteScalarAsync<Guid?>(
                "SELECT substitui_id FROM certificado WHERE id = @id", new { id });
            if (substituiId is not null)
                await fila.ListLeftPushAsync("fila:tarefas",
                    JsonSerializer.Serialize(new { tipo = "email_revisao_emitida", certificado_id = id }));

            return Results.Ok(new { id, numero, status = "emitido" });
        });

        // ── Devolver pra rascunho com observação ────────────────
        g.MapPost("/{id:guid}/reprovar", async (Guid id, ReprovarRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds, HttpContext ctx) =>
        {
            var papel = Tenant.Papel(user);
            if (papel is not ("admin" or "responsavel_tecnico"))
                return Results.Forbid();
            if (string.IsNullOrWhiteSpace(req.Observacao))
                return Results.BadRequest(new { erro = "Informe o motivo da devolução." });

            await using var conn = await Tenant.AbrirConexao(ds, user);
            var n = await conn.ExecuteAsync("""
                UPDATE certificado
                   SET status = 'rascunho', obs_reprovacao = @obs
                 WHERE id = @id AND status = 'aguardando_aprovacao'
                """, new { id, obs = req.Observacao });
            if (n == 0) return Results.Conflict(new { erro = "Certificado não está aguardando aprovação." });

            await Auditoria.Registrar(conn, Tenant.EmpresaId(user),
                Tenant.UsuarioId(user), "certificado", id, "reprovar",
                new { req.Observacao }, Auditoria.Ip(ctx));
            return Results.Ok(new { id, status = "rascunho" });
        });

        // ── Emitir revisão de um certificado emitido ────────────
        // Cria um novo rascunho copiando o original (dados, ensaios,
        // pesos). Só admin/responsável técnico. Ao emitir esse novo,
        // o original é marcado como 'substituido'.
        g.MapPost("/{id:guid}/revisar", async (Guid id, ReprovarRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds, HttpContext ctx) =>
        {
            var papel = Tenant.Papel(user);
            if (papel is not ("admin" or "responsavel_tecnico"))
                return Results.Forbid();
            if (string.IsNullOrWhiteSpace(req.Observacao))
                return Results.BadRequest(new { erro = "Informe o motivo da revisão." });

            await using var conn = await Tenant.AbrirConexao(ds, user);
            // Empresa suspensa/cancelada não emite (efeito imediato)
            var statusEmp = await conn.ExecuteScalarAsync<string>(
                "SELECT status FROM empresa WHERE id = current_empresa_id()");
            if (statusEmp != "ativa")
                return Results.Json(new { erro = "Empresa suspensa. Regularize para emitir." }, statusCode: 403);

            await using var tx = await conn.BeginTransactionAsync();

            var orig = await conn.QuerySingleOrDefaultAsync("""
                SELECT id, cliente_id, balanca_id, tecnico_id, dados_rascunho, data_calibracao,
                       temperatura, umidade, contexto_ema, numero_lacre, selo_inmetro,
                       local_ensaio, revisao_num, numero, status
                  FROM certificado WHERE id = @id
                """, new { id });
            if (orig is null) return Results.NotFound();
            if ((string)orig.status != "emitido")
                return Results.Conflict(new { erro = "Só certificados emitidos podem ser revisados." });

            var novoId = Guid.NewGuid();
            await conn.ExecuteAsync("""
                INSERT INTO certificado (id, empresa_id, cliente_id, balanca_id, tecnico_id,
                    status, dados_rascunho, data_calibracao, temperatura, umidade,
                    contexto_ema, numero_lacre, selo_inmetro, local_ensaio,
                    substitui_id, revisao_num, motivo_revisao)
                VALUES (@novoId, @empresaId, @clienteId, @balancaId, @tecnicoId,
                    'rascunho', @dados::jsonb, @dataCal, @temp, @umid,
                    @contexto, @lacre, @selo, @local,
                    @origId, @revNum, @motivo)
                """, new
            {
                novoId, empresaId = Tenant.EmpresaId(user),
                clienteId = (Guid)orig.cliente_id, balancaId = (Guid)orig.balanca_id,
                tecnicoId = (Guid)orig.tecnico_id,   // autoria do ensaio: quem EXECUTOU
                dados = (string?)orig.dados_rascunho,
                dataCal = (DateTime?)orig.data_calibracao,
                temp = (decimal?)orig.temperatura, umid = (decimal?)orig.umidade,
                contexto = (string)orig.contexto_ema,
                lacre = (string?)orig.numero_lacre, selo = (string?)orig.selo_inmetro,
                local = (string)orig.local_ensaio,
                origId = id, revNum = (int)orig.revisao_num + 1, motivo = req.Observacao
            });

            await Auditoria.Registrar(conn, Tenant.EmpresaId(user), Tenant.UsuarioId(user),
                "certificado", novoId, "criar_revisao",
                new { original = (string?)orig.numero, req.Observacao }, Auditoria.Ip(ctx));
            await tx.CommitAsync();

            return Results.Ok(new { id = novoId, revisao = true,
                original = (string?)orig.numero });
        });

        // ── Reenfileirar PDF (se algo falhou) ───────────────────
        g.MapPost("/{id:guid}/regerar-pdf", async (Guid id, ClaimsPrincipal user,
            NpgsqlDataSource ds, IConnectionMultiplexer redis) =>
        {
            if (!Tenant.EhAdmin(user)) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var existe = await conn.ExecuteScalarAsync<bool>(
                "SELECT EXISTS(SELECT 1 FROM certificado WHERE id=@id AND status='emitido')",
                new { id });
            if (!existe) return Results.NotFound();
            var fila = redis.GetDatabase();
            await fila.ListLeftPushAsync("fila:tarefas",
                JsonSerializer.Serialize(new { tipo = "gerar_pdf", certificado_id = id }));
            return Results.Ok(new { id, reenfileirado = true });
        });
    }
}

// ── Validação pública (SEM autenticação) do QR Code ─────────────
public static class ValidacaoPublicaEndpoints
{
    public static void Map(WebApplication app)
    {
        // Validação pública do certificado pelo uuid (a página /validar usa)
        app.MapGet("/api/validar/{uuid:guid}", async (Guid uuid, HttpContext ctx, NpgsqlDataSource ds) =>
        {
            await using var conn = await ds.OpenConnectionAsync();
            var certo = await conn.QuerySingleOrDefaultAsync(
                "SELECT * FROM validar_certificado(@uuid)", new { uuid });

            // Registra a consulta (evidência de acesso pelo cliente via QR/link)
            try
            {
                var alvo = await conn.QuerySingleOrDefaultAsync<(Guid? certificado_id, Guid? empresa_id, Guid? cliente_id)>(
                    "SELECT * FROM pub_ids_certificado(@uuid)", new { uuid });
                // IP real do visitante: atrás do nginx vem no X-Forwarded-For
                var xff = ctx.Request.Headers["X-Forwarded-For"].ToString();
                var ip = !string.IsNullOrWhiteSpace(xff)
                    ? xff.Split(',')[0].Trim()
                    : ctx.Connection.RemoteIpAddress?.ToString();
                var ua = ctx.Request.Headers.UserAgent.ToString();
                await conn.ExecuteAsync("""
                    INSERT INTO consulta_certificado (certificado_id, empresa_id, cliente_id,
                        uuid_validacao, origem, ip, user_agent)
                    VALUES (@certId, @empresaId, @clienteId, @uuid, 'qrcode', @ip, @ua)
                    """, new { certId = alvo.certificado_id, empresaId = alvo.empresa_id,
                        clienteId = alvo.cliente_id, uuid, ip, ua });
            }
            catch { /* nunca bloqueia a validação por causa do log */ }

            if (certo is null)
                return Results.Ok(new { valido = false, estado = "indisponivel" });

            // Certificado SUBSTITUIDO: segue a cadeia substituido_por_id ate
            // achar a revisao realmente vigente (status = emitido), cobrindo
            // o caso de mais de uma revisao em sequencia (Joao, 19/08/2026).
            string? vigenteNumero = null; Guid? vigenteUuid = null;
            if ((string?)certo.status == "substituido")
            {
                var vig = await conn.QuerySingleOrDefaultAsync(
                    "SELECT * FROM pub_vigente_certificado(@id)", new { id = (Guid)certo.id });
                if (vig is not null)
                {
                    vigenteNumero = (string?)vig.numero;
                    vigenteUuid = (Guid?)vig.uuid_validacao;
                }
            }

            return Results.Ok(new {
                valido = true, certificado = certo,
                vigente_numero = vigenteNumero, vigente_uuid = vigenteUuid
            });
        });

        // Validação com ESTADOS — reconhece certificado em processamento
        // (etiqueta colada na balança antes da aprovação do RT).
        app.MapGet("/api/validar-estado/{uuid:guid}", async (Guid uuid, HttpContext ctx, NpgsqlDataSource ds) =>
        {
            await using var conn = await ds.OpenConnectionAsync();
            var cert = await conn.QuerySingleOrDefaultAsync(
                "SELECT * FROM validar_certificado_estado(@uuid)", new { uuid });

            // Registra a consulta (evidência de acesso via QR/link)
            try
            {
                var alvo = await conn.QuerySingleOrDefaultAsync<(Guid? certificado_id, Guid? empresa_id, Guid? cliente_id)>(
                    "SELECT * FROM pub_ids_certificado(@uuid)", new { uuid });
                var xff = ctx.Request.Headers["X-Forwarded-For"].ToString();
                var ip = !string.IsNullOrWhiteSpace(xff) ? xff.Split(',')[0].Trim()
                    : ctx.Connection.RemoteIpAddress?.ToString();
                var ua = ctx.Request.Headers.UserAgent.ToString();
                await conn.ExecuteAsync("""
                    INSERT INTO consulta_certificado (certificado_id, empresa_id, cliente_id,
                        uuid_validacao, origem, ip, user_agent)
                    VALUES (@certId, @empresaId, @clienteId, @uuid, 'qrcode', @ip, @ua)
                    """, new { certId = alvo.certificado_id, empresaId = alvo.empresa_id,
                        clienteId = alvo.cliente_id, uuid, ip, ua });
            }
            catch { }

            return cert is null
                ? Results.Ok(new { estado = "indisponivel" })
                : Results.Ok(cert);
        });

        // QR code (PNG) apontando para a validação pública — sem auth,
        // pois é embutido na etiqueta/página; só expõe o uuid, nada sensível
        app.MapGet("/api/validar/{uuid:guid}/qr", (Guid uuid, HttpContext ctx, IConfiguration cfg) =>
        {
            var urlBase = cfg["App:UrlBase"] ?? $"{ctx.Request.Scheme}://{ctx.Request.Host}";
            var dados = new QRCoder.QRCodeGenerator().CreateQrCode(
                $"{urlBase}/validar/{uuid}", QRCoder.QRCodeGenerator.ECCLevel.M);
            var png = new QRCoder.PngByteQRCode(dados).GetGraphic(10);
            return Results.File(png, "image/png");
        });

        app.MapGet("/api/validar/{uuid:guid}/pesos", async (Guid uuid, NpgsqlDataSource ds) =>
        {
            await using var conn = await ds.OpenConnectionAsync();
            var rows = await conn.QueryAsync(
                "SELECT * FROM pub_pesos_certificado(@uuid)", new { uuid });
            return Results.Ok(rows);
        });

        // Download público do PDF do certificado (pelo uuid de validação)
        app.MapGet("/api/validar/{uuid:guid}/pdf", async (Guid uuid,
            NpgsqlDataSource ds, IConfiguration cfg) =>
        {
            await using var conn = await ds.OpenConnectionAsync();
            var pdfUrl = await conn.ExecuteScalarAsync<string?>(
                "SELECT pub_pdf_certificado(@uuid)", new { uuid });
            return await ServirS3(pdfUrl, cfg, "certificado.pdf");
        });

        // Download público do PDF de um peso padrão — SÓ se o peso rastreia
        // o certificado deste uuid (impede varredura arbitrária de pesos)
        app.MapGet("/api/validar/{uuid:guid}/peso/{pesoId:guid}", async (Guid uuid,
            Guid pesoId, NpgsqlDataSource ds, IConfiguration cfg) =>
        {
            await using var conn = await ds.OpenConnectionAsync();
            var url = await conn.ExecuteScalarAsync<string?>(
                "SELECT pub_pdf_peso(@uuid, @pesoId)", new { uuid, pesoId });
            return await ServirS3(url, cfg, "certificado-peso.pdf");
        });

        // Preview do modelo: gera um PDF de exemplo a partir do último
        // certificado emitido da empresa, no modelo pedido (não altera nada)

        // ── Prévia do PDF antes de aprovar (marca "AGUARDANDO APROVAÇÃO") ──
        app.MapPost("/api/certificados/{id:guid}/previa-aprovacao", async (Guid id,
            ClaimsPrincipal user, NpgsqlDataSource ds, IConnectionMultiplexer redis) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var st = await conn.ExecuteScalarAsync<string?>(
                "SELECT status FROM certificado WHERE id = @id", new { id });
            if (st is null) return Results.NotFound();
            if (st != "aguardando_aprovacao")
                return Results.BadRequest(new { erro = "A prévia é para certificados aguardando aprovação." });
            var token = Guid.NewGuid().ToString("N")[..8];
            await redis.GetDatabase().ListLeftPushAsync("fila:tarefas",
                System.Text.Json.JsonSerializer.Serialize(new {
                    tipo = "preview_aprovacao", certificado_id = id.ToString(), token }));
            return Results.Ok(new { gerando = true, token });
        }).RequireAuthorization();

        // Serve a prévia gerada (mesmo padrão do preview de modelo)
        app.MapGet("/api/certificados/previa-aprovacao", async (string token,
            ClaimsPrincipal user, NpgsqlDataSource ds, IConfiguration cfg) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var empresa = await conn.ExecuteScalarAsync<string>(
                "SELECT razao_social FROM empresa WHERE id = current_empresa_id()");
            var chave = $"previews/{empresa?.Replace("/", "-")}-{token}-preview.pdf";
            var bucket = cfg["S3:Bucket"] ?? "certificados";
            return await ServirS3($"s3://{bucket}/{chave}", cfg, "previa-certificado.pdf");
        }).RequireAuthorization();

        app.MapPost("/api/preview-modelo", async (System.Text.Json.JsonElement body,
            ClaimsPrincipal user, NpgsqlDataSource ds, IConnectionMultiplexer redis) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            var modelo = body.TryGetProperty("modelo", out var m) ? m.GetString() : "classico";
            var token = System.Guid.NewGuid().ToString("N")[..8];
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var certId = await conn.ExecuteScalarAsync<Guid?>(
                "SELECT id FROM certificado WHERE status='emitido' ORDER BY data_emissao DESC LIMIT 1");
            if (certId is null)
                return Results.BadRequest(new { erro = "Emita ao menos um certificado para ver o exemplo." });
            await redis.GetDatabase().ListLeftPushAsync("fila:tarefas",
                System.Text.Json.JsonSerializer.Serialize(new {
                    tipo = "preview_modelo", certificado_id = certId.ToString(), modelo, token }));
            return Results.Ok(new { gerando = true, token });
        }).RequireAuthorization();

        // Serve o PDF de preview gerado (a empresa do usuário)
        app.MapGet("/api/preview-modelo", async (string token, ClaimsPrincipal user,
            NpgsqlDataSource ds, IConfiguration cfg) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var empresa = await conn.ExecuteScalarAsync<string>(
                "SELECT razao_social FROM empresa WHERE id = current_empresa_id()");
            var chave = $"previews/{empresa?.Replace("/", "-")}-{token}-preview.pdf";
            var bucket = cfg["S3:Bucket"] ?? "certificados";
            return await ServirS3($"s3://{bucket}/{chave}", cfg, "exemplo-modelo.pdf");
        }).RequireAuthorization();
    }

    // Baixa um objeto S3 (s3://bucket/chave) e devolve como PDF; usada
    // pelos downloads públicos, que já validaram o vínculo pelo uuid
    private static async Task<IResult> ServirS3(string? s3url, IConfiguration cfg, string nome)
    {
        if (string.IsNullOrEmpty(s3url)) return Results.NotFound();
        var semPrefixo = s3url.Replace("s3://", "");
        var barra = semPrefixo.IndexOf('/');
        var bucket = semPrefixo[..barra];
        var chave = semPrefixo[(barra + 1)..];
        var s3 = new Amazon.S3.AmazonS3Client(cfg["S3:AccessKey"], cfg["S3:SecretKey"],
            new Amazon.S3.AmazonS3Config
            {
                ServiceURL = cfg["S3:Endpoint"] ?? "http://minio:9000",
                ForcePathStyle = true, AuthenticationRegion = "us-east-1"
            });
        try
        {
            using var r = await s3.GetObjectAsync(bucket, chave);
            using var ms = new MemoryStream();
            await r.ResponseStream.CopyToAsync(ms);
            return Results.File(ms.ToArray(), "application/pdf", nome);
        }
        catch (Amazon.S3.AmazonS3Exception) { return Results.NotFound(); }
    }
}
