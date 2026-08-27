#!/bin/bash
# ══ Tela de validação: certificado substituído (parte 2) ══
set -e
cd /root/cert-saas
python3 <<'PYEOF'
p = 'src/Api/wwwroot/validar.html'
s = open(p, encoding='utf-8').read()
if "estado === 'substituido'" in s:
    print('JA APLICADO'); raise SystemExit

v = "    if (c.estado === 'cancelado') {"
assert v in s and s.count(v) == 1, 'ANCORA cancelado nao bateu'

L = []
A = L.append
A("    if (c.estado === 'substituido') {")
A("      // Etiqueta no cliente aponta para o documento antigo: avisa e")
A("      // encaminha para a versao vigente (Joao, 19/08/2026).")
A("      const dt = v => v ? new Date(v).toLocaleDateString('pt-BR') : '\u2014';")
A("      const btn = c.vigente_uuid")
A("        ? '<p style=\"text-align:center;margin:0 0 16px\">'")
A("          + '<a href=\"/validar/' + c.vigente_uuid + '\" style=\"display:inline-block;'")
A("          + 'background:#164066;color:#fff;text-decoration:none;padding:12px 24px;'")
A("          + 'border-radius:8px;font-size:15px\">Ver o certificado vigente'")
A("          + (c.vigente_numero ? ' (' + esc(c.vigente_numero) + ')' : '') + ' \u2192</a></p>'")
A("        : '<p class=\"dica\" style=\"color:#b02a37\">A vers\u00e3o vigente ainda n\u00e3o foi emitida. '")
A("          + 'Entre em contato com o laborat\u00f3rio.</p>';")
A("      box.innerHTML = '<div class=\"cabecalho\" style=\"background:#8a6d1a\">'")
A("        + '<b>' + esc(c.empresa || 'Certificado') + '</b>'")
A("        + '<span>Valida\u00e7\u00e3o de certificado</span></div>'")
A("        + '<div class=\"conteudo\">'")
A("        + '<p style=\"color:#8a6d1a;font-weight:600;font-size:16px;margin:0 0 6px\">'")
A("        + '\u26a0\ufe0f Este certificado foi substitu\u00eddo</p>'")
A("        + '<p class=\"dica\" style=\"margin:0 0 14px\">Existe uma vers\u00e3o mais recente deste '")
A("        + 'documento, que \u00e9 a que est\u00e1 vigente.</p>'")
A("        + btn")
A("        + '<table>'")
A("        + '<tr><td>Certificado</td><td><b>' + esc(c.numero || '\u2014') + '</b></td></tr>'")
A("        + '<tr><td>Situa\u00e7\u00e3o</td><td style=\"color:#8a6d1a;font-weight:700\">Substitu\u00eddo</td></tr>'")
A("        + '<tr><td>Emitido em</td><td>' + dt(c.data_emissao) + '</td></tr>'")
A("        + '<tr><td>Cliente</td><td>' + esc(c.cliente || '\u2014') + '</td></tr>'")
A("        + '<tr><td>Equipamento</td><td>' + esc(c.balanca || '\u2014')")
A("        + (c.num_serie ? ' \u00b7 s\u00e9rie ' + esc(c.num_serie) : '') + '</td></tr>'")
A("        + '<tr><td>Calibrado em</td><td>' + dt(c.data_calibracao) + '</td></tr>'")
A("        + '</table>'")
A("        + '<p class=\"dica\" style=\"margin-top:12px\">Substitui\u00e7\u00e3o \u00e9 uma corre\u00e7\u00e3o formal do '")
A("        + 'documento \u2014 o registro anterior \u00e9 mantido no hist\u00f3rico para fins de auditoria.</p>'")
A("        + '</div>';")
A("      return;")
A("    }")
A("")

s = s.replace(v, "\n".join(L) + v)
open(p, 'w', encoding='utf-8').write(s)
print('validar.html: APLICADO')
PYEOF
grep -c "substituido" src/Api/wwwroot/validar.html
docker compose up -d --build api && ./backup-projeto.sh
