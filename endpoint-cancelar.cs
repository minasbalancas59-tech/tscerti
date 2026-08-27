
        // ── Cancelar certificado (emitido ou aguardando) ──────────
        // O registro PERMANECE; a validação pública passa a informar
        // que foi cancelado (protege quem recebeu o documento).
        g.MapPost("/{id:guid}/cancelar", async (Guid id, CancelarCertRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds, HttpContext ctx) =>
        {
            var papel = Tenant.Papel(user);
            if (papel is not ("admin" or "responsavel_tecnico"))
                return Results.Forbid();
            if (string.IsNullOrWhiteSpace(req.Motivo) || req.Motivo.Trim().Length < 10)
                return Results.BadRequest(new { erro =
                    "Descreva o motivo do cancelamento (mínimo 10 caracteres) — ele fica registrado e é exibido na validação pública." });
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var r = await conn.ExecuteScalarAsync<string>(
                "SELECT cancelar_certificado(@id, @uid, @motivo)",
                new { id, uid = Tenant.UsuarioId(user), motivo = req.Motivo });
            if (r != "ok")
                return Results.BadRequest(new { erro = r switch {
                    "nao_encontrado" => "Certificado não encontrado.",
                    "ja_cancelado" => "Este certificado já está cancelado.",
                    "status_invalido" => "Só certificados emitidos ou aguardando aprovação podem ser cancelados.",
                    "motivo_obrigatorio" => "Informe o motivo do cancelamento.",
                    _ => "Não foi possível cancelar." } });
            await Auditoria.Registrar(conn, Tenant.EmpresaId(user), Tenant.UsuarioId(user),
                "certificado", id, "cancelar", new { req.Motivo }, Auditoria.Ip(ctx));
            return Results.Ok(new { cancelado = true });
        });
