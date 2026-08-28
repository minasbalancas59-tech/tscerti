using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace CertSaas.Worker;

public record DadosCertificado(
    string Numero, string Empresa, string? NomeFantasia,
    string? EnderecoEmpresa, string? CidadeUfEmpresa,
    string? NumAutorizacao, bool Acreditada, string Metodo, string? TextoPeriodicidade,
    string? TituloDocumento,
    string? TextoRodape, string? CorMarca, string? TextoAutorizacao,
    string Cliente, string? CidadeCliente, string? UfCliente,
    string? EnderecoCliente, string? CnpjCliente,
    string Balanca, string? Marca, string? Modelo, string? NumSerie,
    decimal Capacidade, decimal DivisaoE, string Classe, string? LocalInstalacao,
    string Unidade, int CasasDecimais, string? NumeroInmetro, string? Patrimonio,
    string? PortariaAprovacao, bool MostraValidade, int PeriodicidadeMeses,
    string? NumeroLacre, string? SeloInmetro, string? SubstituiNumero,
    string? LocalTipo, string? LocalDetalhe, bool HouveAjuste,
    DateTime? DataCalibracao, DateTime? DataEmissao,
    decimal? Temperatura, decimal? Umidade, string ContextoEma,
    string Tecnico, string? Aprovador, string? RegistroAprovador,
    string UuidValidacao, string UrlBase,
    string ModeloCert, LinhaSensibilidade? Sensibilidade,
    List<LinhaIndicacao> Indicacao, List<LinhaExc> Excentricidade,
    List<LinhaRep> Repetibilidade, List<LinhaPeso> Pesos,
    List<FaixaPdf>? Faixas = null, DadosRbc? Rbc = null, string? NumSerieIndicador = null,
    bool FazExcentricidade = true, bool FazSensibilidade = true,
    int LogoLargura = 90, int LogoAltura = 55, string? LogoAlinhamento = null,
    string? OrdemServico = null, string? EnderecoCalibracao = null,
    bool MarcaSistema = true,
    List<decimal>? SubCargas = null, string? NotaSubstituicao = null,
    string? InstrucaoIt = null, string? InstrucaoRev = null);

public record LinhaSensibilidade(decimal CargaReferencia, decimal Adicao, decimal ResultadoDisplay);

public record LinhaIndicacao(decimal Carga, decimal? Indicacao, decimal? Erro,
    decimal? Incerteza, decimal? Ema, bool? Aprovado, decimal? IndicacaoAntes = null,
    bool SemLeitura = false, bool SemLeituraAntes = false);
public record LinhaExc(string Posicao, decimal Carga, decimal Indicacao, decimal Erro,
    decimal? Ema = null, bool? Aprovado = null, decimal? IndicacaoAntes = null);
public record LinhaRep(int Medicao, decimal Carga, decimal Indicacao);
public record LinhaPeso(string Identificacao, string? ValorNominal, string Classe,
    string? Unidade, string? NumCertificado, DateTime? DataCalibracao, DateTime? Validade, string? Laboratorio);
public record FaixaPdf(int Ordem, decimal LimiteSup, decimal DivisaoE);


// ── Records do certificado RBC (ISO/IEC 17025) ─────────────
public record LinhaResultadoRbc(decimal Carga, decimal Media, decimal Erro,
    decimal U, decimal K, decimal? Veff,
    decimal? URep = null, decimal? URes = null, decimal? UPad = null,
    decimal? UExc = null, decimal? UBuoy = null, decimal? USub = null,
    decimal? UC = null, int? DegrausSub = null);
public record LinhaExcRbc(string Posicao, decimal Media, decimal Erro);
public record LinhaMobRbc(int Ordem, decimal Leitura);
public record LinhaPesoRbc(int OrdemPonto, string Identificacao, string? ValorNominal,
    decimal? Convencional, decimal? Incerteza, string? NumCertificado);
public record DadosRbc(string? NumAcreditacao, decimal? Pressao,
    decimal? MobCargaRef, decimal? MobDivisao, decimal? MobEsperado,
    decimal? MaiorErroExc,
    List<LinhaResultadoRbc> Resultados, List<LinhaExcRbc> Excentricidade,
    List<LinhaMobRbc> Mobilidade, List<LinhaPesoRbc> PesosRbc);

public static class GeradorPdf
{
    static GeradorPdf() => QuestPDF.Settings.License = LicenseType.Community;

    const string Verde = "#0d3b2e";
    static System.Globalization.CultureInfo Pt =>
        new("pt-BR");
    // Formata na quantidade de casas da divisão da balança
    static string Val(decimal? v, int casas) => v is null ? "—" :
        v.Value.ToString("N" + casas, Pt);

    // Texto do local da calibração conforme terminologia metrológica
    // Gera o desenho de excentricidade (retângulo com X + círculo, 5 posições
    // numeradas) como PNG via SkiaSharp. Cor das bolinhas = cor da marca.
    // Retorna null se algo falhar (o PDF então sai sem o desenho).
    static byte[]? DesenhoExcPng(string corHex)
    {
        try
        {
            // 3 desenhos lado a lado: retângulo, círculo e RODOVIÁRIA
            int W = 820, H = 240;
            using var bmp = new SkiaSharp.SKBitmap(W, H);
            using var cv = new SkiaSharp.SKCanvas(bmp);
            cv.Clear(SkiaSharp.SKColors.Transparent);

            var preto = new SkiaSharp.SKPaint { Color = SkiaSharp.SKColors.Black, IsAntialias = true, StrokeWidth = 2, Style = SkiaSharp.SKPaintStyle.Stroke };
            var linha = new SkiaSharp.SKPaint { Color = new SkiaSharp.SKColor(0x33, 0x33, 0x33), IsAntialias = true, StrokeWidth = 1.4f, Style = SkiaSharp.SKPaintStyle.Stroke };
            var corMarca = SkiaSharp.SKColor.TryParse(corHex, out var cc) ? cc : new SkiaSharp.SKColor(0x0d, 0x3b, 0x2e);
            var fill = new SkiaSharp.SKPaint { Color = SkiaSharp.SKColors.White, IsAntialias = true, Style = SkiaSharp.SKPaintStyle.Fill };
            var borda = new SkiaSharp.SKPaint { Color = new SkiaSharp.SKColor(0x33, 0x33, 0x33), IsAntialias = true, StrokeWidth = 1.4f, Style = SkiaSharp.SKPaintStyle.Stroke };
            var texto = new SkiaSharp.SKPaint { Color = SkiaSharp.SKColors.Black, IsAntialias = true, TextSize = 20, TextAlign = SkiaSharp.SKTextAlign.Center, FakeBoldText = true };

            void Bolinha(float x, float y, string n, float r = 17)
            {
                cv.DrawCircle(x, y, r, fill);
                cv.DrawCircle(x, y, r, borda);
                cv.DrawText(n, x, y + 7, texto);
            }

            // ── Retângulo com X ──
            float rx = 20, ry = 40, rw = 240, rh = 150;
            cv.DrawRect(rx, ry, rw, rh, preto);
            float cx = rx + rw / 2, cy = ry + rh / 2, m = 30;
            var cantos = new (float x, float y, string n)[] {
                (rx + m, ry + m, "3"), (rx + rw - m, ry + m, "4"),
                (rx + m, ry + rh - m, "2"), (rx + rw - m, ry + rh - m, "5")
            };
            foreach (var p in cantos) cv.DrawLine(cx, cy, p.x, p.y, linha);
            Bolinha(cx, cy, "1", 19);
            foreach (var p in cantos) Bolinha(p.x, p.y, p.n);

            // ── Círculo com X ──
            float ccx = 400, ccy = cy, R = 90;
            cv.DrawCircle(ccx, ccy, R, preto);
            double[] angs = { 135, 45, 225, 315 };
            string[] nums = { "3", "4", "2", "5" };
            float rpos = R - 26;
            var pc = new (float x, float y, string n)[4];
            for (int i = 0; i < 4; i++)
            {
                float px = ccx + rpos * (float)System.Math.Cos(angs[i] * System.Math.PI / 180);
                float py = ccy - rpos * (float)System.Math.Sin(angs[i] * System.Math.PI / 180);
                pc[i] = (px, py, nums[i]);
                cv.DrawLine(ccx, ccy, px, py, linha);
            }
            Bolinha(ccx, ccy, "1", 19);
            foreach (var p in pc) Bolinha(p.x, p.y, p.n);

            // ── Rodoviária: 6 posições em serpentina ──
            // A carga percorre a ponte na ida (1→2→3, faixa de cima) e volta
            // (4→5→6, faixa de baixo) — é como o ensaio é conduzido na prática.
            float px0 = 520, py0 = 55, pw = 280, ph = 130;
            cv.DrawRect(px0, py0, pw, ph, preto);
            // linha central discreta
            using (var trac = new SkiaSharp.SKPaint {
                Color = new SkiaSharp.SKColor(0xcc, 0xcc, 0xcc), IsAntialias = true,
                StrokeWidth = 1f, Style = SkiaSharp.SKPaintStyle.Stroke,
                PathEffect = SkiaSharp.SKPathEffect.CreateDash(new float[] { 5, 4 }, 0) })
                cv.DrawLine(px0 + 6, py0 + ph / 2, px0 + pw - 6, py0 + ph / 2, trac);

            float passo = pw / 4f;
            float yCima = py0 + 34, yBaixo = py0 + ph - 34;
            var rod = new (float x, float y, string n)[] {
                (px0 + passo,     yCima,  "1"), (px0 + passo * 2, yCima,  "2"),
                (px0 + passo * 3, yCima,  "3"), (px0 + passo * 3, yBaixo, "4"),
                (px0 + passo * 2, yBaixo, "5"), (px0 + passo,     yBaixo, "6")
            };
            // setas do percurso (ida, curva na ponta, volta)
            void Seta(float x1, float y1, float x2, float y2)
            {
                cv.DrawLine(x1, y1, x2, y2, linha);
                float ang = (float)System.Math.Atan2(y2 - y1, x2 - x1);
                var pt = new SkiaSharp.SKPath();
                pt.MoveTo(x2, y2);
                pt.LineTo(x2 - 8 * (float)System.Math.Cos(ang - 0.4), y2 - 8 * (float)System.Math.Sin(ang - 0.4));
                pt.LineTo(x2 - 8 * (float)System.Math.Cos(ang + 0.4), y2 - 8 * (float)System.Math.Sin(ang + 0.4));
                pt.Close();
                using var pf = new SkiaSharp.SKPaint {
                    Color = new SkiaSharp.SKColor(0x33, 0x33, 0x33),
                    IsAntialias = true, Style = SkiaSharp.SKPaintStyle.Fill };
                cv.DrawPath(pt, pf);
            }
            Seta(rod[0].x + 19, yCima, rod[1].x - 19, yCima);
            Seta(rod[1].x + 19, yCima, rod[2].x - 19, yCima);
            Seta(rod[2].x, yCima + 19, rod[3].x, yBaixo - 19);      // desce
            Seta(rod[3].x - 19, yBaixo, rod[4].x + 19, yBaixo);
            Seta(rod[4].x - 19, yBaixo, rod[5].x + 19, yBaixo);
            foreach (var p in rod) Bolinha(p.x, p.y, p.n);

            // rótulo do desenho da rodoviária
            using (var rot = new SkiaSharp.SKPaint {
                Color = new SkiaSharp.SKColor(0x66, 0x66, 0x77), IsAntialias = true,
                TextSize = 15, TextAlign = SkiaSharp.SKTextAlign.Center })
                cv.DrawText("rodoviária", px0 + pw / 2, py0 + ph + 26, rot);

            using var img = SkiaSharp.SKImage.FromBitmap(bmp);
            using var data = img.Encode(SkiaSharp.SKEncodedImageFormat.Png, 100);
            return data.ToArray();
        }
        catch { return null; }
    }

    static string LocalTexto(DadosCertificado d)
    {
        var baseTexto = d.LocalTipo == "laboratorio"
            ? "Laboratório (instalações do emissor)"
            : "In loco (instalações do cliente)";
        // Endereço escolhido na calibração (quando o cliente tem mais de uma
        // unidade). Vem congelado do momento do ensaio.
        var partes = new List<string>();
        if (!string.IsNullOrWhiteSpace(d.EnderecoCalibracao)) partes.Add(d.EnderecoCalibracao!);
        if (!string.IsNullOrWhiteSpace(d.LocalDetalhe)) partes.Add(d.LocalDetalhe!);
        return partes.Count == 0 ? baseTexto : $"{baseTexto} — {string.Join(" · ", partes)}";
    }

    // Assinatura discreta do sistema no rodapé. Fica em cinza claro e fonte
    // mínima: quem procura, encontra; quem não procura, não se incomoda.
    // No PDF vale o endereço: quem lê o papel não tem link para clicar.
    // No papel, endereço curto: ninguém digita URL com parâmetro.
    const string MarcaTexto = "Emitido com TSCert · certificados.totalscale.com.br/tscert.html";

    // Ordem de serviço: só aparece no certificado quando preenchida.
    static string? OsTexto(DadosCertificado d) =>
        string.IsNullOrWhiteSpace(d.OrdemServico) ? null : $"Ordem de serviço: {d.OrdemServico}";

