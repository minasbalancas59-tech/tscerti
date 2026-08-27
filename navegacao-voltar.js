
// ═══════════════════════════════════════════════════════════════
// Botão VOLTAR do Android / navegador em SPA (cert-saas)
//   1) Modal/formulário aberto  → fecha o modal
//   2) Tela interna             → volta para a tela anterior
//   3) Tela inicial             → pergunta se deseja sair
// Engancha na função mostrar() sem alterar as chamadas existentes.
// ═══════════════════════════════════════════════════════════════
(function () {
  if (window._navVoltarAtivo) return;
  window._navVoltarAtivo = true;

  // Telas "iniciais": nelas o Voltar pergunta se deseja sair.
  const TELAS_INICIAIS = ['tela-painel', 'tela-login', 'tela-sa', 'tela-convite'];

  function telaAtual() {
    const vis = document.querySelector('.tela:not(.oculta)');
    return vis ? vis.id : null;
  }

  // Fecha o modal/janela aberto (se houver). true = fechou algo.
  function fecharModalAberto() {
    const fundos = document.querySelectorAll('.modal-fundo');
    if (fundos.length) { fundos[fundos.length - 1].remove(); return true; }
    for (const id of ['modal-assinatura', 'modal-ajuda']) {
      const m = document.getElementById(id);
      if (m && !m.classList.contains('oculta')) { m.classList.add('oculta'); return true; }
    }
    return false;
  }

  // Pilha de navegação interna (nomes de tela)
  const pilha = [telaAtual() || 'tela-login'];

  // Envolve mostrar() para registrar cada troca de tela
  const mostrarOrig = window.mostrar;
  if (typeof mostrarOrig === 'function' && !window.mostrar._comHistorico) {
    const novo = function (tela) {
      const r = mostrarOrig.apply(this, arguments);
      if (pilha[pilha.length - 1] !== tela) pilha.push(tela);
      return r;
    };
    novo._comHistorico = true;
    window.mostrar = novo;
  }
  // Sempre há um estado "sentinela" no topo do histórico do browser,
  // que é o que capturamos quando o usuário aperta Voltar.
  function reporSentinela() {
    try { history.pushState({ spa: true }, ''); } catch (e) {}
  }
  reporSentinela();

  let ocupado = false;

  async function aoVoltar() {
    if (ocupado) { reporSentinela(); return; }

    // 1) Modal aberto → fecha e permanece
    if (fecharModalAberto()) { reporSentinela(); return; }

    const atual = telaAtual();

    // 2) Tela inicial → confirma saída
    if (!atual || TELAS_INICIAIS.includes(atual)) {
      ocupado = true;
      let sair = false;
      try {
        sair = window.modalConfirmar
          ? await modalConfirmar('Deseja sair do sistema?')
          : confirm('Deseja sair do sistema?');
      } finally { ocupado = false; }

      if (sair) {
        // Remove nosso interceptador e volta de verdade (sai do app/aba)
        window.removeEventListener('popstate', aoVoltar);
        history.back();
      } else {
        reporSentinela(); // fica no sistema
      }
      return;
    }

    // 3) Tela interna → volta para a anterior da pilha
    pilha.pop();
    const anterior = pilha[pilha.length - 1] || 'tela-painel';
    mostrarOrig(anterior);           // usa a original (não re-empilha)
    reporSentinela();
  }

  window.addEventListener('popstate', aoVoltar);
})();
