using Dapper;
using Npgsql;

namespace CertSaas.Api.Certificados;

/// <summary>
/// Motor metrológico. ATENÇÃO: a incerteza usa um modelo GUM
/// simplificado (pesos padrão + resolução + repetibilidade, k=2).
/// Antes do piloto, VALIDAR contra certificados reais já emitidos.
/// </summary>
public static class Metrologia
{
    // Erro máximo permitido RELATIVO dos pesos padrão (OIML R111)
    private static readonly Dictionary<string, double> MpeRelativo = new(StringComparer.OrdinalIgnoreCase)
    {
        ["E1"] = 0.5e-6, ["E2"] = 1.6e-6,
        ["F1"] = 5e-6,   ["F2"] = 16e-6,
        ["M1"] = 50e-6,  ["M2"] = 160e-6, ["M3"] = 500e-6
    };

    /// <summary>Cargas sugeridas: ~10/25/50/75/100% arredondadas.</summary>
    public static List<decimal> SugerirCargasIndicacao(decimal capacidade, decimal e, string? classe = null)
    {
        var passo = e * 10;                      // valores "redondos" em campo
        if (passo <= 0) passo = 1;
        var percentuais = new[] { 0.10m, 0.25m, 0.50m, 0.75m, 1.00m };
        var cargas = percentuais
            .Select(p => Math.Round(capacidade * p / passo) * passo)
            .Select(c => Math.Min(Math.Max(c, passo), capacidade))
            .Distinct().OrderBy(c => c).ToList();
        if (cargas[^1] != capacidade) cargas[^1] = capacidade;

        // A primeira carga do ensaio deve ser a CARGA MÍNIMA (Min) da balança,
        // conforme a classe (OIML R76): I=100e, II=50e, III=20e, IIII=10e.
        var mult = classe switch { "I" => 100m, "II" => 50m, "III" => 20m, "IIII" => 10m, _ => 20m };
        var cargaMin = mult * e;
        if (cargaMin > 0 && cargaMin < capacidade)
        {
            // remove qualquer carga menor ou igual à mínima e a coloca como primeira
            cargas = cargas.Where(c => c > cargaMin).ToList();
            cargas.Insert(0, cargaMin);
        }
        return cargas;
    }

    /// <summary>
    /// Cargas sugeridas para balanças MULTI-INTERVALO (2 ou 3 faixas):
    /// gera os mesmos percentuais (10/25/50/75/100%) de cada faixa
    /// individualmente, arredondando cada ponto pelo "e" DAQUELA faixa
    /// — em vez de usar um "e" único para a balança inteira. A carga
    /// mínima (Min) usa sempre o "e" da faixa 1 (a mais fina), conforme
    /// OIML R76. Faixas devem vir ordenadas por limite_sup crescente.
    /// </summary>
    public static List<decimal> SugerirCargasIndicacaoMulti(
        List<(decimal limiteKg, decimal eKg)> faixas, decimal capacidadeKg, string? classe = null)
    {
        if (faixas.Count == 0) return new List<decimal>();

        var cargas = new List<decimal>();
        decimal limiteAnterior = 0;
        var percentuais = new[] { 0.25m, 0.50m, 0.75m, 1.00m };
        foreach (var (limiteKg, eKg) in faixas)
        {
            var passo = eKg * 10; if (passo <= 0) passo = 1;
            var largura = limiteKg - limiteAnterior;
            foreach (var p in percentuais)
            {
                var alvo = limiteAnterior + largura * p;
                var c = Math.Round(alvo / passo) * passo;
                c = Math.Min(Math.Max(c, limiteAnterior + passo), limiteKg);
                cargas.Add(c);
            }
            limiteAnterior = limiteKg;
        }
        // Garante que o último ponto seja exatamente a capacidade
        cargas = cargas.Distinct().OrderBy(c => c).ToList();
        if (cargas.Count > 0 && cargas[^1] != capacidadeKg)
            cargas[^1] = capacidadeKg;

        // Carga mínima (Min): sempre pelo "e" da faixa 1 (a mais fina)
        var eMin = faixas[0].eKg;
        var mult = classe switch { "I" => 100m, "II" => 50m, "III" => 20m, "IIII" => 10m, _ => 20m };
        var cargaMin = mult * eMin;
        if (cargaMin > 0 && cargaMin < capacidadeKg)
        {
            cargas = cargas.Where(c => c > cargaMin).ToList();
            cargas.Insert(0, cargaMin);
        }
        return cargas;
    }

