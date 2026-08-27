#!/bin/bash
# ══ MEMORIAL DE CÁLCULO DA INCERTEZA (João, 16/08/2026) ══
# Reconstrói, ponto a ponto, a conta que gerou a incerteza do certificado:
# entradas, componentes com fórmula, combinação e U final.
set -e
cd /root/cert-saas
docker compose exec -T db psql -U certsaas -d certsaas <<'SQL'
CREATE OR REPLACE FUNCTION public.memorial_incerteza(p_cert uuid)
 RETURNS TABLE(
   numero text, empresa text, cliente text, balanca text,
   classe_balanca text, unidade text, casas int,
   classe_pesos text, mpe_relativo numeric, desvio_rep numeric,
   n_repeticoes bigint, fator_k numeric,
   ordem int, carga numeric, indicacao numeric, erro numeric,
   divisao_ponto numeric, u_pesos numeric, u_leitura numeric,
   u_repet numeric, u_combinada numeric, incerteza numeric, ema numeric)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
WITH base AS (
  SELECT ct.id, ct.numero,
         COALESCE(NULLIF(e.nome_fantasia,''), e.razao_social) AS empresa,
         c.razao_social AS cliente,
         b.identificacao AS balanca, b.classe_exatidao, b.unidade, b.divisao_e,
         COALESCE(e.fator_abrangencia, 2) AS k
    FROM certificado ct
    JOIN empresa e  ON e.id = ct.empresa_id
    JOIN cliente c  ON c.id = ct.cliente_id
    JOIN balanca b  ON b.id = ct.balanca_id
   WHERE ct.id = p_cert
), pesos AS (
  -- pior classe entre os pesos usados (é a que o cálculo adota)
  SELECT COALESCE(max(pp.classe), 'M1') AS classe_pesos
    FROM certificado_peso cp JOIN peso_padrao pp ON pp.id = cp.peso_padrao_id
   WHERE cp.certificado_id = p_cert
), rep AS (
  SELECT count(*) AS n,
         COALESCE(stddev_samp(indicacao), 0) AS s
    FROM ensaio_repetibilidade WHERE certificado_id = p_cert
), mpe AS (
  SELECT CASE (SELECT classe_pesos FROM pesos)
           WHEN 'E1' THEN 0.5e-6 WHEN 'E2' THEN 1.6e-6
           WHEN 'F1' THEN 5e-6   WHEN 'F2' THEN 16e-6
           WHEN 'M1' THEN 50e-6  WHEN 'M2' THEN 160e-6
           WHEN 'M3' THEN 500e-6 ELSE 50e-6 END::numeric AS rel
)
SELECT b.numero, b.empresa, b.cliente, b.balanca, b.classe_exatidao, b.unidade,
       CASE WHEN b.divisao_e < 1 THEN 3 ELSE 0 END::int,
       p.classe_pesos, m.rel, round(r.s, 4), r.n, b.k,
       i.ordem, i.carga_aplicada, i.indicacao, i.erro,
       COALESCE(i.divisao_e_ponto, b.divisao_e) AS divisao_ponto,
       -- componentes (mesmas fórmulas do Metrologia.IncertezaExpandida)
       round((i.carga_aplicada * m.rel / sqrt(3))::numeric, 6)                        AS u_pesos,
       round((COALESCE(i.divisao_e_ponto, b.divisao_e) / sqrt(12) * sqrt(2))::numeric, 6) AS u_leitura,
       round(r.s, 6)                                                                   AS u_repet,
       round(sqrt(
           power(i.carga_aplicada * m.rel / sqrt(3), 2)
         + power(COALESCE(i.divisao_e_ponto, b.divisao_e) / sqrt(12) * sqrt(2), 2)
         + power(r.s, 2))::numeric, 6)                                                 AS u_combinada,
       i.incerteza, i.ema
  FROM base b
  CROSS JOIN pesos p CROSS JOIN rep r CROSS JOIN mpe m
  JOIN ensaio_indicacao i ON i.certificado_id = b.id
 ORDER BY i.ordem
$function$;
SQL
echo "✓ função criada"

python3 - <<'PY'
p = 'src/Api/Certificados/CertificadoEndpoints.cs'
s = open(p, encoding='utf-8').read()
if 'memorial-incerteza' in s:
    print('API: JA APLICADO'); raise SystemExit
v = '        var g = app.MapGroup("/api/certificados").RequireAuthorization();'
assert v in s and s.count(v) == 1, 'ANCORA grupo'
s = s.replace(v, v + '''

        // ── Memorial de cálculo da incerteza (João, 16/08/2026) ──
        // Reproduz a conta ponto a ponto: entradas, componentes, combinação
        // e U final. Serve à equipe (dúvida interna) e ao cliente/auditor.
        g.MapGet("/{id:guid}/memorial-incerteza", async (Guid id,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var linhas = await conn.QueryAsync(
                "SELECT * FROM memorial_incerteza(@id)", new { id });
            if (!linhas.Any()) return Results.NotFound();
            return Results.Ok(linhas);
        });''')
open(p, 'w', encoding='utf-8').write(s)
print('API: APLICADO')
PY
docker compose up -d --build api && ./backup-projeto.sh
