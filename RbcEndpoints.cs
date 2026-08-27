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
                        var orc = IncertezaRbc.Calcular(
                            leituras, valorConv, divisao, uPadrao, erroExcMax,
                            temp, pressao, umid,
                            (double)(ponto.DensidadePeso ?? 8000));

                        await conn.ExecuteAsync("""
                            INSERT INTO incerteza_ponto_rbc (empresa_id, certificado_id,
                                ordem_ponto, carga, media, erro, s_rep, u_rep, u_res, u_pad,
                                u_exc, u_buoy, u_c, veff, k, u_expandida)
                            VALUES (@empresaId, @id, @op, @carga, @media, @erro, @s, @urep,
                                @ures, @upad, @uexc, @ubuoy, @uc, @veff, @k, @u)
                            """, new { empresaId, id, op, ponto.Carga,
                                media = orc.Media, erro = orc.Erro, s = orc.DesvioRep,
                                urep = orc.U_rep, ures = orc.U_res, upad = orc.U_pad,
                                uexc = orc.U_exc, ubuoy = orc.U_buoy, uc = orc.U_c,
                                veff = double.IsInfinity(orc.Veff) ? 9999 : orc.Veff,
                                k = orc.K, u = orc.U });
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
    decimal? DensidadePeso);

public record PosicaoExcRbc(
    int OrdemPosicao, string NomePosicao, decimal? Carga, List<decimal>? Leituras);

public record ColetaRbcRequest(
    List<PontoCargaRbc>? Pontos,
    List<PosicaoExcRbc>? Excentricidade,
    List<decimal>? Mobilidade,
    decimal? MobCargaRef, decimal? MobDivisao, decimal? MobEsperado,
    decimal? Divisao,
    double? TempC, double? PressaoHpa, double? UmidadePct);
