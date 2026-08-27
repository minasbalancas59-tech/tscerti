#!/bin/bash
# ══ MÉTRICAS DO SISTEMA (João, 12/08/2026) ══
# Tabela + coleta a cada 5 min no worker + expurgo.
# Objetivo: cruzar uso de recursos com quantidade de usuários ativos
# para dimensionar o VPS conforme o SaaS cresce.
set -e
cd /root/cert-saas

echo "── 1. tabela ──"
docker compose exec -T db psql -U certsaas -d certsaas <<'SQL'
CREATE TABLE IF NOT EXISTS metrica_sistema (
    id            bigserial PRIMARY KEY,
    momento       timestamptz NOT NULL DEFAULT now(),
    cpu_pct       numeric(5,2),
    mem_usada_mb  integer,
    mem_total_mb  integer,
    mem_api_mb    integer,
    disco_pct     numeric(5,2),
    usuarios_5min integer,
    usuarios_1h   integer,
    conexoes_db   integer,
    certs_hora    integer
);
CREATE INDEX IF NOT EXISTS idx_metrica_momento ON metrica_sistema (momento DESC);

-- Série para o gráfico: agrega por bucket conforme o período pedido
CREATE OR REPLACE FUNCTION public.sa_metricas_serie(p_horas integer DEFAULT 24)
 RETURNS TABLE(momento timestamptz, cpu numeric, mem_pct numeric,
               usuarios integer, disco numeric)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
    WITH passo AS (
        SELECT CASE WHEN p_horas <= 6 THEN interval '5 min'
                    WHEN p_horas <= 24 THEN interval '15 min'
                    WHEN p_horas <= 168 THEN interval '1 hour'
                    ELSE interval '6 hours' END AS p
    )
    SELECT to_timestamp(floor(extract(epoch FROM m.momento)
             / extract(epoch FROM passo.p)) * extract(epoch FROM passo.p)),
           round(avg(m.cpu_pct), 1),
           round(avg(m.mem_usada_mb::numeric * 100 / NULLIF(m.mem_total_mb, 0)), 1),
           max(m.usuarios_5min),
           round(avg(m.disco_pct), 1)
      FROM metrica_sistema m, passo
     WHERE m.momento >= now() - make_interval(hours => p_horas)
     GROUP BY 1
     ORDER BY 1
$function$;

