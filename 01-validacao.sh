#!/bin/bash
# ══ Validação de certificado SUBSTITUÍDO (João, 19/08/2026) ══
# A etiqueta colada no cliente aponta para o certificado antigo. Ao
# escanear, a página passa a avisar e a encaminhar para a versão vigente.
set -e
cd /root/cert-saas

python3 - <<'PY'
p = 'src/Api/Certificados/AprovacaoEndpoints.cs'
s = open(p, encoding='utf-8').read()
if 'vigente_uuid' in s:
    print('API: JA APLICADO'); raise SystemExit

# 1) a query traz o número e o status
v = "                       ct.data_emissao, ct.status,"
assert v in s and s.count(v) == 1, 'ANCORA query validar'
# 2) o retorno ganha os dados da versão vigente
alvo = 'return Results.Ok(new'
i = s.find(alvo, s.find('MapGet("/api/validar/{uuid:guid}"'))
assert i > 0, 'retorno do validar nao encontrado'
j = s.find('});', i)
assert j > i, 'fim do retorno nao encontrado'

bloco_antes = """            // Certificado SUBSTITUÍDO: busca a revisão vigente para
            // encaminhar quem escaneou a etiqueta antiga (João, 19/08/2026).
            string? vigenteNumero = null; Guid? vigenteUuid = null;
            if ((string?)c.status == "substituido")
            {
                var vig = await conn.QuerySingleOrDefaultAsync("""
                    SELECT numero, uuid_validacao FROM certificado
                     WHERE substitui_numero = @num AND status IN ('emitido','substituido')
                     ORDER BY data_emissao DESC LIMIT 1
                    """, new { num = (string?)c.numero });
                if (vig is not null)
                {
                    vigenteNumero = (string?)vig.numero;
                    vigenteUuid = (Guid?)vig.uuid_validacao;
                }
            }

"""
s = s[:i] + bloco_antes + s[i:]
# reposiciona depois da inserção
i = s.find(alvo, s.find('MapGet("/api/validar/{uuid:guid}"'))
k = s.find('{', i)
s = s[:k+1] + '\n                vigente_numero = vigenteNumero,\n                vigente_uuid = vigenteUuid,' + s[k+1:]
open(p, 'w', encoding='utf-8').write(s)
print('API: dados da versao vigente incluidos')
PY

python3 - <<'PY'
p = 'src/Api/wwwroot/validar.html'
s = open(p, encoding='utf-8').read()
if "estado === 'substituido'" in s:
    print('validar.html: JA APLICADO'); raise SystemExit

v = "    if (c.estado === 'cancelado') {"
assert v in s and s.count(v) == 1, 'ANCORA cancelado'
novo = """    if (c.estado === 'substituido') {
      // A etiqueta no cliente aponta para o documento antigo: avisa e
      // encaminha para a versão vigente (João, 19/08/2026).
      box.innerHTML = `
        <div class="cabecalho" style="background:#8a6d1a">
          <b>${esc(c.empresa || 'Certificado')}</b>
          <span>Validação de certificado</span>
        </div>
        <div class="conteudo">
          <p style="color:#8a6d1a;font-weight:600;font-size:16px;margin:0 0 6px">
            ⚠️ Este certificado foi substituído</p>
          <p class="dica" style="margin:0 0 14px">Existe uma versão mais recente deste documento,
            que é a que está vigente.</p>
          ${c.vigente_uuid ? `
            <p style="text-align:center;margin:0 0 16px">
              <a href="/validar/${c.vigente_uuid}" style="display:inline-block;background:#164066;
                color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px">
                Ver o certificado vigente${c.vigente_numero ? ' (' + esc(c.vigente_numero) + ')' : ''} →</a></p>`
            : `<p class="dica" style="color:#b02a37">A versão vigente ainda não foi emitida.
                 Entre em contato com o laboratório.</p>`}
          <table>
            <tr><td>Certificado</td><td><b>${esc(c.numero || '—')}</b></td></tr>
            <tr><td>Situação</td><td style="color:#8a6d1a;font-weight:700">Substituído</td></tr>
            <tr><td>Emitido em</td><td>${c.data_emissao ? new Date(c.data_emissao).toLocaleDateString('pt-BR') : '—'}</td></tr>
            <tr><td>Cliente</td><td>${esc(c.cliente || '—')}</td></tr>
            <tr><td>Equipamento</td><td>${esc(c.balanca || '—')}${c.num_serie ? ' · série ' + esc(c.num_serie) : ''}</td></tr>
            <tr><td>Calibrado em</td><td>${c.data_calibracao ? new Date(c.data_calibracao).toLocaleDateString('pt-BR') : '—'}</td></tr>
          </table>
          <p class="dica" style="margin-top:12px">Substituição é uma correção formal do documento —
            o registro anterior é mantido no histórico para fins de auditoria.</p>
        </div>`;
      return;
    }

""" + v
s = s.replace(v, novo)
open(p, 'w', encoding='utf-8').write(s)
print('validar.html: tela de substituido criada')
PY
echo
docker compose up -d --build api && ./backup-projeto.sh
