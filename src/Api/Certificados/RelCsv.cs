using System.Text;

namespace CertSaas.Api.Certificados;

/// <summary>
/// Helper para exportar relatórios em CSV que abre bem no Excel
/// (BOM UTF-8 para acentos + separador ; padrão Excel-BR).
/// </summary>
public static class RelCsv
{
    public static string Join(params string?[] campos) =>
        string.Join(";", campos.Select(Escapar));

    static string Escapar(string? v)
    {
        v ??= "";
        if (v.Contains(';') || v.Contains('"') || v.Contains('\n') || v.Contains('\r'))
            return "\"" + v.Replace("\"", "\"\"") + "\"";
        return v;
    }

    // Formata data (aceita DateTime, DateOnly ou null) como dd/MM/yyyy
    public static string D(object? v) => v switch
    {
        DateTime dt => dt.ToString("dd/MM/yyyy"),
        DateOnly d => d.ToString("dd/MM/yyyy"),
        _ => ""
    };

    // Formata data + hora (dd/MM/yyyy HH:mm)
    public static string DHora(object? v) => v switch
    {
        DateTime dt => dt.ToString("dd/MM/yyyy HH:mm"),
        _ => ""
    };

    // Monta o CSV e devolve como arquivo para download
    public static IResult File(string[] cabecalho, IEnumerable<string> linhas, string nomeArquivo)
    {
        var sb = new StringBuilder();
        sb.Append("sep=;\r\n");
        sb.Append(string.Join(";", cabecalho.Select(Escapar))).Append("\r\n");
        foreach (var l in linhas) sb.Append(l).Append("\r\n");

        var bom = new byte[] { 0xEF, 0xBB, 0xBF };
        var corpo = Encoding.UTF8.GetBytes(sb.ToString());
        var bytes = new byte[bom.Length + corpo.Length];
        Buffer.BlockCopy(bom, 0, bytes, 0, bom.Length);
        Buffer.BlockCopy(corpo, 0, bytes, bom.Length, corpo.Length);
        return Results.File(bytes, "text/csv; charset=utf-8", nomeArquivo);
    }
}
