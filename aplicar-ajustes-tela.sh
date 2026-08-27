#!/bin/bash
# Aplica os 5 ajustes na tela RBC: atualiza rbc.js + o HTML da tela + CSS.
# A tela RBC já está instalada; isto só ATUALIZA os arquivos.
set -e
BASE="/root/cert-saas"; WWW="$BASE/src/Api/wwwroot"
STAMP=$(date +%Y%m%d-%H%M%S)
[ -f ./rbc.js ] || { echo "❌ Falta rbc.js"; exit 1; }
cp "$WWW/rbc.js" "/root/rbc.js.bak-ajuste-$STAMP" 2>/dev/null || true
cp "$WWW/index.html" "/root/index.html.bak-ajuste-$STAMP"
cp "$WWW/styles.css" "/root/styles.css.bak-ajuste-$STAMP"
echo "✓ backups ($STAMP)"

# 1) rbc.js: substitui pelo novo (via base64 se fornecido, senão o arquivo direto)
if [ -f ./rbc.js.b64 ]; then
  base64 -d ./rbc.js.b64 > "$WWW/rbc.js"
  echo "✓ rbc.js atualizado (via base64)"
else
  cp ./rbc.js "$WWW/rbc.js"
  echo "✓ rbc.js atualizado"
fi

python3 << 'PYEOF'
import sys
def um(s,anc,rot):
    if s.count(anc)!=1: print(f"❌ [{rot}] {s.count(anc)}x"); sys.exit(1)

WWW="/root/cert-saas/src/Api/wwwroot"

# HTML: substituir o bloco da tela-ensaio-rbc pelo novo (com cabeçalho + botão clima)
p=f"{WWW}/index.html"; s=open(p,encoding='utf-8').read()
if 'rbc-cabecalho' in s:
    print("  • index.html: cabeçalho já presente, pulando HTML")
else:
    # adiciona o cabeçalho após <main> da tela RBC
    anc_main = '<div id="tela-ensaio-rbc" class="tela oculta">'
    um(s, anc_main, "tela rbc")
    # insere o card de cabeçalho logo após o <main> da tela rbc
    import re
    # acha o <main> logo após a tela-ensaio-rbc
    idx = s.find(anc_main)
    main_idx = s.find('<main>', idx)
    if main_idx > 0:
        ins = '<main>\n    <div class="card" id="rbc-cabecalho-card"><div id="rbc-cabecalho"></div></div>'
        s = s[:main_idx] + ins + s[main_idx+len('<main>'):]
        # botão de clima: adiciona ao lado do #rbc-temp
        s = s.replace('<input type="number" step="0.1" id="rbc-temp">',
            '<span class="temp-wrap"><input type="number" step="0.1" id="rbc-temp"><button type="button" class="btn-clima" id="rbc-btn-clima" onclick="sugerirClimaRbc()" title="Sugerir do local">🌡️</button></span>')
        open(p,"w",encoding='utf-8').write(s)
        print("  ✓ index.html: cabeçalho + botão clima")
    else:
        print("  ⚠ <main> da tela RBC não encontrado")

# CSS: adiciona os estilos do cabeçalho se faltam
p=f"{WWW}/styles.css"; s=open(p,encoding='utf-8').read()
if '.rbc-cliente' in s:
    print("  • styles.css: já tem, pulando")
else:
    s += '''
.rbc-cliente { font-size:15px; font-weight:700; color:#1e3a5f; margin-bottom:8px; }
.rbc-dados { display:flex; flex-wrap:wrap; gap:6px 16px; }
.rbc-dado { font-size:12px; color:#33475b; }
.rbc-dado b { color:#1e3a5f; }
#rbc-cabecalho-card { background:#f7f9fb; border-left:4px solid #1e3a5f; }
.temp-wrap { display:flex; gap:4px; align-items:center; }
.temp-wrap input { flex:1; }
.btn-clima { background:#e8edf3; border:none; border-radius:5px; padding:4px 8px; cursor:pointer; font-size:14px; }
'''
    open(p,"w",encoding='utf-8').write(s)
    print("  ✓ styles.css: estilos do cabeçalho")
PYEOF

if command -v node >/dev/null 2>&1; then
  node --check "$WWW/rbc.js" && echo "✓ rbc.js validado" || { echo "❌ erro! restaurando"; cp /root/rbc.js.bak-ajuste-$STAMP "$WWW/rbc.js"; exit 1; }
fi
echo ""
echo "✅ Ajustes aplicados! ⚠️  REBUILD:"
echo "   docker compose up -d --build api"
