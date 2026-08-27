#!/bin/bash
# ══ Revisão do contrato (João, 12/08/2026) ══
# 4 adições: multa por rescisão antecipada, SLA, ressalva de uso para
# clientes do CONTRATANTE e reforço do suporte. Faz backup antes.
set -e
cd /root/cert-saas
ARQ=src/Api/wwwroot/contrato-modelo.html
cp "$ARQ" "$ARQ.bak-$(date +%Y%m%d-%H%M)"
echo "backup criado: $ARQ.bak-*"

python3 - <<'PY'
p = 'src/Api/wwwroot/contrato-modelo.html'
s = open(p, encoding='utf-8').read()
mudou = 0

# ── 1) Ressalva de uso para os clientes do CONTRATANTE (cláusula 9) ──
if 'não se considera sublicenciamento' not in s:
    v = """<p>9.2. A identidade visual do CONTRATANTE"""
    assert v in s, 'ancora 9.2'
    novo = """<p>9.1.1. <b>Não se considera sublicenciamento</b> a emissão de certificados para os
clientes do CONTRATANTE no exercício regular de sua atividade, nem o acesso destes ao portal de
consulta e validação disponibilizado pelo sistema, usos que integram a própria finalidade deste
contrato.</p>
""" + v
    s = s.replace(v, novo); mudou += 1
    print('+ 9.1.1 uso para clientes do CONTRATANTE')

# ── 2) SLA de disponibilidade (cláusula 6) ──
if 'apurada mensalmente' not in s:
    v = """<p>6.2. Realizar <b>cópias de segurança diárias</b>"""
    assert v in s, 'ancora 6.2'
    novo = """<p>6.1.1. A CONTRATADA envidará seus melhores esforços para manter <b>disponibilidade
mensal de 99% (noventa e nove por cento)</b>, apurada mensalmente e excluídas as janelas de
manutenção programada e as hipóteses da cláusula 6.1.</p>
""" + v
    s = s.replace(v, novo); mudou += 1
    print('+ 6.1.1 SLA de 99%')

# ── 3) Multa por rescisão antecipada (cláusula 12) ──
if 'rescisão antecipada' not in s:
    v = """<p>12.2. A rescisão não exonera o pagamento"""
    assert v in s, 'ancora 12.2'
    novo = """<p>12.1.1. Na <b>rescisão antecipada por iniciativa do CONTRATANTE</b>, em contrato
por prazo determinado, será devida multa compensatória equivalente a <b>30% (trinta por cento)</b>
das mensalidades vincendas até o termo final, acrescida da restituição dos descontos concedidos em
razão do prazo contratado, salvo se a rescisão decorrer de descumprimento comprovado da CONTRATADA.</p>
""" + v
    s = s.replace(v, novo); mudou += 1
    print('+ 12.1.1 multa por rescisão antecipada')

open(p, 'w', encoding='utf-8').write(s)
print(f'\n{mudou} cláusula(s) adicionada(s)')
PY

echo
echo "── conferindo o resultado ──"
grep -c "9.1.1\|6.1.1\|12.1.1" src/Api/wwwroot/contrato-modelo.html
echo
echo "── a cláusula de suporte (variável) está definida? ──"
grep -n "ClausulaSuporte" src/Api/wwwroot/app.js | head -3
echo
echo "Rebuild da api para publicar o modelo novo:"
echo "  docker compose up -d --build api && ./backup-projeto.sh"
