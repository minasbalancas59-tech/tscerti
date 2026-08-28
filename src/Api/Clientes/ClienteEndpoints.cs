using System.Security.Claims;
using CertSaas.Api.Infra;
using Dapper;
using Npgsql;

namespace CertSaas.Api.Clientes;

public record ClienteRequest(string RazaoSocial, string? Cnpj, string? Email,
    string? Telefone, string? Endereco, string? Cidade, string? Uf,
    string? NomeFantasia, string? Cep, string? TipoPessoa);

public record EnderecoRequest(string Apelido, string? Endereco, string? Cidade,
    string? Uf, string? Cep, string? Observacao);

public record ContatoRequest(string Nome, string? Cargo, string? Telefone,
    string? Email, string? Observacao, bool RecebeCertificado = false);

public static class ClienteEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/clientes").RequireAuthorization();
        // ── Contatos do cliente (CRUD) ────────────────────────────
        // ── Endereços do cliente (matriz + filiais/plantas) ──────
        // O endereço do cadastro continua sendo o principal; aqui ficam os
        // ADICIONAIS, para escolher onde a calibração foi feita.
        g.MapGet("/{id:guid}/enderecos", async (Guid id, ClaimsPrincipal user,
            NpgsqlDataSource ds) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            return Results.Ok(await conn.QueryAsync(
                "SELECT * FROM cliente_enderecos(@id)", new { id }));
        });

        g.MapPost("/{id:guid}/enderecos", async (Guid id, EnderecoRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds, HttpContext ctx) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            if (string.IsNullOrWhiteSpace(req.Apelido))
                return Results.BadRequest(new
                { erro = "Dê um nome ao endereço (ex.: Filial Betim, Planta 2)." });
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var novoId = await conn.ExecuteScalarAsync<Guid>("""
                INSERT INTO cliente_endereco (empresa_id, cliente_id, apelido,
                                              endereco, cidade, uf, cep, observacao)
                VALUES (current_empresa_id(), @id, @Apelido, @Endereco, @Cidade,
                        NULLIF(upper(@Uf), ''), @Cep, @Observacao)
                RETURNING id
                """, new { id, req.Apelido, req.Endereco, req.Cidade, req.Uf,
                           req.Cep, req.Observacao });
            await Auditoria.Registrar(conn, Tenant.EmpresaId(user), Tenant.UsuarioId(user),
                "cliente_endereco", novoId, "insert", req, Auditoria.Ip(ctx));
            return Results.Created($"/api/clientes/{id}/enderecos/{novoId}", new { id = novoId });
        });

        g.MapPut("/enderecos/{eid:guid}", async (Guid eid, EnderecoRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds, HttpContext ctx) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            await conn.ExecuteAsync("""
                UPDATE cliente_endereco
                   SET apelido = @Apelido, endereco = @Endereco, cidade = @Cidade,
                       uf = NULLIF(upper(@Uf), ''), cep = @Cep, observacao = @Observacao
                 WHERE id = @eid
                """, new { eid, req.Apelido, req.Endereco, req.Cidade, req.Uf,
                           req.Cep, req.Observacao });
            await Auditoria.Registrar(conn, Tenant.EmpresaId(user), Tenant.UsuarioId(user),
                "cliente_endereco", eid, "update", req, Auditoria.Ip(ctx));
            return Results.Ok(new { atualizado = true });
        });

        g.MapDelete("/enderecos/{eid:guid}", async (Guid eid, ClaimsPrincipal user,
            NpgsqlDataSource ds, HttpContext ctx) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            // desativa em vez de apagar: certificados antigos referenciam o id
            await conn.ExecuteAsync(
                "UPDATE cliente_endereco SET ativo = false WHERE id = @eid", new { eid });
            await Auditoria.Registrar(conn, Tenant.EmpresaId(user), Tenant.UsuarioId(user),
                "cliente_endereco", eid, "delete", null, Auditoria.Ip(ctx));
            return Results.Ok(new { removido = true });
        });

        g.MapGet("/{id:guid}/contatos", async (Guid id, ClaimsPrincipal user,
            NpgsqlDataSource ds) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            return Results.Ok(await conn.QueryAsync("""
                SELECT recebe_certificado, id, nome, cargo, telefone, email, observacao
                  FROM cliente_contato WHERE cliente_id = @id
                 ORDER BY nome
                """, new { id }));
        });

        g.MapPost("/{id:guid}/contatos", async (Guid id, ContatoRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds, HttpContext ctx) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            if (string.IsNullOrWhiteSpace(req.Nome))
                return Results.BadRequest(new { erro = "Informe o nome do contato." });
            if (CertSaas.Api.Infra.Email.Erro(req.Email) is { } erroC)
                return Results.BadRequest(new { erro = erroC });
            if (req.RecebeCertificado && string.IsNullOrWhiteSpace(req.Email))
                return Results.BadRequest(new { erro =
                    "Contato marcado para receber certificados precisa de e-mail." });
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var novoId = await conn.ExecuteScalarAsync<Guid>("""
                INSERT INTO cliente_contato (empresa_id, cliente_id, nome, cargo,
                                             telefone, email, observacao, recebe_certificado)
                VALUES (current_empresa_id(), @id, @Nome, @Cargo, @Telefone, @Email, @Observacao, @RecebeCertificado)
                RETURNING id
                """, new { id, req.Nome, req.Cargo, req.Telefone,
                          Email = CertSaas.Api.Infra.Email.Limpar(req.Email), req.Observacao, req.RecebeCertificado });
            await Auditoria.Registrar(conn, Tenant.EmpresaId(user), Tenant.UsuarioId(user),
                "cliente_contato", novoId, "insert", req, Auditoria.Ip(ctx));
            return Results.Created($"/api/clientes/{id}/contatos/{novoId}", new { id = novoId });
        });

        g.MapPut("/contatos/{cid:guid}", async (Guid cid, ContatoRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds, HttpContext ctx) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            if (string.IsNullOrWhiteSpace(req.Nome))
                return Results.BadRequest(new { erro = "Informe o nome do contato." });
            if (CertSaas.Api.Infra.Email.Erro(req.Email) is { } erroC)
                return Results.BadRequest(new { erro = erroC });
            if (req.RecebeCertificado && string.IsNullOrWhiteSpace(req.Email))
                return Results.BadRequest(new { erro =
                    "Contato marcado para receber certificados precisa de e-mail." });
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var n = await conn.ExecuteAsync("""
                UPDATE cliente_contato
                   SET nome = @Nome, cargo = @Cargo, telefone = @Telefone,
                       email = @Email, observacao = @Observacao,
                       recebe_certificado = @RecebeCertificado
                 WHERE id = @cid
                """, new { cid, req.Nome, req.Cargo, req.Telefone,
                          Email = CertSaas.Api.Infra.Email.Limpar(req.Email), req.Observacao, req.RecebeCertificado });
            if (n == 0) return Results.NotFound();
            await Auditoria.Registrar(conn, Tenant.EmpresaId(user), Tenant.UsuarioId(user),
                "cliente_contato", cid, "update", req, Auditoria.Ip(ctx));
            return Results.Ok(new { salvo = true });
        });

        g.MapDelete("/contatos/{cid:guid}", async (Guid cid, ClaimsPrincipal user,
            NpgsqlDataSource ds, HttpContext ctx) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var n = await conn.ExecuteAsync("DELETE FROM cliente_contato WHERE id = @cid", new { cid });
            if (n == 0) return Results.NotFound();
            await Auditoria.Registrar(conn, Tenant.EmpresaId(user), Tenant.UsuarioId(user),
                "cliente_contato", cid, "delete", null, Auditoria.Ip(ctx));
            return Results.Ok(new { excluido = true });
        });


        g.MapGet("/", async (ClaimsPrincipal user, NpgsqlDataSource ds,
            string? busca, bool? incluirInativos) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            // Técnico vê apenas nome e CNPJ; gestores veem tudo
            var colunas = Tenant.EhGestor(user)
                ? "id, razao_social, nome_fantasia, cnpj, email, telefone, cidade, uf, cep, endereco, tipo_pessoa, ativo"
                : "id, razao_social, nome_fantasia, cnpj, cidade, uf, endereco, tipo_pessoa, ativo";
            var rows = await conn.QueryAsync($"""
                SELECT {colunas}
                  FROM cliente
                 WHERE (@busca IS NULL OR razao_social ILIKE '%'||@busca||'%'
                                       OR nome_fantasia ILIKE '%'||@busca||'%'
                                       OR cnpj LIKE '%'||@busca||'%')
                   AND (COALESCE(@incluirInativos,false) OR ativo)
                 ORDER BY razao_social
                """, new { busca, incluirInativos });
            return Results.Ok(rows);
        });

        g.MapGet("/{id:guid}", async (Guid id, ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var colunas = Tenant.EhGestor(user)
                ? "*" : "id, razao_social, cnpj, ativo";
            var c = await conn.QuerySingleOrDefaultAsync(
                $"SELECT {colunas} FROM cliente WHERE id = @id", new { id });
            return c is null ? Results.NotFound() : Results.Ok(c);
        });

        g.MapPost("/", async (ClienteRequest req, ClaimsPrincipal user,
            NpgsqlDataSource ds, HttpContext ctx) =>
        {
            // gestor OU técnico com permissão de criar cliente
            var erro = Validar(req);
            if (erro is not null) return Results.BadRequest(new { erro });

            await using var conn = await Tenant.AbrirConexao(ds, user);
            if (!await Tenant.PodeCriarCliente(conn, user)) return Results.Forbid();
            var empresaId = Tenant.EmpresaId(user);
            try
            {
                var id = await conn.ExecuteScalarAsync<Guid>("""
                    INSERT INTO cliente (empresa_id, razao_social, nome_fantasia, cnpj, email,
                                         telefone, endereco, cidade, uf, cep, tipo_pessoa)
                    VALUES (@empresaId, @RazaoSocial, @NomeFantasia, @cnpj, @Email,
                            @Telefone, @Endereco, @Cidade, @Uf, @Cep, @TipoPessoa)
                    RETURNING id
                    """,
                    new { empresaId, req.RazaoSocial, req.NomeFantasia,
                          cnpj = req.Cnpj is null ? null : Cnpj.LimparDoc(req.Cnpj),
                          Email = CertSaas.Api.Infra.Email.Limpar(req.Email), req.Telefone, req.Endereco, req.Cidade,
                          Uf = req.Uf?.ToUpperInvariant(), req.Cep,
                          TipoPessoa = req.TipoPessoa ?? "PJ" });

                await Auditoria.Registrar(conn, empresaId, Tenant.UsuarioId(user),
                    "cliente", id, "insert", req, Auditoria.Ip(ctx));
                return Results.Created($"/api/clientes/{id}", new { id });
            }
            catch (PostgresException e) when (e.SqlState == "23505")
            {
                return Results.Conflict(new { erro = "Já existe cliente com esse CNPJ." });
            }
        });

        g.MapPut("/{id:guid}", async (Guid id, ClienteRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds, HttpContext ctx) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            var erro = Validar(req);
            if (erro is not null) return Results.BadRequest(new { erro });

            await using var conn = await Tenant.AbrirConexao(ds, user);
            var n = await conn.ExecuteAsync("""
                UPDATE cliente
                   SET razao_social = @RazaoSocial, nome_fantasia = @NomeFantasia,
                       cnpj = @cnpj, email = @Email,
                       telefone = @Telefone, endereco = @Endereco,
                       cidade = @Cidade, uf = @Uf, cep = @Cep, tipo_pessoa = @TipoPessoa
                 WHERE id = @id
                """,
                new { id, req.RazaoSocial, req.NomeFantasia,
                      cnpj = req.Cnpj is null ? null : Cnpj.LimparDoc(req.Cnpj),
                      Email = CertSaas.Api.Infra.Email.Limpar(req.Email), req.Telefone, req.Endereco, req.Cidade,
                      Uf = req.Uf?.ToUpperInvariant(), req.Cep,
                      TipoPessoa = req.TipoPessoa ?? "PJ" });
            if (n == 0) return Results.NotFound();

            await Auditoria.Registrar(conn, Tenant.EmpresaId(user),
                Tenant.UsuarioId(user), "cliente", id, "update", req, Auditoria.Ip(ctx));
            return Results.Ok(new { id });
        });

        g.MapPut("/{id:guid}/ativo", async (Guid id, AtivoRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds, HttpContext ctx) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var n = await conn.ExecuteAsync(
                "UPDATE cliente SET ativo = @ativo WHERE id = @id",
                new { id, ativo = req.Ativo });
            if (n == 0) return Results.NotFound();

            await Auditoria.Registrar(conn, Tenant.EmpresaId(user),
                Tenant.UsuarioId(user), "cliente", id,
                req.Ativo ? "reativar" : "inativar", null, Auditoria.Ip(ctx));
            return Results.Ok(new { id, req.Ativo });
        });
    }

    private static string? Validar(ClienteRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.RazaoSocial))
            return "Razão social é obrigatória.";
        // Só valida dígitos verificadores de CNPJ quando é PJ e o documento
        // é 100% numérico (14 díg). PF (CPF) e CNPJ alfanumérico passam livres.
        if ((req.TipoPessoa ?? "PJ") == "PJ" && !string.IsNullOrWhiteSpace(req.Cnpj))
        {
            var doc = Cnpj.LimparDoc(req.Cnpj);
            var soNumeros = doc.All(char.IsDigit);
            if (soNumeros && doc.Length == 14 && !Cnpj.Valido(req.Cnpj))
                return "CNPJ inválido.";
        }
        if (req.Uf is { Length: > 0 } && req.Uf.Length != 2)
            return "UF deve ter 2 letras.";
        // E-mail: é por ele que o certificado é enviado ao cliente, então o
        // erro precisa aparecer aqui, e não na hora do envio.
        if (CertSaas.Api.Infra.Email.Erro(req.Email) is { } erroEmail) return erroEmail;
        return null;
    }
}

public record AtivoRequest(bool Ativo);
