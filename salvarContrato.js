// ═══════════════════════════════════════════════════════════════
// SUBSTITUA a função salvarContrato inteira (começa na linha 3726)
// por esta versão. Trava o botão + erros detalhados campo a campo.
// ═══════════════════════════════════════════════════════════════
async function salvarContrato() {
  const erro = $('#nc-erro');
  erro.textContent = '';

  const corpo = {
    descricao: $('#nc-desc').value.trim(),
    valor: Number($('#nc-valor').value),
    periodicidade: $('#nc-per').value,
    inicio: $('#nc-inicio').value || null,
    fim: $('#nc-fim').value || null,
    observacao: $('#nc-obs').value.trim() || null,
    diaVencimento: Number($('#nc-dia-venc').value) || 10,
    gerarAutomatico: $('#nc-auto').checked
  };

  // Validação detalhada, campo a campo
  if (!corpo.descricao) { erro.textContent = 'Informe a descrição do contrato.'; $('#nc-desc').focus(); return; }
  if (!$('#nc-valor').value || isNaN(corpo.valor)) { erro.textContent = 'Informe o valor do contrato (ex.: 150,00).'; $('#nc-valor').focus(); return; }
  if (corpo.valor <= 0) { erro.textContent = 'O valor deve ser maior que zero.'; $('#nc-valor').focus(); return; }
  if (!corpo.inicio) { erro.textContent = 'Informe a data de início do contrato.'; $('#nc-inicio').focus(); return; }
  if (corpo.fim && corpo.fim < corpo.inicio) { erro.textContent = 'A data de fim não pode ser anterior à data de início.'; $('#nc-fim').focus(); return; }
  if (corpo.diaVencimento < 1 || corpo.diaVencimento > 31) { erro.textContent = 'O dia do vencimento deve ser entre 1 e 31.'; $('#nc-dia-venc').focus(); return; }

  // Anti-duplo-clique
  const btn = document.querySelector('.modal-fundo .btn-primario');
  const btnCancelar = document.querySelector('.modal-fundo .rodape-acoes button:first-child');
  const textoOriginal = btn ? btn.textContent : 'Criar';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Criando...'; }
  if (btnCancelar) btnCancelar.disabled = true;

  try {
    await saApi('/empresas/' + window._saEmpresaId + '/contratos',
      { method: 'POST', body: JSON.stringify(corpo) });
    document.querySelector('.modal-fundo')?.remove();
    toast('Contrato criado com sucesso ✓', 'ok');
    abrirEmpresaSA(window._saEmpresaId);
  } catch (e) {
    erro.textContent = e.message || 'Não foi possível criar o contrato. Tente novamente.';
    if (btn) { btn.disabled = false; btn.textContent = textoOriginal; }
    if (btnCancelar) btnCancelar.disabled = false;
  }
}