    /// <summary>
    /// Carga de repetibilidade (~50% da capacidade) para MULTI-INTERVALO:
    /// arredonda pelo "e" da faixa onde essa carga cai, não pelo "e" único.
    /// </summary>
    public static decimal CargaMeioFundoMulti(List<(decimal limiteKg, decimal eKg)> faixas, decimal capacidadeKg)
    {
        if (faixas.Count == 0) return 0;
        var metade = capacidadeKg / 2m;
        var eDaCarga = faixas.FirstOrDefault(f => metade <= f.limiteKg).eKg;
        if (eDaCarga <= 0) eDaCarga = faixas[^1].eKg;
        var passo = eDaCarga * 10; if (passo <= 0) passo = eDaCarga > 0 ? eDaCarga : 1;
        var carga = Math.Round(metade / passo) * passo;
        return carga <= 0 ? passo : carga;
    }

    /// <summary>
    /// Excentricidade (~1/3 da capacidade) para MULTI-INTERVALO: arredonda
    /// pelo "e" da faixa onde a carga de 1/3 da capacidade cai.
    /// </summary>
    public static (string[] posicoes, decimal carga) SugerirExcentricidadeMulti(
        string tipo, List<(decimal limiteKg, decimal eKg)> faixas, decimal capacidadeKg)
    {
        var t = (tipo ?? "").ToLowerInvariant();
        var posicoes = (t.Contains("rodovi") || t.Contains("ferrovi"))
            ? new[] { "centro", "secao_1", "secao_2", "secao_3", "secao_4" }
            : new[] { "centro", "frente_esq", "frente_dir", "fundo_esq", "fundo_dir" };
        if (faixas.Count == 0) return (posicoes, 0);
        var umTerco = capacidadeKg / 3m;
        var eDaCarga = faixas.FirstOrDefault(f => umTerco <= f.limiteKg).eKg;
        if (eDaCarga <= 0) eDaCarga = faixas[^1].eKg;
        var passo = eDaCarga * 10; if (passo <= 0) passo = eDaCarga > 0 ? eDaCarga : 1;
        var carga = Math.Round(umTerco / passo) * passo;
        if (carga <= 0) carga = passo;
        return (posicoes, carga);
    }

    /// <summary>Posições de excentricidade conforme o tipo de balança.</summary>
    /// <summary>Carga ~50% da capacidade, arredondada ao múltiplo de 10·e (repetibilidade).</summary>
    public static decimal CargaMeioFundo(decimal capacidade, decimal e)
    {
        var metade = capacidade / 2m;
        var passo = e * 10; if (passo <= 0) passo = e > 0 ? e : 1;
        var carga = Math.Round(metade / passo) * passo;
        return carga <= 0 ? passo : carga;
    }

    public static (string[] posicoes, decimal carga) SugerirExcentricidade(
        string tipo, decimal capacidade, decimal e)
    {
        // Tipo agora é livre; usamos posições neutras (centro + 4 cantos),
        // que o técnico pode reinterpretar conforme a balança física.
        // Se o nome do tipo sugerir rodoviária/ferroviária, usamos seções.
        var t = (tipo ?? "").ToLowerInvariant();
        var posicoes = (t.Contains("rodovi") || t.Contains("ferrovi"))
            ? new[] { "centro", "secao_1", "secao_2", "secao_3", "secao_4" }
            : new[] { "centro", "frente_esq", "frente_dir", "fundo_esq", "fundo_dir" };
        // Portaria 157/2022 (2.6.2.2): carga = 1/3 da capacidade máxima,
        // arredondada ao múltiplo de 10·e mais próximo para cair "redonda".
        var umTerco = capacidade / 3m;
        var passo = e * 10; if (passo <= 0) passo = e > 0 ? e : 1;
        var carga = Math.Round(umTerco / passo) * passo;
        if (carga <= 0) carga = passo;
        return (posicoes, carga);
    }

    /// <summary>EMA em kg para uma carga, pela tabela ema_regra do banco.</summary>
    /// <remarks>
    /// PONTO ZERO — decisão de 28/08/2026 (João): a comparação é "maior que"
    /// (@cargaEmE &gt; faixa_min_e), então uma carga de exatamente 0 não casa
    /// com nenhuma faixa e fica SEM EMA, aparecendo como "—" no certificado.
    /// É intencional: o zero entra como registro do ensaio (a incerteza é
    /// calculada normalmente, sem a parcela dos pesos), mas não é julgado
    /// conforme/não conforme, porque o zeramento tem critério próprio na
    /// metrologia legal, distinto do EMA por número de divisões.
    /// A tabela ema_regra descreve a primeira faixa como iniciando em 0, o
    /// que pode sugerir que o zero deveria receber 1e — não mude para "&gt;="
    /// sem decidir isso com o responsável técnico: afeta a conformidade
    /// declarada em todos os certificados.
    /// </remarks>
    public static async Task<decimal?> ObterEmaKg(NpgsqlConnection conn,
        string classe, string contexto, decimal cargaKg, decimal eKg)
    {
        if (eKg <= 0) return null;
        var cargaEmE = cargaKg / eKg;
        var multiplo = await conn.ExecuteScalarAsync<decimal?>("""
            SELECT ema_multiplo_e FROM ema_regra
             WHERE classe_exatidao = @classe AND contexto = @contexto
               AND @cargaEmE > faixa_min_e
               AND (faixa_max_e IS NULL OR @cargaEmE <= faixa_max_e)
             ORDER BY vigencia_inicio DESC LIMIT 1
            """, new { classe, contexto, cargaEmE });
        return multiplo is null ? null : multiplo.Value * eKg;
    }

