
        // ── Excluir certificado em RASCUNHO (nunca emitidos) ──────
        g.MapDelete("/{id:guid}", async (Guid id, ClaimsPrincipal user,
            NpgsqlDataSource ds, HttpContext ctx) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var ct = await conn.QuerySingleOrDefaultAsync(
                "SELECT status, tecnico_id FROM certificado WHERE id = @id", new { id });
            if (ct is null) return Results.NotFound();
            if ((string)ct.status != "rascunho")
                return Results.BadRequest(new { erro = "Só rascunhos podem ser excluídos. Certificados emitidos são imutáveis." });
            // técnico comum só exclui o próprio rascunho; gestor exclui qualquer
            var papel = Tenant.Papel(user);
            if (papel is not ("admin" or "responsavel_tecnico")
                && (Guid)ct.tecnico_id != Tenant.UsuarioId(user))
                return Results.Forbid();
            // apaga leituras RBC eventualmente salvas + o certificado
            await conn.ExecuteAsync("DELETE FROM leitura_rbc WHERE certificado_id = @id", new { id });
            await conn.ExecuteAsync("DELETE FROM incerteza_ponto_rbc WHERE certificado_id = @id", new { id });
            await conn.ExecuteAsync("DELETE FROM excentricidade_rbc WHERE certificado_id = @id", new { id });
            await conn.ExecuteAsync("DELETE FROM mobilidade_rbc WHERE certificado_id = @id", new { id });
            await conn.ExecuteAsync("DELETE FROM carga_peso_rbc WHERE certificado_id = @id", new { id });
            await conn.ExecuteAsync("DELETE FROM certificado WHERE id = @id AND status = 'rascunho'", new { id });
            await Auditoria.Registrar(conn, Tenant.EmpresaId(user), Tenant.UsuarioId(user),
                "certificado", id, "excluir_rascunho", null, Auditoria.Ip(ctx));
            return Results.Ok(new { excluido = true });
        });

        // ── Assumir um rascunho de outro técnico (continuidade) ───
        g.MapPost("/{id:guid}/assumir", async (Guid id, ClaimsPrincipal user,
            NpgsqlDataSource ds, HttpContext ctx) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var ct = await conn.QuerySingleOrDefaultAsync(
                "SELECT status FROM certificado WHERE id = @id", new { id });
            if (ct is null) return Results.NotFound();
            if ((string)ct.status != "rascunho")
                return Results.BadRequest(new { erro = "Só rascunhos podem ser assumidos." });
            await conn.ExecuteAsync(
                "UPDATE certificado SET tecnico_id = @uid WHERE id = @id AND status = 'rascunho'",
                new { id, uid = Tenant.UsuarioId(user) });
            await Auditoria.Registrar(conn, Tenant.EmpresaId(user), Tenant.UsuarioId(user),
                "certificado", id, "assumir_rascunho", null, Auditoria.Ip(ctx));
            return Results.Ok(new { assumido = true });
        });
