using System.Security.Claims;
using System.Text.Json;
using Dapper;
using Npgsql;

namespace CertSaas.Api.Infra;

/// <summary>
/// O coração do multiempresa: toda conexão de rota autenticada nasce
/// já com o tenant do JWT aplicado via SET app.empresa_id — a partir
/// daí o Row-Level Security do Postgres filtra tudo sozinho.
/// </summary>
public static class Tenant
{
    public static Guid EmpresaId(ClaimsPrincipal user) =>
        Guid.Parse(user.FindFirstValue("empresa_id")
            ?? throw new UnauthorizedAccessException("Token sem empresa."));

    public static Guid UsuarioId(ClaimsPrincipal user) =>
        Guid.Parse(user.FindFirstValue("sub")
            ?? throw new UnauthorizedAccessException("Token sem usuário."));

    public static string Papel(ClaimsPrincipal user) =>
        user.FindFirstValue("papel") ?? "";

    public static bool EhAdmin(ClaimsPrincipal user) => Papel(user) == "admin";
    public static bool EhSuperAdmin(ClaimsPrincipal user) => Papel(user) == "super_admin";
    public static bool EhGestor(ClaimsPrincipal user) =>
        Papel(user) is "admin" or "responsavel_tecnico";

    /// <summary>Gestor sempre pode; técnico depende da permissão no cadastro
    /// (João, 19/08/2026). Só CRIAR — editar/excluir seguem restritos.</summary>
    public static async Task<bool> PodeCriarCliente(NpgsqlConnection conn, ClaimsPrincipal user)
    {
        if (EhGestor(user)) return true;
        return await conn.ExecuteScalarAsync<bool>(
            "SELECT COALESCE(pode_criar_cliente, false) FROM usuario WHERE id = @id",
            new { id = UsuarioId(user) });
    }

    public static async Task<bool> PodeCriarBalanca(NpgsqlConnection conn, ClaimsPrincipal user)
    {
        if (EhGestor(user)) return true;
        return await conn.ExecuteScalarAsync<bool>(
            "SELECT COALESCE(pode_criar_balanca, false) FROM usuario WHERE id = @id",
            new { id = UsuarioId(user) });
    }

    /// <summary>True quando o super-admin está em modo de VISUALIZAÇÃO
    /// (impersonando uma empresa). Nesse modo, só leitura é permitida.</summary>
    public static bool EstaVisualizando(ClaimsPrincipal user) =>
        user.FindFirstValue("impersonando") == "true";

    /// <summary>Bloqueia escritas durante a visualização. Chame no início de
    /// qualquer endpoint que altere dados. Lança se estiver visualizando.</summary>
    public static void GarantirNaoVisualizando(ClaimsPrincipal user)
    {
        if (EstaVisualizando(user))
            throw new VisualizacaoSomenteLeituraException();
    }

    public static async Task<NpgsqlConnection> AbrirConexao(
        NpgsqlDataSource ds, ClaimsPrincipal user)
    {
        var conn = await ds.OpenConnectionAsync();
        await conn.ExecuteAsync(
            "SELECT set_config('app.empresa_id', @id, false)",
            new { id = EmpresaId(user).ToString() });
        return conn;
    }
}

public static class Auditoria
{
    public static async Task Registrar(NpgsqlConnection conn, Guid? empresaId,
        Guid? usuarioId, string entidade, Guid? entidadeId, string acao,
        object? depois, string? ip)
    {
        await conn.ExecuteAsync("""
            INSERT INTO log_auditoria
                (empresa_id, usuario_id, entidade, entidade_id, acao, dados_depois, ip_origem)
            VALUES (@empresaId, @usuarioId, @entidade, @entidadeId, @acao,
                    @depois::jsonb, @ip)
            """,
            new
            {
                empresaId, usuarioId, entidade, entidadeId, acao,
                depois = depois is null ? null : JsonSerializer.Serialize(depois),
                ip
            });
    }

    /// <summary>IP real do cliente (o nginx repassa em X-Forwarded-For).</summary>
    public static string? Ip(HttpContext ctx) =>
        ctx.Request.Headers["X-Forwarded-For"].FirstOrDefault()?.Split(',')[0].Trim()
        ?? ctx.Connection.RemoteIpAddress?.ToString();
}

public static class Cnpj
{
    /// <summary>Valida os dígitos verificadores. Aceita com ou sem máscara.</summary>
    public static bool Valido(string? cnpj)
    {
        if (string.IsNullOrWhiteSpace(cnpj)) return false;
        var d = new string(cnpj.Where(char.IsDigit).ToArray());
        if (d.Length != 14 || d.Distinct().Count() == 1) return false;

        int Calc(int tamanho)
        {
            int[] pesos = tamanho == 12
                ? new[] { 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2 }
                : new[] { 6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2 };
            var soma = pesos.Select((p, i) => p * (d[i] - '0')).Sum();
            var resto = soma % 11;
            return resto < 2 ? 0 : 11 - resto;
        }

        return Calc(12) == d[12] - '0' && Calc(13) == d[13] - '0';
    }

    public static string SoDigitos(string cnpj) =>
        new(cnpj.Where(char.IsDigit).ToArray());

    /// <summary>Limpa máscara mas PRESERVA letras (CNPJ alfanumérico 2026)
    /// e serve para CPF. Remove só pontos, barras, hífens e espaços.</summary>
    public static string LimparDoc(string doc) =>
        new(doc.Where(char.IsLetterOrDigit).ToArray());
}

/// <summary>Lançada quando o super-admin em modo de visualização tenta
/// alterar dados. O modo visualização é somente-leitura.</summary>
public sealed class VisualizacaoSomenteLeituraException : Exception
{
    public VisualizacaoSomenteLeituraException()
        : base("Modo de visualização é somente leitura. Saia da visualização para editar.") { }
}