    public static byte[] Gerar(DadosCertificado d, byte[]? qrPng, byte[]? logoPng = null,
        byte[]? assinTecnico = null, byte[]? assinAprovador = null, string? marcaDagua = null,
        byte[]? seloRbc = null)
    {
        // Cor da marca da empresa (Nível 1); cai no verde padrão se vazia/inválida
        var cor = string.IsNullOrWhiteSpace(d.CorMarca) ? Verde : d.CorMarca!;
        if (!System.Text.RegularExpressions.Regex.IsMatch(cor, "^#[0-9A-Fa-f]{6}$"))
            cor = Verde;

        // Certificado RBC (acreditado) tem layout e conteúdo próprios
        if (d.Rbc is not null)
            return GerarModeloRbc(d, qrPng, logoPng, assinTecnico, assinAprovador, marcaDagua, cor, seloRbc);

        // Modelo 4 (formulário em caixas) tem layout próprio
        if (d.ModeloCert == "formulario4")
            return GerarModelo4(d, qrPng, logoPng, assinTecnico, assinAprovador, marcaDagua, cor);

        // Modelo 3 (formulário) tem layout próprio
        if (d.ModeloCert == "formulario")
            return GerarModelo3(d, qrPng, logoPng, assinTecnico, assinAprovador, marcaDagua, cor);

        return Document.Create(doc =>
        {
            doc.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(0.9f, Unit.Centimetre);
                page.DefaultTextStyle(x => x.FontSize(9).FontColor("#1c2b33"));

                // Marca d'água diagonal (ex.: "TESTE" no preview)
                if (!string.IsNullOrEmpty(marcaDagua))
                    page.Foreground().AlignCenter().AlignMiddle()
                        .Rotate(-35).Text(marcaDagua)
                        .FontSize(120).Bold().FontColor("#20E53935");

                // ── Cabeçalho ──────────────────────────────────
                page.Header().Column(col =>
                {
                    col.Item().Row(row =>
                    {
                        // Logo à esquerda (se houver), ao lado dos dados da empresa
                        if (logoPng is not null)
                        {
                            // Tamanho e alinhamento vindos das Configurações da empresa
                            var logoCel = row.ConstantItem(Math.Clamp(d.LogoLargura, 30, 200)).PaddingRight(8);
                            logoCel = d.LogoAlinhamento switch
                            { "centro" => logoCel.AlignMiddle(), "base" => logoCel.AlignBottom(), _ => logoCel };
                            logoCel.MaxHeight(Math.Clamp(d.LogoAltura, 20, 120)).Image(logoPng).FitArea();
                        }
                        row.RelativeItem().Column(c =>
                        {
                            c.Item().Text(d.NomeFantasia ?? d.Empresa).FontSize(14).Bold().FontColor(cor);
                            if (!string.IsNullOrWhiteSpace(d.NomeFantasia) && d.NomeFantasia != d.Empresa)
                                c.Item().Text(d.Empresa).FontSize(8).FontColor("#555555");
                            if (d.EnderecoEmpresa is not null)
                                c.Item().Text(d.EnderecoEmpresa).FontSize(8);
                            if (d.CidadeUfEmpresa is not null)
                                c.Item().Text(d.CidadeUfEmpresa).FontSize(8);
                            if (!string.IsNullOrWhiteSpace(d.TextoAutorizacao))
                                c.Item().Text(d.TextoAutorizacao).FontSize(8);
                        });
                        row.ConstantItem(180).Column(c =>
                        {
                            c.Item().AlignRight().Text(d.TituloDocumento ?? "CERTIFICADO DE CONFORMIDADE")
                                .FontSize(12).Bold().FontColor(cor);
                            c.Item().AlignRight().Text($"Nº {d.Numero}").FontSize(11).Bold();
                            c.Item().AlignRight().Text(
                                $"Emissão: {d.DataEmissao:dd/MM/yyyy}").FontSize(8);
                            if (d.SubstituiNumero is not null)
                                c.Item().AlignRight().Text($"Substitui o certificado {d.SubstituiNumero}")
                                    .FontSize(8).FontColor("#b02a37");
                        });
                    });
                    col.Item().PaddingTop(4).LineHorizontal(1.5f).LineColor(cor);
                });

                page.Content().PaddingVertical(3).Column(col =>
                {
                    col.Spacing(3.5f);

                    // ── Dados do cliente e instrumento ─────────
                    col.Item().Row(row =>
                    {
                        row.RelativeItem().Border(0.5f).BorderColor("#ccc").Padding(5).Column(c =>
                        {
                            c.Item().Text("CLIENTE").FontSize(7).Bold().FontColor("#667");
                            c.Item().Text(d.Cliente).Bold();
                            if (d.CnpjCliente is not null)
                                c.Item().Text($"CNPJ: {d.CnpjCliente}").FontSize(8);
                            if (d.EnderecoCliente is not null)
                                c.Item().Text(d.EnderecoCliente).FontSize(8);
                            c.Item().Text($"{d.CidadeCliente ?? ""} {d.UfCliente ?? ""}".Trim()).FontSize(8);
                            c.Item().PaddingTop(3).Text($"Local da calibração: {LocalTexto(d)}").FontSize(8);
                        });
                        row.ConstantItem(8);
                        row.RelativeItem().Border(0.5f).BorderColor("#ccc").Padding(5).Column(c =>
                        {
                            c.Item().Text("INSTRUMENTO").FontSize(7).Bold().FontColor("#667");
                            var marcaModelo = $"{d.Marca ?? ""} {d.Modelo ?? ""}".Trim();
                            c.Item().Text(marcaModelo.Length > 0 ? marcaModelo : "—").Bold();
                            if (d.Marca is not null)
                                c.Item().Text($"Marca: {d.Marca}").FontSize(8);
                            if (d.Modelo is not null)
                                c.Item().Text($"Modelo: {d.Modelo}").FontSize(8);
                            c.Item().Text($"Identificação: {d.Balanca}  ·  Série: {d.NumSerie ?? "—"}" + (string.IsNullOrWhiteSpace(d.NumSerieIndicador) ? "" : $"  ·  Indicador: {d.NumSerieIndicador}"));
                            if (d.Faixas is { Count: > 0 })
                            {
                                var capF = string.Join(" / ", d.Faixas.Select(f => Val(f.LimiteSup, d.CasasDecimais)));
                                var divF = string.Join(" / ", d.Faixas.Select(f => Val(f.DivisaoE, d.CasasDecimais)));
                                c.Item().Text($"Cap.: {capF} {d.Unidade}  ·  e = {divF} {d.Unidade}  ·  Classe {d.Classe}");
                            }
                            else
                                c.Item().Text($"Cap.: {Val(d.Capacidade, d.CasasDecimais)} {d.Unidade}  ·  e = {Val(d.DivisaoE, d.CasasDecimais)} {d.Unidade}  ·  Classe {d.Classe}");
                            if (d.NumeroInmetro is not null || d.Patrimonio is not null)
                                c.Item().Text($"Inmetro: {d.NumeroInmetro ?? "-"}  ·  Patrimônio: {d.Patrimonio ?? "-"}").FontSize(8);
                            if (d.PortariaAprovacao is not null)
                                c.Item().Text($"Portaria de aprovação: {d.PortariaAprovacao}").FontSize(8);
                            if (d.NumeroLacre is not null || d.SeloInmetro is not null)
                                c.Item().Text($"Lacre: {d.NumeroLacre ?? "-"}  ·  Selo Inmetro: {d.SeloInmetro ?? "-"}").FontSize(8);
                            if (OsTexto(d) is { } osTxt)
                                c.Item().Text(osTxt).FontSize(8);
                        });
                    });

                    col.Item().Row(row =>
                    {
                        row.RelativeItem().Text($"Data da calibração: {(d.DataCalibracao is null ? "—" : d.DataCalibracao.Value.ToString("dd/MM/yyyy"))}");
                        row.RelativeItem().Text($"Temperatura: {(d.Temperatura is null ? "—" : d.Temperatura.Value.ToString("0.##", Pt) + " °C")}");
                        row.RelativeItem().Text($"Umidade: {(d.Umidade is null ? "—" : d.Umidade.Value.ToString("0.##", Pt) + " %")}");
                    });
                    if (d.MostraValidade && d.DataCalibracao is not null && d.PeriodicidadeMeses > 0)
                        col.Item().Text($"Periodicidade da calibração: {d.PeriodicidadeMeses} meses  ·  Próxima calibração recomendada até {d.DataCalibracao.Value.AddMonths(d.PeriodicidadeMeses):dd/MM/yyyy}")
                           .FontSize(8);
                    col.Item().Text($"Método: {d.Metodo}").FontSize(8);

                    // ── Indicação ──────────────────────────────
                    col.Item().Text("1 · Ensaio de indicação").Bold().FontColor(cor);
                    if (d.HouveAjuste)
                        col.Item().Text("A balança foi ajustada. São exibidas as leituras antes e depois do ajuste; a avaliação de conformidade refere-se à leitura final (após o ajuste).")
                           .FontSize(7).Italic().FontColor("#667");
                    col.Item().Table(t =>
                    {
                        var completo = d.ModeloCert == "completo";
                        t.ColumnsDefinition(c =>
                        {
                            c.RelativeColumn();                       // Carga
                            if (d.HouveAjuste) c.RelativeColumn();    // Antes
                            c.RelativeColumn();                       // Indicação (depois)
                            c.RelativeColumn(); c.RelativeColumn();   // Erro, Incerteza
                            c.RelativeColumn();                       // EMA
                            if (completo) { c.RelativeColumn(); c.RelativeColumn(); c.RelativeColumn(); } // k, veff, TUR
                            c.RelativeColumn();                       // Situação
                        });
                        void Head(string s) { var cell = t.Cell().Background("#eef3f1").Padding(2.5f);
                            (completo ? cell.AlignCenter() : cell).Text(s).FontSize(8).Bold(); }
                        Head($"Carga ({d.Unidade})");
                        if (d.HouveAjuste) Head($"Antes ajuste ({d.Unidade})");
                        Head(d.HouveAjuste ? $"Após ajuste ({d.Unidade})" : $"Indicação ({d.Unidade})");
                        Head($"Erro ({d.Unidade})");
                        Head($"Incerteza ({d.Unidade})"); Head($"EMA ({d.Unidade})");
                        if (completo) { Head("k"); Head("veff"); Head("TUR"); }
                        Head("Situação");
                        foreach (var l in d.Indicacao)
                        {
                            void C(string s) { var cell = t.Cell().BorderBottom(0.5f).BorderColor("#e6e6e6").Padding(2.5f);
                                (completo ? cell.AlignCenter() : cell).Text(s).FontSize(8); }
                            C(Val(l.Carga, d.CasasDecimais) + (d.SubCargas != null && d.SubCargas.Contains(l.Carga) ? " *" : ""));
                            if (d.HouveAjuste) C(l.SemLeituraAntes ? "sem leitura **"
                                : l.IndicacaoAntes is null ? "—" : Val(l.IndicacaoAntes, d.CasasDecimais));
                            // Ponto SEM LEITURA: o visor nao indicou na carga (Joao, 22/08/2026)
                            C(l.SemLeitura ? "sem leitura **" : Val(l.Indicacao, d.CasasDecimais));
                            C(l.SemLeitura ? "—" : (l.Erro > 0 ? "+" : "") + Val(l.Erro, d.CasasDecimais));
                            C(l.SemLeitura ? "—" : "± " + Val(l.Incerteza, d.CasasDecimais + 1));
                            C("± " + Val(l.Ema, d.CasasDecimais));
                            if (completo)
                            {
                                C(l.SemLeitura ? "—" : "2,00"); C(l.SemLeitura ? "—" : "∞");
                                // TUR = tolerância (EMA) / (2 × incerteza)
                                var tur = (l.Ema is > 0 && l.Incerteza is > 0)
                                    ? (double)l.Ema.Value / (2.0 * (double)l.Incerteza.Value) : 0;
                                C(tur > 0 ? tur.ToString("0.0", System.Globalization.CultureInfo.InvariantCulture).Replace('.', ',') : "—");
                            }
                            var sitCell = t.Cell().BorderBottom(0.5f).BorderColor("#e6e6e6").Padding(2.5f);
                            (completo ? sitCell.AlignCenter() : sitCell)
                                .Text(l.Aprovado is null ? "—" : l.Aprovado.Value ? "Conforme" : "Não conforme")
                                .FontSize(8).FontColor(l.Aprovado == false ? "#b02a37" : "#146c43");
                        }
                    });
                    if (d.ModeloCert == "completo")
                        col.Item().PaddingTop(3).Text("k = fator de abrangência (95%); veff = graus de liberdade efetivos; TUR = tolerância ÷ (2×incerteza). TUR < 3 indica margem reduzida.")
                           .FontSize(6.5f).Italic().FontColor("#667");
                    if (d.Indicacao.Any(x => x.SemLeitura || x.SemLeituraAntes))
                        col.Item().PaddingTop(2).Text("** O instrumento não apresentou indicação no visor durante a aplicação da carga.")
                           .FontSize(6.5f).Italic().FontColor("#b02a37");

                    // ── Excentricidade + Repetibilidade lado a lado ─
                    col.Item().Row(row =>
                    {
                        row.RelativeItem().Column(c =>
                        {
                            c.Item().Text("2 · Excentricidade").Bold().FontColor(cor);
                            if (!d.FazExcentricidade && d.Excentricidade.Count == 0)
                                c.Item().PaddingTop(2).Text("Não aplicável — em razão do tipo do equipamento, este ensaio não é exequível (ex.: balança suspensa/de gancho, sem receptor de carga com múltiplas regiões de apoio).")
                                    .FontSize(7).Italic().FontColor("#667");
                            else
                            c.Item().Table(t =>
                            {
                                // Coluna "antes do ajuste" (igual à indicação): só quando
                                // houve ajuste e alguma posição registrou a leitura antes
                                var excComAntes = d.HouveAjuste && d.Excentricidade.Any(x => x.IndicacaoAntes is not null);
                                t.ColumnsDefinition(cd => { cd.RelativeColumn(); if (excComAntes) cd.RelativeColumn(); cd.RelativeColumn(); cd.RelativeColumn(); cd.RelativeColumn(); });
                                void H(string s) => t.Cell().Background("#eef3f1").Padding(2f).Text(s).FontSize(7).Bold();
                                H("Posição");
                                if (excComAntes) H("Antes ajuste");
                                H(excComAntes ? $"Após ajuste ({d.Unidade})" : $"Indic. ({d.Unidade})"); H("Erro"); H("Situação");
                                int posExc = 1;
                                foreach (var l in d.Excentricidade)
                                {
                                    void C(string s) => t.Cell().BorderBottom(0.5f).BorderColor("#e6e6e6").Padding(2f).Text(s).FontSize(7);
                                    C(posExc.ToString() + (l.Posicao == "centro" ? " (ref.)" : ""));
                                    if (excComAntes) C(l.IndicacaoAntes is null ? "—" : Val(l.IndicacaoAntes, d.CasasDecimais));
                                    C(Val(l.Indicacao, d.CasasDecimais));
                                    C((l.Erro > 0 ? "+" : "") + Val(l.Erro, d.CasasDecimais));
                                    if (l.Posicao == "centro")
                                        C("ref.");
                                    else
                                        t.Cell().BorderBottom(0.5f).BorderColor("#e6e6e6").Padding(2f)
                                            .Text(l.Aprovado is null ? "—" : l.Aprovado.Value ? "Conforme" : "Não conforme")
                                            .FontSize(7).FontColor(l.Aprovado == false ? "#b02a37" : "#146c43");
                                    posExc++;
                                }
                            });
                        });
                        row.ConstantItem(10);
                        row.RelativeItem().Column(c =>
                        {
                            c.Item().Text("3 · Repetibilidade").Bold().FontColor(cor);
                            c.Item().Table(t =>
                            {
                                t.ColumnsDefinition(cd => { cd.RelativeColumn(); cd.RelativeColumn(); });
                                void H(string s) => t.Cell().Background("#eef3f1").Padding(2f).Text(s).FontSize(7).Bold();
                                H("Medição"); H($"Indicação ({d.Unidade})");
                                foreach (var l in d.Repetibilidade)
                                {
                                    void C(string s) => t.Cell().BorderBottom(0.5f).BorderColor("#e6e6e6").Padding(2f).Text(s).FontSize(7);
                                    C(l.Medicao.ToString()); C(Val(l.Indicacao, d.CasasDecimais));
                                }
                            });
                            var desenhoExc = DesenhoExcPng(cor);
                            if (desenhoExc is not null)
                                // 165 pt: a imagem passou a ter 3 desenhos (820px de
                                // largura). Com os 105 antigos, cada um ficava com
                                // ~35pt — ilegível, parecendo que sumiu.
                                // FitArea (e não FitWidth): a imagem passou de 520 para
                                // 820 px de largura; com FitWidth o QuestPDF mantinha a
                                // caixa antiga e CORTAVA o terceiro desenho.
                                // A altura acompanha a proporção 820x240.
                                c.Item().AlignRight()
                                    .Width(150).Height(150f * 240f / 820f)
                                    .Image(desenhoExc).FitArea();
                        });
                    });

                    // ── Sensibilidade / mobilidade (Modelos 1 e 2) ─────────
                    // No Modelo 1 (clássico) a seção também aparece — o ensaio
                    // é o mesmo nos dois modelos; só o layout do certificado muda.
                    if (d.Sensibilidade is null && !d.FazSensibilidade)
                    {
                        col.Item().Text("4 · Sensibilidade (mobilidade)").Bold().FontColor(cor);
                        col.Item().Text("Não aplicável — em razão do tipo do equipamento, este ensaio não é exequível.")
                            .FontSize(7).Italic().FontColor("#667");
                    }
                    else if (d.Sensibilidade is { } sn)
                    {
                        col.Item().Text("4 · Sensibilidade (mobilidade)").Bold().FontColor(cor);
                        var esperado = sn.CargaReferencia + sn.Adicao;
                        // Conformidade: o display deve indicar a variação dentro de
                        // meia divisão (0,5e). A adição é 1e, então a tolerância é
                        // metade dela. Comparação por tolerância evita falso "não
                        // conforme" por diferença de arredondamento decimal.
                        var tolerancia = sn.Adicao > 0 ? sn.Adicao / 2m : 0.0000001m;
                        var ok = Math.Abs(sn.ResultadoDisplay - esperado) <= tolerancia;
                        col.Item().Table(t =>
                        {
                            t.ColumnsDefinition(c => { c.RelativeColumn(); c.RelativeColumn();
                                c.RelativeColumn(); c.RelativeColumn(); c.RelativeColumn(); });
                            void H(string s) => t.Cell().Background("#eef3f1").Padding(2f).Text(s).FontSize(7).Bold();
                            void C(string s) => t.Cell().BorderBottom(0.5f).BorderColor("#e6e6e6").Padding(2f).Text(s).FontSize(7);
                            H($"Carga ref. ({d.Unidade})"); H($"Adição 1e ({d.Unidade})");
                            H($"Esperado ({d.Unidade})"); H($"Display ({d.Unidade})"); H("Situação");
                            C(Val(sn.CargaReferencia, d.CasasDecimais));
                            C(Val(sn.Adicao, d.CasasDecimais));
                            C(Val(esperado, d.CasasDecimais));
                            C(Val(sn.ResultadoDisplay, d.CasasDecimais));
                            t.Cell().BorderBottom(0.5f).BorderColor("#e6e6e6").Padding(2f)
                                .Text(ok ? "Conforme" : "Não conforme").FontSize(7)
                                .FontColor(ok ? "#146c43" : "#b02a37");
                        });
                        col.Item().Text("Aplicada a carga de referência e adicionada uma divisão (e); o instrumento deve indicar a variação.")
                           .FontSize(6.5f).Italic().FontColor("#667");
                    }
                    col.Item().Text("Rastreabilidade — padrões utilizados").Bold().FontColor(cor);
                    col.Item().Table(t =>
                    {
                        // Padrão é a coluna dominante (nomes longos numa linha só);
                        // Classe e Certificado ficam justas
                        t.ColumnsDefinition(c => { c.RelativeColumn(3.2f); c.RelativeColumn(0.7f);
                            c.RelativeColumn(1.3f); c.RelativeColumn(); c.RelativeColumn(); });
                        void H(string s) => t.Cell().Background("#eef3f1").Padding(2f).Text(s).FontSize(7).Bold();
                        H("Padrão"); H("Classe"); H("Certificado"); H("Calibrado"); H("Válido até");
                        foreach (var p in d.Pesos)
                        {
                            void C(string s) => t.Cell().BorderBottom(0.5f).BorderColor("#e6e6e6").Padding(2f).Text(s).FontSize(7);
                            C($"{p.Identificacao} ({p.ValorNominal})"); C(p.Classe);
                            C(p.NumCertificado ?? "—");
                            C(p.DataCalibracao?.ToString("dd/MM/yyyy") ?? "—");
                            C(p.Validade?.ToString("dd/MM/yyyy") ?? "—");
                        }
                    });

                    // ── Declaração de conformidade + incerteza ─
                    col.Item().Background("#f5f7f6").Padding(4).DefaultTextStyle(x => x.FontSize(8)).Column(c =>
                    {
                        var ctx = d.ContextoEma == "em_uso" ? "erros máximos admissíveis em serviço (em uso)"
                                                            : "erros máximos admissíveis em verificação subsequente";
                        c.Item().Text(t =>
                        {
                            t.Span("Critério de conformidade: ").Bold();
                            t.Span($"comparação com os {ctx}, conforme Portaria Inmetro nº 157/2022.");
                        });
                        c.Item().Text(t =>
                        {
                            t.Span("Incerteza de medição: ").Bold();
                            t.Span("declarada para fator de abrangência k = 2, correspondente a nível de confiança de aproximadamente 95%, conforme o GUM.");
                        });
                        if (d.TextoPeriodicidade is not null)
                            c.Item().Text(d.TextoPeriodicidade).FontSize(8).Italic();
                    });

                    // ── Assinaturas + QR ───────────────────────
                    col.Item().PaddingTop(4).Row(row =>
                    {
                        row.RelativeItem().Column(c =>
                        {
                            // Assinatura sobre a linha (se houver), senão espaço em branco
                            if (assinTecnico is not null)
                                c.Item().Height(24).AlignCenter().Image(assinTecnico).FitArea();
                            else
                                c.Item().Height(24);
                            c.Item().LineHorizontal(0.5f).LineColor("#333");
                            c.Item().Text(d.Tecnico).FontSize(8);
                            c.Item().Text("Técnico executor").FontSize(7).FontColor("#667");
                        });
                        row.ConstantItem(30);
                        row.RelativeItem().Column(c =>
                        {
                            if (assinAprovador is not null)
                                c.Item().Height(24).AlignCenter().Image(assinAprovador).FitArea();
                            else
                                c.Item().Height(24);
                            c.Item().LineHorizontal(0.5f).LineColor("#333");
                            c.Item().Text(d.Aprovador ?? "—").FontSize(8);
                            c.Item().Text($"Responsável técnico{(d.RegistroAprovador is null ? "" : " · " + d.RegistroAprovador)}").FontSize(7).FontColor("#667");
                        });
                        row.ConstantItem(20);
                        if (qrPng is not null)
                            row.ConstantItem(60).Column(c =>
                            {
                                c.Item().Width(52).Image(qrPng);
                                c.Item().Text("Validar autenticidade").FontSize(6).AlignCenter().FontColor("#667");
                            });
                    });

                    if (!string.IsNullOrWhiteSpace(d.NotaSubstituicao))
                        col.Item().PaddingTop(2).Text(d.NotaSubstituicao).FontSize(6.5f).Italic();
                    if (d.TextoRodape is not null)
                        col.Item().PaddingTop(2).Text(d.TextoRodape).FontSize(6.5f).FontColor("#667");
                });

                // ── Rodapé: paginação + validação ──────────────
                page.Footer().Column(col =>
                {
                    col.Item().LineHorizontal(0.5f).LineColor("#ccc");
                    col.Item().Row(row =>
                    {
                        row.RelativeItem().Text($"Validação: {d.UrlBase}/validar/{d.UuidValidacao}").FontSize(6).FontColor("#667");
                        row.RelativeItem().AlignRight().Text(t =>
                        {
                            t.Span("Certificado ").FontSize(6).FontColor("#667");
                            t.Span(d.Numero).FontSize(6).FontColor("#667");
                            t.Span(" · Página ").FontSize(6).FontColor("#667");
                            t.CurrentPageNumber().FontSize(6).FontColor("#667");
                            t.Span(" de ").FontSize(6).FontColor("#667");
                            t.TotalPages().FontSize(6).FontColor("#667");
                        });
                    if (d.MarcaSistema)
                        col.Item().PaddingTop(1).AlignCenter().Text(MarcaTexto)
                            .FontSize(5).FontColor("#b8c2cc");
                    });
                    col.Item().AlignCenter().Text("— fim do documento —").FontSize(6).FontColor("#aaa");
                });
            });
        }).GeneratePdf();
    }

