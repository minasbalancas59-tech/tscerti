using System.Security.Claims;
using CertSaas.Api.Clientes;
using CertSaas.Api.Infra;
using Dapper;
using Npgsql;

namespace CertSaas.Api.Balancas;

public record BalancaRequest(string Identificacao, string Tipo, string? Marca,
    string? Modelo, string? NumSerie, string? NumSerieIndicador, decimal Capacidade, decimal DivisaoE,
    decimal? DivisaoD, string ClasseExatidao, string? LocalInstalacao,
    string? NumeroInmetro, string? Patrimonio, string? PortariaAprovacao,
    string Unidade = "kg", int PeriodicidadeMeses = 12, bool MultiIntervalo = false, bool FazExcentricidade = true, bool FazSensibilidade = true);

public record FaixaReq(decimal LimiteSup, decimal DivisaoE);
public record FaixasRequest(List<FaixaReq> Faixas);

public static class BalancaEndpoints
{
    private static readonly string[] Classes = { "I", "II", "III", "IIII" };

    public static void Map(WebApplication app)
    {
        var porCliente = app.MapGroup("/api/clientes/{clienteId:guid}/balancas")
                            .RequireAuthorization();

        porCliente.MapGet("/", async (Guid clienteId, ClaimsPrincipal user,
            NpgsqlDataSource ds) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var rows = await conn.QueryAsync("""
                SELECT id, identificacao, tipo, marca, modelo, num_serie, num_serie_indicador, faz_excentricidade, faz_sensibilidade,
                       capacidade, divisao_e, divisao_d, classe_exatidao,
                       local_instalacao, periodicidade_meses, ativa,
                       numero_inmetro, patrimonio, unidade, portaria_aprovacao,
                       multi_intervalo
                  FROM balanca
                 WHERE cliente_id = @clienteId
                 ORDER BY identificacao
                """, new { clienteId });
            return Results.Ok(rows);
        });

        // ── Excluir balança (somente admin/RT; bloqueado se houver
        //    qualquer certificado, ativo ou arquivado) ──────────────
        porCliente.MapDelete("/{id:guid}", async (Guid clienteId, Guid id,
            ClaimsPrincipal user, NpgsqlDataSource ds, HttpContext ctx) =>
        {
            var papel = Tenant.Papel(user);
            if (papel is not ("admin" or "responsavel_tecnico"))
                return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var bal = await conn.QuerySingleOrDefaultAsync(
                "SELECT id FROM balanca WHERE id = @id AND cliente_id = @clienteId",
                new { id, clienteId });
            if (bal is null) return Results.NotFound();
            var qtd = await conn.ExecuteScalarAsync<long>(
                "SELECT COUNT(*) FROM certificado WHERE balanca_id = @id", new { id });
            var qtdArq = await conn.ExecuteScalarAsync<long>(
                "SELECT COUNT(*) FROM certificado_arquivo WHERE dados::text ILIKE '%' || @id::text || '%'", new { id });
            if (qtd + qtdArq > 0)
                return Results.BadRequest(new { erro = $"Balança possui {qtd + qtdArq} certificado(s) no histórico — não pode ser excluída. A rastreabilidade metrológica exige manter o registro." });
            await conn.ExecuteAsync("DELETE FROM balanca_faixa WHERE balanca_id = @id", new { id });
            await conn.ExecuteAsync("DELETE FROM balanca WHERE id = @id", new { id });
            await Auditoria.Registrar(conn, Tenant.EmpresaId(user), Tenant.UsuarioId(user),
                "balanca", id, "excluir", null, Auditoria.Ip(ctx));
            return Results.Ok(new { excluido = true });
        });

