using System.IO;
using System.Security.Cryptography;
using System.Text.Json;
using CertSaas.Worker;
using Dapper;
using MailKit.Net.Smtp;
using MimeKit;
using Npgsql;
using QRCoder;
using StackExchange.Redis;

var builder = Host.CreateApplicationBuilder(args);

builder.Services.AddSingleton<IConnectionMultiplexer>(_ =>
    ConnectionMultiplexer.Connect(builder.Configuration["Redis:Connection"] ?? "redis:6379"));
builder.Services.AddNpgsqlDataSource(
    builder.Configuration.GetConnectionString("Default")
    ?? throw new InvalidOperationException("ConnectionStrings__Default nao configurada."));
builder.Services.AddSingleton<Armazenamento>();
builder.Services.AddHostedService<FilaWorker>();

Dapper.DefaultTypeMap.MatchNamesWithUnderscores = true;
builder.Build().Run();

// ================================================================
public sealed class FilaWorker(
    IConnectionMultiplexer redis, NpgsqlDataSource db,
    Armazenamento storage, IConfiguration cfg, ILogger<FilaWorker> log)
    : BackgroundService
{
    const string Fila = "fila:tarefas";
    const string FilaEmails = "fila:emails";   // fila de e-mails com envio cadenciado

    // Cadência de envio de e-mail (protege contra limite do SMTP / spam):
    // intervalo mínimo entre envios e teto por hora. Locaweb comum: 500/h por
    // domínio — mantemos folga. Configurável por env se precisar.
    static readonly int IntervaloEmailMs = int.TryParse(
        Environment.GetEnvironmentVariable("EMAIL_INTERVALO_MS"), out var iv) ? iv : 4000;  // ~1 a cada 4s
    static readonly int TetoEmailPorHora = int.TryParse(
        Environment.GetEnvironmentVariable("EMAIL_TETO_HORA"), out var th) ? th : 400;       // teto/hora seguro
    DateTime _ultimoEmailEnviado = DateTime.MinValue;
    DateTime _janelaHoraInicio = DateTime.MinValue;
    int _emailsNaJanela = 0;
    const int MaxTentativasEmail = 3;      // 1ª imediata, depois +15s e +60s
    int _tentativaAtual = 1;

    public static int ContarCasas(decimal divisao)
    {
        if (divisao <= 0) return 0;
        var s = divisao.ToString(System.Globalization.CultureInfo.InvariantCulture);
        var ponto = s.IndexOf('.');
        return ponto < 0 ? 0 : s[(ponto + 1)..].TrimEnd('0').Length;
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        log.LogInformation("Worker iniciado. Aguardando em '{Fila}'...", Fila);
        var r = redis.GetDatabase();
        while (!ct.IsCancellationRequested)
        {
            try
            {
                // Rotina diária (cobranças + alertas): 1x por dia, controlado
                // pelo BANCO — rebuild não faz repetir.
                var pausado = await EmailsPausados();
                if (!pausado && await PodeRodarHoje("processamento_diario"))
                {
                    try { await ProcessarDiario(); }
                    catch (Exception ex) { log.LogError(ex, "Falha no processamento diário"); }
                }

                // Lembrete gentil para empresa em avaliação que não está acessando.
                // 9h de dia útil: é convite comercial, não alarme de sistema.
                if (!pausado && DateTime.Now.Hour >= 9 && EhDiaUtilBr(DateTime.Now)
                    && await PodeRodarHoje("lembrete_acesso"))
                {
                    try { await LembrarAcessoAvaliacao(); }
                    catch (Exception ex) { log.LogWarning(ex, "lembrete de acesso falhou"); }
                }

                // E-mails com falha: resumo 1x por dia às 7h (todo dia) e
                // alerta de pico a cada volta (no máximo 1 por hora)
                if (!pausado && DateTime.Now.Hour >= 7 && await PodeRodarHoje("resumo_emails"))
                {
                    try { await ResumoEmailsFalhaDiario(); }
                    catch (Exception ex) { log.LogWarning(ex, "resumo de e-mails falhou"); }
                }
                if (!pausado && await PodeRodarIntervalo("pico_emails", TimeSpan.FromHours(1)))
                {
                    try { await AvisarPicoEmails(); }
                    catch (Exception ex) { log.LogWarning(ex, "checagem de pico de e-mail falhou"); }
                }

                // Teste de restauração do backup: avisa quando um teste novo
                // roda e cobra quando faz muito tempo que não roda
                if (!pausado && DateTime.Now.Hour >= 7 && await PodeRodarHoje("aviso_backup"))
                {
                    try { await AvisarTesteBackup(); }
                    catch (Exception ex) { log.LogWarning(ex, "aviso do teste de backup falhou"); }
                }

                // Erros do sistema: resumo 1x por dia às 7h. TODO DIA, inclusive
                // fim de semana e feriado — falha em produção não espera segunda.
                if (!pausado && DateTime.Now.Hour >= 7 && await PodeRodarHoje("resumo_erros"))
                {
                    try { await ResumoErrosDiario(); }
                    catch (Exception ex) { log.LogWarning(ex, "resumo de erros falhou"); }
                }

                // Pico de erros: checa a cada volta; avisa no máximo 1x por hora
                if (!pausado && await PodeRodarIntervalo("pico_erros", TimeSpan.FromHours(1)))
                {
                    try { await AvisarPicoErros(); }
                    catch (Exception ex) { log.LogWarning(ex, "checagem de pico falhou"); }
                }

                // Aviso de aprovações pendentes: 1x por dia, só APÓS as 7h
                // (horário útil; também evita duplicar no reboot automático ~4h30)
                if (!pausado && DateTime.Now.Hour >= 7 && EhDiaUtilBr(DateTime.Now)
                    && await PodeRodarHoje("aviso_aprovacoes"))
                {
                    try { await AvisarAprovacoesPendentes(); }
                    catch (Exception ex) { log.LogError(ex, "Falha no aviso de aprovações"); }
                }

                // Expurgo do log de auditoria: roda 1x por dia, mas só APÓS as 4h,
                // garantindo que o backup diário (3h) já salvou os dados antes.
                if (DateTime.Now.Hour >= 4 && await PodeRodarHoje("expurgo_log"))
                {
                    try { await ExpurgarLogAntigo(); }
                    catch (Exception ex) { log.LogError(ex, "Falha no expurgo do log"); }
                }

                // Processa 1 e-mail da fila cadenciada, se houver e se o
                // intervalo/teto permitir. Isso espalha os envios no tempo.
                await ProcessarUmEmailCadenciado(r);
                await ColetarMetricas();

                var item = await r.ListRightPopAsync(Fila);
                if (item.IsNullOrEmpty) { await Task.Delay(1000, ct); continue; }

                tarefaAtual = item!.ToString();
                var t = JsonDocument.Parse(tarefaAtual).RootElement;
                var tipo = t.GetProperty("tipo").GetString();
                if (tipo == "gerar_pdf")
                    await GerarPdf(Guid.Parse(t.GetProperty("certificado_id").GetString()!));
                else if (tipo == "preview_modelo")
                    await GerarPdf(Guid.Parse(t.GetProperty("certificado_id").GetString()!),
                        t.GetProperty("modelo").GetString(), preview: true,
                        previewToken: t.TryGetProperty("token", out var tk) ? tk.GetString() : null);
                else if (tipo == "preview_aprovacao")
                    await GerarPdf(Guid.Parse(t.GetProperty("certificado_id").GetString()!),
                        null, preview: true,
                        previewToken: t.GetProperty("token").GetString(),
                        marcaPreview: "AGUARDANDO APROVACAO");
                else if (tipo == "email_certificados_lote")
                    await EmailCertificadosLote(t);
                else if (tipo == "email_revisao_emitida")
                    await EmailRevisaoEmitida(Guid.Parse(t.GetProperty("certificado_id").GetString()!));
                else if (tipo == "exportar_empresa")
                    await ExportarEmpresa(Guid.Parse(t.GetProperty("exportacao_id").GetString()!));
                else if (tipo == "psaas_enviar")
                    await PsaasEnviar(t);
                else if (tipo == "psaas_alerta_detrator")
                    await PsaasAlertaDetrator(t);
                else if (tipo == "email_convite")
                    await EmailConvite(Guid.Parse(t.GetProperty("usuario_id").GetString()!));
                else if (tipo == "email_reset_senha")
                    await EmailResetSenha(Guid.Parse(t.GetProperty("usuario_id").GetString()!),
                        t.GetProperty("link").GetString()!);
                else if (tipo == "email_confirmacao")
                    await EmailConfirmacao(Guid.Parse(t.GetProperty("usuario_id").GetString()!));
                else if (tipo == "email_teste")
                    await EnviarEmailSimples(t.GetProperty("para").GetString()!, "Teste",
                        "✅ Teste de email — sistema de certificados",
                        "<p>Este é um email de teste do sistema de certificados.</p>" +
                        "<p>Se você o recebeu, a configuração SMTP está funcionando.</p>", "teste");
                else if (tipo == "email_chamado")
                    await EmailChamado(
                        t.GetProperty("chamado_id").GetString()!,
                        t.GetProperty("destino").GetString()!);
                else if (tipo == "email_portal_validacao")
                    await EmailPortalValidacao(
                        t.GetProperty("email").GetString()!,
                        t.GetProperty("token").GetString()!);
                else if (tipo == "email_solicitacao_calibracao")
                    await EmailSolicitacaoCalibracao(
                        Guid.Parse(t.GetProperty("solicitacao_id").GetString()!));
                else if (tipo == "email_portal_senha")
                    await EmailPortalSenha(
                        t.GetProperty("email").GetString()!,
                        t.TryGetProperty("nome", out var pns) ? pns.GetString() : null,
                        t.GetProperty("token").GetString()!);
                else if (tipo == "email_portal_convite")
                    await EmailPortalConvite(
                        t.GetProperty("email").GetString()!,
                        t.TryGetProperty("nome", out var pn) ? pn.GetString() : null,
                        t.GetProperty("token").GetString()!);
                else if (tipo == "email_portal_boasvindas")
                    await EmailPortalBoasVindas(t.GetProperty("email").GetString()!);
                else if (tipo == "aviso_vencimento_manual")
                    await ProcessarAvisosVencimento(
                        Guid.Parse(t.GetProperty("empresa_id").GetString()!),
                        t.TryGetProperty("cliente_id", out var cid) && cid.ValueKind != JsonValueKind.Null
                            ? Guid.Parse(cid.GetString()!) : (Guid?)null,
                        "manual",
                        t.TryGetProperty("usuario_id", out var uid) && uid.ValueKind != JsonValueKind.Null
                            ? Guid.Parse(uid.GetString()!) : (Guid?)null);
                else if (tipo == "pesquisa_manual")
                    await ProcessarPesquisas(
                        Guid.Parse(t.GetProperty("empresa_id").GetString()!),
                        t.TryGetProperty("cliente_id", out var pcid) && pcid.ValueKind != JsonValueKind.Null
                            ? Guid.Parse(pcid.GetString()!) : (Guid?)null,
                        "manual");
                else if (tipo == "pesquisa_teste")
                    await ProcessarPesquisaTeste(
                        Guid.Parse(t.GetProperty("empresa_id").GetString()!),
                        t.GetProperty("email").GetString()!);
                else
                    log.LogWarning("Tarefa desconhecida: {Tipo}", tipo);
            }
            catch (OperationCanceledException) { break; }
            catch (Exception ex)
            {
                log.LogError(ex, "Erro ao processar tarefa.");
                // REGISTRA em erro_sistema. Sem isto, a falha fica só no log
                // do container: não aparece na tela 🐞 Erros, não entra no
                // resumo das 7h e ninguém fica sabendo. Foi assim que a
                // geração de PDF passou dias quebrada sem alarme nenhum.
                await RegistrarErroWorker(ex, tarefaAtual);
                await Task.Delay(2000, ct);
            }
        }
    }

    // Registra falha do worker em erro_sistema, para aparecer na tela de
    // erros e no resumo diário — como já acontece com os erros da API.
    string? tarefaAtual;
    async Task RegistrarErroWorker(Exception ex, string? tarefa)
    {
        try
        {
            // tenta identificar a empresa pelo certificado da tarefa
            Guid? empresaId = null;
            try
            {
                if (tarefa is not null)
                {
                    var t = JsonDocument.Parse(tarefa).RootElement;
                    if (t.TryGetProperty("certificado_id", out var cid) &&
                        Guid.TryParse(cid.GetString(), out var certId))
                    {
                        await using var c2 = await db.OpenConnectionAsync();
                        empresaId = await c2.ExecuteScalarAsync<Guid?>(
                            "SELECT empresa_id FROM certificado WHERE id = @id",
                            new { id = certId });
                    }
                }
            }
            catch { /* sem empresa: registra assim mesmo */ }

            var tipoTarefa = "worker";
            try
            {
                if (tarefa is not null)
                    tipoTarefa = "worker:" + JsonDocument.Parse(tarefa).RootElement
                        .GetProperty("tipo").GetString();
            }
            catch { }

            await using var conn = await db.OpenConnectionAsync();
            await conn.ExecuteAsync("""
                INSERT INTO erro_sistema (tipo, metodo, rota, mensagem, detalhe, empresa_id)
                VALUES (@tipo, 'WORKER', @rota, @msg, @det, @emp)
                """, new
            {
                tipo = ex.GetType().Name,
                rota = tipoTarefa,
                msg = ex.Message.Length > 500 ? ex.Message[..500] : ex.Message,
                det = (tarefa is null ? "" : "tarefa: " + tarefa + "\n\n") + ex.ToString(),
                emp = empresaId
            });
        }
        catch (Exception e2)
        {
            // não deixar o registro do erro derrubar o worker
            log.LogWarning(e2, "não consegui registrar a falha em erro_sistema");
        }
    }

    async Task EmailResetSenha(Guid usuarioId, string link)
    {
        await using var conn = await db.OpenConnectionAsync();
        var u = await conn.QuerySingleOrDefaultAsync(
            "SELECT nome, email FROM usuario WHERE id = @id", new { id = usuarioId });
        if (u is null) return;
        var html = $"""
            <p>Olá, <b>{(string)u.nome}</b>!</p>
            <p>Recebemos um pedido para redefinir a sua senha no sistema de certificados.</p>
            <p style="margin:18px 0">
              <a href="{link}" style="background:#1e3a5f;color:#ffffff;padding:12px 24px;
                 border-radius:6px;text-decoration:none;font-weight:bold">Redefinir minha senha</a></p>
            <p>Ou copie e cole este link no navegador:<br><a href="{link}">{link}</a></p>
            <p>O link vale por <b>1 hora</b>. Se você não pediu a redefinição, ignore este email —
               sua senha continuará a mesma.</p>
            """;
        await EnviarEmailSimples((string)u.email, (string)u.nome,
            "🔑 Redefinição de senha — Certificados", html, "reset_senha");
    }

    async Task GerarPdf(Guid id, string? modeloForcado = null, bool preview = false, string? previewToken = null, string? marcaPreview = null)
    {
        await using var conn = await db.OpenConnectionAsync();

        var c = await conn.QuerySingleOrDefaultAsync<CabecalhoCert>("""
            SELECT ct.numero, ct.data_calibracao AS DataCalibracao,
                   ct.data_emissao AS DataEmissao, ct.temperatura, ct.umidade,
                   ct.contexto_ema AS ContextoEma, ct.uuid_validacao AS UuidValidacao,
                   ct.metodo_snapshot AS MetodoSnapshot, ct.numero_lacre AS NumeroLacre, ct.selo_inmetro AS SeloInmetro,
                   ct.revisao_num AS RevisaoNum, orig.numero AS SubstituiNumero,
                   ct.local_tipo AS LocalTipo, ct.local_detalhe AS LocalDetalhe, ct.houve_ajuste AS HouveAjuste,
                   e.razao_social AS Empresa,
                   COALESCE(NULLIF(e.nome_fantasia,''), e.razao_social) AS NomeFantasia,
                   e.clausula_substituicao AS ClausulaSubstituicao,
                   ct.dados_rascunho->>'substituicao' AS SubstituicaoJson,
                   e.endereco AS EnderecoEmpresa,
                   e.cidade_uf AS CidadeUfEmpresa, e.num_autorizacao AS NumAutorizacao,
                   e.acreditada, e.texto_periodicidade AS TextoPeriodicidade, e.titulo_documento AS TituloDocumento,
                   e.texto_rodape AS TextoRodape, e.cor_marca AS CorMarca, e.logo_url AS LogoUrl, e.texto_autorizacao AS TextoAutorizacao,
                   e.mostra_validade AS MostraValidade,
                   e.modelo_certificado AS ModeloCertificado,
                   cl.razao_social AS Cliente, cl.cidade AS CidadeCliente, cl.uf AS UfCliente,
                   cl.endereco AS EnderecoCliente, cl.cnpj AS CnpjCliente,
                   b.identificacao AS Balanca, b.marca AS Marca, b.modelo AS Modelo, b.num_serie AS NumSerie,
                   b.capacidade, b.divisao_e AS DivisaoE, b.divisao_d AS DivisaoD, b.classe_exatidao AS ClasseExatidao,
                   b.local_instalacao AS LocalInstalacao, b.unidade AS Unidade,
                   b.numero_inmetro AS NumeroInmetro, b.patrimonio AS Patrimonio,
                   b.portaria_aprovacao AS PortariaAprovacao, b.periodicidade_meses AS PeriodicidadeMeses,
                   ut.nome AS Tecnico, ua.nome AS Aprovador,
                   ua.registro_prof AS RegistroAprovador,
                   ut.assinatura_url AS AssinaturaTecnicoUrl,
                   ua.assinatura_url AS AssinaturaAprovadorUrl,
                   b.num_serie_indicador AS NumSerieIndicador,
                   b.faz_excentricidade AS FazExcentricidade, b.faz_sensibilidade AS FazSensibilidade,
                   e.logo_largura AS LogoLargura, e.logo_altura AS LogoAltura, e.logo_alinhamento AS LogoAlinhamento,
                   -- ORDEM IMPORTA: o record CabecalhoCert é posicional, então
                   -- estas colunas ficam NO FIM, na mesma ordem em que foram
                   -- declaradas lá. Colocá-las no meio quebra o Dapper com
                   -- "A parameterless default constructor ... is required".
                   -- Ao adicionar um campo novo: acrescente no fim do record E
                   -- no fim desta lista, nunca no meio.
                   ct.ordem_servico AS OrdemServico, ct.endereco_calibracao AS EnderecoCalibracao,
                   e.marca_sistema_pdf AS MarcaSistema,
                   e.instrucao_it AS InstrucaoIt, e.instrucao_rev AS InstrucaoRev
              FROM certificado ct
              JOIN empresa e  ON e.id = ct.empresa_id
              JOIN cliente cl ON cl.id = ct.cliente_id
              JOIN balanca b  ON b.id = ct.balanca_id
              JOIN usuario ut ON ut.id = ct.tecnico_id
              LEFT JOIN usuario ua ON ua.id = ct.aprovador_id
              LEFT JOIN certificado orig ON orig.id = ct.substitui_id
              WHERE ct.id = @id
            """, new { id });
        if (c is null) { log.LogWarning("Certificado {Id} nao encontrado.", id); return; }

        var ind = (await conn.QueryAsync<LinhaIndicacao>("""
            SELECT carga_aplicada AS Carga, indicacao AS Indicacao, erro AS Erro,
                   incerteza AS Incerteza, ema AS Ema, aprovado AS Aprovado,
                   indicacao_antes AS IndicacaoAntes, sem_leitura AS SemLeitura,
                   sem_leitura_antes AS SemLeituraAntes
              FROM ensaio_indicacao WHERE certificado_id=@id ORDER BY ordem
            """, new { id })).ToList();
        var exc = (await conn.QueryAsync<LinhaExc>("""
            SELECT posicao AS Posicao, carga AS Carga, indicacao AS Indicacao, erro AS Erro,
                   ema AS Ema, aprovado AS Aprovado, indicacao_antes AS IndicacaoAntes
              FROM ensaio_excentricidade WHERE certificado_id=@id
            """, new { id })).ToList();
        var rep = (await conn.QueryAsync<LinhaRep>("""
            SELECT medicao_num AS Medicao, carga AS Carga, indicacao AS Indicacao
              FROM ensaio_repetibilidade WHERE certificado_id=@id ORDER BY medicao_num
            """, new { id })).ToList();
        var pesos = (await conn.QueryAsync<LinhaPeso>("""
            SELECT pp.identificacao AS Identificacao, pp.valor_nominal AS ValorNominal,
                   pp.classe AS Classe, pp.unidade AS Unidade, cp.num_cert_peso AS NumCertificado,
                   pp.data_calibracao AS DataCalibracao, cp.validade_na_data AS Validade,
                   pp.laboratorio AS Laboratorio
              FROM certificado_peso cp JOIN peso_padrao pp ON pp.id = cp.peso_padrao_id
             WHERE cp.certificado_id=@id
            """, new { id })).ToList();

        var sens = await conn.QuerySingleOrDefaultAsync<LinhaSensibilidade>("""
            SELECT carga_referencia AS CargaReferencia, adicao AS Adicao,
                   resultado_display AS ResultadoDisplay
              FROM ensaio_sensibilidade WHERE certificado_id=@id
            """, new { id });

        // Faixas (multi-intervalo) da balança deste certificado
        var faixas = (await conn.QueryAsync<FaixaPdf>("""
            SELECT bf.ordem AS Ordem, bf.limite_sup AS LimiteSup, bf.divisao_e AS DivisaoE
              FROM balanca_faixa bf
              JOIN certificado ct ON ct.balanca_id = bf.balanca_id
             WHERE ct.id = @id ORDER BY bf.ordem
            """, new { id })).ToList();

        var urlBase = cfg["App:UrlBase"] ?? "https://certificados.minasbalancas.com.br";
        var uuidVal = c.UuidValidacao.ToString();

        var qrData = new QRCodeGenerator().CreateQrCode(
            $"{urlBase}/validar/{uuidVal}", QRCodeGenerator.ECCLevel.M);
        var qrPng = new PngByteQRCode(qrData).GetGraphic(8);

        // ── Dados do certificado RBC (se for acreditado) ──────────
        DadosRbc? dadosRbc = null;
        var ehRbc = await conn.ExecuteScalarAsync<bool>(
            "SELECT COALESCE(emitir_rbc,false) FROM certificado WHERE id=@id", new { id });
        if (ehRbc)
        {
            var resultados = (await conn.QueryAsync<LinhaResultadoRbc>(
                "SELECT carga AS Carga, media AS Media, erro AS Erro, " +
                "u_expandida AS U, k AS K, veff AS Veff, " +
                "u_rep AS URep, u_res AS URes, u_pad AS UPad, u_exc AS UExc, " +
                "u_buoy AS UBuoy, u_sub AS USub, u_c AS UC, degraus_sub AS DegrausSub " +
                "FROM incerteza_ponto_rbc WHERE certificado_id=@id ORDER BY ordem_ponto",
                new { id })).ToList();

            var excBruta = (await conn.QueryAsync(
                "SELECT ordem_posicao, nome_posicao, avg(indicacao) AS media " +
                "FROM excentricidade_rbc WHERE certificado_id=@id " +
                "GROUP BY ordem_posicao, nome_posicao ORDER BY ordem_posicao",
                new { id })).ToList();
            decimal? mediaCentro = excBruta.Count > 0 ? (decimal?)excBruta[0].media : null;
            var excRbc = excBruta.Select(x => new LinhaExcRbc(
                (string)(x.nome_posicao ?? x.ordem_posicao.ToString()),
                (decimal)x.media,
                mediaCentro is null ? 0m : (decimal)x.media - mediaCentro.Value)).ToList();
            decimal? maiorErro = excRbc.Count > 1
                ? excRbc.Skip(1).Max(x => Math.Abs(x.Erro)) : (decimal?)null;

            var mobRbc = (await conn.QueryAsync<LinhaMobRbc>(
                "SELECT ordem_leitura AS Ordem, display_leu AS Leitura " +
                "FROM mobilidade_rbc WHERE certificado_id=@id ORDER BY ordem_leitura",
                new { id })).ToList();
            var mobCab = await conn.QuerySingleOrDefaultAsync(
                "SELECT carga_referencia, divisao_e, esperado FROM mobilidade_rbc " +
                "WHERE certificado_id=@id ORDER BY ordem_leitura LIMIT 1", new { id });

            var pesosRbc = (await conn.QueryAsync<LinhaPesoRbc>(
                "SELECT ordem_ponto AS OrdemPonto, peso_identificacao AS Identificacao, " +
                "valor_nominal AS ValorNominal, valor_convencional AS Convencional, " +
                "incerteza AS Incerteza, num_certificado AS NumCertificado " +
                "FROM carga_peso_rbc WHERE certificado_id=@id ORDER BY ordem_ponto, peso_identificacao",
                new { id })).ToList();

            var numAcred = await conn.ExecuteScalarAsync<string?>(
                "SELECT e.num_acreditacao FROM empresa e " +
                "JOIN certificado ct ON ct.empresa_id = e.id WHERE ct.id=@id", new { id });
            var pressaoRbc = await conn.ExecuteScalarAsync<decimal?>(
                "SELECT pressao FROM certificado WHERE id=@id", new { id });

            dadosRbc = new DadosRbc(numAcred, pressaoRbc,
                mobCab?.carga_referencia, mobCab?.divisao_e, mobCab?.esperado,
                maiorErro, resultados, excRbc, mobRbc, pesosRbc);
        }

        // ── Método da SUBSTITUIÇÃO (lote de carga) — Fase 1 ──
        // O ensaio marca pontos no rascunho (substituicao.degraus); aqui viram
        // asterisco na tabela e a nota do método nas observações do PDF.
        List<decimal>? subCargas = null; string? notaSub = null;
        try
        {
            var sjRaw = (string?)c.SubstituicaoJson;
            if (!string.IsNullOrWhiteSpace(sjRaw))
            {
                var se = JsonDocument.Parse(sjRaw).RootElement;
                if (se.TryGetProperty("ativa", out var sAtv) && sAtv.ValueKind == JsonValueKind.True
                    && se.TryGetProperty("degraus", out var sDeg) && sDeg.ValueKind == JsonValueKind.Object)
                {
                    subCargas = new();
                    foreach (var pr in sDeg.EnumerateObject())
                        if (decimal.TryParse(pr.Name, System.Globalization.NumberStyles.Any,
                            System.Globalization.CultureInfo.InvariantCulture, out var cgSub))
                            subCargas.Add(cgSub);
                    if (subCargas.Count == 0) subCargas = null;
                    else
                    {
                        var somaSub = se.TryGetProperty("somaPadroesKg", out var sk)
                            && sk.ValueKind == JsonValueKind.Number ? sk.GetDecimal() : 0m;
                        var descSub = se.TryGetProperty("descricao", out var sd)
                            && sd.ValueKind == JsonValueKind.String ? sd.GetString() : null;
                        var clauSub = (string?)c.ClausulaSubstituicao;
                        notaSub = "Pontos assinalados com * realizados pelo método da substituição"
                            + (somaSub > 0 ? ", utilizando pesos-padrão totalizando "
                                + somaSub.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture)
                                    .Replace('.', ',') + " kg" : "")
                            + (string.IsNullOrWhiteSpace(descSub) ? "" : " e carga de substituição (" + descSub + ")")
                            + (string.IsNullOrWhiteSpace(clauSub) ? "." : ", conforme " + clauSub + ".");
                    }
                }
            }
        }
        catch { /* rascunho sem substituição ou malformado: segue sem nota */ }

        var dados = new DadosCertificado(
            c.Numero, c.Empresa, c.NomeFantasia, c.EnderecoEmpresa, c.CidadeUfEmpresa,
            c.NumAutorizacao, c.Acreditada,
            c.MetodoSnapshot ?? "-", c.TextoPeriodicidade, c.TituloDocumento,
            c.TextoRodape, c.CorMarca, c.TextoAutorizacao,
            c.Cliente, c.CidadeCliente, c.UfCliente, c.EnderecoCliente, c.CnpjCliente,
            c.Balanca, c.Marca, c.Modelo, c.NumSerie,
            c.Capacidade, c.DivisaoE, c.ClasseExatidao, c.LocalInstalacao,
            ((string?)c.Unidade ?? "kg").Trim().ToLowerInvariant(), FilaWorker.ContarCasas(
                faixas.Count > 0
                    // Multi-intervalo: usa só a menor divisão entre as FAIXAS.
                    // Nunca misturar com c.DivisaoE aqui — esse campo único
                    // fica em branco/0 numa balança multi-intervalo nova
                    // (o formulário não pede mais esse valor nesse caso), e
                    // Math.Min com 0 zeraria as casas decimais do PDF inteiro.
                    ? faixas.Min(f => f.DivisaoE)
                    : ((decimal?)c.DivisaoD is { } dd && dd > 0 ? Math.Min(dd, (decimal)c.DivisaoE) : (decimal)c.DivisaoE)),
            c.NumeroInmetro, c.Patrimonio, c.PortariaAprovacao,
            c.MostraValidade, c.PeriodicidadeMeses,
            c.NumeroLacre, c.SeloInmetro, c.SubstituiNumero,
            c.LocalTipo, c.LocalDetalhe, c.HouveAjuste,
            c.DataCalibracao, c.DataEmissao, c.Temperatura, c.Umidade, c.ContextoEma,
            c.Tecnico, c.Aprovador, c.RegistroAprovador,
            uuidVal, urlBase,
            modeloForcado ?? c.ModeloCertificado ?? "classico", sens,
            ind, exc, rep, pesos, faixas, dadosRbc, c.NumSerieIndicador,
            c.FazExcentricidade, c.FazSensibilidade,
            c.LogoLargura, c.LogoAltura, c.LogoAlinhamento,
            c.OrdemServico, c.EnderecoCalibracao, c.MarcaSistema,
            SubCargas: subCargas, NotaSubstituicao: notaSub,
            InstrucaoIt: c.InstrucaoIt, InstrucaoRev: c.InstrucaoRev);

        // Baixa o logo da empresa (se houver) para embutir no PDF
        byte[]? logoBytes = null;
        if (!string.IsNullOrEmpty(c.LogoUrl))
        {
            var semPrefixo = c.LogoUrl.Replace("s3://", "");
            var barra = semPrefixo.IndexOf('/');
            if (barra > 0)
                logoBytes = await storage.Ler(semPrefixo[(barra + 1)..]);
        }

        // Baixa as assinaturas (do técnico e do aprovador), se houver
        async Task<byte[]?> BaixarAssinatura(string? url)
        {
            if (string.IsNullOrEmpty(url)) return null;
            var sp = url.Replace("s3://", "");
            var b = sp.IndexOf('/');
            return b > 0 ? await storage.Ler(sp[(b + 1)..]) : null;
        }
        var assinTec = await BaixarAssinatura(c.AssinaturaTecnicoUrl);
        var assinApr = await BaixarAssinatura(c.AssinaturaAprovadorUrl);
        // Selo de acreditação RBC (só no certificado acreditado)
        byte[]? seloRbcPng = null;
        if (dadosRbc is not null)
        {
            var seloUrl = await conn.ExecuteScalarAsync<string?>(
                "SELECT e.selo_rbc_url FROM empresa e " +
                "JOIN certificado ct ON ct.empresa_id = e.id WHERE ct.id=@id", new { id });
            seloRbcPng = await BaixarAssinatura(seloUrl);
        }


        byte[] pdf;
        var marca = preview ? (marcaPreview ?? "TESTE") : null;
        try
        {
            pdf = GeradorPdf.Gerar(dados, qrPng, logoBytes, assinTec, assinApr, marca, seloRbcPng);
        }
        catch (Exception exLogo) when (logoBytes is not null)
        {
            // Se o logo causar problema de layout/decodificação, gera sem ele
            log.LogWarning(exLogo, "Falha ao gerar PDF com logo; gerando sem logo.");
            pdf = GeradorPdf.Gerar(dados, qrPng, null, assinTec, assinApr, marca, seloRbcPng);
        }

        // Modo preview: salva num caminho temporário e encerra (não altera o
        // certificado real nem envia email). A API serve esse arquivo.
        if (preview)
        {
            var chaveNome = string.IsNullOrEmpty(previewToken)
                ? (string.IsNullOrEmpty(modeloForcado) ? "classico" : modeloForcado)
                : previewToken;
            var caminhoPrev = $"previews/{c.Empresa.Replace("/", "-")}-{chaveNome}-preview.pdf";
            await storage.Salvar(caminhoPrev, pdf, "application/pdf");
            log.LogInformation("Preview gerado: {Numero} modelo={Modelo} token={Token}", c.Numero, modeloForcado, previewToken);
            return;
        }

        var hash = Convert.ToHexString(SHA256.HashData(pdf)).ToLowerInvariant();
        var caminho = $"certificados/{c.Numero.Replace("/", "-")}.pdf";
        var url = await storage.Salvar(caminho, pdf, "application/pdf");

        await conn.ExecuteAsync(
            "UPDATE certificado SET pdf_url=@url, hash_sha256=@hash WHERE id=@id",
            new { url, hash, id });
        log.LogInformation("PDF gerado: {Numero} ({Bytes} bytes)", c.Numero, pdf.Length);

        // ── Envio automático (João, 11/08/2026): configurável por empresa;
        // destinatários = e-mail do cadastro + contatos "recebe certificados";
        // usa o MESMO motor do lote (template novo, nome na saudação, log).
        var envAuto = await conn.ExecuteScalarAsync<bool?>(
            "SELECT e.envia_email_automatico FROM empresa e " +
            "JOIN certificado ct ON ct.empresa_id = e.id WHERE ct.id=@id", new { id }) ?? true;
        if (envAuto)
        {
            var destAuto = (await conn.QueryAsync<(string email, string? nome)>(
                "SELECT c2.email, NULL FROM cliente c2 " +
                " WHERE c2.id=(SELECT cliente_id FROM certificado WHERE id=@id) " +
                "   AND COALESCE(c2.email,'') <> '' " +
                "UNION " +
                "SELECT cc.email, cc.nome FROM cliente_contato cc " +
                " WHERE cc.cliente_id=(SELECT cliente_id FROM certificado WHERE id=@id) " +
                "   AND cc.recebe_certificado AND COALESCE(cc.email,'') <> ''",
                new { id }))
                .GroupBy(d => d.email.Trim().ToLowerInvariant())
                .Select(g => g.OrderByDescending(x => x.nome != null).First())
                .ToList();
            if (destAuto.Count > 0)
            {
                var elLote = System.Text.Json.JsonSerializer.SerializeToElement(new {
                    ids = new[] { id.ToString() },
                    destinatarios = destAuto.Select(d => new { email = d.email, nome = d.nome }).ToArray(),
                    mensagem = (string?)null });
                await EmailCertificadosLote(elLote);
            }
            else log.LogWarning("Certificado {Num}: emitido SEM destinatário de e-mail " +
                "(cadastro sem e-mail e nenhum contato marcado)", (string?)c.Numero);
        }

        else
            log.LogInformation("Cliente sem email; PDF disponivel no portal.");
    }

    // ── Emails de conta (convite / confirmação de cadastro) ─────
    async Task<dynamic?> DadosUsuario(Guid usuarioId)
    {
        await using var conn = await db.OpenConnectionAsync();
        return await conn.QuerySingleOrDefaultAsync("""
            SELECT u.nome, u.email, u.token_convite, e.razao_social AS empresa
              FROM usuario u JOIN empresa e ON e.id = u.empresa_id
             WHERE u.id = @usuarioId
            """, new { usuarioId });
    }

    async Task EmailConvite(Guid usuarioId)
    {
        var u = await DadosUsuario(usuarioId);
        if (u is null || u.token_convite is null) return;
        var urlBase = cfg["App:UrlBase"] ?? "https://certificados.minasbalancas.com.br";
        var link = $"{urlBase}/#convite={u.token_convite}";
        await EnviarEmailSimples((string)u.email, (string)u.nome,
            $"Defina sua senha — {u.empresa}", // motivo abaixo
            $"<p>Olá, {u.nome}!</p>" +
            $"<p>Você foi cadastrado no sistema de certificados da <b>{u.empresa}</b>.</p>" +
            $"<p>Para começar, defina sua senha de acesso clicando no link abaixo " +
            $"(válido por 7 dias):</p>" +
            $"<p><a href=\"{link}\">{link}</a></p>" +
            $"<p>Se você não esperava este email, ignore-o.</p>", "convite");
    }

    async Task EmailConfirmacao(Guid usuarioId)
    {
        var u = await DadosUsuario(usuarioId);
        if (u is null) return;
        var urlBase = cfg["App:UrlBase"] ?? "https://certificados.minasbalancas.com.br";
        await EnviarEmailSimples((string)u.email, (string)u.nome,
            $"Cadastro concluído — {u.empresa}",
            $"<p>Olá, {u.nome}!</p>" +
            $"<p>Sua senha foi definida com sucesso. Seus dados de acesso:</p>" +
            $"<p><b>Login:</b> {u.email}<br>" +
            $"<b>Endereço:</b> <a href=\"{urlBase}\">{urlBase}</a></p>" +
            $"<p>Bom trabalho!<br>{u.empresa}</p>", "cadastro_concluido");
    }

    // Config SMTP: banco (config_sistema) tem prioridade; env vars são reserva
    async Task<Dictionary<string, string?>> SmtpDoBanco()
    {
        try
        {
            await using var conn = await db.OpenConnectionAsync();
            var rows = await conn.QueryAsync<(string chave, string? valor)>(
                "SELECT chave, valor FROM config_sistema WHERE chave LIKE 'smtp_%'");
            return rows.ToDictionary(r => r.chave, r => r.valor);
        }
        catch { return new Dictionary<string, string?>(); }
    }

    async Task<(string? host, int port, string? user, string? pass, string from, string nome)> SmtpConfig()
    {
        var d = await SmtpDoBanco();
        string? V(string k) => d.TryGetValue(k, out var v) && !string.IsNullOrEmpty(v) ? v : null;
        var host = V("smtp_host") ?? cfg["Smtp:Host"];
        var port = int.TryParse(V("smtp_port") ?? cfg["Smtp:Port"], out var pt) ? pt : 1025;
        var user = V("smtp_user") ?? cfg["Smtp:User"];
        var pass = V("smtp_password") ?? cfg["Smtp:Password"];
        var from = V("smtp_from") ?? cfg["Smtp:From"] ?? "certificados@localhost";
        var nomeR = V("smtp_nome") ?? "Certificados";
        return (host, port, user, pass, from, nomeR);
    }

    // ── Rotina diária: gera cobranças do mês e alerta contratos vencendo ──
    // Dia útil no Brasil: exclui sábado/domingo e feriados nacionais
    // (fixos + móveis calculados pela Páscoa: Carnaval, Sexta Santa, Corpus Christi)
    static bool EhDiaUtilBr(DateTime d)
    {
        if (d.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday) return false;
        var dia = d.Date;
        // feriados fixos
        var fixos = new (int m, int dd)[] {
            (1, 1),   // Confraternização Universal
            (4, 21),  // Tiradentes
            (5, 1),   // Dia do Trabalho
            (9, 7),   // Independência
            (10, 12), // N. Sra. Aparecida
            (11, 2),  // Finados
            (11, 15), // Proclamação da República
            (11, 20), // Consciência Negra (Lei 14.759/2023)
            (12, 25)  // Natal
        };
        foreach (var (m, dd) in fixos)
            if (dia.Month == m && dia.Day == dd) return false;
        // Páscoa (algoritmo de Meeus) e feriados móveis
        int ano = dia.Year;
        int a = ano % 19, b = ano / 100, c = ano % 100;
        int dd2 = b / 4, e = b % 4, f = (b + 8) / 25, g = (b - f + 1) / 3;
        int h = (19 * a + b - dd2 - g + 15) % 30;
        int i = c / 4, k = c % 4;
        int l = (32 + 2 * e + 2 * i - h - k) % 7;
        int m2 = (a + 11 * h + 22 * l) / 451;
        int mes = (h + l - 7 * m2 + 114) / 31;
        int diaP = ((h + l - 7 * m2 + 114) % 31) + 1;
        var pascoa = new DateTime(ano, mes, diaP);
        if (dia == pascoa.AddDays(-48)) return false;  // segunda de Carnaval
        if (dia == pascoa.AddDays(-47)) return false;  // terça de Carnaval
        if (dia == pascoa.AddDays(-2)) return false;   // Sexta-feira Santa
        if (dia == pascoa.AddDays(60)) return false;   // Corpus Christi
        return true;
    }

    // Quem recebe os avisos técnicos do sistema (super-admins ativos)
    async Task<List<(string Nome, string Email)>> SuperAdmins(NpgsqlConnection conn)
    {
        var rows = await conn.QueryAsync("""
            SELECT nome, email FROM usuario
             WHERE papel = 'super_admin' AND ativo
               AND email IS NOT NULL AND email <> ''
            """);
        return rows.Select(r => ((string)r.nome, (string)r.email)).ToList();
    }

    // Resultado do TESTE DE RESTAURAÇÃO do backup.
    // Duas situações: (a) rodou um teste novo -> manda o resultado;
    // (b) faz mais de 40 dias que nenhum teste passa -> cobra (1x por semana).
    async Task AvisarTesteBackup()
    {
        await using var conn = await db.OpenConnectionAsync();
        var t = await conn.QuerySingleOrDefaultAsync(
            "SELECT * FROM backup_teste_pendente()");

        if (t is not null)
        {
            var ok = (string)t.resultado == "ok";
            var quando = ((DateTime)t.executado_em).ToLocalTime();
            var dumpEm = t.dump_em is null ? "—"
                : ((DateTime)t.dump_em).ToLocalTime().ToString("dd/MM/yyyy HH:mm");
            var corpo = ok
                ? "<p>O teste de restauração do backup rodou e <b style=\"color:#0f7a52\">" +
                  "passou</b>. Na prática: se o servidor morrer agora, o sistema volta.</p>"
                : "<p style=\"color:#b02a37\"><b>O teste de restauração do backup FALHOU.</b> " +
                  "Isso significa que o arquivo de backup pode não trazer os dados de volta — " +
                  "vale investigar hoje mesmo.</p>";
            corpo +=
                "<table style=\"border-collapse:collapse;font-size:14px;margin:14px 0\">" +
                $"<tr><td style=\"padding:5px 14px 5px 0\"><b>Quando</b></td><td>{quando:dd/MM/yyyy HH:mm}</td></tr>" +
                $"<tr><td style=\"padding:5px 14px 5px 0\"><b>Arquivo</b></td><td>{t.arquivo}</td></tr>" +
                $"<tr><td style=\"padding:5px 14px 5px 0\"><b>Dump de</b></td><td>{dumpEm}</td></tr>" +
                $"<tr><td style=\"padding:5px 14px 5px 0\"><b>Registros restaurados</b></td><td>{t.total_restaurado}</td></tr>" +
                $"<tr><td style=\"padding:5px 14px 5px 0\"><b>Erros do psql</b></td><td>{t.erros_psql}</td></tr>" +
                $"<tr><td style=\"padding:5px 14px 5px 0\"><b>Problemas</b></td><td>{t.problemas}</td></tr>" +
                "</table>" +
                $"<p style=\"color:#666;font-size:13px\">{t.detalhe}</p>" +
                (ok ? "<p>Próximo teste recomendado em <b>30 dias</b> — ou logo após mudanças " +
                      "grandes de estrutura do banco.</p>"
                    : "<p>Rode <code>./testar-restauracao.sh</code> no servidor para ver o detalhe, " +
                      "e confira o log em <code>/tmp/restauracao_teste.log</code>.</p>");

            foreach (var (nome, email) in await SuperAdmins(conn))
                await EnviarEmailSimples(email, nome,
                    ok ? "TSCert — teste de restauração do backup: OK ✅"
                       : "🚨 TSCert — teste de restauração do backup FALHOU",
                    corpo, "teste_backup");

            await conn.ExecuteAsync("SELECT backup_teste_marcar_avisado(@id)",
                new { id = (long)t.id });
            log.LogInformation("Aviso do teste de backup enviado ({Res}).", (string)t.resultado);
            return;
        }

        // (b) cobrança: nenhum teste bem-sucedido há muito tempo
        var atraso = await conn.ExecuteScalarAsync<int>("SELECT backup_teste_atraso()");
        if (atraso < 40) return;
        // cobrança no máximo 1x por semana (controle no banco)
        if (!await PodeRodarIntervalo("cobranca_backup", TimeSpan.FromDays(7))) return;

        var msg = atraso >= 9000
            ? "<p>O backup do banco roda todo dia, mas <b>nunca foi testado</b> — " +
              "ninguém sabe se ele restaura de verdade.</p>"
            : $"<p>Faz <b>{atraso} dias</b> que o backup não é testado.</p>";
        var corpo2 = msg +
            "<p>Backup que não se restaura é fé, não é backup — e o dia de descobrir " +
            "não pode ser o dia do problema.</p>" +
            "<p>No servidor, dentro de <code>~/cert-saas</code>:</p>" +
            "<pre style=\"background:#f4f7fb;padding:10px;border-radius:6px\">./testar-restauracao.sh</pre>" +
            "<p>Leva uns 2 minutos, sobe um banco temporário e não encosta na produção. " +
            "O resultado chega aqui automaticamente.</p>";
        foreach (var (nome, email) in await SuperAdmins(conn))
            await EnviarEmailSimples(email, nome,
                "TSCert — hora de testar o backup", corpo2, "teste_backup_cobranca");
        log.LogWarning("Cobrança do teste de backup enviada ({Dias} dias).", atraso);
    }

    // Resumo diário dos E-MAILS QUE FALHARAM nas últimas 24h.
    async Task ResumoEmailsFalhaDiario()
    {
        await using var conn = await db.OpenConnectionAsync();
        var tot = await conn.QuerySingleAsync("""
            SELECT count(*) FILTER (WHERE status = 'erro')   AS erros,
                   count(*)                                  AS total
              FROM email_log
             WHERE enviado_em >= now() - interval '24 hours'
            """);
        if ((long)tot.erros == 0) return;                    // nada falhou: silêncio

        var grupos = (await conn.QueryAsync("""
            SELECT coalesce(motivo, '—') AS motivo,
                   left(coalesce(erro_detalhe, 'sem detalhe'), 160) AS erro,
                   count(*) AS qtd,
                   count(DISTINCT destinatario) AS destinatarios,
                   min(enviado_em) AS primeiro, max(enviado_em) AS ultimo,
                   string_agg(DISTINCT e.razao_social, ' · ') AS empresas
              FROM email_log el
              LEFT JOIN empresa e ON e.id = el.empresa_id
             WHERE el.status = 'erro'
               AND el.enviado_em >= now() - interval '24 hours'
             GROUP BY 1, 2
             ORDER BY count(*) DESC
             LIMIT 12
            """)).ToList();

        var pendentes = await conn.ExecuteScalarAsync<long>(
            "SELECT count(*) FROM email_log WHERE status = 'erro'");
        var taxa = (long)tot.total == 0 ? 0
            : Math.Round(100.0 * (long)tot.erros / (long)tot.total, 1);

        var linhas = string.Join("", grupos.Select(g =>
            $"<tr><td style=\"padding:5px 10px 5px 0\"><b>{(long)g.qtd}x</b></td>" +
            $"<td style=\"padding:5px 10px 5px 0\">{g.motivo}</td>" +
            $"<td style=\"padding:5px 10px 5px 0\">{(long)g.destinatarios} destinatário(s)" +
            (g.empresas is string emp && emp.Length > 0 ? $"<br><span style=\"color:#777\">{emp}</span>" : "") +
            $"</td><td style=\"padding:5px 0\">{g.erro}<br>" +
            $"<span style=\"color:#777;font-size:12px\">último: " +
            $"{((DateTime)g.ultimo).ToLocalTime():dd/MM HH:mm}</span></td></tr>"));

        var corpo =
            $"<p><b>{(long)tot.erros} e-mail(s) não foram entregues</b> nas últimas 24h " +
            $"de {(long)tot.total} tentativa(s) — taxa de falha de <b>{taxa}%</b>.</p>" +
            "<table style=\"border-collapse:collapse;font-size:14px\">" +
            "<tr><th align=\"left\" style=\"padding:5px 10px 5px 0\">Qtd</th>" +
            "<th align=\"left\" style=\"padding:5px 10px 5px 0\">Tipo de envio</th>" +
            "<th align=\"left\" style=\"padding:5px 10px 5px 0\">Quem/onde</th>" +
            "<th align=\"left\" style=\"padding:5px 0\">Motivo da falha</th></tr>" +
            linhas + "</table>" +
            $"<p>Total de falhas no histórico: <b>{pendentes}</b>.</p>" +
            "<p><b>O que costuma causar:</b> endereço digitado errado no cadastro do cliente " +
            "(o mais comum), caixa cheia ou domínio inexistente, anexo grande demais, " +
            "ou bloqueio do provedor. Endereço errado se resolve no cadastro; " +
            "falha do provedor aparece repetida em muitos destinatários ao mesmo tempo.</p>" +
            "<p>Detalhe completo: painel do super-admin → <b>📧 E-mails</b>.</p>";

        foreach (var (nome, email) in await SuperAdmins(conn))
            await EnviarEmailSimples(email, nome,
                $"TSCert — {(long)tot.erros} e-mail(s) não entregue(s) em 24h", corpo, "resumo_emails");
        log.LogInformation("Resumo de e-mails com falha enviado: {Erros}/{Total} ({Taxa}%).",
            (long)tot.erros, (long)tot.total, taxa);
    }

    // Pico de falhas de e-mail: 5+ em 15 minutos = SMTP/provedor com problema.
    // Registra TAMBÉM em erro_sistema, porque se o e-mail está quebrado o
    // alerta por e-mail pode não chegar — a tela 🐞 Erros sempre mostra.
    async Task<bool> AvisarPicoEmails()
    {
        await using var conn = await db.OpenConnectionAsync();
        var qtd = await conn.ExecuteScalarAsync<long>(
            "SELECT count(*) FROM email_log WHERE status = 'erro' " +
            "AND enviado_em >= now() - interval '15 minutes'");
        if (qtd < 5) return false;

        var top = (await conn.QueryAsync("""
            SELECT coalesce(motivo,'—') AS motivo,
                   left(coalesce(erro_detalhe,'sem detalhe'), 200) AS erro,
                   count(*) AS qtd
              FROM email_log
             WHERE status = 'erro' AND enviado_em >= now() - interval '15 minutes'
             GROUP BY 1,2 ORDER BY count(*) DESC LIMIT 3
            """)).ToList();

        var resumoTxt = string.Join(" | ", top.Select(t =>
            $"{(long)t.qtd}x {t.motivo}: {t.erro}"));

        // canal que não depende de e-mail funcionando
        try
        {
            await conn.ExecuteAsync("""
                INSERT INTO erro_sistema (tipo, mensagem, detalhe)
                VALUES ('EmailFalha',
                        @msg,
                        @det)
                """, new { msg = $"{qtd} e-mails falharam em 15 minutos", det = resumoTxt });
        }
        catch (Exception ex) { log.LogWarning(ex, "não foi possível registrar o pico em erro_sistema"); }

        var corpo =
            $"<p style=\"color:#b02a37\"><b>{qtd} e-mails falharam nos últimos 15 minutos.</b></p>" +
            "<p>Quando a falha vem em bloco assim, geralmente é o servidor de e-mail " +
            "(SMTP fora, senha alterada, cota do provedor estourada) e não endereço errado " +
            "de cliente. Vale conferir <b>⚙️ Servidor de e-mail</b> no super-admin.</p><ul>" +
            string.Join("", top.Select(t =>
                $"<li><b>{(long)t.qtd}x</b> {t.motivo}<br>" +
                $"<span style=\"color:#555\">{t.erro}</span></li>")) +
            "</ul><p style=\"color:#777;font-size:12px\">Este alerta sai no máximo 1x por hora. " +
            "Ele também foi registrado em 🐞 Erros, caso o próprio e-mail não chegue.</p>";

        foreach (var (nome, email) in await SuperAdmins(conn))
            await EnviarEmailSimples(email, nome,
                $"🚨 TSCert — {qtd} e-mails falharam em 15 minutos", corpo, "pico_emails");
        log.LogWarning("PICO DE FALHA DE E-MAIL: {Qtd} em 15 minutos. {Resumo}", qtd, resumoTxt);
        return true;
    }

    // Resumo diário dos erros ABERTOS das últimas 24h, agrupados por tipo/rota.
    async Task ResumoErrosDiario()
    {
        await using var conn = await db.OpenConnectionAsync();
        var grupos = (await conn.QueryAsync("""
            SELECT coalesce(tipo, '—') AS tipo,
                   coalesce(metodo, '') AS metodo,
                   coalesce(rota, '—') AS rota,
                   coalesce(mensagem, '') AS mensagem,
                   count(*) AS qtd,
                   min(ocorrido_em) AS primeiro,
                   max(ocorrido_em) AS ultimo
              FROM erro_sistema
             WHERE resolvido = false
               AND ocorrido_em >= now() - interval '24 hours'
             GROUP BY 1, 2, 3, 4
             ORDER BY count(*) DESC, max(ocorrido_em) DESC
             LIMIT 15
            """)).ToList();
        if (grupos.Count == 0) return;                      // silêncio é bom sinal

        var total = grupos.Sum(g => (long)g.qtd);
        var abertosTotal = await conn.ExecuteScalarAsync<long>(
            "SELECT count(*) FROM erro_sistema WHERE resolvido = false");

        var linhas = string.Join("", grupos.Select(g =>
            $"<tr><td style=\"padding:5px 10px 5px 0\"><b>{(long)g.qtd}x</b></td>" +
            $"<td style=\"padding:5px 10px 5px 0\">{g.tipo}</td>" +
            $"<td style=\"padding:5px 10px 5px 0\"><code>{g.metodo} {g.rota}</code></td>" +
            $"<td style=\"padding:5px 0\">{Truncar((string)g.mensagem, 110)}<br>" +
            $"<span style=\"color:#777;font-size:12px\">último: " +
            $"{((DateTime)g.ultimo).ToLocalTime():dd/MM HH:mm}</span></td></tr>"));

        var corpo =
            $"<p>Resumo das últimas 24 horas: <b>{total} erro(s)</b> em " +
            $"{grupos.Count} ponto(s) diferente(s) do sistema.</p>" +
            "<table style=\"border-collapse:collapse;font-size:14px\">" +
            "<tr><th align=\"left\" style=\"padding:5px 10px 5px 0\">Qtd</th>" +
            "<th align=\"left\" style=\"padding:5px 10px 5px 0\">Tipo</th>" +
            "<th align=\"left\" style=\"padding:5px 10px 5px 0\">Rota</th>" +
            "<th align=\"left\" style=\"padding:5px 0\">Mensagem</th></tr>" +
            linhas + "</table>" +
            $"<p>Total de erros em aberto (todo o histórico): <b>{abertosTotal}</b>.</p>" +
            "<p>Para ver o detalhe e marcar como resolvido: painel do super-admin → " +
            "<b>🐞 Erros</b>.</p>";

        foreach (var (nome, email) in await SuperAdmins(conn))
            await EnviarEmailSimples(email, nome,
                $"TSCert — {total} erro(s) nas últimas 24h", corpo, "resumo_erros");
        log.LogInformation("Resumo de erros enviado: {Total} em {Grupos} pontos.", total, grupos.Count);
    }

    // Pico de erros: 10+ nos últimos 10 minutos = algo quebrou AGORA.
    async Task<bool> AvisarPicoErros()
    {
        await using var conn = await db.OpenConnectionAsync();
        var qtd = await conn.ExecuteScalarAsync<long>(
            "SELECT count(*) FROM erro_sistema WHERE ocorrido_em >= now() - interval '10 minutes'");
        if (qtd < 10) return false;

        var top = (await conn.QueryAsync("""
            SELECT coalesce(tipo,'—') AS tipo, coalesce(rota,'—') AS rota,
                   coalesce(mensagem,'') AS mensagem, count(*) AS qtd
              FROM erro_sistema
             WHERE ocorrido_em >= now() - interval '10 minutes'
             GROUP BY 1,2,3 ORDER BY count(*) DESC LIMIT 3
            """)).ToList();

        var corpo =
            $"<p style=\"color:#b02a37\"><b>{qtd} erros nos últimos 10 minutos.</b></p>" +
            "<p>Isso costuma indicar algo quebrado agora (banco, integração, deploy recente). " +
            "Os pontos mais frequentes:</p><ul>" +
            string.Join("", top.Select(t =>
                $"<li><b>{(long)t.qtd}x</b> {t.tipo} em <code>{t.rota}</code><br>" +
                $"<span style=\"color:#555\">{Truncar((string)t.mensagem, 140)}</span></li>")) +
            "</ul><p>Painel do super-admin → <b>🐞 Erros</b> para o detalhe completo.</p>" +
            "<p style=\"color:#777;font-size:12px\">Este alerta sai no máximo 1x por hora.</p>";

        foreach (var (nome, email) in await SuperAdmins(conn))
            await EnviarEmailSimples(email, nome,
                $"🚨 TSCert — pico de {qtd} erros em 10 minutos", corpo, "pico_erros");
        log.LogWarning("PICO DE ERROS: {Qtd} em 10 minutos — alerta enviado.", qtd);
        return true;
    }

    static string Truncar(string s, int n) =>
        string.IsNullOrEmpty(s) ? "" : (s.Length <= n ? s : s.Substring(0, n) + "…");

    // Resumo diário para admin + RTs (aguardando aprovação + rascunhos parados)
    // e lembrete individual aos técnicos com rascunho parado.
    // Chamado pelo loop com gate de horário: 1x por dia, a partir das 7h.
    async Task AvisarAprovacoesPendentes()
    {
        await using var conn = await db.OpenConnectionAsync();
        try
        {
            var rEmailAp = redis.GetDatabase();

            // Certificados aguardando aprovação (todas as empresas ativas)
            var pendentes = (await conn.QueryAsync("""
                SELECT ct.empresa_id, cl.razao_social AS cliente,
                       b.identificacao, b.marca, b.modelo,
                       ut.nome AS tecnico,
                       COALESCE(ct.enviado_em, now()) AS desde
                  FROM certificado ct
                  JOIN empresa e  ON e.id = ct.empresa_id
                  JOIN cliente cl ON cl.id = ct.cliente_id
                  JOIN balanca b  ON b.id = ct.balanca_id
                  JOIN usuario ut ON ut.id = ct.tecnico_id
                 WHERE ct.status = 'aguardando_aprovacao'
                   AND e.status = 'ativa'
                 ORDER BY ct.empresa_id, desde
                """)).ToList();

            // Rascunhos parados há 1+ dia (técnicos ativos)
            var rascunhos = (await conn.QueryAsync("""
                SELECT ct.tecnico_id, ct.empresa_id, ut.nome AS tecnico, ut.email,
                       cl.razao_social AS cliente,
                       b.identificacao, b.marca, b.modelo,
                       ct.criado_em
                  FROM certificado ct
                  JOIN empresa e  ON e.id = ct.empresa_id
                  JOIN cliente cl ON cl.id = ct.cliente_id
                  JOIN balanca b  ON b.id = ct.balanca_id
                  JOIN usuario ut ON ut.id = ct.tecnico_id
                 WHERE ct.status = 'rascunho'
                   AND e.status = 'ativa' AND ut.ativo
                   AND ct.criado_em < now() - interval '1 day'
                 ORDER BY ct.empresa_id, ut.nome, ct.criado_em
                """)).ToList();

            static string Dias(DateTime desde, out int n)
            {
                n = (int)(DateTime.UtcNow - desde).TotalDays;
                return n <= 0 ? "hoje" : n == 1 ? "há 1 dia" : $"há {n} dias";
            }
            static string Equip(dynamic p) =>
                $"{p.identificacao} — {p.marca} {p.modelo}".Trim(' ', '—');

            // ── Um e-mail por empresa para TODOS os admins + RTs, com as 2 seções ──
            var empresas = pendentes.Select(p => (Guid)p.empresa_id)
                .Concat(rascunhos.Select(p => (Guid)p.empresa_id)).Distinct();

            foreach (var empId in empresas)
            {
                var ap = pendentes.Where(p => (Guid)p.empresa_id == empId).ToList();
                var ra = rascunhos.Where(p => (Guid)p.empresa_id == empId).ToList();
                var corpo = "<p>Olá,</p><p>Resumo diário das calibrações da sua equipe:</p>";

                if (ap.Count > 0)
                {
                    var maisAntigo = 0;
                    var linhas = string.Join("", ap.Select(p =>
                    {
                        var txt = Dias((DateTime)p.desde, out var d);
                        if (d > maisAntigo) maisAntigo = d;
                        var destaque = d >= 3 ? " style=\"color:#b02a37;font-weight:bold\"" : "";
                        return $"<tr><td style=\"padding:4px 10px 4px 0\">{p.cliente}</td>" +
                               $"<td style=\"padding:4px 10px 4px 0\">{Equip(p)}</td>" +
                               $"<td style=\"padding:4px 10px 4px 0\">{p.tecnico}</td>" +
                               $"<td style=\"padding:4px 0\"{destaque}>{txt}</td></tr>";
                    }));
                    corpo += $"<h3 style=\"margin:14px 0 6px\">⏳ Aguardando aprovação ({ap.Count})</h3>" +
                        "<table style=\"border-collapse:collapse;font-size:14px\">" +
                        "<tr><th align=\"left\" style=\"padding:4px 10px 4px 0\">Cliente</th>" +
                        "<th align=\"left\" style=\"padding:4px 10px 4px 0\">Equipamento</th>" +
                        "<th align=\"left\" style=\"padding:4px 10px 4px 0\">Técnico</th>" +
                        "<th align=\"left\" style=\"padding:4px 0\">Aguardando</th></tr>" +
                        linhas + "</table>" +
                        (maisAntigo >= 3 ? "<p style=\"color:#b02a37\"><b>Atenção:</b> há certificado " +
                            "esperando há 3 dias ou mais — o cliente pode estar cobrando o documento.</p>" : "");
                }

                if (ra.Count > 0)
                {
                    // ordenado por técnico (a query já vem assim)
                    var linhas = string.Join("", ra.Select(p =>
                    {
                        var txt = Dias((DateTime)p.criado_em, out var d);
                        var destaque = d >= 3 ? " style=\"color:#b02a37;font-weight:bold\"" : "";
                        return $"<tr><td style=\"padding:4px 10px 4px 0\"><b>{p.tecnico}</b></td>" +
                               $"<td style=\"padding:4px 10px 4px 0\">{p.cliente}</td>" +
                               $"<td style=\"padding:4px 10px 4px 0\">{Equip(p)}</td>" +
                               $"<td style=\"padding:4px 0\"{destaque}>{txt}</td></tr>";
                    }));
                    corpo += $"<h3 style=\"margin:14px 0 6px\">📝 Rascunhos parados ({ra.Count})</h3>" +
                        "<table style=\"border-collapse:collapse;font-size:14px\">" +
                        "<tr><th align=\"left\" style=\"padding:4px 10px 4px 0\">Técnico</th>" +
                        "<th align=\"left\" style=\"padding:4px 10px 4px 0\">Cliente</th>" +
                        "<th align=\"left\" style=\"padding:4px 10px 4px 0\">Equipamento</th>" +
                        "<th align=\"left\" style=\"padding:4px 0\">Parado</th></tr>" +
                        linhas + "</table>" +
                        "<p>Os técnicos também recebem um lembrete individual dos próprios rascunhos.</p>";
                }

                corpo += "<p>Para agir: entre no sistema — fila <b>Aguardando aprovação</b> e <b>Rascunhos</b> no painel.</p>";

                var partes = new List<string>();
                if (ap.Count > 0) partes.Add($"{ap.Count} aguardando aprovação");
                if (ra.Count > 0) partes.Add($"{ra.Count} rascunho(s) parado(s)");
                var assunto = "TSCert — " + string.Join(" · ", partes);

                var gest = await conn.QueryAsync("""
                    SELECT DISTINCT ON (lower(email)) nome, email
                      FROM usuario
                     WHERE empresa_id = @id AND ativo
                       AND papel IN ('admin', 'responsavel_tecnico')
                       AND email IS NOT NULL AND email <> ''
                     ORDER BY lower(email)
                    """, new { id = empId });
                foreach (var gs in gest)
                    await EnfileirarEmail(rEmailAp, (string)gs.email, (string)gs.nome,
                        assunto, corpo, "aprovacao_pendente", empId, null, null);
            }

            // ── Lembrete individual ao TÉCNICO dono dos rascunhos ──
            foreach (var grupoT in rascunhos
                .Where(p => !string.IsNullOrWhiteSpace((string?)p.email))
                .GroupBy(p => (Guid)p.tecnico_id))
            {
                var itens = grupoT.ToList();
                var linhas = string.Join("", itens.Select(p =>
                {
                    var txt = Dias((DateTime)p.criado_em, out var d);
                    var destaque = d >= 3 ? " style=\"color:#b02a37;font-weight:bold\"" : "";
                    return $"<tr><td style=\"padding:4px 10px 4px 0\">{p.cliente}</td>" +
                           $"<td style=\"padding:4px 10px 4px 0\">{Equip(p)}</td>" +
                           $"<td style=\"padding:4px 0\"{destaque}>{txt}</td></tr>";
                }));
                var corpoR =
                    $"<p>Olá, {grupoT.First().tecnico},</p>" +
                    $"<p>Você tem <b>{itens.Count} calibração(ões) em rascunho</b> aguardando " +
                    "para serem finalizadas e enviadas para aprovação:</p>" +
                    "<table style=\"border-collapse:collapse;font-size:14px\">" +
                    "<tr><th align=\"left\" style=\"padding:4px 10px 4px 0\">Cliente</th>" +
                    "<th align=\"left\" style=\"padding:4px 10px 4px 0\">Equipamento</th>" +
                    "<th align=\"left\" style=\"padding:4px 0\">Parado</th></tr>" +
                    linhas + "</table>" +
                    "<p>Um rascunho não vira certificado sozinho 😉 — entre no sistema, conclua " +
                    "o ensaio e envie para aprovação. Se algum rascunho não for mais necessário, " +
                    "exclua-o para manter a fila limpa.</p>";
                await EnfileirarEmail(rEmailAp, (string)grupoT.First().email,
                    (string)grupoT.First().tecnico,
                    $"TSCert — você tem {itens.Count} calibração(ões) em rascunho", corpoR,
                    "rascunho_pendente", (Guid)grupoT.First().empresa_id, null, null);
            }

            if (pendentes.Count + rascunhos.Count > 0)
                log.LogInformation("Aviso diário: {Ap} aguardando aprovação, {Ra} rascunho(s) parado(s).",
                    pendentes.Count, rascunhos.Count);
        }
        catch (Exception ex) { log.LogWarning(ex, "aviso diário de pendências falhou"); }
    }

    async Task ProcessarDiario()
    {
        await using var conn = await db.OpenConnectionAsync();

        // 1) Gera as cobranças recorrentes da competência atual
        var geradas = await conn.ExecuteScalarAsync<int>("SELECT gerar_cobrancas_do_mes()");
        if (geradas > 0) log.LogInformation("Cobranças geradas neste ciclo: {Qtd}", geradas);

        // 2) Aplica bloqueio automático por contrato vencido (carência esgotada)
        try { await conn.ExecuteAsync("SELECT sa_aplicar_bloqueio_contratos()"); }
        catch (Exception ex) { log.LogWarning(ex, "bloqueio automático falhou"); }

        // 2a-) ESCUDO da liberação temporária: empresa liberada pelo super-admin
        // até uma data não pode ficar suspensa por motivo automático nesse período
        try
        {
            var reativadas = await conn.ExecuteAsync("""
                UPDATE empresa
                   SET status = 'ativa', motivo_suspensao = NULL
                 WHERE status = 'suspensa'
                   AND motivo_suspensao IN ('contrato_vencido', 'avaliacao_encerrada')
                   AND liberado_ate IS NOT NULL AND liberado_ate >= current_date
                """);
            if (reativadas > 0)
                log.LogInformation("Liberação temporária: {Qtd} empresa(s) mantida(s) ativa(s).", reativadas);
        }
        catch (Exception ex) { log.LogWarning(ex, "escudo de liberação falhou"); }

        // 2a) Período de avaliação: empresa SEM contrato ativo tem 30 dias.
        // Depois disso é suspensa automaticamente (dados preservados; a criação
        // de um contrato + status 'ativa' reativa). Empresas protegidas ficam fora.
        try
        {
            var suspensas = await conn.ExecuteAsync("""
                UPDATE empresa e
                   SET status = 'suspensa', motivo_suspensao = 'avaliacao_encerrada'
                 WHERE e.status = 'ativa'
                   AND e.criado_em < now() - interval '30 days'
                   AND (e.liberado_ate IS NULL OR e.liberado_ate < current_date)
                   AND e.id NOT IN ('00000000-0000-0000-0000-000000000001',
                                    '4fe3cf5d-e3dc-49f3-99fd-962af6815a86')
                   AND NOT EXISTS (SELECT 1 FROM contrato c
                                    WHERE c.empresa_id = e.id AND c.ativo)
                """);
            if (suspensas > 0)
                log.LogInformation("Avaliação encerrada: {Qtd} empresa(s) suspensa(s) por 30 dias sem contrato.", suspensas);
        }
        catch (Exception ex) { log.LogWarning(ex, "suspensão por avaliação encerrada falhou"); }

        // 2b) Lembretes de cobrança aos gestores: vencendo em 5 dias e em atraso
        try
        {
            var rEmailCb = redis.GetDatabase();
            if (!EhDiaUtilBr(DateTime.Now))
            {
                log.LogInformation("Fim de semana/feriado: lembretes de cobrança adiados para o próximo dia útil.");
            }
            else
            {
            // vencendo em até 5 dias, ainda sem lembrete
            var aVencer = await conn.QueryAsync("""
                SELECT cb.id, cb.valor, cb.vencimento, cb.empresa_id, e.razao_social AS empresa
                  FROM cobranca cb JOIN empresa e ON e.id = cb.empresa_id
                 WHERE cb.status = 'pendente' AND cb.lembrete_em IS NULL
                   AND cb.vencimento BETWEEN current_date AND current_date + 5
                """);
            foreach (var cb in aVencer)
            {
                var gest = await conn.QueryAsync(
                    "SELECT * FROM gestores_da_empresa(@id)", new { id = (Guid)cb.empresa_id });
                var corpoL =
                    $"<p>Olá,</p><p>A mensalidade do TSCert da <b>{cb.empresa}</b> no valor de " +
                    $"<b>R$ {((decimal)cb.valor):N2}</b> vence em <b>{((DateTime)cb.vencimento):dd/MM/yyyy}</b>.</p>" +
                    "<p>Para pagar ou tirar dúvidas, fale com a Total Scale: (31) 3357-4000.</p>";
                foreach (var gs in gest)
                    await EnfileirarEmail(rEmailCb, (string)gs.email, (string)gs.nome,
                        "Mensalidade TSCert — lembrete de vencimento", corpoL,
                        "cobranca_lembrete", (Guid)cb.empresa_id, null, null);
                await conn.ExecuteAsync(
                    "UPDATE cobranca SET lembrete_em = now() WHERE id = @id", new { id = (Guid)cb.id });
            }

            // vencidas, ainda sem aviso de atraso
            var atrasadas = await conn.QueryAsync("""
                SELECT cb.id, cb.valor, cb.vencimento, cb.empresa_id, e.razao_social AS empresa
                  FROM cobranca cb JOIN empresa e ON e.id = cb.empresa_id
                 WHERE cb.aviso_atraso_em IS NULL
                   AND (cb.status = 'vencido'
                        OR (cb.status = 'pendente' AND cb.vencimento < current_date))
                """);
            foreach (var cb in atrasadas)
            {
                var gest = await conn.QueryAsync(
                    "SELECT * FROM gestores_da_empresa(@id)", new { id = (Guid)cb.empresa_id });
                var corpoA =
                    $"<p>Olá,</p><p>A mensalidade do TSCert da <b>{cb.empresa}</b> no valor de " +
                    $"<b>R$ {((decimal)cb.valor):N2}</b> venceu em <b>{((DateTime)cb.vencimento):dd/MM/yyyy}</b> " +
                    "e consta em aberto.</p><p>Se o pagamento já foi feito, desconsidere. " +
                    "Caso contrário, regularize para evitar a suspensão automática do acesso. " +
                    "Dúvidas: (31) 3357-4000.</p>";
                foreach (var gs in gest)
                    await EnfileirarEmail(rEmailCb, (string)gs.email, (string)gs.nome,
                        "Mensalidade TSCert em aberto", corpoA,
                        "cobranca_atraso", (Guid)cb.empresa_id, null, null);
                await conn.ExecuteAsync(
                    "UPDATE cobranca SET aviso_atraso_em = now() WHERE id = @id", new { id = (Guid)cb.id });
            }
            }
        }
        catch (Exception ex) { log.LogWarning(ex, "lembretes de cobrança falharam"); }

        // 3) Alerta de contratos vencendo (30 dias), 1 e-mail por gestor — só dias úteis
        var vencendo = EhDiaUtilBr(DateTime.Now)
            ? await conn.QueryAsync("SELECT * FROM contratos_vencendo_para_alerta(30)")
            : Enumerable.Empty<dynamic>();
        foreach (var c in vencendo)
        {
            var gestores = await conn.QueryAsync(
                "SELECT * FROM gestores_da_empresa(@id)", new { id = (Guid)c.empresa_id });
            var assunto = $"Contrato vencendo em {(int)c.dias_para_vencer} dia(s)";
            var corpo =
                $"<p>Olá,</p><p>O contrato <b>{c.descricao}</b> da empresa " +
                $"<b>{c.empresa}</b> vence em <b>{((DateTime)c.fim):dd/MM/yyyy}</b> " +
                $"({(int)c.dias_para_vencer} dia(s)).</p>" +
                "<p>Entre em contato para renovar e evitar a suspensão do acesso.</p>";
            foreach (var g in gestores)
                await EnviarEmailSimples((string)g.email, (string)g.nome, assunto, corpo, "contrato_vencendo");
            // marca como enviado (não repete no dia seguinte)
            await conn.ExecuteAsync("SELECT marcar_alerta_enviado('contrato_vencendo', @refc)",
                new { refc = (string)c.referencia });
            log.LogInformation("Alerta de contrato vencendo enviado: {Emp}", (string)c.empresa);
        }

        // 3.5) Avisos automáticos de vencimento de calibração
        // Para cada empresa com o aviso ativo, processa os clientes a avisar
        // (a função respeita a frequência configurada, evitando spam).
        try
        {
            var empresasAviso = (await conn.QueryAsync<Guid>(
                "SELECT id FROM empresa WHERE aviso_venc_ativo AND status = 'ativa'")).ToList();
            foreach (var empId in empresasAviso)
            {
                try { await ProcessarAvisosVencimento(empId, null, "automatico", null); }
                catch (Exception ex) { log.LogWarning(ex, "Aviso de vencimento falhou para empresa {Id}", empId); }
            }
        }
        catch (Exception ex) { log.LogWarning(ex, "Rotina de avisos de vencimento falhou."); }

        // 3.55) Pesquisa do TSCERT (produto) — automática por usuário
        try
        {
            var cfgP = await conn.QuerySingleOrDefaultAsync(
                "SELECT ativo, freq_dias, dias_ativo FROM psaas_config WHERE id");
            if (cfgP is not null && (bool)cfgP.ativo)
            {
                var alvos = (await conn.QueryAsync<Guid>("""
                    SELECT u.usuario_id FROM psaas_usuarios_alvo() u
                     WHERE u.visto_em > now() - make_interval(days => @diasAtivo)
                       AND (u.ultimo_envio IS NULL
                            OR u.ultimo_envio < now() - make_interval(days => @freq))
                     LIMIT 50
                    """, new { diasAtivo = (int)cfgP.dias_ativo, freq = (int)cfgP.freq_dias })).ToList();
                if (alvos.Count > 0)
                {
                    var el = System.Text.Json.JsonSerializer.SerializeToElement(new {
                        usuarios = alvos.Select(a => a.ToString()).ToArray(), modo = "automatico" });
                    await PsaasEnviar(el);
                }
            }
        }
        catch (Exception ex) { log.LogWarning(ex, "Pesquisa TSCert automática falhou."); }

        // 3.6) Pesquisas de satisfação periódicas
        try
        {
            var empresasPesq = (await conn.QueryAsync<Guid>(
                "SELECT id FROM empresa WHERE pesquisa_ativa AND status = 'ativa'")).ToList();
            foreach (var empId in empresasPesq)
            {
                try { await ProcessarPesquisas(empId, null, "periodico"); }
                catch (Exception ex) { log.LogWarning(ex, "Pesquisa periódica falhou para empresa {Id}", empId); }
            }
        }
        catch (Exception ex) { log.LogWarning(ex, "Rotina de pesquisas periódicas falhou."); }

        // 4) Expurgo de fotos de certificado com mais de 2 anos (economiza disco)
        try
        {
            var fotos = (await conn.QueryAsync<(Guid id, string chave_s3)>(
                "SELECT * FROM fotos_para_expurgar(24)")).ToList();
            if (fotos.Count > 0)
            {
                foreach (var f in fotos)
                {
                    // chave_s3 vem como s3://bucket/caminho → extrai o caminho
                    var sp = f.chave_s3.Replace("s3://", "");
                    var barra = sp.IndexOf('/');
                    if (barra > 0) await storage.Deletar(sp[(barra + 1)..]);
                }
                var ids = fotos.Select(f => f.id).ToArray();
                await conn.ExecuteAsync(
                    "DELETE FROM certificado_foto WHERE id = ANY(@ids)", new { ids });
                log.LogInformation("Expurgo: {Qtd} foto(s) antiga(s) removida(s).", fotos.Count);
            }
        }
        catch (Exception ex) { log.LogWarning(ex, "Expurgo de fotos falhou."); }
    }

    // Expurga o log de auditoria com mais de 1 ano, preservando os registros
    // ligados a certificados (rastreabilidade permanente). Roda só após as 4h,
    // depois do backup diário — ver o loop principal.
    // ── Métricas do sistema a cada 5 min (João, 12/08/2026) ──
    // Lê /proc do host (o container enxerga o VPS) e cruza com o uso real.
    DateTime _ultimaMetrica = DateTime.MinValue;
    (double idle, double total)? _cpuAnterior = null;
    async Task ColetarMetricas()
    {
        if ((DateTime.UtcNow - _ultimaMetrica).TotalMinutes < 5) return;
        _ultimaMetrica = DateTime.UtcNow;
        try
        {
            // CPU: diferença entre duas leituras de /proc/stat
            double cpuPct = 0;
            var linha = (await File.ReadAllLinesAsync("/proc/stat"))[0];
            var p = linha.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            double idle = double.Parse(p[4]) + double.Parse(p[5]);
            double total = 0;
            for (int i = 1; i < p.Length && i <= 8; i++) total += double.Parse(p[i]);
            if (_cpuAnterior is { } ant && total > ant.total)
                cpuPct = Math.Round(100.0 * (1 - (idle - ant.idle) / (total - ant.total)), 2);
            _cpuAnterior = (idle, total);

            // Memória do host
            int memTotal = 0, memDisp = 0;
            foreach (var l in await File.ReadAllLinesAsync("/proc/meminfo"))
            {
                if (l.StartsWith("MemTotal:")) memTotal = int.Parse(l.Split(':')[1].Replace("kB", "").Trim()) / 1024;
                if (l.StartsWith("MemAvailable:")) memDisp = int.Parse(l.Split(':')[1].Replace("kB", "").Trim()) / 1024;
            }
            int memUsada = memTotal - memDisp;
            int memProc = (int)(System.Diagnostics.Process.GetCurrentProcess().WorkingSet64 / 1048576);

            // Disco
            double discoPct = 0;
            try
            {
                var di = new DriveInfo("/");
                if (di.TotalSize > 0)
                    discoPct = Math.Round(100.0 * (di.TotalSize - di.AvailableFreeSpace) / di.TotalSize, 2);
            }
            catch { }

            await using var conn = await db.OpenConnectionAsync();
            var u5 = await conn.ExecuteScalarAsync<int>("SELECT sa_online_total(5)");
            var u60 = await conn.ExecuteScalarAsync<int>("SELECT sa_online_total(60)");
            var cx = await conn.ExecuteScalarAsync<int>(
                "SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database()");
            var certs = await conn.ExecuteScalarAsync<int>(
                "SELECT count(*)::int FROM certificado WHERE criado_em > now() - interval '1 hour'");
            await conn.ExecuteAsync("""
                INSERT INTO metrica_sistema (cpu_pct, mem_usada_mb, mem_total_mb, mem_api_mb,
                    disco_pct, usuarios_5min, usuarios_1h, conexoes_db, certs_hora)
                VALUES (@cpuPct, @memUsada, @memTotal, @memProc, @discoPct, @u5, @u60, @cx, @certs)
                """, new { cpuPct, memUsada, memTotal, memProc, discoPct, u5, u60, cx, certs });
        }
        catch (Exception ex) { log.LogWarning(ex, "Coleta de métricas falhou"); }
    }

    // ══ PESQUISA DO TSCERT (produto) — João, 12/08/2026 ══════════
    // Convite personalizado por papel; envio manual (lista) e automático
    // (a cada N dias, só para quem usou o sistema recentemente).
    async Task PsaasEnviar(JsonElement t)
    {
        await using var conn = await db.OpenConnectionAsync();
        var ids = t.GetProperty("usuarios").EnumerateArray()
            .Select(x => Guid.Parse(x.GetString()!)).ToList();
        var modo = t.TryGetProperty("modo", out var m) ? m.GetString() ?? "manual" : "manual";
        var urlBase = cfg["App:UrlBase"] ?? "https://certificados.minasbalancas.com.br";
        var cfg2 = await conn.QuerySingleOrDefaultAsync(
            "SELECT convite_titulo, convite_texto FROM psaas_config WHERE id");
        var titulo = (string?)cfg2?.convite_titulo;
        var textoCfg = (string?)cfg2?.convite_texto;
        var rEmail = redis.GetDatabase();
        int n = 0;
        foreach (var uid in ids)
        {
            try
            {
                var e = await conn.QuerySingleOrDefaultAsync(
                    "SELECT * FROM psaas_criar_envio(@u, @m)", new { u = uid, m = modo });
                if (e is null) continue;
                string nome = e.nome, email = e.email, papel = e.papel, empresa = e.empresa;
                var papelTxt = papel switch {
                    "admin" => "administrador",
                    "responsavel_tecnico" => "responsável técnico",
                    _ => "técnico" };
                var link = $"{urlBase.TrimEnd('/')}/pesquisa-tscert/{e.token}";
                var assunto = string.IsNullOrWhiteSpace(titulo)
                    ? "Sua opinião sobre o TSCert (2 minutos)" : titulo;
                var corpoTexto = string.IsNullOrWhiteSpace(textoCfg)
                    ? $"Você usa o TSCert no dia a dia como <b>{papelTxt}</b> — e é exatamente por isso "
                      + "que sua opinião vale tanto para nós.<br><br>São poucas perguntas e leva menos de "
                      + "<b>2 minutos</b>. Suas respostas vão direto para quem desenvolve o sistema."
                    : System.Net.WebUtility.HtmlEncode(textoCfg).Replace("\n", "<br>");
                var html =
                    "<div style=\"background:#eef2f6;padding:26px 10px;font-family:Arial,Helvetica,sans-serif\">" +
                    "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden\">" +
                    "<tr><td style=\"background:#164066;padding:20px 26px\">" +
                    "<span style=\"color:#fff;font-size:19px;font-weight:bold\">TSCert</span><br>" +
                    "<span style=\"color:#b9cbdc;font-size:12.5px\">Sua opinião sobre o sistema</span></td></tr>" +
                    "<tr><td style=\"padding:24px 26px\">" +
                    $"<p style=\"margin:0 0 12px;font-size:14px;color:#16202c\">Olá, <b>{System.Net.WebUtility.HtmlEncode(nome)}</b>,</p>" +
                    $"<p style=\"margin:0 0 16px;font-size:14px;color:#16202c;line-height:1.55\">{corpoTexto}</p>" +
                    "<p style=\"text-align:center;margin:20px 0\">" +
                    $"<a href=\"{link}\" style=\"background:#164066;color:#fff;text-decoration:none;padding:12px 26px;border-radius:8px;font-size:14px;display:inline-block\">Responder a pesquisa</a></p>" +
                    "<p style=\"margin:0;font-size:11.5px;color:#8ba0b5\">O link é pessoal e não pede senha. " +
                    "Se preferir não responder, é só ignorar este e-mail.</p></td></tr>" +
                    "<tr><td style=\"background:#f4f7fa;padding:12px 26px;font-size:11px;color:#8ba0b5;border-top:1px solid #e8edf2\">" +
                    "TSCert — Total Scale · certificados.totalscale.com.br</td></tr>" +
                    "</table></div>";
                await EnfileirarEmail(rEmail, email, nome, assunto, html, "psaas_convite", null, null);
                n++;
            }
            catch (Exception ex) { log.LogWarning(ex, "Pesquisa TSCert: falha ao preparar envio para {U}", uid); }
        }
        log.LogInformation("Pesquisa TSCert ({Modo}): {Qtd} convite(s) enfileirado(s).", modo, n);
    }

    // Alerta imediato quando alguém responde como detrator (nota <= 6)
    async Task PsaasAlertaDetrator(JsonElement t)
    {
        await using var conn = await db.OpenConnectionAsync();
        var destino = await conn.ExecuteScalarAsync<string?>(
            "SELECT alerta_email FROM psaas_config WHERE id");
        if (string.IsNullOrWhiteSpace(destino))
        {
            var sa = (await SuperAdmins(conn)).FirstOrDefault();
            destino = sa.Email;
        }
        if (string.IsNullOrWhiteSpace(destino)) return;
        var nome = t.TryGetProperty("nome", out var n1) ? n1.GetString() : "(usuário)";
        var empresa = t.TryGetProperty("empresa", out var e1) ? e1.GetString() : "";
        var papel = t.TryGetProperty("papel", out var p1) ? p1.GetString() : "";
        var nota = t.TryGetProperty("nota", out var nt) ? nt.GetInt32() : 0;
        var html =
            "<div style=\"font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#16202c\">" +
            $"<p><b>Atenção:</b> nota <b style=\"color:#b02a37;font-size:18px\">{nota}</b> na pesquisa do TSCert.</p>" +
            $"<p><b>{System.Net.WebUtility.HtmlEncode(nome ?? "")}</b> ({papel}) — {System.Net.WebUtility.HtmlEncode(empresa ?? "")}</p>" +
            "<p>Vale ligar hoje: detrator recuperado costuma virar o cliente mais fiel. " +
            "Veja as respostas completas no painel, em <b>Pesquisa do TSCert</b>.</p></div>";
        await EnviarEmailSimples(destino!, "Super Admin",
            $"Pesquisa TSCert: nota {nota} de {empresa}", html, "psaas_alerta");
        log.LogWarning("Pesquisa TSCert: DETRATOR nota {N} — {Nome} / {Emp}", nota, nome, empresa);
    }

    async Task ExpurgarLogAntigo()
    {
        await using var conn = await db.OpenConnectionAsync();
        var removidos = await conn.ExecuteScalarAsync<long>(
            "SELECT expurgar_log_auditoria(12)");
        // Métricas: mantém detalhe de 7 dias; acima disso, 1 amostra por hora
        await conn.ExecuteAsync("""
            DELETE FROM metrica_sistema m USING (
                SELECT id, row_number() OVER (
                    PARTITION BY date_trunc('hour', momento) ORDER BY momento) AS rn
                  FROM metrica_sistema WHERE momento < now() - interval '7 days') x
             WHERE m.id = x.id AND x.rn > 1
            """);
        await conn.ExecuteAsync(
            "DELETE FROM metrica_sistema WHERE momento < now() - interval '180 days'");
        // Corpo dos e-mails: guardado por 30 dias (decisão do João, 12/08/2026)
        var limpos = await conn.ExecuteAsync(
            "UPDATE email_log SET corpo_html = NULL " +
            " WHERE corpo_html IS NOT NULL AND enviado_em < now() - interval '30 days'");
        if (limpos > 0) log.LogInformation("Expurgo: corpo de {Qtd} e-mail(s) antigo(s) liberado.", limpos);
        if (removidos > 0)
            log.LogInformation("Expurgo: {Qtd} registro(s) antigo(s) de log removido(s).", removidos);
    }
    // destino = 'cliente' (avisa os gestores da empresa) ou 'suporte'
    async Task EmailChamado(string chamadoId, string destino)
    {
        await using var conn = await db.OpenConnectionAsync();
        var ch = await conn.QuerySingleOrDefaultAsync(
            "SELECT * FROM sa_chamado(@id)", new { id = Guid.Parse(chamadoId) });
        if (ch is null) return;
        var titulo = $"#{((int)ch.numero):D4} · {(string)ch.assunto}";

        if (destino == "cliente")
        {
            // avisa os gestores da empresa que o suporte respondeu
            var gestores = await conn.QueryAsync(
                "SELECT * FROM gestores_da_empresa(@id)", new { id = (Guid)ch.empresa_id });
            var corpo = $"<p>Há uma nova resposta do suporte no seu chamado <b>{titulo}</b>.</p>" +
                        "<p>Acesse o sistema, em Suporte, para ver e responder.</p>";
            foreach (var g in gestores)
                await EnviarEmailSimples((string)g.email, (string)g.nome,
                    "Resposta no seu chamado de suporte", corpo, "chamado");
        }
        else
        {
            // avisa o suporte (super-admin) que o cliente escreveu
            var admins = await conn.QueryAsync("""
                SELECT u.nome, u.email FROM usuario u
                 WHERE u.papel = 'super_admin' AND u.ativo
                """);
            var corpo = $"<p>Nova mensagem no chamado <b>{titulo}</b> " +
                        $"da empresa <b>{(string)ch.empresa}</b>.</p>" +
                        "<p>Acesse o painel para responder.</p>";
            foreach (var a in admins)
                await EnviarEmailSimples((string)a.email, (string)a.nome,
                    "Nova mensagem em chamado de suporte", corpo, "chamado");
        }
    }

    // ── E-mail de validação do portal do cliente ──
    // ── Avisos de vencimento de calibração (agrupados por cliente) ──
    // Busca os clientes com balanças a vencer, monta UM e-mail por cliente
    // listando todas as balanças, envia ao cliente (+ cópia gestor) e registra.
    async Task ProcessarAvisosVencimento(Guid empresaId, Guid? clienteId, string modo, Guid? usuarioId)
    {
        await using var conn = await db.OpenConnectionAsync();
        await conn.ExecuteAsync("SELECT set_config('app.empresa_id', @id, false)",
            new { id = empresaId.ToString() });

        // Config da empresa
        var cfgEmp = await conn.QuerySingleOrDefaultAsync(
            @"SELECT razao_social, aviso_venc_dias, aviso_venc_freq_dias,
                     aviso_venc_copia_gestor, aviso_venc_ativo,
                     telefone, email, endereco, cidade_uf, logo_url, cor_marca
                FROM empresa WHERE id = @id", new { id = empresaId });
        if (cfgEmp is null) return;

        // Marcos configurados (ex.: '30,15,7') → usamos o MAIOR como janela
        var dias = ((string)cfgEmp.aviso_venc_dias)
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(s => int.TryParse(s, out var n) ? n : 0).Where(n => n > 0).ToList();
        int maxDias = dias.Count > 0 ? dias.Max() : 30;
        int freq = (int)cfgEmp.aviso_venc_freq_dias;
        bool copiaGestor = (bool)cfgEmp.aviso_venc_copia_gestor;
        string empresaNome = (string)cfgEmp.razao_social;
        string? empTelefone = (string?)cfgEmp.telefone;
        string? empEmail = (string?)cfgEmp.email;
        string? empEndereco = (string?)cfgEmp.endereco;
        string? empCidadeUf = (string?)cfgEmp.cidade_uf;
        string? corMarca = (string?)cfgEmp.cor_marca;

        // Baixa o logo da empresa (do S3/MinIO) e converte para base64,
        // para embutir direto no HTML do e-mail (data URI).
        string? logoDataUri = null;
        try
        {
            string? logoUrl = (string?)cfgEmp.logo_url;
            if (!string.IsNullOrEmpty(logoUrl))
            {
                var semPrefixo = logoUrl.Replace("s3://", "");
                var barra = semPrefixo.IndexOf('/');
                if (barra > 0)
                {
                    var bytes = await storage.Ler(semPrefixo[(barra + 1)..]);
                    if (bytes is { Length: > 0 })
                    {
                        var ext = System.IO.Path.GetExtension(logoUrl).TrimStart('.').ToLowerInvariant();
                        var mime = ext == "png" ? "image/png" : ext is "jpg" or "jpeg" ? "image/jpeg" : "image/png";
                        logoDataUri = $"data:{mime};base64,{Convert.ToBase64String(bytes)}";
                    }
                }
            }
        }
        catch (Exception ex) { log.LogWarning(ex, "Não foi possível carregar o logo da empresa para o e-mail."); }

        // No manual, não respeita a frequência (o gestor está forçando)
        bool respeitarFreq = modo == "automatico";

        var pendentes = (await conn.QueryAsync(
            @"SELECT * FROM avisos_vencimento_pendentes(@maxDias, @freq, @respeitar, @cliente, @empresa)",
            new { maxDias, freq, respeitar = respeitarFreq, cliente = clienteId,
                  empresa = empresaId })).ToList();   // isolamento explícito de tenant

        if (pendentes.Count == 0)
        {
            log.LogInformation("Avisos de vencimento ({Modo}): nenhum cliente a avisar.", modo);
            return;
        }

        // E-mails dos gestores (para cópia)
        var gestores = copiaGestor
            ? (await conn.QueryAsync<string>(
                @"SELECT email FROM usuario WHERE empresa_id = @id
                   AND papel IN ('admin','responsavel_tecnico') AND ativo",
                new { id = empresaId })).ToList()
            : new List<string>();

        foreach (var p in pendentes)
        {
            string emailCliente = (string?)p.email ?? "";
            string nomeCliente = (string)p.cliente;
            if (string.IsNullOrWhiteSpace(emailCliente))
            {
                log.LogInformation("Cliente {Cliente} sem e-mail — aviso ignorado.", nomeCliente);
                continue;
            }

            var balancas = System.Text.Json.JsonDocument.Parse((string)p.balancas).RootElement;
            var html = MontarEmailAvisoVencimento(empresaNome, nomeCliente, balancas,
                empTelefone, empEmail, empEndereco, empCidadeUf, logoDataUri, corMarca);
            var assunto = $"Aviso de vencimento de calibração — {empresaNome}";

            // Enfileira (envio cadenciado) em vez de enviar em rajada.
            // Reply-To = e-mail da empresa: se o cliente responder, a resposta
            // vai para a caixa da empresa (não para o SMTP do sistema).
            var rEmail = redis.GetDatabase();
            await EnfileirarEmail(rEmail, emailCliente, nomeCliente, assunto, html,
                "aviso_vencimento", empresaId, (Guid)p.cliente_id, empEmail);

            // Cópia para os gestores (também cadenciada)
            foreach (var g in gestores)
                await EnfileirarEmail(rEmail, g, "Gestor", $"[Cópia] {assunto}", html,
                    "aviso_vencimento_copia", empresaId, (Guid)p.cliente_id, empEmail);

            // Registra o envio (controla a frequência)
            await conn.ExecuteAsync(
                @"INSERT INTO aviso_vencimento
                    (empresa_id, cliente_id, modo, qtd_balancas, email_para, usuario_id)
                  VALUES (@empresaId, @clienteId, @modo, @qtd, @email, @usuarioId)",
                new { empresaId, clienteId = (Guid)p.cliente_id, modo,
                    qtd = (long)p.qtd, email = emailCliente, usuarioId });
        }
        log.LogInformation("Avisos de vencimento ({Modo}): {Qtd} cliente(s) avisado(s).", modo, pendentes.Count);
    }

    // Template do e-mail de aviso de vencimento (lista as balanças)
    string MontarEmailAvisoVencimento(string empresa, string cliente,
        System.Text.Json.JsonElement balancas, string? telefone, string? email,
        string? endereco, string? cidadeUf, string? logoDataUri, string? corMarca)
    {
        // Cor de destaque: usa a cor da marca da empresa se válida, senão o azul padrão
        var cor = !string.IsNullOrWhiteSpace(corMarca) &&
                  System.Text.RegularExpressions.Regex.IsMatch(corMarca, "^#?[0-9A-Fa-f]{6}$")
                  ? (corMarca.StartsWith("#") ? corMarca : "#" + corMarca) : "#1e3a5f";

        // Linhas da tabela: identificação + descrição (marca/modelo/cap.) + vencimento
        var linhas = new System.Text.StringBuilder();
        foreach (var b in balancas.EnumerateArray())
        {
            var ident = b.GetProperty("balanca").GetString() ?? "";
            var venceEm = b.GetProperty("vence_em").GetString();
            var data = DateTime.TryParse(venceEm, out var d) ? d.ToString("dd/MM/yyyy") : venceEm;

            // Monta a descrição do equipamento (marca, modelo, capacidade)
            string? marca = b.TryGetProperty("marca", out var mk) && mk.ValueKind == System.Text.Json.JsonValueKind.String ? mk.GetString() : null;
            string? modelo = b.TryGetProperty("modelo", out var mo) && mo.ValueKind == System.Text.Json.JsonValueKind.String ? mo.GetString() : null;
            string? cap = null;
            if (b.TryGetProperty("capacidade", out var cp) && cp.ValueKind == System.Text.Json.JsonValueKind.Number)
                cap = $"{cp.GetDecimal():0.###} kg";
            var partes = new[] { marca, modelo, cap }.Where(x => !string.IsNullOrWhiteSpace(x));
            var desc = string.Join(" · ", partes);
            var descHtml = string.IsNullOrEmpty(desc) ? "" :
                $"<div style='color:#888;font-size:12px;margin-top:2px'>{desc}</div>";

            linhas.Append(
                $"<tr><td style='padding:10px 12px;border-bottom:1px solid #eee'>" +
                $"<b>{ident}</b>{descHtml}</td>" +
                $"<td style='padding:10px 12px;border-bottom:1px solid #eee;color:#c0392b;white-space:nowrap'><b>{data}</b></td></tr>");
        }

        // Cabeçalho: logo (se houver) + nome da empresa
        var cabecalho = !string.IsNullOrEmpty(logoDataUri)
            ? $"<img src='{logoDataUri}' alt='{empresa}' style='max-height:52px;max-width:200px;display:block;margin:0 auto 6px'>" +
              $"<span style='font-size:15px;font-weight:bold;color:#333'>{empresa}</span>"
            : $"<span style='font-size:20px;font-weight:bold;color:#333'>{empresa}</span>";

        // Bloco de contato da empresa (só mostra o que existir)
        var contato = new System.Text.StringBuilder();
        if (!string.IsNullOrWhiteSpace(telefone)) contato.Append($"📞 {telefone}&nbsp;&nbsp;");
        if (!string.IsNullOrWhiteSpace(email)) contato.Append($"✉️ {email}<br>");
        if (!string.IsNullOrWhiteSpace(endereco))
        {
            contato.Append(endereco);
            if (!string.IsNullOrWhiteSpace(cidadeUf)) contato.Append($" — {cidadeUf}");
        }
        else if (!string.IsNullOrWhiteSpace(cidadeUf)) contato.Append(cidadeUf);
        var contatoHtml = contato.Length > 0
            ? $"<div style='margin-top:6px;color:#555;font-size:13px;line-height:1.6'>{contato}</div>" : "";

        var plural = balancas.GetArrayLength() == 1;

        return $@"
<div style='font-family:Arial,sans-serif;max-width:580px;margin:0 auto;color:#333'>
  <div style='background:{cor};padding:20px 22px;border-radius:8px 8px 0 0;text-align:center'>
    <div style='background:#fff;display:inline-block;padding:10px 16px;border-radius:6px'>{cabecalho}</div>
  </div>
  <div style='padding:24px;border:1px solid #eee;border-top:none;border-radius:0 0 8px 8px'>
    <h2 style='margin:0 0 16px;font-size:17px;color:{cor}'>Aviso de vencimento de calibração</h2>
    <p>Prezado(a) cliente <b>{cliente}</b>,</p>
    <p>Informamos que {(plural ? "o seguinte equipamento está" : "os seguintes equipamentos estão")}
       com a calibração próxima do vencimento:</p>
    <table style='width:100%;border-collapse:collapse;margin:16px 0'>
      <thead><tr>
        <th style='text-align:left;padding:10px 12px;background:#f4f7fa;font-size:13px'>Equipamento</th>
        <th style='text-align:left;padding:10px 12px;background:#f4f7fa;font-size:13px'>Vence em</th>
      </tr></thead>
      <tbody>{linhas}</tbody>
    </table>
    <p>Para manter a conformidade metrológica e evitar interrupções, recomendamos
       agendar a recalibração com antecedência.</p>
    <p>Entre em contato conosco para agendar. Estamos à disposição.</p>
    <div style='margin-top:24px;padding-top:16px;border-top:1px solid #eee'>
      <div style='color:#888;font-size:13px'>Atenciosamente,</div>
      <div style='font-weight:bold;font-size:15px;color:{cor};margin-top:2px'>{empresa}</div>
      {contatoHtml}
    </div>
  </div>
  <div style='text-align:center;padding:12px;color:#aaa;font-size:11px'>
    Enviado via <b style='color:#999'>TSCert</b> · Sistema de Certificados de Calibração
  </div>
</div>";
    }

    // ── Pesquisa de satisfação (NPS) ────────────────────────────
    // Cria um envio (com token) por cliente e enfileira o e-mail com o link.
    async Task ProcessarPesquisas(Guid empresaId, Guid? clienteId, string modo)
    {
        await using var conn = await db.OpenConnectionAsync();
        await conn.ExecuteAsync("SELECT set_config('app.empresa_id', @id, false)",
            new { id = empresaId.ToString() });

        var emp = await conn.QuerySingleOrDefaultAsync(
            @"SELECT razao_social, pesquisa_freq_dias, logo_url, cor_marca, email
                FROM empresa WHERE id = @id", new { id = empresaId });
        if (emp is null) return;
        string empresaNome = (string)emp.razao_social;
        int freq = (int)emp.pesquisa_freq_dias;
        string? empEmail = (string?)emp.email;

        // Verifica se há ao menos uma pergunta ativa
        var temPergunta = await conn.ExecuteScalarAsync<bool>(
            "SELECT EXISTS(SELECT 1 FROM pesquisa_pergunta WHERE empresa_id = @id AND ativa)",
            new { id = empresaId });
        if (!temPergunta)
        {
            log.LogWarning("Pesquisa não enviada: empresa {Id} sem perguntas configuradas.", empresaId);
            return;
        }

        // Clientes-alvo: com e-mail; no periódico, respeita a frequência
        var clientes = (await conn.QueryAsync(
            @"SELECT c.id, c.razao_social, c.email
                FROM cliente c
               WHERE c.ativo AND c.email IS NOT NULL AND c.email <> ''
                 AND c.empresa_id = @empId          -- ISOLAMENTO DE TENANT
                 AND (@cli IS NULL OR c.id = @cli)
                 AND (@respeitarFreq = false OR NOT EXISTS (
                     SELECT 1 FROM pesquisa_envio pe
                      WHERE pe.cliente_id = c.id
                        AND pe.enviado_em > now() - make_interval(days => @freq)))",
            new { cli = clienteId, respeitarFreq = modo == "periodico", freq, empId = empresaId })).ToList();

        if (clientes.Count == 0) { log.LogInformation("Pesquisa ({Modo}): nenhum cliente a enviar.", modo); return; }

        var baseUrl = cfg["App:PortalUrl"] ?? "https://portalclientes.totalscale.com.br";
        var rEmail = redis.GetDatabase();

        string? logoDataUri = await CarregarLogoDataUri((string?)emp.logo_url);
        string cor = CorValida((string?)emp.cor_marca) ? CorHex((string?)emp.cor_marca) : "#1e3a5f";

        foreach (var c in clientes)
        {
            var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(24)).ToLowerInvariant();
            await conn.ExecuteAsync(
                @"INSERT INTO pesquisa_envio (empresa_id, cliente_id, token, modo)
                  VALUES (@emp, @cli, @token, @modo)",
                new { emp = empresaId, cli = (Guid)c.id, token, modo });

            var link = $"{baseUrl}/pesquisa.html?t={token}";
            var html = MontarEmailPesquisa(empresaNome, (string)c.razao_social, link, logoDataUri, cor);
            await EnfileirarEmail(rEmail, (string)c.email, (string)c.razao_social,
                $"Sua opinião é importante — {empresaNome}", html,
                "pesquisa_satisfacao", empresaId, (Guid)c.id, empEmail);
        }
        log.LogInformation("Pesquisa ({Modo}): {Qtd} cliente(s).", modo, clientes.Count);
    }

    // Envia a pesquisa para um E-MAIL DE TESTE (não é um cliente): o envio é
    // gravado com modo='teste' e fica FORA das estatísticas do dashboard
    // (as funções de resumo ignoram modo='teste' — migração 84). O link do
    // e-mail abre a página pública real, servindo também de prévia fiel.
    async Task ProcessarPesquisaTeste(Guid empresaId, string email)
    {
        await using var conn = await db.OpenConnectionAsync();
        await conn.ExecuteAsync("SELECT set_config('app.empresa_id', @id, false)",
            new { id = empresaId.ToString() });

        var emp = await conn.QuerySingleOrDefaultAsync(
            @"SELECT razao_social, logo_url, cor_marca, email
                FROM empresa WHERE id = @id", new { id = empresaId });
        if (emp is null) return;
        string empresaNome = (string)emp.razao_social;

        var temPergunta = await conn.ExecuteScalarAsync<bool>(
            "SELECT EXISTS(SELECT 1 FROM pesquisa_pergunta WHERE empresa_id = @id AND ativa)",
            new { id = empresaId });
        if (!temPergunta)
        {
            log.LogWarning("Pesquisa TESTE não enviada: empresa {Id} sem perguntas configuradas.", empresaId);
            return;
        }

        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(24)).ToLowerInvariant();
        await conn.ExecuteAsync(
            @"INSERT INTO pesquisa_envio (empresa_id, cliente_id, token, modo)
              VALUES (@emp, NULL, @token, 'teste')", new { emp = empresaId, token });

        var baseUrl = cfg["App:PortalUrl"] ?? "https://portalclientes.totalscale.com.br";
        var link = $"{baseUrl}/pesquisa.html?t={token}";
        string? logoDataUri = await CarregarLogoDataUri((string?)emp.logo_url);
        string cor = CorValida((string?)emp.cor_marca) ? CorHex((string?)emp.cor_marca) : "#1e3a5f";
        var html = MontarEmailPesquisa(empresaNome, "Cliente (teste)", link, logoDataUri, cor);
        await EnfileirarEmail(redis.GetDatabase(), email, "Teste",
            $"[TESTE] Sua opinião é importante — {empresaNome}", html,
            "pesquisa_teste", empresaId, null, (string?)emp.email);
        log.LogInformation("Pesquisa TESTE enviada para {Email}.", email);
    }

    // Helpers reaproveitáveis para logo/cor
    async Task<string?> CarregarLogoDataUri(string? logoUrl)
    {
        try
        {
            if (string.IsNullOrEmpty(logoUrl)) return null;
            var semPrefixo = logoUrl.Replace("s3://", "");
            var barra = semPrefixo.IndexOf('/');
            if (barra <= 0) return null;
            var bytes = await storage.Ler(semPrefixo[(barra + 1)..]);
            if (bytes is not { Length: > 0 }) return null;
            var ext = System.IO.Path.GetExtension(logoUrl).TrimStart('.').ToLowerInvariant();
            var mime = ext == "png" ? "image/png" : ext is "jpg" or "jpeg" ? "image/jpeg" : "image/png";
            return $"data:{mime};base64,{Convert.ToBase64String(bytes)}";
        }
        catch { return null; }
    }
    static bool CorValida(string? c) => !string.IsNullOrWhiteSpace(c) &&
        System.Text.RegularExpressions.Regex.IsMatch(c, "^#?[0-9A-Fa-f]{6}$");
    static string CorHex(string c) => c.StartsWith("#") ? c : "#" + c;

    string MontarEmailPesquisa(string empresa, string cliente, string link,
        string? logoDataUri, string cor)
    {
        var cabecalho = !string.IsNullOrEmpty(logoDataUri)
            ? $"<img src='{logoDataUri}' alt='{empresa}' style='max-height:52px;max-width:200px;display:block;margin:0 auto 6px'>" +
              $"<span style='font-size:15px;font-weight:bold;color:{cor}'>{empresa}</span>"
            : $"<span style='font-size:20px;font-weight:bold;color:{cor}'>{empresa}</span>";
        return $@"
<div style='font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#333'>
  <div style='background:{cor};padding:20px;border-radius:8px 8px 0 0;text-align:center'>
    <div style='background:#fff;display:inline-block;padding:10px 16px;border-radius:6px'>{cabecalho}</div>
  </div>
  <div style='padding:26px;border:1px solid #eee;border-top:none;border-radius:0 0 8px 8px;text-align:center'>
    <h2 style='margin:0 0 12px;font-size:18px;color:{cor}'>Sua opinião é importante!</h2>
    <p style='text-align:left'>Prezado(a) cliente <b>{cliente}</b>,</p>
    <p style='text-align:left'>Gostaríamos de saber como avalia nossos serviços. Sua resposta é rápida
       (menos de 1 minuto) e nos ajuda a melhorar continuamente.</p>
    <a href='{link}' style='display:inline-block;margin:18px 0;padding:14px 32px;background:{cor};
       color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;font-size:15px'>
       Responder pesquisa</a>
    <p style='text-align:left;color:#888;font-size:12px'>Ou copie e cole este link no navegador:<br>{link}</p>
    <p style='text-align:left;margin-top:20px;color:#888;font-size:13px'>Agradecemos sua colaboração,<br><b>{empresa}</b></p>
  </div>
  <div style='text-align:center;padding:12px;color:#aaa;font-size:11px'>
    Enviado via <b style='color:#999'>TSCert</b>
  </div>
</div>";
    }

    // O cliente final pediu calibracao pelo portal -> avisa a empresa.
    async Task EmailSolicitacaoCalibracao(Guid solicitacaoId)
    {
        await using var conn = await db.OpenConnectionAsync();
        var s = await conn.QuerySingleOrDefaultAsync("""
            SELECT sc.id, sc.empresa_id, sc.solicitante, sc.balancas, sc.mensagem,
                   sc.criado_em, c.razao_social AS cliente, c.telefone, c.email AS email_cliente,
                   c.cidade, c.uf
              FROM solicitacao_calibracao sc
              LEFT JOIN cliente c ON c.id = sc.cliente_id
             WHERE sc.id = @id
            """, new { id = solicitacaoId });
        if (s is null) return;

        var corpo =
            "<p>🔔 <b>Um cliente pediu calibração pelo portal.</b></p>" +
            "<table style=\"border-collapse:collapse;font-size:14px;margin:14px 0\">" +
            $"<tr><td style=\"padding:5px 14px 5px 0\"><b>Cliente</b></td><td>{s.cliente}</td></tr>" +
            (s.cidade is string cid && cid.Length > 0
              ? $"<tr><td style=\"padding:5px 14px 5px 0\"><b>Cidade</b></td><td>{cid}/{s.uf}</td></tr>" : "") +
            $"<tr><td style=\"padding:5px 14px 5px 0\"><b>Pedido por</b></td><td>{s.solicitante}</td></tr>" +
            (s.telefone is string tel && tel.Length > 0
              ? $"<tr><td style=\"padding:5px 14px 5px 0\"><b>Telefone</b></td><td>{tel}</td></tr>" : "") +
            (s.balancas is string bal && bal.Length > 0
              ? $"<tr><td style=\"padding:5px 14px 5px 0\"><b>Balanças</b></td><td>{bal}</td></tr>"
              : "<tr><td style=\"padding:5px 14px 5px 0\"><b>Balanças</b></td><td>não especificadas</td></tr>") +
            "</table>" +
            (s.mensagem is string msg && msg.Length > 0
              ? $"<p><b>Mensagem do cliente:</b><br><i>{msg}</i></p>" : "") +
            "<p>O pedido está registrado no sistema, em <b>Calibrações vencendo → " +
            "Solicitações dos clientes</b>. Combine a data e marque como atendido por lá.</p>" +
            "<p style=\"color:#666;font-size:13px\">Responder rápido a um pedido desses costuma " +
            "ser a diferença entre renovar o serviço e ver o cliente procurar outra empresa.</p>";

        var gest = await conn.QueryAsync("""
            SELECT DISTINCT ON (lower(email)) nome, email
              FROM usuario
             WHERE empresa_id = @id AND ativo
               AND papel IN ('admin', 'responsavel_tecnico')
               AND email IS NOT NULL AND email <> ''
             ORDER BY lower(email)
            """, new { id = (Guid)s.empresa_id });
        foreach (var g in gest)
            await EnviarEmailSimples((string)g.email, (string)g.nome,
                $"🔔 {s.cliente} pediu calibração pelo portal",
                corpo, "solicitacao_calibracao", (Guid)s.empresa_id);
        log.LogInformation("Solicitação de calibração avisada: {Cliente}", (string?)s.cliente);
    }

    // "Esqueci minha senha" do portal: link de uso unico, 1 hora.
    async Task EmailPortalSenha(string email, string? nome, string token)
    {
        var baseUrl = cfg["App:PortalUrl"] ?? "https://portalclientes.totalscale.com.br";
        var link = $"{baseUrl}/portal.html?senha={token}";
        var corpo =
            $"<p>Olá{(string.IsNullOrWhiteSpace(nome) ? "" : ", " + nome)},</p>" +
            "<p>Recebemos um pedido para criar uma nova senha do seu acesso ao " +
            "<b>portal de certificados</b>. É só clicar no botão abaixo:</p>" +
            $"<p style=\"margin:22px 0\"><a href=\"{link}\" " +
            "style=\"background:#12263f;color:#fff;padding:12px 22px;border-radius:8px;" +
            "text-decoration:none;font-weight:bold\">Criar nova senha</a></p>" +
            $"<p style=\"font-size:12px;color:#666\">Ou copie e cole no navegador:<br>{link}</p>" +
            "<p>O link vale por <b>1 hora</b> e só pode ser usado uma vez.</p>" +
            "<p style=\"color:#666;font-size:13px\">Se não foi você que pediu, pode ignorar " +
            "este e-mail — sua senha atual continua valendo.</p>";
        await EnviarEmailSimples(email, nome ?? "Cliente",
            "Criar nova senha — portal de certificados", corpo, "reset_senha");
    }

    // Convite da EMPRESA ao cliente: link para ele definir a senha.
    async Task EmailPortalConvite(string email, string? nome, string token)
    {
        var baseUrl = cfg["App:PortalUrl"] ?? "https://portalclientes.totalscale.com.br";
        var link = $"{baseUrl}/portal.html?convite={token}";
        var corpo =
            $"<p>Olá{(string.IsNullOrWhiteSpace(nome) ? "" : ", " + nome)},</p>" +
            "<p>Você foi convidado a acessar o <b>portal de certificados</b>, onde pode " +
            "baixar a qualquer momento os certificados de calibração das suas balanças " +
            "e os certificados dos pesos-padrão usados nos ensaios.</p>" +
            "<p>Seu <b>login será este e-mail</b>. Falta só criar a sua senha:</p>" +
            $"<p style=\"margin:22px 0\"><a href=\"{link}\" " +
            "style=\"background:#12263f;color:#fff;padding:12px 22px;border-radius:8px;" +
            "text-decoration:none;font-weight:bold\">Criar minha senha</a></p>" +
            $"<p style=\"font-size:12px;color:#666\">Ou copie e cole no navegador:<br>{link}</p>" +
            "<p>O convite vale por <b>3 dias</b>. Se não quiser o acesso, é só ignorar este e-mail.</p>";
        await EnviarEmailSimples(email, nome ?? "Cliente",
            "Seu acesso ao portal de certificados", corpo, "convite_portal");
    }

    // Boas-vindas: confirma o endereço do portal e o login (nunca a senha —
    // e-mail não é canal seguro para senha, e ela fica só como hash aqui).
    async Task EmailPortalBoasVindas(string email)
    {
        var baseUrl = cfg["App:PortalUrl"] ?? "https://portalclientes.totalscale.com.br";
        var corpo =
            "<p>Olá,</p><p>Seu acesso ao portal de certificados está <b>ativo</b>. " +
            "Guarde este e-mail para consultar quando precisar:</p>" +
            "<table style=\"border-collapse:collapse;font-size:14px;margin:14px 0\">" +
            $"<tr><td style=\"padding:6px 14px 6px 0\"><b>Endereço</b></td><td><a href=\"{baseUrl}/portal.html\">{baseUrl}</a></td></tr>" +
            $"<tr><td style=\"padding:6px 14px 6px 0\"><b>Login</b></td><td>{email}</td></tr>" +
            "<tr><td style=\"padding:6px 14px 6px 0\"><b>Senha</b></td><td>a que você acabou de criar</td></tr>" +
            "</table>" +
            "<p>Esqueceu a senha? Use a opção <b>Esqueci minha senha</b> na tela de entrada — " +
            "por segurança, nunca enviamos senhas por e-mail.</p>" +
            "<p>No portal você encontra os certificados de calibração das suas balanças e os " +
            "certificados dos pesos-padrão usados nos ensaios, sempre atualizados.</p>";
        await EnviarEmailSimples(email, "Cliente",
            "Portal de certificados — seu acesso está ativo", corpo, "confirmacao_portal");
    }

    async Task EmailPortalValidacao(string email, string token)
    {
        var baseUrl = cfg["App:PortalUrl"] ?? "https://portalclientes.totalscale.com.br";
        var link = $"{baseUrl}/portal.html?validar={token}";
        var corpo =
            "<p>Olá,</p>" +
            "<p>Recebemos um pedido para criar seu acesso ao portal de certificados.</p>" +
            $"<p><a href=\"{link}\">Clique aqui para confirmar seu e-mail</a> e ativar o acesso.</p>" +
            "<p>O link é válido por 3 dias. Se você não solicitou, ignore este e-mail.</p>";
        await EnviarEmailSimples(email, "Cliente", "Confirme seu acesso ao portal de certificados", corpo, "confirmacao_portal");
    }

    // Enfileira um e-mail para envio cadenciado (usado em envios em massa,
    // como os avisos de vencimento). Não envia na hora — o loop processa
    // 1 por vez respeitando o intervalo e o teto por hora.
    async Task EnfileirarEmail(IDatabase r, string para, string nome, string assunto,
        string html, string motivo, Guid? empresaId, Guid? clienteId, string? replyTo = null)
    {
        await r.ListLeftPushAsync(FilaEmails, JsonSerializer.Serialize(new
        {
            para, nome, assunto, html, motivo,
            empresa_id = empresaId?.ToString(),
            cliente_id = clienteId?.ToString(),
            reply_to = replyTo
        }));
    }

    // Consome 1 e-mail da fila cadenciada, respeitando intervalo e teto/hora.
    async Task ProcessarUmEmailCadenciado(IDatabase r)
    {
        // Respeita o intervalo mínimo entre envios
        var desdeUltimo = (DateTime.UtcNow - _ultimoEmailEnviado).TotalMilliseconds;
        if (desdeUltimo < IntervaloEmailMs) return;
        // Em janela de manutenção, os e-mails ficam NA FILA (não se perdem)
        if (await EmailsPausados()) return;

        // Controle de teto por hora (janela deslizante de 1h)
        if ((DateTime.UtcNow - _janelaHoraInicio).TotalHours >= 1)
        {
            _janelaHoraInicio = DateTime.UtcNow;
            _emailsNaJanela = 0;
        }
        if (_emailsNaJanela >= TetoEmailPorHora)
        {
            // Atingiu o teto: não envia agora (deixa os itens na fila para a próxima janela)
            return;
        }

        var item = await r.ListRightPopAsync(FilaEmails);
        if (item.IsNullOrEmpty) return;

        try
        {
            var e = JsonDocument.Parse(item!.ToString()).RootElement;
            Guid? emp = e.TryGetProperty("empresa_id", out var ep) && ep.ValueKind != JsonValueKind.Null
                ? Guid.Parse(ep.GetString()!) : (Guid?)null;
            Guid? cli = e.TryGetProperty("cliente_id", out var cp) && cp.ValueKind != JsonValueKind.Null
                ? Guid.Parse(cp.GetString()!) : (Guid?)null;
            string? replyTo = e.TryGetProperty("reply_to", out var rt) && rt.ValueKind == JsonValueKind.String
                ? rt.GetString() : null;
            await EnviarEmailSimples(
                e.GetProperty("para").GetString()!,
                e.GetProperty("nome").GetString()!,
                e.GetProperty("assunto").GetString()!,
                e.GetProperty("html").GetString()!,
                e.GetProperty("motivo").GetString() ?? "sistema",
                emp, cli, null, replyTo);
            _ultimoEmailEnviado = DateTime.UtcNow;
            _emailsNaJanela++;
        }
        catch (Exception ex)
        {
            log.LogError(ex, "Falha ao processar e-mail da fila cadenciada.");
        }
    }

    async Task EnviarEmailSimples(string para, string nome, string assunto, string html,
        string motivo = "sistema", Guid? empresaId = null, Guid? clienteId = null,
        Guid? certificadoId = null, string? replyTo = null)
    {
        var bloqueio = await ChecarSupressao(para, empresaId, motivo);
        if (bloqueio is not null)
        {
            log.LogInformation("Envio SUPRIMIDO para {Para} ({Motivo}): {Bloqueio}",
                para, motivo, bloqueio);
            await RegistrarEmail(para, nome, assunto, motivo, "suprimido", bloqueio,
                empresaId, clienteId, certificadoId);
            return;
        }
        await EspacarEnvio();
        try
        {
            var (host, port, user, pass, from, nomeR) = await SmtpConfig();
            var msg = new MimeMessage();
            msg.From.Add(new MailboxAddress(nomeR, from));
            msg.To.Add(new MailboxAddress(nome, para));
            // Reply-To: se informado (ex.: e-mail da empresa), as respostas
            // do cliente vão para a caixa da empresa, não para o SMTP do sistema.
            if (!string.IsNullOrWhiteSpace(replyTo))
                msg.ReplyTo.Add(new MailboxAddress("", replyTo));
            msg.Subject = assunto;
            msg.Body = new BodyBuilder { HtmlBody = html }.ToMessageBody();
            using var smtp = new SmtpClient();
            await smtp.ConnectAsync(host, port, MailKit.Security.SecureSocketOptions.Auto);
            if (!string.IsNullOrEmpty(user))
                await smtp.AuthenticateAsync(user, pass);
            await smtp.SendAsync(msg);
            await smtp.DisconnectAsync(true);
            log.LogInformation("Email de conta enviado para {Para}", para);
            await RegistrarEmail(para, nome, assunto, motivo, "enviado",
                _tentativaAtual > 1 ? $"entregue na tentativa {_tentativaAtual}" : null,
                empresaId, clienteId, certificadoId, html);
            _tentativaAtual = 1;
        }
        catch (Exception ex)
        {
            var temp = FalhaTemporaria(ex);
            if (temp && _tentativaAtual < MaxTentativasEmail)
            {
                // 4.x.x significa "tente mais tarde" — antes o e-mail era
                // simplesmente descartado. Agora espera e tenta de novo.
                var espera = _tentativaAtual == 1 ? 15 : 60;
                log.LogWarning("Falha TEMPORÁRIA para {Para} (tentativa {T}/{M}): {Msg} — " +
                    "nova tentativa em {S}s", para, _tentativaAtual, MaxTentativasEmail, ex.Message, espera);
                await RegistrarEmail(para, nome, assunto, motivo, "retry",
                    $"tentativa {_tentativaAtual}: {ex.Message}", empresaId, clienteId, certificadoId);
                _tentativaAtual++;
                await Task.Delay(TimeSpan.FromSeconds(espera));
                await EnviarEmailSimples(para, nome, assunto, html, motivo,
                    empresaId, clienteId, certificadoId, replyTo);
                return;
            }
            log.LogError(ex, "Falha DEFINITIVA ao enviar email para {Para} ({Tipo})",
                para, temp ? "temporária, tentativas esgotadas" : "permanente");
            await RegistrarEmail(para, nome, assunto, motivo, "erro",
                (temp ? $"[temporário — {_tentativaAtual} tentativas] " : "[permanente] ") + ex.Message,
                empresaId, clienteId, certificadoId, html);
            _tentativaAtual = 1;
        }
    }

    // Lembrete de acesso para empresas em avaliação (máx. 3 por empresa,
    // 1 a cada 5 dias, só quando estão 3+ dias sem entrar). O texto muda
    // conforme a situação: quem nunca entrou recebe o passo a passo;
    // quem já usou recebe o aviso do prazo.
    async Task LembrarAcessoAvaliacao()
    {
        await using var conn = await db.OpenConnectionAsync();
        var lista = (await conn.QueryAsync(
            "SELECT * FROM empresas_lembrete_acesso()")).ToList();
        if (lista.Count == 0) return;

        foreach (var e in lista)
        {
            var empresaId = (Guid)e.empresa_id;
            var nome = (string)e.admin_nome;
            var primeiroNome = nome.Split(' ')[0];
            var dias = (int)e.dias_cadastro;
            var restam = Math.Max(0, 30 - dias);
            var nunca = (bool)e.nunca_entrou;
            var temCert = (bool)e.tem_certificado;
            var rodada = (int)e.lembretes + 1;

            string assunto, corpo;
            var ajuda =
                "<p style=\"margin-top:20px\">Se preferir, a gente faz junto: " +
                "responda este e-mail ou chame no WhatsApp <b>(31) 3357-4000</b> " +
                "que marcamos 15 minutos para configurar a sua primeira balança.</p>";
            var link = "<p style=\"margin:22px 0\"><a href=\"https://certificados.totalscale.com.br\" " +
                "style=\"background:#12263f;color:#fff;padding:12px 22px;border-radius:8px;" +
                "text-decoration:none;font-weight:bold\">Entrar no TSCert</a></p>";

            if (nunca)
            {
                assunto = "Seu acesso ao TSCert está pronto — vamos começar?";
                corpo =
                    $"<p>Olá, {primeiroNome}!</p>" +
                    "<p>Seu acesso ao <b>TSCert</b> foi criado e está esperando por você. " +
                    "Como ainda não houve o primeiro login, deixo aqui o caminho mais curto " +
                    "para ver o sistema funcionando — leva uns <b>5 minutos</b>:</p>" +
                    "<ol style=\"line-height:1.9\">" +
                    "<li>Cadastre <b>um cliente</b> (só razão social e CNPJ)</li>" +
                    "<li>Cadastre <b>uma balança</b> dele (capacidade e divisão)</li>" +
                    "<li>Clique em <b>+ Nova calibração</b> e emita o primeiro certificado</li>" +
                    "</ol>" +
                    "<p>O sistema calcula os erros, a classe e a conformidade sozinho, e o PDF " +
                    "sai com QR code de validação.</p>" + link +
                    "<p style=\"background:#f0f7fb;border-left:3px solid #35b6e8;padding:10px 14px\">" +
                    "<b>Não recebeu o convite para criar sua senha?</b> Pode ter caído no spam " +
                    "ou o e-mail pode ter falhado na entrega. Use <b>“Esqueci minha senha”</b> na " +
                    "tela de entrada com este mesmo endereço, ou responda este e-mail que " +
                    "reenviamos o convite na hora.</p>" +
                    $"<p style=\"color:#666;font-size:13px\">Seu período de avaliação é de 30 dias " +
                    $"a partir do cadastro — <b>restam {restam} dias</b>.</p>" + ajuda;
            }
            else if (restam > 7)
            {
                assunto = $"Como está indo o teste do TSCert? (restam {restam} dias)";
                corpo =
                    $"<p>Olá, {primeiroNome}!</p>" +
                    $"<p>Vi que faz alguns dias que ninguém da <b>{(string)e.empresa}</b> " +
                    "entrou no TSCert. Passando só para saber se ficou alguma dúvida " +
                    "atravessada — normalmente é algo simples de resolver.</p>" +
                    (temCert
                        ? "<p>Você já emitiu certificado no sistema, então o principal já foi. " +
                          "Vale conhecer também os <b>avisos de vencimento</b> (o sistema lembra " +
                          "você antes de cada calibração vencer) e o <b>portal do cliente</b>, " +
                          "onde seus clientes baixam os certificados sozinhos.</p>"
                        : "<p>Se ainda não emitiu o primeiro certificado, dá para fazer em 5 minutos: " +
                          "cadastre um cliente, uma balança e clique em <b>+ Nova calibração</b>.</p>") +
                    link +
                    $"<p>Seu período de avaliação continua ativo — <b>restam {restam} dias</b>.</p>" +
                    ajuda;
            }
            else
            {
                assunto = restam > 0
                    ? $"Seu período de avaliação do TSCert termina em {restam} dia(s)"
                    : "Seu período de avaliação do TSCert está terminando";
                corpo =
                    $"<p>Olá, {primeiroNome}!</p>" +
                    (restam > 0
                        ? $"<p>O período de avaliação da <b>{(string)e.empresa}</b> termina em " +
                          $"<b>{restam} dia(s)</b>.</p>"
                        : $"<p>O período de avaliação da <b>{(string)e.empresa}</b> chegou ao fim.</p>") +
                    "<p>Sem drama: se quiser continuar, é só falar com a gente e seguimos com " +
                    "tudo o que você já cadastrou — <b>nada é apagado</b>. Se preferir não " +
                    "continuar agora, também está tudo bem; ficamos por aqui se precisar depois.</p>" +
                    (temCert
                        ? "<p>Aproveito para dizer que os certificados que você emitiu continuam " +
                          "válidos e consultáveis pelo QR code.</p>" : "") +
                    link + ajuda;
            }

            await EnviarEmailSimples((string)e.admin_email, nome, assunto, corpo,
                "lembrete_acesso", empresaId, null, null);
            await conn.ExecuteAsync("SELECT marcar_lembrete_acesso(@id)", new { id = empresaId });
            log.LogInformation("Lembrete de acesso {Rodada}/3 enviado para {Empresa} " +
                "({Dias} dias de cadastro, {SemLogin} sem login).",
                rodada, (string)e.empresa, dias, (int)e.dias_sem_login);
        }
    }

    // Antes de enviar: o destinatário (ou a empresa) pediu para não receber?
    // Devolve o motivo do bloqueio, ou null se pode enviar.
    async Task<string?> ChecarSupressao(string para, Guid? empresaId, string motivo)
    {
        try
        {
            await using var conn = await db.OpenConnectionAsync();
            return await conn.ExecuteScalarAsync<string?>(
                "SELECT email_suprimido(@para, @emp, @mot)",
                new { para, emp = empresaId, mot = motivo });
        }
        catch (Exception ex)
        {
            // Falha na checagem NÃO deve travar o envio de um certificado.
            log.LogWarning(ex, "checagem de supressão falhou para {Para}", para);
            return null;
        }
    }

    // ── Controle de rotinas no BANCO (sobrevive a rebuild/restart) ──
    // Antes isso vivia em variáveis de memória: todo deploy zerava e as
    // rotinas diárias disparavam de novo, enchendo a caixa de e-mail.
    async Task<bool> PodeRodarHoje(string nome)
    {
        try
        {
            await using var c = await db.OpenConnectionAsync();
            return await c.ExecuteScalarAsync<bool>(
                "SELECT rotina_marcar_dia(@n)", new { n = nome });
        }
        catch (Exception ex)
        {
            // Sem acesso ao banco, NÃO roda: melhor atrasar um aviso do que
            // mandar em duplicidade.
            log.LogWarning(ex, "não consegui checar a rotina {Nome}", nome);
            return false;
        }
    }

    async Task<bool> PodeRodarIntervalo(string nome, TimeSpan intervalo)
    {
        try
        {
            await using var c = await db.OpenConnectionAsync();
            return await c.ExecuteScalarAsync<bool>(
                "SELECT rotina_marcar_intervalo(@n, @i)",
                new { n = nome, i = intervalo });
        }
        catch (Exception ex)
        {
            log.LogWarning(ex, "não consegui checar a rotina {Nome}", nome);
            return false;
        }
    }

    // Pausa manual (janela de manutenção). Silencia só o AUTOMÁTICO —
    // convite, senha e certificado, que alguém está esperando, continuam.
    DateTime _pausaConferidaEm = DateTime.MinValue;
    bool _emailsPausados = false;
    async Task<bool> EmailsPausados()
    {
        if ((DateTime.UtcNow - _pausaConferidaEm).TotalSeconds < 30) return _emailsPausados;
        try
        {
            await using var c = await db.OpenConnectionAsync();
            _emailsPausados = await c.ExecuteScalarAsync<bool>("SELECT sistema_emails_pausados()");
            _pausaConferidaEm = DateTime.UtcNow;
        }
        catch { /* na dúvida, não pausa */ }
        return _emailsPausados;
    }

    // Espaçamento GLOBAL entre envios. A fila já respeitava o intervalo, mas
    // vários fluxos (cobranças, contratos vencendo, avisos a gestores) enviam
    // direto em laço — sem isso, N destinatários viravam N e-mails instantâneos.
    // Provedores tratam sequência rápida como abuso e devolvem erro 4.x.x.
    async Task EspacarEnvio()
    {
        var faltam = IntervaloEmailMs - (DateTime.UtcNow - _ultimoEmailEnviado).TotalMilliseconds;
        if (faltam > 0) await Task.Delay((int)Math.Min(faltam, 30000));
        _ultimoEmailEnviado = DateTime.UtcNow;
    }

    // Falha TEMPORÁRIA (vale tentar de novo) x PERMANENTE (endereço inválido).
    // O SMTP usa 4.x.x para temporário e 5.x.x para permanente; somam-se os
    // erros de rede/TLS, que também são passageiros.
    static bool FalhaTemporaria(Exception ex)
    {
        var m = ((ex.Message ?? "") + " " + (ex.InnerException?.Message ?? "")).ToLowerInvariant();
        if (System.Text.RegularExpressions.Regex.IsMatch(m, @"\b5\.\d\.\d\b")) return false;
        return System.Text.RegularExpressions.Regex.IsMatch(m, @"\b4\.\d\.\d\b")
            || m.Contains("queue file write error")
            || m.Contains("read operation failed")
            || m.Contains("operation timed out") || m.Contains("timeout") || m.Contains("timed out")
            || m.Contains("temporarily") || m.Contains("try again")
            || m.Contains("connection reset") || m.Contains("connection refused")
            || m.Contains("broken pipe") || m.Contains("resources")
            || ex is System.Net.Sockets.SocketException
            || ex is System.IO.IOException;
    }

    // Grava o resultado do envio no email_log (para o super-admin monitorar)
    async Task RegistrarEmail(string para, string? nome, string assunto, string motivo,
        string status, string? erro, Guid? empresaId, Guid? clienteId, Guid? certificadoId,
        string? corpoHtml = null)
    {
        try
        {
            await using var conn = await db.OpenConnectionAsync();
            await conn.ExecuteAsync("""
                INSERT INTO email_log (empresa_id, cliente_id, certificado_id, destinatario,
                    nome_destino, assunto, motivo, status, erro_detalhe, corpo_html)
                VALUES (@empresaId, @clienteId, @certificadoId, @para, @nome, @assunto,
                    @motivo, @status, @erro, @corpoHtml)
                """, new { empresaId, clienteId, certificadoId, para, nome, assunto, motivo,
                    status, erro, corpoHtml });
        }
        catch (Exception ex) { log.LogWarning(ex, "Falha ao registrar email_log"); }
    }

    // ── E-mail em LOTE v2 (João, 11/08/2026): envio INDIVIDUAL por
    // destinatário, saudação pelo nome quando cadastrado, template com
    // ícones e linha do certificado com balança + data de emissão.
    // E-mail automatico ao cliente quando uma REVISAO substitui um certificado.
    // Recebe o id do NOVO certificado (vigente); o antigo esta em substitui_id.
    // Cobre o caso do cliente que guardou o PDF antigo no computador e nao
    // teria como saber que ele deixou de valer (Joao, 20/08/2026).
    // Exportacao completa dos dados da empresa (backup / offboarding).
    // Zip com CSVs + PDFs dos certificados emitidos/substituidos no MinIO
    // em exports/; expira em 7 dias (Joao, 20/08/2026).
    async Task ExportarEmpresa(Guid exportId)
    {
        await using var conn = await db.OpenConnectionAsync();
        var exp = await conn.QuerySingleOrDefaultAsync(
            "SELECT id, empresa_id, status FROM exportacao_empresa WHERE id = @exportId",
            new { exportId });
        if (exp is null || (string)exp.status != "pendente")
        {
            log.LogWarning("Export {Id}: inexistente ou ja processada", exportId);
            return;
        }
        Guid emp = (Guid)exp.empresa_id;
        await conn.ExecuteAsync(
            "UPDATE exportacao_empresa SET status='gerando' WHERE id=@exportId", new { exportId });

        // Expurgo de exportacoes vencidas (qualquer empresa)
        var vencidas = (await conn.QueryAsync(
            "SELECT id, arquivo_url FROM exportacao_empresa WHERE status='pronto' AND expira_em < now()"))
            .ToList();
        foreach (var v in vencidas)
        {
            var u0 = (string?)v.arquivo_url;
            if (!string.IsNullOrEmpty(u0))
            {
                var sp0 = u0.Replace("s3://", ""); var i0 = sp0.IndexOf('/');
                if (i0 > 0) await storage.Deletar(sp0[(i0 + 1)..]);
            }
            await conn.ExecuteAsync(
                "UPDATE exportacao_empresa SET status='expirado', arquivo_url=NULL WHERE id=@vid",
                new { vid = (Guid)v.id });
        }

        var tmp = Path.Combine(Path.GetTempPath(), $"export-{exportId:N}.zip");
        try
        {
            var nomeEmp = await conn.ExecuteScalarAsync<string>(
                "SELECT razao_social FROM empresa WHERE id=@emp", new { emp }) ?? "empresa";
            long totalPdf = 0; int nPdf = 0, nPdfSem = 0;
            var contagens = new List<string>();
            var aspa = ((char)34).ToString();
            var nl = ((char)10).ToString();

            using (var zip = System.IO.Compression.ZipFile.Open(
                tmp, System.IO.Compression.ZipArchiveMode.Create))
            {
                async Task Csv(string nomeArq, string sql)
                {
                    try
                    {
                        var rows = (await conn.QueryAsync(sql, new { emp })).ToList();
                        var sb = new System.Text.StringBuilder();
                        if (rows.Count > 0)
                        {
                            string EscCsv(object? v)
                            {
                                var t0 = v switch
                                {
                                    null => "",
                                    DateTime dt0 => dt0.ToString("yyyy-MM-dd HH:mm:ss"),
                                    _ => v.ToString() ?? ""
                                };
                                var precisa = t0.Contains((char)34) || t0.Contains(';')
                                    || t0.Contains((char)10) || t0.Contains((char)13);
                                return precisa ? aspa + t0.Replace(aspa, aspa + aspa) + aspa : t0;
                            }
                            var d0 = (IDictionary<string, object>)rows[0];
                            sb.AppendLine(string.Join(';', d0.Keys));
                            foreach (IDictionary<string, object> rw in rows)
                                sb.AppendLine(string.Join(';', rw.Values.Select(EscCsv)));
                        }
                        var entry = zip.CreateEntry("dados/" + nomeArq);
                        using var st = entry.Open();
                        await st.WriteAsync(new byte[] { 0xEF, 0xBB, 0xBF });
                        await st.WriteAsync(System.Text.Encoding.UTF8.GetBytes(sb.ToString()));
                        contagens.Add($"{nomeArq}: {rows.Count} registros");
                    }
                    catch (Exception ex)
                    {
                        log.LogWarning("Export CSV {A}: {M}", nomeArq, ex.Message);
                        contagens.Add($"{nomeArq}: FALHOU ({ex.Message})");
                    }
                }

                await Csv("clientes.csv",
                    "SELECT * FROM cliente WHERE empresa_id=@emp ORDER BY razao_social");
                await Csv("contatos.csv",
                    "SELECT * FROM cliente_contato WHERE empresa_id=@emp");
                await Csv("balancas.csv",
                    "SELECT * FROM balanca WHERE empresa_id=@emp ORDER BY identificacao");
                await Csv("balanca_faixas.csv",
                    "SELECT f.* FROM balanca_faixa f JOIN balanca b ON b.id=f.balanca_id WHERE b.empresa_id=@emp");
                await Csv("pesos_padrao.csv",
                    "SELECT * FROM peso_padrao WHERE empresa_id=@emp");
                await Csv("pesos_pontos_rbc.csv",
                    "SELECT pt.* FROM peso_ponto_rbc pt JOIN peso_padrao pp ON pp.id=pt.peso_padrao_id WHERE pp.empresa_id=@emp");
                await Csv("certificados.csv", """
                    SELECT ct.numero, ct.status, ct.revisao_num, ct.motivo_revisao,
                           ct.data_calibracao, ct.data_emissao,
                           cl.razao_social AS cliente, b.identificacao AS balanca,
                           ut.nome AS tecnico, ua.nome AS aprovador,
                           ct.ordem_servico, ct.numero_lacre, ct.selo_inmetro,
                           ct.temperatura, ct.umidade, ct.pressao,
                           ct.motivo_cancelamento, ct.uuid_validacao
                      FROM certificado ct
                      JOIN cliente cl ON cl.id = ct.cliente_id
                      JOIN balanca b ON b.id = ct.balanca_id
                      LEFT JOIN usuario ut ON ut.id = ct.tecnico_id
                      LEFT JOIN usuario ua ON ua.id = ct.aprovador_id
                     WHERE ct.empresa_id=@emp ORDER BY ct.data_emissao
                    """);
                await Csv("ensaio_indicacao.csv",
                    "SELECT ct.numero AS certificado, e2.* FROM ensaio_indicacao e2 JOIN certificado ct ON ct.id=e2.certificado_id WHERE ct.empresa_id=@emp");
                await Csv("ensaio_excentricidade.csv",
                    "SELECT ct.numero AS certificado, e2.* FROM ensaio_excentricidade e2 JOIN certificado ct ON ct.id=e2.certificado_id WHERE ct.empresa_id=@emp");
                await Csv("ensaio_repetibilidade.csv",
                    "SELECT ct.numero AS certificado, e2.* FROM ensaio_repetibilidade e2 JOIN certificado ct ON ct.id=e2.certificado_id WHERE ct.empresa_id=@emp");
                await Csv("ensaio_sensibilidade.csv",
                    "SELECT ct.numero AS certificado, e2.* FROM ensaio_sensibilidade e2 JOIN certificado ct ON ct.id=e2.certificado_id WHERE ct.empresa_id=@emp");
                await Csv("usuarios.csv",
                    "SELECT nome, email, papel FROM usuario WHERE empresa_id=@emp ORDER BY nome");

                var pdfs = (await conn.QueryAsync(
                    "SELECT numero, pdf_url FROM certificado WHERE empresa_id=@emp AND status IN ('emitido','substituido') ORDER BY data_emissao",
                    new { emp })).ToList();
                foreach (var p2 in pdfs)
                {
                    var u2 = (string?)p2.pdf_url;
                    if (string.IsNullOrEmpty(u2) || totalPdf > 400_000_000) { nPdfSem++; continue; }
                    byte[]? b2 = null;
                    try
                    {
                        var sp2 = u2.Replace("s3://", ""); var i2 = sp2.IndexOf('/');
                        if (i2 > 0) b2 = await storage.Ler(sp2[(i2 + 1)..]);
                    }
                    catch (Exception ex) { log.LogWarning("Export PDF {N}: {M}", (string?)p2.numero, ex.Message); }
                    if (b2 is null || b2.Length == 0) { nPdfSem++; continue; }
                    totalPdf += b2.Length; nPdf++;
                    var nomePdf = ((string?)p2.numero ?? Guid.NewGuid().ToString("N")).Replace('/', '-');
                    var e3 = zip.CreateEntry($"certificados/{nomePdf}.pdf");
                    using var st3 = e3.Open();
                    await st3.WriteAsync(b2);
                }

                var obsPdf = nPdfSem > 0
                    ? $" (nao incluidos: {nPdfSem} — sem PDF gerado ou limite de 400 MB atingido)" : "";
                var leiame = $"""
                    EXPORTACAO DE DADOS — {nomeEmp}
                    Gerada em: {DateTime.Now:dd/MM/yyyy HH:mm}

                    CONTEUDO
                      dados/         CSVs (separador ponto e virgula, abrem no Excel)
                      certificados/  PDFs dos certificados emitidos e substituidos

                    CONTAGENS
                      {string.Join(nl + "  ", contagens)}

                    PDFs incluidos: {nPdf}{obsPdf}

                    Fotos e anexos de certificados nao sao incluidos nesta exportacao.
                    Este arquivo expira 7 dias apos a geracao.
                    """;
                var eL = zip.CreateEntry("LEIA-ME.txt");
                using var stL = eL.Open();
                await stL.WriteAsync(System.Text.Encoding.UTF8.GetBytes(leiame));
            }

            var bytes = await File.ReadAllBytesAsync(tmp);
            var chave = $"exports/{emp}/{DateTime.UtcNow:yyyyMMdd-HHmm}-{exportId:N}.zip";
            var url = await storage.Salvar(chave, bytes, "application/zip");
            await conn.ExecuteAsync("""
                UPDATE exportacao_empresa
                   SET status='pronto', arquivo_url=@url, tamanho_bytes=@tam,
                       pronto_em=now(), expira_em=now() + interval '7 days'
                 WHERE id=@exportId
                """, new { url, tam = (long)bytes.LongLength, exportId });
            log.LogInformation("Export {Id}: pronto ({MB} MB, {N} PDFs)",
                exportId, bytes.LongLength / 1048576, nPdf);
        }
        catch (Exception ex)
        {
            log.LogError(ex, "Export {Id}: falhou", exportId);
            await conn.ExecuteAsync(
                "UPDATE exportacao_empresa SET status='erro', erro=@e WHERE id=@exportId",
                new { e = ex.Message, exportId });
        }
        finally
        {
            try { if (File.Exists(tmp)) File.Delete(tmp); } catch { }
        }
    }

    async Task EmailRevisaoEmitida(Guid certId)
    {
        await using var conn = await db.OpenConnectionAsync();
        var c = await conn.QuerySingleOrDefaultAsync("""
            SELECT ct.id, ct.numero, ct.uuid_validacao, ct.pdf_url, ct.empresa_id, ct.cliente_id,
                   ant.numero AS numero_antigo,
                   cl.razao_social AS cliente, cl.email AS email_cliente,
                   e.razao_social AS empresa,
                   b.identificacao AS balanca
              FROM certificado ct
              JOIN certificado ant ON ant.id = ct.substitui_id
              JOIN cliente cl ON cl.id = ct.cliente_id
              JOIN empresa e ON e.id = ct.empresa_id
              JOIN balanca b ON b.id = ct.balanca_id
             WHERE ct.id = @certId AND ct.status = 'emitido'
            """, new { certId });
        if (c is null)
        {
            log.LogWarning("RevisaoEmitida: certificado {Id} nao encontrado ou sem substituicao", certId);
            return;
        }

        // Destinatarios: contatos com "recebe_certificado" + e-mail principal do cliente
        var dest = (await conn.QueryAsync<(string email, string? nome)>("""
            SELECT email, nome FROM cliente_contato
             WHERE cliente_id = @cli AND recebe_certificado
               AND email IS NOT NULL AND email <> ''
            """, new { cli = (Guid)c.cliente_id })).ToList();
        var emailCli = (string?)c.email_cliente;
        if (!string.IsNullOrWhiteSpace(emailCli) &&
            !dest.Any(d => d.email.Trim().Equals(emailCli.Trim(), StringComparison.OrdinalIgnoreCase)))
            dest.Add((emailCli.Trim(), null));
        if (dest.Count == 0)
        {
            log.LogWarning("RevisaoEmitida {Num}: cliente sem e-mail cadastrado", (string?)c.numero);
            return;
        }

        // PDF do vigente: o gerar_pdf esta na mesma fila; espera ficar pronto (ate ~90s).
        // Se nao ficar, envia mesmo assim com o link de validacao (sem anexo).
        byte[]? pdf = null;
        var pdfUrl = (string?)c.pdf_url;
        for (var i = 0; i < 18 && string.IsNullOrEmpty(pdfUrl); i++)
        {
            await Task.Delay(5000);
            pdfUrl = await conn.ExecuteScalarAsync<string?>(
                "SELECT pdf_url FROM certificado WHERE id = @certId", new { certId });
        }
        if (!string.IsNullOrEmpty(pdfUrl))
        {
            try
            {
                var sp = pdfUrl.Replace("s3://", "");
                var b0 = sp.IndexOf('/');
                if (b0 > 0) pdf = await storage.Ler(sp[(b0 + 1)..]);
            }
            catch (Exception ex) { log.LogWarning("RevisaoEmitida: PDF nao baixou: {M}", ex.Message); }
        }

        var urlBase = cfg["App:UrlBase"] ?? "https://certificados.totalscale.com.br";
        string empresa = (string)c.empresa, cliente = (string)c.cliente;
        string numeroNovo = (string)c.numero, numeroAntigo = (string)c.numero_antigo;
        string balancaNm = System.Net.WebUtility.HtmlEncode((string)c.balanca);
        Guid empId = (Guid)c.empresa_id, cliId = (Guid)c.cliente_id;
        var linkValidar = $"{urlBase}/validar/{(Guid)c.uuid_validacao}";
        var assunto = $"Certificado {numeroAntigo} substituido pela revisao {numeroNovo}";

        var (host, port, userS, passS, from, _) = await SmtpConfig();
        foreach (var (para, nomeDest) in dest)
        {
            if (await ChecarSupressao(para, empId, "certificado") is not null)
            {
                await RegistrarEmail(para, nomeDest ?? cliente, assunto, "revisao_emitida",
                    "suprimido", "supressao ativa", empId, cliId, certId);
                continue;
            }
            var saud = string.IsNullOrWhiteSpace(nomeDest)
                ? "Prezado cliente,"
                : $"Prezado(a) <b>{System.Net.WebUtility.HtmlEncode(nomeDest)}</b>,";
            var avisoAnexo = pdf is { Length: > 0 }
                ? "O documento vigente segue <b>anexado</b> a este e-mail."
                : "Baixe o documento vigente pelo botao abaixo.";
            var html =
                "<div style='background:#eef2f6;padding:26px 10px;font-family:Arial,Helvetica,sans-serif'>" +
                "<table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden'>" +
                $"<tr><td style='background:#164066;padding:20px 26px'><span style='color:#ffffff;font-size:19px;font-weight:bold'>⚖️ {empresa}</span><br>" +
                "<span style='color:#b9cbdc;font-size:12.5px'>Revisao de certificado</span></td></tr>" +
                "<tr><td style='padding:24px 26px 10px'>" +
                $"<p style='margin:0 0 14px;font-size:14px;color:#16202c'>{saud}</p>" +
                "<div style='background:#fdf6e3;border:1px solid #e8d9a8;border-radius:8px;padding:12px 16px;margin:0 0 16px'>" +
                $"<p style='margin:0;font-size:14px;color:#8a6d1a'><b>⚠️ O certificado {numeroAntigo} foi substituido.</b></p></div>" +
                "<p style='margin:0 0 14px;font-size:14px;color:#16202c;line-height:1.55'>" +
                $"O certificado de calibracao <b>{numeroAntigo}</b>, referente ao equipamento <b>{balancaNm}</b>, " +
                $"foi substituido pela revisao <b>{numeroNovo}</b>, que passa a ser o documento vigente. {avisoAnexo}</p>" +
                "<p style='margin:0 0 18px;font-size:14px;color:#16202c;line-height:1.55'>" +
                "Se voce guardou o PDF anterior, <b>descarte-o</b> e utilize apenas a nova versao. " +
                "A substituicao e uma correcao formal do documento — o registro anterior permanece no historico para fins de auditoria.</p>" +
                $"<p style='text-align:center;margin:0 0 18px'><a href='{linkValidar}' " +
                "style='background:#164066;color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:8px;font-size:14px;display:inline-block'>" +
                $"🔍 Validar / Baixar {numeroNovo}</a></p>" +
                $"<p style='margin:0 0 18px;font-size:14px;color:#16202c'>Atenciosamente,<br><b>{empresa}</b></p></td></tr>" +
                "<tr><td style='background:#f4f7fa;padding:14px 26px;border-top:1px solid #e8edf2'>" +
                "<p style='margin:0;font-size:11.5px;color:#8ba0b5;line-height:1.6'>⚡ Certificados emitidos com " +
                "<a href='https://certificados.totalscale.com.br/tscert.html' style='color:#164066;text-decoration:none'><b>TSCert</b></a> — " +
                "o sistema de gestao de calibracao da Total Scale.</p></td></tr>" +
                "</table></div>";

            await EspacarEnvio();
            try
            {
                var msg = new MimeMessage();
                msg.From.Add(new MailboxAddress(empresa, from));
                msg.To.Add(new MailboxAddress(string.IsNullOrWhiteSpace(nomeDest) ? cliente : nomeDest, para));
                msg.Subject = assunto;
                var corpo = new BodyBuilder { HtmlBody = html };
                if (pdf is { Length: > 0 })
                    corpo.Attachments.Add(numeroNovo + ".pdf", pdf, ContentType.Parse("application/pdf"));
                msg.Body = corpo.ToMessageBody();
                using var smtp = new SmtpClient();
                await smtp.ConnectAsync(host, port, MailKit.Security.SecureSocketOptions.Auto);
                if (!string.IsNullOrEmpty(userS)) await smtp.AuthenticateAsync(userS, passS);
                await smtp.SendAsync(msg);
                await smtp.DisconnectAsync(true);
                await RegistrarEmail(para, nomeDest ?? cliente, assunto, "revisao_emitida", "enviado",
                    pdf is { Length: > 0 } ? "com anexo" : "sem anexo (link)", empId, cliId, certId, html);
                log.LogInformation("RevisaoEmitida: enviado para {P}", para);
            }
            catch (Exception ex)
            {
                log.LogError(ex, "RevisaoEmitida: falha para {P}", para);
                await RegistrarEmail(para, nomeDest ?? cliente, assunto, "revisao_emitida", "erro",
                    ex.Message, empId, cliId, certId, html);
            }
        }
    }

    async Task EmailCertificadosLote(JsonElement t)
    {
        await using var conn = await db.OpenConnectionAsync();
        async Task<byte[]?> LerDoStorageLote(string? url)
        {
            if (string.IsNullOrEmpty(url)) return null;
            var sp = url.Replace("s3://", "");
            var b = sp.IndexOf('/');
            return b > 0 ? await storage.Ler(sp[(b + 1)..]) : null;
        }
        var ids = t.GetProperty("ids").EnumerateArray().Select(x => Guid.Parse(x.GetString()!)).ToList();
        var dest = new List<(string email, string? nome)>();
        if (t.TryGetProperty("destinatarios", out var dj) && dj.ValueKind == JsonValueKind.Array)
            foreach (var d0 in dj.EnumerateArray())
                dest.Add((d0.GetProperty("email").GetString()!.Trim(),
                    d0.TryGetProperty("nome", out var dn) && dn.ValueKind == JsonValueKind.String
                        && !string.IsNullOrWhiteSpace(dn.GetString()) ? dn.GetString() : null));
        else if (t.TryGetProperty("emails", out var ej2) && ej2.ValueKind == JsonValueKind.Array)
            foreach (var e0 in ej2.EnumerateArray()) dest.Add((e0.GetString()!.Trim(), null));
        var mensagem = t.TryGetProperty("mensagem", out var mmm)
            && mmm.ValueKind == JsonValueKind.String ? mmm.GetString() : null;

        var certs = (await conn.QueryAsync(
            "SELECT ct.id, ct.numero, ct.uuid_validacao, ct.pdf_url, ct.empresa_id, ct.cliente_id, " +
            "ct.data_emissao, b.identificacao AS balanca, " +
            "c.razao_social AS cliente, e.razao_social AS empresa " +
            "FROM certificado ct JOIN cliente c ON c.id = ct.cliente_id " +
            "JOIN balanca b ON b.id = ct.balanca_id " +
            "JOIN empresa e ON e.id = ct.empresa_id WHERE ct.id = ANY(@ids)",
            new { ids })).ToList();
        if (certs.Count == 0 || dest.Count == 0) { log.LogWarning("Lote de e-mail vazio"); return; }
        string empresa = certs[0].empresa, cliente = certs[0].cliente;
        Guid empId = certs[0].empresa_id, cliId = certs[0].cliente_id;
        var urlBase = cfg["App:UrlBase"] ?? "https://certificados.minasbalancas.com.br";

        var anexos = new List<(string nome, byte[] dados)>();
        bool anexar = true; long total = 0;
        foreach (var ct2 in certs)
        {
            byte[]? pdf = null;
            try { pdf = await LerDoStorageLote((string?)ct2.pdf_url); }
            catch (Exception ex) { log.LogWarning("Lote: PDF {N} nao baixou: {M}", (string?)ct2.numero, ex.Message); }
            if (pdf == null || pdf.Length == 0) { anexar = false; break; }
            total += pdf.Length;
            if (total > 10_000_000) { anexar = false; break; }
            anexos.Add((((string?)ct2.numero ?? "certificado") + ".pdf", pdf));
        }

        var linhasCerts = string.Join("", certs.Select(c2 => {
            string? dtEm = null;
            try { if (c2.data_emissao is DateTime de) dtEm = de.ToString("dd/MM/yyyy"); } catch { }
            return "<tr>" +
            $"<td style=\"padding:11px 16px;border-bottom:1px solid #e8edf2;font-size:14px;color:#16202c\">📄 <b>{(string?)c2.numero ?? "(sem número)"}</b>" +
            $"<br><span style=\"font-size:12px;color:#8ba0b5\">⚖️ {(string?)c2.balanca}{(dtEm != null ? " · 🗓 emitido em " + dtEm : "")}</span></td>" +
            $"<td style=\"padding:11px 16px;border-bottom:1px solid #e8edf2;text-align:right\">" +
            $"<a href=\"{urlBase}/validar/{c2.uuid_validacao}\" style=\"background:#164066;color:#ffffff;text-decoration:none;padding:7px 14px;border-radius:7px;font-size:13px;display:inline-block\">🔍 Validar / Baixar</a></td></tr>"; }));
        var msgOpt = string.IsNullOrWhiteSpace(mensagem) ? "" :
            $"<p style=\"margin:0 0 14px;font-size:14px;color:#16202c;line-height:1.55\">{System.Net.WebUtility.HtmlEncode(mensagem)}</p>";
        var intro = anexar
            ? $"📎 Os <b>{certs.Count} certificado(s)</b> de calibração emitido(s) por {empresa} seguem <b>anexados</b> a este e-mail. Você também pode validar a autenticidade de cada um:"
            : $"🔗 Seguem os <b>{certs.Count} certificado(s)</b> de calibração emitido(s) por {empresa}. Como o conjunto excede o limite de anexos, baixe cada um pelo botão correspondente:";
        var assunto = $"Certificados de Calibração — {cliente} ({certs.Count})";

        var (host, port, userS, passS, from, _) = await SmtpConfig();
        bool algumEnviado = false;
        foreach (var (para, nomeDest) in dest)
        {
            if (await ChecarSupressao(para, empId, "certificado") is not null)
            {
                await RegistrarEmail(para, cliente, assunto, "certificado_lote", "suprimido",
                    "supressão ativa", empId, cliId, (Guid)certs[0].id);
                continue;
            }
            var saud = string.IsNullOrWhiteSpace(nomeDest)
                ? "Prezado cliente," : $"Prezado(a) <b>{System.Net.WebUtility.HtmlEncode(nomeDest)}</b>,";
            var html =
                "<div style=\"background:#eef2f6;padding:26px 10px;font-family:Arial,Helvetica,sans-serif\">" +
                "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden\">" +
                $"<tr><td style=\"background:#164066;padding:20px 26px\"><span style=\"color:#ffffff;font-size:19px;font-weight:bold\">⚖️ {empresa}</span><br>" +
                "<span style=\"color:#b9cbdc;font-size:12.5px\">Certificados de calibração</span></td></tr>" +
                "<tr><td style=\"padding:24px 26px 10px\">" +
                $"<p style=\"margin:0 0 14px;font-size:14px;color:#16202c\">{saud}</p>" + msgOpt +
                $"<p style=\"margin:0 0 16px;font-size:14px;color:#16202c;line-height:1.55\">{intro}</p>" +
                "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"border:1px solid #e8edf2;border-radius:8px\">" +
                linhasCerts + "</table>" +
                $"<p style=\"margin:20px 0 18px;font-size:14px;color:#16202c\">Atenciosamente,<br><b>{empresa}</b></p></td></tr>" +
                "<tr><td style=\"background:#f4f7fa;padding:14px 26px;border-top:1px solid #e8edf2\">" +
                "<p style=\"margin:0;font-size:11.5px;color:#8ba0b5;line-height:1.6\">⚡ Certificados emitidos com " +
                "<a href=\"https://certificados.totalscale.com.br/tscert.html\" style=\"color:#164066;text-decoration:none\"><b>TSCert</b></a> — " +
                "o sistema de gestão de calibração da Total Scale.<br>Certificados profissionais, portal do cliente e etiquetas com QR: " +
                "<a href=\"https://certificados.totalscale.com.br/tscert.html\" style=\"color:#164066\">certificados.totalscale.com.br</a></p></td></tr>" +
                "</table></div>";
            await EspacarEnvio();
            try
            {
                var msg = new MimeMessage();
                msg.From.Add(new MailboxAddress(empresa, from));
                msg.To.Add(new MailboxAddress(string.IsNullOrWhiteSpace(nomeDest) ? cliente : nomeDest, para));
                msg.Subject = assunto;
                var corpo = new BodyBuilder { HtmlBody = html };
                if (anexar)
                    foreach (var (nome, dados) in anexos)
                        corpo.Attachments.Add(nome, dados, ContentType.Parse("application/pdf"));
                msg.Body = corpo.ToMessageBody();
                using var smtp = new SmtpClient();
                await smtp.ConnectAsync(host, port, MailKit.Security.SecureSocketOptions.Auto);
                if (!string.IsNullOrEmpty(userS)) await smtp.AuthenticateAsync(userS, passS);
                await smtp.SendAsync(msg);
                await smtp.DisconnectAsync(true);
                algumEnviado = true;
                await RegistrarEmail(para, nomeDest ?? cliente, assunto, "certificado_lote", "enviado",
                    anexar ? $"{anexos.Count} anexos" : "links (sem anexos)", empId, cliId, (Guid)certs[0].id, html);
                log.LogInformation("Lote: enviado para {P}", para);
            }
            catch (Exception ex)
            {
                log.LogError(ex, "Lote: falha para {P}", para);
                await RegistrarEmail(para, nomeDest ?? cliente, assunto, "certificado_lote", "erro",
                    ex.Message, empId, cliId, (Guid)certs[0].id, html);
            }
        }
        if (algumEnviado)
            await conn.ExecuteAsync("UPDATE certificado SET email_enviado_em = now() WHERE id = ANY(@ids)", new { ids });
    }

    async Task EnviarEmail(NpgsqlConnection conn, Guid id, string para, string numero,
        string empresa, string cliente, byte[] pdf, string urlBase, string uuidVal)
    {
        var ctxEmp = await conn.ExecuteScalarAsync<Guid?>(
            "SELECT empresa_id FROM certificado WHERE id = @id", new { id });
        var bloqueioCert = await ChecarSupressao(para, ctxEmp, "certificado");
        if (bloqueioCert is not null)
        {
            log.LogWarning("Certificado {Num}: envio SUPRIMIDO para {Para} — {Motivo}",
                numero, para, bloqueioCert);
            await RegistrarEmail(para, cliente, $"Certificado de Calibracao {numero}",
                "certificado", "suprimido", bloqueioCert, ctxEmp, null, id);
            return;
        }
        await EspacarEnvio();
        try
        {
            var (host, port, userS, passS, from, _) = await SmtpConfig();
            var msg = new MimeMessage();
            msg.From.Add(new MailboxAddress(empresa, from));
            msg.To.Add(new MailboxAddress(cliente, para));
            msg.Subject = $"Certificado de Calibracao {numero}";
            var corpo = new BodyBuilder
            {
                HtmlBody = $"<p>Prezado cliente,</p>" +
                    $"<p>Segue em anexo o Certificado de Calibracao <b>{numero}</b>, emitido por {empresa}.</p>" +
                    $"<p>Valide a autenticidade em:<br><a href=\"{urlBase}/validar/{uuidVal}\">{urlBase}/validar/{uuidVal}</a></p>" +
                    $"<p>Atenciosamente,<br>{empresa}</p>"
            };
            corpo.Attachments.Add($"{numero}.pdf", pdf, ContentType.Parse("application/pdf"));
            msg.Body = corpo.ToMessageBody();

            using var smtp = new SmtpClient();
            await smtp.ConnectAsync(host, port, MailKit.Security.SecureSocketOptions.Auto);
            if (!string.IsNullOrEmpty(userS))
                await smtp.AuthenticateAsync(userS, passS);
            await smtp.SendAsync(msg);
            await smtp.DisconnectAsync(true);

            await conn.ExecuteAsync(
                "UPDATE certificado SET email_enviado_em=now() WHERE id=@id", new { id });
            log.LogInformation("Email enviado para {Para}", para);

            // registra no email_log com o contexto do certificado
            var ctx = await conn.QuerySingleOrDefaultAsync<(Guid? empresaId, Guid? clienteId)>(
                "SELECT empresa_id, cliente_id FROM certificado WHERE id=@id", new { id });
            await RegistrarEmail(para, cliente, $"Certificado de Calibracao {numero}",
                "certificado", "enviado", null, ctx.empresaId, ctx.clienteId, id);
        }
        catch (Exception ex)
        {
            var temp = FalhaTemporaria(ex);
            Guid? empId = null, cliId = null;
            try {
                var ctx = await conn.QuerySingleOrDefaultAsync<(Guid? empresaId, Guid? clienteId)>(
                    "SELECT empresa_id, cliente_id FROM certificado WHERE id=@id", new { id });
                empId = ctx.empresaId; cliId = ctx.clienteId;
            } catch { }

            // Certificado é o e-mail mais importante do sistema: falha
            // temporária (4.x.x, timeout) merece nova tentativa em vez de
            // ser descartada.
            if (temp && _tentativaAtual < MaxTentativasEmail)
            {
                var espera = _tentativaAtual == 1 ? 15 : 60;
                log.LogWarning("Falha TEMPORÁRIA no certificado {Num} para {Para} " +
                    "(tentativa {T}/{M}): {Msg} — nova tentativa em {S}s",
                    numero, para, _tentativaAtual, MaxTentativasEmail, ex.Message, espera);
                await RegistrarEmail(para, cliente, $"Certificado de Calibracao {numero}",
                    "certificado", "retry", $"tentativa {_tentativaAtual}: {ex.Message}",
                    empId, cliId, id);
                _tentativaAtual++;
                await Task.Delay(TimeSpan.FromSeconds(espera));
                await EnviarEmail(conn, id, para, numero, empresa, cliente, pdf, urlBase, uuidVal);
                return;
            }
            log.LogError(ex, "Falha DEFINITIVA no certificado {Num} para {Para}", numero, para);
            await RegistrarEmail(para, cliente, $"Certificado de Calibracao {numero}",
                "certificado", "erro",
                (temp ? $"[temporário — {_tentativaAtual} tentativas] " : "[permanente] ") + ex.Message,
                empId, cliId, id);
            _tentativaAtual = 1;
        }
    }
}


// DTO tipado do cabeçalho (evita dynamic com o construtor do record)
public sealed record CabecalhoCert(
    string Numero, DateTime? DataCalibracao, DateTime? DataEmissao,
    decimal? Temperatura, decimal? Umidade, string ContextoEma, Guid UuidValidacao,
    string? MetodoSnapshot, string? NumeroLacre, string? SeloInmetro,
    int RevisaoNum, string? SubstituiNumero,
    string? LocalTipo, string? LocalDetalhe, bool HouveAjuste,
    string Empresa, string? NomeFantasia, string? ClausulaSubstituicao,
    string? SubstituicaoJson, string? EnderecoEmpresa, string? CidadeUfEmpresa,
    string? NumAutorizacao, bool Acreditada,
    string? TextoPeriodicidade, string? TituloDocumento, string? TextoRodape,
    string? CorMarca, string? LogoUrl, string? TextoAutorizacao,
    bool MostraValidade,
    string? ModeloCertificado,
    string Cliente, string? CidadeCliente, string? UfCliente,
    string? EnderecoCliente, string? CnpjCliente,
    string Balanca, string? Marca, string? Modelo, string? NumSerie,
    decimal Capacidade, decimal DivisaoE, decimal? DivisaoD, string ClasseExatidao,
    string? LocalInstalacao, string Unidade,
    string? NumeroInmetro, string? Patrimonio, string? PortariaAprovacao,
    int PeriodicidadeMeses, string Tecnico,
    string? Aprovador, string? RegistroAprovador,
    string? AssinaturaTecnicoUrl, string? AssinaturaAprovadorUrl,
    string? NumSerieIndicador = null,
    bool FazExcentricidade = true, bool FazSensibilidade = true,
    int LogoLargura = 90, int LogoAltura = 55, string? LogoAlinhamento = null,
    string? OrdemServico = null, string? EnderecoCalibracao = null,
    bool MarcaSistema = true,
    string? InstrucaoIt = null, string? InstrucaoRev = null);
