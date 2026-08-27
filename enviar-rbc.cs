
        // ── Enviar o certificado RBC para aprovação ───────────────
        app.MapPost("/api/certificados/{id:guid}/enviar-rbc", async (Guid id,
            EnviarRbcRequest req, ClaimsPrincipal user, NpgsqlDataSource ds, HttpContext ctx) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var ct = await conn.QuerySingleOrDefaultAsync(
                "SELECT status, tecnico_id, emitir_rbc FROM certificado WHERE id = @id", new { id });
            if (ct is null) return Results.NotFound();
            var papel = Tenant.Papel(user);
            var ehGestor = papel is "admin" or "responsavel_tecnico";
            if (!ehGestor && (Guid)ct.tecnico_id != Tenant.UsuarioId(user))
                return Results.Forbid();
            if (!(bool)ct.emitir_rbc)
                return Results.BadRequest(new { erro = "Este certificado não é RBC." });
            if ((string)ct.status != "rascunho"
                && !((string)ct.status == "aguardando_aprovacao" && ehGestor))
                return Results.Conflict(new { erro = "Só rascunhos podem ser enviados." });
            if (string.IsNullOrEmpty(req.DataCalibracao) ||
                !DateOnly.TryParse(req.DataCalibracao, out var dataCal))
                return Results.BadRequest(new { erro = "Data da calibração é obrigatória." });

            // A coleta precisa existir e a incerteza estar calculada
            var temLeituras = await conn.ExecuteScalarAsync<bool>(
                "SELECT EXISTS(SELECT 1 FROM leitura_rbc WHERE certificado_id = @id)", new { id });
            if (!temLeituras)
                return Results.BadRequest(new { erro = "Salve a coleta antes de enviar (não há leituras)." });
            var temOrcamento = await conn.ExecuteScalarAsync<bool>(
                "SELECT EXISTS(SELECT 1 FROM incerteza_ponto_rbc WHERE certificado_id = @id)", new { id });
            if (!temOrcamento)
                return Results.BadRequest(new { erro = "Use 'Salvar e calcular' antes de enviar (a incerteza não foi calculada)." });
            // Rastreabilidade: cada ponto de carga precisa ter pesos vinculados
            var pontoSemPeso = await conn.ExecuteScalarAsync<int?>("""
                SELECT i.ordem_ponto FROM incerteza_ponto_rbc i
                 WHERE i.certificado_id = @id
                   AND NOT EXISTS (SELECT 1 FROM carga_peso_rbc w
                                    WHERE w.certificado_id = @id AND w.ordem_ponto = i.ordem_ponto)
                 ORDER BY i.ordem_ponto LIMIT 1
                """, new { id });
            if (pontoSemPeso is not null)
                return Results.BadRequest(new { erro =
                    $"O ponto de carga nº {pontoSemPeso} não tem pesos vinculados. Use 'escolher pesos' (rastreabilidade)." });

            await conn.ExecuteAsync("""
                UPDATE certificado
                   SET status = 'aguardando_aprovacao',
                       data_calibracao = @dataCal,
                       temperatura = @temp, umidade = @umid, pressao = @press,
                       local_tipo = @localTipo
                 WHERE id = @id
                """, new { id, dataCal,
                    temp = req.Temperatura, umid = req.Umidade, press = req.Pressao,
                    localTipo = req.LocalTipo is "laboratorio" ? "laboratorio" : "in_loco" });

            await Auditoria.Registrar(conn, Tenant.EmpresaId(user), Tenant.UsuarioId(user),
                "certificado", id, "enviar_aprovacao", null, Auditoria.Ip(ctx));
            return Results.Ok(new { id, status = "aguardando_aprovacao" });
        }).RequireAuthorization();
