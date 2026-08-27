// ═══════════════════════════════════════════════════════════════
// SUBSTITUA a função salvarNovaEmpresa inteira por esta versão.
// (localize "async function salvarNovaEmpresa()" no app.js e troque
//  da linha "async function salvarNovaEmpresa() {" até o "}" final)
// ═══════════════════════════════════════════════════════════════
async function salvarNovaEmpresa() {
  const erro = $('#ne-erro');
  erro.textContent = '';

  const corpo = {
    razaoSocial: $('#ne-razao').value.trim(), cnpj: $('#ne-cnpj').value.trim(),
    subdominio: $('#ne-sub').value.trim().toLowerCase(),
    prefixoCert: $('#ne-prefixo').value.trim().toUpperCase(),
    plano: $('#ne-plano').value, limiteUsuarios: Number($('#ne-limite').value) || 0,
    adminNome: $('#ne-anome').value.trim(), adminEmail: $('#ne-aemail').value.trim()
  };
  if (!corpo.razaoSocial || !corpo.cnpj || !corpo.subdominio || !corpo.prefixoCert
      || !corpo.adminNome || !corpo.adminEmail) {
    erro.textContent = 'Preencha todos os campos obrigatórios.'; return;
  }

  // Anti-duplo-clique: desabilita o botão enquanto processa
  const btn = document.querySelector('.modal-fundo .btn-primario');
  const btnCancelar = document.querySelector('.modal-fundo .rodape-acoes button:first-child');
  const textoOriginal = btn ? btn.textContent : 'Criar empresa';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Criando...'; }
  if (btnCancelar) btnCancelar.disabled = true;

  try {
    const r = await saApi('/empresas', { method: 'POST', body: JSON.stringify(corpo) });
    // Sucesso: mostra a tela de confirmação com o link de convite
    mostrarEmpresaCriada(corpo.razaoSocial, corpo.adminEmail, r.linkConvite);
    renderPainelSA();
  } catch (e) {
    // Erro detalhado e reabilita o botão para tentar de novo
    erro.textContent = e.message || 'Não foi possível criar a empresa. Tente novamente.';
    if (btn) { btn.disabled = false; btn.textContent = textoOriginal; }
    if (btnCancelar) btnCancelar.disabled = false;
  }
}

// Tela de confirmação após criar a empresa (substitui o conteúdo do modal)
function mostrarEmpresaCriada(razaoSocial, adminEmail, linkConvite) {
  const modal = document.querySelector('.modal-fundo');
  if (!modal) return;
  const caixa = modal.querySelector('.modal-caixa');
  const linkBloco = linkConvite ? `
    <div style="margin-top:16px">
      <p class="dica" style="margin-bottom:6px">Se o e-mail não chegar, envie este link ao administrador
        para ele definir a senha:</p>
      <div style="display:flex;gap:8px;align-items:stretch">
        <input type="text" id="link-convite-copia" readonly value="${esc(linkConvite)}"
          style="flex:1;font-size:.82rem" onclick="this.select()">
        <button class="btn-mini" onclick="copiarLinkConvite()">📋 Copiar</button>
      </div>
    </div>` : '';

  caixa.innerHTML = `
    <div style="text-align:center;padding:8px 0 4px">
      <div style="font-size:44px;line-height:1">✅</div>
      <h3 style="color:#146c43;margin-top:6px">Empresa criada com sucesso!</h3>
    </div>
    <p style="margin-top:8px"><b>${esc(razaoSocial)}</b> foi cadastrada.</p>
    <p class="dica">Um convite foi enviado para <b>${esc(adminEmail)}</b> definir a senha de acesso.</p>
    ${linkBloco}
    <div class="rodape-acoes" style="margin-top:18px">
      <button class="btn-primario" onclick="this.closest('.modal-fundo').remove()">Concluir</button>
    </div>`;
}

// Copia o link de convite para a área de transferência
function copiarLinkConvite() {
  const campo = $('#link-convite-copia');
  if (!campo) return;
  campo.select();
  navigator.clipboard.writeText(campo.value)
    .then(() => toast('Link copiado ✓', 'ok'))
    .catch(() => { document.execCommand('copy'); toast('Link copiado ✓', 'ok'); });
}
