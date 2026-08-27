using System.Text;
using CertSaas.Api.Auth;
using CertSaas.Api.Balancas;
using CertSaas.Api.Certificados;
using CertSaas.Api.Clientes;
using CertSaas.Api.Empresas;
using CertSaas.Api.Infra;
using CertSaas.Api.Pesos;
using CertSaas.Api.Portal;
using CertSaas.Api.Sistema;
using CertSaas.Api.Usuarios;
using Dapper;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using Npgsql;

Dapper.DefaultTypeMap.MatchNamesWithUnderscores = true;
Dapper.SqlMapper.AddTypeHandler(new CertSaas.Api.Infra.DateOnlyHandler());
Dapper.SqlMapper.AddTypeHandler(new CertSaas.Api.Infra.DateOnlyNullableHandler());

var builder = WebApplication.CreateBuilder(args);

// Licença do QuestPDF (community) — necessária para gerar PDFs de relatórios
QuestPDF.Settings.License = QuestPDF.Infrastructure.LicenseType.Community;

var connString = builder.Configuration.GetConnectionString("Default")
    ?? throw new InvalidOperationException("ConnectionStrings__Default não configurada.");
builder.Services.AddNpgsqlDataSource(connString);

var jwtSecret = builder.Configuration["Jwt:Secret"]
    ?? throw new InvalidOperationException("Jwt__Secret não configurada.");

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        o.MapInboundClaims = false;   // mantém os nomes de claim originais (sub, papel...)
        o.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = builder.Configuration["Jwt:Issuer"],
            ValidateAudience = false,
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromMinutes(1),
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret))
        };
    });
builder.Services.AddAuthorization(options =>
{
    // Portal do cliente final: exige um token com tipo=cliente
    options.AddPolicy("portal", policy =>
        policy.RequireClaim("tipo", "cliente"));
});
builder.Services.AddSingleton<TokenService>();
builder.Services.AddSingleton<StackExchange.Redis.IConnectionMultiplexer>(_ =>
    StackExchange.Redis.ConnectionMultiplexer.Connect(
        builder.Configuration["Redis:Connection"] ?? "redis:6379"));

var app = builder.Build();

// Captura de exceções não-tratadas (grava em erro_sistema) — primeiro no pipeline
app.UseMiddleware<CertSaas.Api.Infra.ErroMiddleware>();

// ── Cada subdomínio serve o SEU aplicativo ───────────────────
// portalclientes.*  → portal do cliente final (portal.html)
// demais domínios   → aplicação das empresas (index.html)
// Os arquivos são os mesmos no disco; o que muda é o que cada domínio
// entrega na raiz. A separação de acesso continua no login: o token do
// portal exige tipo=cliente e não abre o app das empresas (e vice-versa).
static bool EhDominioPortal(HttpContext c) =>
    c.Request.Host.Host.StartsWith("portalclientes", StringComparison.OrdinalIgnoreCase);

app.Use(async (ctx, next) =>
{
    var caminho = ctx.Request.Path.Value ?? "/";
    if (EhDominioPortal(ctx))
    {
        // raiz do portal abre o portal, não a tela das empresas
        if (caminho == "/" || caminho.Equals("/index.html", StringComparison.OrdinalIgnoreCase))
            ctx.Request.Path = "/portal.html";
    }
    await next();
});

app.UseDefaultFiles();
app.UseStaticFiles();

app.UseAuthentication();
app.UseAuthorization();

// Sessão única: invalida o token se um login mais recente o substituiu
app.UseMiddleware<CertSaas.Api.Infra.SessaoUnicaMiddleware>();

// Modo visualização (super-admin): bloqueia escritas (somente leitura)
app.UseMiddleware<CertSaas.Api.Infra.VisualizacaoSomenteLeituraMiddleware>();

app.MapGet("/health", async (NpgsqlDataSource db) =>
{
    await using var conn = await db.OpenConnectionAsync();
    var ok = await conn.ExecuteScalarAsync<int>("SELECT 1");
    return Results.Ok(new { status = "ok", db = ok == 1 });
});

// Módulos por domínio
AuthEndpoints.Map(app);
ClienteEndpoints.Map(app);
BalancaEndpoints.Map(app);
TipoBalancaEndpoints.Map(app);
EmpresaConfigEndpoints.Map(app);
AvisoVencimentoEndpoints.Map(app);
CertSaas.Api.Pesquisa.PesquisaEndpoints.Map(app);
SistemaEndpoints.Map(app);
SuperAdminEndpoints.Map(app);
ChamadoEndpoints.Map(app);
ClientePortalEndpoints.Map(app);
PesoEndpoints.Map(app);
PesoPdfEndpoints.Map(app);
UsuarioEndpoints.Map(app);
CertificadoEndpoints.Map(app);
RbcEndpoints.Map(app);
FotoEndpoints.Map(app);
EdicaoManualEndpoints.Map(app);
AprovacaoEndpoints.Map(app);
ValidacaoPublicaEndpoints.Map(app);
PdfDownloadEndpoints.Map(app);

// SPA: qualquer rota não-API cai no index.html
app.MapGet("/validar/{uuid}", () => Results.File(
    Path.Combine(app.Environment.WebRootPath, "validar.html"), "text/html"));
// SPA por domínio: rota desconhecida cai no app correspondente
app.MapFallback(async ctx =>
{
    var arquivo = EhDominioPortal(ctx) ? "portal.html" : "index.html";
    ctx.Response.ContentType = "text/html; charset=utf-8";
    await ctx.Response.SendFileAsync(
        Path.Combine(app.Environment.WebRootPath, arquivo));
});

// Página da pesquisa do TSCert (produto), acessada pelo token do convite
app.MapGet("/pesquisa-tscert/{token}", (string token) =>
    Results.File(Path.Combine(app.Environment.ContentRootPath, "wwwroot", "psaas.html"), "text/html"));

app.Run();
