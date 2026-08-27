#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Função de LIMPEZA de certificados no super-admin
# (com PIN destrutivo + backup automático recuperável)
# ═══════════════════════════════════════════════════════════════
set -e
BASE="/root/cert-saas"
SA="$BASE/src/Api/Sistema/SuperAdminEndpoints.cs"
APP="$BASE/src/Api/wwwroot/app.js"
STAMP=$(date +%Y%m%d-%H%M%S)

for f in 84_limpeza_certificados.sql endpoint-limpeza.cs records.cs funcoes-limpeza.js; do
  [ -f "./$f" ] || { echo "❌ Falta: $f"; exit 1; }
done
cp "$SA" "/root/SuperAdminEndpoints.cs.bak-limp-$STAMP"
cp "$APP" "/root/app.js.bak-limp-$STAMP"
cp ./84_limpeza_certificados.sql "$BASE/db/seed/"
sed -i 's/\r$//' "$BASE/db/seed/84_limpeza_certificados.sql"
echo "✓ backups ($STAMP) + SQL copiado"

python3 << 'PYEOF'
import sys
def um(s, anc, rot):
    n=s.count(anc)
    if n!=1: print(f"❌ [{rot}] {n}x (esperava 1)"); sys.exit(1)

# ═══ SuperAdminEndpoints: records + endpoint ═══
p="/root/cert-saas/src/Api/Sistema/SuperAdminEndpoints.cs"; s=open(p).read()
if "LimparCertsRequest" in s:
    print("  • SuperAdmin: já aplicado, pulando")
else:
    # records: adiciona após o último record conhecido
    um(s, "public record EditarCobrancaRequest(DateOnly? Competencia, DateOnly? Vencimento,", "records")
    # acha a linha completa do EditarCobrancaRequest (pode ter continuação) — insere os novos records ANTES dele
    novos = open('/root/cert-saas/records.cs').read() if False else open('./records.cs').read()
    s = s.replace("public record EditarCobrancaRequest(DateOnly? Competencia, DateOnly? Vencimento,",
                  novos.strip() + "\npublic record EditarCobrancaRequest(DateOnly? Competencia, DateOnly? Vencimento,")
    # endpoint: insere antes do fechamento do Map. Âncora: a linha "renderPainelSA" não existe no backend.
    # Uso como âncora o registro do último g.Map conhecido — inserir após o bloco de erros/limpar.
    anc = '        g.MapPost("/erros/limpar", async (ClaimsPrincipal user, NpgsqlDataSource ds) =>'
    um(s, anc, "ancora endpoint")
    ep = open('./endpoint-limpeza.cs').read()
    s = s.replace(anc, ep + "\n" + anc)
    open(p,"w").write(s)
    print("  ✓ SuperAdmin: records + endpoints (limpar + pin)")

import re
t=re.sub(r'"(?:[^"\\]|\\.)*"','""',s); t=re.sub(r'//.*','',t)
# não conta chaves de forma confiável com strings SQL """...""", então só avisa
print("  (revisar compilação no rebuild)")

# ═══ app.js: as funções + o botão no painel ═══
p="/root/cert-saas/src/Api/wwwroot/app.js"; s=open(p).read()
if "abrirLimparCertsSA" in s:
    print("  • app.js: já aplicado, pulando")
else:
    # 1) funções ao final (append seguro)
    s = s.rstrip() + "\n" + open('./funcoes-limpeza.js').read()
    # 2) botão: usa o marcador do rótulo (estável). O botão chama a função
    #    lendo o id/nome do estado global _saEmpresaId — sem template complexo.
    marcador = 'reenviarConviteAdmin('
    # acha o botão de reenviar e insere um botão logo após o </button> dele
    import re
    # o padrão: <button onclick="reenviarConviteAdmin('...')">✉️ Reenviar por e-mail</button>
    m = re.search(r'(<button onclick="reenviarConviteAdmin\([^)]*\)">[^<]*</button>)', s)
    if m:
        botao_reenviar = m.group(1)
        botao_novo = botao_reenviar + '\n        <button style="color:#b02a37;border-color:#b02a37" onclick="abrirLimparCertsSA(window._saEmpresaId, document.querySelector(\'#sa-conteudo h2\')?.textContent || \'\')">🗑 Limpar certificados</button>'
        s = s.replace(botao_reenviar, botao_novo, 1)
        print("  ✓ app.js: botão Limpar certificados no painel")
    else:
        print("  ⚠ botão de reenviar não encontrado — funções add, botão manual")
    open(p,"w").write(s)
    print("  ✓ app.js: funções de limpeza + PIN")
PYEOF

if command -v node >/dev/null 2>&1; then
  node --check "$APP" && echo "✓ app.js validado" || { echo "❌ erro JS! restaurando"; cp /root/app.js.bak-limp-$STAMP "$APP"; exit 1; }
fi
echo ""
echo "✅ Limpeza instalada! ⚠️  REBUILD + migração:"
echo "   docker compose exec -T db psql -U certsaas -d certsaas < db/seed/84_limpeza_certificados.sql"
echo "   docker compose up -d --build api"
echo ""
echo "DEPOIS: configure o PIN destrutivo (no console do navegador ou botão):"
echo "   abrirConfigPinSA()"
echo ""
echo "Reverter: cp /root/SuperAdminEndpoints.cs.bak-limp-$STAMP $SA ; cp /root/app.js.bak-limp-$STAMP $APP"
