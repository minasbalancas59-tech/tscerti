using System.Security.Claims;

namespace CertSaas.Api.Infra;

/// <summary>
/// Quando o super-admin está em modo de VISUALIZAÇÃO (token com
/// impersonando=true), bloqueia qualquer método de escrita (POST, PUT,
/// PATCH, DELETE). Garante que a visualização seja realmente só leitura,
/// sem precisar tocar em cada endpoint individualmente.
///
/// Exceção: o próprio endpoint de sair da visualização precisa aceitar POST.
/// </summary>
public sealed class VisualizacaoSomenteLeituraMiddleware
{
    private readonly RequestDelegate _next;

    public VisualizacaoSomenteLeituraMiddleware(RequestDelegate next) => _next = next;

    public async Task Invoke(HttpContext ctx)
    {
        var visualizando = ctx.User.Identity?.IsAuthenticated == true
            && ctx.User.FindFirstValue("impersonando") == "true";

        if (visualizando)
        {
            var metodo = ctx.Request.Method;
            var ehEscrita = metodo is "POST" or "PUT" or "PATCH" or "DELETE";
            var caminho = ctx.Request.Path.Value ?? "";

            // Permite apenas o endpoint de sair da visualização
            var ehSaida = caminho.EndsWith("/sair-visualizacao", StringComparison.OrdinalIgnoreCase);

            if (ehEscrita && !ehSaida)
            {
                ctx.Response.StatusCode = 403;
                ctx.Response.ContentType = "application/json";
                await ctx.Response.WriteAsJsonAsync(new
                {
                    erro = "Modo de visualização é somente leitura. " +
                           "Saia da visualização para fazer alterações."
                });
                return;
            }
        }

        await _next(ctx);
    }
}
