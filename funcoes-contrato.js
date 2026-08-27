// ── Editar / encerrar / excluir contrato (super-admin) ─────────
function formEditarContrato(id) {
  const c = (window._saContratos || []).find(x => x.id === id);
  if (!c) { toast('Contrato não encontrado. Recarregue a tela.', 'erro'); return; }
  const d10 = v => v ? String(v).substring(0, 10) : '';
  const pers = ['mensal', 'trimestral', 'semestral', 'anual', 'avulso'];
  const modal = `
    <div class="modal-fundo" onclick="if(event.target===this)this.remove()">
      <div class="modal-caixa" style="max-width:480px">
        <h3>Editar contrato</h3>
        <div class="form-grid">
          <label>Descrição * <input type="text" id="edc-desc" value="${esc(c.descricao)}"></label>
          <label>Valor (R$) * <input type="number" step="0.01" id="edc-valor" value="${c.valor}"></label>
          <label>Periodicidade
            <select id="edc-per">
              ${pers.map(p => `<option value="${p}" ${c.periodicidade === p ? 'selected' : ''}>${p.charAt(0).toUpperCase() + p.slice(1)}</option>`).join('')}
            </select></label>
          <label>Início * <input type="date" id="edc-inicio" value="${d10(c.inicio)}"></label>
          <label>Fim (opcional) <input type="date" id="edc-fim" value="${d10(c.fim)}"></label>
          <label>Dia do vencimento <input type="number" id="edc-dia-venc" min="1" max="28" value="${c.dia_vencimento || 10}"></label>
          <label class="chk" style="align-self:end">
            <input type="checkbox" id="edc-auto" ${c.gerar_automatico ? 'checked' : ''}> Gerar cobranças automaticamente</label>
        </div>
        <label>Observação <textarea id="edc-obs" rows="2">${esc(c.observacao || '')}</textarea></label>
        <div class="rodape-acoes" style="margin-top:10px">
          <button onclick="this.closest('.modal-fundo').remove()">Cancelar</button>
          <button class="btn-primario" onclick="salvarEdicaoContrato('${c.id}')">💾 Salvar</button>
        </div>
        <p id="edc-erro" class="erro"></p>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', modal);
}

async function salvarEdicaoContrato(id) {
  const erro = $('#edc-erro');
  erro.textContent = '';
  const corpo = {
    descricao: $('#edc-desc').value.trim(),
    valor: Number($('#edc-valor').value),
    periodicidade: $('#edc-per').value,
    inicio: $('#edc-inicio').value || null,
    fim: $('#edc-fim').value || null,
    observacao: $('#edc-obs').value.trim() || null,
    diaVencimento: Number($('#edc-dia-venc').value) || 10,
    gerarAutomatico: $('#edc-auto').checked
  };
  if (!corpo.descricao) { erro.textContent = 'Informe a descrição do contrato.'; $('#edc-desc').focus(); return; }
  if (!$('#edc-valor').value || isNaN(corpo.valor)) { erro.textContent = 'Informe o valor do contrato.'; $('#edc-valor').focus(); return; }
  if (corpo.valor <= 0) { erro.textContent = 'O valor deve ser maior que zero.'; $('#edc-valor').focus(); return; }
  if (!corpo.inicio) { erro.textContent = 'Informe a data de início do contrato.'; $('#edc-inicio').focus(); return; }
  if (corpo.fim && corpo.fim < corpo.inicio) { erro.textContent = 'A data de fim não pode ser anterior à data de início.'; $('#edc-fim').focus(); return; }
  if (corpo.diaVencimento < 1 || corpo.diaVencimento > 28) { erro.textContent = 'O dia do vencimento deve ser entre 1 e 28.'; $('#edc-dia-venc').focus(); return; }

  const btn = document.querySelector('.modal-fundo .btn-primario');
  const textoOriginal = btn ? btn.textContent : 'Salvar';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Salvando...'; }
  try {
    await saApi(`/empresas/${window._saEmpresaId}/contratos/${id}`,
      { method: 'PUT', body: JSON.stringify(corpo) });
    document.querySelector('.modal-fundo')?.remove();
    toast('Contrato atualizado ✓', 'ok');
    abrirEmpresaSA(window._saEmpresaId);
  } catch (e) {
    erro.textContent = e.message || 'Não foi possível salvar. Tente novamente.';
    if (btn) { btn.disabled = false; btn.textContent = textoOriginal; }
  }
}

async function ativarContratoSA(id, ativar) {
  const msg = ativar
    ? 'Reativar este contrato? Ele volta a gerar cobranças automáticas (se configurado).'
    : 'Encerrar este contrato? Ele deixa de gerar cobranças automáticas. Você poderá reativá-lo depois, se precisar.';
  if (!await modalConfirmar(msg)) return;
  try {
    await saApi(`/empresas/${window._saEmpresaId}/contratos/${id}/ativo`,
      { method: 'PUT', body: JSON.stringify({ ativo: ativar }) });
    toast(ativar ? 'Contrato reativado ✓' : 'Contrato encerrado.', 'ok');
    abrirEmpresaSA(window._saEmpresaId);
  } catch (e) { toast(e.message || 'Não foi possível alterar o contrato.', 'erro'); }
}

async function excluirContratoSA(id, desc) {
  if (!await modalConfirmar(`Excluir o contrato "${desc}"? Esta ação não pode ser desfeita. `
      + `Só é possível excluir contratos sem cobranças registradas.`)) return;
  try {
    await saApi(`/empresas/${window._saEmpresaId}/contratos/${id}`, { method: 'DELETE' });
    toast('Contrato excluído.', 'ok');
    abrirEmpresaSA(window._saEmpresaId);
  } catch (e) { toast(e.message || 'Não foi possível excluir o contrato.', 'erro'); }
}
