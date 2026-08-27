
        // ── Última calibração desta balança (para o aviso de recente) ──
        g.MapGet("/{id:guid}/ultima-calibracao", async (Guid id, ClaimsPrincipal user,
            NpgsqlDataSource ds) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var ult = await conn.QuerySingleOrDefaultAsync("""
                SELECT ct.numero, ct.data_calibracao, ct.data_emissao,
                       (CURRENT_DATE - ct.data_calibracao) AS dias
                  FROM certificado ct
                 WHERE ct.balanca_id = @id AND ct.status = 'emitido'
                   AND ct.data_calibracao IS NOT NULL
                 ORDER BY ct.data_calibracao DESC LIMIT 1
                """, new { id });
            if (ult is null) return Results.Ok(new { temRecente = false });
            int dias = (int)(ult.dias ?? 9999);
            return Results.Ok(new {
                temRecente = dias >= 0 && dias <= 30,
                dias,
                numero = (string?)ult.numero,
                dataCalibracao = ult.data_calibracao
            });
        });
