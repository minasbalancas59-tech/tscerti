using System.Security.Claims;
using CertSaas.Api.Infra;
using Dapper;
using Npgsql;
using StackExchange.Redis;

namespace CertSaas.Api.Sistema;

public record SmtpConfigRequest(string? Host, int? Port, string? User,
    string? Password, string? From, string? NomeRemetente);
public record SmtpTesteRequest(string Para);

/// <summary>
/// Configuração global do sistema (servidor SMTP), editável pelo admin.
/// Guardada na tabela config_sistema (chave/valor); o worker lê de lá
/// na hora de enviar, com as variáveis de ambiente como reserva.
/// </summary>
public static class SistemaEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/sistema").RequireAuthorization();

        // Lê a configuração SMTP (nunca devolve a senha — só se existe)
        g.MapGet("/smtp", async (ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Tenant.EhSuperAdmin(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            var rows = await conn.QueryAsync<(string chave, string? valor)>(
                "SELECT chave, valor FROM config_sistema WHERE chave LIKE 'smtp_%'");
            var d = rows.ToDictionary(r => r.chave, r => r.valor);
            return Results.Ok(new
            {
                host = d.GetValueOrDefault("smtp_host"),
                port = d.GetValueOrDefault("smtp_port"),
                user = d.GetValueOrDefault("smtp_user"),
                from = d.GetValueOrDefault("smtp_from"),
                nomeRemetente = d.GetValueOrDefault("smtp_nome"),
                temSenha = !string.IsNullOrEmpty(d.GetValueOrDefault("smtp_password"))
            });
        });

        // Salva a configuração (senha em branco = mantém a atual)
        g.MapPut("/smtp", async (SmtpConfigRequest req, ClaimsPrincipal user,
            NpgsqlDataSource ds, HttpContext ctx) =>
        {
            if (!Tenant.EhSuperAdmin(user)) return Results.Forbid();
            if (string.IsNullOrWhiteSpace(req.Host))
                return Results.BadRequest(new { erro = "Informe o servidor (host)." });
            if (req.Port is null or < 1 or > 65535)
                return Results.BadRequest(new { erro = "Porta inválida." });

            await using var conn = await ds.OpenConnectionAsync();
            async Task Grava(string chave, string? valor) =>
                await conn.ExecuteAsync("""
                    INSERT INTO config_sistema (chave, valor) VALUES (@chave, @valor)
                    ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor
                    """, new { chave, valor });

            await Grava("smtp_host", req.Host.Trim());
            await Grava("smtp_port", req.Port.ToString());
            await Grava("smtp_user", req.User?.Trim());
            await Grava("smtp_from", req.From?.Trim());
            await Grava("smtp_nome", req.NomeRemetente?.Trim());
            if (!string.IsNullOrEmpty(req.Password))
                await Grava("smtp_password", req.Password);

            // Auditoria sem expor a senha
            await using var connT = await Tenant.AbrirConexao(ds, user);
            await Auditoria.Registrar(connT, Tenant.EmpresaId(user),
                Tenant.UsuarioId(user), "config_sistema", Guid.Empty, "smtp_update",
                new { req.Host, req.Port, req.User, req.From }, Auditoria.Ip(ctx));
            return Results.Ok(new { salvo = true });
        });

        // Envia um email de teste (pelo worker, com a config salva)
        g.MapPost("/smtp/teste", async (SmtpTesteRequest req, ClaimsPrincipal user,
            IConnectionMultiplexer redis) =>
        {
            if (!Tenant.EhSuperAdmin(user)) return Results.Forbid();
            if (string.IsNullOrWhiteSpace(req.Para) || !req.Para.Contains('@'))
                return Results.BadRequest(new { erro = "Informe um email válido." });
            await redis.GetDatabase().ListLeftPushAsync("fila:tarefas",
                "{\"tipo\":\"email_teste\",\"para\":\"" + req.Para.Trim() + "\"}");
            return Results.Ok(new { enviado = true });
        });
    }
}
