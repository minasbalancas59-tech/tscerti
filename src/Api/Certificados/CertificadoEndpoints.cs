using StackExchange.Redis;
using System.Security.Claims;
using System.Text.Json;
using CertSaas.Api.Infra;
using Dapper;
using Npgsql;

namespace CertSaas.Api.Certificados;

public record NovoCertificadoRequest(Guid Id, Guid ClienteId, Guid BalancaId,
    bool EmitirRbc = false, Guid? TecnicoExecutorId = null);
public record RascunhoRequest(JsonElement Dados);

public static class CertificadoEndpoints
{
    public static void Map(WebApplication app)
    {
        // ── Plano de ensaio sugerido pra uma balança ────────────
        app.MapGet("/api/balancas/{id:guid}/plano-ensaio", async (
            Guid id, ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var b = await conn.QuerySingleOrDefaultAsync("""
                SELECT b.id, b.identificacao, b.tipo, b.capacidade, b.divisao_e,
                       b.divisao_d, b.classe_exatidao, b.unidade, b.numero_inmetro,
                       b.patrimonio, b.marca, b.modelo, b.num_serie,
                       b.faz_excentricidade, b.faz_sensibilidade,
                       c.razao_social AS cliente
                  FROM balanca b JOIN cliente c ON c.id = b.cliente_id
                 WHERE b.id = @id
                """, new { id });
            if (b is null) return Results.NotFound();

            decimal cap = b.capacidade, e = b.divisao_e;

            // ── Balança RODOVIÁRIA (regra do João, 09/08/2026) ──
            // Indicação: 11 pontos fixos = carga mínima (20·e) + 1.000 a
            // 10.000 kg de 1.000 em 1.000. Sensibilidade: carga 10.000 kg.
            // Demais tipos seguem o cálculo padrão (nada muda). O técnico
            // continua podendo editar os pontos na tela — é só a sugestão.
            bool rodoviaria = ((string?)b.tipo ?? string.Empty)
                .ToLowerInvariant().Contains("rodovi");
            var cargasRodoviaria = new List<decimal> { 20m * e };
            for (int k = 1; k <= 10; k++) cargasRodoviaria.Add(k * 1000m);
            var (posicoes, cargaExc) = Metrologia.SugerirExcentricidade(
                (string)b.tipo, cap, e);

            // Faixas da balança (multi-intervalo). Vazio = faixa única.
            var faixas = await conn.QueryAsync("""
                SELECT ordem, limite_sup, divisao_e FROM balanca_faixa
                 WHERE balanca_id = @id ORDER BY ordem
                """, new { id });

            var config = await conn.QuerySingleOrDefaultAsync("""
                SELECT usa_excentricidade, usa_repetibilidade, num_repeticoes,
                       exige_temp_umidade, exige_lacre_selo, fator_abrangencia,
                       titulo_documento, usa_ajuste
                  FROM empresa WHERE id = @empresaId
                """, new { empresaId = Tenant.EmpresaId(user) });
            int nRep = config?.num_repeticoes ?? 3;

            // Casas decimais de exibição: usa a MENOR divisão relevante.
            //  - escala única: o menor entre e e d (d costuma ser menor);
            //  - multi-intervalo: o menor e entre as faixas.
            var faixasList = faixas.ToList();
            decimal menorDivisao = e;
            decimal? dReal = b.divisao_d;
            if (dReal is { } dd && dd > 0) menorDivisao = Math.Min(menorDivisao, dd);
            if (faixasList.Count > 0)
            {
                var menorFaixa = faixasList.Min(f => (decimal)f.divisao_e);
                menorDivisao = Math.Min(menorDivisao, menorFaixa);
            }

            return Results.Ok(new
            {
                balanca = b,
                unidade = (string)b.unidade,
                casasDecimais = Unidades.CasasDecimais(menorDivisao),
                config,
                indicacao = rodoviaria
                    ? (object)cargasRodoviaria
                    : Metrologia.SugerirCargasIndicacao(cap, e, (string)b.classe_exatidao),
                sensibilidade = new { carga = rodoviaria ? (decimal?)10000m : null },
                excentricidade = new { posicoes, carga = cargaExc },
                repetibilidade = new
                {
                    medicoes = nRep,
                    carga = Metrologia.CargaMeioFundo(cap, e)  // ~50% da capacidade
                },
                // Regras da classe: o frontend calcula o EMA ao vivo
                emaRegras = await Metrologia.RegrasEma(conn, (string)b.classe_exatidao),
                faixas
            });
        }).RequireAuthorization();

        var g = app.MapGroup("/api/certificados").RequireAuthorization();

        // ── Memorial de cálculo da incerteza (João, 16/08/2026) ──
        // Reproduz a conta ponto a ponto: entradas, componentes, combinação
        // e U final. Serve à equipe (dúvida interna) e ao cliente/auditor.
        g.MapGet("/{id:guid}/memorial-incerteza", async (Guid id,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var linhas = await conn.QueryAsync(
                "SELECT * FROM memorial_incerteza(@id)", new { id });
            if (!linhas.Any()) return Results.NotFound();
            return Results.Ok(linhas);
        });

        // ── Envio de certificados por e-mail em LOTE (João, 11/08/2026) ──
        // Admin/RT · certificados EMITIDOS de UM cliente · um único e-mail.
        g.MapPost("/enviar-lote", async (JsonElement body, ClaimsPrincipal user,
            NpgsqlDataSource ds, IConnectionMultiplexer redis, HttpContext ctx) =>
        {
            var papel = Tenant.Papel(user);
            if (papel is not ("admin" or "responsavel_tecnico"))
                return Results.Forbid();
            var ids = body.GetProperty("ids").EnumerateArray()
                .Select(x => Guid.Parse(x.GetString()!)).Distinct().ToList();
            var emails = body.GetProperty("emails").EnumerateArray()
                .Select(x => (x.GetString() ?? "").Trim()).Where(e => e.Contains('@'))
                .Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            var mensagem = body.TryGetProperty("mensagem", out var mm)
                && mm.ValueKind == JsonValueKind.String ? mm.GetString() : null;
            if (ids.Count == 0 || emails.Count == 0)
                return Results.BadRequest(new { erro = "Selecione certificados e ao menos um destinatário." });
            if (ids.Count > 30)
                return Results.BadRequest(new { erro = "Máximo de 30 certificados por envio." });
            if (emails.Count > 15)
                return Results.BadRequest(new { erro = "Máximo de 15 destinatários." });

            await using var conn = await Tenant.AbrirConexao(ds, user);
            var certs = (await conn.QueryAsync(
                "SELECT id, cliente_id FROM certificado WHERE id = ANY(@ids) AND status = 'emitido'",
                new { ids })).ToList();
            if (certs.Count != ids.Count)
                return Results.BadRequest(new { erro = "Há certificado não emitido (ou inexistente) na seleção." });
            if (certs.Select(c => (Guid)c.cliente_id).Distinct().Count() > 1)
                return Results.BadRequest(new { erro = "Selecione certificados de um único cliente." });

            // Cooldown (João, 11/08/2026): o mesmo destinatário só recebe
            // novo lote após 30s — protege contra duplo clique e reenvio acidental.
            var rdb = redis.GetDatabase();
            foreach (var em in emails)
            {
                var chave = $"lote:cooldown:{Tenant.EmpresaId(user)}:{em.ToLowerInvariant()}";
                if (!await rdb.StringSetAsync(chave, "1",
                        TimeSpan.FromSeconds(30), When.NotExists))
                    return Results.BadRequest(new { erro =
                        $"Um e-mail acabou de ser enviado para {em} — aguarde 30 segundos antes de reenviar." });
            }

            await redis.GetDatabase().ListLeftPushAsync("fila:tarefas",
                System.Text.Json.JsonSerializer.Serialize(new {
                    tipo = "email_certificados_lote",
                    ids = ids.Select(i => i.ToString()).ToList(),
                    emails, mensagem,
                    destinatarios = body.TryGetProperty("destinatarios", out var dj)
                        && dj.ValueKind == JsonValueKind.Array
                        ? System.Text.Json.JsonSerializer.Deserialize<object>(dj.GetRawText()) : null }));
            await Auditoria.Registrar(conn, Tenant.EmpresaId(user), Tenant.UsuarioId(user),
                "certificado", ids[0], "enviar_lote_email",
                System.Text.Json.JsonSerializer.Serialize(new { qtd = ids.Count, emails }),
                Auditoria.Ip(ctx));
            return Results.Ok(new { enfileirado = ids.Count });
        });

        // ── Histórico de calibrações de um cliente ──────────────
        app.MapGet("/api/clientes/{clienteId:guid}/certificados", async (
            Guid clienteId, ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var papel = Tenant.Papel(user);
            var soMeus = papel is not ("admin" or "responsavel_tecnico") && !Tenant.EstaVisualizando(user);
            var rows = await conn.QueryAsync("""
                SELECT ct.id, ct.status, ct.numero, ct.emitir_rbc, ct.data_calibracao,
                       ct.data_emissao, ct.criado_em,
                       b.identificacao AS balanca, b.num_serie, u.nome AS tecnico
                  FROM certificado ct
                  JOIN balanca b ON b.id = ct.balanca_id
                  JOIN usuario u ON u.id = ct.tecnico_id
                 WHERE ct.cliente_id = @clienteId
                   AND (NOT @soMeus OR ct.tecnico_id = @meuId)
                 ORDER BY ct.criado_em DESC LIMIT 200
                """, new { clienteId, soMeus, meuId = Tenant.UsuarioId(user) });
            return Results.Ok(rows);
        }).RequireAuthorization();

        // ── Relatórios (só admin/responsável) ───────────────────
        // Vencimentos: última calibração de cada balança, filtrável por
        // cliente, balança e janela de vencimento (dias; -1 = já vencidas)
        app.MapGet("/api/relatorios/vencimentos", async (Guid? clienteId,
            Guid? balancaId, int? dias, ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var d = dias ?? 60;
            var rows = await conn.QueryAsync("""
                SELECT * FROM (
                    SELECT DISTINCT ON (ct.balanca_id)
                           ct.numero, ct.data_calibracao,
                           b.identificacao AS balanca, b.periodicidade_meses,
                           c.razao_social AS cliente, c.telefone,
                           (ct.data_calibracao
                              + make_interval(months => b.periodicidade_meses))::date AS vence_em
                      FROM certificado ct
                      JOIN balanca b ON b.id = ct.balanca_id
                      JOIN cliente c ON c.id = ct.cliente_id
                     WHERE ct.status = 'emitido' AND ct.data_calibracao IS NOT NULL
                       AND b.periodicidade_meses > 0 AND b.ativa AND c.ativo
                       AND (@clienteId::uuid IS NULL OR ct.cliente_id = @clienteId::uuid)
                       AND (@balancaId IS NULL OR ct.balanca_id = @balancaId)
                     ORDER BY ct.balanca_id, ct.data_calibracao DESC
                ) t
                 WHERE (@d < 0 AND t.vence_em < current_date)
                    OR (@d >= 0 AND t.vence_em <= current_date + @d)
                 ORDER BY t.vence_em
                """, new { clienteId, balancaId, d });
            return Results.Ok(rows);
        }).RequireAuthorization();

        // Certificados emitidos: filtrável por período, cliente e técnico
        app.MapGet("/api/relatorios/emitidos", async (DateTime? de, DateTime? ate,
            Guid? clienteId, Guid? tecnicoId, ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var rows = await conn.QueryAsync("""
                SELECT ct.numero, ct.cliente_id, ct.data_emissao, ct.data_calibracao,
                       c.razao_social AS cliente, b.identificacao AS balanca,
                       u.nome AS tecnico, ct.status,
                       NOT EXISTS (SELECT 1 FROM ensaio_indicacao ei
                                    WHERE ei.certificado_id = ct.id
                                      AND ei.aprovado = false) AS conforme
                  FROM certificado ct
                  JOIN cliente c ON c.id = ct.cliente_id
                  JOIN balanca b ON b.id = ct.balanca_id
                  JOIN usuario u ON u.id = ct.tecnico_id
                 WHERE ct.status IN ('emitido','substituido')
                   AND (@de::timestamptz IS NULL OR ct.data_emissao >= @de::timestamptz)
                   AND (@ate::timestamptz IS NULL OR ct.data_emissao < (@ate::date + 1))
                   AND (@clienteId::uuid IS NULL OR ct.cliente_id = @clienteId::uuid)
                   AND (@tecnicoId::uuid IS NULL OR ct.tecnico_id = @tecnicoId::uuid)
                 ORDER BY ct.data_emissao DESC, ct.numero
                """, new { de, ate, clienteId, tecnicoId });
            return Results.Ok(rows);
        }).RequireAuthorization();

        // Produção por técnico (período opcional)
        app.MapGet("/api/relatorios/producao", async (DateTime? de, DateTime? ate,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var rows = await conn.QueryAsync("""
                SELECT u.nome AS tecnico,
                       count(*) FILTER (WHERE ct.status IN ('emitido','substituido'))::int AS emitidos,
                       count(*) FILTER (WHERE ct.status = 'rascunho')::int AS rascunhos,
                       count(*) FILTER (WHERE ct.status = 'aguardando_aprovacao')::int AS aguardando,
                       count(*) FILTER (WHERE ct.status IN ('emitido','substituido')
                           AND NOT EXISTS (SELECT 1 FROM ensaio_indicacao ei
                               WHERE ei.certificado_id = ct.id AND ei.aprovado = false))::int AS conformes,
                       count(*) FILTER (WHERE ct.status IN ('emitido','substituido')
                           AND EXISTS (SELECT 1 FROM ensaio_indicacao ei
                               WHERE ei.certificado_id = ct.id AND ei.aprovado = false))::int AS nao_conformes
                  FROM usuario u
                  LEFT JOIN certificado ct ON ct.tecnico_id = u.id
                       AND (@de::timestamptz IS NULL OR ct.data_emissao >= @de::timestamptz)
                       AND (@ate::timestamptz IS NULL OR ct.data_emissao < (@ate::date + 1))
                 WHERE u.ativo
                 GROUP BY u.nome
                 HAVING count(ct.id) > 0
                 ORDER BY emitidos DESC, u.nome
                """, new { de, ate });
            return Results.Ok(rows);
        }).RequireAuthorization();

        // Relatório de e-mails enviados (admin/RT) — por período e cliente
        app.MapGet("/api/relatorios/emails", async (DateTime? de, DateTime? ate,
            Guid? cliente, string? motivo, string? status, string? formato,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var emp = Tenant.EmpresaId(user);
            var rows = (await conn.QueryAsync(
                @"SELECT * FROM rel_emails_empresa(@emp, @de, @ate, @cliente, @motivo, @status, 2000)",
                new { emp, de, ate, cliente, motivo, status })).ToList();

            if (formato == "csv" || formato == "pdf")
            {
                var cab = new[] { "Data/hora", "Destinatário", "Cliente", "Assunto",
                    "Tipo", "Status", "Detalhe do erro" };
                string[] Campos(dynamic e) => new string[] {
                    RelCsv.DHora(e.enviado_em), (string?)e.destinatario ?? "",
                    (string?)e.cliente ?? "", (string?)e.assunto ?? "",
                    MotivoEmailExt((string?)e.motivo), (string?)e.status == "erro" ? "Erro" : "Enviado",
                    (string?)e.erro_detalhe ?? "" };
                var dados = rows.Select(Campos).ToList();
                var enviados = rows.Count(r => (string)((dynamic)r).status == "enviado");
                var erros = rows.Count - enviados;
                var totais = new List<string> {
                    $"Total: {rows.Count}", $"Enviados: {enviados}", $"Erros: {erros}" };
                if (formato == "pdf")
                {
                    var nome = await NomeEmpresa(conn);
                    var pesos = new[] { 1.6f, 2.4f, 2f, 2.6f, 1.6f, 1f, 2f };
                    var cols = cab.Select((t, i) => new RelPdf.Coluna(t, pesos[i])).ToList();
                    var pdf = RelPdf.Gerar(nome, "Relatório de E-mails Enviados",
                        PeriodoResumo(de, ate), cols, dados, totais);
                    return Results.File(pdf, "application/pdf", $"emails_{DateTime.Now:yyyyMMdd}.pdf");
                }
                return RelCsv.File(cab, dados.Select(l => RelCsv.Join(l)), $"emails_{DateTime.Now:yyyyMMdd}.csv");
            }

            // JSON + resumo para a tela
            var resumo = await conn.QuerySingleOrDefaultAsync(
                "SELECT * FROM rel_emails_empresa_resumo(@emp, @de, @ate, @cliente)",
                new { emp, de, ate, cliente });
            return Results.Ok(new { resumo, itens = rows });
        }).RequireAuthorization();

        // Todos os clientes (com ordenação: nome|ultimo|cidade|tipo)
        app.MapGet("/api/relatorios/clientes", async (string? ordem, string? formato,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var rows = (await conn.QueryAsync(
                "SELECT * FROM rel_clientes(@ordem)", new { ordem = ordem ?? "nome" })).ToList();

            if (formato == "csv" || formato == "pdf")
            {
                var cab = new[] { "Cliente", "CNPJ", "Telefone", "Cidade", "UF", "Tipos de balança",
                    "Balanças", "Certificados", "Última calibração", "Próxima calibração" };
                string[] Linha(dynamic c) => new string[] {
                    (string?)c.razao_social ?? "", (string?)c.cnpj ?? "", (string?)c.telefone ?? "",
                    (string?)c.cidade ?? "", (string?)c.uf ?? "", (string?)c.tipos_balanca ?? "",
                    (string?)(c.qtd_balancas?.ToString()) ?? "0", (string?)(c.qtd_certificados?.ToString()) ?? "0",
                    RelCsv.D(c.ultima_calibracao), RelCsv.D(c.proxima_calibracao) };
                var dados = rows.Select(Linha).ToList();
                var totais = new List<string> { $"Total de clientes: {rows.Count}" };
                if (formato == "pdf")
                {
                    var nome = await NomeEmpresa(conn);
                    var pesos = new[] { 3f, 2f, 1.6f, 1.6f, 0.6f, 2f, 1f, 1f, 1.6f, 1.6f };
                    var cols = cab.Select((t, i) => new RelPdf.Coluna(t, pesos[i])).ToList();
                    var pdf = RelPdf.Gerar(nome, "Relatório de Clientes", OrdemRotulo(ordem),
                        cols, dados, totais);
                    return Results.File(pdf, "application/pdf", $"clientes_{DateTime.Now:yyyyMMdd}.pdf");
                }
                return RelCsv.File(cab, dados.Select(l => RelCsv.Join(l)), $"clientes_{DateTime.Now:yyyyMMdd}.csv");
            }
            return Results.Ok(rows);
        }).RequireAuthorization();

        // Clientes x balanças (filtros: cliente, tipo, situação, período última calib.)
        app.MapGet("/api/relatorios/clientes-balancas", async (Guid? cliente, string? tipo,
            string? situacao, DateTime? de, DateTime? ate, string? formato,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var rows = (await conn.QueryAsync(
                "SELECT * FROM rel_clientes_balancas(@cliente, @tipo, @situacao, @de, @ate)",
                new { cliente, tipo, situacao,
                    de = de.HasValue ? DateOnly.FromDateTime(de.Value) : (DateOnly?)null,
                    ate = ate.HasValue ? DateOnly.FromDateTime(ate.Value) : (DateOnly?)null })).ToList();

            if (formato == "csv" || formato == "pdf")
            {
                var cab = new[] { "Cliente", "Telefone", "Cidade", "UF", "Balança", "Tipo",
                    "Marca", "Capacidade", "Classe", "Periodic.", "Última calib.", "Próxima calib.", "Situação" };
                string[] Linha(dynamic b) => new string[] {
                    (string?)b.cliente ?? "", (string?)b.telefone ?? "", (string?)b.cidade ?? "",
                    (string?)b.uf ?? "", (string?)b.balanca ?? "", (string?)b.tipo ?? "",
                    (string?)b.marca ?? "", (string?)(b.capacidade?.ToString()) ?? "", (string?)b.classe ?? "",
                    (string?)(b.periodicidade_meses?.ToString()) ?? "", RelCsv.D(b.ultima_calibracao),
                    RelCsv.D(b.proxima_calibracao), (string?)b.situacao ?? "" };
                var dados = rows.Select(Linha).ToList();
                // Totais por situação
                var porSit = rows.GroupBy(r => (string)((dynamic)r).situacao)
                    .ToDictionary(g => g.Key, g => g.Count());
                var totais = new List<string> { $"Total de balanças: {rows.Count}" };
                foreach (var s in new[] { "Em dia", "Vence em breve", "Vencida", "Sem calibração" })
                    if (porSit.TryGetValue(s, out var q)) totais.Add($"{s}: {q}");
                if (formato == "pdf")
                {
                    var nome = await NomeEmpresa(conn);
                    var pesos = new[] { 2.6f, 1.6f, 1.4f, 0.5f, 1.8f, 1.2f, 1.4f, 1f, 0.8f, 0.8f, 1.4f, 1.4f, 1.3f };
                    var cols = cab.Select((t, i) => new RelPdf.Coluna(t, pesos[i])).ToList();
                    var pdf = RelPdf.Gerar(nome, "Clientes × Balanças", FiltrosResumo(cliente, tipo, situacao),
                        cols, dados, totais);
                    return Results.File(pdf, "application/pdf", $"clientes_balancas_{DateTime.Now:yyyyMMdd}.pdf");
                }
                return RelCsv.File(cab, dados.Select(l => RelCsv.Join(l)), $"clientes_balancas_{DateTime.Now:yyyyMMdd}.csv");
            }
            return Results.Ok(rows);
        }).RequireAuthorization();

        // Clientes inativos (sem calibração há X meses) — reativação comercial
        app.MapGet("/api/relatorios/clientes-inativos", async (int? meses, string? formato,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var rows = (await conn.QueryAsync(
                "SELECT * FROM rel_clientes_inativos(@meses)", new { meses = meses ?? 6 })).ToList();

            if (formato == "csv" || formato == "pdf")
            {
                var cab = new[] { "Cliente", "CNPJ", "E-mail", "Telefone", "Cidade", "UF",
                    "Balanças", "Última calibração", "Meses sem calibrar" };
                string[] Linha(dynamic c) => new string[] {
                    (string?)c.razao_social ?? "", (string?)c.cnpj ?? "", (string?)c.email ?? "",
                    (string?)c.telefone ?? "", (string?)c.cidade ?? "", (string?)c.uf ?? "",
                    (string?)(c.qtd_balancas?.ToString()) ?? "0", RelCsv.D(c.ultima_calibracao),
                    (string?)(c.meses_desde_ultima?.ToString()) ?? "nunca calibrou" };
                var dados = rows.Select(Linha).ToList();
                var totais = new List<string> { $"Clientes para reativar: {rows.Count}" };
                if (formato == "pdf")
                {
                    var nome = await NomeEmpresa(conn);
                    var pesos = new[] { 2.8f, 1.8f, 2.2f, 1.6f, 1.4f, 0.5f, 0.9f, 1.6f, 1.4f };
                    var cols = cab.Select((t, i) => new RelPdf.Coluna(t, pesos[i])).ToList();
                    var pdf = RelPdf.Gerar(nome, "Clientes sem Calibração",
                        $"Sem calibrar há mais de {meses ?? 6} meses", cols, dados, totais);
                    return Results.File(pdf, "application/pdf", $"clientes_inativos_{DateTime.Now:yyyyMMdd}.pdf");
                }
                return RelCsv.File(cab, dados.Select(l => RelCsv.Join(l)), $"clientes_inativos_{DateTime.Now:yyyyMMdd}.csv");
            }
            return Results.Ok(rows);
        }).RequireAuthorization();

        // Registra o modelo de etiqueta usado (para sugerir na próxima)
        g.MapPut("/etiqueta-modelo", async (EtiquetaModeloRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            await conn.ExecuteAsync("SELECT usuario_etiqueta_usada(@u, @Modelo)",
                new { u = Tenant.UsuarioId(user), req.Modelo });
            return Results.Ok(new { salvo = true });
        });

        // Dados para a etiqueta de calibração (certificado emitido)
        app.MapGet("/api/certificados/{id:guid}/etiqueta", async (Guid id,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            // Sem filtro de status: a etiqueta pode ser gerada e colada na balança
            // já na visita (rascunho). O uuid_validacao existe desde a criação.
            // A página de validação mostra "em processamento" até a aprovação do RT.
            var d = await conn.QuerySingleOrDefaultAsync("""
                SELECT ct.numero, ct.data_calibracao, ct.uuid_validacao, ct.status,
                       COALESCE(NULLIF(e.nome_fantasia,''), e.razao_social) AS empresa,
                       e.num_autorizacao, e.etiqueta_tamanho,
                       b.identificacao AS balanca, b.num_serie, b.periodicidade_meses,
                       -- para os modelos de etiqueta com logo e com técnico
                       u.nome AS tecnico, e.logo_url, e.telefone AS empresa_telefone,
                       b.capacidade, b.unidade,
                       -- último modelo que ESTE usuário imprimiu (atalho do dia a dia)
                       (SELECT eu.etiqueta_ultimo_modelo FROM usuario eu
                         WHERE eu.id = @usr) AS ultimo_modelo
                  FROM certificado ct
                  JOIN empresa e ON e.id = ct.empresa_id
                  JOIN balanca b ON b.id = ct.balanca_id
                  LEFT JOIN usuario u ON u.id = ct.tecnico_id
                 WHERE ct.id = @id
                """, new { id, usr = Tenant.UsuarioId(user) });
            return d is null ? Results.NotFound() : Results.Ok(d);
        }).RequireAuthorization();

        // Pesos padrão usados num certificado (para o gestor baixar os
        // certificados de rastreabilidade e enviar ao cliente)
        app.MapGet("/api/certificados/{id:guid}/pesos", async (Guid id,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var rows = await conn.QueryAsync("""
                SELECT pp.id, pp.identificacao, pp.valor_nominal, pp.classe,
                       (pp.certificado_pdf_url IS NOT NULL) AS tem_pdf
                  FROM certificado_peso cp
                  JOIN peso_padrao pp ON pp.id = cp.peso_padrao_id
                 WHERE cp.certificado_id = @id
                 ORDER BY pp.identificacao
                """, new { id });
            return Results.Ok(rows);
        }).RequireAuthorization();

        // Dados para a etiqueta de calibração — fim

        // ── Estatísticas do painel (só admin/responsável) ───────
        // ?dias=N filtra o período (0 = tudo)
        app.MapGet("/api/certificados/estatisticas", async (int? dias,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            var papel = Tenant.Papel(user);
            if (papel is not ("admin" or "responsavel_tecnico"))
                return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var d = Math.Max(0, dias ?? 30);

            var porStatus = await conn.QueryAsync("""
                SELECT ct.status, count(*)::int AS total
                  FROM certificado ct
                 WHERE (@d = 0 OR ct.criado_em >= now() - make_interval(days => @d))
                 GROUP BY ct.status
                """, new { d });

            var porTecnico = await conn.QueryAsync("""
                SELECT u.nome AS tecnico, count(*)::int AS total
                  FROM certificado ct JOIN usuario u ON u.id = ct.tecnico_id
                 WHERE ct.status IN ('emitido','substituido')
                   AND (@d = 0 OR ct.data_emissao >= now() - make_interval(days => @d))
                 GROUP BY u.nome ORDER BY total DESC LIMIT 10
                """, new { d });

            var porCliente = await conn.QueryAsync("""
                SELECT c.razao_social AS cliente, count(*)::int AS total
                  FROM certificado ct JOIN cliente c ON c.id = ct.cliente_id
                 WHERE ct.status IN ('emitido','substituido')
                   AND (@d = 0 OR ct.data_emissao >= now() - make_interval(days => @d))
                 GROUP BY c.razao_social ORDER BY total DESC LIMIT 10
                """, new { d });

            var porMes = await conn.QueryAsync("""
                SELECT to_char(date_trunc('month', ct.data_emissao), 'MM/YYYY') AS mes,
                       count(*)::int AS total
                  FROM certificado ct
                 WHERE ct.data_emissao IS NOT NULL
                   AND ct.data_emissao >= now() - interval '12 months'
                 GROUP BY date_trunc('month', ct.data_emissao)
                 ORDER BY date_trunc('month', ct.data_emissao)
                """);

            return Results.Ok(new { porStatus, porTecnico, porCliente, porMes });
        }).RequireAuthorization();

        // ── Calibrações vencendo (só admin/responsável) ─────────
        // Última calibração emitida de cada balança cujo vencimento
        // (data + periodicidade da balança) está a até 60 dias ou já passou.
        app.MapGet("/api/certificados/vencimentos", async (
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var rows = await conn.QueryAsync("""
                SELECT * FROM (
                    SELECT DISTINCT ON (ct.balanca_id)
                           ct.id, ct.numero, ct.data_calibracao,
                           b.identificacao AS balanca, b.periodicidade_meses,
                           c.razao_social AS cliente, c.telefone, c.email,
                           c.id AS cliente_id, c.cidade, c.uf,
                           (ct.data_calibracao
                              + make_interval(months => b.periodicidade_meses))::date AS vence_em
                      FROM certificado ct
                      JOIN balanca b ON b.id = ct.balanca_id
                      JOIN cliente c ON c.id = ct.cliente_id
                     WHERE ct.status = 'emitido' AND ct.data_calibracao IS NOT NULL
                       AND b.periodicidade_meses > 0 AND b.ativa AND c.ativo
                     ORDER BY ct.balanca_id, ct.data_calibracao DESC
                ) t
                 WHERE t.vence_em <= current_date + 60
                 ORDER BY t.vence_em
                """);
            return Results.Ok(rows);
        }).RequireAuthorization();

        // ── Busca global de certificados por equipamento ────────
        app.MapGet("/api/certificados/buscar", async (string? q,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (string.IsNullOrWhiteSpace(q) || q.Trim().Length < 2)
                return Results.Ok(Array.Empty<object>());
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var papel = Tenant.Papel(user);
            var soMeus = papel is not ("admin" or "responsavel_tecnico") && !Tenant.EstaVisualizando(user);
            var termo = "%" + q.Trim() + "%";
            var rows = await conn.QueryAsync("""
                SELECT ct.id, ct.status, ct.numero, ct.emitir_rbc, ct.data_calibracao,
                       ct.data_emissao, b.identificacao AS balanca, b.num_serie,
                       c.razao_social AS cliente, u.nome AS tecnico
                  FROM certificado ct
                  JOIN balanca b ON b.id = ct.balanca_id
                  JOIN cliente c ON c.id = ct.cliente_id
                  JOIN usuario u ON u.id = ct.tecnico_id
                 WHERE (b.identificacao ILIKE @termo OR b.num_serie ILIKE @termo
                        OR b.num_serie_indicador ILIKE @termo
                        OR ct.numero ILIKE @termo OR c.razao_social ILIKE @termo
                        OR b.marca ILIKE @termo OR b.modelo ILIKE @termo
                        OR b.numero_inmetro ILIKE @termo OR c.cnpj ILIKE @termo)
                   AND (NOT @soMeus OR ct.tecnico_id = @meuId)
                 ORDER BY ct.criado_em DESC LIMIT 50
                """, new { termo, soMeus, meuId = Tenant.UsuarioId(user) });
            return Results.Ok(rows);
        }).RequireAuthorization();

        // ── Criar rascunho (id vem do cliente: sync idempotente) ─
        g.MapPost("/", async (NovoCertificadoRequest req, ClaimsPrincipal user,
            NpgsqlDataSource ds, HttpContext ctx) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var empresaId = Tenant.EmpresaId(user);

            var ok = await conn.ExecuteScalarAsync<bool>("""
                SELECT EXISTS(SELECT 1 FROM balanca
                               WHERE id = @BalancaId AND cliente_id = @ClienteId)
                """, new { req.BalancaId, req.ClienteId });
            if (!ok) return Results.BadRequest(new { erro = "Balança não pertence a esse cliente." });

            // Trava: uma calibração em andamento por balança (na empresa toda).
            // "Em andamento" = rascunho ou aguardando aprovação. Emitido ou
            // cancelado libera a balança. Ignora o próprio id (sync idempotente).
            var pendente = await conn.QuerySingleOrDefaultAsync("""
                SELECT u.nome AS tecnico, ct.status
                  FROM certificado ct JOIN usuario u ON u.id = ct.tecnico_id
                 WHERE ct.balanca_id = @BalancaId
                   AND ct.id <> @Id
                   AND ct.status IN ('rascunho','aguardando_aprovacao')
                 ORDER BY ct.criado_em DESC LIMIT 1
                """, new { req.BalancaId, req.Id });
            if (pendente is not null)
            {
                var situacao = (string)pendente.status == "rascunho"
                    ? "em rascunho" : "aguardando aprovação";
                return Results.Conflict(new { erro =
                    $"Já existe uma calibração {situacao} para esta balança, " +
                    $"com o técnico {(string)pendente.tecnico}. " +
                    "Finalize ou cancele essa calibração antes de iniciar outra." });
            }

            // RBC só é aceito se a empresa for acreditada
            var acreditada = await conn.ExecuteScalarAsync<bool>(
                "SELECT COALESCE(acreditada,false) FROM empresa WHERE id = @empresaId",
                new { empresaId });
            var emitirRbc = req.EmitirRbc && acreditada;

            // "Ensaio executado por": o gestor pode registrar um ensaio feito em
            // campo por outro tecnico (sem internet no local). Ambos ficam no
            // registro: o executor no certificado, e quem lancou na auditoria.
            var meuId = Tenant.UsuarioId(user);
            var tecnicoId = meuId;
            Guid? lancadoPor = null;
            if (req.TecnicoExecutorId is { } execId && execId != meuId)
            {
                if (!Tenant.EhGestor(user))
                    return Results.Forbid();
                var valido = await conn.ExecuteScalarAsync<bool>(
                    "SELECT EXISTS(SELECT 1 FROM usuario WHERE id = @execId AND ativo)",
                    new { execId });
                if (!valido)
                    return Results.BadRequest(new { erro = "Tecnico executor invalido ou inativo." });
                tecnicoId = execId;
                lancadoPor = meuId;
            }
            var n = await conn.ExecuteAsync("""
                INSERT INTO certificado (id, empresa_id, cliente_id, balanca_id, tecnico_id, emitir_rbc, lancado_por)
                VALUES (@Id, @empresaId, @ClienteId, @BalancaId, @tecnicoId, @emitirRbc, @lancadoPor)
                ON CONFLICT (id) DO NOTHING
                """, new { req.Id, empresaId, req.ClienteId, req.BalancaId,
                           tecnicoId, emitirRbc, lancadoPor });

            if (n > 0)
                await Auditoria.Registrar(conn, empresaId, Tenant.UsuarioId(user),
                    "certificado", req.Id, "insert", null, Auditoria.Ip(ctx));
            return Results.Ok(new { id = req.Id, criado = n > 0 });
        });