-- Resumo do período (picos)
CREATE OR REPLACE FUNCTION public.sa_metricas_resumo(p_horas integer DEFAULT 24)
 RETURNS TABLE(cpu_max numeric, cpu_med numeric, mem_max numeric,
               usuarios_max integer, disco_max numeric, amostras bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
    SELECT max(cpu_pct), round(avg(cpu_pct), 1),
           max(round(mem_usada_mb::numeric * 100 / NULLIF(mem_total_mb, 0), 1)),
           max(usuarios_5min), max(disco_pct), count(*)
      FROM metrica_sistema
     WHERE momento >= now() - make_interval(hours => p_horas)
$function$;
SQL
echo "✓ tabela e funções criadas"

echo "── 2. coleta no worker ──"
python3 - <<'PY'
p = 'src/Worker/Program.cs'
s = open(p, encoding='utf-8').read()
if 'ColetarMetricas' in s:
    print('  worker: JA APLICADO')
else:
    # método de coleta
    v = '    async Task ExpurgarLogAntigo()'
    assert v in s and s.count(v) == 1, 'ANCORA metodo'
    metodo = '''    // ── Métricas do sistema a cada 5 min (João, 12/08/2026) ──
    // Lê /proc do host (o container enxerga o VPS) e cruza com o uso real.
    DateTime _ultimaMetrica = DateTime.MinValue;
    (double idle, double total)? _cpuAnterior = null;
    async Task ColetarMetricas()
    {
        if ((DateTime.UtcNow - _ultimaMetrica).TotalMinutes < 5) return;
        _ultimaMetrica = DateTime.UtcNow;
        try
        {
            // CPU: diferença entre duas leituras de /proc/stat
            double cpuPct = 0;
            var linha = (await File.ReadAllLinesAsync("/proc/stat"))[0];
            var p = linha.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            double idle = double.Parse(p[4]) + double.Parse(p[5]);
            double total = 0;
            for (int i = 1; i < p.Length && i <= 8; i++) total += double.Parse(p[i]);
            if (_cpuAnterior is { } ant && total > ant.total)
                cpuPct = Math.Round(100.0 * (1 - (idle - ant.idle) / (total - ant.total)), 2);
            _cpuAnterior = (idle, total);

            // Memória do host
            int memTotal = 0, memDisp = 0;
            foreach (var l in await File.ReadAllLinesAsync("/proc/meminfo"))
            {
                if (l.StartsWith("MemTotal:")) memTotal = int.Parse(l.Split(':')[1].Replace("kB", "").Trim()) / 1024;
                if (l.StartsWith("MemAvailable:")) memDisp = int.Parse(l.Split(':')[1].Replace("kB", "").Trim()) / 1024;
            }
            int memUsada = memTotal - memDisp;
            int memProc = (int)(System.Diagnostics.Process.GetCurrentProcess().WorkingSet64 / 1048576);

            // Disco
            double discoPct = 0;
            try
            {
                var di = new DriveInfo("/");
                if (di.TotalSize > 0)
                    discoPct = Math.Round(100.0 * (di.TotalSize - di.AvailableFreeSpace) / di.TotalSize, 2);
            }
            catch { }

            await using var conn = await db.OpenConnectionAsync();
            var u5 = await conn.ExecuteScalarAsync<int>("SELECT sa_online_total(5)");
            var u60 = await conn.ExecuteScalarAsync<int>("SELECT sa_online_total(60)");
            var cx = await conn.ExecuteScalarAsync<int>(
                "SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database()");
            var certs = await conn.ExecuteScalarAsync<int>(
                "SELECT count(*)::int FROM certificado WHERE criado_em > now() - interval '1 hour'");
            await conn.ExecuteAsync("""
                INSERT INTO metrica_sistema (cpu_pct, mem_usada_mb, mem_total_mb, mem_api_mb,
                    disco_pct, usuarios_5min, usuarios_1h, conexoes_db, certs_hora)
                VALUES (@cpuPct, @memUsada, @memTotal, @memProc, @discoPct, @u5, @u60, @cx, @certs)
                """, new { cpuPct, memUsada, memTotal, memProc, discoPct, u5, u60, cx, certs });
        }
        catch (Exception ex) { log.LogWarning(ex, "Coleta de métricas falhou"); }
    }

''' + v
    s = s.replace(v, metodo)

    # chama no loop principal
    v2 = '                await ProcessarUmEmailCadenciado(r);'
    assert v2 in s and s.count(v2) == 1, 'ANCORA loop'
    s = s.replace(v2, v2 + '\n                await ColetarMetricas();')

    # expurgo: detalhe fino por 7 dias, resto some (mantém 1 por hora)
    v3 = '"SELECT expurgar_log_auditoria(12)");'
    assert v3 in s, 'ANCORA expurgo'
    s = s.replace(v3, v3 + '''
        // Métricas: mantém detalhe de 7 dias; acima disso, 1 amostra por hora
        await conn.ExecuteAsync("""
            DELETE FROM metrica_sistema m USING (
                SELECT id, row_number() OVER (
                    PARTITION BY date_trunc('hour', momento) ORDER BY momento) AS rn
                  FROM metrica_sistema WHERE momento < now() - interval '7 days') x
             WHERE m.id = x.id AND x.rn > 1
            """);
        await conn.ExecuteAsync(
            "DELETE FROM metrica_sistema WHERE momento < now() - interval '180 days'");''')
    if 'using System.IO;' not in s:
        s = 'using System.IO;\n' + s
    open(p, 'w', encoding='utf-8').write(s)
    print('  worker: APLICADO')
PY

echo "── 3. endpoint na API ──"
python3 - <<'PY'
p = 'src/Api/Sistema/SuperAdminEndpoints.cs'
s = open(p, encoding='utf-8').read()
if 'sa_metricas_serie' in s:
    print('  api: JA APLICADO')
else:
    v = '        // ── Log de consultas por QR code (com filtros) ──'
    assert v in s and s.count(v) == 1, 'ANCORA api'
    s = s.replace(v, '''        // ── Métricas do servidor (gráfico com filtro de período) ──
        g.MapGet("/metricas", async (int? horas, ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            var h = horas is > 0 and <= 4320 ? horas.Value : 24;
            var serie = await conn.QueryAsync("SELECT * FROM sa_metricas_serie(@h)", new { h });
            var resumo = await conn.QuerySingleOrDefaultAsync("SELECT * FROM sa_metricas_resumo(@h)", new { h });
            return Results.Ok(new { serie, resumo, horas = h });
        });

''' + v)
    open(p, 'w', encoding='utf-8').write(s)
    print('  api: APLICADO')
PY

echo
echo "── 4. rebuild ──"
docker compose up -d --build && ./backup-projeto.sh
echo
echo "✓ pronto. A primeira amostra é coletada em até 5 minutos."
echo "  Confira com:"
echo "  docker compose exec -T db psql -U certsaas -d certsaas -c 'SELECT * FROM metrica_sistema ORDER BY momento DESC LIMIT 3;'"
