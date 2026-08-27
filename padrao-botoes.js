
// ═══════════════════════════════════════════════════════════════
// Padrão universal de botões de ação (anti-duplo-clique + estado)
// Envolve as funções de salvar: ao clicar, o botão trava e mostra
// "⏳ Aguarde..."; ao terminar (sucesso ou erro), volta ao normal.
// Se o modal fechar (sucesso), não há o que restaurar.
// ═══════════════════════════════════════════════════════════════
(function () {
  const FUNCOES = [
    'salvarCobranca', 'salvarEdicaoCobranca', 'salvarCliente', 'salvarBalanca',
    'salvarPeso', 'salvarTipo', 'salvarUsuario', 'salvarChamado', 'salvarEmpresaSA',
    'salvarEdicaoManual', 'salvarSmtp', 'salvarConfig', 'salvarConfigAvisos',
    'salvarConfigPesquisa', 'salvarAssinatura'
  ];
  for (const nome of FUNCOES) {
    const orig = window[nome];
    if (typeof orig !== 'function' || orig._comEstado) continue;
    const wrapper = async function (...args) {
      const btn = window.event && window.event.target
        ? window.event.target.closest('button') : null;
      if (btn) {
        if (btn.disabled) return;                 // já em andamento: ignora o 2º clique
        btn.disabled = true;
        btn.dataset.txtOriginal = btn.textContent;
        btn.textContent = '⏳ Aguarde...';
      }
      try {
        return await orig.apply(this, args);
      } finally {
        if (btn && document.body.contains(btn)) { // modal ainda aberto (erro/validação)
          btn.disabled = false;
          btn.textContent = btn.dataset.txtOriginal || 'Salvar';
        }
      }
    };
    wrapper._comEstado = true;
    window[nome] = wrapper;
  }
})();
