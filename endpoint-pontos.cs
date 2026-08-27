        // ── Todos os pontos de peso da empresa (para composição RBC) ──
        g.MapGet("/pontos-rbc-todos", async (ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var rows = await conn.QueryAsync("""
                SELECT ppr.id, ppr.ordem, ppr.valor_nominal, ppr.valor_convencional,
                       ppr.incerteza, ppr.k,
                       pp.identificacao AS peso_identificacao,
                       pp.num_certificado
                  FROM peso_ponto_rbc ppr
                  JOIN peso_padrao pp ON pp.id = ppr.peso_padrao_id
                 WHERE pp.ativo = true
                 ORDER BY pp.identificacao, ppr.ordem
                """);
            return Results.Ok(rows);
        });
