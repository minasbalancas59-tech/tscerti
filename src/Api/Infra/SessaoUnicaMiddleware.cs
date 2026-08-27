using System.Security.Claims;
using Dapper;
using Npgsql;

namespace CertSaas.Api.Infra;

/// <summary>
/// Sessão única: verifica se o "sid" do token ainda é a sessão vigente
/// do usuário no banco. Se um login mais recente substituiu a sessão,
/// este token deixa de valer e retorna 401 — o cliente cai no login.
/// Só atua em requisições já autenticadas (com claims sub e sid).
/// </summary>
public sealed class SessaoUnicaMiddleware
{
    private readonly RequestDelegate _next;

    public SessaoUnicaMiddleware(RequestDelegate next) => _next = next;

    public async Task Invoke(HttpContext ctx, NpgsqlDataSource ds)
    {
        if (ctx.User.Identity?.IsAuthenticated == true)
        {
            var sub = ctx.User.FindFirstValue("sub");
            var sid = ctx.User.FindFirstValue("sid");

            // Tokens antigos (sem sid) e ids inválidos: deixa seguir para
            // não travar quem tinha sessão aberta na hora do deploy.
            if (Guid.TryParse(sub, out var usuario) && Guid.TryParse(sid, out var sessao))
            {
                bool valida;
                try
                {
                    await using var conn = await ds.OpenConnectionAsync();
                    valida = await conn.ExecuteScalarAsync<bool>(
                        "SELECT auth_sessao_valida(@usuario, @sessao)",
                        new { usuario, sessao });
                }
                catch
                {
                    // Em caso de erro ao verificar, não derruba a sessão
                    valida = true;
                }

                if (!valida)
                {
                    ctx.Response.StatusCode = 401;
                    ctx.Response.ContentType = "application/json";
                    await ctx.Response.WriteAsJsonAsync(new
                    {
                        erro = "Sua sessão foi encerrada porque este usuário entrou em outro dispositivo."
                    });
                    return;
                }
            }
        }

        await _next(ctx);
    }
}