    // ═══════════════════════════════════════════════════════════
    // MODELO 3 — formato formulário (seções numeradas em caixas).
    // Usa os MESMOS dados da base que os Modelos 1 e 2; muda só o layout.
    // ═══════════════════════════════════════════════════════════
    static byte[] GerarModelo3(DadosCertificado d, byte[]? qrPng, byte[]? logoPng,
        byte[]? assinTecnico, byte[]? assinAprovador, string? marcaDagua, string cor)
    {
        const string cinzaCab = "#eef3f1";
        const string borda = "#b8c4bf";
        var casas = d.CasasDecimais;
        string V(decimal? v) => Val(v, casas);

        // Vencimento (próxima calibração) — mesma regra do Modelo 1/2
        string vencimento = (d.DataCalibracao is not null && d.PeriodicidadeMeses > 0)
            ? d.DataCalibracao.Value.AddMonths(d.PeriodicidadeMeses).ToString("dd/MM/yyyy")
            : "—";
        string dataCal = d.DataCalibracao?.ToString("dd/MM/yyyy") ?? "—";

        return Document.Create(doc =>
        {
            doc.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(1.0f, Unit.Centimetre);
                page.DefaultTextStyle(x => x.FontSize(8).FontColor("#1c2b33"));

                if (!string.IsNullOrEmpty(marcaDagua))
                    page.Foreground().AlignCenter().AlignMiddle()
                        .Rotate(-35).Text(marcaDagua)
                        .FontSize(120).Bold().FontColor("#20E53935");

                // ── Cabeçalho: logo + empresa + título ──
                page.Header().Row(row =>
                {
                    if (logoPng is not null)
                    {
                        var logoCel = row.ConstantItem(Math.Clamp(d.LogoLargura, 30, 200));
                        logoCel = d.LogoAlinhamento switch
                        { "centro" => logoCel.AlignMiddle(), "base" => logoCel.AlignBottom(), _ => logoCel };
                        logoCel.MaxHeight(Math.Clamp(d.LogoAltura, 20, 120)).Image(logoPng).FitArea();
                    }
                    else
                        row.ConstantItem(70);
                    row.RelativeItem().PaddingLeft(8).Column(c =>
                    {
                        c.Item().Text(d.NomeFantasia ?? d.Empresa).FontSize(15).Bold().FontColor(cor);
                        if (!string.IsNullOrWhiteSpace(d.NomeFantasia) && d.NomeFantasia != d.Empresa)
                            c.Item().Text(d.Empresa).FontSize(8).FontColor("#555555");
                        if (!string.IsNullOrWhiteSpace(d.EnderecoEmpresa) || !string.IsNullOrWhiteSpace(d.CidadeUfEmpresa))
                            c.Item().Text($"{d.EnderecoEmpresa} {(string.IsNullOrWhiteSpace(d.CidadeUfEmpresa) ? "" : "— " + d.CidadeUfEmpresa)}".Trim()).FontSize(8);
                        if (!string.IsNullOrWhiteSpace(d.TextoAutorizacao))
                            c.Item().Text(d.TextoAutorizacao).FontSize(8);
                    });
                    row.ConstantItem(180).Column(c =>
                    {
                        c.Item().AlignRight().Text(d.TituloDocumento ?? "CERTIFICADO DE CONFORMIDADE")
                            .FontSize(12).Bold().FontColor(cor);
                        c.Item().AlignRight().Text($"Nº {d.Numero}").FontSize(10).Bold();
                        if (d.DataEmissao is not null)
                            c.Item().AlignRight().Text($"Emissão: {d.DataEmissao.Value:dd/MM/yyyy}").FontSize(7);
                        if (d.SubstituiNumero is not null)
                            c.Item().AlignRight().Text($"Substitui o certificado {d.SubstituiNumero}")
                                .FontSize(7).FontColor("#b02a37");
                    });
                });

                page.Content().PaddingVertical(3).Column(col =>
                {
                    // Helpers de layout do formulário
                    void Barra(string titulo) => col.Item().PaddingTop(1.5f).Background(cor).Padding(2f)
                        .Text(titulo).FontSize(8).Bold().FontColor("#ffffff");

                    void CampoCaixa(QuestPDF.Infrastructure.IContainer cell, string rotulo, string valor) =>
                        cell.Border(0.4f).BorderColor(borda).Padding(2.5f).Column(cc =>
                        {
                            cc.Item().Text(rotulo).FontSize(5.5f).FontColor("#667");
                            cc.Item().Text(string.IsNullOrWhiteSpace(valor) ? "—" : valor).FontSize(8).Bold();
                        });

                    // ── 1. Cliente ──
                    Barra("1 · IDENTIFICAÇÃO DO CLIENTE");
                    col.Item().Row(r =>
                    {
                        CampoCaixa(r.RelativeItem(6), "CLIENTE", d.Cliente);
                        CampoCaixa(r.RelativeItem(4), "CNPJ", d.CnpjCliente ?? "—");
                    });
                    col.Item().Row(r =>
                    {
                        CampoCaixa(r.RelativeItem(6), "ENDEREÇO", d.EnderecoCliente ?? "—");
                        CampoCaixa(r.RelativeItem(4), "CIDADE / UF",
                            $"{d.CidadeCliente ?? ""}{(string.IsNullOrWhiteSpace(d.UfCliente) ? "" : " / " + d.UfCliente)}".Trim());
                    });

                    // ── 2. Instrumento ──
                    Barra("2 · IDENTIFICAÇÃO DO INSTRUMENTO");
                    col.Item().Row(r =>
                    {
                        CampoCaixa(r.RelativeItem(), "MARCA", d.Marca ?? "—");
                        CampoCaixa(r.RelativeItem(), "MODELO", d.Modelo ?? "—");
                        CampoCaixa(r.RelativeItem(), "Nº SÉRIE", (d.NumSerie ?? "—") + (string.IsNullOrWhiteSpace(d.NumSerieIndicador) ? "" : " / " + d.NumSerieIndicador));
                        CampoCaixa(r.RelativeItem(), "IDENTIFICAÇÃO", d.Balanca);
                    });
                    col.Item().Row(r =>
                    {
                        var ehMulti = d.Faixas is { Count: > 0 };
                        var capTxt = ehMulti
                            ? string.Join(" / ", d.Faixas!.Select(f => V(f.LimiteSup)))
                            : V(d.Capacidade);
                        var divTxt = ehMulti
                            ? string.Join(" / ", d.Faixas!.Select(f => V(f.DivisaoE)))
                            : V(d.DivisaoE);
                        CampoCaixa(r.RelativeItem(), $"CAP. MÁX ({d.Unidade})", capTxt);
                        CampoCaixa(r.RelativeItem(), $"DIVISÃO e ({d.Unidade})", divTxt);
                        CampoCaixa(r.RelativeItem(), "CLASSE", d.Classe);
                        CampoCaixa(r.RelativeItem(), "Nº INMETRO", d.NumeroInmetro ?? "—");
                    });

                    // ── 3. Condições, local e datas ──
                    Barra("3 · CONDIÇÕES, LOCAL E DATAS");
                    col.Item().Row(r =>
                    {
                        CampoCaixa(r.RelativeItem(), "TEMPERATURA", d.Temperatura is null ? "—" : d.Temperatura.Value.ToString("0.##", Pt) + " °C");
                        CampoCaixa(r.RelativeItem(), "UMIDADE", d.Umidade is null ? "—" : d.Umidade.Value.ToString("0.##", Pt) + " %");
                        CampoCaixa(r.RelativeItem(2), "MÉTODO", d.Metodo);
                    });
                    col.Item().Row(r =>
                    {
                        CampoCaixa(r.RelativeItem(3), "LOCAL DA CALIBRAÇÃO", LocalTexto(d));
                        CampoCaixa(r.RelativeItem(2), "DATA DA CALIBRAÇÃO", dataCal);
                        CampoCaixa(r.RelativeItem(3), "PRÓXIMA CALIBRAÇÃO (VENCIMENTO)", vencimento);
                    });
                    // Ordem de serviço: linha própria, só quando preenchida
                    if (!string.IsNullOrWhiteSpace(d.OrdemServico))
                        col.Item().Row(r =>
                            CampoCaixa(r.RelativeItem(), "ORDEM DE SERVIÇO", d.OrdemServico!));

                    // ── 4. Ensaio de indicação (com k/veff/TUR) ──
                    Barra("4 · ENSAIO DE INDICAÇÃO");
                    // Mesmo aviso do modelo clássico: sem ele, quem lê não sabe
                    // que a conformidade se refere à leitura APÓS o ajuste.
                    if (d.HouveAjuste && d.Indicacao.Any(x => x.IndicacaoAntes is not null || x.SemLeituraAntes))
                        col.Item().PaddingBottom(3).Text(
                            "A balança foi ajustada. São exibidas as leituras antes e depois do ajuste; " +
                            "a avaliação de conformidade refere-se à leitura final (após o ajuste).")
                            .FontSize(6.5f).Italic().FontColor("#667");
                    col.Item().Table(t =>
                    {
                        // Coluna "Antes ajuste": o modelo clássico já mostrava, o
                        // formulário não — por isso a leitura antes do ajuste sumia
                        // neste modelo. Só aparece quando houve ajuste de verdade.
                        var indComAntes = d.HouveAjuste &&
                            d.Indicacao.Any(x => x.IndicacaoAntes is not null || x.SemLeituraAntes);
                        t.ColumnsDefinition(c =>
                        {
                            c.RelativeColumn();                         // Carga
                            if (indComAntes) c.RelativeColumn();        // Antes do ajuste
                            c.RelativeColumn(); c.RelativeColumn();
                            c.RelativeColumn(); c.RelativeColumn(); c.RelativeColumn();
                            c.RelativeColumn(); c.RelativeColumn(); c.RelativeColumn(1.3f);
                        });
                        void H(string s) => t.Cell().Background(cinzaCab).Border(0.4f).BorderColor(borda)
                            .Padding(2.5f).AlignCenter().Text(s).FontSize(7).Bold();
                        void C(string s, string? fc = null) => t.Cell().Border(0.4f).BorderColor(borda)
                            .Padding(2.5f).AlignCenter().Text(s).FontSize(7).FontColor(fc ?? "#1c2b33");
                        H($"Carga ({d.Unidade})");
                        if (indComAntes) H($"Antes ajuste ({d.Unidade})");
                        H(indComAntes ? $"Após ajuste ({d.Unidade})" : $"Indicação ({d.Unidade})");
                        H($"Erro ({d.Unidade})");
                        H($"Incerteza ({d.Unidade})"); H($"EMA ({d.Unidade})"); H("k"); H("veff"); H("TUR"); H("Situação");
                        foreach (var l in d.Indicacao)
                        {
                            C(V(l.Carga));
                            if (indComAntes) C(l.SemLeituraAntes ? "sem leitura **"
                                : l.IndicacaoAntes is null ? "—" : V(l.IndicacaoAntes));
                            // Ponto SEM LEITURA (Joao, 22/08/2026)
                            C(l.SemLeitura ? "sem leitura **" : V(l.Indicacao));
                            C(l.SemLeitura ? "—" : (l.Erro > 0 ? "+" : "") + V(l.Erro));
                            C(l.SemLeitura ? "—" : "± " + Val(l.Incerteza, casas + 1));
                            C("± " + V(l.Ema));
                            C(l.SemLeitura ? "—" : "2,00"); C(l.SemLeitura ? "—" : "∞");
                            var tur = (l.Ema is > 0 && l.Incerteza is > 0)
                                ? (double)l.Ema.Value / (2.0 * (double)l.Incerteza.Value) : 0;
                            C(tur > 0 ? tur.ToString("0.0", Pt) : "—");
                            C(l.Aprovado is null ? "—" : l.Aprovado.Value ? "Conforme" : "Não conforme",
                                l.Aprovado == false ? "#b02a37" : "#146c43");
                        }
                    });
                    col.Item().PaddingTop(2).Text("k = fator de abrangência (95%); veff = graus de liberdade efetivos; TUR = EMA ÷ (2×incerteza).")
                        .FontSize(6f).Italic().FontColor("#667");

                    if (d.Indicacao.Any(x => x.SemLeitura || x.SemLeituraAntes))
                        col.Item().PaddingTop(2).Text("** O instrumento não apresentou indicação no visor durante a aplicação da carga.")
                            .FontSize(6f).Italic().FontColor("#b02a37");

                    // ── 5. Excentricidade (diagrama + tabela) ──
                    Barra("5 · EXCENTRICIDADE");
                    if (!d.FazExcentricidade && d.Excentricidade.Count == 0)
                        col.Item().Border(0.4f).BorderColor(borda).Padding(3)
                            .Text("Não aplicável — em razão do tipo do equipamento, este ensaio não é exequível (ex.: balança suspensa/de gancho, sem receptor de carga com múltiplas regiões de apoio).")
                            .FontSize(6.5f).Italic().FontColor("#667");
                    else
                    col.Item().Row(r =>
                    {
                        // Desenho de excentricidade (retângulo + círculo, 5 posições)
                        r.RelativeItem(6).AlignMiddle().Column(dc =>
                        {
                            var desenho = DesenhoExcPng(cor);
                            if (desenho is not null)
                                // Largura FIXA: com FitWidth na coluna relativa o
                                // diagrama escalava enorme e empurrava as
                                // assinaturas para a página 2.
                                // 235 pt: a imagem passou a ter 3 desenhos
                                // (820x240 em vez de 520x240) — mantendo 150
                                // eles ficariam espremidos e ilegíveis.
                                dc.Item().AlignCenter()
                                    .Width(235).Height(235f * 240f / 820f)
                                    .Image(desenho).FitArea();
                            dc.Item().PaddingTop(2).AlignCenter().Text("Posições de ensaio na plataforma")
                                .FontSize(5.5f).Italic().FontColor("#667");
                        });
                        r.ConstantItem(8);
                        r.RelativeItem(5).Table(t =>
                        {
                            var excComAntes = d.HouveAjuste && d.Excentricidade.Any(x => x.IndicacaoAntes is not null);
                            t.ColumnsDefinition(c => { c.RelativeColumn(); if (excComAntes) c.RelativeColumn(); c.RelativeColumn(); c.RelativeColumn(); c.RelativeColumn(); });
                            void H(string s) => t.Cell().Background(cinzaCab).Border(0.4f).BorderColor(borda)
                                .Padding(2).AlignCenter().Text(s).FontSize(6.5f).Bold();
                            void C(string s, string? fc = null) => t.Cell().Border(0.4f).BorderColor(borda)
                                .Padding(2).AlignCenter().Text(s).FontSize(6.5f).FontColor(fc ?? "#1c2b33");
                            H("Posição");
                            if (excComAntes) H("Antes ajuste");
                            H(excComAntes ? "Após ajuste" : $"Indic. ({d.Unidade})"); H("Erro"); H("Situação");
                            int pos = 1;
                            foreach (var l in d.Excentricidade)
                            {
                                C(pos.ToString());
                                if (excComAntes) C(l.IndicacaoAntes is null ? "—" : V(l.IndicacaoAntes));
                                C(V(l.Indicacao)); C((l.Erro > 0 ? "+" : "") + V(l.Erro));
                                if (pos == 1) C("ref.");
                                else C(l.Aprovado is null ? "—" : l.Aprovado.Value ? "Conforme" : "Não conforme",
                                    l.Aprovado == false ? "#b02a37" : "#146c43");
                                pos++;
                            }
                        });
                    });

                    // ── 6/7. Repetibilidade + Sensibilidade (títulos alinhados) ──
                    col.Item().PaddingTop(2).Row(r =>
                    {
                        r.RelativeItem().Column(cc =>
                        {
                            cc.Item().Background(cor).Padding(2f).Text("6 · REPETIBILIDADE")
                                .FontSize(8).Bold().FontColor("#ffffff");
                            cc.Item().Table(t =>
                            {
                                t.ColumnsDefinition(c => { c.RelativeColumn(); c.RelativeColumn(); });
                                void H(string s) => t.Cell().Background(cinzaCab).Border(0.4f).BorderColor(borda)
                                    .Padding(2).AlignCenter().Text(s).FontSize(6.5f).Bold();
                                void C(string s) => t.Cell().Border(0.4f).BorderColor(borda)
                                    .Padding(2).AlignCenter().Text(s).FontSize(6.5f);
                                H("Medição"); H($"Indicação ({d.Unidade})");
                                foreach (var l in d.Repetibilidade) { C(l.Medicao.ToString()); C(V(l.Indicacao)); }
                            });
                        });
                        r.ConstantItem(8);
                        r.RelativeItem().Column(cc =>
                        {
                            cc.Item().Background(cor).Padding(2f).Text("7 · SENSIBILIDADE")
                                .FontSize(8).Bold().FontColor("#ffffff");
                            if (d.Sensibilidade is { } sn)
                            {
                                var esperado = sn.CargaReferencia + sn.Adicao;
                                // Conformidade por tolerância de meia divisão (0,5e) — mesma
                                // regra dos Modelos 1/2; igualdade exata dava falso
                                // "Não conforme" por diferença de arredondamento decimal.
                                var tolSens = sn.Adicao > 0 ? sn.Adicao / 2m : 0.0000001m;
                                var ok = Math.Abs(sn.ResultadoDisplay - esperado) <= tolSens;
                                cc.Item().Table(t =>
                                {
                                    t.ColumnsDefinition(c => { c.RelativeColumn(); c.RelativeColumn(); c.RelativeColumn(); c.RelativeColumn(); c.RelativeColumn(); });
                                    void H(string s) => t.Cell().Background(cinzaCab).Border(0.4f).BorderColor(borda)
                                        .Padding(2).AlignCenter().Text(s).FontSize(6f).Bold();
                                    void C(string s, string? fc = null) => t.Cell().Border(0.4f).BorderColor(borda)
                                        .Padding(2).AlignCenter().Text(s).FontSize(6f).FontColor(fc ?? "#1c2b33");
                                    H("Carga ref."); H("Adição 1e"); H("Esperado"); H("Display"); H("Situação");
                                    C(V(sn.CargaReferencia)); C(V(sn.Adicao)); C(V(esperado)); C(V(sn.ResultadoDisplay));
                                    C(ok ? "Conforme" : "Não conforme", ok ? "#146c43" : "#b02a37");
                                });
                            }
                            else if (!d.FazSensibilidade)
                                cc.Item().Border(0.4f).BorderColor(borda).Padding(3)
                                    .Text("Não aplicável — em razão do tipo do equipamento, este ensaio não é exequível.")
                                    .FontSize(6.5f).Italic().FontColor("#667");
                            else cc.Item().Border(0.4f).BorderColor(borda).Padding(3)
                                .Text("Sensibilidade não realizada.").FontSize(6.5f).Italic().FontColor("#667");
                        });
                    });

                    // ── 8. Rastreabilidade ──
                    Barra("8 · RASTREABILIDADE DOS PADRÕES");
                    col.Item().Table(t =>
                    {
                        t.ColumnsDefinition(c => { c.RelativeColumn(4.5f); c.RelativeColumn(0.8f); c.RelativeColumn(1.5f); c.RelativeColumn(1.6f); c.RelativeColumn(1.6f); });
                        void H(string s) => t.Cell().Background(cinzaCab).Border(0.4f).BorderColor(borda)
                            .Padding(2).AlignCenter().Text(s).FontSize(6.5f).Bold();
                        void C(string s) => t.Cell().Border(0.4f).BorderColor(borda).Padding(2).AlignCenter().Text(s).FontSize(6.5f);
                        H("Padrão"); H("Classe"); H("Certificado"); H("Calibrado"); H("Válido até");
                        foreach (var p in d.Pesos)
                        {
                            C($"{p.Identificacao} ({p.ValorNominal})");
                            C(p.Classe); C(p.NumCertificado ?? "—");
                            C(p.DataCalibracao?.ToString("dd/MM/yyyy") ?? "—");
                            C(p.Validade?.ToString("dd/MM/yyyy") ?? "—");
                        }
                    });

                    // ── 9. Observações (texto de rodapé das Configurações) ──
                    // ── Nota do método da substituição (Fase 1) ──
                    if (!string.IsNullOrWhiteSpace(d.NotaSubstituicao))
                        col.Item().PaddingTop(2).Border(0.4f).BorderColor(borda).Padding(4)
                            .Text(d.NotaSubstituicao).FontSize(7).Italic();
                    if (!string.IsNullOrWhiteSpace(d.TextoRodape))
                    {
                        Barra("9 · OBSERVAÇÕES");
                        col.Item().Border(0.4f).BorderColor(borda).Padding(4)
                            .Text(d.TextoRodape).FontSize(7);
                    }

                    // Critério + incerteza
                    var ctxM3 = d.ContextoEma == "em_uso" ? "erros máximos admissíveis em serviço (em uso)"
                                           : "erros máximos admissíveis em verificação subsequente";
                    col.Item().PaddingTop(2).Text($"Critério de conformidade: comparação com os {ctxM3}, conforme Portaria Inmetro nº 157/2022.")
                        .FontSize(7).Bold();
                    col.Item().Text(t =>
                    {
                        t.Span("Incerteza de medição: ").FontSize(6.5f).Bold();
                        t.Span("a incerteza expandida (U) relatada é baseada em uma incerteza padrão combinada multiplicada pelo fator de abrangência k = 2, correspondente a um nível de confiança de aproximadamente 95%, conforme o GUM. O método de calibração empregado consiste na comparação direta com padrões rastreáveis.")
                            .FontSize(6.5f);
                    });

                    // ── Assinaturas + QR (no conteúdo, como Modelo 1/2) ──
                    col.Item().PaddingTop(3).Row(row =>
                    {
                        void Assinatura(QuestPDF.Infrastructure.IContainer cell, byte[]? img, string nome, string papel)
                            => cell.Column(c =>
                            {
                                if (img is not null) c.Item().Height(24).AlignCenter().Image(img).FitArea();
                                else c.Item().Height(24);
                                c.Item().LineHorizontal(0.5f).LineColor("#333");
                                c.Item().Text(nome).FontSize(8);
                                c.Item().Text(papel).FontSize(6.5f).FontColor("#667");
                            });
                        Assinatura(row.RelativeItem(), assinTecnico, d.Tecnico, "Técnico Executor");
                        row.ConstantItem(24);
                        Assinatura(row.RelativeItem(), assinAprovador, d.Aprovador ?? "—",
                            $"Responsável Técnico{(d.RegistroAprovador is null ? "" : " · " + d.RegistroAprovador)}");
                        row.ConstantItem(20);
                        if (qrPng is not null)
                            row.ConstantItem(62).Column(c =>
                            {
                                c.Item().Width(56).Image(qrPng);
                                c.Item().AlignCenter().Text("Validar autenticidade").FontSize(5.5f).FontColor("#667");
                            });
                    });
                });

                // ── Rodapé: só a linha de validação ──
                page.Footer().Column(fc =>
                {
                    fc.Item().AlignCenter()
                      .Text($"Validação: {d.UrlBase}/validar/{d.UuidValidacao}  ·  Certificado {d.Numero}")
                      .FontSize(6).FontColor("#889");
                    if (d.MarcaSistema)
                        fc.Item().AlignCenter().Text(MarcaTexto)
                          .FontSize(5).FontColor("#b8c2cc");
                });
            });
        }).GeneratePdf();
    }

    // ═══════════════════════════════════════════════════════════
    // MODELO RBC — certificado de calibração acreditado (ISO/IEC 17025).
    // Diferente dos demais: DECLARA resultados com incerteza, sem
    // julgamento de conformidade (não há EMA nem "Conforme").
    // ═══════════════════════════════════════════════════════════
    static byte[] GerarModeloRbc(DadosCertificado d, byte[]? qrPng, byte[]? logoPng,
        byte[]? assinTecnico, byte[]? assinAprovador, string? marcaDagua, string cor,
        byte[]? seloRbc)
    {
        var r = d.Rbc!;
        // Casas para incerteza/média: 2 a mais que a divisão (a média cai entre divisões)
        int casasU = d.CasasDecimais + 2;

        return Document.Create(doc =>
        {
            doc.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(0.9f, Unit.Centimetre);
                page.DefaultTextStyle(x => x.FontSize(9).FontColor("#1c2b33"));

                if (!string.IsNullOrEmpty(marcaDagua))
                    page.Foreground().AlignCenter().AlignMiddle()
                        .Rotate(-35).Text(marcaDagua)
                        .FontSize(120).Bold().FontColor("#20E53935");

                // ── Cabeçalho ──────────────────────────────────
                page.Header().Column(col =>
                {
                    col.Item().Row(row =>
                    {
                        if (logoPng is not null)
                        {
                            // Tamanho e alinhamento vindos das Configurações da empresa
                            var logoCel = row.ConstantItem(Math.Clamp(d.LogoLargura, 30, 200)).PaddingRight(8);
                            logoCel = d.LogoAlinhamento switch
                            { "centro" => logoCel.AlignMiddle(), "base" => logoCel.AlignBottom(), _ => logoCel };
                            logoCel.MaxHeight(Math.Clamp(d.LogoAltura, 20, 120)).Image(logoPng).FitArea();
                        }
                        row.RelativeItem().Column(c =>
                        {
                            c.Item().Text(d.NomeFantasia ?? d.Empresa).FontSize(14).Bold().FontColor(cor);
                            if (!string.IsNullOrWhiteSpace(d.NomeFantasia) && d.NomeFantasia != d.Empresa)
                                c.Item().Text(d.Empresa).FontSize(8).FontColor("#555555");
                            if (d.EnderecoEmpresa is not null)
                                c.Item().Text(d.EnderecoEmpresa).FontSize(8);
                            if (d.CidadeUfEmpresa is not null)
                                c.Item().Text(d.CidadeUfEmpresa).FontSize(8);
                        });
                        row.ConstantItem(190).Column(c =>
                        {
                            c.Item().AlignRight().Text("CERTIFICADO DE CALIBRAÇÃO")
                                .FontSize(12).Bold().FontColor(cor);
                            c.Item().AlignRight().Text($"Nº {d.Numero}").FontSize(11).Bold();
                            c.Item().AlignRight().Text($"Emissão: {d.DataEmissao:dd/MM/yyyy}").FontSize(8);
                            if (d.SubstituiNumero is not null)
                                c.Item().AlignRight().Text($"Substitui o certificado {d.SubstituiNumero}")
                                    .FontSize(8).FontColor("#b02a37");
                            if (!string.IsNullOrWhiteSpace(r.NumAcreditacao) || seloRbc is not null)
                                c.Item().PaddingTop(3).Row(rr =>
                                {
                                    rr.RelativeItem().AlignRight().AlignMiddle().Text(
                                        string.IsNullOrWhiteSpace(r.NumAcreditacao) ? "" :
                                        $"Acreditação Cgcre nº {r.NumAcreditacao}")
                                        .FontSize(8).Bold().FontColor(cor);
                                    if (seloRbc is not null)
                                        rr.ConstantItem(58).PaddingLeft(6).MaxHeight(48).Image(seloRbc).FitArea();
                                });
                        });
                    });
                    col.Item().PaddingTop(4).LineHorizontal(1).LineColor(cor);
                });

                page.Content().PaddingVertical(6).Column(col =>
                {
                    col.Spacing(7);

                    // ── Cliente e instrumento ──────────────────
                    col.Item().Row(row =>
                    {
                        row.RelativeItem().Column(c =>
                        {
                            c.Item().Text("CLIENTE").FontSize(7).Bold().FontColor("#667");
                            c.Item().Text(d.Cliente).Bold();
                            if (d.CnpjCliente is not null) c.Item().Text($"CNPJ: {d.CnpjCliente}").FontSize(8);
                            if (d.EnderecoCliente is not null) c.Item().Text(d.EnderecoCliente).FontSize(8);
                            var cidUf = string.Join(" · ", new[] { d.CidadeCliente, d.UfCliente }
                                .Where(x => !string.IsNullOrWhiteSpace(x)));
                            if (cidUf.Length > 0) c.Item().Text(cidUf).FontSize(8);
                            c.Item().PaddingTop(2).Text($"Local da calibração: {LocalTexto(d)}").FontSize(8);
                            if (OsTexto(d) is { } osRbc) c.Item().Text(osRbc).FontSize(8);
                        });
                        row.ConstantItem(14);
                        row.RelativeItem().Column(c =>
                        {
                            c.Item().Text("INSTRUMENTO").FontSize(7).Bold().FontColor("#667");
                            var marcaModelo = $"{d.Marca ?? ""} {d.Modelo ?? ""}".Trim();
                            c.Item().Text(marcaModelo.Length > 0 ? marcaModelo : "—").Bold();
                            c.Item().Text($"Identificação: {d.Balanca}").FontSize(8);
                            if (d.NumSerie is not null) c.Item().Text($"Nº de série: {d.NumSerie}" + (string.IsNullOrWhiteSpace(d.NumSerieIndicador) ? "" : $" · Indicador: {d.NumSerieIndicador}")).FontSize(8);
                            if (d.Faixas is { Count: > 0 })
                            {
                                var capF = string.Join(" / ", d.Faixas.Select(f => Val(f.LimiteSup, d.CasasDecimais)));
                                var divF = string.Join(" / ", d.Faixas.Select(f => Val(f.DivisaoE, d.CasasDecimais)));
                                c.Item().Text($"Capacidade: {capF} {d.Unidade} · e = {divF} {d.Unidade} · Classe {d.Classe}").FontSize(8);
                            }
                            else
                                c.Item().Text($"Capacidade: {Val(d.Capacidade, d.CasasDecimais)} {d.Unidade} · " +
                                              $"e = {Val(d.DivisaoE, d.CasasDecimais)} {d.Unidade} · Classe {d.Classe}").FontSize(8);
                            if (d.NumeroInmetro is not null) c.Item().Text($"Inmetro: {d.NumeroInmetro}").FontSize(8);
                        });
                    });

                    // ── Condições ──────────────────────────────
                    col.Item().Background("#f5f8f7").Padding(5).Row(row =>
                    {
                        void Info(string rot, string? v)
                        {
                            if (string.IsNullOrWhiteSpace(v)) return;
                            row.RelativeItem().Text(t => { t.Span(rot + ": ").FontSize(7.5f).FontColor("#667");
                                t.Span(v).FontSize(8).Bold(); });
                        }
                        Info("Data da calibração", d.DataCalibracao?.ToString("dd/MM/yyyy"));
                        Info("Local", d.LocalTipo == "laboratorio" ? "Laboratório" : "In loco (cliente)");
                        Info("Temperatura", d.Temperatura is null ? null : $"{d.Temperatura:0.0} °C");
                        Info("Umidade", d.Umidade is null ? null : $"{d.Umidade:0} %");
                        Info("Pressão", r.Pressao is null ? null : $"{r.Pressao:0.0} hPa");
                    });

                    // ── Orçamento de incerteza (composição por ponto) ──
                    // Transparência exigida em calibração acreditada: mostra
                    // cada componente que entra na combinação em quadratura.
                    void OrcamentoIncerteza()
                    {
                        if (r.Resultados.Count == 0 || r.Resultados[0].UC is null) return;
                        col.Item().PaddingTop(6).Text("Orçamento de incerteza (componentes)")
                            .Bold().FontColor(cor);
                        col.Item().PaddingBottom(2).Text(
                            "Valores em " + d.Unidade + ", como incerteza-padrão (k = 1). "
                            + "u_c = raiz da soma quadratica dos componentes; U = k · u_c.")
                            .FontSize(6.5f).FontColor("#667");
                        col.Item().Table(t2 =>
                        {
                            t2.ColumnsDefinition(c2 =>
                            {
                                c2.RelativeColumn(1.2f);   // carga
                                for (int i2 = 0; i2 < 6; i2++) c2.RelativeColumn(1f);
                                c2.RelativeColumn(1.1f);   // u_c
                                c2.RelativeColumn(0.8f);   // k
                                c2.RelativeColumn(1.1f);   // U
                            });
                            void H2(string x) => t2.Cell().Background("#eef3f7").Padding(2.5f)
                                .Text(x).FontSize(6.8f).Bold();
                            H2("Carga"); H2("u_rep"); H2("u_res"); H2("u_pad");
                            H2("u_exc"); H2("u_emp"); H2("u_sub"); H2("u_c"); H2("k"); H2("U");
                            foreach (var l in r.Resultados)
                            {
                                void C2(string x) => t2.Cell().BorderBottom(0.5f)
                                    .BorderColor("#e6e6e6").Padding(2.5f).Text(x).FontSize(6.8f);
                                C2(Val(l.Carga, d.CasasDecimais));
                                C2(Val(l.URep, d.CasasDecimais));
                                C2(Val(l.URes, d.CasasDecimais));
                                C2(Val(l.UPad, d.CasasDecimais));
                                C2(Val(l.UExc, d.CasasDecimais));
                                C2(Val(l.UBuoy, d.CasasDecimais));
                                C2(l.DegrausSub is > 0
                                    ? Val(l.USub, d.CasasDecimais) + " *" : Val(l.USub, d.CasasDecimais));
                                C2(Val(l.UC, d.CasasDecimais));
                                C2(l.K.ToString("0.00", Pt));
                                C2("± " + Val(l.U, d.CasasDecimais));
                            }
                        });
                        if (r.Resultados.Any(x => x.DegrausSub is > 0))
                            col.Item().PaddingTop(2).Text(
                                "* Componente do metodo da substituicao: u_sub = f · raiz(N) · s, "
                                + "onde N e o numero de degraus do ponto e s o desvio-padrao "
                                + "da repetibilidade. Pontos com substituicao: "
                                + string.Join(", ", r.Resultados.Where(x => x.DegrausSub is > 0)
                                    .Select(x => Val(x.Carga, d.CasasDecimais) + " (" + x.DegrausSub + ")")))
                                .FontSize(6.5f).Italic().FontColor("#667");
                    }

                    // ── 1 · Resultados (o coração do RBC) ──────
                    col.Item().Text("1 · Resultados da calibração").Bold().FontColor(cor);
                    col.Item().Table(t =>
                    {
                        t.ColumnsDefinition(c =>
                        {
                            c.RelativeColumn(); c.RelativeColumn(); c.RelativeColumn();
                            c.RelativeColumn(); c.ConstantColumn(38);
                        });
                        void Head(string s) => t.Cell().Background("#eef3f1").Padding(4)
                            .AlignCenter().Text(s).FontSize(8).Bold();
                        Head($"Carga ({d.Unidade})"); Head($"Indicação média ({d.Unidade})");
                        Head($"Erro ({d.Unidade})"); Head($"Incerteza U ({d.Unidade})"); Head("k");
                        foreach (var l in r.Resultados)
                        {
                            void C(string s) => t.Cell().BorderBottom(0.5f).BorderColor("#e6e6e6")
                                .Padding(4).AlignCenter().Text(s).FontSize(8);
                            C(Val(l.Carga, d.CasasDecimais));
                            C(Val(l.Media, casasU));
                            C((l.Erro > 0 ? "+" : "") + Val(l.Erro, casasU));
                            C("± " + Val(l.U, casasU));
                            C(Val(l.K, 2));
                        }
                    });
                    OrcamentoIncerteza();
                    col.Item().Text("A incerteza expandida U foi calculada com o fator de abrangência k indicado, " +
                                    "correspondente a uma probabilidade de abrangência de aproximadamente 95,45 %.")
                       .FontSize(7).Italic().FontColor("#667");

                    // ── 2 · Excentricidade e 3 · Mobilidade ────
                    col.Item().Row(row =>
                    {
                        row.RelativeItem().Column(c =>
                        {
                            c.Item().Text("2 · Excentricidade").Bold().FontColor(cor);
                            if (r.Excentricidade.Count == 0)
                                c.Item().Text("Não realizado.").FontSize(8).FontColor("#667");
                            else
                            {
                                c.Item().Table(t =>
                                {
                                    t.ColumnsDefinition(x => { x.RelativeColumn(); x.RelativeColumn(); x.RelativeColumn(); });
                                    void Head(string s) => t.Cell().Background("#eef3f1").Padding(3)
                                        .AlignCenter().Text(s).FontSize(7.5f).Bold();
                                    Head("Posição"); Head($"Média ({d.Unidade})"); Head($"Erro ({d.Unidade})");
                                    foreach (var x in r.Excentricidade)
                                    {
                                        void C(string s) => t.Cell().BorderBottom(0.5f).BorderColor("#e6e6e6")
                                            .Padding(3).AlignCenter().Text(s).FontSize(7.5f);
                                        C(x.Posicao); C(Val(x.Media, casasU));
                                        C(x.Posicao == "1" ? "ref." : (x.Erro > 0 ? "+" : "") + Val(x.Erro, casasU));
                                    }
                                });
                                if (r.MaiorErroExc is { } me)
                                    c.Item().PaddingTop(2).Text($"Maior erro: {Val(me, casasU)} {d.Unidade} " +
                                        "(considerado na incerteza de cada carga).").FontSize(7).Italic().FontColor("#667");
                            }
                        });
                        row.ConstantItem(14);
                        row.RelativeItem().Column(c =>
                        {
                            c.Item().Text("3 · Mobilidade").Bold().FontColor(cor);
                            if (r.Mobilidade.Count == 0)
                                c.Item().Text("Não realizado.").FontSize(8).FontColor("#667");
                            else
                            {
                                if (r.MobCargaRef is { } cr)
                                    c.Item().Text($"Carga de referência: {Val(cr, d.CasasDecimais)} {d.Unidade} " +
                                        $"+ {Val(r.MobDivisao ?? 0, d.CasasDecimais)} {d.Unidade}").FontSize(7.5f);
                                c.Item().Table(t =>
                                {
                                    t.ColumnsDefinition(x => { x.RelativeColumn(); x.RelativeColumn(); });
                                    void Head(string s) => t.Cell().Background("#eef3f1").Padding(3)
                                        .AlignCenter().Text(s).FontSize(7.5f).Bold();
                                    Head("Leitura"); Head($"Indicação ({d.Unidade})");
                                    foreach (var m in r.Mobilidade)
                                    {
                                        void C(string s) => t.Cell().BorderBottom(0.5f).BorderColor("#e6e6e6")
                                            .Padding(3).AlignCenter().Text(s).FontSize(7.5f);
                                        C(m.Ordem.ToString()); C(Val(m.Leitura, d.CasasDecimais));
                                    }
                                });
                                c.Item().PaddingTop(2).Text("Ensaio de caracterização; não integra o cálculo da incerteza.")
                                   .FontSize(7).Italic().FontColor("#667");
                            }
                        });
                    });

                    // ── 4 · Rastreabilidade ────────────────────
                    col.Item().Text("4 · Rastreabilidade — padrões utilizados").Bold().FontColor(cor);
                    // Cada padrao aparece UMA vez (a lista dos usados), nao por carga
                    var PadroesUnicos = r.PesosRbc
                        .GroupBy(w => new { w.Identificacao, w.ValorNominal, w.Convencional, w.NumCertificado })
                        .Select(g => g.Key).OrderBy(x => x.Identificacao).ThenBy(x => x.ValorNominal).ToList();
                    if (PadroesUnicos.Count == 0)
                        col.Item().Text("—").FontSize(8);
                    else
                        col.Item().Table(t =>
                        {
                            t.ColumnsDefinition(c =>
                            { c.RelativeColumn(); c.RelativeColumn();
                              c.RelativeColumn(); c.RelativeColumn(); });
                            void Head(string s) => t.Cell().Background("#eef3f1").Padding(3)
                                .Text(s).FontSize(7.5f).Bold();
                            Head("Padrão"); Head("Valor nominal");
                            Head($"Valor convencional ({d.Unidade})"); Head("Certificado");
                            foreach (var w in PadroesUnicos)
                            {
                                void C(string s) => t.Cell().BorderBottom(0.5f).BorderColor("#e6e6e6")
                                    .Padding(3).Text(s).FontSize(7.5f);
                                C(w.Identificacao);
                                C(w.ValorNominal ?? "—");
                                C(w.Convencional is null ? "—" : Val(w.Convencional.Value, casasU));
                                C(w.NumCertificado ?? "—");
                            }
                        });

                    // ── Declarações ────────────────────────────
                    col.Item().PaddingTop(3).Column(c =>
                    {
                        c.Item().Text(t =>
                        {
                            t.Span("Método: ").Bold();
                            t.Span(d.Metodo == "-" ? "Calibração por comparação direta com massas padrão rastreadas ao SI, " +
                                "conforme EURAMET cg-18 e o Guia para a Expressão da Incerteza de Medição (GUM)." : d.Metodo);
                        });
                        c.Item().Text(t =>
                        {
                            t.Span("Incerteza de medição: ").Bold();
                            t.Span("estimada conforme o GUM, combinando em quadratura as contribuições de repetibilidade, " +
                                   "resolução do instrumento, incerteza dos padrões, excentricidade e empuxo do ar (CIPM-2007). " +
                                   "Os graus de liberdade efetivos foram estimados pela fórmula de Welch-Satterthwaite.");
                        });
                        c.Item().Text(t =>
                        {
                            t.Span("Declaração: ").Bold();
                            t.Span("os resultados referem-se exclusivamente ao instrumento calibrado, nas condições " +
                                   "descritas e no momento da calibração. Este certificado não implica julgamento de " +
                                   "conformidade com requisitos regulamentares. Reprodução permitida somente na íntegra.");
                        });
                        if (d.TextoPeriodicidade is not null)
                            c.Item().Text(d.TextoPeriodicidade).FontSize(8).Italic();
                    });

                    // ── Assinaturas + QR ───────────────────────
                    col.Item().PaddingTop(6).Row(row =>
                    {
                        row.RelativeItem().Column(c =>
                        {
                            if (assinTecnico is not null)
                                c.Item().Height(32).AlignCenter().Image(assinTecnico).FitArea();
                            else c.Item().Height(32);
                            c.Item().LineHorizontal(0.5f).LineColor("#333");
                            c.Item().Text(d.Tecnico).FontSize(8);
                            c.Item().Text("Técnico executor").FontSize(7).FontColor("#667");
                        });
                        row.ConstantItem(30);
                        row.RelativeItem().Column(c =>
                        {
                            if (assinAprovador is not null)
                                c.Item().Height(32).AlignCenter().Image(assinAprovador).FitArea();
                            else c.Item().Height(32);
                            c.Item().LineHorizontal(0.5f).LineColor("#333");
                            c.Item().Text(d.Aprovador ?? "—").FontSize(8);
                            c.Item().Text($"Signatário autorizado{(d.RegistroAprovador is null ? "" : " · " + d.RegistroAprovador)}")
                               .FontSize(7).FontColor("#667");
                        });
                        row.ConstantItem(20);
                        if (qrPng is not null)
                            row.ConstantItem(70).Column(c =>
                            {
                                c.Item().Width(64).Image(qrPng);
                                c.Item().Text("Validar autenticidade").FontSize(6).AlignCenter().FontColor("#667");
                            });
                    });

                    if (!string.IsNullOrWhiteSpace(d.NotaSubstituicao))
                        col.Item().PaddingTop(3).Text(d.NotaSubstituicao).FontSize(7).Italic();
                    if (d.TextoRodape is not null)
                        col.Item().PaddingTop(4).Text(d.TextoRodape).FontSize(7).FontColor("#667");
                });

                page.Footer().Column(col =>
                {
                    col.Item().LineHorizontal(0.5f).LineColor("#ccc");
                    col.Item().Row(row =>
                    {
                        row.RelativeItem().Text($"Validação: {d.UrlBase}/validar/{d.UuidValidacao}")
                           .FontSize(6).FontColor("#667");
                        row.RelativeItem().AlignRight().Text(t =>
                        {
                            t.Span("Certificado ").FontSize(6).FontColor("#667");
                            t.Span(d.Numero).FontSize(6).FontColor("#667");
                            t.Span(" · Página ").FontSize(6).FontColor("#667");
                            t.CurrentPageNumber().FontSize(6).FontColor("#667");
                            t.Span(" de ").FontSize(6).FontColor("#667");
                            t.TotalPages().FontSize(6).FontColor("#667");
                        });
                    if (d.MarcaSistema)
                        col.Item().PaddingTop(1).AlignCenter().Text(MarcaTexto)
                            .FontSize(5).FontColor("#b8c2cc");
                    });
                    col.Item().AlignCenter().Text("— fim do documento —").FontSize(6).FontColor("#aaa");
                });
            });
        }).GeneratePdf();
    }

    // ═══════════════════════════════════════════════════════════
    // MODELO 4 — formulário em caixas (layout inspirado no usado
    // pela Balanças Gaúcha). Mantém o desenho de caixas com bordas
    // e o resultado geral CONFORME / NÃO-CONFORME, mas com os
    // nossos padrões de dado: excentricidade numerada (1 = centro),
    // incerteza por ponto em unidade (não em %), tabela completa de
    // padrões e coluna "antes do ajuste" quando houve ajuste.
    // João, 28/08/2026.
    static byte[] GerarModelo4(DadosCertificado d, byte[]? qrPng, byte[]? logoPng,
        byte[]? assinTecnico, byte[]? assinAprovador, string? marcaDagua, string cor)
    {
        const string borda = "#000000";
        const string cinza = "#eef3f1";
        var casas = d.CasasDecimais;
        string V(decimal? v) => Val(v, casas);
        string VU(decimal? v) => Val(v, casas + 1);   // incerteza: 1 casa a mais

        string vencimento = (d.DataCalibracao is not null && d.PeriodicidadeMeses > 0)
            ? d.DataCalibracao.Value.AddMonths(d.PeriodicidadeMeses).ToString("dd/MM/yyyy")
            : "—";

        // Resultado geral: NÃO-CONFORME se qualquer ponto reprovou
        bool conforme = !d.Indicacao.Any(x => x.Aprovado == false)
                     && !d.Excentricidade.Any(x => x.Aprovado == false);

        bool indComAntes = d.HouveAjuste &&
            d.Indicacao.Any(x => x.IndicacaoAntes is not null || x.SemLeituraAntes);
        bool excComAntes = d.HouveAjuste && d.Excentricidade.Any(x => x.IndicacaoAntes is not null);

        return Document.Create(doc =>
        {
            doc.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(0.8f, Unit.Centimetre);
                page.DefaultTextStyle(x => x.FontSize(8).FontColor("#1c2b33"));

                if (!string.IsNullOrEmpty(marcaDagua))
                    page.Foreground().AlignCenter().AlignMiddle()
                        .Rotate(-35).Text(marcaDagua)
                        .FontSize(120).Bold().FontColor("#20E53935");

                page.Content().Border(1.2f).BorderColor(borda).Padding(4).Column(col =>
                {
                    col.Spacing(2);

                    // Helpers de caixa/campo do formulário
                    void Titulo(string s) => col.Item().Background(cinza).Border(0.7f)
                        .BorderColor(borda).Padding(1.5f).AlignCenter()
                        .Text(s).FontSize(6.5f).Bold();

                    void Campo(QuestPDF.Infrastructure.IContainer cel, string rot, string val,
                        bool centro = false)
                        => cel.Border(0.5f).BorderColor(borda).Padding(1.5f).Column(cc =>
                        {
                            cc.Item().Text(rot).FontSize(5.2f).FontColor("#555");
                            var t = cc.Item();
                            (centro ? t.AlignCenter() : t)
                                .Text(string.IsNullOrWhiteSpace(val) ? "—" : val).FontSize(8.5f);
                        });

                    // ── Cabeçalho ──
                    col.Item().Row(row =>
                    {
                        if (logoPng is not null)
                            row.ConstantItem(Math.Clamp(d.LogoLargura, 30, 160)).PaddingRight(6)
                               .MaxHeight(Math.Clamp(d.LogoAltura, 20, 60)).Image(logoPng).FitArea();
                        row.RelativeItem().Column(c =>
                        {
                            c.Item().Text(d.NomeFantasia ?? d.Empresa).FontSize(11).Bold().FontColor(cor);
                            if (d.EnderecoEmpresa is not null)
                                c.Item().Text(d.EnderecoEmpresa).FontSize(6);
                            if (d.CidadeUfEmpresa is not null)
                                c.Item().Text(d.CidadeUfEmpresa).FontSize(6);
                            if (!string.IsNullOrWhiteSpace(d.TextoAutorizacao))
                                c.Item().Text(d.TextoAutorizacao).FontSize(6);
                        });
                        row.RelativeItem().AlignMiddle().Column(c =>
                        {
                            c.Item().AlignCenter().Text(d.TituloDocumento ?? "CERTIFICADO DE CONFORMIDADE")
                                .FontSize(11).Bold().FontColor(cor);
                            c.Item().PaddingTop(3).AlignCenter().Text($"Nº :  {d.Numero}").FontSize(11).Bold();
                            c.Item().AlignCenter().Text($"Emissão: {d.DataEmissao:dd/MM/yyyy}").FontSize(6);
                            if (d.SubstituiNumero is not null)
                                c.Item().AlignCenter().Text($"Substitui o certificado {d.SubstituiNumero}")
                                    .FontSize(6).FontColor("#b02a37");
                        });
                    });

                    // ── Dados do cliente ──
                    Titulo("DADOS DO CLIENTE");
                    col.Item().Row(r =>
                    {
                        Campo(r.RelativeItem(24), "CLIENTE", d.Cliente);
                        Campo(r.RelativeItem(10), "CNPJ", d.CnpjCliente ?? "—");
                    });
                    col.Item().Row(r =>
                    {
                        Campo(r.RelativeItem(20), "ENDEREÇO", d.EnderecoCliente ?? "—");
                        Campo(r.RelativeItem(9), "MUNICÍPIO", d.CidadeCliente ?? "—");
                        Campo(r.RelativeItem(4), "ESTADO", d.UfCliente ?? "—", true);
                    });

                    // ── Dados do equipamento ──
                    Titulo("DADOS DO EQUIPAMENTO");
                    var ehMulti = d.Faixas is { Count: > 0 };
                    var capTxt = ehMulti
                        ? string.Join(" / ", d.Faixas!.Select(f => V(f.LimiteSup))) + " " + d.Unidade
                        : V(d.Capacidade) + " " + d.Unidade;
                    var divTxt = ehMulti
                        ? "e = " + string.Join(" / ", d.Faixas!.Select(f => V(f.DivisaoE)))
                        : "e = " + V(d.DivisaoE);
                    col.Item().Row(r =>
                    {
                        Campo(r.RelativeItem(15), "FABRICANTE / MODELO",
                            $"{d.Marca ?? "—"} / {d.Modelo ?? "—"}");
                        Campo(r.RelativeItem(13), "SÉRIE / INDICADOR",
                            (d.NumSerie ?? "—") + (string.IsNullOrWhiteSpace(d.NumSerieIndicador)
                                ? "" : " / " + d.NumSerieIndicador), true);
                        Campo(r.RelativeItem(12), "CAPACIDADE", capTxt, true);
                        Campo(r.RelativeItem(6), "CLASSE", d.Classe, true);
                        Campo(r.RelativeItem(13), $"RESOLUÇÃO ({d.Unidade})", divTxt, true);
                    });
                    col.Item().Row(r =>
                    {
                        Campo(r.RelativeItem(12), "IDENTIFICAÇÃO", d.Balanca);
                        Campo(r.RelativeItem(12), "Nº INMETRO / PATRIMÔNIO",
                            $"{d.NumeroInmetro ?? "-"} / {d.Patrimonio ?? "-"}");
                        Campo(r.RelativeItem(10), "PORTARIA APROVAÇÃO", d.PortariaAprovacao ?? "—", true);
                        Campo(r.RelativeItem(13), "LACRE / SELO INMETRO",
                            $"{d.NumeroLacre ?? "-"} / {d.SeloInmetro ?? "-"}");
                    });

                    // ── Condições e datas ──
                    col.Item().Row(r =>
                    {
                        Campo(r.RelativeItem(10), "DATA DA CALIBRAÇÃO",
                            d.DataCalibracao?.ToString("dd/MM/yyyy") ?? "—", true);
                        Campo(r.RelativeItem(10), "PRÓXIMA CALIBRAÇÃO", vencimento, true);
                        Campo(r.RelativeItem(8), "TEMPERATURA",
                            d.Temperatura is null ? "—" : d.Temperatura.Value.ToString("0.##", Pt) + " °C", true);
                        Campo(r.RelativeItem(7), "UMIDADE",
                            d.Umidade is null ? "—" : d.Umidade.Value.ToString("0.##", Pt) + " %", true);
                        Campo(r.RelativeItem(16), "LOCAL DA CALIBRAÇÃO", LocalTexto(d));
                        if (OsTexto(d) is not null)
                            Campo(r.RelativeItem(9), "ORDEM DE SERVIÇO", d.OrdemServico!, true);
                    });

                    // ── Ensaios: sensibilidade + repetibilidade | excentricidade ──
                    Titulo("E N S A I O S");
                    col.Item().Border(0.5f).BorderColor(borda).Row(row =>
                    {
                        // Coluna esquerda
                        row.RelativeItem().BorderRight(0.5f).BorderColor(borda).Column(c =>
                        {
                            c.Item().Background(cinza).BorderBottom(0.5f).BorderColor(borda)
                             .Padding(1.5f).AlignCenter().Text("SENSIBILIDADE (MOBILIDADE)").FontSize(6).Bold();
                            if (d.Sensibilidade is { } sn)
                            {
                                var esp = sn.CargaReferencia + sn.Adicao;
                                var tol = sn.Adicao > 0 ? sn.Adicao / 2m : 0.0000001m;
                                var okS = Math.Abs(sn.ResultadoDisplay - esp) <= tol;
                                c.Item().Table(t =>
                                {
                                    t.ColumnsDefinition(x => { x.RelativeColumn(); x.RelativeColumn();
                                        x.RelativeColumn(); x.RelativeColumn(); x.RelativeColumn(); });
                                    void H(string s) => t.Cell().Background(cinza).BorderBottom(0.4f)
                                        .BorderColor(borda).Padding(1.5f).AlignCenter().Text(s).FontSize(5).Bold();
                                    void C(string s, string? fc = null) => t.Cell().BorderBottom(0.4f)
                                        .BorderColor(borda).Padding(1.5f).AlignCenter().Text(s)
                                        .FontSize(7.5f).FontColor(fc ?? "#1c2b33");
                                    H($"CARGA REF. ({d.Unidade})"); H($"ADIÇÃO 1e ({d.Unidade})");
                                    H($"ESPERADO ({d.Unidade})"); H($"DISPLAY ({d.Unidade})"); H("SITUAÇÃO");
                                    C(V(sn.CargaReferencia)); C(V(sn.Adicao)); C(V(esp)); C(V(sn.ResultadoDisplay));
                                    C(okS ? "Conforme" : "Não conforme", okS ? "#146c43" : "#b02a37");
                                });
                            }
                            else
                                c.Item().Padding(2).AlignCenter().Text(
                                    d.FazSensibilidade ? "—" : "Não aplicável").FontSize(6.5f).Italic();

                            c.Item().Background(cinza).BorderTop(0.5f).BorderBottom(0.5f).BorderColor(borda)
                             .Padding(1.5f).AlignCenter().Text("REPETIBILIDADE").FontSize(6).Bold();
                            if (d.Repetibilidade.Count > 0)
                            {
                                c.Item().PaddingHorizontal(2).PaddingTop(1).AlignCenter()
                                 .Text($"Carga aplicada: {V(d.Repetibilidade[0].Carga)} {d.Unidade}  ·  indicações em {d.Unidade}")
                                 .FontSize(6);
                                // Grade de 2 colunas (1ª|3ª / 2ª|4ª …), como no formulário original
                                c.Item().Table(t =>
                                {
                                    t.ColumnsDefinition(x => { x.ConstantColumn(14); x.RelativeColumn();
                                        x.ConstantColumn(14); x.RelativeColumn(); });
                                    var lista = d.Repetibilidade.ToList();
                                    int metade = (lista.Count + 1) / 2;
                                    for (int i = 0; i < metade; i++)
                                    {
                                        void Cel(string s, bool num) => t.Cell().BorderBottom(0.4f)
                                            .BorderRight(0.4f).BorderColor(borda).Padding(1.5f)
                                            .AlignCenter().Text(s).FontSize(num ? 5.5f : 7.5f);
                                        Cel($"{lista[i].Medicao}ª", true);
                                        Cel(V(lista[i].Indicacao), false);
                                        var j = i + metade;
                                        if (j < lista.Count) { Cel($"{lista[j].Medicao}ª", true); Cel(V(lista[j].Indicacao), false); }
                                        else { Cel("", true); Cel("", false); }
                                    }
                                });
                            }
                        });

                        // Coluna direita — excentricidade
                        row.RelativeItem().Column(c =>
                        {
                            c.Item().Background(cinza).BorderBottom(0.5f).BorderColor(borda)
                             .Padding(1.5f).AlignCenter().Text("EXCENTRICIDADE").FontSize(6).Bold();
                            if (!d.FazExcentricidade && d.Excentricidade.Count == 0)
                                c.Item().Padding(3).Text("Não aplicável — em razão do tipo do equipamento, este ensaio não é exequível.")
                                    .FontSize(6).Italic().FontColor("#667");
                            else
                            {
                                c.Item().Row(rr =>
                                {
                                    if (d.Excentricidade.Count > 0)
                                        rr.RelativeItem().AlignMiddle().PaddingLeft(3).Text(
                                            $"Referência (pos. 1): {V(d.Excentricidade[0].Indicacao)} {d.Unidade}")
                                          .FontSize(6.5f);
                                    var des = DesenhoExcPng(cor);
                                    if (des is not null)
                                        rr.ConstantItem(120).PaddingVertical(1)
                                          .Height(120f * 240f / 820f).Image(des).FitArea();
                                });
                                c.Item().Table(t =>
                                {
                                    t.ColumnsDefinition(x => { x.ConstantColumn(20);
                                        if (excComAntes) x.RelativeColumn();
                                        x.RelativeColumn(); x.RelativeColumn(); x.RelativeColumn(); });
                                    void H(string s) => t.Cell().Background(cinza).BorderTop(0.4f).BorderBottom(0.4f)
                                        .BorderColor(borda).Padding(1.5f).AlignCenter().Text(s).FontSize(5).Bold();
                                    H("POS.");
                                    if (excComAntes) H($"ANTES ({d.Unidade})");
                                    H(excComAntes ? $"APÓS AJUSTE ({d.Unidade})" : $"INDIC. ({d.Unidade})");
                                    H($"ERRO ({d.Unidade})"); H("SITUAÇÃO");
                                    int pos = 1;
                                    foreach (var l in d.Excentricidade)
                                    {
                                        void C(string s, string? fc = null) => t.Cell().BorderBottom(0.4f)
                                            .BorderColor(borda).Padding(1.5f).AlignCenter().Text(s)
                                            .FontSize(7).FontColor(fc ?? "#1c2b33");
                                        C(pos + (pos == 1 ? " (ref.)" : ""));
                                        if (excComAntes) C(l.IndicacaoAntes is null ? "—" : V(l.IndicacaoAntes));
                                        C(V(l.Indicacao));
                                        C((l.Erro > 0 ? "+" : "") + V(l.Erro));
                                        if (pos == 1) C("ref.");
                                        else C(l.Aprovado is null ? "—" : l.Aprovado.Value ? "Conforme" : "Não conforme",
                                            l.Aprovado == false ? "#b02a37" : "#146c43");
                                        pos++;
                                    }
                                });
                            }
                        });
                    });

                    // ── Ensaio de pesagem (indicação) ──
                    Titulo("ENSAIO DE PESAGEM (INDICAÇÃO)");
                    if (indComAntes)
                        col.Item().Text("A balança foi ajustada. A avaliação de conformidade refere-se à leitura final (após o ajuste).")
                           .FontSize(5.5f).Italic().FontColor("#667");
                    col.Item().Table(t =>
                    {
                        t.ColumnsDefinition(c =>
                        {
                            c.RelativeColumn();                       // carga
                            if (indComAntes) c.RelativeColumn();      // antes
                            c.RelativeColumn();                       // indicação
                            c.RelativeColumn(0.8f);                   // erro
                            c.RelativeColumn();                       // incerteza
                            c.RelativeColumn(0.8f);                   // EMA
                            c.RelativeColumn();                       // situação
                        });
                        void H(string s) => t.Cell().Background(cinza).Border(0.4f).BorderColor(borda)
                            .Padding(1.5f).AlignCenter().Text(s).FontSize(5.5f).Bold();
                        H($"CARGA ({d.Unidade})");
                        if (indComAntes) H($"ANTES AJUSTE ({d.Unidade})");
                        H(indComAntes ? $"APÓS AJUSTE ({d.Unidade})" : $"INDICAÇÃO ({d.Unidade})");
                        H($"ERRO ({d.Unidade})"); H($"INCERTEZA ({d.Unidade})");
                        H($"EMA ({d.Unidade})"); H("SITUAÇÃO");
                        foreach (var l in d.Indicacao)
                        {
                            void C(string s, string? fc = null) => t.Cell().Border(0.4f).BorderColor(borda)
                                .Padding(1.5f).AlignCenter().Text(s).FontSize(7.5f).FontColor(fc ?? "#1c2b33");
                            C(V(l.Carga));
                            if (indComAntes) C(l.SemLeituraAntes ? "**" : (l.IndicacaoAntes is null ? "—" : V(l.IndicacaoAntes)));
                            C(l.SemLeitura ? "**" : V(l.Indicacao));
                            C(l.SemLeitura ? "—" : (l.Erro > 0 ? "+" : "") + V(l.Erro));
                            C(l.SemLeitura ? "—" : "± " + VU(l.Incerteza));
                            C("± " + V(l.Ema));
                            C(l.Aprovado is null ? "—" : l.Aprovado.Value ? "Conforme" : "Não conforme",
                              l.Aprovado == false ? "#b02a37" : "#146c43");
                        }
                    });
                    if (d.Indicacao.Any(x => x.SemLeitura || x.SemLeituraAntes))
                        col.Item().Text("** O instrumento não apresentou indicação no visor durante a aplicação da carga.")
                           .FontSize(5.5f).Italic().FontColor("#b02a37");

                    // ── Padrões utilizados ──
                    Titulo("PADRÕES DE TRABALHO UTILIZADOS");
                    col.Item().Table(t =>
                    {
                        t.ColumnsDefinition(c => { c.RelativeColumn(2.6f); c.RelativeColumn(0.7f);
                            c.RelativeColumn(1.3f); c.RelativeColumn(); c.RelativeColumn(); });
                        void H(string s) => t.Cell().Background(cinza).Border(0.4f).BorderColor(borda)
                            .Padding(1.5f).AlignCenter().Text(s).FontSize(5.5f).Bold();
                        H("PADRÃO"); H("CLASSE"); H("CERTIFICADO"); H("CALIBRADO"); H("VÁLIDO ATÉ");
                        foreach (var p in d.Pesos)
                        {
                            void C(string s, bool esq = false) { var cel = t.Cell().Border(0.4f)
                                .BorderColor(borda).Padding(1.5f); (esq ? cel : cel.AlignCenter())
                                .Text(s).FontSize(7); }
                            C($"{p.Identificacao} ({p.ValorNominal})", true); C(p.Classe);
                            C(p.NumCertificado ?? "—");
                            C(p.DataCalibracao?.ToString("dd/MM/yyyy") ?? "—");
                            C(p.Validade?.ToString("dd/MM/yyyy") ?? "—");
                        }
                    });

                    // ── Procedimento | Observações ──
                    col.Item().Row(row =>
                    {
                        row.RelativeItem().Border(0.5f).BorderColor(borda).Column(c =>
                        {
                            c.Item().Background(cinza).BorderBottom(0.4f).BorderColor(borda)
                             .Padding(1.5f).AlignCenter().Text("PROCEDIMENTO").FontSize(6).Bold();
                            var ctx4 = d.ContextoEma == "em_uso"
                                ? "erros máximos admissíveis em serviço (em uso)"
                                : "erros máximos admissíveis em verificação subsequente";
                            c.Item().Padding(2).Text($"Tolerâncias admitidas de acordo com a regulamentação: {ctx4}, conforme Portaria Inmetro nº 157/2022.")
                                .FontSize(6);
                            c.Item().PaddingHorizontal(2).PaddingBottom(2).Text($"Método: {d.Metodo}").FontSize(6);
                        });
                        row.ConstantItem(4);
                        row.RelativeItem().Border(0.5f).BorderColor(borda).Column(c =>
                        {
                            c.Item().Background(cinza).BorderBottom(0.4f).BorderColor(borda)
                             .Padding(1.5f).AlignCenter().Text("OBSERVAÇÕES").FontSize(6).Bold();
                            c.Item().Padding(2).Text(string.IsNullOrWhiteSpace(d.TextoPeriodicidade)
                                ? "Não aplicável" : d.TextoPeriodicidade).FontSize(6.5f);
                            c.Item().PaddingHorizontal(2).PaddingBottom(2).Text(
                                "Incerteza de medição declarada para fator de abrangência k = 2, correspondente a nível de confiança de aproximadamente 95%, conforme o GUM.")
                                .FontSize(5.5f).FontColor("#667");
                        });
                    });

                    // ── Instrução de calibração (com CONFORME/NÃO-CONFORME) | assinaturas ──
                    col.Item().Row(row =>
                    {
                        row.RelativeItem(11).Border(0.5f).BorderColor(borda).Column(c =>
                        {
                            c.Item().Background(cinza).BorderBottom(0.4f).BorderColor(borda)
                             .Padding(1.5f).AlignCenter().Text("INSTRUÇÃO DE CALIBRAÇÃO").FontSize(6).Bold();
                            if (!string.IsNullOrWhiteSpace(d.InstrucaoIt) || !string.IsNullOrWhiteSpace(d.InstrucaoRev))
                                c.Item().Padding(2).Text(t =>
                                {
                                    t.Span("IT: ").FontSize(6.5f);
                                    t.Span(d.InstrucaoIt ?? "—").FontSize(8.5f).Bold();
                                    t.Span("     REV.: ").FontSize(6.5f);
                                    t.Span(d.InstrucaoRev ?? "—").FontSize(8.5f).Bold();
                                });
                            c.Item().PaddingHorizontal(2).PaddingBottom(2).Row(rr =>
                            {
                                rr.RelativeItem().AlignMiddle().Text("RESULTADO GERAL DA CALIBRAÇÃO").FontSize(5.5f);
                                rr.ConstantItem(84).Column(cc =>
                                {
                                    void Caixa(string rot, bool marcada) => cc.Item().Border(0.5f)
                                        .BorderColor(borda).Row(x =>
                                        {
                                            x.ConstantItem(14).BorderRight(0.5f).BorderColor(borda)
                                             .AlignCenter().Text(marcada ? "X" : " ").FontSize(8).Bold();
                                            x.RelativeItem().PaddingLeft(2).AlignMiddle()
                                             .Text(rot).FontSize(5.5f).Bold();
                                        });
                                    Caixa("CONFORME", conforme);
                                    Caixa("NÃO - CONFORME", !conforme);
                                });
                            });
                        });
                        row.ConstantItem(4);
                        row.RelativeItem(14).Border(0.5f).BorderColor(borda).Padding(3).Row(rr =>
                        {
                            rr.RelativeItem().Column(c =>
                            {
                                if (assinTecnico is not null)
                                    c.Item().Height(20).AlignCenter().Image(assinTecnico).FitArea();
                                else c.Item().Height(20);
                                c.Item().LineHorizontal(0.5f).LineColor("#333");
                                c.Item().AlignCenter().Text(d.Tecnico).FontSize(7);
                                c.Item().AlignCenter().Text("Técnico executor").FontSize(5.5f).FontColor("#667");
                            });
                            rr.ConstantItem(10);
                            rr.RelativeItem().Column(c =>
                            {
                                if (assinAprovador is not null)
                                    c.Item().Height(20).AlignCenter().Image(assinAprovador).FitArea();
                                else c.Item().Height(20);
                                c.Item().LineHorizontal(0.5f).LineColor("#333");
                                c.Item().AlignCenter().Text(d.Aprovador ?? "—").FontSize(7);
                                c.Item().AlignCenter().Text($"Responsável técnico{(d.RegistroAprovador is null ? "" : " · " + d.RegistroAprovador)}")
                                   .FontSize(5.5f).FontColor("#667");
                            });
                            if (qrPng is not null)
                            {
                                rr.ConstantItem(8);
                                rr.ConstantItem(42).Column(c =>
                                {
                                    c.Item().Width(38).Image(qrPng);
                                    c.Item().AlignCenter().Text("Validar").FontSize(4.5f).FontColor("#667");
                                });
                            }
                        });
                    });

                    if (!string.IsNullOrWhiteSpace(d.NotaSubstituicao))
                        col.Item().Text(d.NotaSubstituicao).FontSize(5.5f).Italic();
                    if (d.TextoRodape is not null)
                        col.Item().AlignCenter().Text(d.TextoRodape).FontSize(5.2f).FontColor("#667");
                    col.Item().AlignCenter().Text($"Validação: {d.UrlBase}/validar/{d.UuidValidacao}")
                       .FontSize(5).FontColor("#667");
                    if (d.MarcaSistema)
                        col.Item().AlignCenter().Text(MarcaTexto).FontSize(4.5f).FontColor("#b8c2cc");
                });

                page.Footer().AlignRight().Text(t =>
                {
                    t.Span($"Certificado {d.Numero} · Página ").FontSize(6).FontColor("#667");
                    t.CurrentPageNumber().FontSize(6).FontColor("#667");
                    t.Span(" de ").FontSize(6).FontColor("#667");
                    t.TotalPages().FontSize(6).FontColor("#667");
                });
            });
        }).GeneratePdf();
    }

}
