
// ═══════ Limpeza de certificados (super-admin, destrutivo) ═══════
// Abre o modal de limpeza para a empresa aberta no painel SA
function abrirLimparCertsSA(id, nome) {
  const div = document.createElement('div');
  div.className = 'modal-fundo';
  div.setAttribute('onclick', 'if(event.target===this)this.remove()');
  div.innerHTML = `<div class="modal-caixa" style="max-width:480px">
    <h3 style="color:#b02a37">⚠️ Limpar certificados</h3>
    <p>Você vai apagar <b>TODOS os certificados</b> de <b>${esc(nome)}</b>
       (emitidos, rascunhos e aguardando aprovação).</p>
    <p class="dica">A empresa, clientes, balanças e pesos são mantidos.
       Antes de apagar, o sistema faz um <b>backup automático</b> (recuperável)
       identificado por empresa e data.</p>
    <p class="dica" style="color:#b02a37">Esta ação é destrutiva. Digite o PIN destrutivo para confirmar.</p>
    <label>PIN destrutivo
      <input type="password" id="lc-pin" autocomplete="off" placeholder="••••••" style="width:100%">
    </label>
    <p id="lc-erro" class="erro"></p>
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn-primario" style="background:#b02a37" onclick="confirmarLimparCerts('${id}')">Apagar certificados</button>
      <button onclick="this.closest('.modal-fundo').remove()">Cancelar</button>
    </div>
  </div>`;
  document.body.appendChild(div);
}

async function confirmarLimparCerts(id) {
  const pin = document.getElementById('lc-pin')?.value || '';
  const erro = document.getElementById('lc-erro');
  if (!pin) { if (erro) erro.textContent = 'Digite o PIN.'; return; }
  try {
    const r = await saApi('/empresas/' + id + '/limpar-certificados', {
      method: 'POST', body: JSON.stringify({ pin })
    });
    document.querySelector('.modal-fundo')?.remove();
    toast(`${r.quantidade} certificado(s) apagado(s). Backup: ${r.backup}`, 'ok', 6000);
    if (window._saEmpresaId) abrirEmpresaSA(window._saEmpresaId);
  } catch (e) {
    if (erro) erro.textContent = e.message;
  }
}

// ═══════ Configurar o PIN destrutivo ═══════
function abrirConfigPinSA() {
  const div = document.createElement('div');
  div.className = 'modal-fundo';
  div.setAttribute('onclick', 'if(event.target===this)this.remove()');
  div.innerHTML = `<div class="modal-caixa" style="max-width:460px">
    <h3>🔐 PIN destrutivo</h3>
    <p class="dica">O PIN protege operações destrutivas (como limpar certificados).
       Tem ao menos 6 caracteres. Guarde-o com segurança.</p>
    <label>PIN atual (se já existir)
      <input type="password" id="pin-atual" autocomplete="off" style="width:100%"></label>
    <label>Novo PIN
      <input type="password" id="pin-novo" autocomplete="off" style="width:100%"></label>
    <p id="pin-erro" class="erro"></p>
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn-primario" onclick="salvarPinSA()">Salvar PIN</button>
      <button onclick="this.closest('.modal-fundo').remove()">Cancelar</button>
    </div>
  </div>`;
  document.body.appendChild(div);
}

async function salvarPinSA() {
  const novoPin = document.getElementById('pin-novo')?.value || '';
  const pinAtual = document.getElementById('pin-atual')?.value || '';
  const erro = document.getElementById('pin-erro');
  if (novoPin.length < 6) { if (erro) erro.textContent = 'O PIN deve ter ao menos 6 caracteres.'; return; }
  try {
    await saApi('/pin-destrutivo', { method: 'POST', body: JSON.stringify({ novoPin, pinAtual }) });
    document.querySelector('.modal-fundo')?.remove();
    toast('PIN destrutivo salvo.', 'ok');
  } catch (e) { if (erro) erro.textContent = e.message; }
}
