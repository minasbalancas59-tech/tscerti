using System.Security.Claims;
using System.Text.Json;
using CertSaas.Api.Infra;
using Dapper;
using Npgsql;

namespace CertSaas.Api.Certificados;

/// <summary>
/// Endpoints da coleta RBC (fluxo separado do ensaio Portaria 157).
/// Salva os 3 ensaios (carga, excentricidade, mobilidade) + a composição
/// de pesos por carga, e calcula o orçamento de incerteza de cada ponto
/// de carga usando o motor IncertezaRbc.
///
/// Estrutura (aprovada):
///  • CARGA: cada ponto medido N vezes → u_rep vem das N leituras.
///  • EXCENTRICIDADE: posições × N → o maior erro (posição−centro) vira
///    o u_exc, que alimenta a incerteza de TODAS as cargas.
///  • MOBILIDADE: N repetições → só REGISTRO (não entra no cálculo).
///  • Pesos por carga: soma dos convencionais + quadratura das incertezas.
/// </summary>
public static class RbcEndpoints
{
    public static void Map(WebApplication app)
    {
        // ── Salvar os 3 ensaios + composição + calcular incerteza ──
        app.MapPut("/api/certificados/{id:guid}/coleta-rbc", async (Guid id,
            ColetaRbcRequest req, ClaimsPrincipal user, NpgsqlDataSource ds, HttpContext ctx) =>
        {
            if (!Tenant.EhGestor(user)) return Results.Forbid();
            var empresaId = Tenant.EmpresaId(user);
            await using var conn = await Tenant.AbrirConexao(ds, user);

            double temp = req.TempC ?? 20, pressao = req.PressaoHpa ?? 1013, umid = req.UmidadePct ?? 50;
            double divisao = (double)(req.Divisao ?? 0.001m);

            // limpa tudo do certificado (regrava)
            await conn.ExecuteAsync("DELETE FROM leitura_rbc WHERE certificado_id = @id", new { id });
            await conn.ExecuteAsync("DELETE FROM excentricidade_rbc WHERE certificado_id = @id", new { id });
            await conn.ExecuteAsync("DELETE FROM mobilidade_rbc WHERE certificado_id = @id", new { id });
            await conn.ExecuteAsync("DELETE FROM carga_peso_rbc WHERE certificado_id = @id", new { id });
            await conn.ExecuteAsync("DELETE FROM incerteza_ponto_rbc WHERE certificado_id = @id", new { id });

            // ═══ 1) EXCENTRICIDADE: grava e calcula o maior erro (u_exc) ═══
            double erroExcMax = 0;
            if (req.Excentricidade is { Count: > 0 })
            {
                // média do centro (ordem_posicao = 1) como referência
                double refCentro = 0; bool temCentro = false;
                foreach (var pos in req.Excentricidade)
                {
                    var leiturasPos = (pos.Leituras ?? new()).Select(x => (double)x).ToList();
                    var mediaPos = leiturasPos.Count > 0 ? leiturasPos.Average() : 0;
                    if (pos.OrdemPosicao == 1) { refCentro = mediaPos; temCentro = true; }
                }
                int op = 0;
                foreach (var pos in req.Excentricidade)
                {
                    op++;
                    int ol = 0;
                    var leiturasPos = (pos.Leituras ?? new()).Select(x => (double)x).ToList();
                    foreach (var leit in pos.Leituras ?? new())
                    {
                        ol++;
                        await conn.ExecuteAsync("""
                            INSERT INTO excentricidade_rbc (empresa_id, certificado_id,
                                ordem_posicao, nome_posicao, carga, ordem_leitura, indicacao)
                            VALUES (@empresaId, @id, @op, @nome, @carga, @ol, @leit)
                            """, new { empresaId, id, op = pos.OrdemPosicao, nome = pos.NomePosicao,
                                       carga = pos.Carga, ol, leit });
                    }
                    // erro da posição vs centro
                    if (temCentro && pos.OrdemPosicao != 1 && leiturasPos.Count > 0)
                    {
                        var erroPos = Math.Abs(leiturasPos.Average() - refCentro);
                        if (erroPos > erroExcMax) erroExcMax = erroPos;
                    }
                }
            }

            // ═══ 2) MOBILIDADE: só registro (não entra no cálculo) ═══
            if (req.Mobilidade is { Count: > 0 })
            {
                int ol = 0;
                foreach (var leit in req.Mobilidade)
                {
                    ol++;
                    await conn.ExecuteAsync("""
                        INSERT INTO mobilidade_rbc (empresa_id, certificado_id,
                            carga_referencia, divisao_e, esperado, ordem_leitura, display_leu)
                        VALUES (@empresaId, @id, @cargaRef, @div, @esperado, @ol, @leit)
                        """, new { empresaId, id, cargaRef = req.MobCargaRef, div = req.MobDivisao,
                                   esperado = req.MobEsperado, ol, leit });
                }
            }

            // ═══ 3) CARGA (indicação): grava leituras + composição + calcula ═══
            if (req.Pontos is { Count: > 0 })
            {
                int op = 0;
                foreach (var ponto in req.Pontos)
                {
                    op++;
                    // 3a) leituras da carga
                    int ol = 0;
                    var leituras = new List<double>();
                    foreach (var leit in ponto.Leituras ?? new())
                    {
                        ol++;
                        leituras.Add((double)leit);
                        await conn.ExecuteAsync("""
                            INSERT INTO leitura_rbc (empresa_id, certificado_id, ordem_ponto,
                                carga, ordem_leitura, indicacao)
                            VALUES (@empresaId, @id, @op, @carga, @ol, @leit)
                            """, new { empresaId, id, op, ponto.Carga, ol, leit });
                    }

                    // 3b) composição de pesos: soma convencionais + quadratura incertezas
                    double convTotal = 0, somaU2 = 0;
                    if (ponto.Pesos is { Count: > 0 })
                    {
                        foreach (var pw in ponto.Pesos)
                        {
                            convTotal += (double)(pw.ValorConvencional ?? 0);
                            var u = (double)(pw.Incerteza ?? 0);
                            var k = (double)(pw.K ?? 2);
                            var uPad = k > 0 ? u / k : u;   // incerteza-padrão do ponto
                            somaU2 += uPad * uPad;
                            // grava a composição (snapshot para rastreabilidade)
                            await conn.ExecuteAsync("""
                                INSERT INTO carga_peso_rbc (empresa_id, certificado_id, ordem_ponto,
                                    peso_ponto_rbc_id, peso_identificacao, valor_nominal,
                                    valor_convencional, incerteza, k, num_certificado)
                                VALUES (@empresaId, @id, @op, @pontoId, @ident, @nominal,
                                    @conv, @inc, @k, @numCert)
                                """, new { empresaId, id, op, pontoId = pw.PesoPontoRbcId,
                                    ident = pw.PesoIdentificacao, nominal = pw.ValorNominal,
                                    conv = pw.ValorConvencional, inc = pw.Incerteza, k = pw.K,
                                    numCert = pw.NumCertificado });
                        }
                    }
                    // valor convencional da carga = soma dos pesos (ou a própria carga se sem composição)
                    double valorConv = convTotal > 0 ? convTotal : (double)ponto.Carga;
                    double uPadrao = Math.Sqrt(somaU2);  // já em incerteza-padrão combinada

                    // 3c) calcula o orçamento com o motor
                    if (leituras.Count > 0)
                    {
                        // Degraus de substituição do ponto e fator da empresa
                        int degrausSub = ponto.DegrausSub ?? 0;
                        var fatorSub = await conn.ExecuteScalarAsync<decimal?>(
                            "SELECT rbc_fator_sub FROM empresa WHERE id=@e", new { e = empresaId }) ?? 1.0m;

                        var orc = IncertezaRbc.Calcular(
                            leituras, valorConv, divisao, uPadrao, erroExcMax,
                            temp, pressao, umid,
                            (double)(ponto.DensidadePeso ?? 8000),
                            degrausSub, (double)fatorSub);

                        await conn.ExecuteAsync("""
                            INSERT INTO incerteza_ponto_rbc (empresa_id, certificado_id,
                                ordem_ponto, carga, media, erro, s_rep, u_rep, u_res, u_pad,
                                u_exc, u_buoy, u_c, veff, k, u_expandida, u_sub, degraus_sub)
                            VALUES (@empresaId, @id, @op, @carga, @media, @erro, @s, @urep,
                                @ures, @upad, @uexc, @ubuoy, @uc, @veff, @k, @u, @usub, @degrausSub)
                            """, new { empresaId, id, op, ponto.Carga,
                                media = orc.Media, erro = orc.Erro, s = orc.DesvioRep,
                                urep = orc.U_rep, ures = orc.U_res, upad = orc.U_pad,
                                uexc = orc.U_exc, ubuoy = orc.U_buoy, uc = orc.U_c,
                                veff = double.IsInfinity(orc.Veff) ? 9999 : orc.Veff,
                                k = orc.K, u = orc.U, usub = orc.U_sub, degrausSub });
                    }
                }
            }

            await Auditoria.Registrar(conn, empresaId, Tenant.UsuarioId(user),
                "coleta_rbc", id, "update", null, Auditoria.Ip(ctx));
            return Results.Ok(new { salvo = true, erroExc = erroExcMax });
        }).RequireAuthorization();

        // ── Ler tudo (para a tela e a memória) ──────────────────
        app.MapGet("/api/certificados/{id:guid}/coleta-rbc", async (Guid id,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var leituras = await conn.QueryAsync("""
                SELECT ordem_ponto, carga, ordem_leitura, indicacao
                  FROM leitura_rbc WHERE certificado_id = @id
                 ORDER BY ordem_ponto, ordem_leitura
                """, new { id });
            var exc = await conn.QueryAsync("""
                SELECT ordem_posicao, nome_posicao, carga, ordem_leitura, indicacao
                  FROM excentricidade_rbc WHERE certificado_id = @id
                 ORDER BY ordem_posicao, ordem_leitura
                """, new { id });
            var mob = await conn.QueryAsync("""
                SELECT carga_referencia, divisao_e, esperado, ordem_leitura, display_leu
                  FROM mobilidade_rbc WHERE certificado_id = @id
                 ORDER BY ordem_leitura
                """, new { id });
            var pesos = await conn.QueryAsync("""
                SELECT ordem_ponto, peso_ponto_rbc_id, peso_identificacao, valor_nominal,
                       valor_convencional, incerteza, k, num_certificado
                  FROM carga_peso_rbc WHERE certificado_id = @id
                 ORDER BY ordem_ponto
                """, new { id });
            var orcamentos = await conn.QueryAsync("""
                SELECT ordem_ponto, carga, media, erro, s_rep, u_rep, u_res, u_pad,
                       u_exc, u_buoy, u_c, veff, k, u_expandida
                  FROM incerteza_ponto_rbc WHERE certificado_id = @id
                 ORDER BY ordem_ponto
                """, new { id });
            return Results.Ok(new { leituras, excentricidade = exc, mobilidade = mob,
                                    pesos, orcamentos });
        }).RequireAuthorization();

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
            // Os pesos escolhidos devem corresponder a carga: o erro do RBC e
            // (media - valor convencional dos padroes). Divergencia > 1% distorce tudo.
            var divergente = await conn.QuerySingleOrDefaultAsync("""
                SELECT i.ordem_ponto, i.carga, sum(w.valor_convencional) AS soma
                  FROM incerteza_ponto_rbc i
                  JOIN carga_peso_rbc w ON w.certificado_id = i.certificado_id
                                       AND w.ordem_ponto = i.ordem_ponto
                 WHERE i.certificado_id = @id
                 GROUP BY i.ordem_ponto, i.carga
                HAVING i.carga > 0
                   AND abs(sum(w.valor_convencional) - i.carga) / i.carga > 0.01
                 ORDER BY i.ordem_ponto LIMIT 1
                """, new { id });
            if (divergente is not null)
                return Results.BadRequest(new { erro =
                    $"No ponto de carga nº {divergente.ordem_ponto} os pesos escolhidos somam " +
                    $"{(decimal)divergente.soma:0.####} mas a carga é {(decimal)divergente.carga:0.####}. " +
                    "Como o erro é calculado contra o valor convencional dos padrões, a composição " +
                    "precisa corresponder à carga aplicada. Revise os pesos deste ponto." });

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

    }
}

// ── Records da requisição ───────────────────────────────────
public record PesoCompostoRbc(
    Guid? PesoPontoRbcId, string? PesoIdentificacao, string? ValorNominal,
    decimal? ValorConvencional, decimal? Incerteza, decimal? K, string? NumCertificado);

public record PontoCargaRbc(
    decimal Carga,
    List<decimal>? Leituras,
    List<PesoCompostoRbc>? Pesos,
    decimal? DensidadePeso,
    int? DegrausSub = null);   // método da substituição: degraus deste ponto

public record PosicaoExcRbc(
    int OrdemPosicao, string NomePosicao, decimal? Carga, List<decimal>? Leituras);

public record ColetaRbcRequest(
    List<PontoCargaRbc>? Pontos,
    List<PosicaoExcRbc>? Excentricidade,
    List<decimal>? Mobilidade,
    decimal? MobCargaRef, decimal? MobDivisao, decimal? MobEsperado,
    decimal? Divisao,
    double? TempC, double? PressaoHpa, double? UmidadePct);

public record EnviarRbcRequest(string? DataCalibracao,
    decimal? Temperatura, decimal? Umidade, decimal? Pressao, string? LocalTipo);
