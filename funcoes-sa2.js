
// ═══════ Editar usuário (super-admin) ═══════
function abrirEditarUsuarioSA(id, nome, email, papel, registro) {
  const div = document.createElement('div');
  div.className = 'modal-fundo';
  div.setAttribute('onclick', 'if(event.target===this)this.remove()');
  const opt = (v, r) => `<option value="${v}" ${papel === v ? 'selected' : ''}>${r}</option>`;
  div.innerHTML = `<div class="modal-caixa" style="max-width:460px">
    <h3>✏️ Editar usuário</h3>
    <label>Nome <input type="text" id="eu-nome" value="${esc(nome || '')}" style="width:100%"></label>
    <label>E-mail <input type="email" id="eu-email" value="${esc(email || '')}" style="width:100%"></label>
    <label>Papel
      <select id="eu-papel" style="width:100%">
        ${opt('admin', 'Administrador')}
        ${opt('responsavel_tecnico', 'Responsável Técnico')}
        ${opt('tecnico', 'Técnico')}
      </select></label>
    <label>Registro profissional <input type="text" id="eu-registro" value="${esc(registro || '')}" style="width:100%"></label>
    <p class="dica">A senha não é alterada aqui — o usuário pode redefini-la pelo "Esqueci minha senha".</p>
    <p id="eu-erro" class="erro"></p>
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn-primario" onclick="salvarUsuarioSA('${id}')">Salvar</button>
      <button onclick="this.closest('.modal-fundo').remove()">Cancelar</button>
    </div>
  </div>`;
  document.body.appendChild(div);
}

async function salvarUsuarioSA(id) {
  const erro = document.getElementById('eu-erro');
  const corpo = {
    nome: document.getElementById('eu-nome')?.value || null,
    email: document.getElementById('eu-email')?.value || null,
    papel: document.getElementById('eu-papel')?.value || null,
    registro: document.getElementById('eu-registro')?.value || null
  };
  try {
    await saApi('/usuarios/' + id, { method: 'PUT', body: JSON.stringify(corpo) });
    document.querySelector('.modal-fundo')?.remove();
    toast('Usuário atualizado.', 'ok');
    if (window._saEmpresaId) abrirEmpresaSA(window._saEmpresaId);
  } catch (e) { if (erro) erro.textContent = e.message; }
}
