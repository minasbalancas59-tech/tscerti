// ════════════════════════════════════════════════════════════════
// SPA do técnico — etapa 3 + cadastros no navegador
// ════════════════════════════════════════════════════════════════
let token = localStorage.getItem('token');
let usuario = JSON.parse(localStorage.getItem('usuario') || 'null');
let plano = null, certId = null, sujo = false, timerAutosave = null;

const $ = s => document.querySelector(s);
const ehGestor = () => ['admin', 'responsavel_tecnico'].includes(usuario?.papel);

// ══ Componentes padronizados ═══════════════════════════════════
// Toast: notificação não bloqueante. tipo: ok | erro | aviso | info
function toast(msg, tipo = 'info', ms = 3800) {
  let box = $('#toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    document.body.appendChild(box);
  }
  const t = document.createElement('div');
  t.className = 'toast toast-' + tipo;
  const icone = { ok: '✅', erro: '⚠️', aviso: '⏳', info: 'ℹ️' }[tipo] || '';
  t.innerHTML = `<span>${icone}</span><span>${esc(msg)}</span>
    <button class="toast-x" onclick="this.parentElement.remove()">✕</button>`;
  box.appendChild(t);
  setTimeout(() => { t.classList.add('saindo');
    setTimeout(() => t.remove(), 300); }, ms);
}

// Modal de confirmação padronizado (substitui confirm()). Retorna Promise<bool>.
function modalConfirmar(titulo, mensagem, opcoes = {}) {
  return new Promise(resolve => {
    const { textoSim = 'Confirmar', textoNao = 'Cancelar', perigoso = false } = opcoes;
    const div = document.createElement('div');
    div.className = 'modal-fundo';
    div.innerHTML = `
      <div class="modal-caixa" style="max-width:420px">
        <h3>${esc(titulo)}</h3>
        <p style="white-space:pre-line">${esc(mensagem)}</p>
        <div class="rodape-acoes" style="margin-top:14px">
          <button data-r="nao">${esc(textoNao)}</button>
          <button class="${perigoso ? 'btn-perigo' : 'btn-primario'}" data-r="sim">${esc(textoSim)}</button>
        </div>
      </div>`;
    const fechar = (r) => { div.remove(); resolve(r); };
    div.onclick = e => { if (e.target === div) fechar(false); };
    div.querySelector('[data-r="nao"]').onclick = () => fechar(false);
    div.querySelector('[data-r="sim"]').onclick = () => fechar(true);
    document.body.appendChild(div);
    div.querySelector('[data-r="sim"]').focus();
  });
}

// Menu suspenso do usuário (cabeçalho)
function toggleMenuUsuario() {
  const m = $('#menu-lista-usuario');
  if (m) { m.remove(); return; }
  const host = $('#menu-usuario');
  const lista = document.createElement('div');
  lista.className = 'menu-lista';
  lista.id = 'menu-lista-usuario';
  lista.innerHTML = `
    <a href="#" onclick="fecharMenuUsuario();abrirAssinatura();return false">✍️ Minha assinatura</a>
    <hr>
    <a href="#" onclick="fecharMenuUsuario();sair();return false">🚪 Sair</a>`;
  host.appendChild(lista);
  setTimeout(() => document.addEventListener('click', fecharMenuUsuarioFora), 0);
}
function fecharMenuUsuario() {
  $('#menu-lista-usuario')?.remove();
  document.removeEventListener('click', fecharMenuUsuarioFora);
}
function fecharMenuUsuarioFora(e) {
  if (!e.target.closest('.menu-usuario')) fecharMenuUsuario();
}
const uuid = () => crypto.randomUUID();
const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => n == null ? '—' :
  Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
// Formata respeitando as casas decimais da balança do ensaio atual
function fmtU(n) {
  if (n == null) return '—';
  const casas = plano?.casasDecimais ?? 3;
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}
const unid = () => plano?.unidade || 'kg';

async function api(caminho, opcoes = {}) {
  const r = await fetch('/api' + caminho, {
    ...opcoes,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(opcoes.headers || {})
    }
  });
  if (r.status === 401 && caminho !== '/auth/login') {
    let motivo = 'Sessão expirada';
    try { const c = JSON.parse(await r.text()); if (c?.erro) motivo = c.erro; } catch (e) { /* sem corpo */ }
    sair(motivo);
    throw new Error(motivo);
  }
  const texto = await r.text();
  const corpo = texto ? JSON.parse(texto) : null;
  if (r.status === 403) throw new Error(corpo?.erro || 'Sem permissão para esta ação.');
  if (!r.ok) throw new Error(corpo?.erro || ('Erro ' + r.status));
  return corpo;
}

function mostrar(tela) {
  document.querySelectorAll('.tela').forEach(t => t.classList.add('oculta'));
  $('#' + tela).classList.remove('oculta');
  window.scrollTo(0, 0);
}

// ═══════ Logout por inatividade ═══════════════════════════════
// 30 min parado desloga; avisa 1 min antes com chance de continuar.
const INATIV_MS = 30 * 60 * 1000;      // tempo total até deslogar
const INATIV_AVISO_MS = 60 * 1000;     // aviso 1 min antes
let inativTimer = null, inativAvisoTimer = null;

function reiniciarInatividade() {
  if (!token) return;                  // só conta quando logado
  clearTimeout(inativTimer);
  clearTimeout(inativAvisoTimer);
  document.getElementById('aviso-inatividade')?.remove();
  inativAvisoTimer = setTimeout(mostrarAvisoInatividade, INATIV_MS - INATIV_AVISO_MS);
  inativTimer = setTimeout(() => sair('Você foi desconectado por inatividade.'), INATIV_MS);
}

function mostrarAvisoInatividade() {
  if (document.getElementById('aviso-inatividade')) return;
  const div = document.createElement('div');
  div.id = 'aviso-inatividade';
  div.className = 'modal-fundo';
  div.innerHTML = `
    <div class="modal-caixa" style="max-width:400px;text-align:center">
      <h3>Ainda está aí?</h3>
      <p>Sua sessão será encerrada em <b id="inativ-contador">60</b> segundos por inatividade.</p>
      <button class="btn-primario" onclick="reiniciarInatividade()">Continuar conectado</button>
    </div>`;
  document.body.appendChild(div);
  let seg = 60;
  const cont = div.querySelector('#inativ-contador');
  const iv = setInterval(() => {
    seg--;
    if (cont) cont.textContent = seg;
    if (seg <= 0 || !document.getElementById('aviso-inatividade')) clearInterval(iv);
  }, 1000);
}

function pararInatividade() {
  clearTimeout(inativTimer);
  clearTimeout(inativAvisoTimer);
  document.getElementById('aviso-inatividade')?.remove();
}

// Detecta atividade real do usuário e reinicia o contador (com throttle)
let inativUltimo = 0;
['mousedown', 'keydown', 'touchstart', 'scroll', 'click'].forEach(ev =>
  document.addEventListener(ev, () => {
    const agora = Date.now();
    if (agora - inativUltimo > 2000) {   // no máx. 1x a cada 2s
      inativUltimo = agora;
      reiniciarInatividade();
    }
  }, { passive: true }));

// ── Login / sessão ──────────────────────────────────────────────
async function fazerLogin() {
  $('#login-erro').textContent = '';
  try {
    const r = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: $('#login-email').value, senha: $('#login-senha').value })
    });
    if (!r) throw new Error('Email ou senha incorretos.');
    token = r.token; usuario = r.usuario;
    localStorage.setItem('token', token);
    localStorage.setItem('usuario', JSON.stringify(usuario));
    irPainel();
  } catch (e) {
    $('#login-erro').textContent =
      e.message === 'Erro 401' ? 'Email ou senha incorretos.' : e.message;
  }
}

// ── Minha assinatura (canvas de desenho + upload) ───────────────
let assinCtx = null, assinDesenhando = false, assinVazia = true;

async function abrirAssinatura() {
  $('#modal-assinatura').classList.remove('oculta');
  $('#assin-msg').textContent = '';
  const cv = $('#assin-canvas');
  assinCtx = cv.getContext('2d');
  assinCtx.lineWidth = 2.5;
  assinCtx.lineCap = 'round';
  assinCtx.strokeStyle = '#12233a';
  limparAssinatura();
  configurarCanvasAssinatura(cv);
  // Mostra a assinatura atual, se já houver
  try {
    const r = await fetch('/api/usuarios/eu/assinatura', {
      headers: { Authorization: 'Bearer ' + token } });
    if (r.ok) {
      const blob = await r.blob();
      $('#assin-preview-atual').innerHTML =
        `<p class="dica">Assinatura atual:</p><img src="${URL.createObjectURL(blob)}" class="logo-preview">`;
    } else {
      $('#assin-preview-atual').innerHTML = '';
    }
  } catch (e) { $('#assin-preview-atual').innerHTML = ''; }
}

function configurarCanvasAssinatura(cv) {
  const pos = (e) => {
    const r = cv.getBoundingClientRect();
    const escalaX = cv.width / r.width, escalaY = cv.height / r.height;
    const t = e.touches ? e.touches[0] : e;
    return { x: (t.clientX - r.left) * escalaX, y: (t.clientY - r.top) * escalaY };
  };
  const inicio = (e) => { e.preventDefault(); assinDesenhando = true; const p = pos(e);
    assinCtx.beginPath(); assinCtx.moveTo(p.x, p.y); };
  const move = (e) => { if (!assinDesenhando) return; e.preventDefault();
    const p = pos(e); assinCtx.lineTo(p.x, p.y); assinCtx.stroke(); assinVazia = false; };
  const fim = () => { assinDesenhando = false; };
  cv.onmousedown = inicio; cv.onmousemove = move; cv.onmouseup = fim; cv.onmouseleave = fim;
  cv.ontouchstart = inicio; cv.ontouchmove = move; cv.ontouchend = fim;
}

function limparAssinatura() {
  if (!assinCtx) return;
  const cv = $('#assin-canvas');
  assinCtx.clearRect(0, 0, cv.width, cv.height);
  assinVazia = true;
}

function assinaturaDeArquivo(input) {
  if (!input.files || !input.files[0]) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const cv = $('#assin-canvas');
      limparAssinatura();
      // desenha a imagem cabendo no canvas mantendo proporção
      const escala = Math.min(cv.width / img.width, cv.height / img.height);
      const w = img.width * escala, h = img.height * escala;
      assinCtx.drawImage(img, (cv.width - w) / 2, (cv.height - h) / 2, w, h);
      assinVazia = false;
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(input.files[0]);
}

async function salvarAssinatura() {
  if (assinVazia) {
    $('#assin-msg').textContent = 'Desenhe ou envie uma assinatura primeiro.';
    $('#assin-msg').style.color = '#b02a37'; return;
  }
  const dataUrl = $('#assin-canvas').toDataURL('image/png');
  try {
    await api('/usuarios/eu/assinatura', {
      method: 'PUT', body: JSON.stringify({ imagemBase64: dataUrl }) });
    $('#assin-msg').textContent = '✅ Assinatura salva.';
    $('#assin-msg').style.color = '#146c43';
    setTimeout(fecharAssinatura, 900);
  } catch (e) {
    $('#assin-msg').textContent = e.message;
    $('#assin-msg').style.color = '#b02a37';
  }
}

function fecharAssinatura() {
  $('#modal-assinatura').classList.add('oculta');
}

function sair(motivo) {
  pararInatividade();
  localStorage.clear(); token = null; usuario = null;
  mostrar('tela-login');
  const el = $('#login-erro');
  if (el) el.textContent = (motivo && motivo !== 'Sessão expirada')
    ? motivo : '';
}

function toggleSenha() {
  const i = $('#login-senha');
  i.type = i.type === 'password' ? 'text' : 'password';
}

// ── Painel ──────────────────────────────────────────────────────
let certsPainelCache = [];
let graficosDias = 30;
let filtroStatusGestor = '';

async function irPainel() {
  reiniciarInatividade();   // inicia o monitor de inatividade ao entrar
  if (usuario.papel === 'super_admin') { irSuperAdmin(); return; }
  $('#hd-empresa').textContent = usuario.empresa;
  $('#hd-usuario').textContent = usuario.nome;
  mostrar('tela-painel');
  const gestor = ehGestor();
  $('#painel-graficos').style.display = gestor ? '' : 'none';
  $('#btn-relatorios').style.display = gestor ? '' : 'none';
  $('#busca-equip').style.display = gestor ? '' : 'none';
  $('#filtro-cliente-tec').style.display = gestor ? 'none' : '';
  if (gestor) { renderGraficos(graficosDias); avisoContrato(); }
  const certs = await api('/certificados');
  certsPainelCache = certs;
  if (gestor) renderVencimentos();
  $('#lista-certs').innerHTML = gestor
    ? htmlListaGestor(certs)
    : htmlPainelTecnico(certs, $('#filtro-cliente-tec').value || '');
}

// Banner de aviso sobre a vigência do contrato (admin/RT)
async function avisoContrato() {
  let avisos = [];
  try { avisos = await api('/empresa/contrato-vigencia'); } catch (e) { /* silencioso */ }
  document.getElementById('aviso-contrato')?.remove();
  if (!avisos || avisos.length === 0) return;
  const a = avisos[0];
  let cor = '#fff3cd', corTxt = '#856404', msg = '';
  if (a.situacao === 'vencendo')
    msg = `📄 Seu contrato vence em <b>${a.dias_para_vencer} dia(s)</b> (${dbrSA(a.fim_vigencia)}). Entre em contato para renovar.`;
  else if (a.situacao === 'vencido') {
    const restam = Math.max(0, (a.dias_carencia ?? 0) - (a.dias_vencido ?? 0));
    cor = '#f8d7da'; corTxt = '#721c24';
    msg = `⚠️ Seu contrato venceu há <b>${a.dias_vencido} dia(s)</b>. `
        + (restam > 0
          ? `O acesso será suspenso em <b>${restam} dia(s)</b> se não for renovado.`
          : `O acesso pode ser suspenso a qualquer momento.`);
  } else if (a.situacao === 'suspensa_contrato') {
    cor = '#f8d7da'; corTxt = '#721c24';
    msg = `⛔ Acesso suspenso por contrato vencido. Entre em contato para regularizar.`;
  }
  if (!msg) return;
  $('#tela-painel').insertAdjacentHTML('afterbegin',
    `<div id="aviso-contrato" style="background:${cor};color:${corTxt};padding:10px 14px;
      border-radius:8px;margin-bottom:12px;font-size:14px">${msg}</div>`);
}

async function renderVencimentos() {
  let vs;
  try { vs = await api('/certificados/vencimentos'); }
  catch (e) { $('#painel-vencimentos').innerHTML = ''; return; }
  const alvo = $('#painel-vencimentos');
  if (!alvo) return;
  if (!vs || vs.length === 0) { alvo.innerHTML = ''; return; }
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);

  // Agrupar por cliente (vs já vem ordenado do vencimento mais urgente,
  // então os grupos ficam na ordem de urgência)
  const grupos = []; const idx = {};
  vs.forEach(v => {
    if (!(v.cliente in idx)) {
      idx[v.cliente] = grupos.length;
      grupos.push({ cliente: v.cliente, telefone: v.telefone, email: v.email, itens: [] });
    }
    grupos[idx[v.cliente]].itens.push(v);
  });

  const linhaBalanca = (v) => {
    const venc = new Date(String(v.vence_em).substring(0, 10) + 'T00:00:00');
    const dias = Math.round((venc - hoje) / 86400000);
    const rotulo = dias < 0
      ? `<span class="venc-vencido">vencida há ${-dias} dia${-dias === 1 ? '' : 's'}</span>`
      : dias === 0 ? '<span class="venc-vencido">vence hoje</span>'
      : `<span class="venc-prazo">vence em ${dias} dia${dias === 1 ? '' : 's'}</span>`;
    return `
      <div class="venc-linha">
        <span>⚖️ ${esc(v.balanca)} <span class="dica">· ${v.numero}</span></span>
        <span class="venc-data">${rotulo}<br>
          <span class="dica">${venc.toLocaleDateString('pt-BR')}</span></span>
      </div>`;
  };

  alvo.innerHTML = `
    <div class="card venc-card">
      <h3>⚠️ Calibrações vencendo (próximos 60 dias)</h3>
      <p class="dica">Balanças cuja última calibração está vencendo — bom momento para contatar o cliente.</p>
      ${grupos.map(g => `
        <div class="venc-grupo">
          <div class="venc-cliente"><b>${esc(g.cliente)}</b>
            <span class="dica">(${g.itens.length} balança${g.itens.length === 1 ? '' : 's'})</span>
            ${g.telefone ? `<span class="dica"> · 📞 ${esc(g.telefone)}</span>` : ''}
            ${g.email ? `<span class="dica"> · ✉️ ${esc(g.email)}</span>` : ''}
          </div>
          ${g.itens.map(linhaBalanca).join('')}
        </div>`).join('')}
    </div>`;
}

function filtrarStatusGestor(st) {
  filtroStatusGestor = (filtroStatusGestor === st) ? '' : st;
  $('#lista-certs').innerHTML = htmlListaGestor(certsPainelCache);
}

function htmlListaGestor(certs) {
  const st = filtroStatusGestor;
  const filtrados = st ? certs.filter(c => c.status === st) : certs;
  const btn = (v, rot) => `<button class="btn-mini ${st === v ? 'periodo-ativo' : ''}"
      onclick="filtrarStatusGestor('${v}')">${rot}</button>`;
  const filtros = `<div class="barra-btns" style="margin-bottom:10px;flex-wrap:wrap">
      ${btn('rascunho', 'Rascunhos')} ${btn('aguardando_aprovacao', '⏳ Pendentes de aprovação')}
      ${btn('emitido', 'Emitidos')} ${btn('substituido', 'Substituídos')}
    </div>`;
  if (filtrados.length === 0)
    return filtros + '<p class="dica">Nenhuma calibração ' +
      (st ? 'neste status.' : 'ainda. Clique em "+ Nova calibração".') + '</p>';
  return filtros + filtrados.map(c => `
      <div class="item-cert" onclick="abrirCert('${c.id}','${c.status}')">
        <span><b>${esc(c.cliente)}</b> · ${esc(c.balanca)}
          <br><span class="dica">Téc.: ${esc(c.tecnico)}${c.numero ? ' · ' + c.numero : ''}</span></span>
        <span><span class="st st-${c.status}">${rotuloStatus(c.status)}</span></span>
      </div>`).join('');
}

// ── Painel do técnico: agrupado por cliente, rascunhos em destaque ──
function htmlPainelTecnico(certs, filtro) {
  if (certs.length === 0)
    return '<p class="dica">Nenhuma calibração ainda. Clique em "+ Nova calibração".</p>';
  const t = (filtro || '').toLowerCase().trim();

  // Trabalho em andamento (rascunho / aguardando) sempre no topo
  const andamento = certs.filter(c =>
    (c.status === 'rascunho' || c.status === 'aguardando_aprovacao') &&
    (!t || (c.cliente || '').toLowerCase().includes(t)));

  // Agrupar por cliente na ordem em que aparecem (já vêm do mais recente)
  const grupos = []; const idx = {};
  certs.forEach(c => {
    if (t && !(c.cliente || '').toLowerCase().includes(t)) return;
    if (!(c.cliente in idx)) { idx[c.cliente] = grupos.length; grupos.push({ cliente: c.cliente, certs: [] }); }
    grupos[idx[c.cliente]].certs.push(c);
  });

  const itemCert = (c) => `
    <div class="item-cert" onclick="abrirCert('${c.id}','${c.status}')">
      <span>${esc(c.balanca)}${c.numero ? ' · ' + c.numero : ''}</span>
      <span><span class="st st-${c.status}">${rotuloStatus(c.status)}</span></span>
    </div>`;

  let html = '';
  if (andamento.length > 0)
    html += `<h4 class="grupo-titulo">⏳ Em andamento (${andamento.length})</h4>` +
      andamento.map(c => `
        <div class="item-cert destaque-rascunho" onclick="abrirCert('${c.id}','${c.status}')">
          <span><b>${esc(c.cliente)}</b> · ${esc(c.balanca)}</span>
          <span><span class="st st-${c.status}">${rotuloStatus(c.status)}</span></span>
        </div>`).join('');

  if (grupos.length === 0 && andamento.length === 0)
    return '<p class="dica">Nenhum cliente corresponde à busca.</p>';

  html += grupos.map(g => `
    <h4 class="grupo-titulo">${esc(g.cliente)} <span class="dica">(${g.certs.length})</span></h4>
    ${g.certs.map(itemCert).join('')}`).join('');
  return html;
}

function filtrarPainelTecnico() {
  $('#lista-certs').innerHTML =
    htmlPainelTecnico(certsPainelCache, $('#filtro-cliente-tec').value || '');
}

// ── Gráficos de gestão (HTML/CSS puro, sem dependências) ────────
async function renderGraficos(dias) {
  graficosDias = dias;
  let e;
  try { e = await api('/certificados/estatisticas?dias=' + dias); }
  catch (err) { $('#painel-graficos').innerHTML = ''; return; }

  const st = {}; (e.porStatus || []).forEach(x => st[x.status] = x.total);
  const btnPeriodo = (n, rotulo) =>
    `<button class="btn-mini ${graficosDias === n ? 'periodo-ativo' : ''}"
       onclick="renderGraficos(${n})">${rotulo}</button>`;

  const barras = (dados, campoRotulo) => {
    if (!dados || dados.length === 0) return '<p class="dica">Sem dados no período.</p>';
    const max = Math.max(...dados.map(x => x.total));
    return dados.map(x => `
      <div class="graf-linha">
        <span class="graf-rotulo" title="${esc(x[campoRotulo])}">${esc(x[campoRotulo])}</span>
        <div class="graf-trilha"><div class="graf-preench"
          style="width:${max ? Math.round(x.total / max * 100) : 0}%"></div></div>
        <span class="graf-valor">${x.total}</span>
      </div>`).join('');
  };

  $('#painel-graficos').innerHTML = `
    <div class="card">
      <div class="barra">
        <h3>Visão geral</h3>
        <div class="barra-btns">
          ${btnPeriodo(7, '7 dias')} ${btnPeriodo(30, '30 dias')}
          ${btnPeriodo(90, '90 dias')} ${btnPeriodo(365, '1 ano')} ${btnPeriodo(0, 'Tudo')}
        </div>
      </div>
      <div class="cards-kpi">
        <div class="kpi kpi-click" onclick="filtrarStatusGestor('rascunho')"><span class="kpi-num">${st.rascunho || 0}</span><span class="kpi-rotulo">Rascunhos</span></div>
        <div class="kpi kpi-click" onclick="filtrarStatusGestor('aguardando_aprovacao')"><span class="kpi-num kpi-atencao">${st.aguardando_aprovacao || 0}</span><span class="kpi-rotulo">Aguardando aprovação</span></div>
        <div class="kpi kpi-click" onclick="filtrarStatusGestor('emitido')"><span class="kpi-num kpi-ok">${st.emitido || 0}</span><span class="kpi-rotulo">Emitidos</span></div>
        <div class="kpi kpi-click" onclick="filtrarStatusGestor('substituido')"><span class="kpi-num">${st.substituido || 0}</span><span class="kpi-rotulo">Substituídos</span></div>
      </div>
      <div class="graf-grid">
        <div>
          <h4>Produção por técnico</h4>
          ${barras(e.porTecnico, 'tecnico')}
        </div>
        <div>
          <h4>Calibrações por cliente</h4>
          ${barras(e.porCliente, 'cliente')}
        </div>
      </div>
      <h4 style="margin-top:14px">Certificados emitidos por mês (últimos 12 meses)</h4>
      ${barras(e.porMes, 'mes')}
    </div>`;
}