        porCliente.MapPost("/", async (Guid clienteId, BalancaRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds, HttpContext ctx) =>
        {
            var erro = Validar(req);
            if (erro is not null) return Results.BadRequest(new { erro });

            await using var conn = await Tenant.AbrirConexao(ds, user);
            var empresaId = Tenant.EmpresaId(user);

            // RLS já garante que só clientes do tenant são visíveis
            var existe = await conn.ExecuteScalarAsync<bool>(
                "SELECT EXISTS(SELECT 1 FROM cliente WHERE id = @clienteId)",
                new { clienteId });
            if (!existe) return Results.NotFound(new { erro = "Cliente não encontrado." });

            try
            {
                var id = await conn.ExecuteScalarAsync<Guid>("""
                    INSERT INTO balanca (empresa_id, cliente_id, identificacao, tipo,
                        marca, modelo, num_serie, num_serie_indicador, capacidade, divisao_e, divisao_d,
                        classe_exatidao, local_instalacao, periodicidade_meses, unidade,
                        numero_inmetro, patrimonio, portaria_aprovacao, multi_intervalo,
                        faz_excentricidade, faz_sensibilidade)
                    VALUES (@empresaId, @clienteId, @Identificacao, @Tipo,
                        @Marca, @Modelo, @NumSerie, @NumSerieIndicador, @Capacidade, @DivisaoE, @DivisaoD,
                        @ClasseExatidao, @LocalInstalacao, @PeriodicidadeMeses, @Unidade,
                        @NumeroInmetro, @Patrimonio, @PortariaAprovacao, @MultiIntervalo,
                        @FazExcentricidade, @FazSensibilidade)
                    RETURNING id
                    """, new { empresaId, clienteId, req.Identificacao, req.Tipo,
                        req.Marca, req.Modelo, req.NumSerie, req.NumSerieIndicador, req.Capacidade,
                        req.DivisaoE, req.DivisaoD, req.ClasseExatidao,
                        req.LocalInstalacao, req.PeriodicidadeMeses, req.Unidade,
                        req.NumeroInmetro, req.Patrimonio, req.PortariaAprovacao,
                        req.MultiIntervalo, req.FazExcentricidade, req.FazSensibilidade });

                await Auditoria.Registrar(conn, empresaId, Tenant.UsuarioId(user),
                    "balanca", id, "insert", req, Auditoria.Ip(ctx));
                return Results.Created($"/api/balancas/{id}", new { id });
            }
            catch (PostgresException e) when (e.SqlState == "23505")
            {
                var porSerie = e.ConstraintName is "uq_balanca_cliente_num_serie";
                return Results.Conflict(new { erro = porSerie
                    ? $"Já existe uma balança deste cliente com o número de série {req.NumSerie}. " +
                      "Verifique se o equipamento já está cadastrado."
                    : "Já existe balança com essa identificação nesse cliente." });
            }
        });

        var g = app.MapGroup("/api/balancas").RequireAuthorization();

        // Sugestão de classe pela Portaria 236/94 (não persiste nada)
        g.MapPost("/sugerir-classe", (SugerirClasseRequest req) =>
        {
            var fator = CertSaas.Api.Certificados.Unidades.FatorKg(req.Unidade ?? "kg");
            Classificador.Resultado r;
            if (req.Faixas is not null && req.Faixas.Count >= 2)
            {
                // Multi-intervalo: classifica pelas faixas parciais
                var faixasKg = req.Faixas
                    .Select(f => (f.LimiteSup * fator, f.DivisaoE * fator))
                    .ToList();
                r = Classificador.ClassificarMulti(faixasKg, req.Tipo ?? "plataforma", req.ClasseEscolhida);
            }
            else
            {
                r = Classificador.Classificar(
                    req.Capacidade * fator, req.DivisaoE * fator,
                    req.Tipo ?? "plataforma", req.ClasseEscolhida);
            }
            return Results.Ok(r);
        });


