#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# FASE 3b (backend) — Endpoints da coleta RBC
# Sobe RbcEndpoints.cs (salvar/ler leituras + calcular incerteza via
# o motor IncertezaRbc) e registra no Program.cs. Não toca em nada
# do fluxo Portaria 157.
# ═══════════════════════════════════════════════════════════════
set -e
BASE="/root/cert-saas"
PROG="$BASE/src/Api/Program.cs"
STAMP=$(date +%Y%m%d-%H%M%S)
[ -f "$PROG" ] || { echo "❌ Falta: $PROG"; exit 1; }
[ -f ./RbcEndpoints.cs ] || { echo "❌ Falta: RbcEndpoints.cs (suba junto)"; exit 1; }
cp "$PROG" "/root/Program.cs.bak-3b-$STAMP"
# copia o RbcEndpoints pro lugar certo
cp ./RbcEndpoints.cs "$BASE/src/Api/Certificados/"
echo "✓ RbcEndpoints.cs copiado + backup do Program.cs ($STAMP)"

python3 << 'PYEOF'
import sys
def um(s, anc, rot):
    n = s.count(anc)
    if n != 1:
        print(f"❌ [{rot}] âncora {n}x (esperava 1). Abortando.")
        sys.exit(1)

p = "/root/cert-saas/src/Api/Program.cs"
s = open(p).read()
if "RbcEndpoints.Map" in s:
    print("  • Program.cs: já registra RbcEndpoints, pulando")
else:
    # registrar logo após CertificadoEndpoints.Map(app);
    um(s, "CertificadoEndpoints.Map(app);", "registro CertificadoEndpoints")
    s = s.replace("CertificadoEndpoints.Map(app);",
                  "CertificadoEndpoints.Map(app);\nRbcEndpoints.Map(app);")
    open(p, "w").write(s)
    print("  ✓ Program.cs: RbcEndpoints.Map(app) registrado após CertificadoEndpoints")
PYEOF
echo ""
echo "✅ Backend RBC pronto! ⚠️  REBUILD (API):"
echo "   docker compose up -d --build api"
echo ""
echo "   Se compilar, os endpoints ficam disponíveis:"
echo "     PUT  /api/certificados/{id}/leituras-rbc  (salva leituras + calcula)"
echo "     GET  /api/certificados/{id}/leituras-rbc  (lê leituras + orçamentos)"
echo ""
echo "Reverter: cp /root/Program.cs.bak-3b-$STAMP $PROG ; rm $BASE/src/Api/Certificados/RbcEndpoints.cs"
