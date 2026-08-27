
// ═══════ Contatos do cliente ═══════
async function carregarContatos(clienteId) {
  const box = document.getElementById('contatos-lista');
  if (!box) return;
  try {
    const lista = await api('/clientes/' + clienteId + '/contatos');
    window._contatosCache = lista;
    box.innerHTML = lista.length === 0
      ? '<p class="dica">Nenhum contato cadastrado.</p>'
      : lista.map(c => `
        <div class="item-cert">
          <span><b>${esc(c.nome)}</b>${c.cargo ? ' <span class="dica">· ' + esc(c.cargo) + '</span>' : ''}
            <br><span class="dica">
              ${c.telefone ? '📞 ' + esc(c.telefone) : ''}
              ${c.telefone && c.email ? ' · ' : ''}
              ${c.email ? '✉️ ' + esc(c.email) : ''}
              ${!c.telefone && !c.email ? 'sem telefone/e-mail' : ''}
            </span>
            ${c.observacao ? '<br><span class="dica">' + esc(c.observacao) + '</span>' : ''}
          </span>
          ${ehGestor() ? `<span class="acoes">
            <button class="btn-mini" onclick="formContato('${clienteId}','${c.id}')">✏️</button>
            <button class="btn-mini" style="color:#b02a37" onclick="excluirContato('${clienteId}','${c.id}','${esc(c.nome).replace(/'/g, "\\'")}')">🗑</button>
          </span>` : ''}
        </div>`).join('');
  } catch (e) { box.innerHTML = '<p class="erro">' + esc(e.message) + '</p>'; }
}

function formContato(clienteId, contatoId) {
  const c = contatoId ? (window._contatosCache || []).find(x => x.id === contatoId) : null;
  const div = document.createElement('div');
  div.className = 'modal-fundo';
  div.setAttribute('onclick', 'if(event.target===this)this.remove()');
  div.innerHTML = `<div class="modal-caixa" style="max-width:460px">
    <h3>${c ? '✏️ Editar contato' : '+ Novo contato'}</h3>
    <label>Nome * <input type="text" id="ct-nome" value="${esc(c?.nome || '')}" style="width:100%"></label>
    <label>Cargo / função <input type="text" id="ct-cargo" value="${esc(c?.cargo || '')}" style="width:100%" placeholder="Ex.: Gerente da qualidade"></label>
    <label>Telefone <input type="text" id="ct-fone" value="${esc(c?.telefone || '')}" style="width:100%"></label>
    <label>E-mail <input type="email" id="ct-email" value="${esc(c?.email || '')}" style="width:100%"></label>
    <label>Observação <input type="text" id="ct-obs" value="${esc(c?.observacao || '')}" style="width:100%"></label>
    <p id="ct-erro" class="erro"></p>
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn-primario" onclick="salvarContato('${clienteId}', ${contatoId ? "'" + contatoId + "'" : 'null'})">Salvar</button>
      <button onclick="this.closest('.modal-fundo').remove()">Cancelar</button>
    </div>
  </div>`;
  document.body.appendChild(div);
}

async function salvarContato(clienteId, contatoId) {
  const erro = document.getElementById('ct-erro');
  const corpo = {
    nome: document.getElementById('ct-nome')?.value || '',
    cargo: document.getElementById('ct-cargo')?.value || null,
    telefone: document.getElementById('ct-fone')?.value || null,
    email: document.getElementById('ct-email')?.value || null,
    observacao: document.getElementById('ct-obs')?.value || null
  };
  if (!corpo.nome.trim()) { if (erro) erro.textContent = 'Informe o nome.'; return; }
  try {
    if (contatoId) await api('/clientes/contatos/' + contatoId, { method: 'PUT', body: JSON.stringify(corpo) });
    else await api('/clientes/' + clienteId + '/contatos', { method: 'POST', body: JSON.stringify(corpo) });
    document.querySelector('.modal-fundo')?.remove();
    toast('Contato salvo.', 'ok');
    carregarContatos(clienteId);
  } catch (e) { if (erro) erro.textContent = e.message; }
}

async function excluirContato(clienteId, contatoId, nome) {
  if (!confirm('Excluir o contato "' + nome + '"?')) return;
  try {
    await api('/clientes/contatos/' + contatoId, { method: 'DELETE' });
    toast('Contato excluído.', 'ok');
    carregarContatos(clienteId);
  } catch (e) { toast(e.message, 'erro'); }
}
