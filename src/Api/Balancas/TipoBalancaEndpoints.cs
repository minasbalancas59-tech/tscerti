using System.Security.Claims;
using CertSaas.Api.Infra;
using Dapper;
using Npgsql;

namespace CertSaas.Api.Balancas;

public record TipoBalancaRequest(string Nome);

public static class TipoBalancaEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/tipos-balanca").RequireAuthorization();

        g.MapGet("/", async (ClaimsPrincipal user, NpgsqlDataSource ds,
            bool? incluirInativos) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var rows = await conn.QueryAsync("""
                SELECT id, nome, ativo FROM tipo_balanca
                 WHERE (COALESCE(@incluirInativos,false) OR ativo)
                 ORDER BY nome
                """, new { incluirInativos });
            return Results.Ok(rows);
        });

        g.MapPost("/", async (TipoBalancaRequest req, ClaimsPrincipal user,
            NpgsqlDataSource ds, HttpContext ctx) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            if (string.IsNullOrWhiteSpace(req.Nome))
                return Results.BadRequest(new { erro = "Nome é obrigatório." });
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var empresaId = Tenant.EmpresaId(user);
            try
            {
                var id = await conn.ExecuteScalarAsync<Guid>("""
                    INSERT INTO tipo_balanca (empresa_id, nome)
                    VALUES (@empresaId, @Nome) RETURNING id
                    """, new { empresaId, Nome = req.Nome.Trim() });
                await Auditoria.Registrar(conn, empresaId, Tenant.UsuarioId(user),
                    "tipo_balanca", id, "insert", req, Auditoria.Ip(ctx));
                return Results.Created($"/api/tipos-balanca/{id}", new { id });
            }
            catch (PostgresException e) when (e.SqlState == "23505")
            {
                return Results.Conflict(new { erro = "Já existe um tipo com esse nome." });
            }
        });

        g.MapPut("/{id:guid}", async (Guid id, TipoBalancaRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            if (string.IsNullOrWhiteSpace(req.Nome))
                return Results.BadRequest(new { erro = "Nome é obrigatório." });
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var n = await conn.ExecuteAsync(
                "UPDATE tipo_balanca SET nome=@Nome WHERE id=@id",
                new { id, Nome = req.Nome.Trim() });
            return n == 0 ? Results.NotFound() : Results.Ok(new { id });
        });

        g.MapPut("/{id:guid}/ativo", async (Guid id, Clientes.AtivoRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var n = await conn.ExecuteAsync(
                "UPDATE tipo_balanca SET ativo=@ativo WHERE id=@id",
                new { id, ativo = req.Ativo });
            return n == 0 ? Results.NotFound() : Results.Ok(new { id, req.Ativo });
        });
    }
}
