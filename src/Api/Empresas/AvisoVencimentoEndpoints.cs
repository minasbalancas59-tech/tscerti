using System.Security.Claims;
using System.Text.Json;
using CertSaas.Api.Infra;
using Dapper;
using Npgsql;
using StackExchange.Redis;

namespace CertSaas.Api.Empresas;

public record AvisoVencConfigRequest(
    bool Ativo, string Dias, int FreqDias, bool CopiaGestor);

public static class AvisoVencimentoEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/avisos-vencimento").RequireAuthorization();

        // Ler configuração (admin/RT)
        g.MapGet("/config", async (ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var c = await conn.QuerySingleOrDefaultAsync(
                @"SELECT aviso_venc_ativo AS ativo, aviso_venc_dias AS dias,
                         aviso_venc_freq_dias AS ""freqDias"", aviso_venc_copia_gestor AS ""copiaGestor""
                    FROM empresa WHERE id = @id", new { id = Tenant.EmpresaId(user) });
            return Results.Ok(c);
        });

        // Salvar configuração (admin/RT)
        g.MapPut("/config", async (AvisoVencConfigRequest req, ClaimsPrincipal user,
            NpgsqlDataSource ds, HttpContext ctx) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            Tenant.GarantirNaoVisualizando(user);

            // Valida os marcos (só números positivos, separados por vírgula)
            var dias = req.Dias.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(s => int.TryParse(s, out var n) ? n : -1).ToList();
            if (dias.Count == 0 || dias.Any(n => n <= 0))
                return Results.BadRequest(new { erro = "Dias de antecedência inválidos (ex.: 30,15,7)." });
            if (req.FreqDias < 1)
                return Results.BadRequest(new { erro = "Frequência mínima deve ser ao menos 1 dia." });

            var diasNorm = string.Join(",", dias.OrderByDescending(x => x).Distinct());
            await using var conn = await Tenant.AbrirConexao(ds, user);
            await conn.ExecuteAsync(
                @"UPDATE empresa SET aviso_venc_ativo = @Ativo, aviso_venc_dias = @dias,
                         aviso_venc_freq_dias = @FreqDias, aviso_venc_copia_gestor = @CopiaGestor
                   WHERE id = @id",
                new { req.Ativo, dias = diasNorm, req.FreqDias, req.CopiaGestor, id = Tenant.EmpresaId(user) });
            await Auditoria.Registrar(conn, Tenant.EmpresaId(user), Tenant.UsuarioId(user),
                "empresa", Tenant.EmpresaId(user), "config_aviso_vencimento", req, Auditoria.Ip(ctx));
            return Results.Ok(new { ok = true });
        });

        // Pré-visualizar quem seria avisado agora (não envia)
        g.MapGet("/previa", async (int? maxDias, ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            // Usa o maior marco configurado se não vier parâmetro
            var cfgDias = await conn.QuerySingleOrDefaultAsync<string>(
                "SELECT aviso_venc_dias FROM empresa WHERE id = @id", new { id = Tenant.EmpresaId(user) });
            int janela = maxDias ?? (cfgDias?.Split(',')
                .Select(s => int.TryParse(s.Trim(), out var n) ? n : 0).DefaultIfEmpty(30).Max() ?? 30);
            var rows = await conn.QueryAsync(
                "SELECT * FROM avisos_vencimento_pendentes(@janela, 0, false, NULL, @emp)",
                new { janela, emp = Tenant.EmpresaId(user) });   // isolamento explícito
            return Results.Ok(rows);
        });

        // Enviar aviso MANUAL (um cliente ou todos) — enfileira no Worker
        g.MapPost("/enviar", async (EnvioManualRequest req, ClaimsPrincipal user,
            NpgsqlDataSource ds, IConnectionMultiplexer redis) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            Tenant.GarantirNaoVisualizando(user);

            await redis.GetDatabase().ListLeftPushAsync("fila:tarefas",
                JsonSerializer.Serialize(new
                {
                    tipo = "aviso_vencimento_manual",
                    empresa_id = Tenant.EmpresaId(user).ToString(),
                    cliente_id = req.ClienteId?.ToString(),
                    usuario_id = Tenant.UsuarioId(user).ToString()
                }));
            return Results.Ok(new { enfileirado = true });
        });

        // Histórico de avisos enviados
        g.MapGet("/historico", async (ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var rows = await conn.QueryAsync(
                @"SELECT av.enviado_em, c.razao_social AS cliente, av.modo,
                         av.qtd_balancas, av.email_para
                    FROM aviso_vencimento av
                    JOIN cliente c ON c.id = av.cliente_id
                   ORDER BY av.enviado_em DESC LIMIT 200");
            return Results.Ok(rows);
        });
    }
}

public record EnvioManualRequest(Guid? ClienteId);
