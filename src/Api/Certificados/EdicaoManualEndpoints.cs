using System.Security.Claims;
using System.Text.Json;
using CertSaas.Api.Infra;
using Dapper;
using Npgsql;

namespace CertSaas.Api.Certificados;

/// <summary>
/// Edição manual de certificados por admin / responsável técnico.
/// Permite ajustar diretamente os valores dos ensaios e campos do
/// certificado (inclusive sobrescrever erro/incerteza calculados),
/// para corrigir casos específicos antes de aprovar. Registra a
/// edição na auditoria. Só admin e RT têm acesso.
///
/// IMPORTANTE: este caminho grava os valores EXATAMENTE como enviados
/// (modo override) — ao contrário do fluxo normal, que recalcula tudo.
/// Por isso é restrito a admin/RT e sempre auditado.
/// </summary>
public static class EdicaoManualEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/certificados").RequireAuthorization();

        // Carrega o certificado com TODOS os ensaios para edição
        g.MapGet("/{id:guid}/edicao-manual", async (Guid id, ClaimsPrincipal user,
            NpgsqlDataSource ds) =>
        {
            var papel = Tenant.Papel(user);
            if (papel is not ("admin" or "responsavel_tecnico"))
                return Results.Forbid();

            await using var conn = await Tenant.AbrirConexao(ds, user);
            var ct = await conn.QuerySingleOrDefaultAsync("""
                SELECT ct.id, ct.status, ct.numero, ct.data_calibracao,
                       ct.temperatura, ct.umidade, ct.pressao, ct.incerteza_k, ct.observacao,
                       ct.editado_manualmente,
                       c.razao_social AS cliente, b.identificacao AS balanca,
                       b.num_serie
                  FROM certificado ct
                  JOIN cliente c ON c.id = ct.cliente_id
                  JOIN balanca b ON b.id = ct.balanca_id
                 WHERE ct.id = @id
                """, new { id });
            if (ct is null) return Results.NotFound();
            if ((string)ct.status is not ("rascunho" or "aguardando_aprovacao" or "emitido"))
                return Results.Conflict(new { erro = "Este certificado não pode ser editado." });

            var indicacao = await conn.QueryAsync("""
                SELECT id, ordem, carga_aplicada, indicacao, erro, incerteza, ema, aprovado
                  FROM ensaio_indicacao WHERE certificado_id = @id ORDER BY ordem
                """, new { id });
            var excentricidade = await conn.QueryAsync("""
                SELECT id, posicao, carga, indicacao, erro
                  FROM ensaio_excentricidade WHERE certificado_id = @id
                """, new { id });
            var repetibilidade = await conn.QueryAsync("""
                SELECT id, medicao_num, carga, indicacao
                  FROM ensaio_repetibilidade WHERE certificado_id = @id ORDER BY medicao_num
                """, new { id });
            var sensibilidade = await conn.QuerySingleOrDefaultAsync("""
                SELECT id, carga_referencia, adicao, resultado_display
                  FROM ensaio_sensibilidade WHERE certificado_id = @id
                """, new { id });

            return Results.Ok(new { certificado = ct, indicacao, excentricidade,
                repetibilidade, sensibilidade });
        });

        // Salva a edição manual (grava os valores como enviados — modo override)
        g.MapPut("/{id:guid}/edicao-manual", async (Guid id, JsonElement body,
            ClaimsPrincipal user, NpgsqlDataSource ds, HttpContext ctx) =>
        {
            var papel = Tenant.Papel(user);
            if (papel is not ("admin" or "responsavel_tecnico"))
                return Results.Forbid();

            await using var conn = await Tenant.AbrirConexao(ds, user);
            await using var tx = await conn.BeginTransactionAsync();

            var ct = await conn.QuerySingleOrDefaultAsync("""
                SELECT id, status FROM certificado WHERE id = @id FOR UPDATE
                """, new { id });
            if (ct is null) return Results.NotFound();
            var status = (string)ct.status;
            if (status is not ("rascunho" or "aguardando_aprovacao" or "emitido"))
                return Results.Conflict(new { erro = "Este certificado não pode ser editado." });

            // Guarda o estado anterior para a auditoria (antes/depois)
            var antes = await conn.QueryAsync(
                "SELECT ordem, carga_aplicada, indicacao, erro, incerteza FROM ensaio_indicacao WHERE certificado_id=@id ORDER BY ordem",
                new { id });

            // ── Campos gerais do certificado ──
            var uid = Tenant.UsuarioId(user);
            await conn.ExecuteAsync("""
                UPDATE certificado SET
                    temperatura = @temp, umidade = @umid, pressao = @press, incerteza_k = @ik,
                    observacao = @obs, data_calibracao = @dcal,
                    editado_manualmente = true, editado_por = @uid, editado_em = now(),
                    atualizado_em = now()
                 WHERE id = @id
                """, new
            {
                id, uid,
                temp = Num(body, "temperatura"),
                umid = Num(body, "umidade"),
                press = Num(body, "pressao"),
                ik = Num(body, "incertezaK"),
                obs = Str(body, "observacao"),
                dcal = Data(body, "dataCalibracao")
            });

            // ── Pontos de indicação (com override de erro/incerteza) ──
            if (body.TryGetProperty("indicacao", out var ij) && ij.ValueKind == JsonValueKind.Array)
            {
                foreach (var p in ij.EnumerateArray())
                {
                    // Não permite deixar carga ou indicação em branco
                    if (Num(p, "carga_aplicada") is null || Num(p, "indicacao") is null)
                        return Results.BadRequest(new { erro =
                            "Todo ponto de indicação precisa ter carga e indicação preenchidas." });
                    var pid = p.GetProperty("id").GetGuid();
                    await conn.ExecuteAsync("""
                        UPDATE ensaio_indicacao SET
                            carga_aplicada = @carga, indicacao = @ind,
                            erro = @erro, incerteza = @inc,
                            aprovado = CASE WHEN ema IS NULL THEN aprovado ELSE abs(@erro) <= ema END
                         WHERE id = @pid AND certificado_id = @id
                        """, new
                    {
                        pid, id,
                        carga = Num(p, "carga_aplicada"),
                        ind = Num(p, "indicacao"),
                        erro = Num(p, "erro"),
                        inc = Num(p, "incerteza")
                    });
                }
            }

            // ── Excentricidade ──
            if (body.TryGetProperty("excentricidade", out var ej) && ej.ValueKind == JsonValueKind.Array)
                foreach (var x in ej.EnumerateArray())
                {
                    if (Num(x, "carga") is null || Num(x, "indicacao") is null)
                        return Results.BadRequest(new { erro =
                            "Todo ponto de excentricidade precisa ter carga e indicação preenchidas." });
                    await conn.ExecuteAsync("""
                        UPDATE ensaio_excentricidade SET carga=@carga, indicacao=@ind, erro=@erro
                         WHERE id=@xid AND certificado_id=@id
                        """, new { xid = x.GetProperty("id").GetGuid(), id,
                            carga = Num(x, "carga"), ind = Num(x, "indicacao"), erro = Num(x, "erro") });
                }

            // ── Repetibilidade ──
            if (body.TryGetProperty("repetibilidade", out var rj) && rj.ValueKind == JsonValueKind.Array)
                foreach (var r in rj.EnumerateArray())
                {
                    if (Num(r, "carga") is null || Num(r, "indicacao") is null)
                        return Results.BadRequest(new { erro =
                            "Toda medição de repetibilidade precisa ter carga e indicação preenchidas." });
                    await conn.ExecuteAsync("""
                        UPDATE ensaio_repetibilidade SET carga=@carga, indicacao=@ind
                         WHERE id=@rid AND certificado_id=@id
                        """, new { rid = r.GetProperty("id").GetGuid(), id,
                            carga = Num(r, "carga"), ind = Num(r, "indicacao") });
                }

            // ── Sensibilidade ──
            if (body.TryGetProperty("sensibilidade", out var sj) && sj.ValueKind == JsonValueKind.Object
                && sj.TryGetProperty("id", out var sid) && sid.ValueKind != JsonValueKind.Null)
            {
                // carga_referencia é NOT NULL no banco: valida aqui para o
                // usuário receber uma mensagem clara em vez de erro genérico
                // (João, 16/08/2026 — ocorrência na BALANCAS NOVA GOIAS).
                if (Num(sj, "carga_referencia") is null)
                    return Results.BadRequest(new { erro =
                        "Informe a carga de referência da sensibilidade (ou deixe o ensaio como estava)." });
                await conn.ExecuteAsync("""
                    UPDATE ensaio_sensibilidade SET carga_referencia=@cr, adicao=@ad, resultado_display=@rd
                     WHERE id=@sid AND certificado_id=@id
                    """, new { sid = sid.GetGuid(), id,
                        cr = Num(sj, "carga_referencia"), ad = Num(sj, "adicao"),
                        rd = Num(sj, "resultado_display") });
            }

            var depois = await conn.QueryAsync(
                "SELECT ordem, carga_aplicada, indicacao, erro, incerteza FROM ensaio_indicacao WHERE certificado_id=@id ORDER BY ordem",
                new { id });

            // Auditoria: registra a edição com antes/depois
            await Auditoria.Registrar(conn, Tenant.EmpresaId(user), uid,
                "certificado", id, "edicao_manual",
                new { antes, depois, status_no_momento = status },
                Auditoria.Ip(ctx));

            await tx.CommitAsync();

            // Se estava emitido, o PDF precisa ser regerado (vira revisão no fluxo normal).
            // Sinalizamos ao frontend para orientar o usuário.
            return Results.Ok(new
            {
                ok = true,
                era_emitido = status == "emitido",
                mensagem = status == "emitido"
                    ? "Alterações salvas. Como o certificado já estava emitido, gere uma nova revisão e reimita o PDF."
                    : "Alterações salvas. Revise e prossiga com a aprovação."
            });
        });
    }

    // ── Helpers de leitura tolerante do JSON ──
    static decimal? Num(JsonElement el, string prop) =>
        el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.Number
            ? v.GetDecimal() : (decimal?)null;

    static string? Str(JsonElement el, string prop) =>
        el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString() : null;

    static DateTime? Data(JsonElement el, string prop) =>
        el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String
            && DateTime.TryParse(v.GetString(), out var d) ? d : (DateTime?)null;
}
