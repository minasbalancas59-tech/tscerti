namespace CertSaas.Api.Infra;

/// <summary>
/// Informações da aplicação. O InicioEm é fixado quando o assembly
/// é carregado (subida da aplicação), o que é confiável dentro de
/// containers — diferente de Process.StartTime, que costuma falhar
/// ou retornar valores inválidos em ambientes conteinerizados.
/// </summary>
public static class AppInfo
{
    public static readonly DateTime InicioEm = DateTime.UtcNow;
}
