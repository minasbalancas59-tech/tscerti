-- Incerteza dos pesos-padrão no certificado de conformidade: versão
-- completa. João, 10/09/2026.
--
-- Escopo desta migration (redesenhada do zero — nada disso chegou a ser
-- aplicado em produção ainda, então não há compatibilidade a preservar
-- com uma versão anterior deste próprio recurso):
--
--   1) Empresa escolhe, numa configuração, se quer usar a incerteza
--      REAL declarada no certificado do peso, ou manter a aproximação
--      por classe de sempre. PADRÃO: desligado (comportamento de hoje).
--   2) Empuxo do ar entra como um QUARTO componente do cálculo, com a
--      fórmula CORRETA (referenciada à densidade convencional de
--      8000 kg/m³ — ver nota mais abaixo). Como todo peso cadastrado
--      até hoje tem densidade = 8000 (valor padrão da coluna desde a
--      fase 1 do RBC), esse componente sai EXATAMENTE ZERO para tudo
--      que já existe — só passa a valer algo no dia em que alguém
--      cadastrar a densidade real de um peso diferente do padrão.
--   3) Todos os componentes ficam CONGELADOS por ponto no momento da
--      submissão — não só o resultado final. É o que garante que o
--      Memorial de cálculo de um certificado nunca mude de explicação
--      depois de emitido, não importa o que aconteça depois com o
--      cadastro dos pesos ou com a configuração da empresa.
--
-- SOBRE A FÓRMULA DE EMPUXO: a massa convencional (o valor que todo
-- peso-padrão declara) já é definida contra uma densidade de referência
-- de 8000 kg/m³. Por isso a incerteza do empuxo não escala com
-- carga/densidade_do_peso (como o motor RBC calculava até hoje — um
-- bug real, corrigido nesta mesma leva, ver IncertezaRbc.cs), e sim com
-- a DIFERENÇA entre a densidade real do peso e essa referência:
--     u_empuxo = carga × u(ρ_ar) × |1/ρ_peso − 1/8000|
-- Peso de aço inox (densidade ~8000) → praticamente zero, como já era
-- esperado fisicamente. Só passa a importar com materiais bem
-- diferentes (ex.: ferro fundido, latão) ou em balanças de altíssima
-- resolução.

-- ── 1) Empresa: preferência de qual método usar para u_pesos ──
ALTER TABLE empresa ADD COLUMN IF NOT EXISTS usar_incerteza_declarada_pesos
    boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN empresa.usar_incerteza_declarada_pesos IS
    'Quando true, o cálculo do certificado de conformidade usa a incerteza '
    'real declarada no certificado do peso (se cadastrada) em vez da '
    'aproximação genérica pela classe. Padrão false = comportamento histórico.';

-- ── 2) ensaio_indicacao: os componentes congelados, ponto a ponto ──
ALTER TABLE ensaio_indicacao ADD COLUMN IF NOT EXISTS u_pesos_kg    numeric(14,8);
ALTER TABLE ensaio_indicacao ADD COLUMN IF NOT EXISTS u_leitura_kg  numeric(14,8);
ALTER TABLE ensaio_indicacao ADD COLUMN IF NOT EXISTS u_repet_kg    numeric(14,8);
ALTER TABLE ensaio_indicacao ADD COLUMN IF NOT EXISTS u_empuxo_kg   numeric(14,8);
ALTER TABLE ensaio_indicacao ADD COLUMN IF NOT EXISTS u_pesos_fonte text
    CHECK (u_pesos_fonte IN ('classe', 'declarada'));
-- Referência legível de qual peso supriu o valor declarado (só quando
-- u_pesos_fonte = 'declarada'), para o Memorial explicar "veio do peso X,
-- certificado Y" em vez de só um número solto.
ALTER TABLE ensaio_indicacao ADD COLUMN IF NOT EXISTS u_pesos_ref   text;
-- Densidade do peso REALMENTE usada no cálculo de empuxo deste ponto —
-- congelada pelo mesmo motivo dos demais componentes.
ALTER TABLE ensaio_indicacao ADD COLUMN IF NOT EXISTS densidade_peso_kgm3 numeric(10,2);

