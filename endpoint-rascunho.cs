
        // ── Rascunho em andamento desta balança (qualquer técnico) ──
        g.MapGet("/{id:guid}/rascunho-aberto", async (Guid id, ClaimsPrincipal user,
            NpgsqlDataSource ds) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var r = await conn.QuerySingleOrDefaultAsync("""
                SELECT ct.id, ct.criado_em, ct.emitir_rbc, ct.tecnico_id,
                       u.nome AS tecnico
                  FROM certificado ct
                  JOIN usuario u ON u.id = ct.tecnico_id
                 WHERE ct.balanca_id = @id AND ct.status = 'rascunho'
                 ORDER BY ct.criado_em DESC LIMIT 1
                """, new { id });
            if (r is null) return Results.Ok(new { temRascunho = false });
            return Results.Ok(new {
                temRascunho = true,
                id = (Guid)r.id,
                criadoEm = r.criado_em,
                tecnico = (string)r.tecnico,
                tecnicoId = (Guid)r.tecnico_id,
                emitirRbc = (bool)r.emitir_rbc
            });
        });