        // ── Listar (painel do técnico) ──────────────────────────
        g.MapGet("/", async (ClaimsPrincipal user, NpgsqlDataSource ds, string? status,
            string? os) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            // Técnico vê APENAS os certificados dele (inclusive rascunhos:
            // rascunho de outro técnico não aparece no painel — a continuidade
            // acontece pela Nova calibração, que detecta o rascunho aberto da
            // balança e pergunta se deseja continuar).
            // Admin e responsável técnico veem todos (precisam para aprovar).
            var papel = Tenant.Papel(user);
            var soMeus = papel is not ("admin" or "responsavel_tecnico") && !Tenant.EstaVisualizando(user);
            var meuId = Tenant.UsuarioId(user);
            var rows = await conn.QueryAsync("""
                SELECT ct.id, ct.status, ct.numero, ct.emitir_rbc, ct.data_emissao, ct.data_calibracao, ct.criado_em,
                       ct.ordem_servico, ct.endereco_calibracao,
                       c.razao_social AS cliente, b.identificacao AS balanca,
                       b.marca, b.modelo, b.capacidade, b.unidade, b.divisao_e,
                       b.num_serie, b.numero_inmetro,
                       u.nome AS tecnico
                  FROM certificado ct
                  JOIN cliente c ON c.id = ct.cliente_id
                  JOIN balanca b ON b.id = ct.balanca_id
                  JOIN usuario u ON u.id = ct.tecnico_id
                 WHERE (@status IS NULL OR ct.status = @status)
                   AND (NOT @soMeus OR ct.tecnico_id = @meuId)
                   AND (@os IS NULL OR ct.ordem_servico ILIKE '%' || @os || '%')
                 ORDER BY ct.criado_em DESC LIMIT 100
                """, new { status, soMeus, meuId, os });
            return Results.Ok(rows);
        });

        // Última ordem de serviço usada pelo técnico — o mesmo atendimento
        // costuma cobrir várias balanças, então sugerimos em vez de redigitar.
        g.MapGet("/ultima-os", async (ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var os = await conn.ExecuteScalarAsync<string?>("""
                SELECT ordem_servico FROM certificado
                 WHERE tecnico_id = @id AND ordem_servico IS NOT NULL
                   AND criado_em >= now() - interval '3 days'
                 ORDER BY criado_em DESC LIMIT 1
                """, new { id = Tenant.UsuarioId(user) });
            return Results.Ok(new { ordem_servico = os });
        });

        // ── Detalhe (inclui o rascunho salvo) ───────────────────

        // ── Excluir certificado em RASCUNHO (nunca emitidos) ──────
        g.MapDelete("/{id:guid}", async (Guid id, ClaimsPrincipal user,
            NpgsqlDataSource ds, HttpContext ctx) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var ct = await conn.QuerySingleOrDefaultAsync(
                "SELECT status, tecnico_id FROM certificado WHERE id = @id", new { id });
            if (ct is null) return Results.NotFound();
            if ((string)ct.status != "rascunho")
                return Results.BadRequest(new { erro = "Só rascunhos podem ser excluídos. Certificados emitidos são imutáveis." });
            // técnico comum só exclui o próprio rascunho; gestor exclui qualquer
            var papel = Tenant.Papel(user);
            if (papel is not ("admin" or "responsavel_tecnico")
                && (Guid)ct.tecnico_id != Tenant.UsuarioId(user))
                return Results.Forbid();
            // apaga leituras RBC eventualmente salvas + o certificado
            await conn.ExecuteAsync("DELETE FROM leitura_rbc WHERE certificado_id = @id", new { id });
            await conn.ExecuteAsync("DELETE FROM incerteza_ponto_rbc WHERE certificado_id = @id", new { id });
            await conn.ExecuteAsync("DELETE FROM excentricidade_rbc WHERE certificado_id = @id", new { id });
            await conn.ExecuteAsync("DELETE FROM mobilidade_rbc WHERE certificado_id = @id", new { id });
            await conn.ExecuteAsync("DELETE FROM carga_peso_rbc WHERE certificado_id = @id", new { id });
            await conn.ExecuteAsync("DELETE FROM certificado WHERE id = @id AND status = 'rascunho'", new { id });
            await Auditoria.Registrar(conn, Tenant.EmpresaId(user), Tenant.UsuarioId(user),
                "certificado", id, "excluir_rascunho", null, Auditoria.Ip(ctx));
            return Results.Ok(new { excluido = true });
        });

        // ── Solicitações de calibração vindas do portal do cliente ──
        g.MapGet("/solicitacoes", async (ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Ok(Array.Empty<object>());
            await using var conn = await Tenant.AbrirConexao(ds, user);
            return Results.Ok(await conn.QueryAsync("SELECT * FROM solicitacoes_abertas()"));
        });

        g.MapPut("/solicitacoes/{id:guid}", async (Guid id, AtenderSolicitacaoRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds, HttpContext ctx) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            await conn.ExecuteAsync(
                "SELECT solicitacao_atender(@id, @usr, @Situacao, @Observacao)",
                new { id, usr = Tenant.UsuarioId(user), req.Situacao, req.Observacao });
            await Auditoria.Registrar(conn, Tenant.EmpresaId(user), Tenant.UsuarioId(user),
                "solicitacao", id, "atender_solicitacao",
                new { req.Situacao, req.Observacao }, Auditoria.Ip(ctx));
            return Results.Ok(new { atualizado = true });
        });

        // ── Definir/corrigir TÉCNICO e RESPONSÁVEL TÉCNICO ────────
        // Rascunho e aguardando aprovação: admin/RT trocam livremente
        // (é assim que se direciona um ensaio a um técnico).
        // Emitido: só admin, com justificativa obrigatória, e tudo fica
        // registrado na auditoria — é correção de registro, não edição
        // de medição (para erro de medição, o caminho é a REVISÃO).
        g.MapPut("/{id:guid}/responsaveis", async (Guid id, ResponsaveisRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds, HttpContext ctx) =>
        {
            var papel = Tenant.Papel(user);
            if (papel is not ("admin" or "responsavel_tecnico"))
                return Results.Forbid();
            if (req.TecnicoId is null && req.AprovadorId is null)
                return Results.BadRequest(new { erro = "Informe o técnico e/ou o responsável técnico." });

            await using var conn = await Tenant.AbrirConexao(ds, user);
            var ct = await conn.QuerySingleOrDefaultAsync("""
                SELECT ct.status, ct.numero, ct.tecnico_id, ct.aprovador_id,
                       ut.nome AS tecnico_antes, ua.nome AS aprovador_antes
                  FROM certificado ct
                  LEFT JOIN usuario ut ON ut.id = ct.tecnico_id
                  LEFT JOIN usuario ua ON ua.id = ct.aprovador_id
                 WHERE ct.id = @id
                """, new { id });
            if (ct is null) return Results.NotFound();
            var status = (string)ct.status;
            if (status is "cancelado")
                return Results.Conflict(new { erro = "Certificado cancelado não pode ser alterado." });
            // Emitido: admin E responsável técnico podem corrigir o registro
            // de quem executou/aprovou — o RT é a autoridade técnica que
            // assina o documento. A justificativa continua obrigatória e
            // tudo vai para a auditoria.
            if (status is "emitido" && string.IsNullOrWhiteSpace(req.Justificativa))
                return Results.BadRequest(new { erro = "Informe a justificativa da correção (fica registrada na auditoria)." });

            // Validação dos escolhidos (mesma empresa via RLS)
            if (req.TecnicoId is { } tid)
            {
                var okTec = await conn.ExecuteScalarAsync<bool>(
                    "SELECT EXISTS(SELECT 1 FROM usuario WHERE id=@tid AND ativo)", new { tid });
                if (!okTec) return Results.BadRequest(new { erro = "Técnico inválido ou inativo." });
            }
            if (req.AprovadorId is { } aid)
            {
                var okApr = await conn.ExecuteScalarAsync<bool>("""
                    SELECT EXISTS(SELECT 1 FROM usuario WHERE id=@aid AND ativo
                                   AND papel IN ('admin','responsavel_tecnico'))
                    """, new { aid });
                if (!okApr) return Results.BadRequest(new
                    { erro = "O responsável técnico deve ser um usuário com papel admin ou responsável técnico." });
            }

            if (status == "emitido")
            {
                // Certificado emitido é imutável (gatilho trg_cert_imutavel).
                // Exceção estreita e auditada: só tecnico_id/aprovador_id,
                // via função SECURITY DEFINER dedicada.
                try
                {
                    await conn.ExecuteAsync(
                        "SELECT corrigir_responsaveis_certificado(@id, @TecnicoId, @AprovadorId)",
                        new { id, req.TecnicoId, req.AprovadorId });
                }
                catch (PostgresException pe)
                {
                    return Results.BadRequest(new { erro = pe.MessageText });
                }
            }
            else
            {
                await conn.ExecuteAsync("""
                    UPDATE certificado
                       SET tecnico_id   = COALESCE(@TecnicoId, tecnico_id),
                           aprovador_id = COALESCE(@AprovadorId, aprovador_id)
                     WHERE id = @id
                    """, new { id, req.TecnicoId, req.AprovadorId });
            }

            await Auditoria.Registrar(conn, Tenant.EmpresaId(user), Tenant.UsuarioId(user),
                "certificado", id, "editar_responsaveis",
                new { status, numero = (string?)ct.numero,
                      tecnico_antes = (string?)ct.tecnico_antes,
                      aprovador_antes = (string?)ct.aprovador_antes,
                      req.TecnicoId, req.AprovadorId, req.Justificativa },
                Auditoria.Ip(ctx));

            return Results.Ok(new { atualizado = true, status,
                regerarPdf = status == "emitido" });
        });

        // ── Assumir um rascunho de outro técnico (continuidade) ───
        g.MapPost("/{id:guid}/assumir", async (Guid id, ClaimsPrincipal user,
            NpgsqlDataSource ds, HttpContext ctx) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var ct = await conn.QuerySingleOrDefaultAsync(
                "SELECT status FROM certificado WHERE id = @id", new { id });
            if (ct is null) return Results.NotFound();
            if ((string)ct.status != "rascunho")
                return Results.BadRequest(new { erro = "Só rascunhos podem ser assumidos." });
            await conn.ExecuteAsync(
                "UPDATE certificado SET tecnico_id = @uid WHERE id = @id AND status = 'rascunho'",
                new { id, uid = Tenant.UsuarioId(user) });
            await Auditoria.Registrar(conn, Tenant.EmpresaId(user), Tenant.UsuarioId(user),
                "certificado", id, "assumir_rascunho", null, Auditoria.Ip(ctx));
            return Results.Ok(new { assumido = true });
        });


        // ── Cancelar certificado (emitido ou aguardando) ──────────
        // O registro PERMANECE; a validação pública passa a informar
        // que foi cancelado (protege quem recebeu o documento).
        g.MapPost("/{id:guid}/cancelar", async (Guid id, CancelarCertRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds, HttpContext ctx) =>
        {
            var papel = Tenant.Papel(user);
            if (papel is not ("admin" or "responsavel_tecnico"))
                return Results.Forbid();
            if (string.IsNullOrWhiteSpace(req.Motivo) || req.Motivo.Trim().Length < 10)
                return Results.BadRequest(new { erro =
                    "Descreva o motivo do cancelamento (mínimo 10 caracteres) — ele fica registrado e é exibido na validação pública." });
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var r = await conn.ExecuteScalarAsync<string>(
                "SELECT cancelar_certificado(@id, @uid, @motivo)",
                new { id, uid = Tenant.UsuarioId(user), motivo = req.Motivo });
            if (r != "ok")
                return Results.BadRequest(new { erro = r switch {
                    "nao_encontrado" => "Certificado não encontrado.",
                    "ja_cancelado" => "Este certificado já está cancelado.",
                    "status_invalido" => "Só certificados emitidos ou aguardando aprovação podem ser cancelados.",
                    "motivo_obrigatorio" => "Informe o motivo do cancelamento.",
                    _ => "Não foi possível cancelar." } });
            await Auditoria.Registrar(conn, Tenant.EmpresaId(user), Tenant.UsuarioId(user),
                "certificado", id, "cancelar", new { req.Motivo }, Auditoria.Ip(ctx));
            return Results.Ok(new { cancelado = true });
        });

        g.MapGet("/{id:guid}", async (Guid id, ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var ct = await conn.QuerySingleOrDefaultAsync("""
                SELECT ct.id, ct.status, ct.numero, ct.emitir_rbc, ct.cliente_id, ct.balanca_id,
                       ct.data_calibracao, ct.temperatura, ct.umidade, ct.contexto_ema,
                       ct.dados_rascunho, ct.tecnico_id, c.razao_social AS cliente,
                       b.identificacao AS balanca, u.nome AS tecnico_nome
                  FROM certificado ct
                  JOIN cliente c ON c.id = ct.cliente_id
                  JOIN balanca b ON b.id = ct.balanca_id
                  JOIN usuario u ON u.id = ct.tecnico_id
                 WHERE ct.id = @id
                """, new { id });
            if (ct is null) return Results.NotFound();
            // Técnico só acessa o que é dele
            var papel = Tenant.Papel(user);
            if (papel is not ("admin" or "responsavel_tecnico")
                && (Guid)ct.tecnico_id != Tenant.UsuarioId(user)
                && (string)ct.status != "rascunho")
                return Results.Forbid();
            return Results.Ok(ct);
        });

        // ── Autosave do rascunho ────────────────────────────────
        g.MapPut("/{id:guid}/rascunho", async (Guid id, RascunhoRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var papel = Tenant.Papel(user);
            var soMeus = papel is not ("admin" or "responsavel_tecnico") && !Tenant.EstaVisualizando(user);
            // A ordem de serviço e o endereço da calibração vêm no JSON do
            // rascunho, mas ficam TAMBÉM em colunas próprias: assim dá para
            // filtrar e indexar sem vasculhar jsonb a cada busca.
            string? os = req.Dados.TryGetProperty("ordemServico", out var osv)
                && osv.ValueKind == JsonValueKind.String
                ? osv.GetString()?.Trim() : null;
            Guid? endId = req.Dados.TryGetProperty("enderecoId", out var eidv)
                && eidv.ValueKind == JsonValueKind.String
                && Guid.TryParse(eidv.GetString(), out var g1) ? g1 : null;
            string? endTxt = req.Dados.TryGetProperty("enderecoTexto", out var etv)
                && etv.ValueKind == JsonValueKind.String
                ? etv.GetString()?.Trim() : null;

            var n = await conn.ExecuteAsync("""
                UPDATE certificado
                   SET dados_rascunho = @dados::jsonb,
                       ordem_servico = NULLIF(@os, ''),
                       cliente_endereco_id = @endId,
                       endereco_calibracao = NULLIF(@endTxt, '')
                 WHERE id = @id
                   AND (status = 'rascunho'
                        OR (status = 'aguardando_aprovacao' AND NOT @soMeus))
                   AND (NOT @soMeus OR tecnico_id = @meuId)
                """, new { id, dados = req.Dados.GetRawText(), os, endId, endTxt,
                           soMeus, meuId = Tenant.UsuarioId(user) });
            return n == 0
                ? Results.Conflict(new { erro = "Certificado não está em rascunho ou não é seu." })
                : Results.Ok(new { salvoEm = DateTime.UtcNow });
        });

        // ── Enviar pra aprovação: valida, calcula e normaliza ───
        g.MapPost("/{id:guid}/enviar", async (Guid id, ClaimsPrincipal user,
            NpgsqlDataSource ds, HttpContext ctx) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            await using var tx = await conn.BeginTransactionAsync();

            var ct = await conn.QuerySingleOrDefaultAsync("""
                SELECT ct.id, ct.status, ct.dados_rascunho, ct.tecnico_id, ct.balanca_id,
                       b.divisao_e, b.divisao_d, b.classe_exatidao, b.capacidade
                  FROM certificado ct JOIN balanca b ON b.id = ct.balanca_id
                 WHERE ct.id = @id FOR UPDATE OF ct
                """, new { id });
            if (ct is null) return Results.NotFound();
            var papelEnv = Tenant.Papel(user);
            if (papelEnv is not ("admin" or "responsavel_tecnico")
                && (Guid)ct.tecnico_id != Tenant.UsuarioId(user))
                return Results.Forbid();
            var ehGestorEnv = papelEnv is "admin" or "responsavel_tecnico";
            if ((string)ct.status != "rascunho"
                && !((string)ct.status == "aguardando_aprovacao" && ehGestorEnv))
                return Results.Conflict(new { erro = "Só rascunhos podem ser enviados." });
            if (ct.dados_rascunho is null)
                return Results.BadRequest(new { erro = "Rascunho vazio." });

            // ── Limite mensal de certificados do plano contratado ──
            // Conta os PRIMEIROS envios do mês (reenvio de devolvido não conta de novo)
            var maxCerts = await conn.ExecuteScalarAsync<int?>("""
                SELECT max_certs_mes FROM contrato
                 WHERE empresa_id = (SELECT empresa_id FROM certificado WHERE id = @id)
                   AND ativo ORDER BY criado_em DESC LIMIT 1
                """, new { id });
            if (maxCerts is int limiteMes && (string)ct.status == "rascunho")
            {
                var jaEnviado = await conn.ExecuteScalarAsync<bool>(
                    "SELECT enviado_em IS NOT NULL FROM certificado WHERE id = @id", new { id });
                if (!jaEnviado)
                {
                    var usados = await conn.ExecuteScalarAsync<int>("""
                        SELECT COUNT(*) FROM certificado
                         WHERE enviado_em >= date_trunc('month', now())
                           AND status <> 'cancelado'
                        """);
                    if (usados >= limiteMes)
                        return Results.BadRequest(new { erro =
                            $"Seu plano permite {limiteMes} certificados por mês e o limite foi atingido " +
                            $"({usados}/{limiteMes}). O rascunho fica salvo — fale com a Total Scale " +
                            "para ampliar o plano ou envie no próximo mês." });
                }
            }

            var d = JsonDocument.Parse((string)ct.dados_rascunho).RootElement;
            decimal e = ct.divisao_e;
            decimal dRes = ct.divisao_d ?? ct.divisao_e;   // resolução real
            string classe = ct.classe_exatidao;

            // Campos gerais
            var contexto = d.TryGetProperty("contextoEma", out var cx)
                ? cx.GetString() ?? "subsequente" : "subsequente";
            if (contexto is not ("subsequente" or "em_uso"))
                return Results.BadRequest(new { erro = "Contexto EMA inválido." });
            if (!d.TryGetProperty("dataCalibracao", out var dc) ||
                !DateOnly.TryParse(dc.GetString(), out var dataCal))
                return Results.BadRequest(new { erro = "Data da calibração é obrigatória." });

            // O local da calibração deve ser escolhido conscientemente pelo técnico
            var localEnviado = d.TryGetProperty("localTipo", out var ltv) ? ltv.GetString() : null;
            if (string.IsNullOrWhiteSpace(localEnviado))
                return Results.BadRequest(new { erro = "Informe o local da calibração (in loco ou laboratório)." });

            // Pesos padrão usados (mínimo 1, nenhum vencido)
            var pesosIds = d.TryGetProperty("pesos", out var pj)
                ? pj.EnumerateArray().Select(x => Guid.Parse(x.GetString()!)).ToList()
                : new List<Guid>();
            if (pesosIds.Count == 0)
                return Results.BadRequest(new { erro = "Selecione ao menos um peso padrão." });
            var vencidos = await conn.ExecuteScalarAsync<int>("""
                SELECT count(*) FROM peso_padrao
                 WHERE id = ANY(@pesosIds) AND validade < CURRENT_DATE
                """, new { pesosIds });
            if (vencidos > 0)
                return Results.BadRequest(new { erro = "Há peso padrão com calibração vencida." });
            var classePesos = await conn.ExecuteScalarAsync<string>("""
                SELECT classe FROM peso_padrao WHERE id = ANY(@pesosIds)
                 ORDER BY classe DESC LIMIT 1
                """, new { pesosIds }) ?? "M1";

            // Repetibilidade (precisa vir antes: alimenta a incerteza)
            var repet = new List<(decimal carga, decimal ind)>();
            if (d.TryGetProperty("repetibilidade", out var rj))
                foreach (var r in rj.EnumerateArray())
                    if (r.TryGetProperty("indicacao", out var ri) && ri.ValueKind == JsonValueKind.Number)
                    {
                        if (!r.TryGetProperty("carga", out var rcg) || rcg.ValueKind != JsonValueKind.Number)
                            return Results.BadRequest(new { erro =
                                "Há medição de repetibilidade com indicação mas sem carga. Preencha a carga ou limpe a linha." });
                        repet.Add((rcg.GetDecimal(), ri.GetDecimal()));
                    }
            var desvio = Metrologia.DesvioPadrao(repet.Select(r => r.ind).ToList());

            // Indicação (mínimo 3 pontos preenchidos, sem linha pela metade)
            var pontos = new List<(decimal carga, decimal? ind, decimal? antes, bool semLeitura, bool semLeituraAntes)>();
            if (d.TryGetProperty("indicacao", out var ij))
                foreach (var p in ij.EnumerateArray())
                {
                    bool temCarga = p.TryGetProperty("carga", out var pc) && pc.ValueKind == JsonValueKind.Number;
                    bool temInd = p.TryGetProperty("indicacao", out var pi) && pi.ValueKind == JsonValueKind.Number;
                    bool semLeitura = p.TryGetProperty("semLeitura", out var psl) &&
                                      psl.ValueKind == JsonValueKind.True;
                    bool semLeituraAntes = p.TryGetProperty("semLeituraAntes", out var psla) &&
                                           psla.ValueKind == JsonValueKind.True;
                    // Ponto SEM LEITURA: o visor não indicou — só a carga é exigida;
                    // o ponto entra reprovado e conta no mínimo de 3 (João, 22/08/2026)
                    if (semLeitura)
                    {
                        if (!temCarga)
                            return Results.BadRequest(new { erro =
                                "Há ponto marcado como sem leitura sem a carga aplicada. Informe a carga." });
                        pontos.Add((pc.GetDecimal(), null, null, true, semLeituraAntes));
                        continue;
                    }
                    // Linha pela metade (só carga OU só indicação) é erro
                    if (temCarga != temInd)
                        return Results.BadRequest(new { erro =
                            "Há ponto de indicação incompleto: preencha carga e indicação, ou deixe a linha totalmente vazia." });
                    if (temCarga && temInd)
                    {
                        decimal? antes = p.TryGetProperty("indicacaoAntes", out var pa) &&
                                         pa.ValueKind == JsonValueKind.Number ? pa.GetDecimal() : (decimal?)null;
                        // Sem leitura ANTES nao reprova: a leitura final decide
                        pontos.Add((pc.GetDecimal(), pi.GetDecimal(),
                                    semLeituraAntes ? null : antes, false, semLeituraAntes));
                    }
                }
            if (pontos.Count < 3)
                return Results.BadRequest(new { erro = "Preencha ao menos 3 pontos de indicação (carga e indicação)." });

            // Recalcula TUDO no servidor (nunca confiar no navegador)
            await conn.ExecuteAsync(
                "DELETE FROM ensaio_indicacao WHERE certificado_id = @id;" +
                "DELETE FROM ensaio_excentricidade WHERE certificado_id = @id;" +
                "DELETE FROM ensaio_repetibilidade WHERE certificado_id = @id;" +
                "DELETE FROM ensaio_sensibilidade WHERE certificado_id = @id;" +
                "DELETE FROM certificado_peso WHERE certificado_id = @id;",
                new { id });

            var empresaId = Tenant.EmpresaId(user);
            var balancaId = (Guid)ct.balanca_id;
            // A balança é multi-intervalo se tiver faixas cadastradas
            var temFaixas = await conn.ExecuteScalarAsync<bool>(
                "SELECT EXISTS(SELECT 1 FROM balanca_faixa WHERE balanca_id = @balancaId)",
                new { balancaId });
            var ordem = 0;
            foreach (var (carga, ind, antes, semLeitura, semLeituraAntes) in pontos.OrderBy(p => p.carga))
            {
                var (ema, eUsado) = await Metrologia.ObterEmaKgMulti(conn, classe, contexto, carga, e, balancaId);
                // Resolução para a incerteza: em multi-intervalo, usa o "e" da faixa
                // (a divisão muda por faixa); em faixa única, usa o d/e global.
                var resParaIncerteza = temFaixas ? eUsado : dRes;
                // SEM LEITURA: não há indicação — erro e incerteza não existem;
                // o ponto é reprovado e reprova o certificado (João, 22/08/2026).
                decimal? inc = semLeitura ? null
                    : Metrologia.IncertezaExpandida(carga, resParaIncerteza, desvio, classePesos);
                decimal? erro = semLeitura ? null : ind!.Value - carga;
                bool? aprovado = semLeitura ? false
                    : (ema is null ? (bool?)null : Math.Abs(erro!.Value) <= ema.Value);
                await conn.ExecuteAsync("""
                    INSERT INTO ensaio_indicacao (empresa_id, certificado_id, ordem,
                        carga_aplicada, indicacao, erro, incerteza, ema, aprovado, indicacao_antes,
                        divisao_e_ponto, sem_leitura, sem_leitura_antes)
                    VALUES (@empresaId, @id, @ordem, @carga, @ind, @erro, @inc, @ema,
                            @aprovado, @antes, @eUsado, @semLeitura, @semLeituraAntes)
                    """, new { empresaId, id, ordem = ++ordem, carga, ind, erro, inc, ema,
                               aprovado, antes, eUsado, semLeitura, semLeituraAntes });
            }

            if (d.TryGetProperty("excentricidade", out var ej))
            {
                // Referência: a leitura do CENTRO (o erro é a variação entre
                // posições, não a diferença para a carga nominal)
                decimal? indCentro = null;
                foreach (var x in ej.EnumerateArray())
                    if (x.TryGetProperty("indicacao", out var xc) && xc.ValueKind == JsonValueKind.Number
                        && x.GetProperty("posicao").GetString() == "centro")
                        indCentro = xc.GetDecimal();
                // Fallback: primeira posição preenchida
                if (indCentro is null)
                    foreach (var x in ej.EnumerateArray())
                        if (x.TryGetProperty("indicacao", out var xf) && xf.ValueKind == JsonValueKind.Number)
                        { indCentro = xf.GetDecimal(); break; }

                foreach (var x in ej.EnumerateArray())
                    if (x.TryGetProperty("indicacao", out var xi) && xi.ValueKind == JsonValueKind.Number)
                    {
                        if (!x.TryGetProperty("carga", out var xcg) || xcg.ValueKind != JsonValueKind.Number)
                            return Results.BadRequest(new { erro =
                                "Há ponto de excentricidade com indicação mas sem carga. Preencha a carga ou limpe a linha." });
                        decimal carga = xcg.GetDecimal(),
                                ind = xi.GetDecimal();
                        // Leitura "antes do ajuste" (opcional; só quando houve ajuste)
                        decimal? antesX = x.TryGetProperty("indicacaoAntes", out var xan)
                            && xan.ValueKind == JsonValueKind.Number ? xan.GetDecimal() : (decimal?)null;
                        var posX = x.GetProperty("posicao").GetString();
                        var erroX = ind - (indCentro ?? ind);
                        // EMA para a carga do ensaio (mesma tabela da indicação);
                        // o centro é a referência e não recebe avaliação
                        var (emaX, _) = await Metrologia.ObterEmaKgMulti(conn, classe, contexto, carga, e, balancaId);
                        bool? aprovadoX = posX == "centro" || emaX is null
                            ? null : Math.Abs(erroX) <= emaX;
                        await conn.ExecuteAsync("""
                            INSERT INTO ensaio_excentricidade (empresa_id, certificado_id,
                                posicao, carga, indicacao, erro, ema, aprovado, indicacao_antes)
                            VALUES (@empresaId, @id, @pos, @carga, @ind, @erro, @ema, @aprovado, @antes)
                            """, new { empresaId, id, pos = posX,
                                carga, ind, erro = erroX, ema = emaX, aprovado = aprovadoX, antes = antesX });
                    }
            }

            var med = 0;
            foreach (var (carga, ind) in repet)
                await conn.ExecuteAsync("""
                    INSERT INTO ensaio_repetibilidade (empresa_id, certificado_id,
                        medicao_num, carga, indicacao)
                    VALUES (@empresaId, @id, @med, @carga, @ind)
                    """, new { empresaId, id, med = ++med, carga, ind });

            await conn.ExecuteAsync("""
                INSERT INTO certificado_peso (certificado_id, peso_padrao_id, empresa_id)
                SELECT @id, unnest(@pesosIds), @empresaId
                """, new { id, pesosIds, empresaId });

            // Sensibilidade (opcional)
            if (d.TryGetProperty("sensibilidade", out var sj) && sj.ValueKind == JsonValueKind.Object
                && sj.TryGetProperty("cargaReferencia", out var scr) && scr.ValueKind == JsonValueKind.Number
                && sj.TryGetProperty("resultadoDisplay", out var srd) && srd.ValueKind == JsonValueKind.Number)
            {
                decimal adic = sj.TryGetProperty("adicao", out var sa) && sa.ValueKind == JsonValueKind.Number
                    ? sa.GetDecimal() : 0m;

                // Defesa dupla: a carga de referência da sensibilidade não pode
                // ultrapassar a capacidade máxima da balança (não faz sentido
                // testar sensibilidade acima do Max).
                var capacidade = (decimal)ct.capacidade;
                if (scr.GetDecimal() > capacidade)
                    return Results.BadRequest(new { erro =
                        $"A carga de referência da sensibilidade ({scr.GetDecimal()}) ultrapassa " +
                        $"a capacidade máxima da balança ({capacidade}). Corrija antes de enviar." });

                await conn.ExecuteAsync("""
                    INSERT INTO ensaio_sensibilidade (empresa_id, certificado_id,
                        carga_referencia, adicao, resultado_display)
                    VALUES (@empresaId, @id, @ref, @adic, @disp)
                    """, new { empresaId, id, @ref = scr.GetDecimal(), adic, disp = srd.GetDecimal() });
            }

            await conn.ExecuteAsync("""
                UPDATE certificado
                   SET status = 'aguardando_aprovacao',
                       enviado_em = COALESCE(enviado_em, now()),
                       data_calibracao = @dataCal,
                       temperatura = @temp, umidade = @umid, pressao = @press,
                       contexto_ema = @contexto,
                       numero_lacre = @lacre, selo_inmetro = @selo,
                       local_tipo = @localTipo, local_detalhe = @localDetalhe,
                       houve_ajuste = @houveAjuste
                 WHERE id = @id
                """, new { id, dataCal,
                    temp = d.TryGetProperty("temperatura", out var t) &&
                           t.ValueKind == JsonValueKind.Number ? t.GetDecimal() : (decimal?)null,
                    umid = d.TryGetProperty("umidade", out var um) &&
                           um.ValueKind == JsonValueKind.Number ? um.GetDecimal() : (decimal?)null,
                    press = d.TryGetProperty("pressao", out var pr) &&
                            pr.ValueKind == JsonValueKind.Number ? pr.GetDecimal() : (decimal?)null,
                    contexto,
                    lacre = d.TryGetProperty("numeroLacre", out var lc) ? lc.GetString() : null,
                    selo = d.TryGetProperty("seloInmetro", out var sl) ? sl.GetString() : null,
                    localTipo = d.TryGetProperty("localTipo", out var lt) &&
                                lt.GetString() is "laboratorio" ? "laboratorio" : "in_loco",
                    localDetalhe = d.TryGetProperty("localDetalhe", out var ld) ? ld.GetString() : null,
                    houveAjuste = d.TryGetProperty("houveAjuste", out var ha) &&
                                  ha.ValueKind == JsonValueKind.True });

            await Auditoria.Registrar(conn, empresaId, Tenant.UsuarioId(user),
                "certificado", id, "enviar_aprovacao", null, Auditoria.Ip(ctx));
            await tx.CommitAsync();

            // Devolve o resultado calculado pro técnico conferir na tela
            var resultado = await conn.QueryAsync("""
                SELECT ordem, carga_aplicada, indicacao, erro, incerteza, ema, aprovado,
                       sem_leitura, sem_leitura_antes
                  FROM ensaio_indicacao WHERE certificado_id = @id ORDER BY ordem
                """, new { id });
            return Results.Ok(new { id, status = "aguardando_aprovacao",
                                    indicacao = resultado });
        });
    }

    // ── Helpers dos relatórios ───────────────────────────────────

    // Nome da empresa do tenant atual (a conexão já tem RLS aplicado)
    static async Task<string> NomeEmpresa(NpgsqlConnection conn)
    {
        var nome = await conn.QuerySingleOrDefaultAsync<string>(
            "SELECT COALESCE(NULLIF(nome_fantasia,''), razao_social) FROM empresa LIMIT 1");
        return nome ?? "Relatório";
    }

    static string OrdemRotulo(string? ordem) => ordem switch
    {
        "ultimo" => "Ordenado por último certificado",
        "cidade" => "Ordenado por cidade/estado",
        "tipo" => "Ordenado por tipo de balança",
        _ => "Ordenado por nome"
    };

    static string FiltrosResumo(Guid? cliente, string? tipo, string? situacao)
    {
        var partes = new List<string>();
        if (cliente is not null) partes.Add("cliente específico");
        if (!string.IsNullOrWhiteSpace(tipo)) partes.Add($"tipo: {tipo}");
        if (!string.IsNullOrWhiteSpace(situacao)) partes.Add($"situação: {situacao}");
        return partes.Count > 0 ? "Filtros — " + string.Join(" · ", partes) : "Todos os registros";
    }

    // Resumo do período para o subtítulo do PDF
    static string PeriodoResumo(DateTime? de, DateTime? ate)
    {
        if (de is null && ate is null) return "Todos os períodos";
        if (de is not null && ate is not null)
            return $"Período: {de:dd/MM/yyyy} a {ate:dd/MM/yyyy}";
        if (de is not null) return $"A partir de {de:dd/MM/yyyy}";
        return $"Até {ate:dd/MM/yyyy}";
    }

    // Rótulos amigáveis dos motivos de e-mail
    static string MotivoEmailExt(string? m) => m switch
    {
        "certificado" => "Certificado",
        "convite" => "Convite de usuário",
        "confirmacao_portal" => "Confirmação de portal",
        "chamado" => "Chamado",
        "contrato_vencendo" => "Contrato vencendo",
        "aviso_vencimento" => "Aviso de vencimento",
        "aviso_vencimento_copia" => "Aviso de vencimento (cópia)",
        "teste" => "Teste",
        "portal_validacao" => "Validação de portal",
        _ => m ?? "—"
    };
}

public record CancelarCertRequest(string? Motivo);
public record ResponsaveisRequest(Guid? TecnicoId, Guid? AprovadorId, string? Justificativa);
public record AtenderSolicitacaoRequest(string? Situacao, string? Observacao);
public record EtiquetaModeloRequest(string? Modelo);
