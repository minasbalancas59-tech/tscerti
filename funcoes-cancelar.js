
// ═══════ Cancelar certificado (emitido ou aguardando) ═══════
// O registro permanece; a validação pública informa o cancelamento.
function abrirCancelarCert(id, numero) {
  const div = document.createElement('div');
  div.className = 'modal-fundo';
  div.setAttribute('onclick', 'if(event.target===this)this.remove()');
  div.innerHTML = `<div class="modal-caixa" style="max-width:520px;border-top:6px solid #b02a37">
    <div style="text-align:center">
      <div style="font-size:42px;line-height:1">\u{1F6AB}</div>
      <h2 style="color:#b02a37;margin:4px 0">Cancelar certificado</h2>
      ${numero ? `<div style="font-size:15px;font-weight:700">${esc(numero)}</div>` : ''}
    </div>
    <div style="background:#fff5f5;border:2px solid #f5c2c7;border-radius:10px;padding:12px;margin:12px 0">
      <p style="margin:0;font-size:13px;color:#842029">
        O certificado <b>não será apagado</b>: ficará registrado como <b>CANCELADO</b>,
        com a data, o responsável e o motivo. Quem consultar o QR Code verá
        claramente que o documento foi cancelado.</p>
    </div>
    <label>Motivo do cancelamento (obrigatório)
      <textarea id="cc-motivo" rows="3" style="width:100%"
        placeholder="Ex.: erro nos dados do instrumento; calibração refeita a pedido do cliente..."></textarea></label>
    <p class="dica">Mínimo 10 caracteres. Este texto aparece na validação pública.</p>
    <p id="cc-erro" class="erro"></p>
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn-primario" style="background:#b02a37" onclick="confirmarCancelarCert('${id}')">
        Confirmar cancelamento</button>
      <button onclick="this.closest('.modal-fundo').remove()">Voltar</button>
    </div>
  </div>`;
  document.body.appendChild(div);
}

async function confirmarCancelarCert(id) {
  const motivo = document.getElementById('cc-motivo')?.value || '';
  const erro = document.getElementById('cc-erro');
  if (motivo.trim().length < 10) {
    if (erro) erro.textContent = 'Descreva o motivo com ao menos 10 caracteres.';
    return;
  }
  try {
    await api('/certificados/' + id + '/cancelar', {
      method: 'POST', body: JSON.stringify({ motivo })
    });
    document.querySelector('.modal-fundo')?.remove();
    toast('Certificado cancelado. O registro foi mantido para auditoria.', 'ok', 5000);
    irPainel();
  } catch (e) { if (erro) erro.textContent = e.message; }
}