    /// <summary>
    /// Retorna o "e" (kg) da faixa onde a carga se encaixa, para
    /// balanças multi-intervalo. Se a balança não tiver faixas
    /// cadastradas, devolve o eKg padrão (comportamento de faixa única).
    /// As faixas são ordenadas por limite superior; a carga pertence
    /// à primeira faixa cujo limite superior a comporta.
    /// </summary>
    public static async Task<decimal> ResolverEKg(NpgsqlConnection conn,
        Guid balancaId, decimal cargaKg, decimal eKgPadrao)
    {
        var faixas = (await conn.QueryAsync<(decimal limite_sup, decimal divisao_e)>("""
            SELECT limite_sup, divisao_e FROM balanca_faixa
             WHERE balanca_id = @balancaId ORDER BY ordem
            """, new { balancaId })).ToList();
        if (faixas.Count == 0) return eKgPadrao;   // faixa única

        foreach (var f in faixas)
            if (cargaKg <= f.limite_sup)
                return f.divisao_e;
        // Acima do último limite: usa o "e" da última faixa
        return faixas[^1].divisao_e;
    }

    /// <summary>
    /// EMA em kg considerando faixas (multi-intervalo). Resolve o "e"
    /// da faixa da carga e então calcula o EMA com esse "e".
    /// </summary>
    public static async Task<(decimal? ema, decimal eUsado)> ObterEmaKgMulti(NpgsqlConnection conn,
        string classe, string contexto, decimal cargaKg, decimal eKgPadrao, Guid balancaId)
    {
        var eUsado = await ResolverEKg(conn, balancaId, cargaKg, eKgPadrao);
        var ema = await ObterEmaKg(conn, classe, contexto, cargaKg, eUsado);
        return (ema, eUsado);
    }

    /// <summary>Regras completas da classe (o frontend calcula EMA ao vivo).</summary>
    public static Task<IEnumerable<dynamic>> RegrasEma(NpgsqlConnection conn, string classe) =>
        conn.QueryAsync("""
            SELECT contexto, faixa_min_e, faixa_max_e, ema_multiplo_e
              FROM ema_regra WHERE classe_exatidao = @classe
             ORDER BY contexto, faixa_min_e
            """, new { classe });

    /// <summary>
    /// Incerteza expandida (k=2), na MESMA unidade da balança:
    ///   u_pesos = (mpe_rel · carga)/√3  — retangular (mpe_rel é adimensional)
    ///   u_leitura = d/√12 por leitura, ×√2 (zero + carga)
    ///   u_repet = desvio padrão da repetibilidade
    /// Como mpe_rel é relativo e todos os termos absolutos (carga, d,
    /// desvio) vêm na unidade da balança, o resultado sai coerente sem
    /// conversão. A classe do peso define apenas mpe_rel.
    /// </summary>
    public static decimal IncertezaExpandida(decimal carga, decimal d,
        decimal desvioRepetibilidade, string classePesos)
    {
        var mpeRel = MpeRelativo.GetValueOrDefault(classePesos, 50e-6); // default M1
        var uPesos = (double)carga * mpeRel / Math.Sqrt(3);
        var uLeitura = (double)d / Math.Sqrt(12) * Math.Sqrt(2);
        var uRepet = (double)desvioRepetibilidade;
        var u = Math.Sqrt(uPesos * uPesos + uLeitura * uLeitura + uRepet * uRepet);
        return Math.Round((decimal)(2 * u), 6);   // k = 2 (~95%)
    }