const rotuloStatus = s => ({ rascunho: 'Rascunho',
  aguardando_aprovacao: 'Aguardando aprovação', emitido: 'Emitido',
  cancelado: 'Cancelado' })[s] || s;

let timerBuscaEquip = null;
function buscarPorEquipamento() {
  clearTimeout(timerBuscaEquip);
  const termo = $('#busca-equip').value.trim();
  timerBuscaEquip = setTimeout(async () => {
    if (termo.length < 2) { irPainel(); return; }
    try {
      const rows = await api('/certificados/buscar?q=' + encodeURIComponent(termo));
      $('#lista-certs').innerHTML = rows.length === 0
        ? '<p class="dica">Nenhum certificado encontrado para este equipamento.</p>'
        : rows.map(c => `
          <div class="item-cert ${c.status === 'emitido' ? 'clicavel' : ''}"
               onclick="abrirCert('${c.id}','${c.status}')">
            <span><b>${esc(c.balanca)}</b>${c.num_serie ? ' · Série ' + esc(c.num_serie) : ''}
              · ${esc(c.cliente)}<br>
              <span class="dica">${c.numero || '(sem número)'}
                ${c.data_emissao ? ' · ' + new Date(c.data_emissao).toLocaleDateString('pt-BR') : ''}
                · Téc.: ${esc(c.tecnico)}</span></span>
            <span><span class="st st-${c.status}">${rotuloStatus(c.status)}</span></span>
          </div>`).join('');
    } catch (e) {
      $('#lista-certs').innerHTML = '<p class="erro">' + e.message + '</p>';
    }
  }, 350);
}

async function abrirCert(id, status) {
  if (status === 'rascunho') {
    certId = id;
    const ct = await api('/certificados/' + id);
    plano = await api('/balancas/' + ct.balanca_id + '/plano-ensaio');
    montarTelaEnsaio(ct.dados_rascunho ? JSON.parse(ct.dados_rascunho) : null);
  } else if (status === 'aguardando_aprovacao') {
    abrirRevisao(id);
  } else if (status === 'emitido') {
    menuEmitido(id);
  }
}

// Menu de ações para um certificado emitido
// ══ Etiqueta de calibração (impressão nativa do celular) ═══════
// 3 tamanhos configuráveis. Nas menores (33x22, 50x30) a etiqueta é
// centrada no QR de validação; na maior (40x60) todos os dados escritos.
async function imprimirEtiqueta(id) {
  let d;
  try { d = await api('/certificados/' + id + '/etiqueta'); }
  catch (e) { toast('Não foi possível gerar a etiqueta: ' + e.message, 'erro'); return; }
  window._etiquetaDados = d;
  const padrao = d.etiqueta_tamanho || '40x60';
  const opcoes = [
    { v: '40x60', t: '40×60 mm', s: 'completa, todos os dados' },
    { v: '50x30', t: '50×30 mm', s: 'média, QR + dados principais' },
    { v: '33x22', t: '33×22 mm', s: 'pequena, QR + vencimento' },
    { v: '25x15', t: '25×15 mm', s: 'mínima, só texto (sem QR)' }
  ];
  const botoes = opcoes.map(o => `
    <button class="et-opt ${o.v === padrao ? 'et-padrao' : ''}"
      onclick="gerarEtiqueta('${o.v}')">
      <b>${o.t}</b><span>${o.s}${o.v === padrao ? ' · padrão' : ''}</span>
    </button>`).join('');
  const modal = `
    <div class="modal-fundo" onclick="if(event.target===this)this.remove()">
      <div class="modal-caixa">
        <h3>🏷️ Imprimir etiqueta</h3>
        <p class="dica">Escolha o tamanho da etiqueta para esta impressão:</p>
        <div class="et-opts">${botoes}</div>
        <div class="rodape-acoes" style="margin-top:12px">
          <button onclick="this.closest('.modal-fundo').remove()">Cancelar</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', modal);
}

function gerarEtiqueta(tam) {
  document.querySelector('.modal-fundo')?.remove();
  const d = window._etiquetaDados;
  if (!d) { toast('Dados da etiqueta não disponíveis. Tente novamente.', 'erro'); return; }

  const dbr = v => v ? new Date(String(v).substring(0, 10) + 'T00:00:00').toLocaleDateString('pt-BR') : '—';
  const calib = dbr(d.data_calibracao);
  let venc = '—';
  if (d.data_calibracao && d.periodicidade_meses > 0) {
    const dt = new Date(String(d.data_calibracao).substring(0, 10) + 'T00:00:00');
    dt.setMonth(dt.getMonth() + d.periodicidade_meses);
    venc = dt.toLocaleDateString('pt-BR');
  }
  const qr = '/api/validar/' + d.uuid_validacao + '/qr';
  const e = esc;

  // Layouts por tamanho (dimensões em mm; @page casa com a etiqueta física)
  const layouts = {
    '25x15': { w: 25, h: 15, html: `
      <div class="et" style="width:25mm;height:15mm">
        <div class="cabe-p">${e(d.empresa)}</div>
        <div class="dados-p">
          <div><b>Equip:</b> ${e(d.balanca)}${d.num_serie ? ' · ' + e(d.num_serie) : ''}</div>
          <div><b>Calib:</b> ${calib}</div>
          <div><b>Vence:</b> ${venc}</div>
          <div class="cert-p">Cert. ${e(d.numero)}</div>
        </div>
      </div>` },
    '33x22': { w: 33, h: 22, html: `
      <div class="et" style="width:33mm;height:22mm">
        <div class="cabe">${e(d.empresa)}</div>
        <div class="linha-qr">
          <img src="${qr}" class="qr" style="width:11mm;height:11mm">
          <div class="dados-mini">
            <div class="lbl">Calibração</div><div class="val">${calib}</div>
            <div class="lbl">Vence</div><div class="val">${venc}</div>
          </div>
        </div>
        <div class="rodape-mini">${e(d.balanca)}${d.num_serie ? ' · ' + e(d.num_serie) : ''}</div>
      </div>` },
    '50x30': { w: 50, h: 30, html: `
      <div class="et" style="width:50mm;height:30mm">
        <div class="cabe">${e(d.empresa)}</div>
        <div class="linha-qr">
          <img src="${qr}" class="qr" style="width:18mm;height:18mm">
          <div class="dados">
            <div><b>Equip.:</b> ${e(d.balanca)}</div>
            ${d.num_serie ? `<div><b>Série:</b> ${e(d.num_serie)}</div>` : ''}
            <div><b>Calibração:</b> ${calib}</div>
            <div><b>Vencimento:</b> ${venc}</div>
          </div>
        </div>
        <div class="rodape">Cert. ${e(d.numero)} · escaneie para validar</div>
      </div>` },
    '40x60': { w: 60, h: 40, html: `
      <div class="et" style="width:60mm;height:40mm">
        <div class="cabe-g">${e(d.empresa)}</div>
        ${d.num_autorizacao ? `<div class="autoriz">Autorização Inmetro ${e(d.num_autorizacao)}</div>` : ''}
        <div class="titulo">CERTIFICADO DE CALIBRAÇÃO</div>
        <div class="corpo">
          <div class="dados-g">
            <div><b>Equipamento:</b> ${e(d.balanca)}</div>
            ${d.num_serie ? `<div><b>Nº de série:</b> ${e(d.num_serie)}</div>` : ''}
            <div><b>Certificado:</b> ${e(d.numero)}</div>
            <div><b>Data calibração:</b> ${calib}</div>
            <div class="venc-g"><b>Próxima calibração:</b> ${venc}</div>
          </div>
          <img src="${qr}" class="qr" style="width:16mm;height:16mm">
        </div>
      </div>` }
  };
  const L = layouts[tam] || layouts['40x60'];

  const w = window.open('', '_blank');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Etiqueta ${e(d.numero)}</title>
    <style>
      * { margin:0; padding:0; box-sizing:border-box; }
      body { font-family: Arial, Helvetica, sans-serif; }
      .et { padding:1mm; color:#000; overflow:hidden; }
      /* 25x15 sem QR */
      .cabe-p { font-size:5.5pt; font-weight:bold; text-align:center;
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
        border-bottom:0.25mm solid #000; padding-bottom:0.3mm; margin-bottom:0.5mm; }
      .dados-p { font-size:5pt; line-height:1.35; }
      .dados-p b { font-weight:bold; }
      .cert-p { font-size:4.5pt; color:#333; margin-top:0.3mm; }
      /* 33x22 com QR */
      .cabe { font-size:6pt; font-weight:bold; text-align:center;
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
        border-bottom:0.3mm solid #000; padding-bottom:0.5mm; }
      .linha-qr { display:flex; gap:1mm; align-items:center; margin-top:1mm; }
      .dados-mini { font-size:5.5pt; line-height:1.3; flex:1; min-width:0; }
      .dados-mini .lbl { font-weight:bold; }
      .dados-mini .val { margin-bottom:0.6mm; white-space:nowrap; }
      .rodape-mini { font-size:5pt; text-align:center; margin-top:0.6mm; color:#333;
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      /* 50x30 e 40x60 */
      .cabe-g { font-size:10pt; font-weight:bold; text-align:center; }
      .autoriz { font-size:6pt; text-align:center; color:#333; }
      .titulo { font-size:7pt; font-weight:bold; text-align:center; background:#000; color:#fff; padding:0.6mm 0; margin:1mm 0; }
      .dados { font-size:6pt; line-height:1.5; }
      .dados-g { font-size:7pt; line-height:1.55; flex:1; }
      .venc-g { margin-top:0.5mm; font-weight:bold; }
      .corpo { display:flex; gap:2mm; align-items:center; }
      .rodape { font-size:5pt; text-align:center; margin-top:0.8mm; color:#333; }
      .qr { display:block; }
      @page { size: ${L.w}mm ${L.h}mm; margin: 0; }
      @media print { body { width:${L.w}mm; } }
    </style></head><body>${L.html}
    <script>
      window.onload = function(){
        var img = document.querySelector('.qr');
        if (img && !img.complete) { img.onload = function(){ window.print(); }; }
        else { window.print(); }
      };
    <\/script></body></html>`);
  w.document.close();
}

async function menuEmitido(id) {
  const podeRevisar = ['admin', 'responsavel_tecnico'].includes(usuario.papel);
  const acoes = `
    <div class="modal-fundo" onclick="if(event.target===this)this.remove()">
      <div class="modal-caixa">
        <h3>Certificado emitido</h3>
        <p class="dica">Este documento é imutável. Para corrigir um erro,
        emita uma revisão (o original fica registrado como substituído).</p>
        <div class="rodape-acoes" style="flex-direction:column;gap:8px;margin-top:12px">
          <button class="btn-primario" onclick="this.closest('.modal-fundo').remove();abrirPdfCertificado('${id}')">📄 Ver PDF</button>
          <button onclick="this.closest('.modal-fundo').remove();baixarPdfCertificado('${id}')">⬇️ Baixar PDF (nº + cliente)</button>
          <button onclick="this.closest('.modal-fundo').remove();imprimirEtiqueta('${id}')">🏷️ Imprimir etiqueta</button>
          <button onclick="this.closest('.modal-fundo').remove();baixarCertsPesos('${id}')">⚖️ Certificados dos pesos padrão</button>
          ${podeRevisar
            ? `<button class="btn-vinho-full" onclick="this.closest('.modal-fundo').remove();emitirRevisao('${id}')">✎ Emitir revisão</button>`
            : ''}
          <button onclick="this.closest('.modal-fundo').remove()">Fechar</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', acoes);
}

async function emitirRevisao(id) {
  const motivo = prompt('Motivo da revisão (ficará registrado no histórico):');
  if (!motivo) return;
  try {
    const r = await api('/certificados/' + id + '/revisar', {
      method: 'POST', body: JSON.stringify({ observacao: motivo }) });
    alert(`Revisão criada a partir do certificado ${r.original}.\n\n` +
      'Abra o rascunho, corrija o que for necessário e envie para aprovação. ' +
      'Ao emitir, o original será marcado como substituído.');
    certId = r.id;
    const ct = await api('/certificados/' + r.id);
    plano = await api('/balancas/' + ct.balanca_id + '/plano-ensaio');
    montarTelaEnsaio(ct.dados_rascunho ? JSON.parse(ct.dados_rascunho) : null);
  } catch (e) {
    toast('Não foi possível criar a revisão: ' + e.message, 'erro');
  }
}

// Abre o PDF do certificado com autenticação (via blob, levando o token)
// Baixa o PDF com nome padronizado: "MB-2026-0004 - CLIENTE.pdf"
async function baixarPdfCertificado(id) {
  try {
    const r = await fetch('/api/certificados/' + id + '/pdf', {
      headers: { Authorization: 'Bearer ' + token }
    });
    if (!r.ok) {
      if (r.status === 404) { toast('O PDF ainda está sendo gerado. Tente novamente em alguns segundos.', 'aviso'); return; }
      throw new Error('Erro ' + r.status);
    }
    const blob = await r.blob();
    // Número e cliente: do cache do painel; se não achar, busca
    let c = certsPainelCache.find(x => x.id === id);
    if (!c || !c.numero) {
      try { c = await api('/certificados/' + id); } catch (e) { /* segue sem */ }
    }
    const limpa = t => String(t || '').replace(/[\\/:*?"<>|]+/g, '-').trim();
    const nome = c && c.numero
      ? `${limpa(c.numero)} - ${limpa(c.cliente)}.pdf`
      : 'certificado.pdf';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast('Baixando: ' + nome, 'ok');
  } catch (e) {
    toast('Não foi possível baixar o PDF: ' + e.message, 'erro');
  }
}

async function abrirPdfCertificado(id) {
  try {
    const r = await fetch('/api/certificados/' + id + '/pdf', {
      headers: { Authorization: 'Bearer ' + token }
    });
    if (!r.ok) {
      if (r.status === 404) { toast('O PDF ainda está sendo gerado. Tente novamente em alguns segundos.', 'aviso'); return; }
      throw new Error('Erro ' + r.status);
    }
    const blob = await r.blob();
    window.open(URL.createObjectURL(blob), '_blank');
  } catch (e) {
    toast('Não foi possível abrir o PDF: ' + e.message, 'erro');
  }
}

// ── Painel de aprovação (responsável técnico / admin) ───────────
const podeAprovar = () => ['admin', 'responsavel_tecnico'].includes(usuario.papel);

// Aprovador edita o ensaio de um certificado aguardando aprovação:
// abre a tela de ensaio normal; ao reenviar, os ensaios são regravados
// e ele volta para a aprovação.
async function editarAguardando(id) {
  try {
    certId = id;
    const ct = await api('/certificados/' + id);
    plano = await api('/balancas/' + ct.balanca_id + '/plano-ensaio');
    montarTelaEnsaio(ct.dados_rascunho ? JSON.parse(ct.dados_rascunho) : null);
    toast('Editando o ensaio — ao concluir, use "Enviar para aprovação" e aprove em seguida.', 'info', 6000);
  } catch (e) { toast('Não foi possível abrir para edição: ' + e.message, 'erro'); }
}

async function abrirRevisao(id) {
  const d = await api('/certificados/' + id + '/revisao');
  const c = d.certificado;
  // Casas decimais pela divisão da balança deste certificado
  const casasRev = (() => {
    const e = String(c.divisao_e ?? '');
    const pt = e.indexOf('.');
    return pt < 0 ? 0 : e.slice(pt + 1).replace(/0+$/, '').length;
  })();
  const un = c.unidade || 'kg';
  const fR = n => n == null ? '—' : Number(n).toLocaleString('pt-BR',
    { minimumFractionDigits: casasRev, maximumFractionDigits: casasRev });
  const temAjuste = !!c.houve_ajuste;

  const linhaInd = l => `<tr>
    <td class="num">${fR(l.carga_aplicada)}</td>
    ${temAjuste ? `<td class="num">${l.indicacao_antes == null ? '—' : fR(l.indicacao_antes)}</td>` : ''}
    <td class="num">${fR(l.indicacao)}</td>
    <td class="num">${(l.erro > 0 ? '+' : '') + fR(l.erro)}</td>
    <td class="num">± ${fR(l.incerteza)}</td><td class="num">± ${fR(l.ema)}</td>
    <td>${l.aprovado == null ? '—' : l.aprovado
      ? '<span class="badge ok">Conforme</span>'
      : '<span class="badge rep">Não conforme</span>'}</td></tr>`;
  const linhaExc = (x, i) => `<tr><td>${i + 1}${x.posicao === 'centro' ? ' (ref.)' : ''}</td>
    <td class="num">${fR(x.carga)}</td><td class="num">${fR(x.indicacao)}</td>
    <td class="num">${(x.erro > 0 ? '+' : '') + fR(x.erro)}</td>
    <td>${x.posicao === 'centro' ? 'ref.' : x.aprovado == null ? '—' : x.aprovado
      ? '<span class="badge ok">Conforme</span>'
      : '<span class="badge rep">Não conforme</span>'}</td></tr>`;
  const linhaRep = r => `<tr><td>${r.medicao_num}</td>
    <td class="num">${fR(r.carga)}</td><td class="num">${fR(r.indicacao)}</td></tr>`;
  const chip = (rot, v) => (v == null || v === '') ? '' :
    `<span class="chip"><b>${rot}:</b> ${esc(String(v))}</span>`;
  const localTxt = (c.local_tipo === 'laboratorio'
    ? 'Laboratório (instalações do emissor)' : 'In loco (instalações do cliente)')
    + (c.local_detalhe ? ' — ' + c.local_detalhe : '');
  const naoConformes = d.indicacao.filter(l => l.aprovado === false).length;

  const html = `
    <div class="card">
      <div class="barra"><h3>Aprovação · ${esc(c.cliente)}</h3>
        <button class="btn-mini" onclick="irPainel()">← Painel</button></div>

      <div class="chips">
        ${chip('Equipamento', c.balanca)}
        ${chip('Marca', c.marca)} ${chip('Modelo', c.modelo)}
        ${chip('Série', c.num_serie)} ${chip('Inmetro', c.numero_inmetro)}
        ${chip('Patrimônio', c.patrimonio)} ${chip('Portaria aprov.', c.portaria_aprovacao)}
        ${chip('Capacidade', fR(c.capacidade) + ' ' + un)}
        ${chip('Divisão e', fR(c.divisao_e) + ' ' + un)}
        ${chip('Classe', c.classe_exatidao)}
      </div>
      <div class="chips" style="margin-top:6px">
        ${chip('Técnico', c.tecnico)}
        ${chip('Data', c.data_calibracao ? new Date(c.data_calibracao).toLocaleDateString('pt-BR') : null)}
        ${chip('Critério', c.contexto_ema === 'em_uso' ? 'Em uso' : 'Verificação subsequente')}
        ${chip('Local', localTxt)}
        ${chip('Temperatura', c.temperatura != null ? c.temperatura + ' °C' : null)}
        ${chip('Umidade', c.umidade != null ? c.umidade + ' %' : null)}
        ${chip('Lacre', c.numero_lacre)} ${chip('Selo Inmetro', c.selo_inmetro)}
      </div>

      ${naoConformes > 0 ? `<p class="erro" style="margin-top:8px">⚠️ Atenção: ${naoConformes} ponto${naoConformes === 1 ? '' : 's'} de indicação NÃO conforme.</p>` : ''}
      ${temAjuste ? '<p class="dica" style="margin-top:8px">🔧 A balança precisou de ajuste — leituras antes e depois registradas; conformidade avaliada sobre a leitura final.</p>' : ''}

      <h4 style="margin-top:12px">Indicação (${un})</h4>
      <table><thead><tr><th>Carga</th>${temAjuste ? '<th>Antes ajuste</th>' : ''}<th>${temAjuste ? 'Após ajuste' : 'Indicação'}</th><th>Erro</th>
        <th>Incerteza</th><th>EMA</th><th>Situação</th></tr></thead>
        <tbody>${d.indicacao.map(linhaInd).join('')}</tbody></table>

      ${d.excentricidade && d.excentricidade.length > 0 ? `
        <h4 style="margin-top:12px">Excentricidade (${un})</h4>
        <table><thead><tr><th>Posição</th><th>Carga</th><th>Indicação</th><th>Erro</th><th>Situação</th></tr></thead>
          <tbody>${d.excentricidade.map(linhaExc).join('')}</tbody></table>` : ''}

      ${d.repetibilidade && d.repetibilidade.length > 0 ? `
        <h4 style="margin-top:12px">Repetibilidade (${un})</h4>
        <table><thead><tr><th>Medição</th><th>Carga</th><th>Indicação</th></tr></thead>
          <tbody>${d.repetibilidade.map(linhaRep).join('')}</tbody></table>` : ''}

      <h4 style="margin-top:12px">Pesos padrão utilizados</h4>
      ${d.pesos.map(p => `<div class="dica">• ${esc(p.identificacao)} · ${fmt(p.valor_nominal)} kg · ${esc(p.classe)}
        · cert. ${esc(p.num_certificado || '—')} · válido até ${p.validade ? new Date(p.validade).toLocaleDateString('pt-BR') : '—'}</div>`).join('')}
      ${podeAprovar() ? `
        <div class="rodape-acoes" style="margin-top:16px;flex-wrap:wrap;gap:8px">
          <button class="btn-mini" onclick="editarAguardando('${c.id}')">✏️ Editar ensaio</button>
          <span style="flex:1"></span>
          <button class="btn-vinho-full" onclick="reprovarCert('${c.id}')">↩ Devolver p/ correção</button>
          <button class="btn-primario" onclick="aprovarCert('${c.id}')">✔ Aprovar e emitir</button>
        </div>`
        : '<p class="dica" style="margin-top:14px">Somente o responsável técnico ou administrador pode aprovar.</p>'}
      <p id="rev-erro" class="erro"></p>
    </div>`;
  document.querySelectorAll('.tela').forEach(t => t.classList.add('oculta'));
  $('#tela-painel').classList.remove('oculta');
  $('#lista-certs').innerHTML = html;
  window.scrollTo(0, 0);
}

async function aprovarCert(id) {
  try {
    const r = await api('/certificados/' + id + '/aprovar', { method: 'POST' });
    toast('Certificado emitido: ' + r.numero + ' — o PDF está sendo gerado.', 'ok', 6000);
    irPainel();
  } catch (e) { $('#rev-erro').textContent = e.message; }
}

async function reprovarCert(id) {
  const obs = prompt('Motivo da devolução (o técnico verá esta observação):');
  if (!obs) return;
  try {
    await api('/certificados/' + id + '/reprovar', { method: 'POST',
      body: JSON.stringify({ observacao: obs }) });
    irPainel();
  } catch (e) { $('#rev-erro').textContent = e.message; }
}

// ════════════════════════════════════════════════════════════════
// CADASTROS
// ════════════════════════════════════════════════════════════════
// ══ Relatórios (admin / responsável técnico) ═══════════════════
let relAtual = 'venc';
let relDados = [];

async function irRelatorios() {
  mostrar('tela-relatorios');
  abaRelatorio('venc');
}

function abaRelatorio(qual) {
  relAtual = qual;
  $('#tab-venc').classList.toggle('ativa', qual === 'venc');
  $('#tab-emit').classList.toggle('ativa', qual === 'emit');
  $('#tab-prod').classList.toggle('ativa', qual === 'prod');
  relDados = [];
  if (qual === 'venc') renderFiltrosVenc();
  else if (qual === 'emit') renderFiltrosEmit();
  else renderFiltrosProd();
}

async function renderFiltrosProd() {
  $('#rel-conteudo').innerHTML = `
    <div class="card">
      <h3>Produção por técnico</h3>
      <div class="form-grid">
        <label>De <input type="date" id="rp-de"></label>
        <label>Até <input type="date" id="rp-ate"></label>
      </div>
      <button class="btn-primario btn-mini" onclick="gerarProd()">Gerar relatório</button>
    </div>
    <div id="rel-resultado"></div>`;
}

async function gerarProd() {
  const p = new URLSearchParams();
  if ($('#rp-de').value) p.set('de', $('#rp-de').value);
  if ($('#rp-ate').value) p.set('ate', $('#rp-ate').value);
  relDados = await api('/relatorios/producao?' + p.toString());
  const cols = [
    { k: 'tecnico', t: 'Técnico' }, { k: 'emitidos', t: 'Emitidos' },
    { k: 'conformes', t: 'Conformes' }, { k: 'nao_conformes', t: 'Não conf.' },
    { k: 'aguardando', t: 'Aguardando' }, { k: 'rascunhos', t: 'Rascunhos' }];
  mostrarResultadoRel('Produção por técnico', cols, relDados);
}

async function opcoesClientesSelect(idSel) {
  const cs = await api('/clientes');
  return `<option value="">Todos os clientes</option>` +
    cs.map(c => `<option value="${c.id}">${esc(c.razao_social)}</option>`).join('');
}

// ── Vencimento de calibração ──
async function renderFiltrosVenc() {
  $('#rel-conteudo').innerHTML = `
    <div class="card">
      <h3>Vencimento de calibração</h3>
      <div class="form-grid">
        <label>Cliente <select id="rv-cliente"><option>Carregando...</option></select></label>
        <label>Balança <select id="rv-balanca"><option value="">Todas</option></select></label>
        <label>Vencimento
          <select id="rv-dias">
            <option value="-1">Já vencidas</option>
            <option value="30">Próximos 30 dias</option>
            <option value="60" selected>Próximos 60 dias</option>
            <option value="90">Próximos 90 dias</option>
            <option value="180">Próximos 180 dias</option>
          </select>
        </label>
      </div>
      <button class="btn-primario btn-mini" onclick="gerarVenc()">Gerar relatório</button>
    </div>
    <div id="rel-resultado"></div>`;
  $('#rv-cliente').innerHTML = await opcoesClientesSelect();
  $('#rv-cliente').onchange = carregarBalancasFiltro;
}

async function carregarBalancasFiltro() {
  const cid = $('#rv-cliente').value;
  const sel = $('#rv-balanca');
  if (!cid) { sel.innerHTML = '<option value="">Todas</option>'; return; }
  const bs = await api(`/clientes/${cid}/balancas`);
  sel.innerHTML = '<option value="">Todas</option>' +
    bs.filter(b => b.ativa).map(b => `<option value="${b.id}">${esc(b.identificacao)}</option>`).join('');
}

async function gerarVenc() {
  const p = new URLSearchParams();
  if ($('#rv-cliente').value) p.set('clienteId', $('#rv-cliente').value);
  if ($('#rv-balanca').value) p.set('balancaId', $('#rv-balanca').value);
  p.set('dias', $('#rv-dias').value);
  relDados = await api('/relatorios/vencimentos?' + p.toString());
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const linhas = relDados.map(v => {
    const venc = new Date(String(v.vence_em).substring(0, 10) + 'T00:00:00');
    const dias = Math.round((venc - hoje) / 86400000);
    const prazo = dias < 0 ? `vencida há ${-dias}d` : dias === 0 ? 'vence hoje' : `${dias}d`;
    return { cliente: v.cliente, balanca: v.balanca, numero: v.numero,
      calib: v.data_calibracao ? new Date(v.data_calibracao).toLocaleDateString('pt-BR') : '—',
      vencimento: venc.toLocaleDateString('pt-BR'), prazo, telefone: v.telefone || '' };
  });
  const cols = [
    { k: 'cliente', t: 'Cliente' }, { k: 'balanca', t: 'Balança' },
    { k: 'numero', t: 'Certificado' }, { k: 'calib', t: 'Calibração' },
    { k: 'vencimento', t: 'Vencimento' }, { k: 'prazo', t: 'Prazo' },
    { k: 'telefone', t: 'Telefone' }];
  mostrarResultadoRel('Vencimento de calibração', cols, linhas);
}

// ── Certificados emitidos ──
async function renderFiltrosEmit() {
  const us = await api('/usuarios');
  $('#rel-conteudo').innerHTML = `
    <div class="card">
      <h3>Certificados emitidos</h3>
      <div class="form-grid">
        <label>De <input type="date" id="re-de"></label>
        <label>Até <input type="date" id="re-ate"></label>
        <label>Cliente <select id="re-cliente"><option>Carregando...</option></select></label>
        <label>Técnico
          <select id="re-tecnico"><option value="">Todos</option>
            ${us.map(u => `<option value="${u.id}">${esc(u.nome)}</option>`).join('')}
          </select>
        </label>
      </div>
      <button class="btn-primario btn-mini" onclick="gerarEmit()">Gerar relatório</button>
    </div>
    <div id="rel-resultado"></div>`;
  $('#re-cliente').innerHTML = await opcoesClientesSelect();
}

async function gerarEmit() {
  const p = new URLSearchParams();
  if ($('#re-de').value) p.set('de', $('#re-de').value);
  if ($('#re-ate').value) p.set('ate', $('#re-ate').value);
  if ($('#re-cliente').value) p.set('clienteId', $('#re-cliente').value);
  if ($('#re-tecnico').value) p.set('tecnicoId', $('#re-tecnico').value);
  relDados = await api('/relatorios/emitidos?' + p.toString());
  const linhas = relDados.map(c => ({
    numero: c.numero,
    emissao: c.data_emissao ? new Date(c.data_emissao).toLocaleDateString('pt-BR') : '—',
    cliente: c.cliente, balanca: c.balanca, tecnico: c.tecnico,
    resultado: c.conforme ? 'Conforme' : 'Não conforme',
    status: c.status === 'substituido' ? 'Substituído' : 'Emitido'
  }));
  const cols = [
    { k: 'numero', t: 'Certificado' }, { k: 'emissao', t: 'Emissão' },
    { k: 'cliente', t: 'Cliente' }, { k: 'balanca', t: 'Balança' },
    { k: 'tecnico', t: 'Técnico' }, { k: 'resultado', t: 'Resultado' },
    { k: 'status', t: 'Status' }];
  mostrarResultadoRel('Certificados emitidos', cols, linhas);
}

// ── Resultado + exportação ──
let relExport = { titulo: '', cols: [], linhas: [] };

function mostrarResultadoRel(titulo, cols, linhas) {
  relExport = { titulo, cols, linhas };
  if (linhas.length === 0) {
    $('#rel-resultado').innerHTML = '<div class="card"><p class="dica">Nenhum registro encontrado com esses filtros.</p></div>';
    return;
  }
  const th = cols.map(c => `<th>${c.t}</th>`).join('');
  const tr = linhas.map(l => `<tr>${cols.map(c => `<td>${esc(String(l[c.k] ?? ''))}</td>`).join('')}</tr>`).join('');
  $('#rel-resultado').innerHTML = `
    <div class="card">
      <div class="barra">
        <h3>${esc(titulo)} <span class="dica">(${linhas.length} registro${linhas.length === 1 ? '' : 's'})</span></h3>
        <div class="barra-btns">
          <button class="btn-mini" onclick="exportarCsv()">⬇️ CSV</button>
          <button class="btn-mini" onclick="exportarPdf()">📄 PDF</button>
        </div>
      </div>
      <div class="tabela-scroll">
        <table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>
      </div>
    </div>`;
}

function exportarCsv() {
  const { titulo, cols, linhas } = relExport;
  const esc2 = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const linhasCsv = [cols.map(c => esc2(c.t)).join(';')]
    .concat(linhas.map(l => cols.map(c => esc2(l[c.k])).join(';')));
  // BOM para o Excel abrir acentos corretamente
  const blob = new Blob(['\ufeff' + linhasCsv.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${titulo.replace(/[\\/:*?"<>|]+/g, '-')} - ${new Date().toLocaleDateString('pt-BR')}.csv`;
  a.click();
  toast('CSV exportado.', 'ok');
}

