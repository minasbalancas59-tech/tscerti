
        // ── Contatos do cliente (CRUD) ────────────────────────────
        g.MapGet("/{id:guid}/contatos", async (Guid id, ClaimsPrincipal user,
            NpgsqlDataSource ds) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            return Results.Ok(await conn.QueryAsync("""
                SELECT id, nome, cargo, telefone, email, observacao
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
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var novoId = await conn.ExecuteScalarAsync<Guid>("""
                INSERT INTO cliente_contato (empresa_id, cliente_id, nome, cargo,
                                             telefone, email, observacao)
                VALUES (current_empresa_id(), @id, @Nome, @Cargo, @Telefone, @Email, @Observacao)
                RETURNING id
                """, new { id, req.Nome, req.Cargo, req.Telefone, req.Email, req.Observacao });
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
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var n = await conn.ExecuteAsync("""
                UPDATE cliente_contato
                   SET nome = @Nome, cargo = @Cargo, telefone = @Telefone,
                       email = @Email, observacao = @Observacao
                 WHERE id = @cid
                """, new { cid, req.Nome, req.Cargo, req.Telefone, req.Email, req.Observacao });
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
