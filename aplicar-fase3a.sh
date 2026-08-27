#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# FASE 3a — Seletor Padrão/RBC + estrutura de dados
# Adiciona o seletor de tipo na nova calibração (só empresa acreditada)
# e grava emitir_rbc no certificado. NÃO toca na tela de calibração.
# ═══════════════════════════════════════════════════════════════
set -e
BASE="/root/cert-saas"
CERT="$BASE/src/Api/Certificados/CertificadoEndpoints.cs"
APP="$BASE/src/Api/wwwroot/app.js"
HTML="$BASE/src/Api/wwwroot/index.html"
STAMP=$(date +%Y%m%d-%H%M%S)
for f in "$CERT" "$APP" "$HTML" ./81_rbc_leituras.sql; do
  [ -f "$f" ] || { echo "❌ Falta: $f"; exit 1; }
done
cp "$CERT" "/root/CertificadoEndpoints.cs.bak-3a-$STAMP"
cp "$APP" "/root/app.js.bak-3a-$STAMP"
cp "$HTML" "/root/index.html.bak-3a-$STAMP"
cp ./81_rbc_leituras.sql "$BASE/db/seed/"
sed -i 's/\r$//' "$BASE/db/seed/81_rbc_leituras.sql"
echo "✓ Backups ($STAMP) e SQL copiado"

python3 << 'PYEOF'
import sys, re
def um(s, anc, rot):
    n = s.count(anc)
    if n != 1:
        print(f"❌ [{rot}] âncora {n}x (esperava 1). Abortando.")
        sys.exit(1)

# ══════════ BACKEND: NovoCertificadoRequest + INSERT ══════════
p = "/root/cert-saas/src/Api/Certificados/CertificadoEndpoints.cs"
s = open(p).read()
if "EmitirRbc" in s:
    print("  • backend: já ajustado, pulando")
else:
    # record +EmitirRbc (opcional)
    um(s, "public record NovoCertificadoRequest(Guid Id, Guid ClienteId, Guid BalancaId);", "record")
    s = s.replace(
      "public record NovoCertificadoRequest(Guid Id, Guid ClienteId, Guid BalancaId);",
      "public record NovoCertificadoRequest(Guid Id, Guid ClienteId, Guid BalancaId, bool EmitirRbc = false);")

    # INSERT: gravar emitir_rbc (validado: só se empresa acreditada)
    um(s, """            var n = await conn.ExecuteAsync(\"\"\"
                INSERT INTO certificado (id, empresa_id, cliente_id, balanca_id, tecnico_id)
                VALUES (@Id, @empresaId, @ClienteId, @BalancaId, @tecnicoId)
                ON CONFLICT (id) DO NOTHING
                \"\"\", new { req.Id, empresaId, req.ClienteId, req.BalancaId,
                           tecnicoId = Tenant.UsuarioId(user) });""", "insert")
    s = s.replace(
      """            var n = await conn.ExecuteAsync(\"\"\"
                INSERT INTO certificado (id, empresa_id, cliente_id, balanca_id, tecnico_id)
                VALUES (@Id, @empresaId, @ClienteId, @BalancaId, @tecnicoId)
                ON CONFLICT (id) DO NOTHING
                \"\"\", new { req.Id, empresaId, req.ClienteId, req.BalancaId,
                           tecnicoId = Tenant.UsuarioId(user) });""",
      """            // RBC só é aceito se a empresa for acreditada
            var acreditada = await conn.ExecuteScalarAsync<bool>(
                "SELECT COALESCE(acreditada,false) FROM empresa WHERE id = @empresaId",
                new { empresaId });
            var emitirRbc = req.EmitirRbc && acreditada;
            var n = await conn.ExecuteAsync(\"\"\"
                INSERT INTO certificado (id, empresa_id, cliente_id, balanca_id, tecnico_id, emitir_rbc)
                VALUES (@Id, @empresaId, @ClienteId, @BalancaId, @tecnicoId, @emitirRbc)
                ON CONFLICT (id) DO NOTHING
                \"\"\", new { req.Id, empresaId, req.ClienteId, req.BalancaId,
                           tecnicoId = Tenant.UsuarioId(user), emitirRbc });""")
    open(p, "w").write(s)
    print("  ✓ CertificadoEndpoints: EmitirRbc no record + INSERT (validado)")

t = re.sub(r'"""[\s\S]*?"""','""',s); t=re.sub(r'"(?:[^"\\]|\\.)*"','""',t); t=re.sub(r'//.*','',t)
if t.count("{")!=t.count("}"):
    print("❌ chaves C# desbalanceadas"); sys.exit(1)
print("  ✓ chaves C# OK")
PYEOF
echo "(backend feito)"

python3 << 'PYEOF'
import sys
def um(s, anc, rot):
    n = s.count(anc)
    if n != 1:
        print(f"❌ [{rot}] âncora {n}x (esperava 1). Abortando.")
        sys.exit(1)

