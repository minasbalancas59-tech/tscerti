
        // ── Prévia do PDF antes de aprovar (marca "AGUARDANDO APROVAÇÃO") ──
        app.MapPost("/api/certificados/{id:guid}/previa-aprovacao", async (Guid id,
            ClaimsPrincipal user, NpgsqlDataSource ds, IConnectionMultiplexer redis) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var st = await conn.ExecuteScalarAsync<string?>(
                "SELECT status FROM certificado WHERE id = @id", new { id });
            if (st is null) return Results.NotFound();
            if (st != "aguardando_aprovacao")
                return Results.BadRequest(new { erro = "A prévia é para certificados aguardando aprovação." });
            var token = Guid.NewGuid().ToString("N")[..8];
            await redis.GetDatabase().ListLeftPushAsync("fila:tarefas",
                System.Text.Json.JsonSerializer.Serialize(new {
                    tipo = "preview_aprovacao", certificado_id = id.ToString(), token }));
            return Results.Ok(new { gerando = true, token });
        }).RequireAuthorization();

        // Serve a prévia gerada (mesmo padrão do preview de modelo)
        app.MapGet("/api/certificados/previa-aprovacao", async (string token,
            ClaimsPrincipal user, NpgsqlDataSource ds, IConfiguration cfg) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var empresa = await conn.ExecuteScalarAsync<string>(
                "SELECT razao_social FROM empresa WHERE id = current_empresa_id()");
            var chave = $"previews/{empresa?.Replace("/", "-")}-{token}-preview.pdf";
            var bucket = cfg["S3:Bucket"] ?? "certificados";
            return await ServirS3($"s3://{bucket}/{chave}", cfg, "previa-certificado.pdf");
        }).RequireAuthorization();
