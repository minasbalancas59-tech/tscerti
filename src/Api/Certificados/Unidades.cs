namespace CertSaas.Api.Certificados;

/// <summary>
/// Unidades de massa e conversões. Os valores são guardados na unidade
/// escolhida pelo usuário; este helper converte entre elas quando um
/// peso padrão (numa unidade) calibra uma balança (em outra).
/// Fator = quantos kg vale 1 unidade.
/// </summary>
public static class Unidades
{
    private static readonly Dictionary<string, decimal> ParaKg = new()
    {
        ["g"] = 0.001m, ["kg"] = 1m, ["t"] = 1000m
    };

    public static decimal FatorKg(string unidade) =>
        ParaKg.GetValueOrDefault(unidade, 1m);

    /// <summary>Converte um valor da unidade de origem para a de destino.</summary>
    public static decimal Converter(decimal valor, string de, string para)
    {
        if (de == para) return valor;
        return valor * FatorKg(de) / FatorKg(para);
    }

    /// <summary>
    /// Casas decimais a exibir, derivadas da divisão da balança.
    /// Ex.: e = 20 → 0 casas; e = 0,5 → 1 casa; e = 0,001 → 3 casas.
    /// </summary>
    public static int CasasDecimais(decimal divisao)
    {
        if (divisao <= 0) return 0;
        // Normaliza removendo zeros à direita e conta as casas restantes
        var s = divisao.ToString(System.Globalization.CultureInfo.InvariantCulture);
        var ponto = s.IndexOf('.');
        if (ponto < 0) return 0;
        return s[(ponto + 1)..].TrimEnd('0').Length;
    }
}