        // ── Última calibração desta balança (para o aviso de recente) ──
        g.MapGet("/{id:guid}/ultima-calibracao", async (Guid id, ClaimsPrincipal user,
            NpgsqlDataSource ds) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var ult = await conn.QuerySingleOrDefaultAsync("""
                SELECT ct.numero, ct.data_calibracao, ct.data_emissao,
                       (CURRENT_DATE - ct.data_calibracao) AS dias
                  FROM certificado ct
                 WHERE ct.balanca_id = @id AND ct.status = 'emitido'
                   AND ct.data_calibracao IS NOT NULL
                 ORDER BY ct.data_calibracao DESC LIMIT 1
                """, new { id });
            if (ult is null) return Results.Ok(new { temRecente = false });
            int dias = (int)(ult.dias ?? 9999);
            return Results.Ok(new {
                temRecente = dias >= 0 && dias <= 30,
                dias,
                numero = (string?)ult.numero,
                dataCalibracao = ult.data_calibracao
            });
        });


        // ── Rascunho em andamento desta balança (qualquer técnico) ──
        g.MapGet("/{id:guid}/rascunho-aberto", async (Guid id, ClaimsPrincipal user,
            NpgsqlDataSource ds) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var r = await conn.QuerySingleOrDefaultAsync("""
                SELECT ct.id, ct.criado_em, ct.emitir_rbc, ct.tecnico_id,
                       u.nome AS tecnico
                  FROM certificado ct
                  JOIN usuario u ON u.id = ct.tecnico_id
                 WHERE ct.balanca_id = @id AND ct.status = 'rascunho'
                 ORDER BY ct.criado_em DESC LIMIT 1
                """, new { id });
            if (r is null) return Results.Ok(new { temRascunho = false });
            return Results.Ok(new {
                temRascunho = true,
                id = (Guid)r.id,
                criadoEm = r.criado_em,
                tecnico = (string)r.tecnico,
                tecnicoId = (Guid)r.tecnico_id,
                emitirRbc = (bool)r.emitir_rbc
            });
        });

        // ── Cargas do último certificado da balança (acelera o ensaio) ──
        g.MapGet("/{id:guid}/ultimo-plano", async (Guid id, ClaimsPrincipal user,
            NpgsqlDataSource ds) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var ult = await conn.QuerySingleOrDefaultAsync("""
                SELECT ct.id, ct.numero
                  FROM certificado ct
                 WHERE ct.balanca_id = @id
                   AND ct.status IN ('emitido','substituido')
                 ORDER BY ct.data_calibracao DESC NULLS LAST, ct.criado_em DESC
                 LIMIT 1
                """, new { id });
            if (ult is null) return Results.NotFound();

            Guid cid = ult.id;
            var cargas = (await conn.QueryAsync<decimal>(
                "SELECT carga_aplicada FROM ensaio_indicacao WHERE certificado_id=@cid ORDER BY ordem",
                new { cid })).ToList();
            var exc = (await conn.QueryAsync(
                "SELECT posicao, carga, indicacao FROM ensaio_excentricidade WHERE certificado_id=@cid",
                new { cid })).ToList();
            var rep = (await conn.QueryAsync(
                "SELECT medicao_num, carga, indicacao FROM ensaio_repetibilidade WHERE certificado_id=@cid ORDER BY medicao_num",
                new { cid })).ToList();
            return Results.Ok(new { numero = (string)ult.numero, cargas, exc, rep });
        });

        // ── Faixas (multi-intervalo) ──
        g.MapGet("/{id:guid}/faixas", async (Guid id, ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            return Results.Ok(await conn.QueryAsync("""
                SELECT ordem, limite_sup, divisao_e FROM balanca_faixa
                 WHERE balanca_id = @id ORDER BY ordem
                """, new { id }));
        });

        g.MapPut("/{id:guid}/faixas", async (Guid id, FaixasRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds, HttpContext ctx) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var empresaId = Tenant.EmpresaId(user);
            var capacidade = await conn.ExecuteScalarAsync<decimal?>(
                "SELECT capacidade FROM balanca WHERE id=@id", new { id });
            if (capacidade is null) return Results.NotFound();

            // Validação: se há faixas, ao menos 2, em ordem crescente, e a
            // última faixa deve terminar exatamente na capacidade da balança
            // (senão sobra um trecho da balança sem "e" definido).
            var faixas = req.Faixas ?? new List<FaixaReq>();
            if (faixas.Count > 0)
            {
                if (faixas.Count < 2)
                    return Results.BadRequest(new { erro = "Multi-intervalo precisa de ao menos 2 faixas." });
                if (faixas.Count > 3)
                    return Results.BadRequest(new { erro = "Máximo de 3 faixas." });
                for (int i = 0; i < faixas.Count; i++)
                {
                    if (faixas[i].LimiteSup <= 0 || faixas[i].DivisaoE <= 0)
                        return Results.BadRequest(new { erro = "Limite e divisão das faixas devem ser positivos." });
                    if (i > 0 && faixas[i].LimiteSup <= faixas[i - 1].LimiteSup)
                        return Results.BadRequest(new { erro = "Os limites das faixas devem estar em ordem crescente." });
                }
                if (Math.Abs(faixas[^1].LimiteSup - capacidade.Value) > 0.0000001m)
                    return Results.BadRequest(new { erro =
                        $"A última faixa vai até {faixas[^1].LimiteSup}, mas a capacidade da balança é " +
                        $"{capacidade.Value}. A última faixa deve terminar exatamente na capacidade." });
            }

            await using var tx = await conn.BeginTransactionAsync();
            await conn.ExecuteAsync("DELETE FROM balanca_faixa WHERE balanca_id=@id", new { id });
            var ordem = 0;
            foreach (var f in faixas)
                await conn.ExecuteAsync("""
                    INSERT INTO balanca_faixa (balanca_id, empresa_id, ordem, limite_sup, divisao_e)
                    VALUES (@id, @empresaId, @ordem, @lim, @e)
                    """, new { id, empresaId, ordem = ++ordem, lim = f.LimiteSup, e = f.DivisaoE });
            // atualiza a flag na balança
            await conn.ExecuteAsync(
                "UPDATE balanca SET multi_intervalo = @m WHERE id=@id",
                new { id, m = faixas.Count > 0 });
            await tx.CommitAsync();

            await Auditoria.Registrar(conn, empresaId, Tenant.UsuarioId(user),
                "balanca", id, "faixas", new { faixas }, Auditoria.Ip(ctx));
            return Results.Ok(new { ok = true, total = faixas.Count });
        });


        g.MapGet("/{id:guid}", async (Guid id, ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var b = await conn.QuerySingleOrDefaultAsync("""
                SELECT b.*, c.razao_social AS cliente
                  FROM balanca b JOIN cliente c ON c.id = b.cliente_id
                 WHERE b.id = @id
                """, new { id });
            return b is null ? Results.NotFound() : Results.Ok(b);
        });

        g.MapPut("/{id:guid}", async (Guid id, BalancaRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds, HttpContext ctx) =>
        {
            var erro = Validar(req);
            if (erro is not null) return Results.BadRequest(new { erro });

            await using var conn = await Tenant.AbrirConexao(ds, user);
            try
            {
            var n = await conn.ExecuteAsync("""
                UPDATE balanca SET identificacao = @Identificacao, tipo = @Tipo,
                       marca = @Marca, modelo = @Modelo, num_serie = @NumSerie,
                       num_serie_indicador = @NumSerieIndicador,
                       capacidade = @Capacidade, divisao_e = @DivisaoE,
                       divisao_d = @DivisaoD, classe_exatidao = @ClasseExatidao,
                       local_instalacao = @LocalInstalacao,
                       periodicidade_meses = @PeriodicidadeMeses, unidade = @Unidade,
                       numero_inmetro = @NumeroInmetro, patrimonio = @Patrimonio,
                       portaria_aprovacao = @PortariaAprovacao,
                       faz_excentricidade = @FazExcentricidade,
                       faz_sensibilidade = @FazSensibilidade, multi_intervalo = @MultiIntervalo
                 WHERE id = @id
                """, new { id, req.Identificacao, req.Tipo, req.Marca, req.Modelo,
                    req.NumSerie, req.NumSerieIndicador, req.Capacidade, req.DivisaoE, req.DivisaoD,
                    req.ClasseExatidao, req.LocalInstalacao, req.PeriodicidadeMeses,
                    req.Unidade, req.NumeroInmetro, req.Patrimonio,
                    req.PortariaAprovacao, req.MultiIntervalo,
                    req.FazExcentricidade, req.FazSensibilidade });
            if (n == 0) return Results.NotFound();

            await Auditoria.Registrar(conn, Tenant.EmpresaId(user),
                Tenant.UsuarioId(user), "balanca", id, "update", req, Auditoria.Ip(ctx));
            return Results.Ok(new { id });
            }
            // Mesmo tratamento do cadastro novo: sem isto, editar uma balança
            // para um número de série que já existe no cliente estourava o erro
            // cru do Postgres na tela (IMPERIUM, 04/09/2026 — 8 ocorrências).
            catch (PostgresException e) when (e.SqlState == "23505")
            {
                var porSerie = e.ConstraintName is "uq_balanca_cliente_num_serie";
                return Results.Conflict(new { erro = porSerie
                    ? $"Já existe outra balança deste cliente com o número de série {req.NumSerie}. "
                      + "Verifique se o equipamento não está cadastrado em duplicidade."
                    : "Já existe outra balança com essa identificação nesse cliente." });
            }
        });

        g.MapPut("/{id:guid}/ativo", async (Guid id, AtivoRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds, HttpContext ctx) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var n = await conn.ExecuteAsync(
                "UPDATE balanca SET ativa = @ativo WHERE id = @id",
                new { id, ativo = req.Ativo });
            if (n == 0) return Results.NotFound();

            await Auditoria.Registrar(conn, Tenant.EmpresaId(user),
                Tenant.UsuarioId(user), "balanca", id,
                req.Ativo ? "reativar" : "inativar", null, Auditoria.Ip(ctx));
            return Results.Ok(new { id, req.Ativo });
        });
    }

    private static string? Validar(BalancaRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Identificacao))
            return "Identificação é obrigatória.";
        if (string.IsNullOrWhiteSpace(req.Tipo))
            return "Tipo é obrigatório.";
        if (!Classes.Contains(req.ClasseExatidao))
            return "Classe de exatidão inválida (I, II, III ou IIII).";
        if (req.Capacidade <= 0) return "Capacidade deve ser maior que zero.";
        if (req.DivisaoE <= 0) return "Divisão (e) deve ser maior que zero.";
        if (req.DivisaoE >= req.Capacidade)
            return "Divisão (e) deve ser menor que a capacidade.";
        // Em multi-intervalo o d não se aplica (cada faixa tem seu e); em
        // escala única ele é obrigatório e o certificado sempre o declara.
        if (!req.MultiIntervalo)
        {
            if (req.DivisaoD is not { } dd || dd <= 0)
                return "Divisão (d) é obrigatória. Se a balança não distingue "
                     + "as duas divisões, informe o mesmo valor do e.";
            if (dd > req.DivisaoE)
                return "Divisão (d) não pode ser maior que a divisão (e).";
        }
        if (req.PeriodicidadeMeses is < 1 or > 60)
            return "Periodicidade deve estar entre 1 e 60 meses.";
        if (req.Unidade is not ("g" or "kg" or "t"))
            return "Unidade inválida (use g, kg ou t).";
        return null;
    }
}

public record FaixaClasse(decimal LimiteSup, decimal DivisaoE);
public record SugerirClasseRequest(decimal Capacidade, decimal DivisaoE,
    string? Unidade, string? Tipo, string? ClasseEscolhida,
    List<FaixaClasse>? Faixas = null);
