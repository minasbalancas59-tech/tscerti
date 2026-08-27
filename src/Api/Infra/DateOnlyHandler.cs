using System.Data;
using Dapper;

namespace CertSaas.Api.Infra;

/// <summary>
/// Ensina o Dapper a converter DateOnly ↔ coluna 'date' do PostgreSQL.
/// Sem isto, o Dapper 2.1 lança NotSupportedException ao usar DateOnly
/// como parâmetro. Registrado uma vez no Program.cs.
/// </summary>
public sealed class DateOnlyHandler : SqlMapper.TypeHandler<DateOnly>
{
    public override void SetValue(IDbDataParameter parameter, DateOnly value)
    {
        parameter.DbType = DbType.Date;
        parameter.Value = value.ToDateTime(TimeOnly.MinValue);
    }

    public override DateOnly Parse(object value) =>
        value switch
        {
            DateTime dt => DateOnly.FromDateTime(dt),
            DateOnly d => d,
            _ => DateOnly.Parse(value.ToString()!)
        };
}

/// <summary>Versão para DateOnly? (nullable).</summary>
public sealed class DateOnlyNullableHandler : SqlMapper.TypeHandler<DateOnly?>
{
    public override void SetValue(IDbDataParameter parameter, DateOnly? value)
    {
        parameter.DbType = DbType.Date;
        parameter.Value = value?.ToDateTime(TimeOnly.MinValue) ?? (object)DBNull.Value;
    }

    public override DateOnly? Parse(object value) =>
        value is null or DBNull ? null
        : value is DateTime dt ? DateOnly.FromDateTime(dt)
        : DateOnly.Parse(value.ToString()!);
}
