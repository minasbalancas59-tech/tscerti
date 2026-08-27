namespace CertSaas.Api.Certificados;

/// <summary>
/// Motor de incerteza para calibração RBC (acreditada ISO/IEC 17025),
/// seguindo EURAMET cg-18 / DOQ-Cgcre-097. Rigor máximo: 5 componentes
/// combinadas em quadratura, com graus de liberdade efetivos (veff)
/// por Welch-Satterthwaite.
///
/// Para CADA ponto de carga:
///   u_c = √(u_rep² + u_res² + u_pad² + u_exc² + u_buoy²)
///   U   = k · u_c        (k obtido de veff, ~95,45%)
///
/// É um módulo PURO (recebe números, retorna números) — testável
/// isoladamente e validável contra exemplos publicados. Não toca em
/// banco, interface ou coleta.
/// </summary>
public static class IncertezaRbc
{
    /// <summary>Resultado do orçamento de incerteza de um ponto de carga.</summary>
    public record OrcamentoPonto(
        double Media,          // média das N leituras
        double Erro,           // média - carga convencional
        double DesvioRep,      // desvio padrão amostral das leituras
        double U_rep,          // componente repetibilidade
        double U_res,          // componente resolução
        double U_pad,          // componente padrão (pesos)
        double U_exc,          // componente excentricidade
        double U_sub,          // componente substituição (degraus)
        double U_buoy,         // componente empuxo do ar
        double U_c,            // incerteza combinada
        double Veff,           // graus de liberdade efetivos
        double K,              // fator de abrangência
        double U);             // incerteza expandida (U = k·u_c)

    /// <summary>
    /// Densidade do ar (kg/m³) pela fórmula CIPM-2007 simplificada
    /// (EURAMET cg-18, Apêndice A1.1):
    ///   ρa = (0,34848·p − 0,009·H·exp(0,061·t)) / (273,15 + t)
    /// p em hPa, t em °C, H em % de umidade relativa.
    /// </summary>
    public static double DensidadeAr(double tempC, double pressaoHpa, double umidadePct)
    {
        return (0.34848 * pressaoHpa - 0.009 * umidadePct * Math.Exp(0.061 * tempC))
               / (273.15 + tempC);
    }

    /// <summary>
    /// Incerteza devida ao empuxo do ar (EURAMET cg-18, App. E).
    /// ATENÇÃO: é a INCERTEZA da correção de empuxo, não o valor da
    /// correção. Vem da incerteza da densidade do ar u(ρa) e da
    /// densidade do material do peso:
    ///   u_buoy ≈ carga · u(ρa) / ρpeso
    /// u(ρa) é estimada como ~0,12% de ρa (fórmula CIPM-2007 + sensores
    /// comuns de T/p/UR). Para balanças classe III o resultado é
    /// desprezível (ordem de µg), como esperado; torna-se relevante só
    /// em analíticas de alta precisão.
    /// </summary>
    public static double IncertezaEmpuxo(double carga, double densidadeAr,
        double densidadePeso)
    {
        if (densidadePeso <= 0) densidadePeso = 8000;
        // incerteza da densidade do ar: ~0,12% de ρa (CIPM-2007 + sensores)
        double uRhoAr = 0.0012 * densidadeAr;
        // u_buoy = carga · u(ρa) / ρpeso
        return carga * uRhoAr / densidadePeso;
    }

