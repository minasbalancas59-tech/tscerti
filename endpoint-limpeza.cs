
        // ── Limpar certificados de uma empresa (destrutivo, com PIN) ──
        g.MapPost("/empresas/{id:guid}/limpar-certificados", async (Guid id,
            LimparCertsRequest req, ClaimsPrincipal user, NpgsqlDataSource ds, HttpContext ctx) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);

            // valida o PIN destrutivo (guardado na empresa SISTEMA)
            var pinHash = await conn.ExecuteScalarAsync<string?>(
                "SELECT pin_destrutivo_hash FROM empresa WHERE id = '00000000-0000-0000-0000-000000000001'");
            if (string.IsNullOrEmpty(pinHash))
                return Results.BadRequest(new { erro = "PIN destrutivo não configurado. Configure-o antes de usar esta função." });
            if (string.IsNullOrEmpty(req.Pin) || !BCrypt.Net.BCrypt.Verify(req.Pin, pinHash))
                return Results.BadRequest(new { erro = "PIN incorreto." });

            try
            {
                var r = await conn.QuerySingleAsync<(int qtd, string identificacao)>(
                    "SELECT qtd, identificacao FROM sa_limpar_certificados(@id, @uid)",
                    new { id, uid = Tenant.UsuarioId(user) });
                await Auditoria.Registrar(conn, id, Tenant.UsuarioId(user),
                    "certificado", id, "limpeza_certificados",
                    new { r.qtd, r.identificacao }, Auditoria.Ip(ctx));
                return Results.Ok(new { limpo = true, quantidade = r.qtd, backup = r.identificacao });
            }
            catch (PostgresException e)
            {
                return Results.BadRequest(new { erro = e.MessageText });
            }
        });

        // ── Definir/atualizar o PIN destrutivo ──
        g.MapPost("/pin-destrutivo", async (DefinirPinRequest req, ClaimsPrincipal user,
            NpgsqlDataSource ds, HttpContext ctx) =>
        {
            if (!Ok(user)) return Results.Forbid();
            if (string.IsNullOrEmpty(req.NovoPin) || req.NovoPin.Length < 6)
                return Results.BadRequest(new { erro = "O PIN deve ter ao menos 6 caracteres." });
            await using var conn = await Tenant.AbrirConexao(ds, user);
            // se já existe um PIN, exige o atual para trocar
            var atual = await conn.ExecuteScalarAsync<string?>(
                "SELECT pin_destrutivo_hash FROM empresa WHERE id = '00000000-0000-0000-0000-000000000001'");
            if (!string.IsNullOrEmpty(atual) && (string.IsNullOrEmpty(req.PinAtual) || !BCrypt.Net.BCrypt.Verify(req.PinAtual, atual)))
                return Results.BadRequest(new { erro = "PIN atual incorreto." });
            var novoHash = BCrypt.Net.BCrypt.HashPassword(req.NovoPin, 12);
            await conn.ExecuteAsync(
                "UPDATE empresa SET pin_destrutivo_hash = @h WHERE id = '00000000-0000-0000-0000-000000000001'",
                new { h = novoHash });
            await Auditoria.Registrar(conn, null, Tenant.UsuarioId(user),
                "sistema", null, "definir_pin_destrutivo", null, Auditoria.Ip(ctx));
            return Results.Ok(new { definido = true });
        });