# ══════════ HTML: seletor Padrão/RBC na tela-nova ══════════
p = "/root/cert-saas/src/Api/wwwroot/index.html"
s = open(p).read()
if "sel-tipo-rbc" in s:
    print("  • HTML: já ajustado, pulando")
else:
    anc = """      <input type="hidden" id="sel-balanca">
      <p id="balanca-escolhida" class="dica"></p>
      <button class="btn-primario" onclick="iniciarEnsaio()">Iniciar ensaio</button>"""
    um(s, anc, "tela-nova botão")
    s = s.replace(anc,
"""      <input type="hidden" id="sel-balanca">
      <p id="balanca-escolhida" class="dica"></p>
      <div id="bloco-tipo-rbc" style="display:none;margin:10px 0;padding:10px;border:1px solid #cdd7e5;border-radius:8px;background:#f7f9fb">
        <label style="font-weight:600;color:#1e3a5f">Tipo de certificado
          <select id="sel-tipo-rbc" style="margin-top:4px">
            <option value="padrao">Padrão (com análise de conformidade)</option>
            <option value="rbc">RBC — acreditado (ISO/IEC 17025)</option>
          </select></label>
        <p class="dica" style="margin:4px 0 0">O RBC coleta várias leituras por ponto e calcula a incerteza (sem veredito de aprovação).</p>
      </div>
      <button class="btn-primario" onclick="iniciarEnsaio()">Iniciar ensaio</button>""")
    open(p, "w").write(s)
    print("  ✓ index.html: seletor Padrão/RBC na tela-nova")

# ══════════ JS: mostrar seletor + passar emitirRbc ══════════
p = "/root/cert-saas/src/Api/wwwroot/app.js"
s = open(p).read()
if "sel-tipo-rbc" in s:
    print("  • JS: já ajustado, pulando")
else:
    # 1) novaCalibracao: mostrar/resetar o seletor conforme acreditada
    um(s, "  balancasNova = [];\n  clientesCache = await api('/clientes');\n}", "fim novaCalibracao")
    s = s.replace(
      "  balancasNova = [];\n  clientesCache = await api('/clientes');\n}",
      """  balancasNova = [];
  clientesCache = await api('/clientes');
  // RBC: mostra o seletor de tipo só para empresa acreditada
  const blocoTipo = document.getElementById('bloco-tipo-rbc');
  if (blocoTipo) {
    blocoTipo.style.display = window._empresaAcreditada ? '' : 'none';
    const sel = document.getElementById('sel-tipo-rbc');
    if (sel) sel.value = 'padrao';
  }
  // garante saber se a empresa é acreditada (caso não tenha passado por Pesos)
  if (window._empresaAcreditada === undefined) {
    try { const cfg = await api('/empresa/config'); window._empresaAcreditada = !!cfg.acreditada;
      if (blocoTipo) blocoTipo.style.display = window._empresaAcreditada ? '' : 'none';
    } catch (e) {}
  }
}""")

    # 2) iniciarEnsaio: passar emitirRbc no POST
    um(s, """    await api('/certificados', { method: 'POST',
      body: JSON.stringify({ id: certId, clienteId, balancaId }) });""", "POST criar cert")
    s = s.replace(
      """    await api('/certificados', { method: 'POST',
      body: JSON.stringify({ id: certId, clienteId, balancaId }) });""",
      """    const tipoSel = document.getElementById('sel-tipo-rbc');
    const emitirRbc = !!(window._empresaAcreditada && tipoSel && tipoSel.value === 'rbc');
    window._ensaioRbc = emitirRbc;  // guarda para a coleta (fase 3b)
    await api('/certificados', { method: 'POST',
      body: JSON.stringify({ id: certId, clienteId, balancaId, emitirRbc }) });""")

    open(p, "w").write(s)
    print("  ✓ app.js: seletor no novaCalibracao + emitirRbc no iniciarEnsaio")
PYEOF

if command -v node >/dev/null 2>&1; then
  node --check "$APP" 2>/dev/null && echo "✓ app.js validado" || { echo "❌ erro JS. Restaurando."; cp "/root/CertificadoEndpoints.cs.bak-3a-$STAMP" "$CERT"; cp "/root/app.js.bak-3a-$STAMP" "$APP"; cp "/root/index.html.bak-3a-$STAMP" "$HTML"; exit 1; }
else
  echo "⚠ node não instalado — validado no ambiente do Claude"
fi
echo ""
echo "✅ FASE 3a aplicada! ⚠️  REBUILD (API):"
echo "   docker compose exec -T db psql -U certsaas -d certsaas < db/seed/81_rbc_leituras.sql"
echo "   docker compose up -d --build api"
echo ""
echo "Reverter: cp /root/{CertificadoEndpoints.cs,app.js,index.html}.bak-3a-$STAMP para os lugares"
