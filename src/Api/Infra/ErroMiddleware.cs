using System.Security.Claims;
using Dapper;
using Npgsql;

namespace CertSaas.Api.Infra;

/// <summary>
/// Captura exceções não-tratadas, grava um registro em erro_sistema
/// (best-effort — se a gravação falhar, não propaga) e devolve um
/// 500 limpo em JSON, sem vazar o stack trace para o cliente.
/// </summary>
public sealed class ErroMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<ErroMiddleware> _log;

    public ErroMiddleware(RequestDelegate next, ILogger<ErroMiddleware> log)
    {
        _next = next;
        _log = log;
    }

    public async Task Invoke(HttpContext ctx, NpgsqlDataSource ds)
    {
        try
        {
            await _next(ctx);
        }
        catch (VisualizacaoSomenteLeituraException ex)
        {
            // Bloqueio esperado (não é erro de sistema): responde 403 e não registra.
            if (!ctx.Response.HasStarted)
            {
                ctx.Response.StatusCode = 403;
                ctx.Response.ContentType = "application/json";
                await ctx.Response.WriteAsJsonAsync(new { erro = ex.Message });
            }
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Erro não tratado em {Metodo} {Rota}",
                ctx.Request.Method, ctx.Request.Path);

            // Grava o erro no banco (best-effort, nunca relança)
            try
            {
                Guid? empresa = null, usuario = null;
                var eid = ctx.User.FindFirstValue("empresa_id");
                var uid = ctx.User.FindFirstValue("sub");
                if (Guid.TryParse(eid, out var e)) empresa = e;
                if (Guid.TryParse(uid, out var u)) usuario = u;

                await using var conn = await ds.OpenConnectionAsync();
                await conn.ExecuteAsync(
                    "SELECT registrar_erro(@rota, @metodo, @tipo, @msg, @detalhe, @empresa, @usuario)",
                    new
                    {
                        rota = ctx.Request.Path.Value,
                        metodo = ctx.Request.Method,
                        tipo = ex.GetType().Name,
                        msg = ex.Message,
                        detalhe = ex.ToString(),
                        empresa,
                        usuario
                    });
            }
            catch (Exception exLog)
            {
                _log.LogError(exLog, "Falha ao gravar erro no banco");
            }

            if (!ctx.Response.HasStarted)
            {
                ctx.Response.StatusCode = 500;
                ctx.Response.ContentType = "application/json";
                await ctx.Response.WriteAsJsonAsync(new
                {
                    erro = "Ocorreu um erro inesperado. A equipe foi notificada."
                });
            }
        }
    }
}
