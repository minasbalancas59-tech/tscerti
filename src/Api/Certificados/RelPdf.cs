using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace CertSaas.Api.Certificados;

/// <summary>
/// Gera PDFs de relatórios de clientes: cabeçalho com nome da empresa e
/// data de emissão, tabela de dados e resumo/totais no rodapé.
/// </summary>
public static class RelPdf
{
    public record Coluna(string Titulo, float Peso);

    public static byte[] Gerar(
        string empresaNome, string titulo, string? subtitulo,
        IReadOnlyList<Coluna> colunas, IReadOnlyList<string[]> linhas,
        IReadOnlyList<string>? totais = null, byte[]? logoPng = null)
    {
        return Document.Create(doc =>
        {
            doc.Page(page =>
            {
                page.Size(PageSizes.A4.Landscape());
                page.Margin(28);
                page.DefaultTextStyle(t => t.FontSize(8.5f).FontColor("#222"));

                // ── Cabeçalho ──
                page.Header().Column(col =>
                {
                    col.Item().Row(row =>
                    {
                        if (logoPng is not null)
                            row.ConstantItem(90).MaxHeight(44).Image(logoPng).FitArea();
                        row.RelativeItem().PaddingLeft(logoPng is not null ? 10 : 0).Column(c =>
                        {
                            c.Item().Text(empresaNome).FontSize(13).Bold().FontColor("#1e3a5f");
                            c.Item().Text(titulo).FontSize(11).Bold();
                            if (!string.IsNullOrWhiteSpace(subtitulo))
                                c.Item().Text(subtitulo).FontSize(8).FontColor("#666");
                        });
                        row.ConstantItem(150).AlignRight().Column(c =>
                        {
                            c.Item().AlignRight().Text("Emitido em").FontSize(7).FontColor("#888");
                            c.Item().AlignRight().Text(DateTime.Now.ToString("dd/MM/yyyy HH:mm"))
                                .FontSize(9).Bold();
                        });
                    });
                    col.Item().PaddingTop(6).LineHorizontal(1).LineColor("#1e3a5f");
                });

                // ── Tabela ──
                page.Content().PaddingTop(8).Table(table =>
                {
                    table.ColumnsDefinition(cols =>
                    {
                        foreach (var c in colunas) cols.RelativeColumn(c.Peso);
                    });

                    table.Header(header =>
                    {
                        foreach (var c in colunas)
                            header.Cell().Background("#1e3a5f").Padding(4)
                                .Text(c.Titulo).FontColor("#fff").FontSize(8).Bold();
                    });

                    bool zebra = false;
                    foreach (var linha in linhas)
                    {
                        var bg = zebra ? "#f4f7fa" : "#ffffff";
                        zebra = !zebra;
                        for (int i = 0; i < colunas.Count; i++)
                        {
                            var val = i < linha.Length ? linha[i] : "";
                            table.Cell().Background(bg).Padding(3.5f).Text(val).FontSize(8);
                        }
                    }
                });

                // ── Rodapé: totais + paginação ──
                page.Footer().Column(col =>
                {
                    if (totais is { Count: > 0 })
                    {
                        col.Item().PaddingTop(6).LineHorizontal(0.5f).LineColor("#ccc");
                        col.Item().PaddingTop(4).Row(row =>
                        {
                            foreach (var t in totais)
                                row.RelativeItem().Text(t).FontSize(8.5f).Bold().FontColor("#1e3a5f");
                        });
                    }
                    col.Item().PaddingTop(4).AlignRight().Text(txt =>
                    {
                        txt.Span("Página ").FontSize(7).FontColor("#888");
                        txt.CurrentPageNumber().FontSize(7).FontColor("#888");
                        txt.Span(" de ").FontSize(7).FontColor("#888");
                        txt.TotalPages().FontSize(7).FontColor("#888");
                    });
                });
            });
        }).GeneratePdf();
    }
}
