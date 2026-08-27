
        // ── Editar usuário (super-admin) ──────────────────────────
        g.MapPut("/usuarios/{id:guid}", async (Guid id, EditarUsuarioSaRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds, HttpContext ctx) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var r = await conn.ExecuteScalarAsync<string>(
                "SELECT sa_editar_usuario(@id, @Nome, @Email, @Papel, @Registro)",
                new { id, req.Nome, req.Email, req.Papel, req.Registro });
            if (r != "ok")
                return Results.BadRequest(new { erro = r switch {
                    "nao_encontrado" => "Usuário não encontrado.",
                    "papel_invalido" => "Papel inválido.",
                    "ultimo_admin" => "Este é o único administrador ativo da empresa; promova outro antes de mudar o papel.",
                    "email_em_uso" => "Já existe outro usuário com este e-mail.",
                    _ => "Não foi possível editar." } });
            await Auditoria.Registrar(conn, null, Tenant.UsuarioId(user),
                "usuario", id, "editar_super_admin", req, Auditoria.Ip(ctx));
            return Results.Ok(new { editado = true });
        });
