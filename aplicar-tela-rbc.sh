#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# FASE 3 (tela) — Coleta RBC completa (3 ensaios)
# Instala rbc.js (isolado) + HTML da tela + CSS + endpoint de pontos
# + ajuste do config + a bifurcação (1 linha no app.js).
# ═══════════════════════════════════════════════════════════════
set -e
BASE="/root/cert-saas"
WWW="$BASE/src/Api/wwwroot"
STAMP=$(date +%Y%m%d-%H%M%S)

for f in rbc.js tela-rbc.html css-rbc.css endpoint-pontos.cs; do
  [ -f "./$f" ] || { echo "❌ Falta: $f"; exit 1; }
done

# backups
cp "$WWW/index.html" "/root/index.html.bak-tela-$STAMP"
cp "$WWW/styles.css" "/root/styles.css.bak-tela-$STAMP"
cp "$WWW/app.js" "/root/app.js.bak-tela-$STAMP"
cp "$BASE/src/Api/Pesos/PesoEndpoints.cs" "/root/PesoEndpoints.cs.bak-tela-$STAMP"
cp "$BASE/src/Api/Empresas/EmpresaConfigEndpoints.cs" "/root/EmpresaConfigEndpoints.cs.bak-tela-$STAMP"
echo "✓ backups ($STAMP)"

# 1) copia o rbc.js
cp ./rbc.js "$WWW/rbc.js"
echo "✓ rbc.js instalado"

python3 << 'PYEOF'
import sys
def um(s, anc, rot):
    n = s.count(anc)
    if n != 1:
        print(f"❌ [{rot}] âncora {n}x (esperava 1). Abortando."); sys.exit(1)

BASE="/root/cert-saas"; WWW=f"{BASE}/src/Api/wwwroot"

# ═══ index.html: add o <script rbc.js> + o HTML da tela ═══
p = f"{WWW}/index.html"; s = open(p).read()
if 'rbc.js' in s:
    print("  • index.html: já tem rbc.js, pulando")
else:
    um(s, '<script src="/app.js"></script>', "script app.js")
    tela = open('./tela-rbc.html').read()
    # insere a tela ANTES do script, e o script rbc.js DEPOIS do app.js
    s = s.replace('<script src="/app.js"></script>',
                  tela + '\n<script src="/app.js"></script>\n<script src="/rbc.js"></script>')
    open(p, "w").write(s)
    print("  ✓ index.html: tela RBC + <script rbc.js>")

# ═══ styles.css: append do CSS ═══
p = f"{WWW}/styles.css"; s = open(p).read()
if '.rbc-u' in s:
    print("  • styles.css: já tem CSS RBC, pulando")
else:
    s += '\n' + open('./css-rbc.css').read()
    open(p, "w").write(s)
    print("  ✓ styles.css: estilos RBC")

# ═══ app.js: a bifurcação (1 linha) ═══
p = f"{WWW}/app.js"; s = open(p).read()
if 'montarTelaEnsaioRbc' in s:
    print("  • app.js: já tem a bifurcação, pulando")
else:
    um(s, "    montarTelaEnsaio(base);", "bifurcação")
    s = s.replace("    montarTelaEnsaio(base);",
                  "    if (window._ensaioRbc) montarTelaEnsaioRbc(); else montarTelaEnsaio(base);")
    open(p, "w").write(s)
    print("  ✓ app.js: bifurcação (se RBC → tela RBC)")

# ═══ EmpresaConfigEndpoints: add os N no SELECT do config ═══
p = f"{BASE}/src/Api/Empresas/EmpresaConfigEndpoints.cs"; s = open(p).read()
if 'rbc_num_leituras' in s:
    print("  • config: já devolve os N, pulando")
else:
    um(s, "                         acreditada, num_acreditacao, selo_rbc_url", "select config")
    s = s.replace("                         acreditada, num_acreditacao, selo_rbc_url",
                  "                         acreditada, num_acreditacao, selo_rbc_url,\n                         rbc_num_leituras, rbc_num_posicoes_exc")
    open(p, "w").write(s)
    print("  ✓ config: devolve rbc_num_leituras + rbc_num_posicoes_exc")

# ═══ PesoEndpoints: add o endpoint pontos-rbc-todos ═══
p = f"{BASE}/src/Api/Pesos/PesoEndpoints.cs"; s = open(p).read()
if 'pontos-rbc-todos' in s:
    print("  • PesoEndpoints: já tem o endpoint, pulando")
else:
    anc = '        // ── Pontos de calibração do peso (RBC) ──────────────────'
    um(s, anc, "âncora pontos")
    ep = open('./endpoint-pontos.cs').read()
    s = s.replace(anc, ep + '\n' + anc)
    open(p, "w").write(s)
    print("  ✓ PesoEndpoints: /pontos-rbc-todos")
PYEOF

# valida o app.js e o rbc.js se node existir
if command -v node >/dev/null 2>&1; then
  node --check "$WWW/app.js" && node --check "$WWW/rbc.js" && echo "✓ JS validado" || { echo "❌ erro JS! restaurando"; cp /root/app.js.bak-tela-$STAMP "$WWW/app.js"; rm -f "$WWW/rbc.js"; exit 1; }
else
  echo "⚠ node ausente — rbc.js já validado no ambiente do Claude"
fi

echo ""
echo "✅ TELA RBC instalada! ⚠️  REBUILD (API):"
echo "   docker compose up -d --build api"
echo ""
echo "Reverter: os backups estão em /root/*.bak-tela-$STAMP e rm $WWW/rbc.js"
