// ═══════════════════════════════════════════════════════════════
// ADICIONE esta função nova ao app.js (pode colar logo depois da
// função reenviarConviteAdmin, por volta da linha 3647).
// ═══════════════════════════════════════════════════════════════
async function mostrarLinkConviteAdmin(id) {
  let r;
  try { r = await saApi('/empresas/' + id + '/link-convite'); }
  catch (e) { toast(e.message || 'Não foi possível obter o link.', 'erro'); return; }

  if (!r.temLink) {
    toast(`${r.nome || 'O administrador'} já ativou o acesso — não há convite pendente.`, 'info', 6000);
    return;
  }

  const modal = `
    <div class="modal-fundo" onclick="if(event.target===this)this.remove()">
      <div class="modal-caixa" style="max-width:520px">
        <h3>🔗 Link de convite do administrador</h3>
        <p class="dica">Envie este link para <b>${esc(r.nome)}</b> (${esc(r.email)})
          definir a senha e acessar o sistema. Válido enquanto o convite estiver pendente.</p>
        <div style="display:flex;gap:8px;align-items:stretch;margin-top:10px">
          <input type="text" id="link-adm-copia" readonly value="${esc(r.linkConvite)}"
            style="flex:1;font-size:.82rem" onclick="this.select()">
          <button class="btn-mini" onclick="copiarTexto('link-adm-copia')">📋 Copiar</button>
        </div>
        <div class="rodape-acoes" style="margin-top:16px">
          <button onclick="reenviarConviteAdmin('${id}');this.closest('.modal-fundo').remove()">✉️ Enviar por e-mail</button>
          <button class="btn-primario" onclick="this.closest('.modal-fundo').remove()">Fechar</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', modal);
}

// Copia o conteúdo de um input para a área de transferência (reutilizável)
function copiarTexto(idCampo) {
  const campo = document.getElementById(idCampo);
  if (!campo) return;
  campo.select();
  navigator.clipboard.writeText(campo.value)
    .then(() => toast('Link copiado ✓', 'ok'))
    .catch(() => { document.execCommand('copy'); toast('Link copiado ✓', 'ok'); });
}