-- ── 3) Backfill dos certificados já emitidos ──
-- u_pesos/u_leitura/u_repet: mesma fórmula que já estava em uso (só por
-- classe — a opção "declarada" não existia antes de hoje, e a
-- configuração da empresa nasce desligada). u_empuxo: sempre zero, já
-- que nenhum peso tinha densidade diferente de 8000 até este momento.
-- Depois deste UPDATE os números exibidos não mudam nem um pouco.
WITH pesos_por_cert AS (
    SELECT cp.certificado_id, COALESCE(max(pp.classe), 'M1') AS classe_pesos
      FROM certificado_peso cp JOIN peso_padrao pp ON pp.id = cp.peso_padrao_id
     GROUP BY cp.certificado_id
), mpe AS (
    SELECT certificado_id,
           CASE classe_pesos
                WHEN 'E1' THEN 0.5e-6 WHEN 'E2' THEN 1.6e-6
                WHEN 'F1' THEN 5e-6   WHEN 'F2' THEN 16e-6
                WHEN 'M1' THEN 50e-6  WHEN 'M2' THEN 160e-6
                WHEN 'M3' THEN 500e-6 ELSE 50e-6 END::numeric AS rel
      FROM pesos_por_cert
), rep AS (
    SELECT certificado_id, COALESCE(stddev_samp(indicacao), 0) AS s
      FROM ensaio_repetibilidade GROUP BY certificado_id
)
UPDATE ensaio_indicacao i
   SET u_pesos_kg    = round((i.carga_aplicada * COALESCE(m.rel, 50e-6) / sqrt(3))::numeric, 8),
       u_leitura_kg  = round((COALESCE(i.divisao_e_ponto, b.divisao_e) / sqrt(12) * sqrt(2))::numeric, 8),
       u_repet_kg    = round(COALESCE(r.s, 0)::numeric, 8),
       u_empuxo_kg   = 0,
       u_pesos_fonte = 'classe',
       densidade_peso_kgm3 = 8000
  FROM certificado ct
  JOIN balanca b ON b.id = ct.balanca_id
  LEFT JOIN mpe m ON m.certificado_id = ct.id
  LEFT JOIN rep r ON r.certificado_id = ct.id
 WHERE i.certificado_id = ct.id
   AND i.u_pesos_kg IS NULL;

-- ── 4) memorial_incerteza() — lê os componentes congelados, agora com
--    4 termos e as referências para a explicação completa ──
CREATE OR REPLACE FUNCTION public.memorial_incerteza(p_cert uuid)
 RETURNS TABLE(numero text, empresa text, cliente text, balanca text, classe_balanca text,
     unidade text, casas integer, classe_pesos text, mpe_relativo numeric, desvio_rep numeric,
     n_repeticoes bigint, fator_k numeric, ordem integer, carga numeric, indicacao numeric,
     erro numeric, divisao_ponto numeric, u_pesos numeric, u_leitura numeric, u_repet numeric,
     u_empuxo numeric, u_combinada numeric, incerteza numeric, ema numeric, fonte_pesos text,
     ref_pesos text, densidade_peso numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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
  SELECT COALESCE(max(pp.classe), 'M1') AS classe_pesos
    FROM certificado_peso cp JOIN peso_padrao pp ON pp.id = cp.peso_padrao_id
   WHERE cp.certificado_id = p_cert
), rep AS (
  SELECT count(*) AS n, COALESCE(stddev_samp(indicacao), 0) AS s
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
       COALESCE(i.u_pesos_kg, 0)   AS u_pesos,
       COALESCE(i.u_leitura_kg, 0) AS u_leitura,
       COALESCE(i.u_repet_kg, 0)   AS u_repet,
       COALESCE(i.u_empuxo_kg, 0)  AS u_empuxo,
       round(sqrt(
           power(COALESCE(i.u_pesos_kg, 0), 2)
         + power(COALESCE(i.u_leitura_kg, 0), 2)
         + power(COALESCE(i.u_repet_kg, 0), 2)
         + power(COALESCE(i.u_empuxo_kg, 0), 2))::numeric, 6) AS u_combinada,
       i.incerteza, i.ema,
       COALESCE(i.u_pesos_fonte, 'classe') AS fonte_pesos,
       i.u_pesos_ref AS ref_pesos,
       COALESCE(i.densidade_peso_kgm3, 8000) AS densidade_peso
  FROM base b
  CROSS JOIN pesos p CROSS JOIN rep r CROSS JOIN mpe m
  JOIN ensaio_indicacao i ON i.certificado_id = b.id
 ORDER BY i.ordem
$function$;

SELECT 'Migração 157: incerteza congelada por ponto, empuxo do ar e preferência por empresa'
    AS resultado;