    /// <summary>
    /// Calcula o orçamento de incerteza completo de um ponto de carga.
    /// </summary>
    /// <param name="leituras">N indicações do ponto (repetibilidade)</param>
    /// <param name="valorConvencional">massa convencional do padrão no ponto (do certificado)</param>
    /// <param name="divisao">divisão (d) da balança — resolução</param>
    /// <param name="uPadrao">incerteza padrão do certificado do peso = U_cert/k_cert</param>
    /// <param name="erroExcentricidade">maior erro absoluto do ensaio de excentricidade</param>
    /// <param name="tempC">temperatura (°C)</param>
    /// <param name="pressaoHpa">pressão (hPa)</param>
    /// <param name="umidadePct">umidade relativa (%)</param>
    /// <param name="densidadePeso">densidade do material do peso (kg/m³)</param>
    public static OrcamentoPonto Calcular(
        IReadOnlyList<double> leituras,
        double valorConvencional,
        double divisao,
        double uPadrao,
        double erroExcentricidade,
        double tempC, double pressaoHpa, double umidadePct,
        double densidadePeso,
        int degrausSub = 0, double fatorSub = 1.0)
    {
        int n = leituras.Count;
        double media = leituras.Count > 0 ? leituras.Average() : 0;
        double erro = media - valorConvencional;

        // (1) Repetibilidade: desvio padrão amostral / √n
        double s = 0;
        if (n >= 2)
        {
            double m = media;
            double soma = leituras.Sum(x => (x - m) * (x - m));
            s = Math.Sqrt(soma / (n - 1));
        }
        double uRep = n >= 2 ? s / Math.Sqrt(n) : 0;

        // (2) Resolução: distribuição retangular da meia-divisão, em 2 pontos (zero + carga)
        //     u_res = √2 · (d / (2·√3))
        double uRes = Math.Sqrt(2) * (divisao / (2 * Math.Sqrt(3)));

        // (3) Padrão: incerteza do certificado do peso (já vem como U/k)
        double uPad = uPadrao;

        // (4) Excentricidade: retangular sobre o maior erro observado
        double uExc = Math.Abs(erroExcentricidade) / Math.Sqrt(3);

        // (5) Empuxo do ar (CIPM-2007)
        double rhoAr = DensidadeAr(tempC, pressaoHpa, umidadePct);
        double uBuoy = IncertezaEmpuxo(valorConvencional, rhoAr, densidadePeso);

        // (6) MÉTODO DA SUBSTITUIÇÃO (João, 14/08/2026)
        // Cada degrau reintroduz a incerteza de repetibilidade: a reprodução
        // da indicação com a carga auxiliar não é perfeita. Degraus são
        // independentes → somam em quadratura (√n).
        //   u_sub = fator · √(degraus) · s_rep
        // FATOR configurável em empresa.rbc_fator_sub (padrão 1,0 = s integral,
        // conservador) até confirmar a referência normativa com a Cgcre.
        double uSub = (degrausSub > 0 && s > 0)
            ? fatorSub * Math.Sqrt(degrausSub) * s
            : 0;

        // Combinada
        double uc = Math.Sqrt(uRep*uRep + uRes*uRes + uPad*uPad + uExc*uExc
                              + uBuoy*uBuoy + uSub*uSub);

        // veff por Welch-Satterthwaite. As componentes tipo B (res, pad,
        // exc, buoy) têm veff→∞ (contribuição desprezível no denominador).
        // Só a repetibilidade (tipo A) tem veff finito = n-1.
        double veff;
        if (uRep > 0 && n >= 2)
        {
            double num = Math.Pow(uc, 4);
            double den = Math.Pow(uRep, 4) / (n - 1); // só o termo tipo A
            veff = den > 0 ? num / den : double.PositiveInfinity;
        }
        else
        {
            veff = double.PositiveInfinity;
        }

        // k a partir de veff (t-Student, 95,45%). Tabela reduzida; se veff
        // alto, k→2. Aproximação de Student para 95,45%.
        double k = KDeVeff(veff);

        double U = k * uc;

        return new OrcamentoPonto(media, erro, s, uRep, uRes, uPad, uExc, uSub, uBuoy,
                                  uc, veff, k, U);
    }

    /// <summary>
    /// Fator k para 95,45% a partir dos graus de liberdade efetivos
    /// (t-Student). Valores da tabela EA-4/02 / GUM. Interpola linear.
    /// </summary>
    public static double KDeVeff(double veff)
    {
        if (double.IsInfinity(veff) || veff >= 100) return 2.00;
        // tabela (veff, k) para 95,45%
        (double v, double k)[] tab =
        {
            (1, 13.97), (2, 4.53), (3, 3.31), (4, 2.87), (5, 2.65),
            (6, 2.52), (7, 2.43), (8, 2.37), (10, 2.28), (12, 2.23),
            (14, 2.20), (16, 2.17), (18, 2.15), (20, 2.13), (25, 2.11),
            (30, 2.09), (35, 2.07), (40, 2.06), (50, 2.05), (100, 2.025)
        };
        if (veff <= tab[0].v) return tab[0].k;
        for (int i = 0; i < tab.Length - 1; i++)
        {
            if (veff >= tab[i].v && veff <= tab[i+1].v)
            {
                double t = (veff - tab[i].v) / (tab[i+1].v - tab[i].v);
                return tab[i].k + t * (tab[i+1].k - tab[i].k);
            }
        }
        return 2.00;
    }
}
