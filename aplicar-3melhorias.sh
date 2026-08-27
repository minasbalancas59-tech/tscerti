#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# 3 melhorias: unidade correta nas listagens de balança +
# excluir rascunho + continuidade entre técnicos
# ═══════════════════════════════════════════════════════════════
set -e
BASE="/root/cert-saas"
STAMP=$(date +%Y%m%d-%H%M%S)
for f in patch-frontend.py patch-backend.py endpoints-rascunho.cs; do
  [ -f "./$f" ] || { echo "❌ Falta: $f"; exit 1; }
done
cp "$BASE/src/Api/wwwroot/app.js" "/root/app.js.bak-3m-$STAMP"
cp "$BASE/src/Api/wwwroot/index.html" "/root/index.html.bak-3m-$STAMP"
cp "$BASE/src/Api/Certificados/CertificadoEndpoints.cs" "/root/CertificadoEndpoints.cs.bak-3m-$STAMP"
echo "✓ backups ($STAMP)"

# 1) backend: liberar rascunhos + tecnico_nome
python3 ./patch-backend.py

# 2) backend: inserir os endpoints (DELETE + assumir) no CertificadoEndpoints
python3 << 'PYEOF'
import sys
p = '/root/cert-saas/src/Api/Certificados/CertificadoEndpoints.cs'
s = open(p, encoding='utf-8').read()
if 'MapDelete("/{id:guid}"' in s and 'excluir_rascunho' in s:
    print("  - endpoints ja existem, pulando")
else:
    anc = '        g.MapGet("/{id:guid}", async (Guid id, ClaimsPrincipal user, NpgsqlDataSource ds) =>'
    n = s.count(anc)
    if n != 1:
        print(f"ERRO: ancora do MapGet {n}x"); sys.exit(1)
    ep = open('./endpoints-rascunho.cs', encoding='utf-8').read()
    s = s.replace(anc, ep + "\n" + anc)
    open(p, 'w', encoding='utf-8').write(s)
    print("OK - endpoints DELETE + assumir inseridos")
PYEOF

# 3) frontend: unidade + continuidade + excluir
python3 ./patch-frontend.py

if command -v node >/dev/null 2>&1; then
  node --check "$BASE/src/Api/wwwroot/app.js" && echo "✓ app.js validado" || {
    echo "❌ erro JS! restaurando"; cp /root/app.js.bak-3m-$STAMP "$BASE/src/Api/wwwroot/app.js"; exit 1; }
fi
echo ""
echo "✅ 3 melhorias aplicadas! ⚠️  REBUILD:"
echo "   docker compose up -d --build api"
echo ""
echo "TESTAR (Ctrl+Shift+R):"
echo "  1) Listagem de balanças do cliente: a de 5000 g deve mostrar 'g'"
echo "  2) Abrir um rascunho e ver o botão '🗑 Excluir' no rodapé"
echo "  3) Com outro técnico: abrir rascunho alheio → pergunta de continuidade"
echo ""
echo "Reverter: /root/*.bak-3m-$STAMP"
