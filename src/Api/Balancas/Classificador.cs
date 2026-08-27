namespace CertSaas.Api.Balancas;

/// <summary>
/// Classificação por exatidão conforme Portaria Inmetro 236/94 (mantida
/// na 157/22) / OIML R76. As faixas de e e número de divisões (n) se
/// sobrepõem — a classe definitiva é a da PLACA do fabricante. Aqui
/// SUGERIMOS a classe mais provável e listamos as compatíveis, alertando
/// quando a escolha do usuário for incompatível. Nunca impomos.
///
/// Discriminador da sugestão: o VALOR de e. Instrumentos comerciais/
/// industriais têm e ≥ 0,1 g → classe III/IIII. Instrumentos de precisão
/// (laboratório) têm e fino (mg) → classe I/II. Quando n estoura o teto
/// de uma classe, ela deixa de ser compatível.
/// Todos os cálculos usam capacidade e 'e' em kg (n é adimensional).
/// </summary>
public static class Classificador
{
    public record Faixa(string Classe, decimal EMinKg, decimal? EMaxKg,
        long NMin, long NMax, string Descricao);

    // e em kg. Descrição para a memória de cálculo.
    private static readonly Faixa[] Tabela =
    {
        new("I",    0.000001m, null,     50_000, long.MaxValue, "e ≥ 1 mg e n ≥ 50000"),
        new("II",   0.000001m, 0.00005m, 100,    100_000, "1 mg ≤ e ≤ 50 mg e 100 ≤ n ≤ 100000"),
        new("II",   0.0001m,   null,     5_000,  100_000, "e ≥ 100 mg e 5000 ≤ n ≤ 100000"),
        new("III",  0.0001m,   0.002m,   100,    10_000, "0,1 g ≤ e ≤ 2 g e 100 ≤ n ≤ 10000"),
        new("III",  0.005m,    null,     500,    10_000, "e ≥ 5 g e 500 ≤ n ≤ 10000"),
        new("IIII", 0.005m,    null,     100,    1_000,  "e ≥ 5 g e 100 ≤ n ≤ 1000"),
    };

    public record PassoMemoria(string Classe, string Regra, bool Compativel, string Motivo);

    public record Resultado(long NumeroDivisoes, List<string> ClassesCompativeis,
        string Sugerida, string? Alerta, List<PassoMemoria> Memoria, string ResumoMemoria);

    public static Resultado Classificar(decimal capacidadeKg, decimal eKg,
        string tipo, string? classeEscolhida)
    {
        long n = eKg > 0 ? (long)Math.Round(capacidadeKg / eKg) : 0;
        decimal eG = eKg * 1000; // e em gramas (para as comparações e a memória)

        var compativeis = new List<string>();
        var memoria = new List<PassoMemoria>();

        foreach (var f in Tabela)
        {
            bool eOk = eKg >= f.EMinKg && (f.EMaxKg is null || eKg <= f.EMaxKg);
            bool nOk = n >= f.NMin && n <= f.NMax;
            bool compat = eOk && nOk;
            string motivo;
            if (compat) motivo = $"n = {n:N0} cabe e e = {eG:0.####} g está na faixa";
            else if (!eOk) motivo = $"e = {eG:0.####} g fora da faixa de divisão";
            else motivo = $"n = {n:N0} fora do intervalo {f.NMin:N0}–{(f.NMax == long.MaxValue ? "∞" : f.NMax.ToString("N0"))}";
            memoria.Add(new PassoMemoria(f.Classe, f.Descricao, compat, motivo));
            if (compat && !compativeis.Contains(f.Classe)) compativeis.Add(f.Classe);
        }

        // Sugestão: discrimina por valor de e (comercial vs precisão)
        string sugerida;
        if (tipo is "rodoviaria" or "ferroviaria")
            sugerida = "III";
        else if (compativeis.Count == 0)
            sugerida = (eG < 0.001m && n >= 50_000) ? "I" : "III";
        else if (eG < 0.1m)
            // precisão: prefere a mais exigente
            sugerida = compativeis.Contains("I") ? "I"
                     : compativeis.Contains("II") ? "II" : compativeis[0];
        else
            // comercial/industrial: prefere III, depois IIII
            sugerida = compativeis.Contains("III") ? "III"
                     : compativeis.Contains("IIII") ? "IIII" : compativeis[0];

        string? alerta = null;
        if (classeEscolhida is not null && compativeis.Count > 0
            && !compativeis.Contains(classeEscolhida))
            alerta = $"A classe {classeEscolhida} não é compatível com esta " +
                     $"capacidade e divisão (n = {n:N0}). Classes compatíveis: " +
                     $"{string.Join(", ", compativeis)}. Confira a placa da balança.";

        string resumo = $"n = Capacidade ÷ e = {capacidadeKg:0.####} kg ÷ {eG:0.####} g = {n:N0} divisões";

        return new Resultado(n, compativeis, sugerida, alerta, memoria, resumo);
    }

    public static Resultado ClassificarMulti(
        List<(decimal limiteKg, decimal eKg)> faixas, string tipo, string? classeEscolhida)
    {
        if (faixas.Count == 0)
            return new Resultado(0, new List<string>(), "III", null, new List<PassoMemoria>(), "");

        long nMax = faixas.Max(f => f.eKg > 0 ? (long)Math.Round(f.limiteKg / f.eKg) : 0);

        List<string>? intersec = null;
        var memoria = new List<PassoMemoria>();
        int idx = 0;
        foreach (var (limiteKg, eKg) in faixas)
        {
            idx++;
            long nFaixa = eKg > 0 ? (long)Math.Round(limiteKg / eKg) : 0;
            decimal eG = eKg * 1000;
            var compat = new List<string>();
            foreach (var f in Tabela)
            {
                bool ok = eKg >= f.EMinKg && (f.EMaxKg is null || eKg <= f.EMaxKg)
                          && nFaixa >= f.NMin && nFaixa <= f.NMax;
                if (ok && !compat.Contains(f.Classe)) compat.Add(f.Classe);
            }
            memoria.Add(new PassoMemoria($"Faixa {idx}",
                $"limite {limiteKg:0.###} kg, e = {eG:0.####} g, n = {nFaixa:N0}",
                compat.Count > 0, compat.Count > 0 ? $"compatível: {string.Join(", ", compat)}" : "nenhuma classe"));
            intersec = intersec is null ? compat : intersec.Where(c => compat.Contains(c)).ToList();
        }
        var compativeis = intersec ?? new List<string>();

        string sugerida = tipo is "rodoviaria" or "ferroviaria"
            ? "III"
            : compativeis.Contains("III") ? "III" : compativeis.FirstOrDefault() ?? "III";

        string? alerta = null;
        if (classeEscolhida is not null && compativeis.Count > 0
            && !compativeis.Contains(classeEscolhida))
            alerta = $"A classe {classeEscolhida} não é compatível com as faixas " +
                     $"cadastradas (multi-intervalo). Classes compatíveis: " +
                     $"{string.Join(", ", compativeis)}. Confira a placa da balança.";

        return new Resultado(nMax, compativeis, sugerida, alerta, memoria,
            $"Multi-intervalo: interseção das classes de cada faixa (n máx = {nMax:N0})");
    }
}