    /// <summary>
    /// Componente de incerteza dos pesos-padrão (u_pesos), em kg.
    ///
    /// Usa a incerteza REAL declarada no certificado do peso quando ela
    /// existe (fixa, não escala com a carga — o cadastro de peso já
    /// representa o CONJUNTO inteiro usado no ensaio, com uma incerteza
    /// válida para toda a faixa que ele cobre). Sem valor declarado, cai
    /// exatamente na aproximação por classe de sempre (escala com a carga).
    ///
    /// Pedido do João, 10/09/2026: "muitas empresas estão pedindo" a
    /// incerteza real do peso no certificado — antes só existia a
    /// aproximação genérica por classe (OIML R111).
    /// </summary>
    public static (decimal UPesos, string Fonte) ResolverUPesos(
        decimal carga, string classePesos, decimal? incertezaDeclaradaKg)
    {
        if (incertezaDeclaradaKg is > 0)
            return (incertezaDeclaradaKg.Value, "declarada");
        var mpeRel = MpeRelativo.GetValueOrDefault(classePesos, 50e-6);
        var uPesos = (decimal)((double)carga * mpeRel / Math.Sqrt(3));
        return (uPesos, "classe");
    }

    /// <summary>
    /// Componente de incerteza do EMPUXO DO AR, em kg — quarto termo do
    /// cálculo (GUM/EURAMET cg-18, App. E), com a fórmula CORRETA
    /// (referenciada à densidade convencional de 8000 kg/m³, não à
    /// densidade do peso sozinha — ver nota completa em
    /// IncertezaRbc.IncertezaEmpuxo, cuja fórmula era usada errada até
    /// hoje só ali; aqui já nasce certa).
    ///
    /// Devolve zero sem tentar calcular nada quando faltar qualquer
    /// dado ambiental (temperatura/pressão/umidade) — prefere DESPREZAR
    /// o componente a travar o certificado por falta de um dado que,
    /// de qualquer forma, quase nunca muda o resultado (ver análise no
    /// LEIA-ME desta migration: efeito da ordem de 0,001% mesmo em
    /// cargas grandes). João, 10/09/2026.
    /// </summary>
    public static decimal ResolverUEmpuxo(decimal carga,
        decimal? tempC, decimal? pressaoHpa, decimal? umidadePct, decimal? densidadePesoKgm3)
    {
        if (tempC is null || pressaoHpa is null || umidadePct is null) return 0m;
        var densidade = densidadePesoKgm3 is > 0 ? densidadePesoKgm3.Value : 8000m;
        var rhoAr = IncertezaRbc.DensidadeAr((double)tempC, (double)pressaoHpa, (double)umidadePct);
        var u = IncertezaRbc.IncertezaEmpuxo((double)carga, rhoAr, (double)densidade);
        return (decimal)u;
    }

    /// <summary>
    /// Igual a IncertezaExpandida, mas devolve também os QUATRO componentes
    /// (u_pesos, u_leitura, u_repet, u_empuxo) para serem CONGELADOS no
    /// banco junto com o resultado. É o que garante que o memorial de
    /// cálculo de um certificado nunca mude depois de emitido, mesmo que
    /// o cadastro do peso seja editado no futuro, ou a configuração da
    /// empresa mude (ver migration 157 para o raciocínio completo).
    /// João, 10/09/2026.
    /// </summary>
    public static (decimal Incerteza, decimal UPesos, decimal ULeitura, decimal URepet,
        decimal UEmpuxo, string FontePesos, decimal DensidadeUsada)
        IncertezaExpandidaDetalhada(decimal carga, decimal d, decimal desvioRepetibilidade,
            string classePesos, decimal? incertezaDeclaradaKg,
            decimal? tempC = null, decimal? pressaoHpa = null, decimal? umidadePct = null,
            decimal? densidadePesoKgm3 = null)
    {
        var (uPesos, fonte) = ResolverUPesos(carga, classePesos, incertezaDeclaradaKg);
        var uLeituraD = (double)d / Math.Sqrt(12) * Math.Sqrt(2);
        var uLeitura = (decimal)uLeituraD;
        var uRepet = desvioRepetibilidade;
        var uEmpuxo = ResolverUEmpuxo(carga, tempC, pressaoHpa, umidadePct, densidadePesoKgm3);
        var densidadeUsada = densidadePesoKgm3 is > 0 ? densidadePesoKgm3.Value : 8000m;
        var u = Math.Sqrt((double)uPesos * (double)uPesos + uLeituraD * uLeituraD
                         + (double)uRepet * (double)uRepet + (double)uEmpuxo * (double)uEmpuxo);
        var incerteza = Math.Round((decimal)(2 * u), 6);   // k = 2 (~95%)
        return (incerteza, uPesos, uLeitura, uRepet, uEmpuxo, fonte, densidadeUsada);
    }

    public static decimal DesvioPadrao(IReadOnlyList<decimal> valores)
    {
        if (valores.Count < 2) return 0;
        var media = valores.Average();
        var soma = valores.Sum(v => (double)((v - media) * (v - media)));
        return (decimal)Math.Sqrt(soma / (valores.Count - 1));
    }
}
