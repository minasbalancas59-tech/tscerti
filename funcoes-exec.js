
// ═══════ "Ensaio executado por" (gestores) ═══════
// Permite ao responsável técnico registrar um ensaio feito em campo por
// outro técnico (quando não havia internet no local). Os dois nomes ficam
// no registro: o executor no certificado, quem lançou na auditoria.
async function carregarTecnicosExecutor() {
  const box = document.getElementById('exec-area');
  if (!box) return;
  if (!ehGestor()) { box.style.display = 'none'; return; }
  try {
    const us = await api('/usuarios');
    const ativos = (us || []).filter(u => u.ativo !== false);
    const sel = document.getElementById('sel-executor');
    if (!sel) return;
    sel.innerHTML = '<option value="">Eu mesmo (' + esc(usuario.nome) + ')</option>' +
      ativos.filter(u => u.id !== usuario.id)
            .map(u => `<option value="${u.id}">${esc(u.nome)}</option>`).join('');
    box.style.display = '';
  } catch (e) { box.style.display = 'none'; }
}

function avisoExecutor() {
  const sel = document.getElementById('sel-executor');
  const aviso = document.getElementById('exec-aviso');
  if (!sel || !aviso) return;
  if (sel.value) {
    const nome = sel.options[sel.selectedIndex].text;
    aviso.innerHTML = '⚠️ O certificado registrará <b>' + esc(nome) + '</b> como técnico executor, ' +
      'e <b>' + esc(usuario.nome) + '</b> como quem lançou no sistema. Use quando o ensaio foi feito ' +
      'em campo e você está apenas registrando os dados.';
    aviso.style.display = '';
  } else {
    aviso.style.display = 'none';
  }
}