function exportarPdf() {
  const { titulo, cols, linhas } = relExport;
  const empresa = usuario?.empresa || '';
  const th = cols.map(c => `<th>${esc(c.t)}</th>`).join('');
  const tr = linhas.map(l => `<tr>${cols.map(c => `<td>${esc(String(l[c.k] ?? ''))}</td>`).join('')}</tr>`).join('');
  const w = window.open('', '_blank');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(titulo)}</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 24px; color: #1c2b33; }
      h1 { font-size: 16px; color: #0d3b2e; margin: 0 0 2px; }
      .sub { font-size: 11px; color: #667; margin: 0 0 14px; }
      table { width: 100%; border-collapse: collapse; font-size: 10px; }
      th { background: #0d3b2e; color: #fff; padding: 5px 6px; text-align: left; }
      td { padding: 4px 6px; border-bottom: 1px solid #ddd; }
      tr:nth-child(even) td { background: #f5f7f6; }
      @media print { @page { margin: 1.2cm; } }
    </style></head><body>
    <h1>${esc(empresa)}</h1>
    <p class="sub">${esc(titulo)} · gerado em ${new Date().toLocaleString('pt-BR')} · ${linhas.length} registro(s)</p>
    <table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>
    <script>window.onload=function(){window.print();}<\/script>
    </body></html>`);
  w.document.close();
}

// ══ Painel de super-administração (multiempresa) ═══════════════
const saApi = (path, opts) => api('/sa' + path, opts);
const brl = v => (v == null ? '—' : Number(v).toLocaleString('pt-BR',
  { style: 'currency', currency: 'BRL' }));
const dbrSA = v => v ? new Date(String(v).substring(0, 10) + 'T00:00:00').toLocaleDateString('pt-BR') : '—';

async function irSuperAdmin() {
  mostrar('tela-sa');
  await renderPainelSA();
}

async function renderPainelSA() {
  $('#sa-conteudo').innerHTML = '<p class="dica">Carregando…</p>';
  let resumo, empresas, vigencia, chamados, erros;
  try {
    [resumo, empresas, vigencia, chamados, erros] = await Promise.all([
      saApi('/resumo'), saApi('/empresas'), saApi('/vigencia-contratos'),
      saApi('/chamados/abertos').catch(() => ({ abertos: 0 })),
      saApi('/erros/abertos').catch(() => ({ abertos: 0 }))]);
  } catch (e) { $('#sa-conteudo').innerHTML = `<p class="erro">${e.message}</p>`; return; }

  // Alertas de contrato (vencendo / vencido / suspensa por contrato)
  const alertas = (vigencia || []).filter(v =>
    ['vencendo', 'vencido', 'suspensa_contrato'].includes(v.situacao));
  const alertaHtml = alertas.length === 0 ? '' : `
    <div class="card" style="margin-bottom:16px;border-left:4px solid #b02a37">
      <h3 style="margin-top:0">📄 Contratos que exigem atenção</h3>
      <div class="tabela-scroll"><table>
        <thead><tr><th>Empresa</th><th>Situação</th><th>Fim da vigência</th><th></th></tr></thead>
        <tbody>${alertas.map(v => `
          <tr onclick="abrirEmpresaSA('${v.id}')" style="cursor:pointer">
            <td><b>${esc(v.razao_social)}</b></td>
            <td>${{
              vencendo: `<span class="badge" style="background:#fff3cd;color:#856404">Vence em ${v.dias_para_vencer} dia(s)</span>`,
              vencido: `<span class="badge rep">Vencido há ${v.dias_vencido} dia(s) · bloqueio em ${Math.max(0, v.dias_carencia - v.dias_vencido)} dia(s)</span>`,
              suspensa_contrato: '<span class="badge rep">⛔ Suspensa por contrato</span>'
            }[v.situacao]}</td>
            <td>${v.fim_vigencia ? dbrSA(v.fim_vigencia) : '—'}</td>
            <td class="dica">abrir →</td>
          </tr>`).join('')}</tbody>
      </table></div>
    </div>`;

  // Lista completa em memória para busca/filtro instantâneos
  window._saEmpresas = empresas;
  window._saFiltro = window._saFiltro || 'todas';

  const kpi = (num, rot, cls = '') =>
    `<div class="kpi"><span class="kpi-num ${cls}">${num}</span><span class="kpi-rotulo">${rot}</span></div>`;

  $('#sa-conteudo').innerHTML = `
    <div class="barra">
      <h2>Empresas</h2>
      <div class="barra-btns">
        <button onclick="renderChamadosSA()">🎧 Chamados${chamados.abertos > 0
          ? ` <span style="background:#b02a37;color:#fff;border-radius:10px;padding:1px 7px;font-size:11px">${chamados.abertos}</span>` : ''}</button>
        <button onclick="renderErrosSA()">🐞 Erros${erros.abertos > 0
          ? ` <span style="background:#b02a37;color:#fff;border-radius:10px;padding:1px 7px;font-size:11px">${erros.abertos}</span>` : ''}</button>
        <button onclick="renderFinanceiroSA()">💰 Financeiro</button>
        <button onclick="renderAtividadeSA()">📊 Atividade</button>
        <button onclick="abrirSmtpSA()">⚙️ Servidor de e-mail</button>
        <button class="btn-primario" onclick="formNovaEmpresa()">+ Nova empresa</button>
      </div>
    </div>
    <div class="cards-kpi" style="margin-bottom:16px">
      ${kpi(resumo.total_empresas, 'Empresas')}
      ${kpi(resumo.empresas_ativas, 'Ativas', 'kpi-ok')}
      ${kpi(resumo.empresas_suspensas, 'Suspensas', 'kpi-atencao')}
      ${kpi(resumo.total_certificados, 'Certificados')}
      ${kpi(brl(resumo.receita_mes), 'Receita do mês', 'kpi-ok')}
      ${kpi(brl(resumo.inadimplencia), 'A receber', 'kpi-atencao')}
    </div>
    ${alertaHtml}
    <div class="card">
      <div class="barra-btns" style="margin-bottom:10px;flex-wrap:wrap;align-items:center">
        <input type="search" id="sa-busca" placeholder="🔎 Buscar por nome ou CNPJ…"
          style="flex:1;min-width:220px" oninput="filtrarEmpresasSA()">
        ${['todas', 'ativa', 'suspensa', 'cancelada'].map(f => `
          <button class="btn-mini" id="sa-f-${f}" onclick="window._saFiltro='${f}';filtrarEmpresasSA()">
            ${{ todas: 'Todas', ativa: '✅ Ativas', suspensa: '⛔ Suspensas', cancelada: '✖ Canceladas' }[f]}
          </button>`).join('')}
      </div>
      <div class="tabela-scroll">
        <table>
          <thead><tr><th>Empresa</th><th>Plano</th><th>Status</th>
            <th>Usuários</th><th>Certificados</th><th>Pendências</th></tr></thead>
          <tbody id="sa-tbody"></tbody>
        </table>
      </div>
      <p id="sa-contagem" class="dica"></p>
    </div>`;
  filtrarEmpresasSA();
}

// Aplica busca (nome/CNPJ) + filtro de situação e re-renderiza a tabela
function filtrarEmpresasSA() {
  const statusBadge = s => ({
    ativa: '<span class="badge ok">Ativa</span>',
    suspensa: '<span class="badge rep">Suspensa</span>',
    cancelada: '<span class="badge">Cancelada</span>'
  }[s] || s);

  const termo = ($('#sa-busca')?.value || '').trim().toLowerCase();
  const termoNum = termo.replace(/\D/g, '');  // busca CNPJ ignorando pontuação
  const filtro = window._saFiltro || 'todas';

  const lista = (window._saEmpresas || []).filter(e => {
    const okStatus = filtro === 'todas' || e.status === filtro;
    const okBusca = !termo
      || e.razao_social.toLowerCase().includes(termo)
      || (termoNum && e.cnpj.replace(/\D/g, '').includes(termoNum));
    return okStatus && okBusca;
  });

  // realce do botão de filtro ativo
  ['todas', 'ativa', 'suspensa', 'cancelada'].forEach(f => {
    const b = $('#sa-f-' + f);
    if (b) b.style.cssText = f === filtro
      ? 'background:#0d3b2e;color:#fff' : '';
  });

  $('#sa-tbody').innerHTML = lista.map(e => `
    <tr onclick="abrirEmpresaSA('${e.id}')" style="cursor:pointer">
      <td><b>${esc(e.razao_social)}</b><br><span class="dica">${esc(e.cnpj)}</span></td>
      <td>${esc(e.plano)}</td>
      <td>${statusBadge(e.status)}</td>
      <td class="num">${e.qtd_usuarios}${e.limite_usuarios > 0 ? ' / ' + e.limite_usuarios : ''}</td>
      <td class="num">${e.qtd_certificados}</td>
      <td class="num">${e.cobrancas_pendentes > 0
        ? `<span class="venc-vencido">${e.cobrancas_pendentes}</span>` : '0'}</td>
    </tr>`).join('')
    || '<tr><td colspan="6" class="dica">Nenhuma empresa encontrada.</td></tr>';

  $('#sa-contagem').textContent = `${lista.length} de ${(window._saEmpresas || []).length} empresa(s)`;
}

// ═══════ Chamados de suporte (helpdesk) ═══════════════════════
const CHAMADO_STATUS = {
  aberto: '<span class="badge" style="background:#cfe2ff;color:#084298">Aberto</span>',
  em_atendimento: '<span class="badge" style="background:#fff3cd;color:#856404">Em atendimento</span>',
  aguardando_cliente: '<span class="badge" style="background:#e2d9f3;color:#59359a">Aguardando você</span>',
  resolvido: '<span class="badge ok">Resolvido</span>',
  fechado: '<span class="badge">Fechado</span>'
};
const CHAMADO_CAT = { duvida: 'Dúvida', problema: 'Problema', financeiro: 'Financeiro',
  melhoria: 'Sugestão de melhoria', outro: 'Outro' };
const CHAMADO_PRIO = { baixa: 'Baixa', normal: 'Normal', alta: 'Alta', urgente: '🔴 Urgente' };
const dthr = d => d ? new Date(d).toLocaleString('pt-BR',
  { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

// ── Lado do cliente (tenant) ──────────────────────────────────
async function irChamados() {
  mostrar('tela-chamados');
  await renderChamados();
}

async function renderChamados() {
  const alvo = $('#chamados-conteudo');
  alvo.innerHTML = '<p class="dica">Carregando…</p>';
  let lista;
  try { lista = await api('/chamados'); }
  catch (e) { alvo.innerHTML = `<p class="erro">${e.message}</p>`; return; }

  const linhas = lista.map(c => `
    <tr onclick="abrirChamado('${c.id}')" style="cursor:pointer">
      <td>#${String(c.numero).padStart(4, '0')}</td>
      <td><b>${esc(c.assunto)}</b><br><span class="dica">${CHAMADO_CAT[c.categoria] || c.categoria} · aberto por ${esc(c.criado_por_nome)}</span></td>
      <td>${CHAMADO_PRIO[c.prioridade] || c.prioridade}</td>
      <td>${CHAMADO_STATUS[c.status] || c.status}</td>
      <td>${dthr(c.atualizado_em)}</td>
    </tr>`).join('');

  alvo.innerHTML = `
    <div class="barra">
      <h2>Meus chamados</h2>
      <button class="btn-primario" onclick="formNovoChamado()">+ Abrir chamado</button>
    </div>
    <div class="card">
      <div class="tabela-scroll">
        <table>
          <thead><tr><th>Nº</th><th>Assunto</th><th>Prioridade</th><th>Status</th><th>Atualizado</th></tr></thead>
          <tbody>${linhas || '<tr><td colspan="5" class="dica">Nenhum chamado. Precisa de ajuda? Clique em "Abrir chamado".</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
}

function formNovoChamado() {
  const modal = `
    <div class="modal-fundo" onclick="if(event.target===this)this.remove()">
      <div class="modal-caixa" style="max-width:520px">
        <h3>Abrir chamado</h3>
        <div class="form-grid">
          <label>Assunto * <input type="text" id="ch-assunto" maxlength="120"
            placeholder="Resumo do que você precisa"></label>
          <label>Categoria
            <select id="ch-cat">
              ${Object.entries(CHAMADO_CAT).map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}
            </select></label>
          <label>Prioridade
            <select id="ch-prio">
              <option value="baixa">Baixa</option>
              <option value="normal" selected>Normal</option>
              <option value="alta">Alta</option>
              <option value="urgente">Urgente</option>
            </select></label>
        </div>
        <label>Descreva com detalhes *
          <textarea id="ch-msg" rows="5" placeholder="Conte o que aconteceu, o que você tentou, e em qual tela/certificado."></textarea></label>
        <div class="rodape-acoes" style="margin-top:10px">
          <button onclick="this.closest('.modal-fundo').remove()">Cancelar</button>
          <button class="btn-primario" onclick="salvarChamado()">Enviar</button>
        </div>
        <p id="ch-erro" class="erro"></p>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', modal);
}

async function salvarChamado() {
  const corpo = {
    assunto: $('#ch-assunto').value.trim(),
    categoria: $('#ch-cat').value,
    prioridade: $('#ch-prio').value,
    mensagem: $('#ch-msg').value.trim()
  };
  if (!corpo.assunto || !corpo.mensagem) {
    $('#ch-erro').textContent = 'Preencha o assunto e a descrição.'; return;
  }
  try {
    const r = await api('/chamados', { method: 'POST', body: JSON.stringify(corpo) });
    document.querySelector('.modal-fundo')?.remove();
    toast(`Chamado #${String(r.numero).padStart(4, '0')} aberto. Responderemos em breve.`, 'ok');
    renderChamados();
  } catch (e) { $('#ch-erro').textContent = e.message; }
}

// Conversa (thread) de um chamado — visão do cliente
async function abrirChamado(id) {
  const alvo = $('#chamados-conteudo');
  alvo.innerHTML = '<p class="dica">Carregando…</p>';
  let d;
  try { d = await api('/chamados/' + id); }
  catch (e) { alvo.innerHTML = `<p class="erro">${e.message}</p>`; return; }
  const c = d.chamado;
  alvo.innerHTML = `
    <div class="barra">
      <h2>#${String(c.numero).padStart(4, '0')} · ${esc(c.assunto)}</h2>
      <div class="barra-btns">
        ${c.status !== 'fechado'
          ? `<button onclick="fecharChamado('${id}')">✔ Encerrar chamado</button>` : ''}
        <button onclick="renderChamados()">← Meus chamados</button>
      </div>
    </div>
    <p class="dica">${CHAMADO_CAT[c.categoria] || c.categoria} · ${CHAMADO_PRIO[c.prioridade]} ·
      ${CHAMADO_STATUS[c.status]} · aberto em ${dthr(c.criado_em)}</p>
    <div class="card">${htmlThreadChamado(d.mensagens)}</div>
    ${c.status !== 'fechado' ? `
    <div class="card">
      <label>Responder <textarea id="ch-resp" rows="3"></textarea></label>
      <button class="btn-primario btn-mini" onclick="responderChamado('${id}')">Enviar resposta</button>
      <p id="ch-resp-erro" class="erro"></p>
    </div>` : '<p class="dica">Chamado encerrado. Se precisar, abra um novo.</p>'}`;
}

function htmlThreadChamado(msgs, ladoSuporte = false) {
  return msgs.map(m => {
    const doCliente = m.autor_tipo === 'cliente';
    // No painel do cliente, as mensagens dele ficam à direita; no do
    // suporte, as do suporte ficam à direita
    const minha = ladoSuporte ? !doCliente : doCliente;
    return `
    <div style="display:flex;justify-content:${minha ? 'flex-end' : 'flex-start'};margin-bottom:10px">
      <div style="max-width:75%;background:${minha ? '#0d3b2e' : '#eef3f1'};
        color:${minha ? '#fff' : '#1c2b33'};padding:10px 12px;border-radius:10px">
        <div style="font-size:11px;opacity:.75;margin-bottom:3px">
          ${esc(m.autor_nome)} · ${doCliente ? 'cliente' : 'suporte'} · ${dthr(m.criado_em)}</div>
        <div style="white-space:pre-wrap">${esc(m.mensagem)}</div>
      </div>
    </div>`;
  }).join('') || '<p class="dica">Sem mensagens.</p>';
}

async function responderChamado(id) {
  const msg = $('#ch-resp').value.trim();
  if (!msg) { $('#ch-resp-erro').textContent = 'Escreva a mensagem.'; return; }
  try {
    await api('/chamados/' + id + '/mensagens', { method: 'POST', body: JSON.stringify({ mensagem: msg }) });
    abrirChamado(id);
  } catch (e) { $('#ch-resp-erro').textContent = e.message; }
}

async function fecharChamado(id) {
  if (!await modalConfirmar('Encerrar este chamado? Você poderá abrir outro se precisar.')) return;
  try {
    await api('/chamados/' + id + '/fechar', { method: 'PUT' });
    toast('Chamado encerrado.', 'ok');
    renderChamados();
  } catch (e) { toast(e.message, 'erro'); }
}

// ── Lado do super-admin ───────────────────────────────────────
async function renderChamadosSA(filtro = '') {
  window._saFiltroChamado = filtro;
  $('#sa-conteudo').innerHTML = '<p class="dica">Carregando…</p>';
  let lista;
  try { lista = await saApi('/chamados' + (filtro ? '?status=' + filtro : '')); }
  catch (e) { $('#sa-conteudo').innerHTML = `<p class="erro">${e.message}</p>`; return; }

  const filtros = ['', 'aberto', 'em_atendimento', 'aguardando_cliente', 'resolvido', 'fechado'];
  const rotulos = { '': 'Todos', aberto: 'Abertos', em_atendimento: 'Em atendimento',
    aguardando_cliente: 'Aguardando cliente', resolvido: 'Resolvidos', fechado: 'Fechados' };

  const linhas = lista.map(c => `
    <tr onclick="abrirChamadoSA('${c.id}')" style="cursor:pointer">
      <td>#${String(c.numero).padStart(4, '0')}</td>
      <td><b>${esc(c.empresa)}</b></td>
      <td>${esc(c.assunto)}<br><span class="dica">${CHAMADO_CAT[c.categoria] || c.categoria} · ${esc(c.criado_por_nome)}</span></td>
      <td>${CHAMADO_PRIO[c.prioridade] || c.prioridade}</td>
      <td>${CHAMADO_STATUS[c.status] || c.status}</td>
      <td>${dthr(c.atualizado_em)}</td>
    </tr>`).join('');

  $('#sa-conteudo').innerHTML = `
    <div class="barra">
      <h2>🎧 Chamados</h2>
      <div class="barra-btns"><button onclick="renderPainelSA()">← Empresas</button></div>
    </div>
    <div class="barra-btns" style="margin-bottom:10px;flex-wrap:wrap">
      ${filtros.map(f => `<button class="btn-mini" style="${f === filtro ? 'background:#0d3b2e;color:#fff' : ''}"
        onclick="renderChamadosSA('${f}')">${rotulos[f]}</button>`).join('')}
    </div>
    <div class="card">
      <div class="tabela-scroll">
        <table>
          <thead><tr><th>Nº</th><th>Empresa</th><th>Assunto</th><th>Prioridade</th><th>Status</th><th>Atualizado</th></tr></thead>
          <tbody>${linhas || '<tr><td colspan="6" class="dica">Nenhum chamado.</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
}

async function abrirChamadoSA(id) {
  $('#sa-conteudo').innerHTML = '<p class="dica">Carregando…</p>';
  let d;
  try { d = await saApi('/chamados/' + id); }
  catch (e) { $('#sa-conteudo').innerHTML = `<p class="erro">${e.message}</p>`; return; }
  const c = d.chamado;
  const selStatus = ['aberto', 'em_atendimento', 'aguardando_cliente', 'resolvido', 'fechado']
    .map(s => `<option value="${s}" ${c.status === s ? 'selected' : ''}>${s.replace(/_/g, ' ')}</option>`).join('');
  const selPrio = ['baixa', 'normal', 'alta', 'urgente']
    .map(p => `<option value="${p}" ${c.prioridade === p ? 'selected' : ''}>${p}</option>`).join('');

  $('#sa-conteudo').innerHTML = `
    <div class="barra">
      <h2>#${String(c.numero).padStart(4, '0')} · ${esc(c.assunto)}</h2>
      <div class="barra-btns"><button onclick="renderChamadosSA(window._saFiltroChamado || '')">← Chamados</button></div>
    </div>
    <p class="dica"><b>${esc(c.empresa)}</b> · ${CHAMADO_CAT[c.categoria] || c.categoria} ·
      aberto por ${esc(c.criado_por_nome)} em ${dthr(c.criado_em)}</p>
    <div class="card">
      <div class="form-grid">
        <label>Status <select id="chsa-status">${selStatus}</select></label>
        <label>Prioridade <select id="chsa-prio">${selPrio}</select></label>
      </div>
      <button class="btn-mini btn-primario" onclick="statusChamadoSA('${id}')">Atualizar</button>
    </div>
    <div class="card">${htmlThreadChamado(d.mensagens, true)}</div>
    <div class="card">
      <label>Responder como suporte <textarea id="chsa-resp" rows="3"></textarea></label>
      <p class="dica">Ao responder, o chamado passa para "aguardando cliente" automaticamente.</p>
      <button class="btn-primario btn-mini" onclick="responderChamadoSA('${id}')">Enviar resposta</button>
      <p id="chsa-erro" class="erro"></p>
    </div>`;
}

async function responderChamadoSA(id) {
  const msg = $('#chsa-resp').value.trim();
  if (!msg) { $('#chsa-erro').textContent = 'Escreva a mensagem.'; return; }
  try {
    await saApi('/chamados/' + id + '/mensagens', { method: 'POST', body: JSON.stringify({ mensagem: msg }) });
    toast('Resposta enviada.', 'ok');
    abrirChamadoSA(id);
  } catch (e) { $('#chsa-erro').textContent = e.message; }
}

async function statusChamadoSA(id) {
  try {
    await saApi('/chamados/' + id + '/status', { method: 'PUT', body: JSON.stringify({
      status: $('#chsa-status').value, prioridade: $('#chsa-prio').value }) });
    toast('Chamado atualizado.', 'ok');
    abrirChamadoSA(id);
  } catch (e) { toast(e.message, 'erro'); }
}

// ── Log de erros do sistema (super-admin) ─────────────────────
async function renderErrosSA(apenasAbertos = true) {
  window._saErrosAbertos = apenasAbertos;
  $('#sa-conteudo').innerHTML = '<p class="dica">Carregando…</p>';
  let lista;
  try { lista = await saApi('/erros?abertos=' + apenasAbertos); }
  catch (e) { $('#sa-conteudo').innerHTML = `<p class="erro">${e.message}</p>`; return; }

  const linhas = lista.map(er => `
    <tr>
      <td class="dica" style="white-space:nowrap">${dthr(er.ocorrido_em)}</td>
      <td><b>${esc(er.tipo || '—')}</b><br><span class="dica">${esc(er.metodo || '')} ${esc(er.rota || '')}</span></td>
      <td>${esc(er.mensagem || '')}${er.empresa ? `<br><span class="dica">${esc(er.empresa)}</span>` : ''}</td>
      <td>${er.resolvido ? '<span class="badge ok">Resolvido</span>' : '<span class="badge rep">Aberto</span>'}</td>
      <td style="white-space:nowrap">
        <button class="btn-mini" onclick="verDetalheErro(${er.id})">🔍 Detalhe</button>
        <button class="btn-mini" onclick="resolverErro(${er.id}, ${er.resolvido ? 'false' : 'true'})">
          ${er.resolvido ? '↩ Reabrir' : '✔ Resolver'}</button>
      </td>
    </tr>
    <tr id="erro-det-${er.id}" style="display:none">
      <td colspan="5"><pre style="white-space:pre-wrap;font-size:11px;background:#f6f8f7;padding:10px;border-radius:6px;max-height:300px;overflow:auto">${esc(er.detalhe || 'sem detalhe')}</pre></td>
    </tr>`).join('');

  window._saErros = lista;
  $('#sa-conteudo').innerHTML = `
    <div class="barra">
      <h2>🐞 Erros do sistema</h2>
      <div class="barra-btns"><button onclick="renderPainelSA()">← Empresas</button></div>
    </div>
    <div class="barra-btns" style="margin-bottom:10px;flex-wrap:wrap;align-items:center">
      <button class="btn-mini" style="${apenasAbertos ? 'background:#0d3b2e;color:#fff' : ''}"
        onclick="renderErrosSA(true)">Só abertos</button>
      <button class="btn-mini" style="${!apenasAbertos ? 'background:#0d3b2e;color:#fff' : ''}"
        onclick="renderErrosSA(false)">Todos</button>
      <button class="btn-mini" onclick="limparErros()" style="margin-left:auto">🧹 Limpar resolvidos (+30 dias)</button>
    </div>
    <div class="card">
      <div class="tabela-scroll">
        <table>
          <thead><tr><th>Quando</th><th>Tipo / Rota</th><th>Mensagem</th><th>Status</th><th>Ações</th></tr></thead>
          <tbody>${linhas || '<tr><td colspan="5" class="dica">Nenhum erro registrado. 🎉</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
}

function verDetalheErro(id) {
  const el = document.getElementById('erro-det-' + id);
  if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
}

async function resolverErro(id, resolvido) {
  try {
    await saApi('/erros/' + id + '/resolver', { method: 'PUT', body: JSON.stringify({ resolvido }) });
    renderErrosSA(window._saErrosAbertos);
  } catch (e) { toast(e.message, 'erro'); }
}

async function limparErros() {
  if (!await modalConfirmar('Remover os erros já resolvidos com mais de 30 dias?')) return;
  try {
    const r = await saApi('/erros/limpar', { method: 'POST' });
    toast(`${r.removidos} erro(s) removido(s).`, 'ok');
    renderErrosSA(window._saErrosAbertos);
  } catch (e) { toast(e.message, 'erro'); }
}

// ── Log de erros do sistema (fim) ─────────────────────────────
// ── Dashboard financeiro ──────────────────────────────────
async function renderFinanceiroSA() {
  $('#sa-conteudo').innerHTML = '<p class="dica">Carregando…</p>';
  let dados;
  try { dados = await saApi('/financeiro'); }
  catch (e) { $('#sa-conteudo').innerHTML = `<p class="erro">${e.message}</p>`; return; }
  const f = dados.financeiro;
  const kpi = (num, rot, cls = '') =>
    `<div class="kpi"><span class="kpi-num ${cls}">${num}</span><span class="kpi-rotulo">${rot}</span></div>`;

  // mini-gráfico de barras (faturamento mensal) sem libs
  const maxV = Math.max(...dados.mensal.map(m => Number(m.total)), 1);
  const barras = dados.mensal.map(m => {
    const h = Math.round((Number(m.total) / maxV) * 90) + 2;
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1">
      <div style="font-size:10px;color:#667">${brl(m.total)}</div>
      <div style="width:70%;height:${h}px;background:#0d3b2e;border-radius:3px 3px 0 0"></div>
      <div style="font-size:10px;color:#667">${m.competencia}</div>
    </div>`;
  }).join('');

  $('#sa-conteudo').innerHTML = `
    <div class="barra">
      <h2>💰 Financeiro</h2>
      <div class="barra-btns"><button onclick="renderPainelSA()">← Empresas</button></div>
    </div>
    <div class="cards-kpi" style="margin-bottom:16px">
      ${kpi(brl(f.mrr), 'MRR (receita recorrente/mês)', 'kpi-ok')}
      ${kpi(brl(f.faturado_mes), 'Faturado no mês', 'kpi-ok')}
      ${kpi(brl(f.total_aberto), 'Em aberto', 'kpi-atencao')}
      ${kpi(brl(f.total_vencido), 'Vencido', 'kpi-atencao')}
      ${kpi(brl(f.pago_12m), 'Recebido (12 meses)')}
      ${kpi(f.contratos_ativos, 'Contratos ativos')}
    </div>
    <div class="card">
      <h3 style="margin-top:0">Faturamento dos últimos 6 meses</h3>
      <div style="display:flex;align-items:flex-end;gap:8px;height:130px;padding:8px 0">
        ${barras}
      </div>
      <p class="dica">Apenas cobranças com status "pago" entram no faturamento.</p>
    </div>

    <div class="card">
      <h3 style="margin-top:0">Relatório de cobranças</h3>
      <div class="barra-btns" style="flex-wrap:wrap;align-items:flex-end;margin-bottom:10px">
        <label style="flex:0">De <input type="date" id="rf-de"></label>
        <label style="flex:0">Até <input type="date" id="rf-ate"></label>
        <label style="flex:0">Status
          <select id="rf-status">
            <option value="">Todos</option>
            <option value="pago">Pago</option>
            <option value="pendente">Pendente</option>
            <option value="vencido">Vencido</option>
            <option value="cancelado">Cancelado</option>
          </select></label>
        <button class="btn-primario btn-mini" onclick="gerarRelFinanceiro()">Gerar</button>
      </div>
      <div id="rf-resultado"><p class="dica">Escolha o período e clique em Gerar.</p></div>
    </div>`;
}

// Gera o relatório de cobranças com filtros e prepara a exportação
async function gerarRelFinanceiro() {
  const de = $('#rf-de').value, ate = $('#rf-ate').value, status = $('#rf-status').value;
  $('#rf-resultado').innerHTML = '<p class="dica">Gerando…</p>';
  let lista;
  try {
    const qs = new URLSearchParams();
    if (de) qs.set('de', de);
    if (ate) qs.set('ate', ate);
    if (status) qs.set('status', status);
    lista = await saApi('/relatorio-financeiro' + (qs.toString() ? '?' + qs : ''));
  } catch (e) { $('#rf-resultado').innerHTML = `<p class="erro">${e.message}</p>`; return; }

  const stLabel = { pago: 'Pago', pendente: 'Pendente', vencido: 'Vencido', cancelado: 'Cancelado' };
  const linhas = lista.map(c => ({
    empresa: c.empresa,
    contrato: c.contrato,
    competencia: dbrSA(c.competencia),
    vencimento: dbrSA(c.vencimento),
    valor: brl(c.valor),
    status: stLabel[c.status] || c.status,
    pago_em: c.pago_em ? dbrSA(c.pago_em) : '—'
  }));

  // Totais por status (sobre os dados filtrados)
  const soma = st => lista.filter(c => c.status === st)
    .reduce((t, c) => t + Number(c.valor), 0);
  const totalGeral = lista.reduce((t, c) => t + Number(c.valor), 0);

  const cols = [
    { k: 'empresa', t: 'Empresa' }, { k: 'contrato', t: 'Contrato' },
    { k: 'competencia', t: 'Competência' }, { k: 'vencimento', t: 'Vencimento' },
    { k: 'valor', t: 'Valor' }, { k: 'status', t: 'Status' }, { k: 'pago_em', t: 'Pago em' }
  ];
  const periodo = (de || ate) ? ` (${de ? dbrSA(de) : '…'} a ${ate ? dbrSA(ate) : '…'})` : '';
  relExport = { titulo: 'Relatório financeiro' + periodo, cols, linhas };

  $('#rf-resultado').innerHTML = `
    <div class="cards-kpi" style="margin-bottom:10px">
      <div class="kpi"><span class="kpi-num kpi-ok">${brl(soma('pago'))}</span><span class="kpi-rotulo">Pago</span></div>
      <div class="kpi"><span class="kpi-num">${brl(soma('pendente'))}</span><span class="kpi-rotulo">Pendente</span></div>
      <div class="kpi"><span class="kpi-num kpi-atencao">${brl(soma('vencido'))}</span><span class="kpi-rotulo">Vencido</span></div>
      <div class="kpi"><span class="kpi-num">${brl(totalGeral)}</span><span class="kpi-rotulo">Total do período</span></div>
    </div>
    <div class="barra-btns" style="margin-bottom:8px">
      <button class="btn-mini" onclick="exportarCsv()">⬇ CSV</button>
      <button class="btn-mini" onclick="exportarPdf()">🖨 PDF</button>
    </div>
    <div class="tabela-scroll">
      <table>
        <thead><tr>${cols.map(c => `<th>${c.t}</th>`).join('')}</tr></thead>
        <tbody>${linhas.map(l => `<tr>${cols.map(c => `<td>${esc(l[c.k])}</td>`).join('')}</tr>`).join('')
          || '<tr><td colspan="7" class="dica">Nenhuma cobrança no período.</td></tr>'}</tbody>
      </table>
    </div>
    <p class="dica">${linhas.length} cobrança(s) no período.</p>`;
}

// ── Log de atividade por empresa ──────────────────────────
async function renderAtividadeSA() {
  $('#sa-conteudo').innerHTML = '<p class="dica">Carregando…</p>';
  let lista;
  try { lista = await saApi('/atividade'); }
  catch (e) { $('#sa-conteudo').innerHTML = `<p class="erro">${e.message}</p>`; return; }

  const estadoBadge = est => ({
    ativa_uso: '<span class="badge ok">Em uso</span>',
    em_risco: '<span class="badge" style="background:#fff3cd;color:#856404">Em risco</span>',
    inativa_uso: '<span class="badge rep">Parou de usar</span>',
    nunca_emitiu: '<span class="badge">Nunca emitiu</span>',
    suspensa: '<span class="badge rep">Suspensa</span>',
    cancelada: '<span class="badge">Cancelada</span>'
  }[est] || est);

  const fmtData = d => d ? new Date(d).toLocaleDateString('pt-BR') : '—';

  const linhas = lista.map(e => `
    <tr onclick="abrirEmpresaSA('${e.id}')" style="cursor:pointer">
      <td><b>${esc(e.razao_social)}</b></td>
      <td>${estadoBadge(e.estado)}</td>
      <td>${fmtData(e.ultimo_certificado)}</td>
      <td class="num">${e.dias_sem_emitir != null ? e.dias_sem_emitir + ' dias' : '—'}</td>
      <td class="num">${e.certs_30d}</td>
      <td class="num">${e.certs_total}</td>
    </tr>`).join('');

  $('#sa-conteudo').innerHTML = `
    <div class="barra">
      <h2>📊 Atividade das empresas</h2>
      <div class="barra-btns"><button onclick="renderPainelSA()">← Empresas</button></div>
    </div>
    <p class="dica" style="margin-bottom:12px">Empresas ordenadas da menos ativa para a mais ativa —
      as do topo podem estar prestes a cancelar.</p>
    <div class="card">
      <div class="tabela-scroll">
        <table>
          <thead><tr><th>Empresa</th><th>Estado</th><th>Último certificado</th>
            <th>Sem emitir há</th><th>Emitidos (30d)</th><th>Total</th></tr></thead>
          <tbody>${linhas || '<tr><td colspan="6" class="dica">Nenhuma empresa.</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
}

function formNovaEmpresa() {
  const modal = `
    <div class="modal-fundo" onclick="if(event.target===this)this.remove()">
      <div class="modal-caixa" style="max-width:520px">
        <h3>Nova empresa</h3>
        <div class="form-grid">
          <label>Razão social * <input type="text" id="ne-razao"></label>
          <label>CNPJ * <input type="text" id="ne-cnpj"></label>
          <label>Subdomínio * <input type="text" id="ne-sub" placeholder="ex.: acme"></label>
          <label>Prefixo do certificado * <input type="text" id="ne-prefixo" placeholder="ex.: AC" maxlength="6"></label>
          <label>Plano
            <select id="ne-plano">
              <option value="trial">Trial</option>
              <option value="basico">Básico</option>
              <option value="profissional">Profissional</option>
              <option value="ilimitado">Ilimitado</option>
            </select></label>
          <label>Limite de usuários (0 = ilimitado) <input type="number" id="ne-limite" value="0"></label>
          <label>Nome do administrador * <input type="text" id="ne-anome"></label>
          <label>Email do administrador * <input type="email" id="ne-aemail"></label>
        </div>
        <p class="dica">O administrador receberá um convite por email para definir a senha.</p>
        <div class="rodape-acoes" style="margin-top:12px">
          <button onclick="this.closest('.modal-fundo').remove()">Cancelar</button>
          <button class="btn-primario" onclick="salvarNovaEmpresa()">Criar empresa</button>
        </div>
        <p id="ne-erro" class="erro"></p>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', modal);
}

async function salvarNovaEmpresa() {
  const corpo = {
    razaoSocial: $('#ne-razao').value.trim(), cnpj: $('#ne-cnpj').value.trim(),
    subdominio: $('#ne-sub').value.trim().toLowerCase(),
    prefixoCert: $('#ne-prefixo').value.trim().toUpperCase(),
    plano: $('#ne-plano').value, limiteUsuarios: Number($('#ne-limite').value) || 0,
    adminNome: $('#ne-anome').value.trim(), adminEmail: $('#ne-aemail').value.trim()
  };
  if (!corpo.razaoSocial || !corpo.cnpj || !corpo.subdominio || !corpo.prefixoCert
      || !corpo.adminNome || !corpo.adminEmail) {
    $('#ne-erro').textContent = 'Preencha todos os campos obrigatórios.'; return;
  }
  try {
    const r = await saApi('/empresas', { method: 'POST', body: JSON.stringify(corpo) });
    document.querySelector('.modal-fundo')?.remove();
    toast('Empresa criada. Convite enviado ao administrador.', 'ok', 6000);
    if (r.linkConvite) mostrarLinkConvite(r.linkConvite);
    renderPainelSA();
  } catch (e) { $('#ne-erro').textContent = e.message; }
}

// ── Servidor de e-mail (SMTP) — global do sistema, só super_admin ──
async function abrirSmtpSA() {
  $('#sa-conteudo').innerHTML = `
    <div class="barra">
      <h2>Servidor de e-mail (SMTP)</h2>
      <button onclick="renderPainelSA()">← Empresas</button>
    </div>
    <div class="card">
      <p class="dica">Configuração global do sistema. Usada em todos os envios:
        convites de usuário, certificados ao cliente e avisos.</p>
      <div class="form-grid">
        <label>Servidor (host) * <input type="text" id="smtp-host" placeholder="mail.suaempresa.com.br"></label>
        <label>Porta * <input type="number" id="smtp-port" placeholder="587"></label>
        <label>Usuário <input type="text" id="smtp-user" autocomplete="off"></label>
        <label>Senha <input type="password" id="smtp-pass" autocomplete="new-password"
          placeholder="deixe em branco para manter"></label>
        <label>E-mail remetente (from) <input type="email" id="smtp-from"
          placeholder="certificados@suaempresa.com.br"></label>
        <label>Nome do remetente <input type="text" id="smtp-nome"
          placeholder="Minas Balanças"></label>
      </div>
      <div class="rodape-acoes" style="margin-top:8px;gap:8px">
        <button class="btn-mini" onclick="testarSmtp()">✉️ Enviar e-mail de teste</button>
        <span style="flex:1"></span>
        <button class="btn-primario" onclick="salvarSmtp()">Salvar SMTP</button>
      </div>
      <p id="smtp-msg" class="dica"></p>
    </div>`;
  carregarSmtp();
}

async function abrirEmpresaSA(id) {
  $('#sa-conteudo').innerHTML = '<p class="dica">Carregando…</p>';
  let e, contratos, cobrancas, usuarios;
  try {
    [e, contratos, cobrancas, usuarios] = await Promise.all([
      saApi('/empresas/' + id),
      saApi('/empresas/' + id + '/contratos'),
      saApi('/empresas/' + id + '/cobrancas'),
      saApi('/empresas/' + id + '/usuarios')
    ]);
  } catch (err) { $('#sa-conteudo').innerHTML = `<p class="erro">${err.message}</p>`; return; }
  window._saEmpresaId = id;
  window._saCobrancas = cobrancas;

  const statusSel = ['ativa', 'suspensa', 'cancelada'].map(s =>
    `<option value="${s}" ${e.status === s ? 'selected' : ''}>${s}</option>`).join('');

  const cobStatus = s => ({
    pendente: '<span class="badge">Pendente</span>',
    pago: '<span class="badge ok">Pago</span>',
    vencido: '<span class="badge rep">Vencido</span>',
    cancelado: '<span class="badge">Cancelado</span>'
  }[s] || s);

  const linhasCob = cobrancas.map(c => `
    <tr>
      <td>${esc(c.contrato)}</td>
      <td>${dbrSA(c.competencia)}</td>
      <td>${dbrSA(c.vencimento)}</td>
      <td class="num">${brl(c.valor)}</td>
      <td>${cobStatus(c.status)}</td>
      <td style="white-space:nowrap">
        ${c.status !== 'pago'
          ? `<button class="btn-mini" onclick="marcarCobranca('${c.id}','pago')">✓ Pago</button>` : ''}
        ${c.status === 'pago'
          ? `<button class="btn-mini" onclick="marcarCobranca('${c.id}','pendente')">↩ Reabrir</button>` : ''}
        <button class="btn-mini" onclick="formEditarCobranca('${c.id}')">✏️ Editar</button>
        ${c.status !== 'cancelado' && c.status !== 'pago'
          ? `<button class="btn-mini" onclick="marcarCobranca('${c.id}','cancelado')">✖ Cancelar</button>` : ''}
        <button class="btn-mini" style="color:#b02a37" onclick="excluirCobrancaSA('${c.id}')">🗑</button>
      </td>
    </tr>`).join('');

  const papelLabel = { admin: 'Administrador', responsavel_tecnico: 'Resp. Técnico', tecnico: 'Técnico' };
  const linhasUsuarios = usuarios.map(u => `
    <tr>
      <td><b>${esc(u.nome)}</b></td>
      <td>${esc(u.email)}</td>
      <td>${papelLabel[u.papel] || u.papel}</td>
      <td>${u.ativo ? '<span class="badge ok">Ativo</span>' : '<span class="badge rep">Bloqueado</span>'}</td>
      <td>
        <button class="btn-mini" onclick="bloquearUsuarioSA('${u.id}', ${u.ativo ? 'false' : 'true'})">
          ${u.ativo ? '🔒 Bloquear' : '🔓 Reativar'}</button>
        <button class="btn-mini" style="color:#b02a37" onclick="excluirUsuarioSA('${u.id}','${esc(u.nome)}')">🗑 Excluir</button>
      </td>
    </tr>`).join('');

  const linhasContrato = contratos.map(c => `
    <tr>
      <td><b>${esc(c.descricao)}</b></td>
      <td class="num">${brl(c.valor)}</td>
      <td>${esc(c.periodicidade)}</td>
      <td>${dbrSA(c.inicio)}${c.fim ? ' → ' + dbrSA(c.fim) : ''}</td>
      <td><button class="btn-mini" onclick="formNovaCobranca('${c.id}','${esc(c.descricao)}',${c.valor})">+ Cobrança</button></td>
    </tr>`).join('');

  $('#sa-conteudo').innerHTML = `
    <div class="barra">
      <h2>${esc(e.razao_social)}</h2>
      <div class="barra-btns">
        <button onclick="reenviarConviteAdmin('${id}')">✉️ Convidar admin novamente</button>
        <button onclick="renderPainelSA()">← Empresas</button>
      </div>
    </div>

    <div class="cards-kpi" style="margin-bottom:16px">
      <div class="kpi"><span class="kpi-num">${e.qtd_usuarios}</span><span class="kpi-rotulo">Usuários</span></div>
      <div class="kpi"><span class="kpi-num">${e.qtd_certificados}</span><span class="kpi-rotulo">Certificados</span></div>
      <div class="kpi"><span class="kpi-num">${e.qtd_clientes}</span><span class="kpi-rotulo">Clientes</span></div>
      <div class="kpi"><span class="kpi-num">${e.qtd_balancas}</span><span class="kpi-rotulo">Balanças</span></div>
    </div>

    <div class="card">
      <h3>Dados e plano</h3>
      <div class="form-grid">
        <label>Razão social <input type="text" id="ed-razao" value="${esc(e.razao_social)}"></label>
        <label>CNPJ <input type="text" value="${esc(e.cnpj)}" disabled></label>
        <label>Subdomínio <input type="text" id="ed-subdominio" value="${esc(e.subdominio || '')}"></label>
        <label>Autorização Inmetro
          <input type="text" id="ed-autorizacao" value="${esc(e.num_autorizacao || '')}"></label>
        <label>Prefixo do certificado${e.qtd_certificados > 0 ? ' 🔒' : ''}
          <input type="text" id="ed-prefixo" value="${esc(e.prefixo_cert || '')}" maxlength="8"
            ${e.qtd_certificados > 0 ? 'disabled title="Bloqueado: a empresa já emitiu certificados"' : ''}></label>
        <label>Próximo número (só leitura)
          <input type="text" value="${e.proximo_numero ?? '—'}" disabled></label>
        <label>Plano
          <select id="ed-plano">
            ${['trial', 'basico', 'profissional', 'ilimitado'].map(p =>
              `<option value="${p}" ${e.plano === p ? 'selected' : ''}>${p}</option>`).join('')}
          </select></label>
        <label>Status <select id="ed-status">${statusSel}</select></label>
        <label>Limite de usuários (0 = ilimitado)
          <input type="number" id="ed-limite" value="${e.limite_usuarios}"></label>
        <label>Carência após fim do contrato (dias até o bloqueio)
          <input type="number" id="ed-carencia" min="0" value="${e.dias_carencia_contrato ?? 15}"></label>
        <label>Cadastrada em (só leitura)
          <input type="text" value="${e.criado_em ? new Date(e.criado_em).toLocaleDateString('pt-BR') : '—'}" disabled></label>
      </div>
      ${e.qtd_certificados > 0
        ? '<p class="dica">🔒 O prefixo fica bloqueado após a primeira emissão, para não misturar numerações. CNPJ e próximo número também não são editáveis.</p>'
        : '<p class="dica">⚠️ Defina o prefixo com cuidado: após a primeira emissão ele fica bloqueado.</p>'}
      <button class="btn-primario btn-mini" onclick="salvarEmpresaSA()">Salvar alterações</button>
      <p id="ed-msg" class="dica"></p>
    </div>

    <div class="card">
      <h3>Usuários cadastrados</h3>
      <div class="tabela-scroll">
        <table>
          <thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Status</th><th>Ações</th></tr></thead>
          <tbody>${linhasUsuarios || '<tr><td colspan="5" class="dica">Nenhum usuário cadastrado.</td></tr>'}</tbody>
        </table>
      </div>
      <p class="dica">O administrador não pode ser bloqueado ou excluído se for o único ativo da empresa.</p>
    </div>

    <div class="card">
      <div class="barra"><h3>Contratos de manutenção</h3>
        <button class="btn-mini" onclick="formNovoContrato()">+ Contrato</button></div>
      <div class="tabela-scroll">
        <table><thead><tr><th>Descrição</th><th>Valor</th><th>Periodicidade</th><th>Vigência</th><th></th></tr></thead>
          <tbody>${linhasContrato || '<tr><td colspan="5" class="dica">Nenhum contrato.</td></tr>'}</tbody></table>
      </div>
    </div>

    <div class="card">
      <h3>Cobranças</h3>
      <div class="tabela-scroll">
        <table><thead><tr><th>Contrato</th><th>Competência</th><th>Vencimento</th><th>Valor</th><th>Status</th><th></th></tr></thead>
          <tbody>${linhasCob || '<tr><td colspan="6" class="dica">Nenhuma cobrança.</td></tr>'}</tbody></table>
      </div>
    </div>`;
}

// Reenvia o convite ao admin da empresa (gera novo link de 7 dias)
async function reenviarConviteAdmin(id) {
  if (!await modalConfirmar('Reenviar o convite ao administrador desta empresa? '
      + 'Um novo e-mail será enviado com um link válido por 7 dias.')) return;
  try {
    const r = await saApi('/empresas/' + id + '/convite-admin', { method: 'POST' });
    toast(`Convite reenviado para ${r.nome} (${r.email}).`, 'ok');
  } catch (e) {
    toast(e.message || 'Não foi possível reenviar o convite.', 'erro');
  }
}

// Bloqueia ou reativa um usuário da empresa
async function bloquearUsuarioSA(id, ativar) {
  const acao = ativar ? 'reativar' : 'bloquear';
  if (!await modalConfirmar(`Deseja ${acao} este usuário?`)) return;
  try {
    await saApi('/usuarios/' + id + '/bloqueio',
      { method: 'PUT', body: JSON.stringify({ ativo: ativar }) });
    toast(`Usuário ${ativar ? 'reativado' : 'bloqueado'}.`, 'ok');
    abrirEmpresaSA(window._saEmpresaId);
  } catch (e) { toast(e.message, 'erro'); }
}

// Exclui um usuário da empresa (permanente)
async function excluirUsuarioSA(id, nome) {
  if (!await modalConfirmar(`Excluir permanentemente o usuário "${nome}"? `
      + 'Esta ação não pode ser desfeita. Se preferir, bloqueie em vez de excluir.')) return;
  try {
    await saApi('/usuarios/' + id, { method: 'DELETE' });
    toast('Usuário excluído.', 'ok');
    abrirEmpresaSA(window._saEmpresaId);
  } catch (e) { toast(e.message, 'erro'); }
}

async function salvarEmpresaSA() {
  const id = window._saEmpresaId;
  try {
    const prefixoEl = $('#ed-prefixo');
    await saApi('/empresas/' + id, { method: 'PUT', body: JSON.stringify({
      razaoSocial: $('#ed-razao').value.trim(),
      plano: $('#ed-plano').value,
      status: $('#ed-status').value,
      limiteUsuarios: Number($('#ed-limite').value) || 0,
      subdominio: $('#ed-subdominio').value.trim(),
      numAutorizacao: $('#ed-autorizacao').value.trim(),
      // prefixo só é enviado quando editável (empresa ainda sem certificados)
      prefixoCert: prefixoEl.disabled ? null : prefixoEl.value.trim().toUpperCase(),
      carencia: Number($('#ed-carencia').value)
    })});
    $('#ed-msg').textContent = '✅ Salvo.';
    $('#ed-msg').style.color = '#146c43';
    toast('Empresa atualizada.', 'ok');
  } catch (e) { $('#ed-msg').textContent = e.message; $('#ed-msg').style.color = '#b02a37'; }
}

function formNovoContrato() {
  const modal = `
    <div class="modal-fundo" onclick="if(event.target===this)this.remove()">
      <div class="modal-caixa" style="max-width:480px">
        <h3>Novo contrato</h3>
        <div class="form-grid">
          <label>Descrição * <input type="text" id="nc-desc" placeholder="Ex.: Manutenção mensal"></label>
          <label>Valor (R$) * <input type="number" step="0.01" id="nc-valor"></label>
          <label>Periodicidade
            <select id="nc-per">
              <option value="mensal">Mensal</option>
              <option value="trimestral">Trimestral</option>
              <option value="semestral">Semestral</option>
              <option value="anual">Anual</option>
              <option value="avulso">Avulso</option>
            </select></label>
          <label>Início * <input type="date" id="nc-inicio"></label>
          <label>Fim (opcional) <input type="date" id="nc-fim"></label>
        </div>
        <label>Observação <textarea id="nc-obs" rows="2"></textarea></label>
        <div class="rodape-acoes" style="margin-top:10px">
          <button onclick="this.closest('.modal-fundo').remove()">Cancelar</button>
          <button class="btn-primario" onclick="salvarContrato()">Criar</button>
        </div>
        <p id="nc-erro" class="erro"></p>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', modal);
}

async function salvarContrato() {
  const corpo = {
    descricao: $('#nc-desc').value.trim(),
    valor: Number($('#nc-valor').value),
    periodicidade: $('#nc-per').value,
    inicio: $('#nc-inicio').value || null,
    fim: $('#nc-fim').value || null,
    observacao: $('#nc-obs').value.trim() || null
  };
  if (!corpo.descricao || !corpo.valor || !corpo.inicio) {
    $('#nc-erro').textContent = 'Descrição, valor e início são obrigatórios.'; return;
  }
  try {
    await saApi('/empresas/' + window._saEmpresaId + '/contratos',
      { method: 'POST', body: JSON.stringify(corpo) });
    document.querySelector('.modal-fundo')?.remove();
    toast('Contrato criado.', 'ok');
    abrirEmpresaSA(window._saEmpresaId);
  } catch (e) { $('#nc-erro').textContent = e.message; }
}

function formNovaCobranca(contratoId, desc, valor) {
  const hoje = new Date().toISOString().substring(0, 10);
  const modal = `
    <div class="modal-fundo" onclick="if(event.target===this)this.remove()">
      <div class="modal-caixa" style="max-width:440px">
        <h3>Nova cobrança</h3>
        <p class="dica">Contrato: ${esc(desc)}</p>
        <div class="form-grid">
          <label>Competência (mês ref.) * <input type="date" id="cb-comp" value="${hoje}"></label>
          <label>Vencimento * <input type="date" id="cb-venc" value="${hoje}"></label>
          <label>Valor (R$) * <input type="number" step="0.01" id="cb-valor" value="${valor}"></label>
        </div>
        <label>Observação <input type="text" id="cb-obs"></label>
        <div class="rodape-acoes" style="margin-top:10px">
          <button onclick="this.closest('.modal-fundo').remove()">Cancelar</button>
          <button class="btn-primario" onclick="salvarCobranca('${contratoId}')">Criar</button>
        </div>
        <p id="cb-erro" class="erro"></p>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', modal);
}

async function salvarCobranca(contratoId) {
  const corpo = {
    contratoId,
    competencia: $('#cb-comp').value || null,
    vencimento: $('#cb-venc').value || null,
    valor: Number($('#cb-valor').value),
    observacao: $('#cb-obs').value.trim() || null
  };
  if (!corpo.competencia || !corpo.vencimento || !corpo.valor) {
    $('#cb-erro').textContent = 'Competência, vencimento e valor são obrigatórios.'; return;
  }
  try {
    await saApi('/cobrancas', { method: 'POST', body: JSON.stringify(corpo) });
    document.querySelector('.modal-fundo')?.remove();
    toast('Cobrança criada.', 'ok');
    abrirEmpresaSA(window._saEmpresaId);
  } catch (e) { $('#cb-erro').textContent = e.message; }
}

async function marcarCobranca(id, status) {
  try {
    await saApi('/cobrancas/' + id, { method: 'PUT', body: JSON.stringify({ status }) });
    toast(status === 'pago' ? 'Marcada como paga.'
        : status === 'cancelado' ? 'Cobrança cancelada.' : 'Cobrança reaberta.', 'ok');
    abrirEmpresaSA(window._saEmpresaId);
  } catch (e) { toast(e.message, 'erro'); }
}

// Modal de edição de cobrança (corrigir valor, datas, observação)
function formEditarCobranca(id) {
  const c = (window._saCobrancas || []).find(x => x.id === id);
  if (!c) { toast('Cobrança não encontrada.', 'erro'); return; }
  const iso = d => d ? String(d).slice(0, 10) : '';
  const modal = `
    <div class="modal-fundo" onclick="if(event.target===this)this.remove()">
      <div class="modal-caixa" style="max-width:480px">
        <h3>Editar cobrança</h3>
        <p class="dica">${esc(c.contrato)} · status atual: ${esc(c.status)}</p>
        <div class="form-grid">
          <label>Competência <input type="date" id="ec-comp" value="${iso(c.competencia)}"></label>
          <label>Vencimento <input type="date" id="ec-venc" value="${iso(c.vencimento)}"></label>
          <label>Valor (R$) <input type="number" step="0.01" id="ec-valor" value="${c.valor}"></label>
        </div>
        <label>Observação <textarea id="ec-obs" rows="2">${esc(c.observacao || '')}</textarea></label>
        <div class="rodape-acoes" style="margin-top:10px">
          <button onclick="this.closest('.modal-fundo').remove()">Cancelar</button>
          <button class="btn-primario" onclick="salvarEdicaoCobranca('${id}')">Salvar</button>
        </div>
        <p id="ec-erro" class="erro"></p>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', modal);
}

async function salvarEdicaoCobranca(id) {
  const corpo = {
    competencia: $('#ec-comp').value || null,
    vencimento: $('#ec-venc').value || null,
    valor: Number($('#ec-valor').value) || null,
    observacao: $('#ec-obs').value.trim() || null
  };
  if (!corpo.competencia || !corpo.vencimento || !corpo.valor) {
    $('#ec-erro').textContent = 'Competência, vencimento e valor são obrigatórios.'; return;
  }
  try {
    await saApi('/cobrancas/' + id + '/dados', { method: 'PUT', body: JSON.stringify(corpo) });
    document.querySelector('.modal-fundo')?.remove();
    toast('Cobrança atualizada.', 'ok');
    abrirEmpresaSA(window._saEmpresaId);
  } catch (e) { $('#ec-erro').textContent = e.message; }
}

// Exclui uma cobrança lançada por engano
async function excluirCobrancaSA(id) {
  if (!await modalConfirmar('Excluir esta cobrança permanentemente? '
      + 'Use apenas para lançamentos criados por engano — para desconsiderar '
      + 'uma cobrança legítima, prefira "Cancelar".')) return;
  try {
    await saApi('/cobrancas/' + id, { method: 'DELETE' });
    toast('Cobrança excluída.', 'ok');
    abrirEmpresaSA(window._saEmpresaId);
  } catch (e) { toast(e.message, 'erro'); }
}

function irCadastros() {
  mostrar('tela-cadastros');
  const soAdmin = usuario.papel === 'admin' ? '' : 'none';
  $('#tab-usuarios').style.display = soAdmin;
  $('#tab-config').style.display = soAdmin;
  abrirTab('clientes');
}

function abrirTab(tab) {
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('tab-ativo', t.dataset.tab === tab));
  ({ clientes: renderClientes, pesos: renderPesos, tipos: renderTipos,
     usuarios: renderUsuarios, config: renderConfig }[tab])();
}

const campo = (rotulo, id, tipo = 'text', valor = '', extra = '') =>
  `<label>${rotulo}<input type="${tipo}" id="${id}" value="${esc(valor)}" ${extra}></label>`;

// ── Clientes ────────────────────────────────────────────────────
let clientesListaCache = [];

async function renderClientes() {
  const cs = await api('/clientes?incluirInativos=true');
  clientesListaCache = cs;
  $('#cad-conteudo').innerHTML = `
    <div class="card">
      <div class="barra"><h3>Clientes</h3>
        ${ehGestor() ? '<button class="btn-primario btn-mini" onclick="formCliente()">+ Novo</button>' : ''}</div>
      <div id="form-area"></div>
      ${cs.length === 0 ? '' : `
        <input type="text" class="filtro-hist" placeholder="🔍 Buscar cliente por nome, CNPJ ou cidade..."
               oninput="filtrarClientesLista(this.value)">`}
      <div id="clientes-lista">${htmlClientes(cs)}</div>
    </div>`;
}

function htmlClientes(lista) {
  if (lista.length === 0) return '<p class="dica">Nenhum cliente encontrado.</p>';
  return lista.map(c => `
    <div class="item-cert">
      <span onclick="detalheCliente('${c.id}')" style="cursor:pointer">
        <b>${esc(c.razao_social)}</b>
        ${c.ativo ? '' : '<span class="badge rep">inativo</span>'}<br>
        <span class="dica">${esc(c.cidade || '')} ${esc(c.uf || '')} ${c.cnpj ? '· CNPJ ' + esc(c.cnpj) : ''}</span>
      </span>
      <span class="acoes">
        <button class="btn-mini" onclick="detalheCliente('${c.id}')">Balanças ➜</button>
      </span>
    </div>`).join('');
}

function filtrarClientesLista(termo) {
  const t = (termo || '').toLowerCase().trim();
  const filt = !t ? clientesListaCache : clientesListaCache.filter(c =>
    (c.razao_social || '').toLowerCase().includes(t) ||
    (c.cnpj || '').toLowerCase().includes(t) ||
    (c.cidade || '').toLowerCase().includes(t));
  $('#clientes-lista').innerHTML = htmlClientes(filt);
}

function formCliente(c = null) {
  $('#form-area').innerHTML = `
    <div class="subcard">
      <h4>${c ? 'Editar cliente' : 'Novo cliente'}</h4>
      <div class="form-grid">
        ${campo('Razão social *', 'f-razao', 'text', c?.razao_social)}
        ${campo('CNPJ', 'f-cnpj', 'text', c?.cnpj, 'inputmode="numeric"')}
        ${campo('Email', 'f-email', 'email', c?.email)}
        ${campo('Telefone', 'f-fone', 'text', c?.telefone)}
        ${campo('Cidade', 'f-cidade', 'text', c?.cidade)}
        ${campo('UF', 'f-uf', 'text', c?.uf, 'maxlength="2"')}
      </div>
      ${campo('Endereço', 'f-end', 'text', c?.endereco)}
      <div class="rodape-acoes">
        <button onclick="renderClientes()">Cancelar</button>
        <button class="btn-primario" onclick="salvarCliente('${c?.id || ''}')">Salvar</button>
      </div>
      ${c ? `<button class="btn-mini btn-vinho" onclick="toggleAtivo('clientes','${c.id}',${!c.ativo},renderClientes)">
        ${c.ativo ? 'Inativar cliente' : 'Reativar cliente'}</button>` : ''}
      <p id="f-erro" class="erro"></p>
    </div>`;
}

async function salvarCliente(id) {
  const corpo = {
    razaoSocial: $('#f-razao').value, cnpj: $('#f-cnpj').value || null,
    email: $('#f-email').value || null, telefone: $('#f-fone').value || null,
    cidade: $('#f-cidade').value || null, uf: $('#f-uf').value || null,
    endereco: $('#f-end').value || null
  };
  try {
    await api('/clientes' + (id ? '/' + id : ''), {
      method: id ? 'PUT' : 'POST', body: JSON.stringify(corpo) });
    renderClientes();
  } catch (e) { $('#f-erro').textContent = e.message; }
}

async function toggleAtivo(rota, id, ativo, depois) {
  await api(`/${rota}/${id}/ativo`, { method: 'PUT',
    body: JSON.stringify({ ativo }) });
  depois();
}

// ── Cliente: detalhe + balanças ─────────────────────────────────
let balancasCache = [];

function htmlBalancas(lista, clienteId) {
  if (lista.length === 0) return '<p class="dica">Nenhuma balança corresponde ao filtro.</p>';
  return lista.map(b => `
    <div class="item-cert">
      <span><b>${esc(b.identificacao)}</b>${b.num_serie ? ' · Série ' + esc(b.num_serie) : ''}
        ${b.ativa ? '' : '<span class="badge rep">inativa</span>'}<br>
        <span class="dica">${esc(b.marca || '')} ${esc(b.modelo || '')} ·
          ${fmt(b.capacidade)} kg · e=${fmt(b.divisao_e)} · Classe ${b.classe_exatidao}</span>
      </span>
      <span class="acoes">
        <button class="btn-mini"
          onclick='formBalanca("${clienteId}", ${JSON.stringify(b)})'>✏️</button>
      </span>
    </div>`).join('');
}

function filtrarBalancas(clienteId, termo) {
  const t = (termo || '').toLowerCase().trim();
  const filt = !t ? balancasCache : balancasCache.filter(b =>
    (b.identificacao || '').toLowerCase().includes(t) ||
    (b.num_serie || '').toLowerCase().includes(t) ||
    (b.marca || '').toLowerCase().includes(t) ||
    (b.modelo || '').toLowerCase().includes(t));
  $('#balancas-lista').innerHTML = htmlBalancas(filt, clienteId);
}

async function detalheCliente(id) {
  const c = await api('/clientes/' + id);
  const bs = await api(`/clientes/${id}/balancas`);
  const hist = await api(`/clientes/${id}/certificados`);
  balancasCache = bs;
  $('#cad-conteudo').innerHTML = `
    <div class="card">
      <div class="barra">
        <h3>${esc(c.razao_social)}</h3>
        <div class="barra-btns">
          <button class="btn-mini" onclick="renderClientes()">← Clientes</button>
          ${ehGestor() ? `<button class="btn-mini" onclick="detalheClienteEditar('${id}')">✏️ Editar</button>` : ''}
        </div>
      </div>
      <p class="dica">${esc(c.cidade || '')} ${esc(c.uf || '')}
        ${c.cnpj ? '· CNPJ ' + esc(c.cnpj) : ''} ${c.email ? '· ' + esc(c.email) : ''}</p>
      <div id="form-area"></div>
      <div class="barra" style="margin-top:14px"><h4>Balanças</h4>
        <button class="btn-primario btn-mini" onclick="formBalanca('${id}')">+ Nova balança</button></div>
      ${bs.length === 0 ? '<p class="dica">Nenhuma balança.</p>' : `
        <input type="text" class="filtro-hist" placeholder="🔍 Buscar balança por identificação, série, marca ou modelo..."
               oninput="filtrarBalancas('${id}', this.value)">
        <div id="balancas-lista">${htmlBalancas(bs, id)}</div>`}

      <h4 style="margin-top:18px">Histórico de calibrações</h4>
      ${hist.length === 0 ? '<p class="dica">Nenhuma calibração registrada.</p>' : `
        <input type="text" class="filtro-hist" placeholder="Filtrar por balança ou série..."
               oninput="filtrarHistorico(this.value)">
        <div id="hist-lista">${htmlHistorico(hist)}</div>`}
    </div>`;
  histClienteCache = hist;
}

let histClienteCache = [];

function htmlHistorico(lista) {
  if (lista.length === 0)
    return '<p class="dica">Nenhuma calibração corresponde ao filtro.</p>';
  return lista.map(h => `
    <div class="item-cert ${h.status === 'emitido' ? 'clicavel' : ''}"
         ${h.status === 'emitido' ? `onclick="abrirPdfCertificado('${h.id}')"` : ''}>
      <span>
        <b>${h.numero || '(sem número)'}</b> · ${esc(h.balanca)}${h.num_serie ? ' · Série ' + esc(h.num_serie) : ''}
        <span class="st st-${h.status}">${rotuloStatus(h.status)}</span><br>
        <span class="dica">
          ${h.data_calibracao ? 'Calibração: ' + new Date(h.data_calibracao).toLocaleDateString('pt-BR') : ''}
          ${h.data_emissao ? ' · Emitido: ' + new Date(h.data_emissao).toLocaleDateString('pt-BR') : ''}
          · Téc.: ${esc(h.tecnico)}</span>
      </span>
      ${h.status === 'emitido' ? '<span class="acoes"><button class="btn-mini">📄 PDF</button></span>' : ''}
    </div>`).join('');
}

function filtrarHistorico(termo) {
  const t = (termo || '').toLowerCase().trim();
  const filt = !t ? histClienteCache : histClienteCache.filter(h =>
    (h.balanca || '').toLowerCase().includes(t) ||
    (h.num_serie || '').toLowerCase().includes(t) ||
    (h.numero || '').toLowerCase().includes(t));
  $('#hist-lista').innerHTML = htmlHistorico(filt);
}

async function detalheClienteEditar(id) {
  const c = await api('/clientes/' + id);
  formCliente(c);
  window.scrollTo(0, 0);
}

const TIPOS = ['rodoviaria', 'plataforma', 'bancada', 'suspensa', 'ferroviaria', 'outra'];
const CLASSES = ['I', 'II', 'III', 'IIII'];

async function formBalanca(clienteId, b = null) {
  const sel = (ops, atual) => ops.map(o =>
    `<option value="${o}" ${o === atual ? 'selected' : ''}>${o}</option>`).join('');
  const selUnid = (atual) => ['g', 'kg', 't'].map(o =>
    `<option value="${o}" ${o === (atual || 'kg') ? 'selected' : ''}>${o}</option>`).join('');
  // Carrega os tipos cadastrados desta empresa
  let tipos = [];
  try { tipos = await api('/tipos-balanca'); } catch (e) { tipos = []; }
  const nomesTipos = tipos.map(t => t.nome);
  const tipoAtual = b?.tipo || (nomesTipos[0] || '');
  const optsTipo = nomesTipos.length
    ? nomesTipos.map(n => `<option value="${esc(n)}" ${n === tipoAtual ? 'selected' : ''}>${esc(n)}</option>`).join('')
    : '<option value="">— cadastre tipos em Cadastros › Tipos —</option>';
  $('#form-area').innerHTML = `
    <div class="subcard">
      <h4>${b ? 'Editar balança ' + esc(b.identificacao) : 'Nova balança'}</h4>
      <div class="form-grid">
        ${campo('Identificação *', 'b-id', 'text', b?.identificacao)}
        <label>Tipo *<select id="b-tipo" onchange="sugerirClasse()">${optsTipo}</select></label>
        ${campo('Marca', 'b-marca', 'text', b?.marca)}
        ${campo('Modelo', 'b-modelo', 'text', b?.modelo)}
        ${campo('Nº de série', 'b-serie', 'text', b?.num_serie)}
        ${campo('Número do Inmetro', 'b-inmetro', 'text', b?.numero_inmetro)}
        ${campo('Patrimônio', 'b-patrimonio', 'text', b?.patrimonio)}
        ${campo('Portaria de aprovação', 'b-portaria', 'text', b?.portaria_aprovacao)}
        <label>Unidade *<select id="b-unid" onchange="sugerirClasse()">${selUnid(b?.unidade)}</select></label>
        ${campo('Capacidade *', 'b-cap', 'number', b?.capacidade, 'step="any" inputmode="decimal" oninput="sugerirClasse()"')}
        ${campo('Divisão e *', 'b-e', 'number', b?.divisao_e, 'step="any" inputmode="decimal" oninput="sugerirClasse()"')}
        ${campo('Divisão d', 'b-d', 'number', b?.divisao_d ?? '', 'step="any" inputmode="decimal"')}
        <label>Classe *<select id="b-classe" onchange="this.dataset.editadoManual=1;sugerirClasse()">${sel(CLASSES, b?.classe_exatidao || 'III')}</select></label>
        ${campo('Periodicidade (meses)', 'b-per', 'number', b?.periodicidade_meses ?? 12)}
      </div>
      <p id="b-classe-dica" class="dica"></p>
      ${campo('Local de instalação', 'b-local', 'text', b?.local_instalacao)}
      <div class="rodape-acoes">
        <button onclick="detalheCliente('${clienteId}')">Cancelar</button>
        <button class="btn-primario"
          onclick="salvarBalanca('${clienteId}','${b?.id || ''}')">Salvar</button>
      </div>
      ${b ? `<button class="btn-mini btn-vinho"
        onclick="toggleAtivo('balancas','${b.id}',${!b.ativa},()=>detalheCliente('${clienteId}'))">
        ${b.ativa ? 'Inativar balança' : 'Reativar balança'}</button>` : ''}
      <p id="f-erro" class="erro"></p>
    </div>`;
  window.scrollTo(0, 0);
  sugerirClasse();
}

// Sugere a classe pela Portaria 236/94 conforme capacidade/divisão/tipo
let timerClasse = null;
function sugerirClasse() {
  clearTimeout(timerClasse);
  timerClasse = setTimeout(async () => {
    const cap = Number($('#b-cap')?.value), e = Number($('#b-e')?.value);
    const dica = $('#b-classe-dica');
    if (!dica || !cap || !e) { if (dica) dica.textContent = ''; return; }
    try {
      const r = await api('/balancas/sugerir-classe', { method: 'POST',
        body: JSON.stringify({ capacidade: cap, divisaoE: e,
          unidade: $('#b-unid').value, tipo: $('#b-tipo').value,
          classeEscolhida: $('#b-classe').value }) });

      // Preenche o campo Classe automaticamente com a classe calculada,
      // mas só se o usuário ainda não tiver alterado manualmente
      const selClasse = $('#b-classe');
      if (selClasse && !selClasse.dataset.editadoManual && r.sugerida) {
        selClasse.value = r.sugerida;
      }

      if (r.alerta) {
        dica.innerHTML = '⚠️ ' + esc(r.alerta);
        dica.style.color = '#b02a37';
      } else {
        dica.innerHTML = `Classe <b>${r.sugerida}</b> calculada automaticamente ` +
          `(n = ${r.numeroDivisoes.toLocaleString('pt-BR')} divisões)` +
          (r.classesCompativeis.length > 1 ? ` · também compatível: ${r.classesCompativeis.filter(x => x !== r.sugerida).join(', ')}` : '') +
          ` — ajuste se a placa indicar outra.`;
        dica.style.color = '#146c43';
      }
    } catch (e) { dica.textContent = ''; }
  }, 400);
}

async function salvarBalanca(clienteId, id) {
  const num = s => s === '' ? null : Number(s);
  const corpo = {
    identificacao: $('#b-id').value, tipo: $('#b-tipo').value,
    marca: $('#b-marca').value || null, modelo: $('#b-modelo').value || null,
    numSerie: $('#b-serie').value || null,
    unidade: $('#b-unid').value,
    capacidade: num($('#b-cap').value) ?? 0,
    divisaoE: num($('#b-e').value) ?? 0, divisaoD: num($('#b-d').value),
    classeExatidao: $('#b-classe').value,
    localInstalacao: $('#b-local').value || null,
    numeroInmetro: $('#b-inmetro').value || null,
    portariaAprovacao: $('#b-portaria').value || null,
    patrimonio: $('#b-patrimonio').value || null,
    periodicidadeMeses: num($('#b-per').value) ?? 12
  };
  try {
    await api(id ? '/balancas/' + id : `/clientes/${clienteId}/balancas`, {
      method: id ? 'PUT' : 'POST', body: JSON.stringify(corpo) });
    detalheCliente(clienteId);
  } catch (e) { $('#f-erro').textContent = e.message; }
}

// ── Pesos padrão ────────────────────────────────────────────────
const CLASSES_PESO = ['E1', 'E2', 'F1', 'F2', 'M1', 'M2', 'M3'];

async function renderPesos() {
  const ps = await api('/pesos');
  const admin = ehGestor();
  $('#cad-conteudo').innerHTML = `
    <div class="card">
      <div class="barra"><h3>Pesos padrão</h3>
        ${admin ? '<button class="btn-primario btn-mini" onclick="formPeso()">+ Novo</button>' : ''}</div>
      ${admin ? '' : '<p class="dica">Somente o administrador cadastra pesos.</p>'}
      <div id="form-area"></div>
      ${ps.length === 0 ? '<p class="dica">Nenhum peso cadastrado.</p>' : ps.map(p => `
        <div class="item-cert">
          <span><b>${esc(p.identificacao)}</b> · ${fmt(p.valor_nominal)} ${p.unidade || 'kg'} · ${esc(p.classe)}
            ${p.ativo ? '' : '<span class="badge rep">inativo</span>'}<br>
            <span class="dica">Validade ${p.validade}
              ${p.status_validade === 'vencido' ? '<span class="badge rep">VENCIDO</span>'
                : p.status_validade === 'vencendo' ? '<span class="badge aviso">vence em breve</span>'
                : '<span class="badge ok">ok</span>'}</span>
          </span>
          ${admin ? `<span class="acoes">
            ${p.certificado_pdf_url
              ? `<button class="btn-mini" onclick="verCertPeso('${p.id}')" title="Ver certificado">📄</button>`
              : ''}
            <button class="btn-mini" onclick="anexarCertPeso('${p.id}')" title="Anexar certificado PDF">📎</button>
            <button class="btn-mini" onclick='formPeso(${JSON.stringify(p)})'>✏️</button>
          </span>` : ''}
        </div>`).join('')}
    </div>`;
}

function formPeso(p = null) {
  const sel = CLASSES_PESO.map(o =>
    `<option value="${o}" ${o === (p?.classe || 'M1') ? 'selected' : ''}>${o}</option>`).join('');
  const selUnid = ['g', 'kg', 't'].map(o =>
    `<option value="${o}" ${o === (p?.unidade || 'kg') ? 'selected' : ''}>${o}</option>`).join('');
  $('#form-area').innerHTML = `
    <div class="subcard">
      <h4>${p ? 'Editar peso ' + esc(p.identificacao) : 'Novo peso padrão'}</h4>
      <div class="form-grid">
        ${campo('Identificação *', 'p-id', 'text', p?.identificacao)}
        ${campo('Valor nominal *', 'p-valor', 'number', p?.valor_nominal, 'step="any" inputmode="decimal"')}
        <label>Unidade *<select id="p-unid">${selUnid}</select></label>
        <label>Classe *<select id="p-classe">${sel}</select></label>
        ${campo('Data de calibração', 'p-datacal', 'date', p?.data_calibracao ? String(p.data_calibracao).slice(0,10) : '')}
        ${campo('Validade do certificado *', 'p-val', 'date', p?.validade ? String(p.validade).slice(0,10) : '')}
        ${campo('Nº certificado do peso', 'p-cert', 'text', p?.num_certificado)}
        ${campo('Laboratório', 'p-lab', 'text', p?.laboratorio)}
      </div>
      ${p ? `<div class="anexo-area">
        <label>Certificado do peso (PDF)</label>
        ${p.certificado_pdf_url
          ? `<button type="button" class="btn-mini" onclick="verCertPeso('${p.id}')">📄 Ver certificado anexado</button>
             <button type="button" class="btn-mini" onclick="anexarCertPeso('${p.id}')">🔄 Substituir</button>`
          : `<button type="button" class="btn-mini" onclick="anexarCertPeso('${p.id}')">📎 Anexar PDF</button>`}
      </div>`
        : '<p class="dica">💡 Salve o peso primeiro; depois você poderá anexar o PDF do certificado dele.</p>'}
      <div class="rodape-acoes">
        <button onclick="renderPesos()">Cancelar</button>
        <button class="btn-primario" onclick="salvarPeso('${p?.id || ''}')">Salvar</button>
      </div>
      ${p ? `<button class="btn-mini btn-vinho"
        onclick="toggleAtivo('pesos','${p.id}',${!p.ativo},renderPesos)">
        ${p.ativo ? 'Inativar peso' : 'Reativar peso'}</button>` : ''}
      <p id="f-erro" class="erro"></p>
    </div>`;
}

async function salvarPeso(id) {
  const corpo = {
    identificacao: $('#p-id').value,
    valorNominal: Number($('#p-valor').value || 0),
    unidade: $('#p-unid').value,
    classe: $('#p-classe').value,
    dataCalibracao: $('#p-datacal').value || null,
    validade: $('#p-val').value,
    numCertificado: $('#p-cert').value || null,
    laboratorio: $('#p-lab').value || null
  };
  try {
    await api('/pesos' + (id ? '/' + id : ''), {
      method: id ? 'PUT' : 'POST', body: JSON.stringify(corpo) });
    renderPesos();
  } catch (e) { $('#f-erro').textContent = e.message; }
}

// Anexar o certificado PDF do peso (input file oculto criado na hora)
function anexarCertPeso(id) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'application/pdf,.pdf';
  inp.onchange = async () => {
    const arq = inp.files[0];
    if (!arq) return;
    if (arq.size > 15 * 1024 * 1024) { toast('Arquivo maior que 15 MB.', 'erro'); return; }
    const fd = new FormData();
    fd.append('arquivo', arq);
    try {
      const r = await fetch('/api/pesos/' + id + '/certificado', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
        body: fd
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.erro || ('Erro ' + r.status));
      }
      toast('Certificado anexado com sucesso.', 'ok');
      renderPesos();
    } catch (e) { toast('Falha no upload: ' + e.message, 'erro'); }
  };
  inp.click();
}

// Lista os pesos padrão de um certificado emitido e oferece os
// certificados de rastreabilidade para o gestor baixar/enviar ao cliente
async function baixarCertsPesos(id) {
  let pesos;
  try { pesos = await api('/certificados/' + id + '/pesos'); }
  catch (e) { toast('Erro ao buscar os pesos: ' + e.message, 'erro'); return; }
  if (!pesos || pesos.length === 0) {
    toast('Nenhum peso padrão vinculado a este certificado.', 'aviso'); return;
  }
  const linhas = pesos.map(p => {
    const rot = `${esc(p.identificacao)} · ${fmt(p.valor_nominal)} · ${esc(p.classe)}`;
    return p.tem_pdf
      ? `<button class="btn-mini" style="width:100%;text-align:left;margin-bottom:6px"
           onclick="verCertPeso('${p.id}')">📄 ${rot}</button>`
      : `<div class="dica" style="margin-bottom:6px">⚠️ ${rot} — sem certificado anexado</div>`;
  }).join('');
  const semPdf = pesos.filter(p => !p.tem_pdf).length;
  const modal = `
    <div class="modal-fundo" onclick="if(event.target===this)this.remove()">
      <div class="modal-caixa">
        <h3>⚖️ Certificados dos pesos padrão</h3>
        <p class="dica">Certificados de rastreabilidade dos pesos usados nesta calibração.
          Toque para abrir/baixar cada um.</p>
        ${linhas}
        ${semPdf > 0 ? `<p class="dica" style="color:#a06b00">${semPdf} peso(s) sem certificado anexado — anexe em Cadastros › Pesos padrão.</p>` : ''}
        <div class="rodape-acoes" style="margin-top:10px">
          <button onclick="this.closest('.modal-fundo').remove()">Fechar</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', modal);
}

function verCertPeso(id) {
  // abre o PDF autenticado numa nova aba via fetch->blob (mantém o token)
  fetch('/api/pesos/' + id + '/certificado', {
    headers: { Authorization: 'Bearer ' + token }
  }).then(r => {
    if (!r.ok) throw new Error('Não encontrado');
    return r.blob();
  }).then(b => window.open(URL.createObjectURL(b), '_blank'))
    .catch(e => alert('Erro ao abrir: ' + e.message));
}

// ── Configurações da empresa ────────────────────────────────────
async function renderConfig() {
  const c = await api('/empresa/config');
  const sim = (v) => v ? 'checked' : '';
  const selRep = [1, 3, 5, 10].map(n =>
    `<option value="${n}" ${n === c.num_repeticoes ? 'selected' : ''}>${n}</option>`).join('');
  $('#cad-conteudo').innerHTML = `
    <div class="card">
      <h3>Dados do emissor (aparecem no certificado)</h3>
      <div class="form-grid">
        ${campo('Razão social *', 'cf-razao', 'text', c.razao_social)}
        ${campo('Endereço', 'cf-end', 'text', c.endereco)}
        ${campo('Cidade / UF', 'cf-ciduf', 'text', c.cidade_uf)}
        ${campo('Telefone', 'cf-fone', 'text', c.telefone)}
        ${campo('Email', 'cf-email', 'email', c.email)}
      </div>
      <label>Texto de autorização (linha livre no cabeçalho, ex.: "Autorização Inmetro nº 20000077")
        <input type="text" id="cf-autoriz-txt" value="${esc(c.texto_autorizacao || '')}"></label>
      ${campo('Título do documento', 'cf-titulo', 'text', c.titulo_documento)}
      <label>Método / procedimento (texto no certificado)
        <textarea id="cf-metodo" rows="2">${esc(c.metodo_calibracao || '')}</textarea></label>
      <label>Texto de periodicidade
        <textarea id="cf-period" rows="2">${esc(c.texto_periodicidade || '')}</textarea></label>
      <label>Texto de rodapé
        <textarea id="cf-rodape" rows="2">${esc(c.texto_rodape || '')}</textarea></label>
    </div>

    <div class="card">
      <h3>Identidade visual do certificado</h3>
      <div class="form-grid">
        <label>Cor da marca (cabeçalho e títulos)
          <input type="color" id="cf-cor" value="${c.cor_marca || '#0d3b2e'}" style="height:42px;padding:2px">
        </label>
        <label>Logotipo (PNG ou JPG, até 2 MB)
          <input type="file" id="cf-logo" accept="image/png,image/jpeg">
        </label>
      </div>
      <div id="cf-logo-preview">
        ${c.logo_url ? '<span class="dica">Carregando logo...</span>' : '<span class="dica">Nenhum logo enviado ainda.</span>'}
      </div>
      <button class="btn-mini" onclick="enviarLogo()">Enviar logo</button>
      <p id="cf-logo-msg" class="dica"></p>
    </div>

    <div class="card">
      <h3>Parâmetros do ensaio (como a empresa trabalha)</h3>
      <label class="chk"><input type="checkbox" id="cf-exc" ${sim(c.usa_excentricidade)}>
        Realizar ensaio de excentricidade</label>
      <label class="chk"><input type="checkbox" id="cf-rep" ${sim(c.usa_repetibilidade)}>
        Realizar ensaio de repetibilidade</label>
      <div class="form-grid" style="margin-top:8px">
        <label>Nº de leituras da repetibilidade
          <select id="cf-nrep">${selRep}</select></label>
        ${campo('Fator de abrangência (k)', 'cf-k', 'number', c.fator_abrangencia, 'step="0.1"')}
      </div>
      <label class="chk"><input type="checkbox" id="cf-tempu" ${sim(c.exige_temp_umidade)}>
        Registrar temperatura e umidade</label>
      <label class="chk"><input type="checkbox" id="cf-lacre" ${sim(c.exige_lacre_selo)}>
        Registrar número de lacre e selo Inmetro</label>
      <label class="chk"><input type="checkbox" id="cf-ajuste" ${sim(c.usa_ajuste)}>
        Permitir registro de leitura antes/depois do ajuste</label>
      <label class="chk"><input type="checkbox" id="cf-validade" ${sim(c.mostra_validade)}>
        Mostrar periodicidade e data da próxima calibração no PDF</label>
      <label class="chk"><input type="checkbox" id="cf-vdownload" ${sim(c.validar_permite_download)}>
        Permitir que o cliente baixe os certificados na página de validação (QR)</label>
      <label>Modelo do certificado (PDF)
        <select id="cf-modelo">
          <option value="classico" ${(c.modelo_certificado||'classico')==='classico'?'selected':''}>Modelo 1 — formato relatório</option>
          <option value="completo" ${c.modelo_certificado==='completo'?'selected':''}>Modelo 2 — com sensibilidade, TUR, k e veff</option>
          <option value="formulario" ${c.modelo_certificado==='formulario'?'selected':''}>Modelo 3 — formato formulário (seções numeradas)</option>
        </select></label>
      <button type="button" class="btn-mini" onclick="verExemploModelo()">👁️ Ver exemplo em PDF</button>
      <p id="cf-preview-msg" class="dica"></p>
      <label>Tamanho da etiqueta de calibração
        <select id="cf-etiqueta">
          <option value="40x60" ${(c.etiqueta_tamanho||'40x60')==='40x60'?'selected':''}>40×60 mm — completa (todos os dados escritos)</option>
          <option value="50x30" ${c.etiqueta_tamanho==='50x30'?'selected':''}>50×30 mm — média (QR + dados principais)</option>
          <option value="33x22" ${c.etiqueta_tamanho==='33x22'?'selected':''}>33×22 mm — pequena (QR + vencimento)</option>
          <option value="25x15" ${c.etiqueta_tamanho==='25x15'?'selected':''}>25×15 mm — mínima, sem QR (só texto)</option>
        </select></label>
    </div>

    <div class="rodape-acoes">
      <button class="btn-primario" onclick="salvarConfig()">Salvar configurações</button>
    </div>
    <p id="cf-msg" class="dica"></p>`;
  if (c.logo_url) carregarLogoPreview();
}

async function carregarSmtp() {
  try {
    const s = await api('/sistema/smtp');
    $('#smtp-host').value = s.host || '';
    $('#smtp-port').value = s.port || '';
    $('#smtp-user').value = s.user || '';
    $('#smtp-from').value = s.from || '';
    $('#smtp-nome').value = s.nomeRemetente || '';
    $('#smtp-pass').placeholder = s.temSenha
      ? 'já configurada — deixe em branco para manter' : 'senha do SMTP';
  } catch (e) { /* sem permissão ou sem config ainda */ }
}

async function salvarSmtp() {
  const msg = $('#smtp-msg');
  try {
    await api('/sistema/smtp', { method: 'PUT', body: JSON.stringify({
      host: $('#smtp-host').value || null,
      port: Number($('#smtp-port').value) || null,
      user: $('#smtp-user').value || null,
      password: $('#smtp-pass').value || null,
      from: $('#smtp-from').value || null,
      nomeRemetente: $('#smtp-nome').value || null
    })});
    msg.textContent = '✅ SMTP salvo. Envie um email de teste para confirmar.';
    msg.style.color = '#146c43';
    $('#smtp-pass').value = '';
  } catch (e) { msg.textContent = e.message; msg.style.color = '#b02a37'; }
}

async function testarSmtp() {
  const para = prompt('Enviar o email de teste para:', usuario?.email || '');
  if (!para) return;
  const msg = $('#smtp-msg');
  try {
    await api('/sistema/smtp/teste', { method: 'POST',
      body: JSON.stringify({ para }) });
    msg.textContent = `✉️ Teste enviado para ${para} — confira a caixa de entrada ` +
      '(e o spam). Se não chegar em 1 minuto, revise host/porta/usuário/senha.';
    msg.style.color = '#146c43';
  } catch (e) { msg.textContent = e.message; msg.style.color = '#b02a37'; }
}

async function carregarLogoPreview() {
  try {
    const r = await fetch('/api/empresa/logo', {
      headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) return;
    const blob = await r.blob();
    const prev = $('#cf-logo-preview');
    if (prev) prev.innerHTML =
      `<img src="${URL.createObjectURL(blob)}" alt="logo" class="logo-preview">`;
  } catch (e) { /* silencioso */ }
}

async function enviarLogo() {
  const inp = $('#cf-logo');
  const msg = $('#cf-logo-msg');
  if (!inp.files || inp.files.length === 0) {
    msg.textContent = 'Escolha um arquivo de imagem primeiro.';
    msg.style.color = '#b02a37'; return;
  }
  const fd = new FormData();
  fd.append('logo', inp.files[0]);
  try {
    const r = await fetch('/api/empresa/logo', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
      body: fd
    });
    if (!r.ok) {
      const t = await r.text();
      const erro = t ? (JSON.parse(t).erro || 'Erro') : 'Erro ' + r.status;
      throw new Error(erro);
    }
    msg.textContent = '✅ Logo enviado.';
    msg.style.color = '#146c43';
    carregarLogoPreview();
  } catch (e) {
    msg.textContent = e.message;
    msg.style.color = '#b02a37';
  }
}

// Gera e abre um PDF de exemplo do modelo escolhido, a partir do
// último certificado emitido (não altera nada). Dispara no worker e
// faz polling até o PDF ficar pronto.
async function verExemploModelo() {
  const msg = $('#cf-preview-msg');
  const modelo = $('#cf-modelo').value;
  msg.style.color = '#667';
  msg.textContent = '⏳ Gerando exemplo…';
  let prevToken;
  try {
    const r = await api('/preview-modelo', { method: 'POST', body: JSON.stringify({ modelo }) });
    prevToken = r.token;
  } catch (e) {
    msg.style.color = '#b02a37';
    msg.textContent = e.message || 'Não foi possível gerar o exemplo.';
    return;
  }
  // Busca o PDF exatamente deste pedido (token único evita pegar exemplo antigo)
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const resp = await fetch('/api/preview-modelo?token=' + encodeURIComponent(prevToken), {
        headers: { Authorization: 'Bearer ' + token }
      });
      if (resp.ok) {
        const blob = await resp.blob();
        if (blob.type === 'application/pdf' && blob.size > 800) {
          window.open(URL.createObjectURL(blob), '_blank');
          msg.style.color = '#146c43';
          msg.textContent = '✅ Exemplo aberto em nova aba.';
          return;
        }
      }
    } catch (e) { /* ainda gerando */ }
  }
  msg.style.color = '#b02a37';
  msg.textContent = 'O exemplo demorou a gerar. Tente novamente em instantes.';
}

async function salvarConfig() {
  const corpo = {
    razaoSocial: $('#cf-razao').value,
    endereco: $('#cf-end').value || null,
    cidadeUf: $('#cf-ciduf').value || null,
    telefone: $('#cf-fone').value || null,
    email: $('#cf-email').value || null,
    tituloDocumento: $('#cf-titulo').value || null,
    metodoCalibracao: $('#cf-metodo').value || null,
    textoPeriodicidade: $('#cf-period').value || null,
    textoRodape: $('#cf-rodape').value || null,
    usaExcentricidade: $('#cf-exc').checked,
    usaRepetibilidade: $('#cf-rep').checked,
    numRepeticoes: Number($('#cf-nrep').value),
    exigeTempUmidade: $('#cf-tempu').checked,
    exigeLacreSelo: $('#cf-lacre').checked,
    fatorAbrangencia: Number($('#cf-k').value || 2),
    corMarca: $('#cf-cor').value || null,
    usaAjuste: $('#cf-ajuste').checked,
    textoAutorizacao: $('#cf-autoriz-txt').value || null,
    mostraValidade: $('#cf-validade').checked,
    etiquetaTamanho: $('#cf-etiqueta').value,
    validarPermiteDownload: $('#cf-vdownload').checked,
    modeloCertificado: $('#cf-modelo').value
  };
  try {
    await api('/empresa/config', { method: 'PUT', body: JSON.stringify(corpo) });
    $('#cf-msg').textContent = '✅ Configurações salvas.';
    $('#cf-msg').style.color = '#146c43';
  } catch (e) {
    $('#cf-msg').textContent = e.message;
    $('#cf-msg').style.color = '#b02a37';
  }
}

// ── Tipos de balança ────────────────────────────────────────────
async function renderTipos() {
  const ts = await api('/tipos-balanca?incluirInativos=true');
  $('#cad-conteudo').innerHTML = `
    <div class="card">
      <div class="barra"><h3>Tipos de balança</h3>
        ${ehGestor() ? '<button class="btn-primario btn-mini" onclick="formTipo()">+ Novo</button>' : ''}</div>
      <p class="dica">Os tipos aparecem na lista ao cadastrar uma balança.</p>
      <div id="form-area"></div>
      ${ts.length === 0 ? '<p class="dica">Nenhum tipo cadastrado.</p>' : ts.map(t => `
        <div class="item-cert">
          <span><b>${esc(t.nome)}</b>
            ${t.ativo ? '' : '<span class="badge rep">inativo</span>'}</span>
          ${ehGestor() ? `<span class="acoes">
            <button class="btn-mini" onclick='formTipo(${JSON.stringify(t)})'>✏️</button>
            <button class="btn-mini" onclick="toggleAtivo('tipos-balanca','${t.id}',${!t.ativo},renderTipos)">
              ${t.ativo ? '🚫' : '↩️'}</button>
          </span>` : ''}
        </div>`).join('')}
    </div>`;
}

function formTipo(t = null) {
  $('#form-area').innerHTML = `
    <div class="subcard">
      <h4>${t ? 'Editar tipo' : 'Novo tipo de balança'}</h4>
      ${campo('Nome *', 't-nome', 'text', t?.nome)}
      <div class="rodape-acoes">
        <button onclick="renderTipos()">Cancelar</button>
        <button class="btn-primario" onclick="salvarTipo('${t?.id || ''}')">Salvar</button>
      </div>
      <p id="f-erro" class="erro"></p>
    </div>`;
}

async function salvarTipo(id) {
  const nome = $('#t-nome').value.trim();
  if (!nome) { $('#f-erro').textContent = 'Informe o nome do tipo.'; return; }
  try {
    await api('/tipos-balanca' + (id ? '/' + id : ''), {
      method: id ? 'PUT' : 'POST', body: JSON.stringify({ nome }) });
    renderTipos();
  } catch (e) { $('#f-erro').textContent = e.message; }
}

// ── Usuários (admin) ────────────────────────────────────────────
const PAPEIS = { admin: 'Administrador',
  responsavel_tecnico: 'Responsável técnico', tecnico: 'Técnico' };

async function renderUsuarios() {
  const us = await api('/usuarios');
  $('#cad-conteudo').innerHTML = `
    <div class="card">
      <div class="barra"><h3>Usuários</h3>
        <button class="btn-primario btn-mini" onclick="formUsuario()">+ Novo</button></div>
      <div id="form-area"></div>
      ${us.map(u => `
        <div class="item-cert">
          <span><b>${esc(u.nome)}</b>
            ${u.ativo ? '' : '<span class="badge rep">inativo</span>'}<br>
            <span class="dica">${esc(u.email)} · ${PAPEIS[u.papel] || u.papel}
              ${u.registro_prof ? '· ' + esc(u.registro_prof) : ''}</span>
          </span>
          <span class="acoes">
            <button class="btn-mini" onclick='formUsuario(${JSON.stringify(u)})'>✏️</button>
            <button class="btn-mini" onclick="resetSenha('${u.id}','${esc(u.nome)}')">🔑</button>
          </span>
        </div>`).join('')}
    </div>`;
}

function formUsuario(u = null) {
  const sel = Object.entries(PAPEIS).map(([v, r]) =>
    `<option value="${v}" ${v === (u?.papel || 'tecnico') ? 'selected' : ''}>${r}</option>`).join('');
  $('#form-area').innerHTML = `
    <div class="subcard">
      <h4>${u ? 'Editar ' + esc(u.nome) : 'Novo usuário'}</h4>
      <div class="form-grid">
        ${campo('Nome *', 'u-nome', 'text', u?.nome)}
        ${campo('Email *', 'u-email', 'email', u?.email)}
        <label>Papel *<select id="u-papel">${sel}</select></label>
        ${campo('Registro profissional', 'u-reg', 'text', u?.registro_prof)}
        ${u ? '' : '<p class="dica" style="grid-column:1/-1">📧 O usuário receberá um email com um link para definir a própria senha. Você também poderá copiar o link e enviar por WhatsApp.</p>'}
      </div>
      <div class="rodape-acoes">
        <button onclick="renderUsuarios()">Cancelar</button>
        <button class="btn-primario" onclick="salvarUsuario('${u?.id || ''}')">Salvar</button>
      </div>
      ${u ? `<button class="btn-mini btn-vinho"
        onclick="toggleAtivo('usuarios','${u.id}',${!u.ativo},renderUsuarios)">
        ${u.ativo ? 'Inativar usuário' : 'Reativar usuário'}</button>` : ''}
      <p id="f-erro" class="erro"></p>
    </div>`;
}

async function salvarUsuario(id) {
  const corpo = {
    nome: $('#u-nome').value, email: $('#u-email').value,
    papel: $('#u-papel').value, registroProf: $('#u-reg').value || null
  };
  try {
    const r = await api('/usuarios' + (id ? '/' + id : ''), {
      method: id ? 'PUT' : 'POST', body: JSON.stringify(corpo) });
    if (!id && r.linkConvite) mostrarLinkConvite(r.linkConvite);
    else renderUsuarios();
  } catch (e) { $('#f-erro').textContent = e.message; }
}

// Mostra o link de convite com botão de copiar (útil se o email falhar)
function mostrarLinkConvite(link) {
  $('#cad-conteudo').innerHTML = `
    <div class="card">
      <h3>✅ Usuário criado — convite enviado</h3>
      <p>Enviamos um email pedindo para o usuário definir a senha.
        Se preferir (ou se o email não chegar), copie o link abaixo e
        envie por WhatsApp — vale por 7 dias:</p>
      <input type="text" id="link-convite" readonly value="${link}"
        style="width:100%" onclick="this.select()">
      <div class="rodape-acoes" style="margin-top:10px">
        <button class="btn-mini" onclick="copiarLinkConvite()">📋 Copiar link</button>
        <button class="btn-primario" onclick="renderUsuarios()">Concluir</button>
      </div>
      <p id="convite-msg" class="dica"></p>
    </div>`;
}

async function copiarLinkConvite() {
  const inp = $('#link-convite');
  inp.select();
  try { await navigator.clipboard.writeText(inp.value); }
  catch (e) { document.execCommand('copy'); }
  $('#convite-msg').textContent = '✅ Link copiado.';
}

async function resetSenha(id, nome) {
  if (!await modalConfirmar('Redefinir senha',
    `Enviar a ${nome} um link para redefinir a senha?\n` +
    'A senha atual continua valendo até ele definir a nova.',
    { textoSim: 'Enviar link' })) return;
  try {
    const r = await api(`/usuarios/${id}/convite`, { method: 'POST' });
    mostrarLinkConvite(r.linkConvite);
  } catch (e) { alert(e.message); }
}

// ════════════════════════════════════════════════════════════════
// NOVA CALIBRAÇÃO + ENSAIO (etapa 3)
// ════════════════════════════════════════════════════════════════
let clientesCache = [];
let balancasNova = [];

async function novaCalibracao() {
  mostrar('tela-nova');
  $('#nova-erro').textContent = '';
  $('#busca-cliente').value = '';
  $('#sel-cliente').value = '';
  $('#cliente-escolhido').textContent = '';
  $('#lista-clientes-busca').innerHTML = '';
  $('#busca-balanca').value = '';
  $('#busca-balanca').disabled = true;
  $('#sel-balanca').value = '';
  $('#balanca-escolhida').textContent = '';
  $('#lista-balancas-busca').innerHTML = '';
  balancasNova = [];
  clientesCache = await api('/clientes');
}

function filtrarClientes() {
  const termo = $('#busca-cliente').value.toLowerCase().trim();
  const lista = $('#lista-clientes-busca');
  if (termo.length < 1) { lista.innerHTML = ''; return; }
  const achados = clientesCache.filter(c =>
    (c.razao_social || '').toLowerCase().includes(termo) ||
    (c.cnpj || '').toLowerCase().includes(termo)
  ).slice(0, 8);
  lista.innerHTML = achados.length === 0
    ? '<div class="busca-vazio">Nenhum cliente encontrado</div>'
    : achados.map(c => `
      <div class="busca-item" onclick="escolherCliente('${c.id}')">
        <b>${esc(c.razao_social)}</b>
        ${c.cnpj ? `<span class="dica"> · ${esc(c.cnpj)}</span>` : ''}
        ${c.cidade ? `<span class="dica"> · ${esc(c.cidade)}/${esc(c.uf || '')}</span>` : ''}
      </div>`).join('');
}

async function escolherCliente(id) {
  const c = clientesCache.find(x => x.id === id);
  if (!c) return;
  $('#sel-cliente').value = id;
  $('#busca-cliente').value = c.razao_social;
  $('#lista-clientes-busca').innerHTML = '';
  $('#cliente-escolhido').textContent = '✓ Cliente selecionado';
  // reseta a balança ao trocar de cliente
  $('#busca-balanca').value = '';
  $('#sel-balanca').value = '';
  $('#balanca-escolhida').textContent = '';
  $('#lista-balancas-busca').innerHTML = '';
  await carregarBalancas();
}

async function carregarBalancas() {
  const cid = $('#sel-cliente').value;
  if (!cid) return;
  const bs = await api(`/clientes/${cid}/balancas`);
  balancasNova = bs.filter(b => b.ativa);
  const campo = $('#busca-balanca');
  if (balancasNova.length === 0) {
    campo.disabled = true;
    $('#balanca-escolhida').innerHTML = '<span class="erro">Este cliente não tem balanças ativas cadastradas.</span>';
    return;
  }
  campo.disabled = false;
  campo.placeholder = `Buscar entre ${balancasNova.length} balança(s)…`;
  // mostra todas de início (lista pronta para escolher sem digitar)
  renderListaBalancas(balancasNova);
}

// Descreve uma balança em uma linha (para a lista de busca)
function descreverBalanca(b) {
  const partes = [];
  if (b.marca || b.modelo) partes.push(`${esc(b.marca || '')} ${esc(b.modelo || '')}`.trim());
  if (b.num_serie) partes.push('Série ' + esc(b.num_serie));
  if (b.numero_inmetro) partes.push('Inmetro ' + esc(b.numero_inmetro));
  if (b.capacidade) partes.push(fmt(b.capacidade) + ' kg');
  return partes.join(' · ');
}

function renderListaBalancas(lista) {
  const alvo = $('#lista-balancas-busca');
  alvo.innerHTML = lista.length === 0
    ? '<div class="busca-vazio">Nenhuma balança encontrada</div>'
    : lista.slice(0, 12).map(b => `
      <div class="busca-item" onclick="escolherBalanca('${b.id}')">
        <b>⚖️ ${esc(b.identificacao)}</b>
        <span class="dica"> · ${descreverBalanca(b)}</span>
      </div>`).join('');
}

// Busca por identificação, marca, modelo, série ou número Inmetro
function filtrarBalancas() {
  const termo = $('#busca-balanca').value.toLowerCase().trim();
  if (termo.length < 1) { renderListaBalancas(balancasNova); return; }
  const achados = balancasNova.filter(b =>
    (b.identificacao || '').toLowerCase().includes(termo) ||
    (b.marca || '').toLowerCase().includes(termo) ||
    (b.modelo || '').toLowerCase().includes(termo) ||
    (b.num_serie || '').toLowerCase().includes(termo) ||
    (b.numero_inmetro || '').toLowerCase().includes(termo)
  );
  renderListaBalancas(achados);
}

function escolherBalanca(id) {
  const b = balancasNova.find(x => x.id === id);
  if (!b) return;
  $('#sel-balanca').value = id;
  $('#busca-balanca').value = b.identificacao;
  $('#lista-balancas-busca').innerHTML = '';
  $('#balanca-escolhida').innerHTML = `✓ ${esc(b.identificacao)} <span class="dica">· ${descreverBalanca(b)}</span>`;
}

async function iniciarEnsaio() {
  const clienteId = $('#sel-cliente').value, balancaId = $('#sel-balanca').value;
  if (!clienteId || !balancaId) {
    $('#nova-erro').textContent = 'Selecione cliente e balança.'; return;
  }
  $('#nova-erro').textContent = '';
  certId = uuid();
  try {
    await api('/certificados', { method: 'POST',
      body: JSON.stringify({ id: certId, clienteId, balancaId }) });
    plano = await api('/balancas/' + balancaId + '/plano-ensaio');

    // Oferece aproveitar as cargas do último certificado desta balança
    let base = null;
    try {
      const u = await api('/balancas/' + balancaId + '/ultimo-plano');
      if (u && u.cargas && u.cargas.length > 0 &&
          await modalConfirmar('Aproveitar último ensaio?',
            `Esta balança já tem o certificado ${u.numero}.\n\n` +
            'Cargas da indicação vêm preenchidas (leituras em branco); ' +
            'excentricidade e repetibilidade vêm com os valores anteriores — confira e ajuste.',
            { textoSim: 'Aproveitar', textoNao: 'Começar do zero' })) {
        base = {
          indicacao: u.cargas.map(c => ({ carga: c })),
          excentricidade: u.exc && u.exc.length > 0
            ? u.exc.map(x => ({ posicao: x.posicao, carga: x.carga, indicacao: x.indicacao }))
            : undefined,
          repetibilidade: u.rep && u.rep.length > 0
            ? u.rep.map(r => ({ carga: r.carga, indicacao: r.indicacao }))
            : undefined
        };
      }
    } catch (e) { /* sem certificado anterior: segue o fluxo normal */ }
    montarTelaEnsaio(base);
  } catch (e) {
    $('#nova-erro').textContent = e.message;
  }
}

// ── Ajuda contextual (modal) ────────────────────────────────────
const AJUDA = {
  criterio: {
    titulo: 'Critério de avaliação (EMA)',
    corpo: `<p>O <b>EMA</b> (Erro Máximo Admissível) é o limite de erro tolerado,
      definido pela Portaria Inmetro nº 157/2022.</p>
      <p><b>Verificação subsequente:</b> usa o EMA padrão da tabela. É o critério
      da verificação metrológica periódica — mais rigoroso.</p>
      <p><b>Em uso:</b> aplica o dobro do EMA. É o limite tolerado para uma balança
      já em operação no dia a dia, entre verificações.</p>
      <p>Na prática: um erro que reprova em "subsequente" pode ainda ser aceitável
      "em uso". Escolha conforme a finalidade da calibração.</p>`
  },
  indicacao: {
    titulo: 'Ensaio de indicação',
    corpo: `<p>Verifica se a balança indica corretamente ao longo de toda a faixa.
      Aplicam-se cargas crescentes e compara-se a indicação com o valor real.</p>
      <p>A prática recomenda <b>pelo menos 5 pontos</b> distribuídos: tipicamente
      próximos de 0, 25%, 50%, 75% e 100% da capacidade.</p>
      <p>Você pode <b>adicionar</b> ou <b>remover</b> pontos e <b>editar</b> o valor
      de cada carga conforme os pesos que realmente aplicou.</p>`
  },
  excentricidade: {
    titulo: 'Ensaio de excentricidade',
    corpo: `<p>Verifica se a indicação muda quando a carga é posicionada em pontos
      diferentes do receptor (centro e extremidades).</p>
      <p>Conforme a Portaria Inmetro nº 157/2022 (item 2.6.2.2), aplica-se uma carga
      correspondente a <b>1/3 da carga máxima</b> do instrumento.</p>
      <p>O erro de excentricidade é a maior diferença entre a indicação numa posição
      e a indicação no centro. Erros aqui indicam problemas mecânicos de apoio.</p>`
  },
  repetibilidade: {
    titulo: 'Ensaio de repetibilidade',
    corpo: `<p>Avalia se a balança repete o mesmo resultado ao pesar a mesma carga
      várias vezes, nas mesmas condições.</p>
      <p>Usa-se uma carga próxima de <b>50% da capacidade</b>, repetindo a pesagem
      (tipicamente 3 vezes) e calculando o desvio padrão das leituras.</p>
      <p>Esse desvio entra no cálculo da incerteza de medição (k=2), conforme o GUM.</p>`
  },
  sensibilidade: {
    titulo: 'Ensaio de sensibilidade',
    corpo: `<p>Verifica se a balança responde à menor variação que ela deveria detectar.</p>
      <p>Coloca-se uma <b>carga de referência</b> no prato e, sobre ela, adiciona-se
      <b>uma divisão (e)</b>. O display deve acompanhar, mudando exatamente esse valor.</p>
      <p>Exemplo: referência 1000, adição de 1 (uma divisão), o display deve marcar 1001.</p>`
  }
};

function ajuda(chave) {
  const a = AJUDA[chave];
  if (!a) return;
  $('#ajuda-titulo').textContent = a.titulo;
  $('#ajuda-corpo').innerHTML = a.corpo;
  $('#modal-ajuda').classList.remove('oculta');
}

function fecharAjuda(ev) {
  if (ev && ev.target.id !== 'modal-ajuda' && ev.type === 'click' && ev.target.closest('.modal-caixa')) return;
  $('#modal-ajuda').classList.add('oculta');
}

// Adiciona uma nova linha de carga na indicação (editável)
function adicionarCarga() {
  const tbody = document.querySelector('#tab-indicacao tbody');
  const tr = document.createElement('tr');
  tr.dataset.carga = '0';
  tr.innerHTML = linhaIndicacaoHtml(0, '');
  tbody.appendChild(tr);
  sujo = true;
}

function removerCarga(btn) {
  btn.closest('tr').remove();
  sujo = true;
  recalcular();
}

// HTML de uma linha de indicação com carga editável e botão remover
function linhaIndicacaoHtml(carga, indic, antes = '') {
  const mostrarAntes = $('#ens-houve-ajuste')?.checked;
  return `<td><input type="number" step="any" inputmode="decimal" class="in-carga"
             value="${fmtCampo(carga)}" onchange="atualizarCarga(this)" onblur="arredondarCampo(this)"></td>
    <td class="col-antes" style="${mostrarAntes ? '' : 'display:none'}">
      <input type="number" step="any" inputmode="decimal" class="in-antes"
             value="${fmtCampo(antes)}" onblur="arredondarCampo(this)"></td>
    <td><input type="number" step="any" inputmode="decimal" class="in-indic"
             value="${fmtCampo(indic)}" oninput="recalcular()" onblur="arredondarCampo(this)"></td>
    <td class="num erro-cel">—</td>
    <td class="num ema-cel">—</td>
    <td class="status-cel">—</td>
    <td><button type="button" class="btn-remover" onclick="removerCarga(this)" title="Remover">✕</button></td>`;
}

// Mostra/esconde a coluna "antes do ajuste" em toda a tabela
function toggleColunaAjuste() {
  const mostrar = $('#ens-houve-ajuste').checked;
  document.querySelectorAll('#tab-indicacao .col-antes').forEach(el =>
    el.style.display = mostrar ? '' : 'none');
  sujo = true;
}

// Quando o usuário edita a carga, atualiza o data-carga da linha
function atualizarCarga(input) {
  const tr = input.closest('tr');
  tr.dataset.carga = input.value || '0';
  arredondarCampo(input);
  recalcular();
}

// Sugere temperatura e umidade a partir da localização do navegador.
// Usa Open-Meteo (gratuita, sem chave). É SUGESTÃO — o técnico deve
// confirmar com o termohigrômetro do local (a API dá o clima da região,
// não o do interior do galpão/plataforma).
function sugerirClima() {
  if (!navigator.geolocation) {
    alert('Seu navegador não permite obter a localização.');
    return;
  }
  const btn = document.querySelector('.btn-clima');
  const original = btn ? btn.textContent : '';
  if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
  const restaurar = () => { if (btn) { btn.textContent = original; btn.disabled = false; } };

  navigator.geolocation.getCurrentPosition(async (pos) => {
    try {
      const { latitude, longitude } = pos.coords;
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}` +
        `&longitude=${longitude}&current=temperature_2m,relative_humidity_2m`;
      const r = await fetch(url);
      if (!r.ok) throw new Error('clima indisponível');
      const dados = await r.json();
      const temp = dados?.current?.temperature_2m;
      const umid = dados?.current?.relative_humidity_2m;
      if (temp != null) $('#ens-temp').value = Math.round(temp * 10) / 10;
      if (umid != null) $('#ens-umid').value = Math.round(umid);
      sujo = true;
      alert('Valores sugeridos a partir do clima da região.\n\n' +
        '⚠️ Confirme com o termohigrômetro do local — a balança pode estar ' +
        'num ambiente com temperatura diferente da externa.');
    } catch (e) {
      alert('Não foi possível obter o clima agora. Preencha manualmente.');
    } finally { restaurar(); }
  }, (err) => {
    restaurar();
    alert('Não foi possível obter sua localização. ' +
      'Verifique a permissão de localização do navegador, ou preencha manualmente.');
  }, { timeout: 10000, enableHighAccuracy: false });
}

// Linha do ensaio de excentricidade. Estrutura: centro (posição 1,
// referência) + seções (posições 2, 3, 4...). Exibição numérica.
function linhaExcHtml(pos, indic = '', numero = null) {
  const ehCentro = pos === 'centro';
  // número de exibição: centro = 1; seções = 2, 3, 4...
  const rotulo = numero != null ? numero : (ehCentro ? 1 : '?');
  return `<tr data-pos="${esc(pos)}" data-carga="${plano.excentricidade.carga}">
    <td>${rotulo}${ehCentro ? ' <span class="dica">(ref.)</span>' : ''}</td>
    <td><input type="number" step="any" inputmode="decimal" class="in-exc"
         value="${fmtCampo(indic)}"
         oninput="recalcular()" onblur="arredondarCampo(this)"></td>
    <td class="num exc-erro">—</td>
    <td class="exc-acao"></td>
  </tr>`;
}

// Renumera a coluna de posição após adicionar/remover (1=centro, 2,3...)
function renumerarExc() {
  const trs = [...document.querySelectorAll('#tab-exc tbody tr')];
  trs.forEach((tr, i) => {
    const ehCentro = tr.dataset.pos === 'centro';
    const cel = tr.querySelector('td');
    cel.innerHTML = (i + 1) + (ehCentro ? ' <span class="dica">(ref.)</span>' : '');
  });
}

// Mantém as regras: ✕ apenas na última seção (e só acima de 4);
// o botão de adicionar trava em 10 seções
function atualizarExcControles() {
  const trs = [...document.querySelectorAll('#tab-exc tbody tr')];
  const secoes = trs.filter(t => t.dataset.pos !== 'centro');
  trs.forEach(t => { const c = t.querySelector('.exc-acao'); if (c) c.innerHTML = ''; });
  if (secoes.length > 4) {
    const ult = secoes[secoes.length - 1];
    ult.querySelector('.exc-acao').innerHTML =
      '<button type="button" class="btn-remover" onclick="removerPosicaoExc(this)" title="Remover">✕</button>';
  }
  const btn = $('#btn-add-exc');
  if (btn) btn.disabled = secoes.length >= 10;
}

function adicionarPosicaoExc() {
  const secoes = [...document.querySelectorAll('#tab-exc tbody tr')]
    .filter(t => t.dataset.pos !== 'centro').length;
  if (secoes >= 10) { toast('Máximo de 10 seções no ensaio de excentricidade.', 'aviso'); return; }
  $('#tab-exc tbody').insertAdjacentHTML('beforeend', linhaExcHtml('secao_' + (secoes + 1)));
  atualizarExcControles();
  renumerarExc();
  sujo = true;
  recalcular();
}

function removerPosicaoExc(btn) {
  btn.closest('tr').remove();
  atualizarExcControles();
  renumerarExc();
  sujo = true;
  recalcular();
}

async function montarTelaEnsaio(rascunho) {
  const b = plano.balanca;
  $('#ens-titulo').textContent = `${b.cliente} · ${b.identificacao}`;
  $('#ens-chips').innerHTML = `
    <span class="chip">${esc([b.marca, b.modelo].filter(Boolean).join(' ') || 'Sem marca/modelo')}</span>
    ${b.num_serie ? `<span class="chip">Série: ${esc(b.num_serie)}</span>` : ''}
    ${b.numero_inmetro ? `<span class="chip">Inmetro: ${esc(b.numero_inmetro)}</span>` : ''}
    ${b.patrimonio ? `<span class="chip">Patrimônio: ${esc(b.patrimonio)}</span>` : ''}
    <span class="chip">Classe ${b.classe_exatidao}</span>
    <span class="chip">Capacidade ${fmtU(b.capacidade)} ${unid()}</span>
    <span class="chip">Divisão e = ${fmtU(b.divisao_e)} ${unid()}${b.divisao_d && b.divisao_d != b.divisao_e ? ` · d = ${fmtU(b.divisao_d)} ${unid()}` : ''}</span>`;
  $('#ens-data').value = rascunho?.dataCalibracao || new Date().toISOString().slice(0, 10);
  $('#ens-temp').value = rascunho?.temperatura ?? '';
  $('#ens-umid').value = rascunho?.umidade ?? '';
  $('#ens-contexto').value = rascunho?.contextoEma || 'subsequente';
  $('#ens-lacre').value = rascunho?.numeroLacre ?? '';
  $('#ens-selo').value = rascunho?.seloInmetro ?? '';
  $('#ens-local-tipo').value = rascunho?.localTipo || 'in_loco';
  $('#ens-local-detalhe').value = rascunho?.localDetalhe ?? '';
  // Toggle de ajuste só aparece se a empresa usa esse recurso
  if (plano.config?.usa_ajuste) {
    $('#ens-ajuste-wrap').style.display = '';
    $('#ens-houve-ajuste').checked = !!rascunho?.houveAjuste;
  } else {
    $('#ens-ajuste-wrap').style.display = 'none';
    $('#ens-houve-ajuste').checked = false;
  }

  const pesos = await api('/pesos');
  const pesosSel = rascunho?.pesos || [];
  $('#ens-pesos').innerHTML = pesos.filter(p => p.ativo).map(p => {
    const marcado = pesosSel.includes(p.id) ? 'checked' : '';
    const vencido = p.status_validade === 'vencido';
    const badge = vencido ? '<span class="badge rep">VENCIDO</span>'
                : p.status_validade === 'vencendo' ? '<span class="badge aviso">vence em breve</span>'
                : '<span class="badge ok">válido</span>';
    return `<label class="peso-item ${vencido ? 'peso-vencido' : ''}">
      <input type="checkbox" value="${p.id}" ${marcado} ${vencido ? 'disabled' : ''}>
      <span><b>${esc(p.identificacao)}</b> · ${fmt(p.valor_nominal)} ${p.unidade || 'kg'} · ${esc(p.classe)} ${badge}
      ${p.certificado_pdf_url ? '<span class="dica">📄 certificado anexado</span>' : ''}</span>
    </label>`;
  }).join('') || '<p class="dica">Nenhum peso padrão cadastrado. Cadastre em Cadastros › Pesos padrão.</p>';

  const cargas = rascunho?.indicacao?.map(p => p.carga) || plano.indicacao;
  $('#tab-indicacao tbody').innerHTML = cargas.map((c, i) => `
    <tr data-carga="${c}">${linhaIndicacaoHtml(c, rascunho?.indicacao?.[i]?.indicacao ?? '', rascunho?.indicacao?.[i]?.indicacaoAntes ?? '')}</tr>
  `).join('');
  toggleColunaAjuste();

  const exc = plano.excentricidade;
  if (rascunho?.excentricidade?.[0]?.carga != null)
    exc.carga = rascunho.excentricidade[0].carga;
  const indicExc = (pos, i) => {
    const porPos = rascunho?.excentricidade?.find(x => x.posicao === pos);
    return (porPos ?? rascunho?.excentricidade?.[i])?.indicacao ?? '';
  };
  // Posições: do rascunho (preserva as adicionadas/removidas pelo técnico);
  // sem rascunho, as sugeridas pelo tipo da balança
  const posicoesExc = rascunho?.excentricidade?.length > 0
    ? rascunho.excentricidade.map(x => x.posicao)
    : exc.posicoes;
  $('#tab-exc tbody').innerHTML =
    posicoesExc.map((pos, i) => linhaExcHtml(pos, indicExc(pos, i))).join('');
  atualizarExcControles();
  renumerarExc();

  const rep = plano.repetibilidade;
  if (rascunho?.repetibilidade?.[0]?.carga != null)
    rep.carga = rascunho.repetibilidade[0].carga;
  $('#tab-rep tbody').innerHTML = Array.from({ length: rep.medicoes }, (_, i) => `
    <tr data-carga="${rep.carga}">
      <td>${i + 1}</td>
      <td><input type="number" step="any" inputmode="decimal"
           value="${fmtCampo(rascunho?.repetibilidade?.[i]?.indicacao ?? '')}"
           oninput="recalcular()" onblur="arredondarCampo(this)" step="any" inputmode="decimal"></td>
    </tr>`).join('');

  $('#ens-erro').textContent = '';
  $('#ens-resultado').classList.add('oculta');
  mostrar('tela-ensaio');
  document.querySelectorAll('.u-unid').forEach(el => el.textContent = unid());
  document.getElementById('exc-carga').textContent = `(carga: ${fmtU(plano.excentricidade.carga)} ${unid()})`;
  document.getElementById('rep-carga').textContent = `(carga: ${fmtU(plano.repetibilidade.carga)} ${unid()})`;

  // Sensibilidade (adição = 1 divisão da balança) — opcional na tela
  if ($('#sens-ref')) {
    const s = rascunho?.sensibilidade;
    $('#sens-ref').value = fmtCampo(s?.cargaReferencia ?? '');
    $('#sens-adicao').value = fmtCampo(Number(plano.balanca.divisao_e));
    $('#sens-display').value = fmtCampo(s?.resultadoDisplay ?? '');
  }

  recalcular();

  clearInterval(timerAutosave);
  timerAutosave = setInterval(() => { if (sujo) salvarRascunho(false); }, 4000);
}

// Comparação erro vs EMA à prova de ponto flutuante do JS:
// arredonda ambos às casas da balança (+2 de folga) antes de comparar,
// senão 50.02-50.01 = 0.010000000000005 > 0.01 pintaria "não conforme"
// com exatamente uma divisão de diferença.
function dentroDoEma(erro, ema) {
  const casas = (plano?.casasDecimais ?? 3) + 2;
  return Number(Math.abs(erro).toFixed(casas)) <= Number(Number(ema).toFixed(casas));
}

function emaKg(cargaKg) {
  const e = Number(plano.balanca.divisao_e);
  const ctx = $('#ens-contexto').value;
  const m = cargaKg / e;
  const regra = plano.emaRegras.find(r =>
    r.contexto === ctx && m > Number(r.faixa_min_e) &&
    (r.faixa_max_e == null || m <= Number(r.faixa_max_e)));
  return regra ? Number(regra.ema_multiplo_e) * e : null;
}

// Arredonda o valor digitado para a resolução (divisão d, ou e) da balança
// Formata um valor para os campos do ensaio: múltiplo da divisão da
// balança, com as casas decimais derivadas da própria divisão.
// Usado tanto ao digitar (blur) quanto ao MONTAR a tela com valores
// vindos do banco (rascunho / aproveitamento do último certificado).
function fmtCampo(v) {
  if (v == null || v === '') return '';
  const b = plano?.balanca;
  const d = Number(b?.divisao_d ?? b?.divisao_e);
  const n = Number(v);
  if (!b || !d || d <= 0 || !isFinite(n)) return String(v);
  const sD = String(d);
  const pt = sD.indexOf('.');
  const casas = pt < 0 ? 0 : sD.slice(pt + 1).replace(/0+$/, '').length;
  return (Math.round(n / d) * d).toFixed(casas);
}

function arredondarCampo(input) {
  if (input.value === '') return;
  const f = fmtCampo(input.value);
  if (f !== '') input.value = f;
  recalcular();
}

function recalcular() {
  sujo = true;
  document.querySelectorAll('#tab-indicacao tbody tr').forEach(tr => {
    const carga = Number(tr.dataset.carga);
    const inp = tr.querySelector('.in-indic');
    const v = inp ? inp.value : '';
    if (v === '') {
      tr.querySelector('.erro-cel').textContent = '—';
      tr.querySelector('.ema-cel').textContent = fmtU(emaKg(carga));
      tr.querySelector('.status-cel').innerHTML = '—';
      return;
    }
    const erro = Number(v) - carga, ema = emaKg(carga);
    tr.querySelector('.erro-cel').textContent = (erro > 0 ? '+' : '') + fmtU(erro);
    tr.querySelector('.ema-cel').textContent = ema == null ? '—' : '± ' + fmtU(ema);
    tr.querySelector('.status-cel').innerHTML = ema == null ? '—'
      : dentroDoEma(erro, ema)
        ? '<span class="badge ok">OK</span>'
        : '<span class="badge rep">&gt; EMA</span>';
  });
  // Excentricidade: o erro é a diferença para a leitura do CENTRO
  // (referência do ensaio), não para a carga nominal — o material de
  // carga pode não ter valor calibrado; o que importa é a variação
  // entre posições.
  const linhasExc = [...document.querySelectorAll('#tab-exc tbody tr')];
  const trCentro = linhasExc.find(tr => tr.dataset.pos === 'centro') || linhasExc[0];
  const vCentro = trCentro ? trCentro.querySelector('.in-exc').value : '';
  linhasExc.forEach(tr => {
    const v = tr.querySelector('.in-exc').value;
    const cel = tr.querySelector('.exc-erro');
    if (v === '') { cel.textContent = '—'; return; }
    if (tr === trCentro) { cel.textContent = 'ref.'; return; }
    if (vCentro === '') { cel.textContent = '—'; return; }
    const erro = Number(v) - Number(vCentro);
    const emaExc = emaKg(Number(tr.dataset.carga));
    const txt = (erro > 0 ? '+' : '') + fmtU(erro);
    cel.innerHTML = emaExc == null ? txt
      : txt + ' ' + (dentroDoEma(erro, emaExc)
        ? '<span class="badge ok">OK</span>'
        : '<span class="badge rep">&gt; EMA</span>');
  });
}

// Sensibilidade: a adição é sempre 1 divisão (e) da balança
function atualizarSensAdicao() {
  if ($('#sens-adicao')) $('#sens-adicao').value = fmtCampo(Number(plano?.balanca?.divisao_e));
}

function coletarDados() {
  const num = v => v === '' ? null : Number(v);
  return {
    dataCalibracao: $('#ens-data').value || null,
    temperatura: num($('#ens-temp').value),
    umidade: num($('#ens-umid').value),
    contextoEma: $('#ens-contexto').value,
    numeroLacre: $('#ens-lacre').value || null,
    seloInmetro: $('#ens-selo').value || null,
    localTipo: $('#ens-local-tipo').value,
    localDetalhe: $('#ens-local-detalhe').value || null,
    houveAjuste: $('#ens-houve-ajuste')?.checked || false,
    pesos: [...document.querySelectorAll('#ens-pesos input:checked')].map(c => c.value),
    indicacao: [...document.querySelectorAll('#tab-indicacao tbody tr')].map(tr => ({
      carga: Number(tr.dataset.carga),
      indicacao: num(tr.querySelector('.in-indic').value),
      indicacaoAntes: num(tr.querySelector('.in-antes')?.value)
    })),
    excentricidade: [...document.querySelectorAll('#tab-exc tbody tr')].map(tr => ({
      posicao: tr.dataset.pos, carga: Number(tr.dataset.carga),
      indicacao: num(tr.querySelector('.in-exc').value)
    })),
    repetibilidade: [...document.querySelectorAll('#tab-rep tbody tr')].map(tr => ({
      carga: Number(tr.dataset.carga),
      indicacao: num(tr.querySelector('input').value)
    })),
    sensibilidade: (() => {
      const ref = num($('#sens-ref')?.value);
      const disp = num($('#sens-display')?.value);
      if (ref == null || disp == null) return null;
      return { cargaReferencia: ref, adicao: num($('#sens-adicao')?.value), resultadoDisplay: disp };
    })()
  };
}

async function salvarRascunho(manual) {
  try {
    await api(`/certificados/${certId}/rascunho`, {
      method: 'PUT', body: JSON.stringify({ dados: coletarDados() }) });
    sujo = false;
    $('#ens-salvo').textContent = '💾 salvo ' + new Date().toLocaleTimeString('pt-BR');
  } catch (e) { if (manual) $('#ens-erro').textContent = e.message; }
}

async function enviarAprovacao() {
  $('#ens-erro').textContent = '';
  try {
    await salvarRascunho(true);
    const r = await api(`/certificados/${certId}/enviar`, { method: 'POST' });
    clearInterval(timerAutosave);
    $('#ens-resultado').classList.remove('oculta');
    $('#ens-resultado').innerHTML = `
      <h3>✅ Enviado para aprovação</h3>
      <p class="dica">Resultado calculado pelo servidor (com incerteza, k=2):</p>
      <table><thead><tr><th>Carga</th><th>Indicação</th><th>Erro</th>
        <th>Incerteza</th><th>EMA</th><th>Status</th></tr></thead>
      <tbody>${r.indicacao.map(p => `
        <tr><td class="num">${fmtU(p.carga_aplicada)}</td>
            <td class="num">${fmtU(p.indicacao)}</td>
            <td class="num">${(p.erro > 0 ? '+' : '') + fmtU(p.erro)}</td>
            <td class="num">± ${fmtU(p.incerteza)}</td>
            <td class="num">± ${fmtU(p.ema)}</td>
            <td>${p.aprovado == null ? '—' : p.aprovado
              ? '<span class="badge ok">OK</span>'
              : '<span class="badge rep">&gt; EMA</span>'}</td></tr>`).join('')}
      </tbody></table>
      <br><button class="btn-primario" onclick="irPainel()">Voltar ao painel</button>`;
    window.scrollTo(0, document.body.scrollHeight);
  } catch (e) { $('#ens-erro').textContent = e.message; }
}

// ── Definir senha via link de convite ──────────────────────────
async function definirSenhaConvite() {
  const s1 = $('#conv-senha1').value, s2 = $('#conv-senha2').value;
  const err = $('#conv-erro');
  err.textContent = '';
  if (s1.length < 8) { err.textContent = 'A senha precisa de pelo menos 8 caracteres.'; return; }
  if (s1 !== s2) { err.textContent = 'As senhas não conferem.'; return; }
  const tokenConvite = location.hash.replace('#convite=', '').trim();
  try {
    const r = await fetch('/api/auth/definir-senha', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: tokenConvite, novaSenha: s1 }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || 'Erro ao definir a senha.');
    history.replaceState(null, '', location.pathname);
    toast('Senha definida com sucesso! Agora faça login.', 'ok', 6000);
    mostrar('tela-login');
  } catch (e) { err.textContent = e.message; }
}

// ── Boot ────────────────────────────────────────────────────────
if (location.hash.startsWith('#convite=')) mostrar('tela-convite');
else if (token && usuario) irPainel(); else mostrar('tela-login');
$('#login-senha').addEventListener('keydown', e => { if (e.key === 'Enter') fazerLogin(); });
