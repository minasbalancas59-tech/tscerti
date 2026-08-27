
// ── Records do certificado RBC (ISO/IEC 17025) ─────────────
public record LinhaResultadoRbc(decimal Carga, decimal Media, decimal Erro,
    decimal U, decimal K, decimal? Veff);
public record LinhaExcRbc(string Posicao, decimal Media, decimal Erro);
public record LinhaMobRbc(int Ordem, decimal Leitura);
public record LinhaPesoRbc(int OrdemPonto, string Identificacao, string? ValorNominal,
    decimal? Convencional, decimal? Incerteza, string? NumCertificado);
public record DadosRbc(string? NumAcreditacao, decimal? Pressao,
    decimal? MobCargaRef, decimal? MobDivisao, decimal? MobEsperado,
    decimal? MaiorErroExc,
    List<LinhaResultadoRbc> Resultados, List<LinhaExcRbc> Excentricidade,
    List<LinhaMobRbc> Mobilidade, List<LinhaPesoRbc> PesosRbc);
