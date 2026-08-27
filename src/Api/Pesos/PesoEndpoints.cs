using System.Security.Claims;
using CertSaas.Api.Clientes;
using CertSaas.Api.Infra;
using Dapper;
using Npgsql;

namespace CertSaas.Api.Pesos;

public record PesoRequest(string Identificacao, string? ValorNominal,
    string Classe, string? NumCertificado, string? Laboratorio,
    DateOnly Validade, DateOnly? DataCalibracao, string Unidade = "kg",
    // Campos RBC (usados só por empresa acreditada)
    decimal? IncertezaCertificado = null, decimal? KCertificado = null,
    decimal? ValorConvencional = null, decimal? DensidadeMaterial = null, decimal? MassaTotalKg = null);

public record PontoRbc(string? ValorNominal, decimal? ValorConvencional,
    decimal? Incerteza, decimal? K);
public record PontosRbcRequest(List<PontoRbc>? Pontos);

public static class PesoEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/pesos").RequireAuthorization();

        // Todos os papéis podem consultar (o técnico precisa ver validade)
        g.MapGet("/", async (ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var rows = await conn.QueryAsync("""
                SELECT id, identificacao, valor_nominal, massa_total_kg, classe, unidade,
                       num_certificado, laboratorio, validade, data_calibracao, ativo,
                       certificado_pdf_url,
                       incerteza_certificado, k_certificado, valor_convencional, densidade_material,
                       CASE
                         WHEN validade < CURRENT_DATE THEN 'vencido'
                         WHEN validade < CURRENT_DATE + 60 THEN 'vencendo'
                         ELSE 'ok'
                       END AS status_validade
                  FROM peso_padrao
                 ORDER BY identificacao
                """);
            return Results.Ok(rows);
        });

        // Escrita: só admin (peso padrão é ativo metrológico da empresa)
        g.MapPost("/", async (PesoRequest req, ClaimsPrincipal user,
            NpgsqlDataSource ds, HttpContext ctx) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            var erro = Validar(req);
            if (erro is not null) return Results.BadRequest(new { erro });

            await using var conn = await Tenant.AbrirConexao(ds, user);
            var empresaId = Tenant.EmpresaId(user);
            try
            {
                var id = await conn.ExecuteScalarAsync<Guid>("""
                    INSERT INTO peso_padrao (empresa_id, identificacao, valor_nominal,
                        classe, num_certificado, laboratorio, validade,
                        data_calibracao, unidade,
                        incerteza_certificado, k_certificado, valor_convencional, densidade_material, massa_total_kg)
                    VALUES (@empresaId, @Identificacao, @ValorNominal,
                        @Classe, @NumCertificado, @Laboratorio, @Validade,
                        @DataCalibracao, @Unidade,
                        @IncertezaCertificado, @KCertificado, @ValorConvencional, @DensidadeMaterial, @MassaTotalKg)
                    RETURNING id
                    """, new { empresaId, req.Identificacao, req.ValorNominal, req.MassaTotalKg,
                        req.Classe, req.NumCertificado, req.Laboratorio, req.Validade,
                        req.DataCalibracao, req.Unidade,
                        req.IncertezaCertificado, req.KCertificado, req.ValorConvencional, req.DensidadeMaterial });

                await Auditoria.Registrar(conn, empresaId, Tenant.UsuarioId(user),
                    "peso_padrao", id, "insert", req, Auditoria.Ip(ctx));
                return Results.Created($"/api/pesos/{id}", new { id });
            }
            catch (PostgresException e) when (e.SqlState == "23505")
            {
                return Results.Conflict(new { erro = "Já existe peso com essa identificação." });
            }
        });

        g.MapPut("/{id:guid}", async (Guid id, PesoRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds, HttpContext ctx) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            var erro = Validar(req);
            if (erro is not null) return Results.BadRequest(new { erro });

            await using var conn = await Tenant.AbrirConexao(ds, user);
            var n = await conn.ExecuteAsync("""
                UPDATE peso_padrao SET identificacao = @Identificacao,
                       valor_nominal = @ValorNominal, classe = @Classe,
                       num_certificado = @NumCertificado,
                       laboratorio = @Laboratorio, validade = @Validade,
                       data_calibracao = @DataCalibracao, unidade = @Unidade,
                       incerteza_certificado = @IncertezaCertificado,
                       k_certificado = @KCertificado,
                       valor_convencional = @ValorConvencional,
                       densidade_material = @DensidadeMaterial,
                       massa_total_kg = @MassaTotalKg
                 WHERE id = @id
                """, new { id, req.Identificacao, req.ValorNominal, req.MassaTotalKg, req.Classe,
                    req.NumCertificado, req.Laboratorio, req.Validade,
                    req.DataCalibracao, req.Unidade,
                    req.IncertezaCertificado, req.KCertificado, req.ValorConvencional, req.DensidadeMaterial });
            if (n == 0) return Results.NotFound();

            await Auditoria.Registrar(conn, Tenant.EmpresaId(user),
                Tenant.UsuarioId(user), "peso_padrao", id, "update", req,
                Auditoria.Ip(ctx));
            return Results.Ok(new { id });
        });

        // ── Todos os pontos de peso da empresa (para composição RBC) ──
        g.MapGet("/pontos-rbc-todos", async (ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var rows = await conn.QueryAsync("""
                SELECT ppr.id, ppr.ordem, ppr.valor_nominal, ppr.valor_convencional,
                       ppr.incerteza, ppr.k,
                       pp.identificacao AS peso_identificacao,
                       pp.num_certificado
                  FROM peso_ponto_rbc ppr
                  JOIN peso_padrao pp ON pp.id = ppr.peso_padrao_id
                 WHERE pp.ativo = true
                 ORDER BY pp.identificacao, ppr.ordem
                """);
            return Results.Ok(rows);
        });

        // ── Pontos de calibração do peso (RBC) ──────────────────
        // Lista os pontos de um peso (tabela peso_ponto_rbc)
        g.MapGet("/{id:guid}/pontos", async (Guid id, ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var rows = await conn.QueryAsync("""
                SELECT id, ordem, valor_nominal, valor_convencional, incerteza, k
                  FROM peso_ponto_rbc
                 WHERE peso_padrao_id = @id
                 ORDER BY ordem
                """, new { id });
            return Results.Ok(rows);
        });

        // Substitui TODOS os pontos de um peso de uma vez (só gestor)
        g.MapPut("/{id:guid}/pontos", async (Guid id, PontosRbcRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds, HttpContext ctx) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            var empresaId = Tenant.EmpresaId(user);
            await using var conn = await Tenant.AbrirConexao(ds, user);
            // apaga os antigos e regrava (transação simples)
            await conn.ExecuteAsync("DELETE FROM peso_ponto_rbc WHERE peso_padrao_id = @id", new { id });
            if (req.Pontos is { Count: > 0 })
            {
                int ordem = 1;
                foreach (var pt in req.Pontos)
                {
                    await conn.ExecuteAsync("""
                        INSERT INTO peso_ponto_rbc
                            (empresa_id, peso_padrao_id, ordem, valor_nominal,
                             valor_convencional, incerteza, k)
                        VALUES (@empresaId, @id, @ordem, @ValorNominal,
                                @ValorConvencional, @Incerteza, @K)
                        """, new { empresaId, id, ordem,
                            pt.ValorNominal, pt.ValorConvencional, pt.Incerteza,
                            K = pt.K ?? 2 });
                    ordem++;
                }
            }
            await Auditoria.Registrar(conn, empresaId, Tenant.UsuarioId(user),
                "peso_ponto_rbc", id, "update_pontos", req, Auditoria.Ip(ctx));
            return Results.Ok(new { salvo = true, total = req.Pontos?.Count ?? 0 });
        });

        g.MapPut("/{id:guid}/ativo", async (Guid id, AtivoRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds, HttpContext ctx) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var n = await conn.ExecuteAsync(
                "UPDATE peso_padrao SET ativo = @ativo WHERE id = @id",
                new { id, ativo = req.Ativo });
            if (n == 0) return Results.NotFound();

            await Auditoria.Registrar(conn, Tenant.EmpresaId(user),
                Tenant.UsuarioId(user), "peso_padrao", id,
                req.Ativo ? "reativar" : "inativar", null, Auditoria.Ip(ctx));
            return Results.Ok(new { id, req.Ativo });
        });
    }

    private static string? Validar(PesoRequest req)
    {
        // Massa total obrigatória (João, 13/08/2026): alimenta a soma dos
        // padrões no método da substituição e a rastreabilidade do conjunto.
        if (req.MassaTotalKg is null or <= 0)
            return "Informe a MASSA TOTAL do conjunto em kg (soma de todos os pesos deste certificado).";

        if (string.IsNullOrWhiteSpace(req.Identificacao))
            return "Identificação é obrigatória.";
        if (string.IsNullOrWhiteSpace(req.Classe))
            return "Classe é obrigatória (ex.: M1, M2, F1).";
        return null;
    }
}
