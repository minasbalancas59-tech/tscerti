#!/bin/bash
# ══ FASE 2 — parte 2: componente u_sub no motor de incerteza ══
set -e
cd /root/cert-saas
python3 - <<'PY'
p = 'src/Api/Certificados/IncertezaRbc.cs'
s = open(p, encoding='utf-8').read()
if 'U_sub' in s:
    print('Motor: JA APLICADO'); raise SystemExit

# 1) record do orçamento ganha o componente
v = '        double U_exc,          // componente excentricidade'
assert v in s and s.count(v) == 1, 'ANCORA record'
s = s.replace(v, v + '\n        double U_sub,          // componente substituição (degraus)')

# 2) assinatura do Calcular recebe degraus e fator
v = """        double tempC, double pressaoHpa, double umidadePct,
        double densidadePeso)"""
assert v in s and s.count(v) == 1, 'ANCORA assinatura'
s = s.replace(v, """        double tempC, double pressaoHpa, double umidadePct,
        double densidadePeso,
        int degrausSub = 0, double fatorSub = 1.0)""")

# 3) cálculo do u_sub logo após a repetibilidade
v = '        double uRep = n >= 2 ? s / Math.Sqrt(n) : 0;'
assert v in s and s.count(v) == 1, 'ANCORA uRep'
s = s.replace(v, v + '''

        // (1b) MÉTODO DA SUBSTITUIÇÃO (João, 14/08/2026)
        // Cada degrau reintroduz a incerteza de repetibilidade da balança:
        // a reprodução da indicação com a carga auxiliar não é perfeita.
        // Degraus independentes somam em quadratura → √n.
        //   u_sub = fator · √(degraus) · s_rep
        // O FATOR é configurável por empresa (empresa.rbc_fator_sub) até que
        // a referência normativa seja confirmada com a Cgcre/EURAMET cg-18.
        // Padrão 1,0 = desvio-padrão integral por degrau (conservador).
        double uSub = degrausSub > 0 && s > 0
            ? fatorSub * Math.Sqrt(degrausSub) * s
            : 0;''')

# 4) entra na combinação em quadratura
import re
m = re.search(r'double uC = Math\.Sqrt\(([^;]+)\);', s)
assert m, 'ANCORA combinacao (uC) nao encontrada'
antigo = m.group(0)
novo = antigo.replace(');', ' + uSub * uSub);')
s = s.replace(antigo, novo, 1)
print('combinação atualizada:', novo.strip()[:90])

# 5) devolve o componente no retorno
m2 = re.search(r'return new OrcamentoPonto\((.*?)\);', s, re.S)
assert m2, 'ANCORA retorno'
ret = m2.group(0)
assert 'uExc' in ret, 'retorno sem uExc — verifique a ordem dos campos'
s = s.replace(ret, ret.replace('uExc,', 'uExc, uSub,', 1), 1)

open(p, 'w', encoding='utf-8').write(s)
print('Motor: APLICADO')
PY

python3 - <<'PY'
p = 'src/Api/Certificados/RbcEndpoints.cs'
s = open(p, encoding='utf-8').read()
if 'degrausSub' in s:
    print('Endpoints RBC: JA APLICADO'); raise SystemExit

# fator da empresa + degraus do ponto na chamada do motor
v = """                        var orc = IncertezaRbc.Calcular(
                            leituras, valorConv, divisao, uPadrao, erroExcMax,
                            temp, pressao, umid,
                            (double)(ponto.DensidadePeso ?? 8000));"""
assert v in s and s.count(v) == 1, 'ANCORA chamada'
s = s.replace(v, """                        // Degraus de substituição do ponto e fator da empresa
                        int degrausSub = 0;
                        try { degrausSub = (int?)ponto.DegrausSub ?? 0; } catch { }
                        var fatorSub = await conn.ExecuteScalarAsync<decimal?>(
                            "SELECT rbc_fator_sub FROM empresa WHERE id=@e", new { e = empresaId }) ?? 1.0m;

                        var orc = IncertezaRbc.Calcular(
                            leituras, valorConv, divisao, uPadrao, erroExcMax,
                            temp, pressao, umid,
                            (double)(ponto.DensidadePeso ?? 8000),
                            degrausSub, (double)fatorSub);""")

# grava u_sub e degraus na tabela
v = """                                ordem_ponto, carga, media, erro, s_rep, u_rep, u_res, u_pad,
                                u_exc, u_buoy, u_c, veff, k, u_expandida)"""
assert v in s and s.count(v) == 1, 'ANCORA insert colunas'
s = s.replace(v, """                                ordem_ponto, carga, media, erro, s_rep, u_rep, u_res, u_pad,
                                u_exc, u_buoy, u_c, veff, k, u_expandida, u_sub, degraus_sub)""")

v = """                            VALUES (@empresaId, @id, @op, @carga, @media, @erro, @s, @urep,
                                @ures, @upad, @uexc, @ubuoy, @uc, @veff, @k, @u)"""
assert v in s and s.count(v) == 1, 'ANCORA insert values'
s = s.replace(v, """                            VALUES (@empresaId, @id, @op, @carga, @media, @erro, @s, @urep,
                                @ures, @upad, @uexc, @ubuoy, @uc, @veff, @k, @u, @usub, @degrausSub)""")

v = """                                k = orc.K, u = orc.U });"""
assert v in s and s.count(v) == 1, 'ANCORA parametros'
s = s.replace(v, """                                k = orc.K, u = orc.U, usub = orc.U_sub, degrausSub });""")

open(p, 'w', encoding='utf-8').write(s)
print('Endpoints RBC: APLICADO')
PY
echo
docker compose up -d --build api && ./backup-projeto.sh
