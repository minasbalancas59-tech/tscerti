// ════════════════════════════════════════════════════════════════
// SPA do técnico — etapa 3 + cadastros no navegador
// ════════════════════════════════════════════════════════════════
let token = localStorage.getItem('token');
let usuario = JSON.parse(localStorage.getItem('usuario') || 'null');
let plano = null, certId = null, sujo = false, timerAutosave = null;

const $ = s => document.querySelector(s);
const ehGestor = () => ['admin', 'responsavel_tecnico'].includes(usuario?.papel);

// Converte texto de campo numérico em número (ou null se vazio/inválido).
// Global para uso nas validações de ensaio.
const num = v => (v === '' || v == null) ? null : (isNaN(Number(v)) ? null : Number(v));

// Remove o destaque vermelho de "campo faltando" assim que o usuário digita.
// Registrado uma única vez, de forma delegada.
document.addEventListener('input', e => {
  if (e.target?.classList?.contains('campo-faltando'))
    e.target.classList.remove('campo-faltando');
});

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
function fmtU(n, casas) {
  if (n == null) return '—';
  const c = casas ?? (plano?.casasDecimais ?? 3);
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c });
}
// ── Incerteza conforme GUM 7.2.6 / NIT-DICLA-021 / ILAC-P14 ──
// No máximo DOIS algarismos significativos (não casas decimais), sempre
// arredondando PARA CIMA, e sem o sinal ±: U é positiva e o sinal pertence
// à expressão do resultado (y ± U), não a uma célula de tabela. O resultado
// herda as casas de U, e a coluna usa as casas da MAIOR U da tabela.
// Mesmo critério do PDF (ArredondarU / CasasTabelaU / ValU).
function arredondarCima(n, casas) {
  const f = Math.pow(10, casas);
  return Math.ceil(Math.abs(Number(n)) * f - 1e-12) / f;
}
function casasDeU(u, casasMax) {
  u = Math.abs(Number(u));
  if (!(u > 0)) return casasMax;
  let expo = Math.floor(Math.log10(u));
  let q = Math.pow(10, expo - 1);
  let ur = Math.ceil(u / q - 1e-12) * q;
  if (ur > 0 && Math.floor(Math.log10(ur)) > expo) expo++;
  return Math.min(Math.max(0, -(expo - 1)), casasMax);
}
// Casas da coluna: as da MAIOR incerteza da tabela
function casasTabelaU(lista, casasMax) {
  const maior = Math.max(0, ...lista.map(v => Math.abs(Number(v)) || 0));
  return maior > 0 ? casasDeU(maior, casasMax) : casasMax;
}
function fmtUInc(n, casas) {
  if (n == null) return '—';
  const c = casas ?? (plano?.casasDecimais ?? 3);
  return arredondarCima(n, c)
    .toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c });
}
// Unidades de massa são sempre minúsculas (kg, g, t) — normaliza na exibição
const normUnid = u => (u || 'kg').toString().trim().toLowerCase();
const unid = () => normUnid(plano?.unidade);

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
  // Consultas OPCIONAIS (ex.: historico que pode nao existir): 404 devolve
  // null em vez de lancar erro, para nao interromper o fluxo.
  if (r.status === 404 && opcoes.opcional) return null;
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
    // Garante que não sobrou nenhum resíduo do modo visualização
    localStorage.removeItem('_visualizando');
    document.getElementById('banner-visualizacao')?.remove();
    document.body.classList.remove('com-banner-vis');
    localStorage.setItem('token', token);
    localStorage.setItem('usuario', JSON.stringify(usuario));
    irPainel();
  } catch (e) {
    $('#login-erro').textContent =
      e.message === 'Erro 401' ? 'Email ou senha incorretos.' : e.message;
  }
}

// ── Esqueci a senha ─────────────────────────────────────────────
function abrirEsqueciSenha() {
  const emailPre = $('#login-email').value.trim();
  const modal = `
    <div class="modal-fundo" onclick="if(event.target===this)this.remove()">
      <div class="modal-caixa" style="max-width:420px">
        <h3>🔑 Esqueci minha senha</h3>
        <p class="dica">Informe o email cadastrado. Enviaremos um link para criar uma nova senha
          (válido por 1 hora).</p>
        <label>Email <input type="email" id="esq-email" value="${esc(emailPre)}" placeholder="seu@email.com"></label>
        <div class="rodape-acoes" style="margin-top:12px">
          <button onclick="this.closest('.modal-fundo').remove()">Cancelar</button>
          <button class="btn-primario" onclick="enviarEsqueciSenha()">Enviar link</button>
        </div>
        <p id="esq-erro" class="erro"></p>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', modal);
  setTimeout(() => $('#esq-email')?.focus(), 50);
}

async function enviarEsqueciSenha() {
  const email = $('#esq-email').value.trim();
  const err = $('#esq-erro');
  err.textContent = '';
  if (!email || !email.includes('@')) { err.textContent = 'Informe um email válido.'; return; }
  const btn = document.querySelector('.modal-fundo .btn-primario');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Enviando...'; }
  try {
    const r = await fetch('/api/auth/esqueci-senha', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || 'Não foi possível enviar. Tente novamente.');
    document.querySelector('.modal-fundo')?.remove();
    toast(j.mensagem || 'Se o email estiver cadastrado, enviaremos o link.', 'ok', 8000);
  } catch (e) {
    err.textContent = e.message;
    if (btn) { btn.disabled = false; btn.textContent = 'Enviar link'; }
  }
}

// ── Explicação das condições ambientais (tela de ensaio) ───────
function explicarCondicoes() {
  const modal = `
    <div class="modal-fundo" onclick="if(event.target===this)this.remove()">
      <div class="modal-caixa" style="max-width:560px">
        <h3>🌦️ Condições ambientais da calibração</h3>

        <p style="margin-top:10px"><b>🌡️ Temperatura (°C)</b><br>
        Afeta o comportamento da balança e das massas (dilatação dos materiais
        e deriva da eletrônica). O registro comprova que a calibração foi feita
        em condição estável, dentro da faixa de operação do equipamento.</p>

        <p style="margin-top:10px"><b>💧 Umidade relativa (%)</b><br>
        Umidade muito alta ou muito baixa interfere na medição (absorção de
        umidade, eletricidade estática, condensação). O registro demonstra que
        o ambiente estava adequado ao ensaio.</p>

        <p style="margin-top:10px"><b>🔵 Pressão atmosférica local (hPa)</b><br>
        O valor registrado é a <b>pressão real no local</b> da calibração —
        diferente da "pressão ao nível do mar" mostrada em aplicativos de tempo.
        Em cidades altas como Belo Horizonte (~850&nbsp;m), a pressão local fica
        em torno de <b>915–925&nbsp;hPa</b>, enquanto os apps mostram
        ~1013–1020&nbsp;hPa (valor corrigido ao nível do mar, uma convenção da
        meteorologia para comparar cidades). Para o certificado, o correto é a
        pressão <b>local</b>: é ela que determina a densidade do ar e o empuxo
        sobre as massas. Um barômetro físico no local marcaria o mesmo valor.</p>

        <p class="dica" style="margin-top:12px">Os valores podem ser sugeridos
        automaticamente (botão 🌡️) a partir de dados meteorológicos da região,
        e ajustados manualmente se você tiver instrumentos no local.</p>

        <div class="rodape-acoes" style="margin-top:14px">
          <button class="btn-primario" onclick="this.closest('.modal-fundo').remove()">Entendi</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', modal);
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
      $('#assin-preview-atual').innerHTML = '';
      atualizarPreviaAssinatura(URL.createObjectURL(blob));
    } else {
      $('#assin-preview-atual').innerHTML = '';
      atualizarPreviaAssinatura();
    }
  } catch (e) {
    $('#assin-preview-atual').innerHTML = '';
    atualizarPreviaAssinatura();
  }
}

// Prévia: como a assinatura vai sair no rodapé do certificado
function atualizarPreviaAssinatura(urlExistente) {
  const box = document.getElementById('assin-previa-cert');
  if (!box) return;
  const img = urlExistente || (assinVazia ? null : $('#assin-canvas').toDataURL('image/png'));
  const nome = (usuario && usuario.nome) || '';
  const papel = (usuario && (PAPEL_ROTULO[usuario.papel] || usuario.papel)) || '';
  const rotulo = urlExistente
    ? 'Assinatura atual — como aparece no certificado:'
    : (img ? 'Prévia da nova assinatura no certificado:' : 'Prévia no certificado:');
  box.innerHTML = `
    <p class="dica" style="margin-bottom:6px">${rotulo}</p>
    <div style="background:#fff;border:1px solid #dfe6ee;border-radius:8px;
                padding:14px 18px 12px;max-width:330px;margin:0 auto;text-align:center">
      <div style="height:66px;display:flex;align-items:flex-end;justify-content:center">
        ${img
          ? `<img src="${img}" alt="assinatura" style="max-height:66px;max-width:250px;object-fit:contain">`
          : '<span class="dica" style="font-size:12px">assine no quadro acima</span>'}
      </div>
      <div style="border-top:1px solid #33475e;width:84%;margin:2px auto 6px"></div>
      <div style="font-size:13px;color:#12233a;font-weight:600">${esc(nome)}</div>
      <div style="font-size:11px;color:#5a6b7d">${esc(papel)}</div>
    </div>
    <p class="dica" style="font-size:11px;text-align:center;margin-top:6px">
      Dica: assine dentro do quadro, sem encostar nas bordas — o traço é recortado no limite.</p>`;
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
  const fim = () => {
    if (assinDesenhando) { assinDesenhando = false; atualizarPreviaAssinatura(); }
  };
  cv.onmousedown = inicio; cv.onmousemove = move; cv.onmouseup = fim; cv.onmouseleave = fim;
  cv.ontouchstart = inicio; cv.ontouchmove = move; cv.ontouchend = fim;
}

function limparAssinatura() {
  if (!assinCtx) return;
  const cv = $('#assin-canvas');
  assinCtx.clearRect(0, 0, cv.width, cv.height);
  assinVazia = true;
  atualizarPreviaAssinatura();
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
      atualizarPreviaAssinatura();
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
  document.getElementById('banner-visualizacao')?.remove();
  document.body.classList.remove('com-banner-vis');
  mostrar('tela-login');
  const el = $('#login-erro');
  if (el) el.textContent = (motivo && motivo !== 'Sessão expirada')
    ? motivo : '';
}


// ── Painel ──────────────────────────────────────────────────────
let certsPainelCache = [];
let graficosDias = 30;
let filtroStatusGestor = '';

// Recarrega a lista do painel preservando o filtro ativo.
// (o irPainel completo reconstroi a tela; aqui so' os dados)
async function atualizarPainel() {
  const btn = document.getElementById('btn-atualizar');
  const rotulo = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Atualizando...'; }
  const rolagem = window.scrollY;
  try {
    const gestor = ehGestor();
    const certs = await api('/certificados');
    certsPainelCache = certs;
    $('#lista-certs').innerHTML = gestor
      ? htmlListaGestor(certs)
      : htmlPainelTecnico(certs, $('#filtro-cliente-tec')?.value || '');
    if (gestor) { renderGraficos(graficosDias); renderVencimentos(); }
    window.scrollTo(0, rolagem);
    const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    toast('Lista atualizada (' + hora + ').', 'ok', 2500);
  } catch (e) {
    toast('Nao foi possivel atualizar: ' + e.message, 'erro');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = rotulo; }
  }
}

async function irPainel() {
  reiniciarInatividade();   // inicia o monitor de inatividade ao entrar
  window._reporSentinela?.();   // realinha o histórico (evita falso "Deseja sair?")
  if (usuario.papel === 'super_admin') { irSuperAdmin(); return; }
  $('#hd-empresa').textContent = usuario.empresa;
  $('#hd-usuario').textContent = usuario.nome;
  mostrar('tela-painel');
  const gestor = ehGestor();
  $('#painel-graficos').style.display = gestor ? '' : 'none';
  $('#btn-relatorios').style.display = gestor ? '' : 'none';
  $('#busca-equip').style.display = gestor ? '' : 'none';
  $('#filtro-cliente-tec').style.display = gestor ? 'none' : '';
  if (gestor) { renderGraficos(graficosDias); avisoContrato(); cardPlano(); avisoPesosPadrao(); avisoBackupEmpresa(); }
  guiaPrimeirosPassos();
  const certs = await api('/certificados');
  certsPainelCache = certs;
  if (gestor) renderVencimentos();
  $('#lista-certs').innerHTML = gestor
    ? htmlListaGestor(certs)
    : htmlPainelTecnico(certs, $('#filtro-cliente-tec').value || '');
}

// ── Aviso diário de pesos-padrão (roadmap item 8; João, 10/08/2026) ──
// Aparece UMA vez por dia, SÓ para admin e RT (ehGestor), no topo do painel:
// pesos com certificado vencido ou vencendo em 30/60 dias. Os prazos são
// calculados aqui da validade (60 porque recalibrar peso em lab RBC demora).
// O ensaio continua como sempre: peso vencido segue bloqueado lá.
async function avisoPesosPadrao() {
  try {
    document.getElementById('aviso-pesos')?.remove();
    const hoje = new Date().toISOString().slice(0, 10);
    if (localStorage.getItem('aviso_pesos_dia') === hoje) return;

    const todos = (await api('/pesos')).filter(p => p.ativo);
    const pesos = todos.filter(p => p.validade);
    const dias = p => Math.floor(
      (new Date(String(p.validade).slice(0, 10)) - new Date(hoje)) / 86400000);
    const vencidos = pesos.filter(p => dias(p) < 0);
    const ate30 = pesos.filter(p => dias(p) >= 0 && dias(p) <= 30);
    const ate60 = pesos.filter(p => dias(p) > 30 && dias(p) <= 60);
    // Pesos sem a MASSA TOTAL do conjunto: sem ela o método da substituição
    // calcula os degraus a menos (João, 13/08/2026).
    const semMassa = todos.filter(p => !(Number(p.massa_total_kg) > 0));
    if (!vencidos.length && !ate30.length && !ate60.length && !semMassa.length) return;

    const cor = vencidos.length ? '#b02a37' : (ate30.length || semMassa.length) ? '#b7791f' : '#5a7183';
    const fundo = vencidos.length ? '#fdecee' : (ate30.length || semMassa.length) ? '#fdf6e3' : '#eef3f8';
    const partes = [];
    if (vencidos.length) partes.push('<b>' + vencidos.length + ' vencido(s)</b>: ' +
      vencidos.slice(0, 4).map(p => esc(p.identificacao)).join(', ') +
      (vencidos.length > 4 ? '…' : ''));
    if (ate30.length) partes.push(ate30.length + ' vence(m) em até 30 dias');
    if (ate60.length) partes.push(ate60.length + ' em até 60 dias');
    if (semMassa.length) partes.push('<b>' + semMassa.length + ' sem a massa total do conjunto</b> (' +
      semMassa.slice(0, 3).map(p => esc(p.identificacao)).join(', ') +
      (semMassa.length > 3 ? '…' : '') + ') — necessária para o método da substituição');

    const div = document.createElement('div');
    div.id = 'aviso-pesos';
    div.style.cssText = 'margin:0 0 12px;padding:11px 14px;border-radius:10px;' +
      'background:' + fundo + ';border:1px solid ' + cor + '33;display:flex;' +
      'gap:10px;align-items:center;flex-wrap:wrap';
    div.innerHTML = `
      <span style="font-size:18px">⚖️</span>
      <span style="flex:1;font-size:13px;color:${cor}">
        <b>Pesos-padrão:</b> ${partes.join(' · ')}.
        ${vencidos.length ? 'Calibração com peso vencido compromete a rastreabilidade.' : ''}</span>
      <button class="btn-mini" onclick="irCadastrosNaAba('pesos')">Ver pesos</button>
      <button style="background:none;border:0;cursor:pointer;font-size:15px;color:${cor}"
        title="Lembrar amanhã"
        onclick="localStorage.setItem('aviso_pesos_dia','${hoje}');
                 this.closest('#aviso-pesos').remove()">✕</button>`;
    const ref = document.getElementById('guia-passos')
      || document.getElementById('painel-graficos');
    (ref?.parentNode || document.getElementById('tela-painel'))
      ?.insertBefore(div, ref || null);
  } catch (e) { console.warn('avisoPesosPadrao:', e); }
}

// ── Lembrete de backup da empresa (João, 20/08/2026) ────────────
// Só admin/RT (mesma trilha da avisoPesosPadrao). Aparece quando a empresa
// nunca gerou exportação ou a última pronta tem mais de 30 dias. O botão
// "Lembrar em 30 dias" faz snooze neste navegador (localStorage).
async function avisoBackupEmpresa() {
  try {
    document.getElementById('aviso-backup')?.remove();
    const ate = localStorage.getItem('aviso_backup_ate');
    const hoje = new Date().toISOString().slice(0, 10);
    if (ate && hoje <= ate) return;
    const lista = await api('/empresa/exportacoes');
    const prontas = (lista || []).filter(e => e.status === 'pronto' && e.pronto_em);
    let diasDesde = null;
    if (prontas.length) {
      const ult = prontas.map(e => e.pronto_em).sort().pop();
      diasDesde = Math.floor((new Date() - new Date(ult)) / 86400000);
      if (diasDesde <= 30) return;
    }
    const texto = diasDesde === null
      ? 'Você ainda não gerou nenhuma exportação dos dados da empresa.'
      : `Sua última exportação foi há ${diasDesde} dias.`;
    const em30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const div = document.createElement('div');
    div.id = 'aviso-backup';
    div.style.cssText = 'margin:0 0 12px;padding:11px 14px;border-radius:10px;' +
      'background:#eef3f8;border:1px solid #5a718333;display:flex;' +
      'gap:10px;align-items:center;flex-wrap:wrap';
    div.innerHTML = `
      <span style="font-size:18px">💾</span>
      <span style="flex:1;font-size:13px;color:#5a7183">
        <b>Backup dos seus dados:</b> ${texto}
        Recomendamos exportar uma cópia dos dados e certificados periodicamente.</span>
      <button class="btn-mini" onclick="irConfigExportacao()">Exportar agora</button>
      <button style="background:none;border:0;cursor:pointer;font-size:13px;color:#5a7183"
        title="Lembrar em 30 dias"
        onclick="localStorage.setItem('aviso_backup_ate','${em30}');
                 this.closest('#aviso-backup').remove()">Lembrar em 30 dias</button>`;
    const ref = document.getElementById('aviso-pesos')
      || document.getElementById('guia-passos')
      || document.getElementById('painel-graficos');
    (ref?.parentNode || document.getElementById('tela-painel'))
      ?.insertBefore(div, ref ? ref.nextSibling : null);
  } catch (e) { console.warn('avisoBackupEmpresa:', e); }
}

// Leva para as Configurações e rola até o card de exportação
function irConfigExportacao() {
  irCadastrosNaAba('config');
  setTimeout(() => {
    const alvoExp = document.getElementById('cf-exports');
    alvoExp?.closest('.card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    carregarExportacoes();
  }, 600);
}


// ── Guia de primeiros passos ──────────────────────────────
// Some sozinho quando a empresa emite o primeiro certificado. Não é um
// tutorial obrigatório: cada passo leva direto para a tela certa, e dá
// para dispensar a qualquer momento.
async function guiaPrimeirosPassos() {
  document.getElementById('guia-passos')?.remove();
  let p;
  try { p = await api('/empresa/primeiros-passos'); } catch (e) { return; }
  if (!p || p.dispensado) return;
  if (Number(p.emitidos) > 0) return;          // já emitiu: guia cumpriu o papel

  const passos = [
    { ok: !!p.assinatura, icone: '✍️', titulo: 'Cadastre sua assinatura',
      texto: 'Ela vai no rodapé do certificado. Dá para desenhar na tela ou enviar uma imagem.',
      acao: 'Abrir assinatura', fn: 'abrirAssinatura()' },
    { ok: Number(p.pesos) > 0, icone: '⚖️', titulo: 'Cadastre os pesos-padrão',
      texto: 'São eles que garantem a rastreabilidade do ensaio — com o número do certificado e a validade.',
      acao: 'Cadastrar pesos', fn: "irCadastrosNaAba('pesos')" },
    { ok: Number(p.clientes) > 0, icone: '🏢', titulo: 'Cadastre um cliente',
      texto: 'Razão social e CNPJ bastam para começar.',
      acao: 'Cadastrar cliente', fn: "irCadastrosNaAba('clientes')" },
    { ok: Number(p.balancas) > 0, icone: '🔢', titulo: 'Cadastre uma balança',
      texto: 'Capacidade e divisão (e) definem os cálculos de erro e a classe de exatidão.',
      acao: 'Cadastrar balança', fn: "irCadastrosNaAba('clientes')" },
    { ok: Number(p.certificados) > 0, icone: '📄', titulo: 'Emita a primeira calibração',
      texto: 'Com o cadastro pronto, o ensaio leva poucos minutos — o sistema calcula erros, EMA e conformidade.',
      acao: '+ Nova calibração', fn: 'novaCalibracao()' },
    { ok: !!p.aviso_venc, icone: '📬', titulo: 'Ative o aviso de vencimento',
      texto: 'O sistema avisa seus clientes quando a calibração está vencendo — e traz o serviço de volta para você.',
      acao: 'Ativar avisos', fn: "irCadastrosNaAba('avisos')" }
  ];
  const feitos = passos.filter(x => x.ok).length;
  const proximo = passos.find(x => !x.ok);
  const pct = Math.round(100 * feitos / passos.length);

  const alvo = document.getElementById('painel-graficos') || $('#lista-certs');
  if (!alvo) return;

  alvo.insertAdjacentHTML('beforebegin', `
    <div id="guia-passos" style="background:#fff;border:1px solid #dde5ec;border-left:4px solid #35b6e8;
         border-radius:10px;padding:14px 16px;margin:8px 0">
      <div class="barra" style="align-items:flex-start">
        <div>
          <h3 style="margin:0">🚀 Primeiros passos${feitos ? ` — ${feitos} de ${passos.length}` : ''}</h3>
          <p class="dica" style="margin:2px 0 0">${proximo
            ? 'Falta pouco para o seu primeiro certificado. Você pode fazer agora ou depois.'
            : 'Tudo pronto! É só emitir a primeira calibração.'}</p>
        </div>
        <button class="btn-mini" onclick="dispensarGuia()"
          title="Não mostrar mais este guia">✕ Dispensar</button>
      </div>

      <div style="background:#eef2f7;border-radius:99px;height:6px;margin:10px 0 12px;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:#0f7a52;transition:width .4s"></div>
      </div>

      ${passos.map((x, i) => `
        <div style="display:flex;gap:11px;align-items:flex-start;padding:9px 0;
             ${i ? 'border-top:1px solid #f1f5f9;' : ''}${x.ok ? 'opacity:.55' : ''}">
          <span style="flex:0 0 26px;height:26px;border-radius:50%;display:flex;align-items:center;
               justify-content:center;font-size:14px;background:${x.ok ? '#e6f4ec' : '#f4f7fb'};
               border:1px solid ${x.ok ? '#bfe3d2' : '#dde5ec'}">${x.ok ? '✓' : x.icone}</span>
          <span style="flex:1;min-width:150px">
            <b style="${x.ok ? 'text-decoration:line-through' : ''}">${x.titulo}</b>
            ${x.ok ? '' : `<br><span class="dica">${x.texto}</span>`}
          </span>
          ${x.ok ? '' : `<button class="btn-mini${x === proximo ? ' btn-primario' : ''}"
            onclick="${x.fn}">${x.acao}</button>`}
        </div>`).join('')}
      ${Number(p.pesos_vencidos) > 0 ? `
        <p class="dica" style="margin-top:10px;color:#b7791f">⚠️ ${p.pesos_vencidos}
          peso(s)-padrão com certificado vencido — calibração feita com peso vencido
          compromete a rastreabilidade.</p>` : ''}
    </div>`);
}

// Abre a tela de cadastros já na aba certa (usada pelo guia)
function irCadastrosNaAba(aba) {
  irCadastros();
  if (aba && aba !== 'clientes') abrirTab(aba);
}

async function dispensarGuia() {
  if (!await modalConfirmar('Dispensar o guia',
    'O guia de primeiros passos não aparecerá mais.<br><br>' +
    '<span class="dica">Ele sumiria sozinho depois do primeiro certificado emitido.</span>',
    { textoSim: 'Dispensar', textoNao: 'Manter' })) return;
  try {
    await api('/empresa/primeiros-passos/dispensar',
      { method: 'PUT', body: JSON.stringify({ dispensar: true }) });
    document.getElementById('guia-passos')?.remove();
  } catch (e) { toast(e.message, 'erro'); }
}

// Card "Seu plano": consumo do plano contratado + pendência financeira
async function cardPlano() {
  let p; try { p = await api('/empresa/plano'); } catch (e) { return; }
  document.getElementById('card-plano')?.remove();
  document.getElementById('banner-cobranca')?.remove();
  const alvo = document.getElementById('painel-graficos');
  if (!alvo || !p) return;
  if (p.cobrancaVencida)
    alvo.insertAdjacentHTML('beforebegin', `<div id="banner-cobranca"
      style="background:#f8d7da;color:#721c24;padding:10px 14px;border-radius:8px;margin:8px 0">
      💳 Há uma mensalidade em aberto. Regularize para evitar a suspensão automática do acesso.
      Dúvidas: (31) 3357-4000.</div>`);
  if (p.semContrato) {
    const dias = p.diasRestantes;
    const urgente = dias != null && dias <= 5;
    alvo.insertAdjacentHTML('beforebegin', `<div id="card-plano"
      style="background:${urgente ? '#f8d7da' : '#fff3cd'};color:${urgente ? '#721c24' : '#856404'};
             padding:10px 14px;border-radius:8px;margin:8px 0">
      ⏳ <b>Período de avaliação</b>${dias != null
        ? ` — ${dias > 0 ? `restam <b>${dias} dia(s)</b>` : '<b>encerrado</b>'}`
        : ''}. Contrate um plano com a Total Scale — (31) 3357-4000 — para uso contínuo.
      ${usuario?.papel === 'admin' ? `<button class="btn-mini" style="margin-left:10px" onclick="telaPlanoCobrancas()">💳 Plano e cobranças</button>` : ''}</div>`);
    return;
  }
  const barra = (usado, max) => {
    if (max == null) return `<b>${usado}</b> <span class="dica">· ilimitado</span>`;
    const pct = Math.min(100, Math.round(100 * usado / max));
    const cor = pct >= 100 ? '#b02a37' : pct >= 80 ? '#c88a00' : '#146c43';
    return `<div style="display:flex;align-items:center;gap:8px">
      <div style="flex:1;height:8px;background:#eef1f5;border-radius:99px;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:${cor}"></div></div>
      <span style="white-space:nowrap"><b>${usado}</b>/${max}</span></div>`;
  };
  alvo.insertAdjacentHTML('beforebegin', `<div id="card-plano" class="card"
      style="margin:8px 0;padding:12px 16px">
    <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:14px;align-items:center">
      <b style="text-transform:capitalize;white-space:nowrap">📋 Plano ${p.plano || 'personalizado'}
        ${usuario?.papel === 'admin' ? `<button class="btn-mini" style="margin-left:8px" onclick="telaPlanoCobrancas()">💳 Plano e cobranças</button>` : ''}</b>
      <div style="flex:1;min-width:200px"><span class="dica">Certificados no mês</span>${barra(p.certsMes, p.maxCertsMes)}</div>
      <div style="flex:1;min-width:170px"><span class="dica">Usuários ativos</span>${barra(p.usuarios, p.maxUsuarios)}</div>
    </div>
    ${p.maxCertsMes != null && p.certsMes >= p.maxCertsMes * 0.8 && p.certsMes < p.maxCertsMes
      ? `<p class="dica" style="color:#c88a00;margin:6px 0 0">⚠️ Você já usou ${p.certsMes} de ${p.maxCertsMes} certificados do mês. Precisa de mais? Fale com a Total Scale.</p>` : ''}
    ${p.maxCertsMes != null && p.certsMes >= p.maxCertsMes
      ? `<p class="dica" style="color:#b02a37;margin:6px 0 0">🚫 Limite mensal de certificados atingido (${p.certsMes}/${p.maxCertsMes}). Fale com a Total Scale para ampliar.</p>` : ''}
  </div>`);
}

// Aba "Plano e cobranças" do admin: contrato vigente + histórico de mensalidades
async function telaPlanoCobrancas() {
  let d;
  try { d = await api('/empresa/cobrancas'); }
  catch (e) { toast(e.message, 'erro'); return; }
  const ct = d.contrato;
  const stCob = s => ({
    pendente: '<span class="badge">Pendente</span>',
    pago: '<span class="badge ok">Paga</span>',
    vencido: '<span class="badge rep">Vencida</span>'
  }[s] || s);
  const dbr = v => v ? new Date(String(v).substring(0, 10) + 'T00:00:00').toLocaleDateString('pt-BR') : '—';
  const money = v => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  let blocoContrato = '<p class="dica">Sua empresa está no período de avaliação, sem contrato ativo.</p>';
  if (ct) {
    // valor efetivo do mês corrente (desconto vigente)
    const hoje = new Date(); const comp = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    const descAte = ct.desconto_ate ? new Date(String(ct.desconto_ate).substring(0, 10) + 'T00:00:00') : null;
    const temDesc = Number(ct.desconto_valor) > 0 && (!descAte || comp <= descAte);
    const efetivo = !temDesc ? Number(ct.valor)
      : ct.desconto_tipo === 'percentual'
        ? Number(ct.valor) * (1 - Math.min(Number(ct.desconto_valor), 100) / 100)
        : Math.max(0, Number(ct.valor) - Number(ct.desconto_valor));
    blocoContrato = `
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <div style="flex:1;min-width:150px;background:#f7f9fb;border:1px solid #dde5ec;border-radius:10px;padding:8px 12px">
          <span class="dica">Plano</span><br><b style="text-transform:capitalize">${ct.plano || 'personalizado'}</b></div>
        <div style="flex:1;min-width:150px;background:#f7f9fb;border:1px solid #dde5ec;border-radius:10px;padding:8px 12px">
          <span class="dica">Mensalidade atual</span><br><b>${money(efetivo)}</b>
          ${temDesc ? `<span class="dica">(tabela ${money(ct.valor)})</span>` : ''}</div>
        <div style="flex:1;min-width:150px;background:#f7f9fb;border:1px solid #dde5ec;border-radius:10px;padding:8px 12px">
          <span class="dica">Vencimento</span><br><b>todo dia ${ct.dia_vencimento || 10}</b></div>
      </div>
      ${temDesc ? `<p class="dica" style="margin-top:8px">🏷️ Desconto vigente: <b>${ct.desconto_tipo === 'percentual'
          ? `−${Number(ct.desconto_valor)}%` : `−${money(ct.desconto_valor)}`}</b>${ct.desconto_ate
          ? ` até <b>${dbr(ct.desconto_ate)}</b> — depois a mensalidade volta a ${money(ct.valor)}` : ' (permanente)'}.</p>` : ''}
      <p class="dica" style="margin-top:6px">🌐 <b>Portal do Cliente</b>: ${
        ct.plano === 'essencial'
          ? 'não incluído no Essencial — <b>a partir do Profissional</b> seus clientes baixam os certificados sozinhos, com a sua marca.'
          : 'incluído — convide seus clientes em <b>Cadastros → Clientes → 🔗 Portal</b>.'}</p>
      <p class="dica" style="margin-top:6px">Limites do plano: ${ct.max_usuarios != null
        ? ct.max_usuarios + ' usuário(s)' : 'usuários ilimitados'} ·
        ${ct.max_certs_mes != null ? ct.max_certs_mes + ' certificados/mês' : 'certificados ilimitados'} ·
        vigência desde ${dbr(ct.inicio)}${ct.fim ? ' até ' + dbr(ct.fim) : ' (prazo indeterminado)'}.</p>`;
  }

  const linhas = (d.cobrancas || []).map(cb => `<tr>
      <td>${new Date(String(cb.competencia).substring(0, 10) + 'T00:00:00')
        .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</td>
      <td>${dbr(cb.vencimento)}</td>
      <td class="num">${money(cb.valor)}</td>
      <td>${stCob(cb.status)}</td>
      <td>${cb.pago_em ? dbr(cb.pago_em) : '—'}</td>
    </tr>`).join('');

  const modal = `
    <div class="modal-fundo" onclick="if(event.target===this)this.remove()">
      <div class="modal-caixa" style="max-width:640px">
        <h3>💳 Plano e cobranças</h3>
        ${blocoContrato}
        <h4 style="margin-top:14px">Mensalidades</h4>
        ${linhas ? `
        <div class="tabela-scroll" style="max-height:300px">
          <table>
            <thead><tr><th>Competência</th><th>Vencimento</th><th class="num">Valor</th>
              <th>Situação</th><th>Paga em</th></tr></thead>
            <tbody>${linhas}</tbody>
          </table>
        </div>` : '<p class="dica">Nenhuma cobrança registrada ainda.</p>'}
        <p class="dica" style="margin-top:8px">Dúvidas sobre valores ou pagamento?
          Fale com a Total Scale: <b>(31) 3357-4000</b>.</p>
        <div class="rodape-acoes" style="margin-top:10px">
          <button onclick="this.closest('.modal-fundo').remove()">Fechar</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', modal);
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
  renderSolicitacoes();          // pedidos vindos do portal do cliente
  const alvo = $('#painel-vencimentos');
  if (!alvo) return;
  if (!vs || vs.length === 0) { alvo.innerHTML = ''; return; }
  window._venc = vs;
  window._vencF = window._vencF || { faixa: null, cidade: '', busca: '', abertos: {} };
  desenharVencimentos();
}

// Pedidos de calibração feitos pelos clientes no portal
async function renderSolicitacoes() {
  const alvo = $('#painel-solicitacoes');
  if (!alvo) return;
  let lista;
  try { lista = await api('/solicitacoes'); }
  catch (e) { alvo.innerHTML = ''; return; }
  if (!lista || !lista.length) { alvo.innerHTML = ''; return; }
  const zap = t => {
    const d = String(t || '').replace(/\D/g, '');
    return d.length >= 10 ? 'https://wa.me/' + (d.length >= 12 ? d : '55' + d) : null;
  };
  alvo.innerHTML = `
    <div class="card" style="border-left:4px solid #0f7a52">
      <div class="barra"><h3>📬 Solicitações dos clientes (${lista.length})</h3>
        <button class="btn-mini" onclick="renderSolicitacoes()">↻</button></div>
      <p class="dica">Pedidos feitos pelos próprios clientes no portal — responder rápido
        costuma ser a diferença entre renovar e perder o serviço.</p>
      ${lista.map(s => `
        <div style="border:1px solid #e3eaf2;border-radius:10px;padding:11px 13px;margin-top:9px">
          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-start">
            <span style="flex:1;min-width:180px">
              <b>${esc(s.cliente)}</b>
              ${s.cidade ? `<span class="dica"> · 📍 ${esc(s.cidade)}</span>` : ''}
              <br><span class="dica">pedido por ${esc(s.solicitante || '—')} ·
                ${s.dias === 0 ? 'hoje' : s.dias === 1 ? 'ontem' : `há ${s.dias} dias`}</span>
              ${s.balancas ? `<br><span class="dica">⚖️ ${esc(s.balancas)}</span>` : ''}
              ${s.mensagem ? `<br><i class="dica">"${esc(s.mensagem)}"</i>` : ''}
            </span>
            <span style="display:flex;gap:6px;flex-wrap:wrap">
              ${zap(s.telefone) ? `<a class="btn-mini" target="_blank" rel="noopener"
                 href="${zap(s.telefone)}">💬</a>` : ''}
              ${s.email_cliente ? `<a class="btn-mini" href="mailto:${esc(s.email_cliente)}">✉️</a>` : ''}
              <button class="btn-mini" onclick="atenderSolicitacao('${s.id}','${esc(s.cliente).replace(/'/g, "\\'")}')">
                ✔ Atender</button>
            </span>
          </div>
        </div>`).join('')}
    </div>`;
}

async function atenderSolicitacao(id, cliente) {
  const obs = prompt(`Marcar o pedido de ${cliente} como atendido.\n\n` +
    'Observação interna (opcional) — ex.: "agendado para 12/08, técnico Marcelo":');
  if (obs === null) return;
  try {
    await api('/solicitacoes/' + id, { method: 'PUT',
      body: JSON.stringify({ situacao: 'concluida', observacao: obs || null }) });
    toast('Pedido marcado como atendido ✓', 'ok');
    renderSolicitacoes();
  } catch (e) { toast(e.message, 'erro'); }
}

// Dias até o vencimento (negativo = já venceu)
function diasVenc(v) {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const d = new Date(String(v.vence_em).substring(0, 10) + 'T00:00:00');
  return Math.round((d - hoje) / 86400000);
}

function filtrarFaixaVenc(f) {
  window._vencF.faixa = window._vencF.faixa === f ? null : f;
  desenharVencimentos();
}
function filtrarCidadeVenc(c) { window._vencF.cidade = c; desenharVencimentos(); }
function buscarVenc(t) { window._vencF.busca = t; desenharVencimentos(); }
function alternarGrupoVenc(chave, aberto) { window._vencF.abertos[chave] = aberto; }

// Monta a mensagem de WhatsApp já com as balanças e a data
function whatsVenc(tel, balancas, dataBr) {
  const num = String(tel || '').replace(/\D/g, '');
  const fone = num.length >= 12 ? num : '55' + num;
  const lista = balancas.length > 1
    ? balancas.slice(0, -1).join(', ') + ' e ' + balancas[balancas.length - 1]
    : balancas[0];
  const msg = `Olá! Passando para lembrar que a calibração ${balancas.length > 1
    ? 'das balanças ' + lista : 'da balança ' + lista} vence em ${dataBr}. ` +
    'Podemos agendar a visita?';
  return `https://wa.me/${fone}?text=${encodeURIComponent(msg)}`;
}

function desenharVencimentos() {
  const alvo = $('#painel-vencimentos');
  const vs = window._venc || [];
  const f = window._vencF;

  // ── agrupa por cliente, guardando o mais urgente de cada um ──
  const mapa = new Map();
  vs.forEach(v => {
    const ch = v.cliente_id || v.cliente;
    if (!mapa.has(ch)) mapa.set(ch, { chave: String(ch), cliente: v.cliente,
      telefone: v.telefone, email: v.email,
      cidade: [v.cidade, v.uf].filter(Boolean).join('/'), itens: [] });
    mapa.get(ch).itens.push(v);
  });
  let grupos = [...mapa.values()].map(g => {
    g.itens.sort((a, b) => diasVenc(a) - diasVenc(b));
    g.dias = diasVenc(g.itens[0]);
    g.vencidas = g.itens.filter(i => diasVenc(i) < 0).length;
    return g;
  }).sort((a, b) => a.dias - b.dias);

  // ── contadores por faixa (sempre do total, não do filtrado) ──
  const cont = { vencidas: 0, d15: 0, d30: 0, d60: 0 };
  vs.forEach(v => { const d = diasVenc(v);
    if (d < 0) cont.vencidas++; else if (d <= 15) cont.d15++;
    else if (d <= 30) cont.d30++; else cont.d60++; });

  // ── aplica filtros ──
  const naFaixa = d => !f.faixa
    || (f.faixa === 'vencidas' && d < 0)
    || (f.faixa === 'd15' && d >= 0 && d <= 15)
    || (f.faixa === 'd30' && d > 15 && d <= 30)
    || (f.faixa === 'd60' && d > 30);
  const termo = (f.busca || '').trim().toLowerCase();
  grupos = grupos.map(g => {
    const itens = g.itens.filter(i => naFaixa(diasVenc(i)));
    return { ...g, itens };
  }).filter(g => g.itens.length
    && (!f.cidade || g.cidade === f.cidade)
    && (!termo || (g.cliente + ' ' + g.cidade + ' ' +
        g.itens.map(i => i.balanca + ' ' + i.numero).join(' ')).toLowerCase().includes(termo)));

  const cidades = [...new Set([...mapa.values()].map(g => g.cidade).filter(Boolean))].sort();
  const totalBal = grupos.reduce((s, g) => s + g.itens.length, 0);

  const chip = (id, rot, n, cor, fundo) => n === 0 ? '' : `
    <button class="btn-mini" onclick="filtrarFaixaVenc('${id}')"
      style="border:1px solid ${cor}55;background:${f.faixa === id ? cor : fundo};
             color:${f.faixa === id ? '#fff' : cor};font-weight:600">
      ${rot} <b>${n}</b></button>`;

  const rotuloDias = d => d < 0
    ? `<span class="venc-vencido">vencida há ${-d} dia${-d === 1 ? '' : 's'}</span>`
    : d === 0 ? '<span class="venc-vencido">vence hoje</span>'
    : `<span class="venc-prazo">vence em ${d} dia${d === 1 ? '' : 's'}</span>`;

  alvo.innerHTML = `
    <div class="card venc-card">
      <div class="barra" style="align-items:flex-start">
        <div>
          <h3>⚠️ Calibrações vencendo</h3>
          <p class="dica">${grupos.length} cliente${grupos.length === 1 ? '' : 's'} ·
            ${totalBal} balança${totalBal === 1 ? '' : 's'} — momento de contatar e agendar.</p>
        </div>
      </div>

      <div class="barra-btns" style="flex-wrap:wrap;gap:6px;margin:4px 0 10px">
        ${chip('vencidas', '🔴 Vencidas', cont.vencidas, '#b02a37', '#fdf0f1')}
        ${chip('d15', '🟠 Até 15 dias', cont.d15, '#b7791f', '#fdf6ea')}
        ${chip('d30', '🟡 16 a 30 dias', cont.d30, '#8a7100', '#fbf8e8')}
        ${chip('d60', '⚪ 31 a 60 dias', cont.d60, '#43607f', '#f4f7fb')}
        ${f.faixa ? `<button class="btn-mini" onclick="filtrarFaixaVenc('${f.faixa}')">✕ limpar</button>` : ''}
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        <input type="search" value="${esc(f.busca)}" oninput="buscarVenc(this.value)"
          placeholder="🔍 cliente, balança ou nº do certificado"
          style="flex:1;min-width:180px;padding:8px 11px;border:1px solid #dde5ec;
                 border-radius:9px;font:inherit;font-size:.92rem">
        ${cidades.length > 1 ? `
        <select onchange="filtrarCidadeVenc(this.value)"
          style="padding:8px 11px;border:1px solid #dde5ec;border-radius:9px;font:inherit;font-size:.92rem">
          <option value="">📍 todas as cidades</option>
          ${cidades.map(c => `<option value="${esc(c)}" ${f.cidade === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
        </select>` : ''}
      </div>

      ${!grupos.length ? '<p class="dica">Nenhuma balança nesta seleção.</p>' : grupos.map(g => {
        const dataBr = new Date(String(g.itens[0].vence_em).substring(0, 10) + 'T00:00:00')
          .toLocaleDateString('pt-BR');
        const nomes = g.itens.map(i => i.balanca);
        return `
        <details class="venc-grupo" style="border:1px solid #e3eaf2;border-radius:10px;
                 margin-bottom:8px;background:#fff" ${f.abertos[g.chave] ? 'open' : ''}
                 ontoggle="alternarGrupoVenc('${g.chave}', this.open)">
          <summary style="cursor:pointer;padding:11px 13px;display:flex;gap:10px;
                   align-items:center;flex-wrap:wrap;list-style:none">
            <span style="flex:1;min-width:170px">
              <b>${esc(g.cliente)}</b>
              ${g.cidade ? `<span class="dica"> · 📍 ${esc(g.cidade)}</span>` : ''}
              <br><span class="dica">${g.itens.length} balança${g.itens.length === 1 ? '' : 's'}${
                g.vencidas ? ` · <b style="color:#b02a37">${g.vencidas} vencida${g.vencidas === 1 ? '' : 's'}</b>` : ''}</span>
            </span>
            <span style="text-align:right;white-space:nowrap">${rotuloDias(g.dias)}<br>
              <span class="dica">${dataBr}</span></span>
            <span style="display:flex;gap:6px" onclick="event.stopPropagation()">
              ${g.telefone ? `<a class="btn-mini" target="_blank" rel="noopener"
                 href="${whatsVenc(g.telefone, nomes, dataBr)}"
                 title="Abrir WhatsApp com a mensagem pronta">💬</a>` : ''}
              ${g.email ? `<a class="btn-mini" href="mailto:${esc(g.email)}?subject=${
                 encodeURIComponent('Calibração vencendo — ' + g.cliente)}&body=${
                 encodeURIComponent('Olá!\n\nA calibração ' + (nomes.length > 1
                   ? 'das balanças ' + nomes.join(', ') : 'da balança ' + nomes[0]) +
                   ' vence em ' + dataBr + '.\n\nPodemos agendar a visita?')}"
                 title="Escrever e-mail">✉️</a>` : ''}
            </span>
          </summary>
          <div style="border-top:1px solid #eef2f7">
            ${g.itens.map(v => {
              const d = diasVenc(v);
              const dv = new Date(String(v.vence_em).substring(0, 10) + 'T00:00:00');
              return `<div class="venc-linha">
                <span>⚖️ ${esc(v.balanca)} <span class="dica">· ${esc(v.numero)}</span></span>
                <span class="venc-data">${rotuloDias(d)}<br>
                  <span class="dica">${dv.toLocaleDateString('pt-BR')}</span></span>
              </div>`;
            }).join('')}
          </div>
        </details>`;
      }).join('')}
    </div>`;
}

let filtroTipoGestor = null;
function filtrarTipoGestor(v) {
  filtroTipoGestor = filtroTipoGestor === v ? null : v;
  $('#lista-certs').innerHTML = htmlListaGestor(certsPainelCache);
}
async function filtrarStatusGestor(st) {
  filtroStatusGestor = (filtroStatusGestor === st) ? '' : st;
  // Recarrega do servidor: a lista vem com LIMIT 100 e, sem pedir o status
  // ao banco, os registros antigos daquele status ficavam fora da fatia —
  // o filtro mostrava menos do que o card do painel contava. João, 01/09/2026.
  const lista = $('#lista-certs');
  if (lista) lista.innerHTML = '<p class="dica">Carregando…</p>';
  try {
    certsPainelCache = await api('/certificados'
      + (filtroStatusGestor ? '?status=' + encodeURIComponent(filtroStatusGestor) : ''));
  } catch { /* mantém o cache anterior se a busca falhar */ }
  if (lista) lista.innerHTML = htmlListaGestor(certsPainelCache || []);
}

let filtroOS = '', filtroEmisDe = '', filtroEmisAte = '';
function filtrarEmissao() {
  filtroEmisDe = document.getElementById('f-emis-de')?.value || '';
  filtroEmisAte = document.getElementById('f-emis-ate')?.value || '';
  $('#lista-certs').innerHTML = htmlListaGestor(certsPainelCache || []);
}
function limparFiltroEmissao() {
  filtroEmisDe = ''; filtroEmisAte = '';
  $('#lista-certs').innerHTML = htmlListaGestor(certsPainelCache || []);
}
function filtrarPorOS(v) {
  filtroOS = v || '';
  const foco = document.activeElement === document.getElementById('busca-os');
  $('#lista-certs').innerHTML = htmlListaGestor(certsPainelCache || []);
  if (foco) {
    const inp = document.getElementById('busca-os');
    if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  }
}

function htmlListaGestor(certs) {
  const st = filtroStatusGestor;
  // Cancelados so aparecem quando o filtro "Cancelados" esta ativo
  let filtrados = st ? certs.filter(c => c.status === st)
                     : certs.filter(c => c.status !== 'cancelado');
  if (filtroTipoGestor) filtrados = filtrados.filter(c =>
    filtroTipoGestor === 'rbc' ? c.emitir_rbc : !c.emitir_rbc);
  if (filtroOS.trim()) {
    const t = filtroOS.trim().toLowerCase();
    filtrados = filtrados.filter(c => (c.ordem_servico || '').toLowerCase().includes(t));
  }
  // Período de EMISSÃO (João, 11/08/2026): compara datas em ISO (aaaa-mm-dd)
  if (filtroEmisDe || filtroEmisAte)
    filtrados = filtrados.filter(c => {
      if (!c.data_emissao) return false;
      const dt = String(c.data_emissao).slice(0, 10);
      return (!filtroEmisDe || dt >= filtroEmisDe) && (!filtroEmisAte || dt <= filtroEmisAte);
    });
  // O servidor devolve no máximo 300 registros por consulta; avisa para
  // ninguém achar que a lista está completa quando bate no teto.
  const noTeto = certs.length >= 300;
  const btn = (v, rot) => `<button class="btn-mini ${st === v ? 'periodo-ativo' : ''}"
      onclick="filtrarStatusGestor('${v}')">${rot}</button>`;
  const filtros = `
    <div style="background:#f7f9fb;border:1px solid #e3e8ee;border-radius:10px;
                padding:8px 10px;margin-bottom:12px">
      <div class="barra-btns" style="flex-wrap:wrap;gap:5px">
        ${btn('rascunho', 'Rascunhos')} ${btn('aguardando_aprovacao', '⏳ Pendentes')}
        ${btn('emitido', 'Emitidos')} ${btn('substituido', 'Substituídos')} ${btn('cancelado', '🚫 Cancelados')}
        <span style="border-left:1px solid #d5dde5;margin:0 2px"></span>
        ${['padrao','rbc'].map(v => `<button class="btn-mini ${filtroTipoGestor === v ? 'periodo-ativo' : ''}"
          onclick="filtrarTipoGestor('${v}')">${v === 'rbc' ? '🟢 RBC' : '⚖️ Padrão'}</button>`).join(' ')}
      </div>
      <div class="barra-btns" style="flex-wrap:wrap;gap:6px;margin-top:7px;align-items:center">
        <input type="search" id="busca-os" value="${esc(filtroOS)}" placeholder="📋 ordem de serviço"
          oninput="filtrarPorOS(this.value)" onclick="event.stopPropagation()"
          style="width:auto;max-width:160px;padding:5px 9px;border:1px solid #dde5ec;
                 border-radius:7px;font:inherit;font-size:.85rem">
        <span class="dica" style="margin-left:2px">📅 Emissão</span>
        <input type="date" id="f-emis-de" value="${filtroEmisDe}" onchange="filtrarEmissao()"
          onclick="event.stopPropagation()" title="Emitidos a partir de"
          style="width:auto;max-width:145px;padding:4px 6px;border:1px solid #dde5ec;
                 border-radius:7px;font:inherit;font-size:.82rem">
        <span class="dica">até</span>
        <input type="date" id="f-emis-ate" value="${filtroEmisAte}" onchange="filtrarEmissao()"
          onclick="event.stopPropagation()" title="Emitidos até"
          style="width:auto;max-width:145px;padding:4px 6px;border:1px solid #dde5ec;
                 border-radius:7px;font:inherit;font-size:.82rem">
        ${filtroEmisDe || filtroEmisAte ? `<button class="btn-mini" title="Limpar período"
          onclick="event.stopPropagation(); limparFiltroEmissao()">✕ limpar</button>` : ''}
      </div>
      ${noTeto ? `<p class="dica" style="margin:6px 0 0">Mostrando as 300 calibrações
        mais recentes. Use os filtros de status, tipo, ordem de serviço ou período
        para encontrar as demais.</p>` : ''}
    </div>`;
  if (filtrados.length === 0)
    return filtros + '<p class="dica">Nenhuma calibração ' +
      (filtroOS.trim() ? `com a ordem de serviço “${esc(filtroOS)}”.`
        : st ? 'neste status.' : 'ainda. Clique em "+ Nova calibração".') + '</p>';
  return filtros + filtrados.map(c => {
    const detalhes = [
      [c.marca, c.modelo].filter(Boolean).join(' '),
      c.capacidade != null ? `Cap. ${fmt(c.capacidade)} ${normUnid(c.unidade)}` : '',
      c.num_serie ? `Série ${c.num_serie}` : '',
      c.numero_inmetro ? `Inmetro ${c.numero_inmetro}` : ''
    ].filter(Boolean).join(' · ');
    const selEmail = c.status === 'emitido' ? `<input type="checkbox"
        class="sel-cert" data-id="${c.id}" data-cliente="${esc(c.cliente)}"
        data-cliente-id="${c.cliente_id || ''}" data-numero="${esc(c.numero || '')}"
        ${window._selCerts?.has(c.id) ? 'checked' : ''}
        onclick="event.stopPropagation(); alternarSelCert(this)"
        title="Selecionar para envio por e-mail"
        style="width:17px;height:17px;margin-right:9px;flex-shrink:0;cursor:pointer">` : '';
    return `
      <div class="item-cert${c.emitir_rbc ? ' item-rbc' : ''}" onclick="abrirCert('${c.id}','${c.status}')"
        style="align-items:center">
        ${selEmail}<span style="flex:1"><b>${esc(c.cliente)}</b> · ${esc(c.balanca)}
          ${detalhes ? `<br><span class="dica">${esc(detalhes)}</span>` : ''}
          <br><span class="dica">Téc.: ${esc(c.tecnico)}${c.numero ? ' · ' + c.numero : ''}${
            c.data_calibracao ? ' · 📅 Calibrado: ' + new Date(c.data_calibracao).toLocaleDateString('pt-BR') : ''}${
            c.data_emissao ? ' · Emitido: ' + new Date(c.data_emissao).toLocaleDateString('pt-BR') : ''}</span>
          ${c.ordem_servico || c.endereco_calibracao ? `<br><span class="dica">${
            c.ordem_servico ? `📋 OS ${esc(c.ordem_servico)}` : ''}${
            c.ordem_servico && c.endereco_calibracao ? ' · ' : ''}${
            c.endereco_calibracao ? `📍 ${esc(c.endereco_calibracao)}` : ''}</span>` : ''}</span>
        <span>${c.emitir_rbc ? '<span class="badge-rbc-inline" style="background:#0a5c40;color:#fff;font-size:9.5px;padding:2px 6px;border-radius:8px;font-weight:700;margin-right:4px">RBC</span>' : ''}<span class="st st-${c.status}">${rotuloStatus(c.status)}</span></span>
      </div>`;
  }).join('');
}

// ── Envio de certificados por e-mail em LOTE (João, 11/08/2026) ──
// Admin/RT selecionam certificados EMITIDOS na lista (checkbox), de UM
// mesmo cliente, e enviam num único e-mail: anexos até ~10 MB; acima
// disso o servidor manda os links de validação (decisão no worker).
window._selCerts = window._selCerts || new Map();   // id -> {cliente, clienteId, numero}
function alternarSelCert(chk) {
  const { id, cliente, clienteId, numero } = chk.dataset;
  if (chk.checked) window._selCerts.set(id, { cliente, clienteId, numero });
  else window._selCerts.delete(id);
  barraSelCerts();
}
function limparSelCerts() {
  window._selCerts.clear();
  document.querySelectorAll('.sel-cert:checked').forEach(c => c.checked = false);
  barraSelCerts();
}
function barraSelCerts() {
  document.getElementById('barra-sel-certs')?.remove();
  const n = window._selCerts.size;
  if (!n) return;
  const clientes = new Set([...window._selCerts.values()].map(v => v.cliente));
  const b = document.createElement('div');
  b.id = 'barra-sel-certs';
  b.style.cssText = 'position:fixed;bottom:14px;left:50%;transform:translateX(-50%);' +
    'z-index:9000;background:#164066;color:#fff;border-radius:12px;padding:10px 16px;' +
    'display:flex;gap:10px;align-items:center;box-shadow:0 6px 24px rgba(0,0,0,.3);' +
    'max-width:94vw;flex-wrap:wrap';
  b.innerHTML = clientes.size > 1
    ? `<span style="font-size:13px">⚠️ ${n} certificados de <b>${clientes.size} clientes</b> —
         o envio é por cliente. Deixe só um cliente selecionado.</span>
       <button class="btn-mini" onclick="limparSelCerts()">Limpar</button>`
    : `<span style="font-size:13px"><b>${n}</b> certificado${n > 1 ? 's' : ''} de
         <b>${esc([...clientes][0])}</b></span>
       <button class="btn-mini" style="background:#fff;color:#164066;font-weight:600"
         onclick="abrirModalEnvioLote()">📧 Enviar por e-mail</button>
       <button class="btn-mini" onclick="limparSelCerts()">✕</button>`;
  document.body.appendChild(b);
}
async function abrirModalEnvioLote() {
  const sel = [...window._selCerts.entries()];
  let clienteId = sel[0][1].clienteId;
  const cliente = sel[0][1].cliente;
  // Blindagem: se a lista não trouxe o cliente_id, acha pelo NOME
  window._envListaCli = await api('/clientes').catch(() => []);
  if (!clienteId) {
    const alvo = String(cliente || '').trim().toLowerCase();
    clienteId = (window._envListaCli.find(c =>
      String(c.razao_social || '').trim().toLowerCase() === alvo) || {}).id || '';
  }
  // Fontes de destinatários: e-mail do CADASTRO do cliente + aba Contatos
  // + contatos do portal — mesclados sem e-mail duplicado.
  let contatos = [];
  if (!clienteId) console.warn('envio-lote: cliente não localizado nem por nome');
  if (clienteId) {
    const [cad, portal] = await Promise.all([
      api('/clientes/' + clienteId + '/contatos').catch(() => []),
      api('/portal-convites/' + clienteId + '/contatos').catch(() => [])
    ]);
    const cli = (window._envListaCli || []).find(c => c.id === clienteId);
    const fontes = [
      ...(cli?.email ? [{ nome: (cli.razao_social || 'Cliente') + ' — e-mail do cadastro',
                          email: cli.email }] : []),
      ...(cad || []), ...(portal || [])
    ];
    console.warn('envio-lote: cadastro=', cli?.email || '-',
      '| contatos=', (cad || []).length, '| portal=', (portal || []).length);
    const vistos = new Set();
    for (const ct of fontes) {
      const em = String(ct.email || '').trim().toLowerCase();
      if (em && em.includes('@') && !vistos.has(em)) {
        vistos.add(em);
        contatos.push(ct);
      }
    }
  }
  document.getElementById('modal-envio-lote')?.remove();
  const m = document.createElement('div');
  m.className = 'modal-fundo';
  m.id = 'modal-envio-lote';
  m.innerHTML = `
    <div class="modal-caixa" style="max-width:440px">
      <h3 style="margin-top:0">📧 Enviar ${sel.length} certificado${sel.length > 1 ? 's' : ''} por e-mail</h3>
      <p class="dica" style="margin:0 0 8px">Cliente: <b>${esc(cliente)}</b> ·
        ${sel.map(([, v]) => v.numero || 's/nº').join(', ')}</p>
      <div style="max-height:130px;overflow:auto;margin-bottom:8px">
        ${contatos.length ? contatos.map(ct => `
          <label class="chk" style="display:block;margin:3px 0">
            <input type="checkbox" class="env-dest" value="${esc(ct.email)}" data-nome="${esc((ct.nome || '').replace(/ — e-mail do cadastro$/, ''))}" checked>
            ${esc(ct.nome || ct.email)} <span class="dica">${esc(ct.email)}</span></label>`).join('')
        : '<p class="dica">Nenhum contato cadastrado — informe o e-mail abaixo.</p>'}
      </div>
      <label>Outros e-mails (separados por ; ou vírgula)
        <input type="text" id="env-extra" placeholder="fulano@cliente.com.br; fiscal@cliente.com.br"></label>
      <label style="margin-top:8px">Mensagem (opcional)
        <textarea id="env-msg" rows="2" placeholder="Ex.: Seguem os certificados das calibrações de agosto."></textarea></label>
      <p class="dica" style="margin:8px 0 0">Os PDFs vão anexados no e-mail (até ~10 MB no total);
        acima disso, seguem os links de validação de cada certificado.</p>
      <div class="barra-btns" style="margin-top:12px;justify-content:flex-end">
        <button class="btn-mini" onclick="this.closest('.modal-fundo').remove()">Cancelar</button>
        <button class="btn-primario" id="env-btn" onclick="enviarLoteEmail()">Enviar</button>
      </div>
    </div>`;
  document.body.appendChild(m);
}
window._envRecentes = window._envRecentes || {};   // email -> timestamp
async function enviarLoteEmail() {
  // Pares {email, nome}: contatos marcados trazem o nome (saudação
  // personalizada); avulsos do campo livre vão sem nome.
  const pares = [];
  const jaTem = new Set();
  for (const c of document.querySelectorAll('.env-dest:checked')) {
    const em = c.value.trim().toLowerCase();
    if (em && !jaTem.has(em)) { jaTem.add(em); pares.push({ email: em, nome: c.dataset.nome || null }); }
  }
  for (const e of ($('#env-extra').value || '').split(/[,;]+/)) {
    const em = e.trim().toLowerCase();
    if (em && !jaTem.has(em)) { jaTem.add(em); pares.push({ email: em, nome: null }); }
  }
  const emails = pares.map(p => p.email);
  if (!emails.length) { toast('Informe ao menos um destinatário.', 'erro'); return; }
  // Anti-duplo-envio (João, 11/08/2026): mesmo destinatário só após 30 s
  const agora = Date.now();
  const recente = emails.find(e => agora - (window._envRecentes[e] || 0) < 30000);
  if (recente) {
    const falta = Math.ceil((30000 - (agora - window._envRecentes[recente])) / 1000);
    toast(`Um e-mail já foi enviado há pouco para ${recente} — aguarde ${falta} s para reenviar.`, 'erro', 6000);
    return;
  }
  const invalido = emails.find(e => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  if (invalido) { toast('E-mail inválido: ' + invalido, 'erro'); return; }
  const bt = document.getElementById('env-btn');
  bt.disabled = true; bt.textContent = 'Enviando…';
  try {
    await api('/certificados/enviar-lote', { method: 'POST', body: JSON.stringify({
      ids: [...window._selCerts.keys()], emails, destinatarios: pares,
      mensagem: ($('#env-msg').value || '').trim() || null }) });
    document.getElementById('modal-envio-lote')?.remove();
    toast('📧 E-mail com ' + window._selCerts.size + ' certificado(s) na fila de envio!', 'ok', 6000);
    emails.forEach(e => window._envRecentes[e] = Date.now());
    limparSelCerts();
  } catch (e) {
    bt.disabled = false; bt.textContent = 'Enviar';
    toast(e.message, 'erro', 7000);
  }
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

  const itemCert = (c) => {
    const detalhes = [
      [c.marca, c.modelo].filter(Boolean).join(' '),
      c.capacidade != null ? `Cap. ${fmt(c.capacidade)} ${normUnid(c.unidade)}` : '',
      c.num_serie ? `Série ${c.num_serie}` : '',
      c.numero_inmetro ? `Inmetro ${c.numero_inmetro}` : ''
    ].filter(Boolean).join(' · ');
    return `
    <div class="item-cert${c.emitir_rbc ? ' item-rbc' : ''}" onclick="abrirCert('${c.id}','${c.status}')">
      <span>${esc(c.balanca)}${c.numero ? ' · ' + c.numero : ''}
        ${detalhes ? `<br><span class="dica">${esc(detalhes)}</span>` : ''}</span>
      <span>${c.emitir_rbc ? '<span class="badge-rbc-inline" style="background:#0a5c40;color:#fff;font-size:9.5px;padding:2px 6px;border-radius:8px;font-weight:700;margin-right:4px">RBC</span>' : ''}<span class="st st-${c.status}">${rotuloStatus(c.status)}</span></span>
    </div>`;
  };

  let html = '';
  if (andamento.length > 0)
    html += `<h4 class="grupo-titulo">⏳ Em andamento (${andamento.length})</h4>` +
      andamento.map(c => {
        const det = [[c.marca, c.modelo].filter(Boolean).join(' '),
          c.capacidade != null ? `Cap. ${fmt(c.capacidade)} ${normUnid(c.unidade)}` : '',
          c.num_serie ? `Série ${c.num_serie}` : '',
          c.numero_inmetro ? `Inmetro ${c.numero_inmetro}` : ''
        ].filter(Boolean).join(' · ');
        const podeDirecionar = c.status === 'rascunho' && ehGestor();
        return `
        <div class="item-cert destaque-rascunho${c.emitir_rbc ? ' item-rbc' : ''}" onclick="abrirCert('${c.id}','${c.status}')">
          <span><b>${esc(c.cliente)}</b> · ${esc(c.balanca)}
            ${det ? `<br><span class="dica">${esc(det)}</span>` : ''}</span>
          <span>${c.emitir_rbc ? '<span class="badge-rbc-inline" style="background:#0a5c40;color:#fff;font-size:9.5px;padding:2px 6px;border-radius:8px;font-weight:700;margin-right:4px">RBC</span>' : ''}${
            podeDirecionar ? `<button class="btn-mini" title="Direcionar este ensaio a um técnico"
              onclick="event.stopPropagation();abrirResponsaveisCert('${c.id}')">👤</button> ` : ''
          }<span class="st st-${c.status}">${rotuloStatus(c.status)}</span></span>
        </div>`;
      }).join('');

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
        ${st.cancelado ? `<div class="kpi kpi-click" onclick="filtrarStatusGestor('cancelado')"><span class="kpi-num" style="color:#b02a37">${st.cancelado}</span><span class="kpi-rotulo">Cancelados</span></div>` : ''}
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

const rotuloStatus = s => ({ cancelado: 'Cancelado', rascunho: 'Rascunho',
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
          <div class="item-cert ${c.status === 'emitido' ? 'clicavel' : ''}${c.emitir_rbc ? ' item-rbc' : ''}"
               onclick="abrirCert('${c.id}','${c.status}')">
            <span><b>${esc(c.balanca)}</b>${c.num_serie ? ' · Série ' + esc(c.num_serie) : ''}
              · ${esc(c.cliente)}<br>
              <span class="dica">${c.numero || '(sem número)'}
                ${c.data_emissao ? ' · ' + new Date(c.data_emissao).toLocaleDateString('pt-BR') : ''}
                · Téc.: ${esc(c.tecnico)}</span></span>
            <span>${c.emitir_rbc ? '<span class="badge-rbc-inline" style="background:#0a5c40;color:#fff;font-size:9.5px;padding:2px 6px;border-radius:8px;font-weight:700;margin-right:4px">RBC</span>' : ''}<span class="st st-${c.status}">${rotuloStatus(c.status)}</span></span>
          </div>`).join('');
    } catch (e) {
      $('#lista-certs').innerHTML = '<p class="erro">' + e.message + '</p>';
    }
  }, 350);
}

// Excluir um certificado em rascunho (com confirmacao)
async function excluirRascunho() {
  if (!certId) return;
  if (!confirm('Excluir este rascunho?\n\nOs dados do ensaio serao perdidos. Esta acao nao pode ser desfeita.')) return;
  try {
    await api('/certificados/' + certId, { method: 'DELETE' });
    toast('Rascunho excluido.', 'ok');
    certId = null;
    irPainel();
  } catch (e) { toast(e.message, 'erro'); }
}

// ── Técnico e responsável técnico do certificado (admin/RT) ──
async function abrirResponsaveisCert(id) {
  let ct, equipe;
  try {
    [ct, equipe] = await Promise.all([
      api('/certificados/' + id),
      api('/usuarios/equipe')
    ]);
  } catch (e) { toast(e.message, 'erro'); return; }
  const emitido = ct.status === 'emitido';
  const opt = (lista, sel) => lista.map(u =>
    `<option value="${u.id}" ${u.id === sel ? 'selected' : ''}>${esc(u.nome)}${
      u.tem_assinatura ? '' : ' (sem assinatura)'}</option>`).join('');
  const gestores = equipe.filter(u => u.papel === 'admin' || u.papel === 'responsavel_tecnico');

  const m = document.createElement('div');
  m.className = 'modal-fundo';
  m.onclick = e => { if (e.target === m) m.remove(); };
  m.innerHTML = `
    <div class="modal-caixa" style="max-width:480px">
      <h3>👤 Técnico e responsável técnico</h3>
      ${emitido ? `
        <p class="dica" style="background:#fdf6ea;border:1px solid #ecdcc0;border-radius:8px;padding:8px 10px">
          ⚠️ Este certificado <b>já foi emitido</b>. Use esta tela apenas para <b>corrigir o nome</b>
          de quem executou ou aprovou (ex.: registro gravado errado). Se o problema for de
          <b>medição</b>, o caminho certo é <b>emitir revisão</b>. A alteração fica registrada
          na auditoria e o PDF precisa ser regerado.</p>`
        : '<p class="dica">Defina quem executa o ensaio. O rascunho passa a aparecer na fila desse técnico.</p>'}
      <div class="form-grid" style="margin-top:10px">
        <label>Técnico executor
          <select id="rp-tecnico">${opt(equipe, ct.tecnico_id)}</select></label>
        ${emitido || ct.aprovador_id ? `
        <label>Responsável técnico (aprovador)
          <select id="rp-aprovador">
            <option value="">— manter —</option>${opt(gestores, ct.aprovador_id)}
          </select></label>` : ''}
        ${emitido ? `<label>Justificativa da correção *
          <input type="text" id="rp-just" placeholder="ex.: autoria gravada incorretamente pelo sistema"></label>` : ''}
      </div>
      <div class="rodape-acoes" style="margin-top:12px">
        <button onclick="this.closest('.modal-fundo').remove()">Cancelar</button>
        <button class="btn-primario" onclick="salvarResponsaveisCert('${id}', ${emitido})">Salvar</button>
      </div>
      <p id="rp-erro" class="erro"></p>
    </div>`;
  document.body.appendChild(m);
}

async function salvarResponsaveisCert(id, emitido) {
  const corpo = { tecnicoId: $('#rp-tecnico').value || null };
  const apr = document.getElementById('rp-aprovador');
  if (apr && apr.value) corpo.aprovadorId = apr.value;
  if (emitido) {
    corpo.justificativa = ($('#rp-just').value || '').trim();
    if (!corpo.justificativa) { $('#rp-erro').textContent = 'Informe a justificativa.'; return; }
  }
  try {
    const r = await api('/certificados/' + id + '/responsaveis',
      { method: 'PUT', body: JSON.stringify(corpo) });
    document.querySelector('.modal-fundo')?.remove();
    toast('Responsáveis atualizados ✓', 'ok');
    if (r.regerarPdf && confirm('Responsáveis corrigidos.\n\nRegerar o PDF agora para o documento refletir a correção?'))
      regerarPdfCert(id);
    else if (r.status === 'aguardando_aprovacao') abrirRevisao(id);  // recarrega a tela de aprovação
    else atualizarPainel();
  } catch (e) { $('#rp-erro').textContent = e.message; }
}

// Rascunho de outro técnico: corrigir mantendo a autoria x assumir.
// Devolve 'corrigir' | 'assumir' | 'cancelar'.
function escolherAutoriaRascunho(nome, foiDevolvido) {
  return new Promise(resolve => {
    const m = document.createElement('div');
    m.className = 'modal-fundo';
    m.onclick = e => { if (e.target === m) { m.remove(); resolve('cancelar'); } };
    m.innerHTML = `
      <div class="modal-caixa" style="max-width:480px">
        <h3>Ensaio de ${esc(nome)}</h3>
        <p class="dica">${foiDevolvido
          ? `Este ensaio foi <b>devolvido para correção</b>. Quem executou a calibração em campo foi <b>${esc(nome)}</b>.`
          : `Este rascunho foi iniciado por <b>${esc(nome)}</b>.`}</p>
        <p class="dica" style="margin-top:6px">Como deseja continuar?</p>
        <div class="rodape-acoes" style="flex-direction:column;gap:8px;margin-top:12px">
          <button class="btn-primario" data-op="corrigir">✏️ Abrir e corrigir<br>
            <span style="font-weight:400;font-size:12px">o certificado continua em nome de ${esc(nome)}</span></button>
          <button data-op="assumir">👤 Assumir o ensaio<br>
            <span style="font-size:12px">eu passo a ser o técnico responsável pela calibração</span></button>
          <button data-op="cancelar">Cancelar</button>
        </div>
      </div>`;
    m.querySelectorAll('button[data-op]').forEach(b =>
      b.onclick = () => { const op = b.dataset.op; m.remove(); resolve(op); });
    document.body.appendChild(m);
  });
}

async function abrirCert(id, status) {
  if (status === 'rascunho') {
    const ct = await api('/certificados/' + id);
    // Rascunho de OUTRO tecnico: escolher entre CORRIGIR (mantendo a
    // autoria de quem executou o ensaio) ou ASSUMIR de vez. Antes o
    // simples "OK" trocava o tecnico -- o RT que abria para conferir um
    // certificado devolvido acabava virando o autor do ensaio.
    if (usuario && ct.tecnico_id && ct.tecnico_id !== usuario.id) {
      const nome = ct.tecnico_nome || 'outro técnico';
      const escolha = await escolherAutoriaRascunho(nome, !!ct.obs_reprovacao);
      if (escolha === 'cancelar') return;
      if (escolha === 'assumir') {
        try { await api('/certificados/' + id + '/assumir', { method: 'POST' }); }
        catch (e) { toast(e.message, 'erro'); return; }
      }
    }
    certId = id;
    plano = await api('/balancas/' + ct.balanca_id + '/plano-ensaio');
    window._clienteEnsaio = ct.cliente_id;   // usado pelo seletor de endereço
    window._ensaioRbc = !!ct.emitir_rbc;  // reabre na tela certa (RBC ou padrao)
    if (window._ensaioRbc) montarTelaEnsaioRbc();
    else montarTelaEnsaio(ct.dados_rascunho ? JSON.parse(ct.dados_rascunho) : null);
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
// Gera a etiqueta a partir da tela de ensaio (rascunho).
// Salva antes, para garantir que o número/uuid estejam persistidos.
async function etiquetaDoRascunho() {
  // Decisão do João (10/08/2026): etiqueta NÃO sai mais do rascunho —
  // apenas a partir do envio para aprovação, quando data e dados estão
  // fechados (evita etiqueta sem data colada na balança).
  toast('A etiqueta é impressa após o envio para aprovação, com o ensaio ' +
        'completo — assim ela nunca sai sem data.', 'aviso', 7000);
}

async function imprimirEtiqueta(id) {
  let d;
  try { d = await api('/certificados/' + id + '/etiqueta'); }
  catch (e) { toast('Não foi possível gerar a etiqueta: ' + e.message, 'erro'); return; }
  // Fluxo definido pelo João (08/08/2026): a etiqueta é impressa NO ATO DO
  // ENSAIO, antes da aprovação — sem aviso. O QR aponta para o UUID de
  // validação, que não muda: depois de aprovado, a MESMA etiqueta passa a
  // direcionar para o certificado emitido.
  window._etiquetaDados = d;
  // O que o técnico usou por último vem primeiro; o padrão da empresa é o
  // fallback. Na prática cada um imprime quase sempre o mesmo modelo.
  const ultimo = d.ultimo_modelo || '';
  const padrao = d.etiqueta_tamanho || '50x30-completa';
  // ÚNICO modelo em uso (decisão do João, 08/08/2026): 50×30 completa —
  // o rolo físico padrão da empresa é 50x30 mm. Os demais modelos foram
  // retirados para eliminar impressão com página de tamanho errado.
  const opcoes = [
    { v: '50x30-completa', t: 'Imprimir etiqueta 50×30 mm', s: '' }
  ];
  // Reordena: o último usado sobe para o topo, marcado
  const idx = opcoes.findIndex(o => o.v === ultimo);
  if (idx > 0) opcoes.unshift(opcoes.splice(idx, 1)[0]);

  // Dois caminhos por tamanho:
  //   🖨️ imprime direto (se a impressora já é conhecida) ou abre a tela
  //   👁 sempre abre a pré-visualização
  const nomeImp = localStorage.getItem('niimbot_nome') || '';
  const botoes = opcoes.map(o => `
    <div style="display:flex;gap:6px;align-items:stretch;margin-bottom:6px">
      <button class="et-opt et-padrao" style="flex:1"
        onclick="imprimirNiimbot('${o.v}')">
        <b>🖨️ ${o.t}</b>
        <span>${nomeImp ? 'Última impressora: ' + esc(nomeImp) : 'via Bluetooth'}</span>
      </button>
    </div>`).join('');
  const modal = `
    <div class="modal-fundo" onclick="if(event.target===this)this.remove()">
      <div class="modal-caixa">
        <h3>🏷️ Imprimir etiqueta</h3>
        <p class="dica">Escolha o tamanho da etiqueta para esta impressão:</p>
        <div style="background:#f0f7fb;border-left:3px solid #35b6e8;border-radius:0 8px 8px 0;
             padding:9px 12px;margin:8px 0;font-size:.85rem;color:#204b63">
          <b>🖨️</b> imprime direto na Niimbot. Funciona no Chrome ou Edge,
          sem instalar nada.
        </div>
        <div class="et-opts">${botoes}</div>
        <div class="rodape-acoes" style="margin-top:12px">
          <button onclick="this.closest('.modal-fundo').remove()">Cancelar</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', modal);
}

// Layout e CSS da etiqueta, compartilhados entre a impressão e a imagem
// (antes ficavam dentro de gerarEtiqueta, então a imagem não os alcançava).
function layoutEtiqueta(tam, d) {
  // Os modelos novos (50x30-logo, -tecnico, -venc, -completa) só existem no
  // desenho em canvas. Para a IMPRESSÃO em HTML, usam o layout 50x30 base.
  tam = tam.includes('-') ? tam.split('-')[0] : tam;
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
  return layouts[tam] || layouts['40x60'];
}

function cssEtiqueta() {
  return `
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
      @page { size: \${L.w}mm \${L.h}mm; margin: 0; }
      @media print { body { width:\${L.w}mm; } }
`;
}

// Gera a etiqueta como PNG no tamanho físico exato (300 dpi).
// Impressoras Bluetooth (Niimbot B1, Phomemo) não aparecem como impressora
// do sistema: a impressão é pelo app do celular, que importa IMAGEM.
// Gera a etiqueta como PNG DESENHANDO DIRETO NO CANVAS.
//
// Por que não converter o HTML: o Chrome bloqueia SVG com <foreignObject>
// no canvas (mesmo via Blob URL) — é restrição de segurança, não bug. A
// imagem simplesmente não carrega, e o erro vem sem mensagem (o "undefined"
// que apareceu na tela). Desenhando no canvas o resultado é previsível e
// funciona em qualquer navegador.
// Gera a etiqueta como PNG DESENHANDO DIRETO NO CANVAS.
//
// Por que não converter o HTML: o Chrome bloqueia SVG com <foreignObject>
// no canvas (mesmo via Blob URL) — é restrição de segurança, não bug. A
// imagem não carrega e o erro vem sem mensagem. Desenhando no canvas o
// resultado é previsível e funciona em qualquer navegador.
async function baixarEtiquetaImagem(tam) {
  const d = window._etiquetaDados;
  if (!d) { toast('Dados da etiqueta não disponíveis.', 'erro'); return; }
  lembrarModeloEtiqueta(tam);

  const modelo = tam.includes('-') ? tam.split('-')[1] : '';
  const base = tam.split('-')[0];
  let [mmW, mmH] = base.split('x').map(Number);

  // ── Ajuste para a impressora ────────────────────────────────
  // O cabeçote imprime 48 mm; uma etiqueta de 50 mm de largura perde 2 mm
  // (24 px) se desenhada em 591 px. Em vez de desenhar e cortar depois,
  // desenhamos JÁ no espaço real — assim nada some.
  const cfgImp = window._etiquetaParaImpressora || null;

  // VOLTANDO AO QUE FUNCIONAVA: o tamanho é o do MODELO escolhido (50x30,
  // 40x60...), com uma única regra — a largura não passa do cabeçote e é
  // múltipla de 8. Todas as camadas que acrescentei depois (tamanho do rolo,
  // completar página, recortar) quebraram o que estava certo.
  const DPI = cfgImp ? cfgImp.dpi : 300;
  const MM = 25.4, S = DPI / MM;
  let W = Math.round(mmW * S), H = Math.round(mmH * S);

  if (cfgImp) {
    const maxPx = Math.floor(cfgImp.cabecotePx / 8) * 8;
    if (W > maxPx) { H = Math.round(H * maxPx / W); W = maxPx; }
    W = Math.floor(W / 8) * 8;
  }

  const P = Math.max(4, Math.round(Math.min(W, H) * 0.022));

  const dbr = v => v ? new Date(String(v).substring(0, 10) + 'T00:00:00')
    .toLocaleDateString('pt-BR') : '—';
  const calib = dbr(d.data_calibracao);
  let venc = '—';
  if (d.data_calibracao && d.periodicidade_meses > 0) {
    const dt = new Date(String(d.data_calibracao).substring(0, 10) + 'T00:00:00');
    dt.setMonth(dt.getMonth() + d.periodicidade_meses);
    venc = dt.toLocaleDateString('pt-BR');
  }

  // Carrega uma imagem (QR ou logo) pronta para o canvas.
  // O QR é PÚBLICO (não leva Authorization); o logo exige o token.
  // Timeout de 8s: sem ele, uma imagem que nunca carrega travaria a geração.
  async function imagem(url, comToken) {
    try {
      const r = await fetch(url, comToken
        ? { headers: { Authorization: 'Bearer ' + token } } : {});
      if (!r.ok) { console.warn('etiqueta: ' + url + ' devolveu ' + r.status); return null; }
      const blob = await r.blob();
      if (!blob || blob.size === 0) return null;
      const objUrl = URL.createObjectURL(blob);
      return await new Promise(ok => {
        const im = new Image();
        const fim = setTimeout(() => { console.warn('etiqueta: timeout em ' + url); ok(null); }, 8000);
        im.onload = () => { clearTimeout(fim); ok(im); };
        im.onerror = () => { clearTimeout(fim); console.warn('etiqueta: falha ao decodificar ' + url); ok(null); };
        im.src = objUrl;
      });
    } catch (e) { console.warn('etiqueta: ' + e.message); return null; }
  }

  try {
    const qr = base === '25x15' ? null
      : await imagem('/api/validar/' + d.uuid_validacao + '/qr', false);
    // telefone da empresa para a etiqueta (multiempresa: vem do config)
    if (window._empresaTelefone === undefined) {
      try { const cf = await api('/empresa/config'); window._empresaTelefone = cf.telefone || ''; }
      catch (e) { window._empresaTelefone = ''; }
    }
    // 40x60 e "completa" também levam logo (pedido do João)
    const querLogo = modelo === 'logo' || modelo === 'completa' || base === '40x60';
    const logo = querLogo && d.logo_url ? await imagem('/api/empresa/logo', true) : null;

    // O QR é o que dá valor à etiqueta (validação pelo celular). Se ele não
    // veio, avisa em vez de entregar uma etiqueta capenga em silêncio.
    if (!qr && base !== '25x15')
      toast('Atenção: não consegui carregar o QR code — a etiqueta sai sem ele. ' +
            'Tente novamente ou verifique a conexão.', 'erro', 8000);

    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    c.fillStyle = '#fff'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#000';
    c.textBaseline = 'top';

    const F = (pt, bold) => `${bold ? 'bold ' : ''}${Math.round(pt * S / 2.83)}px Arial, Helvetica, sans-serif`;
    const alt = pt => Math.round(pt * S / 2.83);
    const cortar = (txt, max) => {
      let t = String(txt ?? '');
      if (c.measureText(t).width <= max) return t;
      while (t.length > 1 && c.measureText(t + '…').width > max) t = t.slice(0, -1);
      return t + '…';
    };

    let y = P;

    if (modelo === 'completa') {
      // ═══ LAYOUT NOVO da 50×30 completa (08/08/2026) ═══
      // Pedidos do João: borda em toda a etiqueta, faixa vertical
      // "CALIBRAÇÃO" à esquerda (referência: etiqueta Imperium), telefone
      // da empresa no cabeçalho, e SÉRIE no lugar da capacidade.
      const traco = Math.max(2, Math.round(0.32 * S));
      const raio = Math.round(1.6 * S);
      const arred = (x0, y0, w0, h0, r0) => { c.beginPath();
        c.moveTo(x0 + r0, y0); c.arcTo(x0 + w0, y0, x0 + w0, y0 + h0, r0);
        c.arcTo(x0 + w0, y0 + h0, x0, y0 + h0, r0);
        c.arcTo(x0, y0 + h0, x0, y0, r0); c.arcTo(x0, y0, x0 + w0, y0, r0);
        c.closePath(); };

      const bx = Math.round(0.6 * S), by = bx;
      const bw = W - 2 * bx, bh = H - 2 * by;

      // faixa lateral preta com o texto na vertical (recortada pela borda)
      const faixaW = Math.round(4.3 * S);
      c.save();
      arred(bx, by, bw, bh, raio); c.clip();
      c.fillStyle = '#000';
      c.fillRect(bx, by, faixaW, bh);
      c.fillStyle = '#fff';
      c.font = F(7, true);
      c.translate(bx + faixaW / 2, by + bh / 2);
      c.rotate(-Math.PI / 2);
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('CALIBRADO', 0, 0);
      c.restore();
      c.textAlign = 'left'; c.textBaseline = 'top'; c.fillStyle = '#000';

      // borda externa arredondada por cima de tudo
      c.lineWidth = traco; c.strokeStyle = '#000';
      arred(bx, by, bw, bh, raio); c.stroke();

      const x0 = bx + faixaW + Math.round(1.2 * S);
      const x1 = W - bx - Math.round(1.0 * S);
      const lg = x1 - x0;
      let yy = by + Math.round(1.0 * S);

      // cabeçalho: logo + empresa; telefone em negrito à direita
      const telEmp = window._empresaTelefone || '';
      const hCab = Math.round(5.0 * S);
      let xNome = x0;
      if (logo) {
        const prop = logo.width / logo.height;
        let lh = hCab, lw = lh * prop;
        if (lw > lg * 0.32) { lw = lg * 0.32; lh = lw / prop; }
        c.drawImage(logo, x0, yy + Math.round((hCab - lh) / 2), lw, lh);
        xNome = x0 + lw + Math.round(1.0 * S);
      }
      c.font = F(7, true);
      const nomeEmp = cortar(d.empresa, x1 - xNome);
      c.fillText(nomeEmp, xNome, yy);
      if (telEmp) {
        c.font = F(6.4, true);
        const tw = c.measureText(telEmp).width;
        c.fillText(telEmp, x1 - tw, yy + alt(7) + Math.round(0.5 * S));
      }
      yy += hCab + Math.round(0.7 * S);
      c.fillRect(x0, yy, lg, Math.max(1, Math.round(0.22 * S)));
      yy += Math.round(0.9 * S);

      // corpo: QR à esquerda, dados à direita
      const qrLado = qr ? Math.round(12.5 * S) : 0;
      if (qr) c.drawImage(qr, x0, yy, qrLado, qrLado);
      const xd = x0 + (qr ? qrLado + Math.round(1.2 * S) : 0);
      const lgD = x1 - xd;
      const linhaC = (rot, val) => {
        c.font = F(6, true);
        const wr = rot ? c.measureText(rot + ' ').width : 0;
        if (rot) c.fillText(rot, xd, yy);
        c.font = F(6, false);
        c.fillText(cortar(val, lgD - wr), xd + wr, yy);
        yy += alt(6) + Math.round(0.5 * S);
      };
      linhaC('Equip.:', d.balanca);
      linhaC('Calibrado:', calib);
      if (d.tecnico) linhaC('Téc.:', d.tecnico);

      // vencimento em destaque
      yy += Math.round(0.3 * S);
      c.font = F(5.2, false);
      c.fillText('PRÓXIMA CALIBRAÇÃO', xd, yy);
      yy += alt(5.2) + Math.round(0.25 * S);
      c.font = F(9.5, true);
      c.fillText(cortar(venc, lgD), xd, yy);

      // rodapé dentro da borda: número quando houver; sempre neutro (a
      // etiqueta sai no ato do ensaio e precisa parecer definitiva)
      c.font = F(4.8, false);
      const rod = (d.numero ? 'Cert. ' + d.numero + ' · ' : '') +
        (qr ? 'escaneie o QR para validar' : '');
      if (rod) c.fillText(cortar(rod, lg), x0, by + bh - Math.round(0.9 * S) - alt(4.8));
    } else {

    // ── CABEÇALHO: logo À ESQUERDA + nome da empresa AO LADO ──
    const ptCab = base === '25x15' ? 6.5 : base === '40x60' ? 8 : 7.5;
    if (logo) {
      const hLogo = Math.round((base === '40x60' ? 7 : 6) * S);
      const prop = logo.width / logo.height;
      let lh = hLogo, lw = hLogo * prop;
      const maxLogo = (W - 2 * P) * 0.42;            // o logo não domina a etiqueta
      if (lw > maxLogo) { lw = maxLogo; lh = lw / prop; }
      c.drawImage(logo, P, y, lw, lh);

      // nome da empresa ao lado, centralizado na altura do logo
      c.font = F(ptCab, true);
      const xNome = P + lw + Math.round(1.5 * S);
      const largNome = W - xNome - P;
      const nomeEmp = cortar(d.empresa, largNome);
      c.fillText(nomeEmp, xNome, y + Math.round((lh - alt(ptCab)) / 2));
      y += Math.round(lh) + Math.round(0.8 * S);
    } else {
      c.font = F(ptCab, true);
      c.fillText(cortar(d.empresa, W - 2 * P), P, y);
      y += alt(ptCab) + Math.round(0.6 * S);
    }
    c.fillRect(P, y, W - 2 * P, Math.max(1, Math.round(0.25 * S)));
    y += Math.round(1.1 * S);

    // Fontes +1 pt em relação ao original (pedido do João)
    const pt = base === '40x60' ? 8 : modelo === 'completa' ? 6 : base === '50x30' ? 7 : 5;
    const yTopo = y;

    // ── MODELO "foco no vencimento": data grande no centro ──
    if (modelo === 'venc') {
      const qrLado = qr ? Math.round(15 * S) : 0;
      if (qr) c.drawImage(qr, P, y, qrLado, qrLado);
      const xd = P + (qr ? qrLado + Math.round(1.6 * S) : 0);
      const lgD = W - xd - P;
      c.font = F(5, false);
      c.fillText('PRÓXIMA CALIBRAÇÃO', xd, y);
      c.font = F(11, true);
      c.fillText(cortar(venc, lgD), xd, y + alt(5) + Math.round(0.5 * S));
      c.font = F(5, false);
      const y2 = y + alt(5) + alt(11) + Math.round(1.2 * S);
      c.fillText(cortar(d.balanca, lgD), xd, y2);
      if (d.num_serie) c.fillText(cortar('Série ' + d.num_serie, lgD), xd, y2 + alt(5) + 2);
    } else {
      // ── DEMAIS MODELOS: QR à esquerda, dados à direita ──
      const qrMm = modelo === 'completa' ? 15 : base === '33x22' ? 11 : base === '40x60' ? 16 : 17;
      const qrLado = qr ? Math.round(qrMm * S) : 0;
      if (qr) c.drawImage(qr, P, y, qrLado, qrLado);
      const xd = P + (qr ? qrLado + Math.round(1.5 * S) : 0);
      const lgD = W - xd - P;

      const linha = (rot, val, negrito) => {
        c.font = F(pt, true);
        const wr = rot ? c.measureText(rot + ' ').width : 0;
        if (rot) c.fillText(rot, xd, y);
        c.font = F(pt, !!negrito);
        c.fillText(cortar(val, lgD - wr), xd + wr, y);
        y += alt(pt) + Math.round(0.45 * S);
      };

      linha('Equip.:', d.balanca);
      if (d.num_serie) linha('Série:', d.num_serie);
      if (modelo === 'completa' && d.capacidade)
        linha('Cap.:', fmt(d.capacidade) + ' ' + (normUnid(d.unidade) || 'kg'));
      linha('Calibrado:', calib);
      if ((modelo === 'tecnico' || modelo === 'completa') && d.tecnico)
        linha('Téc.:', d.tecnico);

      // VENCIMENTO em destaque: é o que interessa a quem olha a balança
      y += Math.round(0.5 * S);
      const ptV = base === '40x60' ? 12 : modelo === 'completa' ? 9 : 10;
      c.font = F(pt - 1, false);
      c.fillText('VENCIMENTO', xd, y);
      y += alt(pt - 1) + Math.round(0.3 * S);
      c.font = F(ptV, true);
      c.fillText(cortar(venc, lgD), xd, y);
      y += alt(ptV) + Math.round(0.4 * S);
    }

    // ── RODAPÉ: certificado (+ técnico quando o modelo é "tecnico") ──
    const ptR = base === '25x15' ? 4.5 : 5;
    c.font = F(ptR, false);
    const yr = H - P - alt(ptR);
    let rodape = 'Cert. ' + (d.numero || '');
    if (qr) rodape += ' · escaneie para validar';
    c.fillText(cortar(rodape, W - 2 * P), P, yr);
    }

    // Guarda o canvas: a impressão direta na Niimbot usa o MESMO desenho,
    // então o que sai no PNG é exatamente o que sai na impressora.
    window._etiquetaCanvas = cv;
    if (window._etiquetaSoCanvas) return cv;

    const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
    if (!blob) throw new Error('o navegador não gerou o arquivo');

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `etiqueta-${limpaNomeArq(d.numero)}-${tam}.png`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);

    toast(`Imagem ${base} mm gerada (${W}×${H} px, 300 dpi)` +
          (qr ? ' com QR code' : '') + '. Envie ao celular e imprima pelo app.', 'ok', 7000);
    document.querySelector('.modal-fundo')?.remove();
  } catch (e) {
    // Quando o chamador é a IMPRESSÃO/PRÉVIA (só quer o canvas), o erro
    // precisa SUBIR: cair no fallback de impressão devolvia undefined e a
    // etiqueta saía em branco, sem ninguém saber por quê.
    console.error('etiqueta:', e);
    // Como só existe o caminho da Niimbot, o erro SEMPRE sobe: quem chamou
    // (prévia ou impressão) mostra a mensagem no lugar certo.
    throw e;
  }
}

// Guarda o modelo usado, para aparecer no topo na próxima vez.
// Silencioso de propósito: se falhar, o usuário não precisa saber — na pior
// das hipóteses a lista volta à ordem padrão.
function lembrarModeloEtiqueta(tam) {
  if (window._etiquetaDados) window._etiquetaDados.ultimo_modelo = tam;
  api('/certificados/etiqueta-modelo',
    { method: 'PUT', body: JSON.stringify({ modelo: tam }) }).catch(() => {});
}

// ── LOG EM ARQUIVO (pedido do João, 08/08/2026) ─────────────
// A cada impressão, grava um .txt na pasta Downloads com TUDO que é preciso
// para diagnosticar o "sai em branco": desenho escolhido, rolo informado,
// modelo, rotação, tamanho do canvas, contagem de pixels pretos e o
// registro passo a passo do protocolo (comandos + respostas da impressora).
// Também guarda os 10 últimos no navegador (localStorage 'niimbot_logs').
// Liga/desliga o diagnóstico de etiqueta pela URL (iPhone não tem console):
// abrir o site com ?log=1 ativa o arquivo .txt + painel; ?log=0 desativa.
try {
  if (location.search.includes('log=1'))
    localStorage.setItem('niimbot_log_arquivo', '1');
  if (location.search.includes('log=0'))
    localStorage.removeItem('niimbot_log_arquivo');
} catch (e) {}

function gravarLogEtiqueta(tam, erro) {
  try {
    const d = window._etiquetaDados || {};
    const cv = window._ultimoCanvasImpresso || null;
    const cfg = JSON.parse(localStorage.getItem('niimbot_cfg') || 'null') || {};
    const rolo = localStorage.getItem('niimbot_rolo') || '(nunca escolhido — o código assume 50x30)';
    const modeloSel = document.getElementById('nb-modelo')?.value || cfg.modelo || 'b1_pro';
    const rot = document.getElementById('nb-rotacao')?.value ?? cfg.rotacao ?? 0;
    const copias = document.getElementById('nb-copias')?.value || cfg.copias || 1;

    let alvo = null;
    try { alvo = alvoImpressora(modeloSel, parseInt(rot) || 0); } catch (e) {}

    // Conta os pixels escuros do canvas FINAL (o que foi de fato enviado,
    // já rotacionado) — mesmo critério de luminância do niimbot.js.
    let escuros = -1, total = 0;
    if (cv) {
      try {
        const px = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
        total = cv.width * cv.height; escuros = 0;
        for (let i = 0; i < px.length; i += 4) {
          const lum = px[i + 3] < 32 ? 255
            : 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
          if (lum < 128) escuros++;
        }
      } catch (e) { escuros = -2; }
    }

    const reg = (typeof NiimbotWeb !== 'undefined' && NiimbotWeb.log) || [];
    const L = [];
    L.push('LOG DE IMPRESSÃO DE ETIQUETA — TSCert');
    L.push('Data/hora: ' + new Date().toLocaleString('pt-BR'));
    L.push('');
    L.push('== O QUE FOI IMPRESSO ==');
    L.push('Certificado: ' + (d.numero || '?'));
    L.push('Equipamento: ' + (d.balanca || '?') + (d.num_serie ? ' | serie ' + d.num_serie : ''));
    L.push('Desenho escolhido (tam): ' + tam);
    L.push('');
    L.push('== CONFIGURACAO ==');
    L.push('Rolo informado na tela: ' + rolo);
    L.push('Modelo da impressora: ' + modeloSel);
    L.push('Rotacao: ' + rot + ' graus | copias: ' + copias + ' | densidade: ' + (cfg.densidade || 3));
    if (alvo) L.push('Alvo: ' + alvo.dpi + ' dpi | cabecote ' + alvo.cabecotePx + ' px ('
      + alvo.cabecoteMm + ' mm) | util ' + alvo.utilPx + ' px (' + alvo.utilMm + ' mm)');
    L.push('');
    L.push('== IMAGEM ENVIADA ==');
    if (cv) {
      const mmW = alvo ? (cv.width / alvo.dpi * 25.4).toFixed(1) : '?';
      const mmH = alvo ? (cv.height / alvo.dpi * 25.4).toFixed(1) : '?';
      L.push('Canvas final (apos rotacao): ' + cv.width + ' x ' + cv.height + ' px (~ '
        + mmW + ' x ' + mmH + ' mm)');
      L.push('Largura multipla de 8: ' + (cv.width % 8 === 0 ? 'SIM' : 'NAO << PROBLEMA'));
      if (window._encaixeInfo) L.push('Encaixe no rolo: ' + window._encaixeInfo);
      if (escuros >= 0) {
        L.push('Pixels escuros: ' + escuros + ' de ' + total + ' ('
          + (100 * escuros / total).toFixed(2) + '%)');
        L.push(escuros === 0
          ? '>>> CANVAS EM BRANCO: o problema esta no DESENHO, antes do Bluetooth <<<'
          : 'Canvas TEM conteudo. Se saiu branco, o problema e protocolo/rolo/impressora.');
      } else L.push('Pixels escuros: nao consegui ler o canvas');
    } else L.push('Canvas: NAO GERADO (a falha aconteceu antes do desenho)');
    L.push('');
    L.push('== RESULTADO ==');
    L.push(erro ? 'ERRO: ' + erro : 'Enviado sem erro reportado');
    L.push('');
    L.push('== REGISTRO PASSO A PASSO (' + reg.length + ' passos) ==');
    reg.forEach(x => L.push(x.t + '  ' + x.tipo + ': ' + x.msg));

    // Download automático DESLIGADO (pedido do João, 08/08/2026, após a
    // impressão estar funcionando). O log continua guardado no navegador
    // (localStorage 'niimbot_logs', 10 últimos) — para voltar a baixar em
    // um diagnóstico futuro, rode no console: localStorage.setItem('niimbot_log_arquivo','1')
    const txt = '\uFEFF' + L.join('\r\n');
    if (localStorage.getItem('niimbot_log_arquivo') === '1') {
      const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const ts = new Date().toISOString().replace(/[:T]/g, '-').substring(0, 19);
      a.download = 'log-etiqueta-' + ts + '.txt';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }

    try {
      const hist = JSON.parse(localStorage.getItem('niimbot_logs') || '[]');
      hist.push({ quando: new Date().toISOString(), txt: L.join('\n') });
      while (hist.length > 10) hist.shift();
      localStorage.setItem('niimbot_logs', JSON.stringify(hist));
    } catch (e) {}

  } catch (e) { console.warn('gravarLogEtiqueta:', e); }
}

// ── Impressão direta na Niimbot (Web Bluetooth) ─────────────
// Usa o MESMO canvas do "Baixar imagem": o que sai no arquivo é o que sai
// na impressora. O niimbot.js traz o protocolo.
let _niimbot = null;

let _tamAtual = null;
// ── Overlay de progresso da impressão (aprovado pelo João, 10/08/2026) ──
// Barra real alimentada pelos percentuais do protocolo, nos DOIS caminhos
// (direto e modal), Android e iPhone. No iPhone mostra o aviso do modo
// seguro (escrita confirmada, ~20 s).
const _ehIosApp = /iPhone|iPad|iPod/i.test(navigator.userAgent);
function progressoImpressao(msg) {
  let ov = document.getElementById('ov-imp');
  if (msg === null) { ov?.remove(); return; }
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'ov-imp';
    ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(10,20,32,.55);' +
      'display:flex;align-items:center;justify-content:center;padding:20px';
    ov.innerHTML = `
      <div style="background:#fff;border-radius:14px;padding:20px;max-width:340px;width:100%;
                  text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.35)">
        <p style="font-weight:600;font-size:16px;margin:0 0 4px">🖨️ Imprimindo a etiqueta…</p>
        ${_ehIosApp ? `<p style="font-size:12.5px;color:#5a7183;margin:0 0 12px">
          No iPhone a impressão usa o <b>modo seguro</b> e demora um pouco mais
          (± 20 segundos). Mantenha esta tela aberta.</p>`
        : `<p style="font-size:12.5px;color:#5a7183;margin:0 0 12px">Aguarde alguns segundos.</p>`}
        <div style="background:#e4eaf2;border-radius:99px;height:14px;overflow:hidden">
          <div id="ov-imp-bar" style="background:#164066;height:100%;width:3%;
               border-radius:99px;transition:width .35s"></div>
        </div>
        <p id="ov-imp-txt" style="font-size:13px;font-weight:600;margin:8px 0 0;color:#16202c"></p>
        <p style="font-size:11px;color:#8ba0b5;margin:10px 0 0">
          conectar → desenhar → enviar imagem → imprimir</p>
      </div>`;
    document.body.appendChild(ov);
  }
  let m = String(msg);
  let pct = null;
  const p = m.match(/(\d+)\s*%/);
  if (p) {
    const bruto = Math.min(100, parseInt(p[1]));
    pct = 12 + bruto * 0.8;                                      // envio: 12→92
    m = `imprimindo… ${bruto}%`;
  }
  else if (/conect/i.test(m)) pct = 5;
  else if (/desenh/i.test(m)) pct = 9;
  else if (/prepar/i.test(m)) pct = 12;
  else if (/imprimindo/i.test(m)) { pct = 94; m = 'finalizando…'; }
  else if (/pronto|✓/i.test(m)) { pct = 100; m = 'impresso ✓'; }
  if (pct !== null) document.getElementById('ov-imp-bar').style.width = pct + '%';
  document.getElementById('ov-imp-txt').textContent = m;
  if (pct === 100) setTimeout(() => document.getElementById('ov-imp')?.remove(), 700);
}

// ── iPhone sem Web Bluetooth (Safari/Chrome do iOS): orienta o Bluefy ──
function mostrarTelaBluefy() {
  document.getElementById('modal-bluefy')?.remove();
  const m = document.createElement('div');
  m.className = 'modal-fundo';
  m.id = 'modal-bluefy';
  m.innerHTML = `
    <div class="modal-caixa" style="max-width:380px;text-align:center">
      <div style="font-size:34px">📱</div>
      <h3 style="margin:8px 0 6px">Para imprimir no iPhone, use o Bluefy</h3>
      <p style="font-size:13px;color:#5a7183;line-height:1.5;margin:0 0 14px">
        O Safari e o Chrome do iPhone não têm Bluetooth para impressoras.
        O <b>Bluefy</b> é um navegador gratuito que tem — instale, abra o
        TSCert nele e imprima normalmente.</p>
      <a href="https://apps.apple.com/app/bluefy-web-ble-browser/id1492822055"
         target="_blank" rel="noopener" class="btn-primario"
         style="display:block;text-decoration:none;padding:12px;border-radius:10px">
         ⬇️ Baixar o Bluefy na App Store</a>
      <button style="width:100%;background:none;border:0;color:#5a7183;
              padding:10px;margin-top:4px;cursor:pointer"
        onclick="navigator.clipboard.writeText(location.origin)
          .then(() => toast('Endereço copiado — cole no Bluefy', 'ok', 4000))">
        📋 Copiar o endereço do TSCert</button>
      <p style="font-size:11px;color:#8ba0b5;margin:8px 0 0">
        1. Instale · 2. Abra o Bluefy · 3. Cole o endereço · 4. Entre e imprima</p>
      <button style="margin-top:10px;background:none;border:0;color:#5a7183;
              cursor:pointer" onclick="this.closest('.modal-fundo').remove()">Fechar</button>
    </div>`;
  document.body.appendChild(m);
}

async function imprimirNiimbot(tam, sempreMostrar = false) {
  _tamAtual = tam;
  if (!navigator.bluetooth) {
    if (_ehIosApp) { mostrarTelaBluefy(); return; }
    toast('Este navegador não conversa com a impressora por Bluetooth. ' +
          'Use o Chrome ou o Edge no computador ou no Android.', 'erro', 9000);
    return;
  }

  // "Ver antes" sempre abre a tela; o outro botão tenta imprimir direto
  // quando a impressora já é conhecida.
  const cfg = JSON.parse(localStorage.getItem('niimbot_cfg') || 'null');
  // Sem rotação: com a fita no lado maior, o texto horizontal já sai certo
  if (cfg && cfg.rotacao === undefined) cfg.rotacao = 0;
  if (!sempreMostrar && cfg && await tentarImpressaoDireta(tam, cfg)) return;

  const modal = document.createElement('div');
  modal.className = 'modal-fundo';
  modal.id = 'modal-niimbot';
  modal.innerHTML = `
    <div class="modal-caixa" style="max-width:400px">
      <h3>🖨️ Imprimir na Niimbot</h3>
      <p class="dica">Primeira vez: escolha a impressora na lista que o navegador
        mostrar. Depois disso, é só clicar e imprimir — sem perguntas.</p>
      <!-- Configurações fixas validadas em 08/08/2026: rolo 50x30, página
           dupla (passo salvo), protocolo clássico linha a linha, B1 Pro.
           Ajustes só por código, a pedido do João (sem botões na tela). -->
      <label style="display:flex;gap:9px;align-items:center;margin-top:7px;
             background:#f4f7fb;border-radius:9px;padding:9px 11px;font-size:.85rem">
        <input type="checkbox" id="nb-todos" style="width:17px;height:17px">
        <span>Não achei a impressora <span class="dica">(lista tudo por perto)</span></span>
      </label>
      <div id="nb-previa-area" style="margin-top:14px;text-align:center;display:none">
        <div style="background:#eef2f7;border-radius:10px;padding:14px">
          <canvas id="nb-previa" style="max-width:100%;background:#fff;
            box-shadow:0 1px 6px rgba(15,33,56,.18);border-radius:3px"></canvas>
          <p class="dica" id="nb-previa-info" style="margin:9px 0 0"></p>
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:14px">
        <button class="btn-primario" id="nb-btn" style="flex:1"
          onclick="executarImpressaoNiimbot('${tam}')">🖨️ Imprimir</button>
      </div>
      <p style="margin-top:10px;text-align:center">
        <span class="link" onclick="document.getElementById('modal-niimbot').remove()">Cancelar</span></p>
      <p id="nb-status" class="dica" style="margin-top:8px;text-align:center"></p>
      <p id="nb-erro" class="erro"></p>
    </div>`;
  modal.onclick = e => { if (e.target === modal) modal.remove(); };
  document.body.appendChild(modal);

  // repõe as escolhas anteriores
  const roloSalvo = localStorage.getItem('niimbot_rolo');
  if (roloSalvo && $('#nb-rolo')) $('#nb-rolo').value = roloSalvo;

  // Sem controles na tela: os valores saem do localStorage (calibrados em
  // 08/08/2026) com os padrões garantidos abaixo.
  if (!localStorage.getItem('niimbot_passo')) localStorage.setItem('niimbot_passo', '33');
  if (!localStorage.getItem('niimbot_segunda')) localStorage.setItem('niimbot_segunda', 'repetir');

  // Abre JÁ com a prévia: agora é o único caminho, e ver antes de imprimir
  // economiza etiqueta.
  previaEtiqueta(tam);
}

// TESTE DE LARGURA: imprime uma tarja curta para cada largura candidata,
// numerada. A que aparecer na etiqueta é a largura certa da sua impressora.
// Gasta uma etiqueta e responde de vez o que várias tentativas não deram.
async function testarLarguras() {
  const larguras = [352, 384, 472, 552, 560, 567, 576, 584, 591];
  if (!await modalConfirmar('Teste de largura',
    'Vou imprimir <b>uma etiqueta</b> com tarjas numeradas — uma para cada largura ' +
    'possível.<br><br>Olhe a etiqueta impressa: <b>o maior número que aparecer ' +
    'inteiro</b> é a largura certa. Depois é só informar no ajuste fino.<br><br>' +
    '<span class="dica">Larguras testadas: ' + larguras.join(', ') + ' px</span>',
    { textoSim: 'Imprimir teste', textoNao: 'Cancelar' })) return;

  try {
    if (!_niimbot || !_niimbot.caract) {
      const modelo = document.getElementById('nb-modelo')?.value || 'b1_pro';
      _niimbot = new NiimbotWeb(modelo);
      if (!await _niimbot.reconectar()) await _niimbot.conectar();
    }

    // Uma tarja por largura: cada uma começa na esquerda e vai até o seu limite
    const maxL = Math.max(...larguras);
    const alturaTarja = 34, esp = 8;
    const cv = document.createElement('canvas');
    cv.width = maxL;
    cv.height = larguras.length * (alturaTarja + esp) + 20;
    const c = cv.getContext('2d');
    c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height);
    c.fillStyle = '#000';
    larguras.forEach((L, i) => {
      const y = 10 + i * (alturaTarja + esp);
      c.fillRect(0, y, L, alturaTarja);            // a tarja vai até L
      c.fillStyle = '#fff';
      c.font = 'bold 24px Arial';
      c.fillText(String(L), 8, y + 26);            // número no início
      // marca no FIM da tarja: se aparecer, aquela largura coube
      c.fillRect(L - 46, y + 5, 40, alturaTarja - 10);
      c.fillStyle = '#000';
      c.font = 'bold 20px Arial';
      c.fillText('◄', L - 40, y + 25);
      c.fillStyle = '#000';
    });

    toast('Imprimindo o teste…', 'ok', 8000);
    await _niimbot.imprimir(cv, { copias: 1, densidade: 3 });
    mostrarRegistroImpressao();
    toast('Teste impresso. Veja qual foi o MAIOR número cuja tarja apareceu ' +
          'INTEIRA (com a seta ◄ no fim) — essa é a largura certa.', 'ok', 12000);
  } catch (e) {
    toast('Não consegui imprimir o teste: ' + (e?.message || 'erro'), 'erro', 8000);
    mostrarRegistroImpressao();
  }
}

// Mostra o passo a passo da última impressão, na própria tela.
// Serve para o caso mais difícil: a impressora aceita tudo e não imprime —
// aí o registro diz quantas linhas tinham conteúdo e o que ela respondeu.
function mostrarRegistroImpressao() {
  // Painel de registro DESLIGADO (pedido do João, 08/08/2026): impressão
  // funcionando, tela limpa. Para reativar num diagnóstico futuro, rode no
  // console: localStorage.setItem('niimbot_log_arquivo','1') — a mesma chave
  // religa o arquivo .txt e este painel.
  if (localStorage.getItem('niimbot_log_arquivo') !== '1') return;
  const log = (typeof NiimbotWeb !== 'undefined' && NiimbotWeb.log) || [];
  if (!log.length) return;
  const area = document.getElementById('nb-previa-area');
  const info = document.getElementById('nb-previa-info');
  if (!area || !info) return;

  const cor = t => /ALERTA|SEM RESPOSTA|erro/i.test(t) ? '#b02a37'
    : /fim|aceito|enviada/i.test(t) ? '#0f7a52' : '#5a7183';
  area.style.display = '';
  info.innerHTML = `
    <details open style="text-align:left">
      <summary style="cursor:pointer;font-size:.85rem;margin-bottom:6px">
        📋 Registro da impressão (${log.length} passos)</summary>
      <div style="max-height:190px;overflow:auto;font-size:.74rem;line-height:1.55;
           font-family:ui-monospace,monospace;background:#fff;border-radius:8px;padding:8px">
        ${log.map(l => `<div style="color:${cor(l.tipo)}">
          <span style="opacity:.6">${l.t}</span> <b>${esc(l.tipo)}</b>: ${esc(l.msg)}</div>`).join('')}
      </div>
      <button class="btn-mini" style="margin-top:7px"
        onclick="copiarRegistroImpressao()">📋 Copiar registro</button>
    </details>`;
}

function copiarRegistroImpressao() {
  const log = (typeof NiimbotWeb !== 'undefined' && NiimbotWeb.log) || [];
  const txt = 'REGISTRO DA IMPRESSÃO — ' + new Date().toLocaleString('pt-BR') + '\n' +
    log.map(l => `${l.t}  ${l.tipo}: ${l.msg}`).join('\n');
  navigator.clipboard.writeText(txt)
    .then(() => toast('Registro copiado — pode colar aqui na conversa', 'ok', 4000))
    .catch(() => prompt('Copie o registro:', txt));
}

// Diagnóstico da etiqueta: percorre a cadeia e mostra ONDE falha, na tela.
// Existe porque "sai em branco" pode ser desenho, dados, biblioteca ou envio
// — e sem saber qual, a correção vira adivinhação.
async function diagnosticarEtiqueta(tam) {
  const L = [];
  const ok = (t, v) => L.push(`<div style="color:#0f7a52">✓ ${t}: ${esc(String(v))}</div>`);
  const nao = (t, v) => L.push(`<div style="color:#b02a37"><b>✗ ${t}: ${esc(String(v))}</b></div>`);

  const d = window._etiquetaDados;
  d ? ok('dados da etiqueta', d.numero || '(sem número)') : nao('dados da etiqueta', 'AUSENTES');
  typeof NiimbotWeb !== 'undefined' ? ok('módulo niimbot.js', 'carregado')
    : nao('módulo niimbot.js', 'NÃO CARREGOU');
  window.NB_MODELOS_FULL ? ok('tabela de modelos', Object.keys(window.NB_MODELOS_FULL).length + ' modelos')
    : nao('tabela de modelos', 'AUSENTE — o niimbot.js não expôs os dados');

  let alvo = null;
  try {
    alvo = alvoImpressora(document.getElementById('nb-modelo')?.value || 'b1_pro',
      parseInt(document.getElementById('nb-rotacao')?.value) || 0);
    ok('alvo da impressora', `${alvo.dpi}dpi · cabeçote ${alvo.cabecoteMm}mm (${alvo.cabecotePx}px)`);
  } catch (e) { nao('alvo da impressora', e.message); }

  let cv = null;
  try {
    window._etiquetaParaImpressora = alvo;
    window._etiquetaSoCanvas = true;
    cv = await baixarEtiquetaImagem(tam);
    ok('desenho', cv ? `${cv.width} × ${cv.height} px` : 'devolveu VAZIO');
  } catch (e) {
    nao('desenho', e.message);
  } finally { window._etiquetaSoCanvas = false; window._etiquetaParaImpressora = null; }

  if (cv) {
    try {
      const px = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let escuros = 0;
      for (let i = 0; i < px.length; i += 40) if (px[i] < 128) escuros++;
      escuros > 50 ? ok('conteúdo', escuros + ' pontos desenhados')
                   : nao('conteúdo', 'CANVAS EM BRANCO (' + escuros + ' pontos)');
    } catch (e) { nao('leitura do canvas', e.message); }
  }

  // Consulta a impressora, se estiver conectada (só aqui, nunca no meio da
  // impressão — no fluxo normal isso atrapalhava e travava a saída)
  if (_niimbot && _niimbot.caract) {
    try { await _niimbot.lerEtiqueta();
      (NiimbotWeb.log || []).filter(x => x.tipo === 'impressora')
        .forEach(x => L.push(`<div style="color:#5a7183">🖨 ${esc(x.msg)}</div>`));
    } catch (e) { L.push('<div style="color:#b02a37">✗ impressora não respondeu</div>'); }
  } else {
    L.push('<div class="dica">impressora não conectada — conecte e imprima uma vez ' +
           'para eu conseguir consultar a etiqueta</div>');
  }

  const area = document.getElementById('nb-previa-area');
  const info = document.getElementById('nb-previa-info');
  if (area && info) {
    area.style.display = '';
    info.innerHTML = `<div style="text-align:left;font-size:.8rem;line-height:1.6">${L.join('')}</div>`;
    // mostra o desenho ao lado do relatório
    const alvoCv = document.getElementById('nb-previa');
    if (cv && alvoCv) {
      const esc2 = Math.min(300 / cv.width, 200 / cv.height, 1);
      alvoCv.width = Math.round(cv.width * esc2);
      alvoCv.height = Math.round(cv.height * esc2);
      const c2 = alvoCv.getContext('2d');
      c2.fillStyle = '#fff'; c2.fillRect(0, 0, alvoCv.width, alvoCv.height);
      c2.drawImage(cv, 0, 0, alvoCv.width, alvoCv.height);
    }
  }
}

// Mostra EXATAMENTE o que vai sair na impressora: mesmo desenho, mesmo
// tamanho, mesma rotação. Evita gastar etiqueta para descobrir a orientação.
async function previaEtiqueta(tam) {
  const bt = document.getElementById('nb-btn-previa');
  const area = document.getElementById('nb-previa-area');
  const info = document.getElementById('nb-previa-info');
  bt.disabled = true; bt.textContent = 'gerando…';
  try {
    const modelo = document.getElementById('nb-modelo')?.value || 'b1_pro';
    const rot = parseInt(document.getElementById('nb-rotacao')?.value) || 0;
    const alvo = alvoImpressora(modelo, rot);

    window._etiquetaParaImpressora = alvo;
    window._etiquetaSoCanvas = true;
    let canvas;
    try { canvas = await baixarEtiquetaImagem(tam); }
    finally { window._etiquetaSoCanvas = false; window._etiquetaParaImpressora = null; }
    if (!canvas) throw new Error('não consegui desenhar a etiqueta');

    canvas = rotacionar(canvas, rot);
    canvas = encaixarNoRolo(canvas, alvo);   // a prévia mostra a PÁGINA real

    // desenha na tela em tamanho legível (o original é 300 dpi)
    const alvoCanvas = document.getElementById('nb-previa');
    const escala = Math.min(320 / canvas.width, 260 / canvas.height, 1);
    alvoCanvas.width = Math.round(canvas.width * escala);
    alvoCanvas.height = Math.round(canvas.height * escala);
    const c = alvoCanvas.getContext('2d');
    c.imageSmoothingQuality = 'high';
    c.fillStyle = '#fff'; c.fillRect(0, 0, alvoCanvas.width, alvoCanvas.height);
    c.drawImage(canvas, 0, 0, alvoCanvas.width, alvoCanvas.height);

    const mmW = (canvas.width / alvo.dpi * 25.4).toFixed(0);
    const mmH = (canvas.height / alvo.dpi * 25.4).toFixed(0);
    const cabe = canvas.width <= alvo.cabecotePx;
    const fitaMaior = alvo.rolo.larguraMm > alvo.cabecoteMm;
    info.innerHTML = `${mmW} × ${mmH} mm · ${canvas.width}×${canvas.height} px · ` +
      (fitaMaior
        ? `<span style="color:#b7791f">a etiqueta tem ${alvo.rolo.larguraMm} mm de largura ` +
          `e esta impressora imprime ${alvo.cabecoteMm} mm — o conteúdo ocupa essa faixa ` +
          `e sobra margem branca à direita</span>`
        : `<span style="color:#0f7a52">✓ confere com o rolo ${alvo.rolo.rotulo} mm</span>`);
    area.style.display = '';
  } catch (e) {
    console.error('prévia da etiqueta:', e);
    const area2 = document.getElementById('nb-previa-area');
    const info2 = document.getElementById('nb-previa-info');
    if (area2 && info2) {           // mostra o erro NA TELA, não só no console
      area2.style.display = '';
      info2.innerHTML = `<span style="color:#b02a37">Falhou: ${esc(e?.message || 'erro')}` +
        `</span><br><span class="dica">Abra o console (F12) para o detalhe.</span>`;
      const cv2 = document.getElementById('nb-previa');
      if (cv2) { cv2.width = 10; cv2.height = 10; }
    }
    toast('Não consegui gerar a prévia: ' + (e?.message || 'erro'), 'erro', 6000);
  } finally {
    bt.disabled = false; bt.textContent = '👁 Pré-visualizar';
  }
}

// Caminho rápido: reconecta na impressora conhecida e imprime, sem modal.
// Se qualquer coisa falhar, devolve false e o fluxo normal assume.
async function tentarImpressaoDireta(tam, cfg) {
  const t = toast('Conectando na impressora…', 'ok', 30000);
  progressoImpressao('conectando à impressora…');
  try {
    if (typeof NiimbotWeb === 'undefined') return false;
    // Reusa a MESMA instância: a conexão fica viva entre impressões
    if (!_niimbot || _niimbot.modelo !== (NB_MODELOS_INFO && cfg.modelo))
      _niimbot = _niimbot || new NiimbotWeb(cfg.modelo);
    const nb = _niimbot;
    const vivo = nb.caract && nb.dispositivo?.gatt?.connected;
    const nome = vivo ? (nb.dispositivo?.name || 'impressora')
                      : await nb.reconectar();
    if (!nome) return false;                     // nenhuma autorizada ainda

    // Informa o alvo ANTES de desenhar: a etiqueta já nasce no tamanho e na
    // orientação que a impressora aceita — sem cortar nada depois.
    const alvo = alvoImpressora(cfg.modelo, cfg.rotacao);
    window._etiquetaParaImpressora = alvo;
    window._etiquetaSoCanvas = true;
    let canvas;
    try { canvas = await baixarEtiquetaImagem(tam); }
    finally { window._etiquetaSoCanvas = false; window._etiquetaParaImpressora = null; }
    if (!canvas) return false;

    canvas = rotacionar(canvas, cfg.rotacao || 0);
    canvas = encaixarNoRolo(canvas, alvo);       // página = tamanho do ROLO
    window._ultimoCanvasImpresso = canvas;       // para o log em arquivo

    progressoImpressao('enviando a imagem…');
    await nb.imprimir(canvas, { copias: cfg.copias || 1, densidade: cfg.densidade || 3,
      progresso: progressoImpressao });
    progressoImpressao('pronto ✓');
    toast(`Etiqueta impressa em ${nome} ✓`, 'ok', 4000);
    if (nome) localStorage.setItem('niimbot_nome', nome);
    gravarLogEtiqueta(tam, null);
    _niimbot?.desconectar();   // solta a impressora após CADA impressão
    document.querySelector('.modal-fundo')?.remove();
    return true;
  } catch (e) {
    progressoImpressao(null);   // fecha a barra: o modal assume
    console.warn('impressão direta falhou, abrindo as opções:', e?.message);
    gravarLogEtiqueta(tam, (e?.message || 'falha') + ' [impressão direta — vai abrir o modal]');
    toast('🖨️ ' + motivoFalhaImpressora(e), 'erro', 8000);
    return false;                                // cai no modal
  }
}

// Traduz o erro tecnico da impressora para um motivo que o tecnico entende
function motivoFalhaImpressora(e) {
  const m = (e?.message || '').toLowerCase();
  if (m.includes('tempo esgotado') || m.includes('timeout'))
    return 'A impressora não respondeu — verifique se está ligada e por perto. Escolha-a de novo na lista.';
  if (m.includes('não respondeu'))
    return 'A impressora parou de responder no meio — verifique papel e bateria e tente de novo.';
  if (m.includes('desconectada') || m.includes('disconnected'))
    return 'A conexão com a impressora caiu — toque em Imprimir para reconectar.';
  if (m.includes('gatt') || m.includes('bluetooth'))
    return 'Falha no Bluetooth — verifique se ele está ligado no aparelho e tente de novo.';
  if (m.includes('user cancelled') || m.includes('cancel'))
    return 'Seleção da impressora cancelada.';
  return 'Não foi possível imprimir direto (' + (e?.message || 'falha desconhecida') + '). Tente pela janela que abriu.';
}

async function executarImpressaoNiimbot(tam) {
  const bt = document.getElementById('nb-btn');
  const st = document.getElementById('nb-status');
  const er = document.getElementById('nb-erro');
  const diga = m => { if (st) st.textContent = m; };
  er.textContent = ''; bt.disabled = true;

  try {
    if (typeof NiimbotWeb === 'undefined')
      throw new Error('o módulo de impressão não carregou — recarregue a página (Ctrl+F5)');

    const modeloSel = document.getElementById('nb-modelo')?.value || 'b1_pro';

    // 1) desenha a etiqueta JÁ no tamanho da impressora (nada é cortado)
    diga('desenhando a etiqueta…');
    const alvoM = alvoImpressora(modeloSel,
      parseInt(document.getElementById('nb-rotacao')?.value) || 0);
    window._etiquetaParaImpressora = alvoM;
    window._etiquetaSoCanvas = true;
    let canvas;
    try { canvas = await baixarEtiquetaImagem(tam); }
    finally { window._etiquetaSoCanvas = false; window._etiquetaParaImpressora = null; }
    if (!canvas) throw new Error('não consegui gerar o desenho da etiqueta');

    // Rotação escolhida pelo usuário; depois a página é ajustada ao ROLO —
    // a B1 Pro imprime em branco quando a página não bate com a etiqueta
    // detectada pelo sensor (comprovado nos logs de 07/08/2026).
    const rot = parseInt(document.getElementById('nb-rotacao')?.value) || 0;
    canvas = rotacionar(canvas, rot);
    canvas = encaixarNoRolo(canvas, alvoM);      // página = tamanho do ROLO
    window._ultimoCanvasImpresso = canvas;       // para o log em arquivo

    // 2) conecta
    diga('procurando a impressora…');
    _niimbot = new NiimbotWeb(modeloSel);
    const nome = await _niimbot.conectar(document.getElementById('nb-todos').checked);
    if (nome) localStorage.setItem('niimbot_nome', nome);
    diga(`conectado a ${nome}`);

    // 3) imprime
    await _niimbot.imprimir(canvas, {
      copias: Math.max(1, parseInt(document.getElementById('nb-copias')?.value) || 1),
      densidade: 3,
      progresso: m => { diga(m); progressoImpressao(m); }
    });

    // Guarda para as próximas: da segunda vez em diante imprime direto
    try {
      localStorage.setItem('niimbot_cfg', JSON.stringify({
        modelo: modeloSel,
        copias: Math.max(1, parseInt(document.getElementById('nb-copias')?.value) || 1),
        densidade: 3,
        rotacao: parseInt(document.getElementById('nb-rotacao')?.value) || 0
      }));
    } catch (e) {}

    diga('');
    progressoImpressao('pronto ✓');
    mostrarRegistroImpressao();
    gravarLogEtiqueta(tam, null);
    toast('Etiqueta enviada ✓', 'ok', 5000);
    _niimbot?.desconectar();   // solta a impressora após CADA impressão
  } catch (e) {
    progressoImpressao(null);   // fecha a barra para o erro aparecer
    mostrarRegistroImpressao();
    const msg = e?.message || String(e);
    gravarLogEtiqueta(tam, msg);
    _niimbot?.desconectar();   // estado limpo também no erro
    er.innerHTML = /User cancelled|cancelad/i.test(msg)
      ? 'Você fechou a janela sem escolher a impressora.<br>' +
        '<span class="dica">Não apareceu nenhuma? Marque <b>“Mostrar todos os ' +
        'aparelhos”</b> acima e tente de novo — a impressora costuma aparecer ' +
        'com o nome do modelo, como “B1-1234”.</span>'
      : esc(msg) + '<br><span class="dica">Se não resolver, use ' +
        '"📱 Baixar imagem" e imprima pelo app da Niimbot.</span>';
    diga('');
  } finally {
    bt.disabled = false;
  }
}

// Características da impressora escolhida, para desenhar no tamanho certo
// Tamanho do rolo carregado (o que realmente limita a impressão)
function rolloAtual() {
  // ROLO ÚNICO da empresa (08/08/2026): 50x30. O valor salvo é ignorado de
  // propósito — evita que um '60x40' antigo no navegador mande página de
  // 60 mm no rolo de 30 mm (a causa da etiqueta atravessada na foto).
  const v = '50x30';
  localStorage.setItem('niimbot_rolo', v);
  const [a, b] = v.split('x').map(Number);
  // Largura da FITA (o lado que passa pelo cabeçote): a B1/B1 Pro aceita
  // fita de até 50 mm. Se o maior lado couber (<= 50), ele é a largura
  // (caso 50x30, conferido em foto); se NÃO couber (casos 40x60 e 70x50),
  // a largura só pode ser o menor lado. A regra antiga ("sempre o maior")
  // errava exatamente no rolo 40x60.
  const maior = Math.max(a, b), menor = Math.min(a, b);
  const larguraMm = maior <= 50 ? maior : menor;
  return { larguraMm, comprimentoMm: larguraMm === maior ? menor : maior, rotulo: v };
}

// ── ENCAIXE NO ROLO (correção do "sai em branco", 08/08/2026) ──
// COMPROVADO nos logs de 07/08: no MESMO rolo 40x60, a página 472x709
// (40x60 mm) imprimiu e a página 560x335 (47x28 mm) saiu em branco — a
// B1 Pro aceita todos os comandos mas não imprime quando o tamanho da
// página não bate com a etiqueta que o sensor de gap detectou.
// Por isso a página enviada agora é SEMPRE do tamanho do rolo físico
// informado na tela, e o desenho é escalado/centralizado dentro dela.
function encaixarNoRolo(canvas, alvo) {
  // ═══ PÁGINA DUPLA — validada em 08/08/2026 (testes T19/T20) ═══
  // A firmware da B1 Pro DESCARTA páginas curtas (~30 mm) via Bluetooth —
  // bug conhecido e em aberto na comunidade (niimblue issue #86: por USB
  // funciona, por BT falha; nem o mantenedor resolveu ainda). Páginas altas
  // imprimem 100%. Então cada job leva DUAS etiquetas 50x30: o conteúdo vai
  // em cima e embaixo, espaçado pelo PASSO (etiqueta+vão), e a impressora se
  // realinha no gap a cada job. Quando o bug for resolvido, basta voltar
  // esta função para página simples.
  const S = alvo.dpi / 25.4;
  const pw = Math.floor(Math.min(alvo.cabecoteMm, alvo.rolo.larguraMm) * S / 8) * 8;
  const hEt = Math.round(alvo.rolo.comprimentoMm * S);
  const passo = parseFloat(localStorage.getItem('niimbot_passo')) || 33;
  const hP = Math.round(passo * S);
  const ph = hP * 2;
  if (!pw || !hEt) return canvas;

  let aj = { x: 0, y: 0 };
  try { aj = JSON.parse(localStorage.getItem('niimbot_ajuste') || '{"x":0,"y":0}') || aj; }
  catch (e) {}
  const dx = Math.round((aj.x || 0) * S), dy = Math.round((aj.y || 0) * S);
  const repetir = (localStorage.getItem('niimbot_segunda') || 'repetir') === 'repetir';

  const esc = Math.min(pw / canvas.width, hEt / canvas.height, 1);
  const w = Math.round(canvas.width * esc), h = Math.round(canvas.height * esc);
  const cv = document.createElement('canvas');
  cv.width = pw; cv.height = ph;
  const c = cv.getContext('2d');
  c.fillStyle = '#fff'; c.fillRect(0, 0, pw, ph);
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  const nCopias = repetir ? 2 : 1;
  for (let n = 0; n < nCopias; n++) {
    c.drawImage(canvas, Math.round((pw - w) / 2) + dx,
      n * hP + Math.round((hEt - h) / 2) + dy, w, h);
  }
  window._encaixeInfo = 'PÁGINA DUPLA ' + pw + 'x' + ph + ' px | passo ' + passo +
    ' mm | 2ª etiqueta: ' + (repetir ? 'repetida' : 'em branco') +
    ' | desenho a ' + Math.round(esc * 100) + '% | ajuste ' + (aj.x || 0) + '/' + (aj.y || 0) + ' mm';
  return cv;
}




function salvarRolo() {
  const v = document.getElementById('nb-rolo')?.value;
  if (v) localStorage.setItem('niimbot_rolo', v);
  if (typeof _tamAtual !== 'undefined' && _tamAtual) previaEtiqueta(_tamAtual);
}

function alvoImpressora(modelo, rotacao) {
  // Vem do niimbot.js, que tem os dados reais de cada modelo — deduzir o dpi
  // pela largura em pixels dava errado (o B3S tem 576 px mas é 203 dpi).
  // A tabela local é a rede de segurança: se o niimbot.js não tiver carregado,
  // os números continuam certos em vez de assumir um modelo qualquer.
  const RESERVA = {
    b1: { dpi: 203, cabecote: 384 }, b1_pro: { dpi: 300, cabecote: 567 },
    b21: { dpi: 203, cabecote: 384 }, b21_pro: { dpi: 300, cabecote: 591 },
    b3s: { dpi: 203, cabecote: 576 }, d110: { dpi: 203, cabecote: 96 }
  };
  const m = (window.NB_MODELOS_FULL || {})[modelo] || RESERVA[modelo]
            || { dpi: 300, cabecote: 567 };

  // O LIMITE REAL é o menor entre o cabeçote e a largura do ROLO carregado.
  // Era esse o erro: eu usava só o cabeçote (48 mm) enquanto o rolo tinha
  // 40 mm — a impressora recebia dados mais largos que o papel e não
  // imprimia nada.
  const rolo = rolloAtual();
  const cabecoteMm = Math.floor(m.cabecote / m.dpi * 25.4);
  const utilMm = Math.min(cabecoteMm, rolo.larguraMm);
  return { dpi: m.dpi, cabecotePx: m.cabecote, cabecoteMm,
           utilMm, utilPx: Math.floor(utilMm * m.dpi / 25.4 / 8) * 8,
           rolo, rotacao: rotacao || 0 };
}

// Prepara a imagem para o cabeçote: gira 90° se não couber e aplica a
// inversão de 180° quando o usuário pedir. Uma função só, usada nos dois
// caminhos (impressão direta e pelo modal) — antes a lógica estava duplicada
// e os dois giravam diferente.
function ajustarParaImpressora(canvas, cabecote, inverter) {
  if (canvas.width > cabecote) canvas = girarCanvas(canvas);   // sempre anti-horário
  if (inverter) canvas = girar180(canvas);
  return canvas;
}

// Gira a imagem em 0, 90, 180 ou 270 graus (horário).
// Em 90 e 270 as dimensões trocam — o canvas novo já nasce no tamanho certo.
function rotacionar(origem, graus) {
  const g = ((graus % 360) + 360) % 360;
  if (g === 0) return origem;
  const trocaLados = (g === 90 || g === 270);
  const cv = document.createElement('canvas');
  cv.width = trocaLados ? origem.height : origem.width;
  cv.height = trocaLados ? origem.width : origem.height;
  const c = cv.getContext('2d');
  c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height);
  c.translate(cv.width / 2, cv.height / 2);
  c.rotate(g * Math.PI / 180);
  c.drawImage(origem, -origem.width / 2, -origem.height / 2);
  return cv;
}

function girar180(origem) {
  const cv = document.createElement('canvas');
  cv.width = origem.width; cv.height = origem.height;
  const c = cv.getContext('2d');
  c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height);
  c.translate(cv.width / 2, cv.height / 2);
  c.rotate(Math.PI);
  c.drawImage(origem, -origem.width / 2, -origem.height / 2);
  return cv;
}

// Gira o canvas 90° — para quando a largura excede o cabeçote.
// ANTI-HORÁRIO: no teste impresso, o sentido horário saiu de cabeça para
// baixo em relação à etiqueta. Este é o sentido correto para a B1/B1 Pro.
function girarCanvas(origem, horario = false) {
  const cv = document.createElement('canvas');
  cv.width = origem.height; cv.height = origem.width;
  const c = cv.getContext('2d');
  c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height);
  c.translate(cv.width / 2, cv.height / 2);
  c.rotate(horario ? Math.PI / 2 : -Math.PI / 2);
  c.drawImage(origem, -origem.width / 2, -origem.height / 2);
  return cv;
}

// Nome de arquivo seguro (Windows não aceita / \\ : * ? " < > |)
function limpaNomeArq(t) {
  return String(t || 'etiqueta').replace(/[\\/:*?"<>|]+/g, '-').trim();
}

function gerarEtiqueta(tam) {
  document.querySelector('.modal-fundo')?.remove();
  lembrarModeloEtiqueta(tam);
  const d = window._etiquetaDados;
  if (!d) { toast('Dados da etiqueta não disponíveis. Tente novamente.', 'erro'); return; }
  const L = layoutEtiqueta(tam, d);

  const w = window.open('', '_blank');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Etiqueta ${esc(d.numero)}</title>
    <style>
      @page { size: ${L.w}mm ${L.h}mm; margin: 0; }
      ${cssEtiqueta()}
    </style></head><body>${L.html}
    <script>
      var img = document.querySelector('img');
      if (img && !img.complete) { img.onload = function(){ window.print(); }; }
      else { window.print(); }
    <\/script></body></html>`);
  w.document.close();
}

// Regera o PDF de um certificado emitido com o MODELO ATUAL da empresa.
// O conteudo tecnico (medicoes, numero, data) nao muda - so o layout.
// Util quando o modelo do certificado e alterado nas configuracoes.
async function regerarPdfCert(id) {
  if (!confirm('Regerar o PDF deste certificado com o modelo atual?\n\n' +
      'As medicoes, o numero e a data NAO mudam - apenas o layout do documento. ' +
      'O arquivo anterior sera substituido (o codigo de verificacao do PDF muda).')) return;
  try {
    await api('/certificados/' + id + '/regerar-pdf', { method: 'POST' });
    toast('PDF sendo regerado. Aguarde alguns segundos e abra novamente para ver o novo modelo.', 'ok', 6000);
  } catch (e) { toast(e.message, 'erro'); }
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
          <button onclick="this.closest('.modal-fundo').remove();abrirFotosCert('${id}')">📷 Fotos das leituras</button>
          <button onclick="this.closest('.modal-fundo').remove();verMemorialIncerteza('${id}')">🔬 Cálculo da incerteza</button>
          ${['admin', 'responsavel_tecnico'].includes(usuario.papel)
            ? `<button onclick="this.closest('.modal-fundo').remove();regerarPdfCert('${id}')">🔄 Regerar PDF (modelo atual)</button>`
            : ''}
          ${['admin', 'responsavel_tecnico'].includes(usuario.papel)
            ? `<button onclick="this.closest('.modal-fundo').remove();abrirResponsaveisCert('${id}')">👤 Técnico e RT</button>`
            : ''}
          ${podeRevisar
            ? `<button style="color:#b02a37;border-color:#b02a37" onclick="this.closest('.modal-fundo').remove();abrirCancelarCert('${id}','')">🚫 Cancelar certificado</button>`
            : ''}
          ${podeRevisar
            ? `<button class="btn-vinho-full" onclick="this.closest('.modal-fundo').remove();emitirRevisao('${id}')">✎ Emitir revisão</button>`
            : ''}
          <button onclick="this.closest('.modal-fundo').remove()">Fechar</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', acoes);
}

// ── Fotos das leituras (só usuários do sistema) ───────────────
async function abrirFotosCert(id) {
  window._fotoCertId = id;
  const modal = document.createElement('div');
  modal.className = 'modal-fundo';
  modal.id = 'modal-fotos';
  modal.onclick = e => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `
    <div class="modal-caixa" style="max-width:560px">
      <h3>📷 Fotos das leituras</h3>
      <p class="dica">Evidência visual de que os valores conferem com o display da balança.
        Visível apenas para a equipe (não aparece para o cliente nem na validação por QR).</p>
      <div id="fotos-lista" style="margin:12px 0"><p class="dica">Carregando…</p></div>
      <label class="btn-primario" style="display:inline-block;cursor:pointer">
        📷 Tirar foto
        <input type="file" accept="image/*" capture="environment" style="display:none"
          onchange="enviarFotoCert(this)">
      </label>
      <label class="btn-primario" style="display:inline-block;cursor:pointer;margin-left:8px">
        🖼 Da galeria
        <input type="file" accept="image/*" multiple style="display:none"
          onchange="enviarFotoCert(this)">
      </label>
      <button onclick="document.getElementById('modal-fotos').remove()" style="margin-left:8px">Fechar</button>
      <p id="foto-erro" class="erro" style="margin-top:8px"></p>
    </div>`;
  document.body.appendChild(modal);
  carregarFotosCert();
}

async function carregarFotosCert() {
  const id = window._fotoCertId;
  const box = $('#fotos-lista');
  try {
    const fotos = await api('/certificados/' + id + '/fotos');
    if (!fotos.length) { box.innerHTML = '<p class="dica">Nenhuma foto ainda.</p>'; return; }
    box.innerHTML = `<div class="fotos-grade">${fotos.map(f => `
      <div class="foto-item">
        <img src="/api/certificados/fotos/${f.id}" loading="lazy"
          onclick="window.open('/api/certificados/fotos/${f.id}','_blank')" alt="foto">
        ${f.legenda ? `<span class="foto-legenda">${esc(f.legenda)}</span>` : ''}
        <button class="foto-del" title="Excluir" onclick="excluirFotoCert('${f.id}')">✕</button>
      </div>`).join('')}</div>`;
  } catch (e) { box.innerHTML = `<p class="erro">${e.message}</p>`; }
}

async function enviarFotoCert(input) {
  const arquivos = Array.from(input.files || []);
  if (!arquivos.length) return;
  const id = window._fotoCertId;
  $('#foto-erro').textContent = '';
  // legenda única só quando é 1 foto (várias da galeria: sem interromper N vezes)
  const legenda = arquivos.length === 1
    ? (prompt('Legenda da foto (opcional) — ex.: "Carga 10 kg":') || '') : '';
  let enviadas = 0;
  for (const arquivo of arquivos) {
    const fd = new FormData();
    fd.append('arquivo', arquivo);
    if (legenda) fd.append('legenda', legenda);
    try {
      const r = await fetch('/api/certificados/' + id + '/fotos', {
        method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.erro || 'Falha no envio'); }
      enviadas++;
    } catch (e) {
      const mFoto = e instanceof TypeError ? 'Falha de conexão durante o envio — verifique a internet e tente novamente' : e.message;
      $('#foto-erro').textContent = `${mFoto}${arquivos.length > 1 ? ` (${enviadas} de ${arquivos.length} enviadas)` : ''}`;
      break;
    }
  }
  if (enviadas) {
    toast(enviadas === 1 ? 'Foto adicionada' : `${enviadas} fotos adicionadas`, 'ok');
    carregarFotosCert();
  }
  input.value = '';
}

async function excluirFotoCert(fotoId) {
  const ok = await modalConfirmar('Excluir foto',
    'Deseja excluir esta foto? Esta ação não pode ser desfeita.',
    { textoSim: 'Excluir', textoNao: 'Cancelar', perigoso: true });
  if (!ok) return;
  try {
    await api('/certificados/fotos/' + fotoId, { method: 'DELETE' });
    carregarFotosCert();
  } catch (e) { toast(e.message, 'erro'); }
}

// ── Fotos durante o ensaio (usam o certId do rascunho) ────────
async function carregarFotosEnsaio() {
  const box = $('#ens-fotos-lista');
  if (!box || !certId) return;
  try {
    const fotos = await api('/certificados/' + certId + '/fotos');
    if (!fotos.length) { box.innerHTML = '<p class="dica">Nenhuma foto ainda.</p>'; return; }
    box.innerHTML = `<div class="fotos-grade">${fotos.map(f => `
      <div class="foto-item">
        <img src="/api/certificados/fotos/${f.id}" loading="lazy"
          onclick="window.open('/api/certificados/fotos/${f.id}','_blank')" alt="foto">
        ${f.legenda ? `<span class="foto-legenda">${esc(f.legenda)}</span>` : ''}
        <button class="foto-del" title="Excluir" onclick="excluirFotoEnsaio('${f.id}')">✕</button>
      </div>`).join('')}</div>`;
  } catch (e) { box.innerHTML = `<p class="erro">${e.message}</p>`; }
}

async function enviarFotoEnsaio(input) {
  // Aceita VÁRIOS arquivos: da galeria o técnico costuma mandar um lote
  // (João, 19/08/2026). Uma legenda só para o conjunto, para não perguntar
  // arquivo por arquivo.
  const arquivos = [...(input.files || [])];
  if (!arquivos.length) return;
  $('#ens-foto-erro').textContent = '';
  if (!certId) { $('#ens-foto-erro').textContent = 'Salve o rascunho antes de anexar fotos.'; return; }
  try { await salvarRascunho(false); } catch { /* segue */ }
  const legenda = prompt(arquivos.length > 1
    ? `Legenda para as ${arquivos.length} fotos (opcional) — ex.: "Ensaio de indicação":`
    : 'Legenda da foto (opcional) — ex.: "Carga 10 kg":') || '';
  let enviadas = 0;
  for (const arquivo of arquivos) {
    const fd = new FormData();
    fd.append('arquivo', arquivo);
    if (legenda) fd.append('legenda', legenda);
    try {
      const r = await fetch('/api/certificados/' + certId + '/fotos', {
        method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.erro || 'Falha no envio'); }
      enviadas++;
    } catch (e) {
      const mFoto = e instanceof TypeError ? 'Falha de conexão durante o envio — verifique a internet e tente novamente' : e.message;
      $('#ens-foto-erro').textContent = `${arquivo.name}: ${mFoto}`;
    }
  }
  if (enviadas) toast(enviadas > 1 ? `${enviadas} fotos adicionadas` : 'Foto adicionada', 'ok');
  carregarFotosEnsaio();
  input.value = '';
}

async function excluirFotoEnsaio(fotoId) {
  const ok = await modalConfirmar('Excluir foto',
    'Deseja excluir esta foto?',
    { textoSim: 'Excluir', textoNao: 'Cancelar', perigoso: true });
  if (!ok) return;
  try {
    await api('/certificados/fotos/' + fotoId, { method: 'DELETE' });
    carregarFotosEnsaio();
  } catch (e) { toast(e.message, 'erro'); }
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
    window._clienteEnsaio = ct.cliente_id;   // usado pelo seletor de endereço
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
    window._clienteEnsaio = ct.cliente_id;   // usado pelo seletor de endereço
    if (ct.emitir_rbc) {
      // Certificado RBC: abre a coleta RBC (fluxo guiado), nao a tela da Portaria 157
      window._ensaioRbc = true;
      window._rbcAbrirNoResumo = false;
      await montarTelaEnsaioRbc();
      toast('Editando a coleta RBC — ao concluir, use "Enviar para aprovação".', 'info', 6000);
      return;
    }
    montarTelaEnsaio(ct.dados_rascunho ? JSON.parse(ct.dados_rascunho) : null);
    toast('Editando o ensaio — ao concluir, use "Enviar para aprovação" e aprove em seguida.', 'info', 6000);
  } catch (e) { toast('Não foi possível abrir para edição: ' + e.message, 'erro'); }
}

// ═══════ Prévia do PDF antes de aprovar ═══════
// Gera o PDF real com marca d'água "AGUARDANDO APROVAÇÃO", exibe em
// tela cheia e oferece Sair / Aprovar e emitir.
async function abrirPreviaAprovacao() {
  const id = window._revCertId;
  if (!id) { toast('Certificado não identificado.', 'erro'); return; }
  const fundo = document.createElement('div');
  fundo.className = 'modal-fundo';
  fundo.id = 'previa-fundo';
  fundo.innerHTML = `<div class="modal-caixa" style="max-width:1200px;width:97vw;height:95vh;display:flex;flex-direction:column;padding:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <h3 style="margin:0">Prévia do certificado</h3>
        <span class="dica">Documento com marca d'água até a aprovação</span>
      </div>
      <div id="previa-corpo" style="flex:1;display:flex;align-items:center;justify-content:center;background:#f4f7fa;border-radius:8px">
        <p class="dica">Gerando a prévia…</p>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end">
        <button onclick="if(window._previaUrl)window.open(window._previaUrl,'_blank')">↗ Abrir em nova aba</button>
        <button onclick="fecharPrevia()">Sair</button>
        <button class="btn-primario" id="previa-aprovar">✓ Aprovar e emitir</button>
      </div>
    </div>`;
  document.body.appendChild(fundo);
  document.getElementById('previa-aprovar').onclick = () => { fecharPrevia(); aprovarCert(id); };

  try {
    const r = await api('/certificados/' + id + '/previa-aprovacao', { method: 'POST' });
    // o Worker gera de forma assíncrona: tenta buscar por alguns segundos
    const url = '/api/certificados/previa-aprovacao?token=' + encodeURIComponent(r.token);
    let ok = false;
    for (let i = 0; i < 15 && !ok; i++) {
      await new Promise(res => setTimeout(res, 1000));
      try {
        const resp = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
        if (resp.ok) {
          const blob = await resp.blob();
          const objUrl = URL.createObjectURL(blob);
          const corpo = document.getElementById('previa-corpo');
          if (corpo) corpo.innerHTML =
            '<iframe src="' + objUrl + '#zoom=page-fit&pagemode=none&navpanes=0&toolbar=1" ' +
            'style="width:100%;height:100%;border:0;border-radius:8px;background:#fff"></iframe>';
          window._previaUrl = objUrl;
          ok = true;
        }
      } catch (e) { /* ainda gerando */ }
    }
    if (!ok) {
      const corpo = document.getElementById('previa-corpo');
      if (corpo) corpo.innerHTML = '<p class="erro">Não foi possível gerar a prévia agora. Você ainda pode aprovar normalmente.</p>';
    }
  } catch (e) {
    const corpo = document.getElementById('previa-corpo');
    if (corpo) corpo.innerHTML = '<p class="erro">' + esc(e.message) + '</p>';
  }
}
function fecharPrevia() {
  document.getElementById('previa-fundo')?.remove();
}

async function abrirRevisao(id) {
  window._revCertId = id;
  const d = await api('/certificados/' + id + '/revisao');
  const c = d.certificado;
  // Casas decimais pela MENOR divisão relevante: em multi-intervalo,
  // considera também as faixas (o "e" único pode estar vazio/0 nesse caso).
  const casasDe = v => {
    const s = String(v ?? '');
    const pt = s.indexOf('.');
    return pt < 0 ? 0 : s.slice(pt + 1).replace(/0+$/, '').length;
  };
  const casasRev = (() => {
    const valores = [c.divisao_e]
      .concat((d.faixas || []).map(f => f.divisao_e))
      .filter(v => v != null && Number(v) > 0);
    return valores.length ? Math.max(...valores.map(casasDe)) : 0;
  })();
  const un = normUnid(c.unidade);
  const fR = n => n == null ? '—' : Number(n).toLocaleString('pt-BR',
    { minimumFractionDigits: casasRev, maximumFractionDigits: casasRev });
  // Casas da coluna pela MAIOR incerteza da tabela (GUM 7.2.6); o resultado
  // herda essas casas e a incerteza é arredondada para cima, sem ±
  const casasCol = casasTabelaU((d.indicacao || []).map(x => x.incerteza), casasRev);
  const fC = n => n == null ? '—' : Number(n).toLocaleString('pt-BR',
    { minimumFractionDigits: casasCol, maximumFractionDigits: casasCol });
  const fRInc = n => n == null ? '—' : arredondarCima(n, casasCol)
    .toLocaleString('pt-BR', { minimumFractionDigits: casasCol, maximumFractionDigits: casasCol });
  const temAjuste = !!c.houve_ajuste;

  const linhaInd = l => `<tr>
    <td class="num">${fR(l.carga_aplicada)}</td>
    ${temAjuste ? `<td class="num">${l.sem_leitura_antes
      ? '<span style="color:#b02a37;font-style:italic">sem leitura</span>'
      : l.indicacao_antes == null ? '—' : fR(l.indicacao_antes)}</td>` : ''}
    <td class="num">${l.sem_leitura
      ? '<span style="color:#b02a37;font-style:italic">sem leitura</span>' : fR(l.indicacao)}</td>
    <td class="num">${l.sem_leitura ? '—' : (l.erro > 0 ? '+' : '') + fR(l.erro)}</td>
    <td class="num">${l.sem_leitura ? '—' : fRInc(l.incerteza)}</td><td class="num">${fC(l.ema)}</td>
    <td>${l.aprovado == null ? '—' : l.aprovado
      ? '<span class="badge ok">Conforme</span>'
      : '<span class="badge rep">Não conforme</span>'}</td></tr>`;
  const excAntes = temAjuste && (d.excentricidade || []).some(x => x.indicacao_antes != null);
  const linhaExc = (x, i) => `<tr><td>${i + 1}${x.posicao === 'centro' ? ' (ref.)' : ''}</td>
    ${excAntes ? `<td class="num">${x.indicacao_antes == null ? '—' : fR(x.indicacao_antes)}</td>` : ''}<td class="num">${fR(x.indicacao)}</td>
    <td class="num">${(x.erro > 0 ? '+' : '') + fR(x.erro)}</td>
    <td>${x.posicao === 'centro' ? 'ref.' : x.aprovado == null ? '—' : x.aprovado
      ? '<span class="badge ok">Conforme</span>'
      : '<span class="badge rep">Não conforme</span>'}</td></tr>`;
  const linhaRep = r => `<tr><td>${r.medicao_num}</td>
    <td class="num">${fR(r.indicacao)}</td></tr>`;
  const chip = (rot, v) => (v == null || v === '') ? '' :
    `<span class="chip"><b>${rot}:</b> ${esc(String(v))}</span>`;
  const localTxt = (c.local_tipo === 'laboratorio'
    ? 'Laboratório (instalações do emissor)' : 'In loco (instalações do cliente)')
    + (c.local_detalhe ? ' — ' + c.local_detalhe : '');
  const naoConformes = d.indicacao.filter(l => l.aprovado === false).length;
  // guarda os detalhes dos pontos reprovados para a confirmação na aprovação
  window._revNaoConformes = d.indicacao
    .filter(l => l.aprovado === false)
    .map(l => `${fmtU(l.carga_aplicada)} ${un} (erro ${l.erro > 0 ? '+' : ''}${fmtU(l.erro)}, EMA ±${fmtU(l.ema)})`);

  // Avalia a conformidade da sensibilidade (mesma tolerância do PDF: meia divisão)
  let sensNaoConforme = false, sensTxt = '';
  const sns = d.sensibilidade;
  if (sns && sns.carga_referencia != null && sns.resultado_display != null) {
    const esperado = Number(sns.carga_referencia) + Number(sns.adicao || 0);
    const tol = Number(sns.adicao) > 0 ? Number(sns.adicao) / 2 : 1e-7;
    sensNaoConforme = Math.abs(Number(sns.resultado_display) - esperado) > tol;
    if (sensNaoConforme)
      sensTxt = `esperado ${fmtU(esperado)} ${un}, display ${fmtU(sns.resultado_display)} ${un}`;
  }
  window._revSensNaoConforme = sensNaoConforme ? sensTxt : null;

  const html = `
    <div class="card">
      <div class="barra"><h3>Aprovação · ${esc(c.cliente)}</h3>
        <div class="barra-btns">
          <button class="btn-mini" onclick="imprimirEtiqueta('${id}')">🏷️ Etiqueta</button>
          ${ehGestor() ? `<button class="btn-mini" title="Trocar o técnico executor ou o responsável técnico"
            onclick="abrirResponsaveisCert('${id}')">👤 Técnico e RT</button>` : ''}
          <button class="btn-mini" onclick="irPainel()">← Painel</button>
        </div></div>

      <div class="chips">
        ${chip('Equipamento', c.balanca)}
        ${chip('Marca', c.marca)} ${chip('Modelo', c.modelo)}
        ${chip('Série', c.num_serie)} ${chip('Inmetro', c.numero_inmetro)}
        ${chip('Patrimônio', c.patrimonio)} ${chip('Portaria aprov.', c.portaria_aprovacao)}
        ${chip('Capacidade', fR(c.capacidade) + ' ' + un)}
        ${c.multi_intervalo && d.faixas?.length
          ? chip('Divisões (multi-intervalo)', d.faixas.map(f => `até ${fR(f.limite_sup)}: ${fR(f.divisao_e)}`).join(' · ') + ' ' + un)
          : chip('Divisão e', fR(c.divisao_e) + ' ' + un)}
        ${chip('Classe', c.classe_exatidao)}
      </div>
      <div class="chips" style="margin-top:6px">
        ${chip('Técnico', c.tecnico)}
        ${chip('Data', c.data_calibracao ? new Date(c.data_calibracao).toLocaleDateString('pt-BR') : null)}
        ${chip('Critério', c.contexto_ema === 'em_uso' ? 'Em uso' : 'Verificação subsequente')}
        ${chip('Local', localTxt)}
        ${chip('Temperatura', c.temperatura != null ? c.temperatura + ' °C' : null)}
        ${chip('Umidade', c.umidade != null ? c.umidade + ' %' : null)}
        ${chip('Pressão', c.pressao != null ? c.pressao + ' hPa' : null)}
        ${chip('Lacre', c.numero_lacre)} ${chip('Selo Inmetro', c.selo_inmetro)}
      </div>

      ${naoConformes > 0 ? `<p class="erro" style="margin-top:8px">⚠️ Atenção: ${naoConformes} ponto${naoConformes === 1 ? '' : 's'} de indicação NÃO conforme.</p>` : ''}
      ${sensNaoConforme ? `<p class="erro" style="margin-top:8px">⚠️ Atenção: teste de sensibilidade NÃO conforme (${sensTxt}).</p>` : ''}
      ${temAjuste ? '<p class="dica" style="margin-top:8px">🔧 A balança precisou de ajuste — leituras antes e depois registradas; conformidade avaliada sobre a leitura final.</p>' : ''}

      <style>.tab-c th, .tab-c td { text-align: center !important }</style>
      <h4 style="margin-top:12px">Indicação (${un})</h4>
      <table class="tab-c"><thead><tr><th class="num">Carga</th>${temAjuste ? '<th class="num">Antes ajuste</th>' : ''}<th class="num">${temAjuste ? 'Após ajuste' : 'Indicação'}</th><th class="num">Erro</th>
        <th class="num">Incerteza</th><th class="num">EMA</th><th>Situação</th></tr></thead>
        <tbody>${d.indicacao.map(linhaInd).join('')}</tbody></table>

      ${d.excentricidade && d.excentricidade.length > 0 ? `
        <h4 style="margin-top:12px">Excentricidade (${un})
          <span class="dica" style="font-weight:400">· carga: ${fR(d.excentricidade[0]?.carga)} ${un}</span></h4>
        <table class="tab-c"><thead><tr><th>Posição</th>${excAntes ? '<th class="num">Antes ajuste</th>' : ''}<th class="num">${excAntes ? 'Após ajuste' : 'Indicação'}</th><th class="num">Erro (vs centro)</th><th>Situação</th></tr></thead>
          <tbody>${d.excentricidade.map(linhaExc).join('')}</tbody></table>` : ''}

      ${d.repetibilidade && d.repetibilidade.length > 0 ? `
        <h4 style="margin-top:12px">Repetibilidade (${un})
          <span class="dica" style="font-weight:400">· carga: ${fR(d.repetibilidade[0]?.carga)} ${un}</span></h4>
        <table class="tab-c"><thead><tr><th>Medição</th><th>Indicação</th></tr></thead>
          <tbody>${d.repetibilidade.map(linhaRep).join('')}</tbody></table>` : ''}

      ${sns && sns.carga_referencia != null ? `
        <h4 style="margin-top:12px">Sensibilidade (${un})</h4>
        <table class="tab-c"><thead><tr><th>Carga de referência</th><th>Adição</th>
          <th>Esperado</th><th>Display</th><th>Situação</th></tr></thead>
          <tbody><tr>
            <td>${fR(sns.carga_referencia)}</td>
            <td>${sns.adicao == null ? '—' : fR(sns.adicao)}</td>
            <td>${fR(Number(sns.carga_referencia) + Number(sns.adicao || 0))}</td>
            <td>${sns.resultado_display == null ? '—' : fR(sns.resultado_display)}</td>
            <td>${sns.resultado_display == null ? '—' : sensNaoConforme
              ? '<span class="badge rep">Não conforme</span>'
              : '<span class="badge ok">Conforme</span>'}</td>
          </tr></tbody></table>` : ''}

      <h4 style="margin-top:12px">Pesos padrão utilizados</h4>
      ${d.pesos.map(p => `<div class="dica">• ${esc(p.identificacao)} · ${esc(p.valor_nominal || '')} kg · ${esc(p.classe)}
        · cert. ${esc(p.num_certificado || '—')} · válido até ${p.validade ? new Date(p.validade).toLocaleDateString('pt-BR') : '—'}</div>`).join('')}
      ${podeAprovar() ? `
        <div class="rodape-acoes" style="margin-top:16px;flex-wrap:wrap;gap:8px">
          <button class="btn-mini" onclick="editarAguardando('${c.id}')">✏️ Editar ensaio</button>
          <button class="btn-mini" onclick="edicaoManual('${c.id}')">🔧 Edição manual</button>
          <button class="btn-mini" style="color:#b02a37" onclick="abrirCancelarCert('${c.id}','${esc(c.numero || '')}')">🚫 Cancelar</button>
          <span style="flex:1"></span>
          <button class="btn-vinho-full" onclick="reprovarCert('${c.id}')">↩ Devolver p/ correção</button>
          <button class="btn-primario" onclick="abrirPreviaAprovacao()">✔ Aprovar e emitir</button>
        </div>`
        : '<p class="dica" style="margin-top:14px">Somente o responsável técnico ou administrador pode aprovar.</p>'}
      <p id="rev-erro" class="erro"></p>
    </div>`;
  document.querySelectorAll('.tela').forEach(t => t.classList.add('oculta'));
  $('#tela-painel').classList.remove('oculta');
  $('#lista-certs').innerHTML = html;
  window.scrollTo(0, 0);
}

// ── Edição manual do certificado (admin/RT, modo override) ──
async function edicaoManual(id) {
  // Certificado RBC: a edicao manual abre a COLETA RBC no modo resumo
  // (todas as tabelas dos 3 ensaios editaveis). Ao salvar, o motor
  // RECALCULA a incerteza - a cadeia de calculo continua rastreavel
  // (nao ha override direto de U, que quebraria a memoria de calculo).
  try {
    const ctRbc = await api('/certificados/' + id);
    if (ctRbc.emitir_rbc) {
      certId = id;
      plano = await api('/balancas/' + ctRbc.balanca_id + '/plano-ensaio');
      window._clienteEnsaio = ctRbc.cliente_id;
      window._ensaioRbc = true;
      window._rbcAbrirNoResumo = true;
      await montarTelaEnsaioRbc();
      toast('Edição da coleta RBC — corrija as leituras e use "Salvar e calcular" (a incerteza é recalculada).', 'info', 7000);
      return;
    }
  } catch (e) { /* segue para o fluxo padrao */ }

  let d;
  try { d = await api('/certificados/' + id + '/edicao-manual'); }
  catch (e) { toast(e.message, 'erro'); return; }
  const c = d.certificado;
  const num = c.numero || 'rascunho';

  const linhaInd = (p, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><input type="number" step="any" class="em-inp" data-tab="indicacao" data-id="${p.id}" data-campo="carga_aplicada" value="${p.carga_aplicada ?? ''}"></td>
      <td><input type="number" step="any" class="em-inp" data-tab="indicacao" data-id="${p.id}" data-campo="indicacao" value="${p.indicacao ?? ''}"></td>
      <td><input type="number" step="any" class="em-inp em-override" data-tab="indicacao" data-id="${p.id}" data-campo="erro" value="${p.erro ?? ''}"></td>
      <td><input type="number" step="any" class="em-inp em-override" data-tab="indicacao" data-id="${p.id}" data-campo="incerteza" value="${p.incerteza ?? ''}"></td>
    </tr>`;

  const linhaExc = x => `
    <tr>
      <td>${esc(x.posicao)}</td>
      <td><input type="number" step="any" class="em-inp" data-tab="excentricidade" data-id="${x.id}" data-campo="carga" value="${x.carga ?? ''}"></td>
      <td><input type="number" step="any" class="em-inp" data-tab="excentricidade" data-id="${x.id}" data-campo="indicacao" value="${x.indicacao ?? ''}"></td>
      <td><input type="number" step="any" class="em-inp em-override" data-tab="excentricidade" data-id="${x.id}" data-campo="erro" value="${x.erro ?? ''}"></td>
    </tr>`;

  const linhaRep = r => `
    <tr>
      <td>${r.medicao_num}</td>
      <td><input type="number" step="any" class="em-inp" data-tab="repetibilidade" data-id="${r.id}" data-campo="carga" value="${r.carga ?? ''}"></td>
      <td><input type="number" step="any" class="em-inp" data-tab="repetibilidade" data-id="${r.id}" data-campo="indicacao" value="${r.indicacao ?? ''}"></td>
    </tr>`;

  const html = `
    <div class="barra">
      <h2>🔧 Edição manual — ${esc(num)}</h2>
      <div class="barra-btns"><button onclick="verCert('${id}')">← Voltar</button></div>
    </div>
    <div class="card" style="border-left:4px solid #b8860b">
      <p style="margin:0"><b>⚠️ Modo de edição manual.</b> Você pode ajustar qualquer valor,
      inclusive erro e incerteza (campos em <span style="color:#b8860b">âmbar</span> são valores
      normalmente calculados). Use apenas para corrigir casos específicos — toda edição é registrada.</p>
    </div>
    <div class="card">
      <p class="dica">${esc(c.cliente)} · ${esc(c.balanca)}${c.num_serie ? ' · série ' + esc(c.num_serie) : ''}</p>
      <div class="form-grid">
        <label>Data da calibração<input type="date" id="em-dcal" value="${c.data_calibracao ? String(c.data_calibracao).substring(0,10) : ''}"></label>
        <label>Temperatura (°C)<input type="number" step="any" id="em-temp" value="${c.temperatura ?? ''}"></label>
        <label>Umidade (%)<input type="number" step="any" id="em-umid" value="${c.umidade ?? ''}"></label>
        <label>Pressão atm. (hPa)<input type="number" step="any" id="em-pressao" value="${c.pressao ?? ''}"></label>
        <label>Fator k (incerteza)<input type="number" step="any" id="em-ik" value="${c.incerteza_k ?? ''}"></label>
      </div>
      <label style="display:block;margin-top:10px">Observações (sai no certificado)
        <textarea id="em-obs" rows="3">${esc(c.observacao || '')}</textarea></label>
    </div>

    <div class="card">
      <h4>Indicação</h4>
      <table><thead><tr><th>#</th><th>Carga</th><th>Indicação</th><th class="em-th-ovr">Erro</th><th class="em-th-ovr">Incerteza</th></tr></thead>
        <tbody>${d.indicacao.map(linhaInd).join('')}</tbody></table>

      ${d.excentricidade.length ? `<h4 style="margin-top:14px">Excentricidade</h4>
      <table><thead><tr><th>Posição</th><th>Carga</th><th>Indicação</th><th class="em-th-ovr">Erro</th></tr></thead>
        <tbody>${d.excentricidade.map(linhaExc).join('')}</tbody></table>` : ''}

      ${d.repetibilidade.length ? `<h4 style="margin-top:14px">Repetibilidade</h4>
      <table><thead><tr><th>Medição</th><th>Carga</th><th>Indicação</th></tr></thead>
        <tbody>${d.repetibilidade.map(linhaRep).join('')}</tbody></table>` : ''}

      ${d.sensibilidade ? `<h4 style="margin-top:14px">Sensibilidade</h4>
      <div class="form-grid">
        <label>Carga referência<input type="number" step="any" class="em-inp" data-tab="sensibilidade" data-id="${d.sensibilidade.id}" data-campo="carga_referencia" value="${d.sensibilidade.carga_referencia ?? ''}"></label>
        <label>Adição<input type="number" step="any" class="em-inp" data-tab="sensibilidade" data-id="${d.sensibilidade.id}" data-campo="adicao" value="${d.sensibilidade.adicao ?? ''}"></label>
        <label>Resultado display<input type="number" step="any" class="em-inp" data-tab="sensibilidade" data-id="${d.sensibilidade.id}" data-campo="resultado_display" value="${d.sensibilidade.resultado_display ?? ''}"></label>
      </div>` : ''}
    </div>

    <div class="card">
      <div class="rodape-acoes">
        <button onclick="verCert('${id}')">Cancelar</button>
        <span style="flex:1"></span>
        <button class="btn-primario" onclick="salvarEdicaoManual('${id}', ${c.status === 'emitido'})">💾 Salvar alterações</button>
      </div>
      <p id="em-erro" class="erro"></p>
    </div>`;

  document.querySelectorAll('.tela').forEach(t => t.classList.add('oculta'));
  $('#tela-painel').classList.remove('oculta');
  $('#lista-certs').innerHTML = html;
  window.scrollTo(0, 0);
}

// Volta da edicao manual para a tela adequada ao status do certificado.
// (esta funcao faltava - o botao "Voltar" nao fazia nada)
async function verCert(id) {
  try {
    const ct = await api('/certificados/' + id);
    if (ct.status === 'aguardando_aprovacao') { abrirRevisao(id); return; }
    if (ct.status === 'rascunho') { abrirCert(id, 'rascunho'); return; }
    if (ct.status === 'emitido') { irPainel(); menuEmitido(id); return; }
    irPainel();
  } catch (e) { irPainel(); }
}

async function salvarEdicaoManual(id, eraEmitido) {
  // coleta os campos gerais
  const corpo = {
    dataCalibracao: $('#em-dcal').value || null,
    temperatura: numOuNull($('#em-temp').value),
    umidade: numOuNull($('#em-umid').value),
    pressao: numOuNull($('#em-pressao').value),
    incertezaK: numOuNull($('#em-ik').value),
    observacao: $('#em-obs').value || null,
    indicacao: [], excentricidade: [], repetibilidade: [], sensibilidade: null
  };
  // agrupa os inputs por tabela/id
  const mapa = {};
  document.querySelectorAll('.em-inp').forEach(inp => {
    const tab = inp.dataset.tab, rid = inp.dataset.id, campo = inp.dataset.campo;
    if (tab === 'sensibilidade') {
      corpo.sensibilidade = corpo.sensibilidade || { id: rid };
      corpo.sensibilidade[campo] = numOuNull(inp.value);
      return;
    }
    const chave = tab + ':' + rid;
    mapa[chave] = mapa[chave] || { tab, id: rid };
    mapa[chave][campo] = numOuNull(inp.value);
  });
  Object.values(mapa).forEach(o => {
    const { tab, ...resto } = o;
    corpo[tab].push(resto);
  });

  if (!await modalConfirmar('Confirma salvar a edição manual? Os valores serão gravados exatamente como digitados.')) return;
  try {
    const r = await api('/certificados/' + id + '/edicao-manual', {
      method: 'PUT', body: JSON.stringify(corpo) });
    toast(r.mensagem || 'Alterações salvas.', 'ok', 6000);
    verCert(id);
  } catch (e) { $('#em-erro').textContent = e.message; }
}

function numOuNull(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

async function aprovarCert(id) {
  // Reúne não-conformidades (indicação + sensibilidade) para confirmação consciente
  const reprovados = window._revNaoConformes || [];
  const sensNC = window._revSensNaoConforme;
  if (reprovados.length || sensNC) {
    let msg = 'Este certificado tem não-conformidade(s):\n\n';
    if (reprovados.length)
      msg += `Indicação (erro acima do EMA):\n${reprovados.join('\n')}\n\n`;
    if (sensNC)
      msg += `Sensibilidade: ${sensNC}\n\n`;
    msg += 'Ao aprovar, o certificado será EMITIDO registrando essa(s) ' +
           'não-conformidade(s). Esta ação é definitiva.\n\nConfirma a aprovação e emissão?';
    const ok = await modalConfirmar(
      '⚠️ Certificado com não-conformidade',
      msg,
      { textoSim: 'Aprovar e emitir', textoNao: 'Voltar', perigoso: true });
    if (!ok) return;
  }
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
  ['venc', 'emit', 'prod', 'cli', 'clibal', 'inativos', 'emails', 'nps'].forEach(t =>
    $('#tab-' + t)?.classList.toggle('ativa', qual === t));
  relDados = [];
  if (qual === 'venc') renderFiltrosVenc();
  else if (qual === 'emit') renderFiltrosEmit();
  else if (qual === 'prod') renderFiltrosProd();
  else if (qual === 'cli') renderRelClientes();
  else if (qual === 'clibal') renderRelClientesBalancas();
  else if (qual === 'inativos') renderRelInativos();
  else if (qual === 'emails') renderRelEmails();
  else if (qual === 'nps') renderDashboardNps();
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

// ── E-mails enviados ──
// ── Dashboard de satisfação (NPS) ──
async function renderDashboardNps() {
  $('#rel-conteudo').innerHTML = '<div class="card"><p class="dica">Carregando…</p></div>';
  let d;
  try { d = await api('/pesquisa/dashboard'); }
  catch (e) { $('#rel-conteudo').innerHTML = `<div class="card"><p class="erro">${e.message}</p></div>`; return; }

  const r = d.resumo || {};
  const npsVal = r.nps != null ? r.nps : null;
  const npsCor = npsVal == null ? '#888' : npsVal >= 50 ? '#1a7f4b' : npsVal >= 0 ? '#c88a00' : '#c0392b';
  const npsRotulo = npsVal == null ? 'Sem dados' : npsVal >= 75 ? 'Excelente' : npsVal >= 50 ? 'Muito bom' : npsVal >= 0 ? 'Razoável' : 'Crítico';

  const dimensoes = (d.dimensoes || []).map(x => `
    <tr><td>${esc(x.pergunta)}</td>
        <td>${x.tipo === 'nps' ? '⭐ NPS' : 'Dimensão'}</td>
        <td class="num">${x.respostas || 0}</td>
        <td class="num"><b>${x.media != null ? x.media : '—'}</b></td></tr>`).join('');

  $('#rel-conteudo').innerHTML = `
    <div class="cartoes-resumo">
      <div class="cartao"><span class="num" style="color:${npsCor}">${npsVal != null ? npsVal : '—'}</span><span>NPS · ${npsRotulo}</span></div>
      <div class="cartao"><span class="num">${r.respostas || 0}</span><span>Respostas</span></div>
      <div class="cartao"><span class="num">${r.taxa_resposta != null ? r.taxa_resposta + '%' : '—'}</span><span>Taxa de resposta</span></div>
    </div>

    <div class="card">
      <h3>Distribuição</h3>
      <div class="nps-barras">
        <div class="nps-b promotor" style="flex:${r.promotores || 0}">${r.promotores || 0} promotores</div>
        <div class="nps-b neutro" style="flex:${r.neutros || 0}">${r.neutros || 0} neutros</div>
        <div class="nps-b detrator" style="flex:${r.detratores || 0}">${r.detratores || 0} detratores</div>
      </div>
      <p class="dica" style="margin-top:8px">Promotores (9-10) · Neutros (7-8) · Detratores (0-6). NPS = %promotores − %detratores.</p>
    </div>

    <div class="card">
      <h3>Evolução do NPS</h3>
      <div id="nps-grafico">${graficoNpsSvg(d.evolucao || [])}</div>
    </div>

    <div class="card">
      <div class="barra">
        <h3>Média por dimensão</h3>
        <div class="barra-btns">
          <button class="btn-mini" onclick="baixarComToken('/api/pesquisa/respostas?formato=csv')">⬇️ CSV</button>
          <button class="btn-mini" onclick="baixarComToken('/api/pesquisa/respostas?formato=pdf')">📄 PDF</button>
        </div>
      </div>
      <table><thead><tr><th>Pergunta</th><th>Tipo</th><th>Respostas</th><th>Média</th></tr></thead>
        <tbody>${dimensoes || '<tr><td colspan="4" class="dica">Sem respostas ainda.</td></tr>'}</tbody></table>
    </div>`;
}

function graficoNpsSvg(evolucao) {
  if (!evolucao.length) return '<p class="dica">Ainda não há respostas suficientes para o gráfico.</p>';
  const W = 640, H = 220, pad = 36;
  const xs = (i) => pad + (evolucao.length === 1 ? (W - 2 * pad) / 2 : i * (W - 2 * pad) / (evolucao.length - 1));
  const ys = (v) => H - pad - ((v + 100) / 200) * (H - 2 * pad); // NPS vai de -100 a 100
  const linha0 = ys(0);
  const pts = evolucao.map((e, i) => `${xs(i)},${ys(e.nps || 0)}`).join(' ');
  const bolinhas = evolucao.map((e, i) =>
    `<circle cx="${xs(i)}" cy="${ys(e.nps || 0)}" r="4" fill="#1e3a5f"></circle>
     <text x="${xs(i)}" y="${ys(e.nps || 0) - 10}" text-anchor="middle" font-size="11" fill="#1e3a5f" font-weight="600">${e.nps}</text>`).join('');
  const rotulos = evolucao.map((e, i) =>
    `<text x="${xs(i)}" y="${H - 10}" text-anchor="middle" font-size="10" fill="#888">${e.mes.slice(5)}/${e.mes.slice(2,4)}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">
    <line x1="${pad}" y1="${linha0}" x2="${W-pad}" y2="${linha0}" stroke="#ddd" stroke-dasharray="4"></line>
    <text x="${pad-6}" y="${linha0+3}" text-anchor="end" font-size="9" fill="#aaa">0</text>
    <text x="${pad-6}" y="${ys(100)+3}" text-anchor="end" font-size="9" fill="#aaa">100</text>
    <text x="${pad-6}" y="${ys(-100)+3}" text-anchor="end" font-size="9" fill="#aaa">-100</text>
    <polyline points="${pts}" fill="none" stroke="#1e3a5f" stroke-width="2"></polyline>
    ${bolinhas}${rotulos}
  </svg>`;
}

async function renderRelEmails() {
  const clientes = await api('/clientes').catch(() => []);
  const opcCli = '<option value="">Todos os clientes</option>' +
    clientes.map(c => `<option value="${c.id}">${esc(c.razao_social)}</option>`).join('');
  $('#rel-conteudo').innerHTML = `
    <div class="card">
      <h3>E-mails enviados</h3>
      <p class="dica">Acompanhe os e-mails enviados pelo sistema — avisos de vencimento,
        certificados, convites e outros — por período e por cliente.</p>
      <div class="form-grid">
        <label>De <input type="date" id="re-de"></label>
        <label>Até <input type="date" id="re-ate"></label>
        <label>Cliente <select id="re-cliente">${opcCli}</select></label>
        <label>Tipo
          <select id="re-motivo">
            <option value="">Todos</option>
            <option value="aviso_vencimento">Aviso de vencimento</option>
            <option value="certificado">Certificado</option>
            <option value="convite">Convite de usuário</option>
            <option value="confirmacao_portal">Confirmação de portal</option>
            <option value="chamado">Chamado</option>
            <option value="contrato_vencendo">Contrato vencendo</option>
          </select>
        </label>
        <label>Status
          <select id="re-status">
            <option value="">Todos</option>
            <option value="enviado">Enviados</option>
            <option value="erro">Com erro</option>
          </select>
        </label>
      </div>
      <button class="btn-primario btn-mini" onclick="gerarRelEmails()">Gerar relatório</button>
    </div>
    <div id="rel-resultado"></div>`;
}
function filtrosEmailsQS() {
  const p = new URLSearchParams();
  const de = $('#re-de')?.value; if (de) p.set('de', de);
  const ate = $('#re-ate')?.value; if (ate) p.set('ate', ate);
  const cli = $('#re-cliente')?.value; if (cli) p.set('cliente', cli);
  const mot = $('#re-motivo')?.value; if (mot) p.set('motivo', mot);
  const st = $('#re-status')?.value; if (st) p.set('status', st);
  return p.toString();
}
async function gerarRelEmails() {
  const qs = filtrosEmailsQS();
  const resp = await api('/relatorios/emails' + (qs ? '?' + qs : ''));
  const r = resp.resumo || { total: 0, enviados: 0, erros: 0 };
  relDados = resp.itens || [];
  const cols = [
    { k: 'enviado_em', t: 'Data/hora', fmt: 'dthr' },
    { k: 'destinatario', t: 'Destinatário' },
    { k: 'cliente', t: 'Cliente' },
    { k: 'assunto', t: 'Assunto' },
    { k: 'motivo', t: 'Tipo', fmt: 'motivo' },
    { k: 'status', t: 'Status', fmt: 'statusEmail' }];
  const cartoes = `
    <div class="cartoes-resumo">
      <div class="cartao"><span class="num">${r.total}</span><span>Total</span></div>
      <div class="cartao ok"><span class="num">${r.enviados}</span><span>Enviados</span></div>
      <div class="cartao ${r.erros > 0 ? 'rep' : ''}"><span class="num">${r.erros}</span><span>Erros</span></div>
    </div>`;
  mostrarResultadoRelServer('E-mails enviados', cols, relDados,
    '/relatorios/emails' + (qs ? '?' + qs : ''), cartoes);
}

// ── Clientes (todos) ──
async function renderRelClientes() {
  $('#rel-conteudo').innerHTML = `
    <div class="card">
      <h3>Todos os clientes</h3>
      <p class="dica">Lista completa com resumo de balanças, certificados e datas de calibração.</p>
      <div class="form-grid">
        <label>Ordenar por
          <select id="rc-ordem">
            <option value="nome">Nome (A-Z)</option>
            <option value="ultimo">Último certificado</option>
            <option value="cidade">Cidade / Estado</option>
            <option value="tipo">Tipo de balança</option>
          </select>
        </label>
      </div>
      <button class="btn-primario btn-mini" onclick="gerarRelClientes()">Gerar relatório</button>
    </div>
    <div id="rel-resultado"></div>`;
}
async function gerarRelClientes() {
  const ordem = $('#rc-ordem').value;
  relDados = await api('/relatorios/clientes?ordem=' + ordem);
  const cols = [
    { k: 'razao_social', t: 'Cliente' }, { k: 'cnpj', t: 'CNPJ' },
    { k: 'telefone', t: 'Telefone' }, { k: 'cidade', t: 'Cidade' }, { k: 'uf', t: 'UF' },
    { k: 'tipos_balanca', t: 'Tipos' },
    { k: 'qtd_balancas', t: 'Balanças' }, { k: 'qtd_certificados', t: 'Certif.' },
    { k: 'ultima_calibracao', t: 'Última calib.', fmt: 'data' },
    { k: 'proxima_calibracao', t: 'Próxima calib.', fmt: 'data' }];
  mostrarResultadoRelServer('Todos os clientes', cols, relDados,
    '/relatorios/clientes?ordem=' + ordem);
}

// ── Clientes x balanças ──
async function renderRelClientesBalancas() {
  const clientes = await api('/clientes').catch(() => []);
  const opcCli = '<option value="">Todos os clientes</option>' +
    clientes.map(c => `<option value="${c.id}">${esc(c.razao_social)}</option>`).join('');
  $('#rel-conteudo').innerHTML = `
    <div class="card">
      <h3>Clientes × balanças</h3>
      <p class="dica">Uma linha por balança, com a situação da calibração.</p>
      <div class="form-grid">
        <label>Cliente <select id="rcb-cliente">${opcCli}</select></label>
        <label>Tipo de balança
          <select id="rcb-tipo">
            <option value="">Todos</option>
            <option value="rodoviaria">Rodoviária</option>
            <option value="plataforma">Plataforma</option>
            <option value="bancada">Bancada</option>
            <option value="suspensa">Suspensa</option>
            <option value="ferroviaria">Ferroviária</option>
            <option value="outra">Outra</option>
          </select>
        </label>
        <label>Situação
          <select id="rcb-situacao">
            <option value="">Todas</option>
            <option value="Em dia">Em dia</option>
            <option value="Vence em breve">Vence em breve</option>
            <option value="Vencida">Vencida</option>
            <option value="Sem calibração">Sem calibração</option>
          </select>
        </label>
        <label>Última calib. de <input type="date" id="rcb-de"></label>
        <label>Última calib. até <input type="date" id="rcb-ate"></label>
      </div>
      <button class="btn-primario btn-mini" onclick="gerarRelClientesBalancas()">Gerar relatório</button>
    </div>
    <div id="rel-resultado"></div>`;
}
function filtrosClientesBalancasQS() {
  const p = new URLSearchParams();
  const cli = $('#rcb-cliente')?.value; if (cli) p.set('cliente', cli);
  const tipo = $('#rcb-tipo')?.value; if (tipo) p.set('tipo', tipo);
  const sit = $('#rcb-situacao')?.value; if (sit) p.set('situacao', sit);
  const de = $('#rcb-de')?.value; if (de) p.set('de', de);
  const ate = $('#rcb-ate')?.value; if (ate) p.set('ate', ate);
  return p.toString();
}
async function gerarRelClientesBalancas() {
  const qs = filtrosClientesBalancasQS();
  relDados = await api('/relatorios/clientes-balancas' + (qs ? '?' + qs : ''));
  const cols = [
    { k: 'cliente', t: 'Cliente' }, { k: 'telefone', t: 'Telefone' },
    { k: 'balanca', t: 'Balança' }, { k: 'tipo', t: 'Tipo' }, { k: 'marca', t: 'Marca' },
    { k: 'capacidade', t: 'Cap.' }, { k: 'classe', t: 'Classe' },
    { k: 'ultima_calibracao', t: 'Última calib.', fmt: 'data' },
    { k: 'proxima_calibracao', t: 'Próxima calib.', fmt: 'data' },
    { k: 'situacao', t: 'Situação', fmt: 'situacao' }];
  mostrarResultadoRelServer('Clientes × balanças', cols, relDados,
    '/relatorios/clientes-balancas' + (qs ? '?' + qs : ''));
}

// ── Clientes sem calibração (inativos) ──
async function renderRelInativos() {
  $('#rel-conteudo').innerHTML = `
    <div class="card">
      <h3>Clientes sem calibração no período</h3>
      <p class="dica">Clientes que não calibram conosco há um tempo — para ligar e reconquistar.</p>
      <div class="form-grid">
        <label>Sem calibrar há mais de
          <select id="ri-meses">
            <option value="3">3 meses</option>
            <option value="6" selected>6 meses</option>
            <option value="12">12 meses</option>
            <option value="18">18 meses</option>
            <option value="24">24 meses</option>
          </select>
        </label>
      </div>
      <button class="btn-primario btn-mini" onclick="gerarRelInativos()">Gerar relatório</button>
    </div>
    <div id="rel-resultado"></div>`;
}
async function gerarRelInativos() {
  const meses = $('#ri-meses').value;
  relDados = await api('/relatorios/clientes-inativos?meses=' + meses);
  const cols = [
    { k: 'razao_social', t: 'Cliente' }, { k: 'telefone', t: 'Telefone' },
    { k: 'email', t: 'E-mail' }, { k: 'cidade', t: 'Cidade' }, { k: 'uf', t: 'UF' },
    { k: 'qtd_balancas', t: 'Balanças' },
    { k: 'ultima_calibracao', t: 'Última calib.', fmt: 'data' },
    { k: 'meses_desde_ultima', t: 'Meses sem calibrar', fmt: 'meses' }];
  mostrarResultadoRelServer('Clientes sem calibração há +' + meses + ' meses', cols, relDados,
    '/relatorios/clientes-inativos?meses=' + meses);
}

// Renderiza a tabela e oferece exportação CSV + PDF (server-side)
function mostrarResultadoRelServer(titulo, cols, linhas, urlBase, cartoes) {
  if (!linhas || linhas.length === 0) {
    $('#rel-resultado').innerHTML = (cartoes || '') +
      '<div class="card"><p class="dica">Nenhum registro encontrado.</p></div>';
    return;
  }
  const sep = urlBase.includes('?') ? '&' : '?';
  const fmtCel = (v, fmt) => {
    if (v == null || v === '') return fmt === 'meses' ? 'nunca calibrou' : '—';
    if (fmt === 'data') return dbrSA(v);
    if (fmt === 'dthr') return dthr(v);
    if (fmt === 'situacao') return badgeSituacao(v);
    if (fmt === 'motivo') return esc(MOTIVO_EMAIL[v] || v);
    if (fmt === 'statusEmail') return v === 'erro'
      ? '<span class="badge rep">Erro</span>' : '<span class="badge ok">Enviado</span>';
    if (fmt === 'meses') return v + ' meses';
    return esc(String(v));
  };
  const th = cols.map(c => `<th>${c.t}</th>`).join('');
  const tr = linhas.map(l => `<tr>${cols.map(c =>
    `<td>${fmtCel(l[c.k], c.fmt)}</td>`).join('')}</tr>`).join('');
  $('#rel-resultado').innerHTML = (cartoes || '') + `
    <div class="card">
      <div class="barra">
        <h3>${esc(titulo)} <span class="dica">(${linhas.length} registro${linhas.length === 1 ? '' : 's'})</span></h3>
        <div class="barra-btns">
          <button class="btn-mini" onclick="baixarComToken('/api${urlBase}${sep}formato=csv')">⬇️ CSV</button>
          <button class="btn-mini" onclick="baixarComToken('/api${urlBase}${sep}formato=pdf')">📄 PDF</button>
        </div>
      </div>
      <div class="tabela-scroll">
        <table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>
      </div>
    </div>`;
}

const MOTIVO_EMAIL = {
  certificado: 'Certificado', convite: 'Convite de usuário',
  confirmacao_portal: 'Confirmação de portal', chamado: 'Chamado',
  contrato_vencendo: 'Contrato vencendo', aviso_vencimento: 'Aviso de vencimento',
  aviso_vencimento_copia: 'Aviso de vencimento (cópia)', teste: 'Teste',
  portal_validacao: 'Validação de portal'
};

function badgeSituacao(s) {
  const m = {
    'Em dia': '<span class="badge ok">Em dia</span>',
    'Vence em breve': '<span class="badge aviso">Vence em breve</span>',
    'Vencida': '<span class="badge rep">Vencida</span>',
    'Sem calibração': '<span class="badge">Sem calibração</span>'
  };
  return m[s] || esc(s);
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
const cobStatus = s => ({
  pendente: '<span class="badge">Pendente</span>',
  pago: '<span class="badge ok">Pago</span>',
  vencido: '<span class="badge rep">Vencido</span>',
  cancelado: '<span class="badge">Cancelado</span>'
}[s] || s);

async function irSuperAdmin() {
  mostrar('tela-sa');
  await renderPainelSA();
  mostrarAvisosSA();
}

// Avisos ao logar: novos chamados, chamados abertos, erros
async function mostrarAvisosSA() {
  let a;
  try { a = await saApi('/avisos'); } catch { return; }
  const avisos = [];

  // Saúde do e-mail: erros de SMTP são o alerta mais importante (topo)
  let emailErro = false;
  try {
    const s = await saApi('/email-saude');
    if (s && Number(s.erros_24h) > 0) {
      emailErro = true;
      const det = s.ultimo_erro_detalhe ? ' — último: ' + String(s.ultimo_erro_detalhe).slice(0, 80) : '';
      avisos.push(`📧 PROBLEMA NO E-MAIL: ${s.erros_24h} falha(s) de envio nas últimas 24h${det}`);
    }
  } catch { /* silencioso */ }

  if (a.chamadosNovos > 0)
    avisos.push(`🆕 ${a.chamadosNovos} novo(s) chamado(s) nas últimas 24h`);
  if (a.chamadosAbertos > 0)
    avisos.push(`🎧 ${a.chamadosAbertos} chamado(s) em aberto`);
  if (a.errosNovos > 0)
    avisos.push(`🐞 ${a.errosNovos} novo(s) erro(s) nas últimas 24h`);
  else if (a.errosAbertos > 0)
    avisos.push(`🐞 ${a.errosAbertos} erro(s) não resolvido(s)`);
  if (!avisos.length) return;

  const banner = document.createElement('div');
  banner.className = 'avisos-sa' + (emailErro ? ' avisos-sa-critico' : '');
  banner.innerHTML = `
    <div class="avisos-sa-cabe">
      <b>👋 Bem-vindo. Você tem pendências:</b>
      <button onclick="this.closest('.avisos-sa').remove()">✕</button>
    </div>
    <ul>${avisos.map(x => `<li>${x}</li>`).join('')}</ul>
    <div class="avisos-sa-acoes">
      ${emailErro ? '<button class="btn-mini" onclick="renderEmailLogSA();this.closest(\'.avisos-sa\').remove()">Ver log de e-mails</button>' : ''}
      ${a.chamadosAbertos > 0 ? '<button class="btn-mini" onclick="renderChamadosSA();this.closest(\'.avisos-sa\').remove()">Ver chamados</button>' : ''}
      ${a.errosAbertos > 0 ? '<button class="btn-mini" onclick="renderErrosSA();this.closest(\'.avisos-sa\').remove()">Ver erros</button>' : ''}
    </div>`;
  document.body.appendChild(banner);
}

// ═══════ FINANCEIRO GLOBAL DO SUPER ADMIN (João, 11/08/2026) ═══════
// Todos os lançamentos dos contratos, com validação de EMISSÃO (documento)
// e de PAGAMENTO (data, valor, forma, banco), filtros e exportação CSV.
let finFiltros = null;
function finSituacao(c) {
  if (c.status === 'cancelado') return ['CANCELADA', '#8ba0b5', '#f1f5f9'];
  if (c.status === 'pago') return ['PAGA', '#1e7d46', '#e7f5ec'];
  const hoje = new Date().toISOString().slice(0, 10);
  if (String(c.vencimento).slice(0, 10) < hoje) return ['VENCIDA', '#b02a37', '#fdecee'];
  if (c.emitida_em) return ['EMITIDA', '#164066', '#e7f0f8'];
  return ['PREVISTA', '#856404', '#fff3cd'];
}
async function renderFinanceiroGlobalSA() {
  if (!finFiltros) {
    const h = new Date();
    finFiltros = { de: new Date(h.getFullYear(), h.getMonth(), 1).toISOString().slice(0, 10),
      ate: new Date(h.getFullYear(), h.getMonth() + 1, 0).toISOString().slice(0, 10),
      porPagamento: false, empresaId: '', status: '', forma: '' };
  }
  const f = finFiltros;
  $('#sa-conteudo').innerHTML = '<p class="dica">Carregando o financeiro…</p>';
  let dados;
  try {
    const p = new URLSearchParams({ de: f.de, ate: f.ate });
    if (f.porPagamento) p.set('porPagamento', 'true');
    if (f.empresaId) p.set('empresaId', f.empresaId);
    dados = await saApi('/financeiro-global?' + p.toString());
  } catch (e) { $('#sa-conteudo').innerHTML = `<p class="erro">${e.message}</p>`; return; }
  window._finDados = dados;
  let cobr = dados.cobrancas || [];
  if (f.status) cobr = cobr.filter(c => finSituacao(c)[0] === f.status);
  if (f.forma) cobr = cobr.filter(c => (c.forma_pagamento || '') === f.forma);

  const soma = a => a.reduce((s, c) => s + Number(c.valor_pago ?? c.valor), 0);
  const fm = v => 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  const naoCanc = cobr.filter(c => c.status !== 'cancelado');
  const pagas = naoCanc.filter(c => c.status === 'pago');
  const vencidas = naoCanc.filter(c => finSituacao(c)[0] === 'VENCIDA');
  const abertas = naoCanc.filter(c => ['PREVISTA', 'EMITIDA'].includes(finSituacao(c)[0]));
  const formas = [...new Set((dados.cobrancas || []).map(c => c.forma_pagamento).filter(Boolean))];
  const bancos = [...new Set((dados.cobrancas || []).map(c => c.banco).filter(Boolean))];
  window._finBancos = bancos;

  const kpiF = (v, rot, cor) => `<div class="kpi"><span class="kpi-num" style="color:${cor}">${v}</span>
    <span class="kpi-rotulo">${rot}</span></div>`;
  const empOpts = (window._saEmpresas || []).map(e =>
    `<option value="${e.id}" ${f.empresaId === e.id ? 'selected' : ''}>${esc(e.razao_social)}</option>`).join('');

  $('#sa-conteudo').innerHTML = `
    <div class="barra"><h2>💰 Financeiro</h2>
      <div class="barra-btns">
        <button class="btn-mini" onclick="finExportarCsv()">⬇️ CSV</button>
        <button onclick="renderPainelSA()">← Empresas</button></div></div>

    <div style="background:${dados.gerarAuto ? '#e7f5ec' : '#fdf6e3'};
      border:1px solid ${dados.gerarAuto ? '#bfe3cd' : '#e6d9a8'};border-radius:10px;
      padding:9px 12px;margin-bottom:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <span style="font-size:18px">${dados.gerarAuto ? '🔁' : '⏸️'}</span>
      <span style="flex:1;font-size:13px;color:${dados.gerarAuto ? '#1e7d46' : '#8a6d1a'}">
        <b>Geração automática de cobranças: ${dados.gerarAuto ? 'LIGADA' : 'DESLIGADA'}</b> —
        ${dados.gerarAuto
          ? 'todo mês o sistema cria a cobrança da competência para cada contrato ativo com geração automática.'
          : 'nenhuma cobrança é criada sozinha; os lançamentos existentes seguem normalmente.'}</span>
      <button class="btn-mini" onclick="finAlternarAuto(${dados.gerarAuto ? 'false' : 'true'})">
        ${dados.gerarAuto ? 'Desligar' : 'Ligar'}</button>
    </div>

    <div class="kpis" style="margin-bottom:12px">
      ${kpiF(fm(soma(naoCanc)), 'Previsto no período', '#164066')}
      ${kpiF(fm(soma(pagas)), 'Recebido', '#1e7d46')}
      ${kpiF(fm(soma(abertas)), 'Em aberto', '#856404')}
      ${kpiF(fm(soma(vencidas)), 'Vencido ⚠️', '#b02a37')}
      ${kpiF(fm(dados.mrr || 0), 'MRR (contratos ativos)', '#5a7183')}
    </div>

    <div style="background:#f7f9fb;border:1px solid #e3e8ee;border-radius:10px;padding:8px 10px;margin-bottom:12px">
      <div class="barra-btns" style="flex-wrap:wrap;gap:6px;align-items:center">
        <span class="dica">📅</span>
        <select onchange="finFiltros.porPagamento = this.value === '1'; renderFinanceiroGlobalSA()"
          style="width:auto;padding:4px 6px;border:1px solid #dde5ec;border-radius:7px;font:inherit;font-size:.82rem">
          <option value="0" ${!f.porPagamento ? 'selected' : ''}>por vencimento</option>
          <option value="1" ${f.porPagamento ? 'selected' : ''}>por pagamento</option></select>
        <input type="date" value="${f.de}" onchange="if(this.value){finFiltros.de = this.value; renderFinanceiroGlobalSA()}"
          style="width:auto;max-width:145px;padding:4px 6px;border:1px solid #dde5ec;border-radius:7px;font:inherit;font-size:.82rem">
        <span class="dica">até</span>
        <input type="date" value="${f.ate}" onchange="if(this.value){finFiltros.ate = this.value; renderFinanceiroGlobalSA()}"
          style="width:auto;max-width:145px;padding:4px 6px;border:1px solid #dde5ec;border-radius:7px;font:inherit;font-size:.82rem">
        <select onchange="finFiltros.empresaId = this.value; renderFinanceiroGlobalSA()"
          style="width:auto;max-width:200px;padding:4px 6px;border:1px solid #dde5ec;border-radius:7px;font:inherit;font-size:.82rem">
          <option value="">🏢 todas as empresas</option>${empOpts}</select>
        <select onchange="finFiltros.status = this.value; renderFinanceiroGlobalSA()"
          style="width:auto;padding:4px 6px;border:1px solid #dde5ec;border-radius:7px;font:inherit;font-size:.82rem">
          <option value="">situação: todas</option>
          ${['PREVISTA','EMITIDA','PAGA','VENCIDA','CANCELADA'].map(st =>
            `<option ${f.status === st ? 'selected' : ''}>${st}</option>`).join('')}</select>
        ${formas.length ? `<select onchange="finFiltros.forma = this.value; renderFinanceiroGlobalSA()"
          style="width:auto;padding:4px 6px;border:1px solid #dde5ec;border-radius:7px;font:inherit;font-size:.82rem">
          <option value="">forma: todas</option>
          ${formas.map(fo => `<option ${f.forma === fo ? 'selected' : ''}>${esc(fo)}</option>`).join('')}</select>` : ''}
      </div>
    </div>

    <div class="card"><div class="tabela-scroll"><table>
      <thead><tr><th>Empresa</th><th>Plano</th><th>Compet.</th><th>Vencim.</th>
        <th class="num">Valor</th><th>Situação</th><th>Pagamento</th><th></th></tr></thead>
      <tbody>${cobr.length === 0 ? '<tr><td colspan="8" class="dica">Nenhum lançamento no período.</td></tr>'
        : cobr.map(c => {
          const [rot, cor, fundo] = finSituacao(c);
          const pag = c.status === 'pago'
            ? `${dbrSA(c.pago_em)}<br><span class="dica">${esc(c.forma_pagamento || '—')}${c.banco ? ' · ' + esc(c.banco) : ''}</span>`
            : c.emitida_em ? `<span class="dica">emitida ${dbrSA(c.emitida_em)}${c.documento ? '<br>doc ' + esc(c.documento) : ''}</span>` : '—';
          const acoes = c.status === 'pago' || c.status === 'cancelado' ? ''
            : `${!c.emitida_em ? `<button class="btn-mini" title="Validar emissão"
                 onclick="finEmitir('${c.id}')">✓ Emitir</button>` : ''}
               <button class="btn-mini" title="Confirmar pagamento"
                 onclick="finPagar('${c.id}')">💰 Pagar</button>`;
          return `<tr>
            <td><b>${esc(c.empresa)}</b></td>
            <td class="dica">${esc(c.plano || c.contrato_descricao || '—')}</td>
            <td>${String(c.competencia).slice(0, 7).split('-').reverse().join('/')}</td>
            <td>${dbrSA(c.vencimento)}</td>
            <td class="num"><b>${fm(c.valor_pago ?? c.valor)}</b></td>
            <td><span class="badge" style="background:${fundo};color:${cor}">${rot}</span></td>
            <td>${pag}</td>
            <td style="white-space:nowrap">${acoes}</td></tr>`;
        }).join('')}</tbody>
    </table></div></div>`;
}
// Interruptor geral da geração automática (João, 14/08/2026). Ao LIGAR,
// mostra quantos contratos ficariam elegíveis na próxima madrugada.
async function finAlternarAuto(ligar) {
  if (ligar) {
    const d = window._finDados || {};
    const n = d.contratosElegiveis ?? '?';
    const ok = await modalConfirmar('🔁 Ligar a geração automática',
      `A partir de agora, na virada de cada mês o sistema criará a cobrança da ` +
      `competência para cada contrato ativo com geração automática.\n\n` +
      `Contratos que se enquadram hoje: <b>${n}</b>.\n\n` +
      `Cobranças já existentes na competência não são duplicadas, e canceladas ` +
      `bloqueiam a recriação.`,
      { textoSim: 'Ligar', textoNao: 'Cancelar' });
    if (!ok) return;
  } else {
    const ok = await modalConfirmar('⏸️ Desligar a geração automática',
      'Nenhuma cobrança nova será criada pelo sistema até você ligar de novo. ' +
      'Os lançamentos existentes continuam com lembretes e alertas de atraso normalmente.',
      { textoSim: 'Desligar', textoNao: 'Cancelar' });
    if (!ok) return;
  }
  try {
    await saApi('/financeiro/gerar-auto', { method: 'PUT',
      body: JSON.stringify({ ativo: ligar }) });
    toast(ligar ? 'Geração automática LIGADA' : 'Geração automática DESLIGADA', 'ok', 5000);
    renderFinanceiroGlobalSA();
  } catch (e) { toast(e.message, 'erro'); }
}

function finEmitir(id) {
  const c = (window._finDados.cobrancas || []).find(x => x.id === id);
  document.getElementById('modal-fin')?.remove();
  const m = document.createElement('div');
  m.className = 'modal-fundo'; m.id = 'modal-fin';
  m.innerHTML = `<div class="modal-caixa" style="max-width:380px">
    <h3 style="margin-top:0">✓ Validar emissão</h3>
    <p class="dica">${esc(c.empresa)} · vencimento ${dbrSA(c.vencimento)} · R$ ${Number(c.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
    <label>Nº do documento / boleto (opcional)
      <input type="text" id="fin-doc" placeholder="ex.: boleto 41453289"></label>
    <div class="barra-btns" style="margin-top:12px;justify-content:flex-end">
      <button class="btn-mini" onclick="this.closest('.modal-fundo').remove()">Cancelar</button>
      <button class="btn-primario" onclick="finEmitirOk('${id}')">Confirmar emissão</button></div></div>`;
  document.body.appendChild(m);
}
async function finEmitirOk(id) {
  try {
    await saApi('/cobrancas/' + id + '/emitir', { method: 'PUT',
      body: JSON.stringify({ documento: $('#fin-doc').value || null }) });
    document.getElementById('modal-fin')?.remove();
    toast('Emissão registrada ✓', 'ok'); renderFinanceiroGlobalSA();
  } catch (e) { toast(e.message, 'erro'); }
}
function finPagar(id) {
  const c = (window._finDados.cobrancas || []).find(x => x.id === id);
  document.getElementById('modal-fin')?.remove();
  const m = document.createElement('div');
  m.className = 'modal-fundo'; m.id = 'modal-fin';
  m.innerHTML = `<div class="modal-caixa" style="max-width:400px">
    <h3 style="margin-top:0">💰 Confirmar pagamento</h3>
    <p class="dica">${esc(c.empresa)} · vencimento ${dbrSA(c.vencimento)}</p>
    <div class="form-grid">
      <label>Data do pagamento
        <input type="date" id="fin-data" value="${new Date().toISOString().slice(0, 10)}"></label>
      <label>Valor recebido (R$)
        <input type="number" step="0.01" id="fin-valor" value="${Number(c.valor).toFixed(2)}"></label>
    </div>
    <div class="form-grid">
      <label>Forma de pagamento
        <select id="fin-forma">
          ${['PIX','Boleto','Transferência','Cartão','Dinheiro'].map(fo => `<option>${fo}</option>`).join('')}
        </select></label>
      <label>Banco
        <input type="text" id="fin-banco" list="fin-bancos" placeholder="ex.: Inter PJ">
        <datalist id="fin-bancos">${(window._finBancos || []).map(b => `<option value="${esc(b)}">`).join('')}</datalist></label>
    </div>
    <div class="barra-btns" style="margin-top:12px;justify-content:flex-end">
      <button class="btn-mini" onclick="this.closest('.modal-fundo').remove()">Cancelar</button>
      <button class="btn-primario" onclick="finPagarOk('${id}')">Confirmar pagamento</button></div></div>`;
  document.body.appendChild(m);
}
async function finPagarOk(id) {
  try {
    await saApi('/cobrancas/' + id + '/pagar', { method: 'PUT', body: JSON.stringify({
      pagoEm: $('#fin-data').value, valorPago: Number($('#fin-valor').value),
      forma: $('#fin-forma').value, banco: $('#fin-banco').value || null }) });
    document.getElementById('modal-fin')?.remove();
    toast('Pagamento confirmado ✓', 'ok'); renderFinanceiroGlobalSA();
  } catch (e) { toast(e.message, 'erro'); }
}
function finExportarCsv() {
  const cobr = (window._finDados?.cobrancas || []);
  const linhas = [['Empresa','Plano','Competencia','Vencimento','Valor','Situacao','Pago em','Valor pago','Forma','Banco','Documento'].join(';')];
  for (const c of cobr)
    linhas.push([c.empresa, c.plano || c.contrato_descricao || '', String(c.competencia).slice(0, 10),
      String(c.vencimento).slice(0, 10), String(c.valor).replace('.', ','), finSituacao(c)[0],
      c.pago_em ? String(c.pago_em).slice(0, 10) : '', c.valor_pago != null ? String(c.valor_pago).replace('.', ',') : '',
      c.forma_pagamento || '', c.banco || '', c.documento || ''
    ].map(v => '"' + String(v).replace(/"/g, "'") + '"').join(';'));
  const blob = new Blob(['\ufeff' + linhas.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'financeiro-tscert.csv';
  a.click();
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
  window._saFiltro = window._saFiltro || 'ativa';   // padrão: só as ativas

  const kpi = (num, rot, cls = '') =>
    `<div class="kpi"><span class="kpi-num ${cls}">${num}</span><span class="kpi-rotulo">${rot}</span></div>`;
  window._saResumo = resumo;

  $('#sa-conteudo').innerHTML = `
    <div class="barra">
      <h2>Empresas</h2>
      <div class="barra-btns">
        <button onclick="renderFinanceiroGlobalSA()">💰 Financeiro</button>
        <button onclick="renderChamadosSA()">🎧 Chamados${chamados.abertos > 0
          ? ` <span style="background:#b02a37;color:#fff;border-radius:10px;padding:1px 7px;font-size:11px">${chamados.abertos}</span>` : ''}</button>
        <button onclick="renderErrosSA()">🐞 Erros${erros.abertos > 0
          ? ` <span style="background:#b02a37;color:#fff;border-radius:10px;padding:1px 7px;font-size:11px">${erros.abertos}</span>` : ''}</button>
        <button onclick="renderUsoDiaSA()">📅 Uso do dia</button>
        <button onclick="renderLoginsSA()">🔑 Logins</button>
        <button onclick="renderUsuariosLogSA()">👥 Usuários</button>
        <button onclick="renderPainelEmailSA()">📊 Painel de e-mails</button>
        <button onclick="renderSupressoesSA()">🔇 E-mails suspensos</button>
        <button onclick="renderEmailLogSA()">📧 E-mails</button>
        <button onclick="renderConsultaLogSA()">🔍 Consultas QR</button>
        <button onclick="renderSaudeSA()">📊 Saúde</button>
        <button onclick="renderMetricasSA()">📈 Servidor</button>
        <button onclick="renderPsaasSA()">⭐ Pesquisa TSCert</button>
        <button onclick="renderFinanceiroSA()">📈 Faturamento</button>
        <button onclick="renderMapaSA()">🗺️ Mapa</button>
        <button onclick="renderAtividadeSA()">📊 Atividade</button>
        <button onclick="renderTentativasLoginSA()">🔐 Tentativas de login</button>
        <button onclick="renderPortalSA()">🌐 Acessos do portal</button>
        <button onclick="renderClientesFinaisSA()">👁 Portal dos clientes</button>
        <button onclick="renderDiagPortalSA()">🩺 Diagnóstico do portal</button>
        <button onclick="abrirSmtpSA()">⚙️ Servidor de e-mail</button>
        <button class="btn-primario" onclick="formNovaEmpresa()">+ Nova empresa</button>
      </div>
    </div>
    <div class="cards-kpi" style="margin-bottom:16px">
      ${kpi(resumo.total_empresas, 'Empresas')}
      ${kpi(resumo.empresas_ativas, 'Ativas', 'kpi-ok')}
      ${kpi(resumo.empresas_suspensas, 'Suspensas', 'kpi-atencao')}
      ${kpi(resumo.total_certificados, 'Certificados')}
      ${kpi(resumo.rascunhos ?? 0, 'Rascunhos', 'kpi-aviso')}
      ${kpi(resumo.aguardando ?? 0, 'Aguardando aprovação', 'kpi-aviso')}
      ${kpi(resumo.certs_hoje ?? 0, '📄 Emitidos hoje', 'kpi-ok')}
      ${kpi(resumo.empresas_hoje ?? 0, '🏢 Empresas emitiram hoje', 'kpi-ok')}
      ${kpi(resumo.certs_7d ?? 0, '📈 Últimos 7 dias')}
      ${kpi(brl(resumo.receita_mes), 'Receita do mês', 'kpi-ok kpi-brl')}
      ${kpi(brl(resumo.receita_ano ?? 0), 'Receita no ano', 'kpi-ok kpi-brl')}
      ${kpi(brl(resumo.inadimplencia), 'A receber', 'kpi-atencao kpi-brl')}
    </div>
    ${alertaHtml}
    <div class="card">
      <div class="barra-btns" style="margin-bottom:10px;flex-wrap:wrap;align-items:center">
        <input type="search" id="sa-busca" placeholder="🔎 Nome, fantasia ou CNPJ…"
          style="flex:1;min-width:220px" oninput="filtrarEmpresasSA()">
        ${['todas', 'ativa', 'suspensa', 'cancelada'].map(f => `
          <button class="btn-mini" id="sa-f-${f}" onclick="window._saFiltro='${f}';filtrarEmpresasSA()">
            ${{ todas: 'Todas', ativa: '✅ Ativas', suspensa: '⛔ Suspensas', cancelada: '✖ Canceladas' }[f]}
          </button>`).join('')}
        <select id="sa-f-plano" onchange="filtrarEmpresasSA()"
          style="width:auto;padding:4px 6px;border:1px solid #dde5ec;border-radius:7px;font:inherit;font-size:.82rem">
          <option value="">Plano: todos</option>
          ${[...new Set((window._saEmpresas || []).map(e2 => e2.plano).filter(Boolean))].sort().map(pl =>
            `<option value="${esc(pl)}">${esc(pl)} (${(window._saEmpresas || []).filter(e2 => e2.plano === pl).length})</option>`).join('')}
        </select>
        <button class="btn-mini" id="sa-f-inad"
          onclick="window._saInad = !window._saInad; filtrarEmpresasSA()">💰 Inadimplentes</button>
        <button class="btn-mini" id="sa-f-venc"
          onclick="window._saVenc = !window._saVenc; filtrarEmpresasSA()">📅 Contrato vencendo</button>
      </div>
      <div id="sa-financeiro"></div>
      <div class="tabela-scroll">
        <table>
          <thead><tr><th>Empresa</th><th>Plano</th><th>Status</th>
            <th>Usuários</th><th>Certificados</th><th>Última emissão</th></tr></thead>
          <tbody id="sa-tbody"></tbody>
        </table>
      </div>
      <p id="sa-contagem" class="dica"></p>
    </div>`;
  filtrarEmpresasSA();
  carregarFinanceiroSA();
}

// KPIs financeiros do super-admin: MRR, mês corrente e inadimplência
async function carregarFinanceiroSA() {
  const alvo = document.getElementById('sa-financeiro');
  if (!alvo) return;
  let d; try { d = await saApi('/financeiro-resumo'); } catch (e) { return; }
  const r = d.resumo;
  const kpi = (rot, val, cor) => `<div style="flex:1;min-width:150px;background:#fff;border:1px solid #dde5ec;
      border-radius:10px;padding:10px 14px"><div class="dica">${rot}</div>
      <div style="font-size:1.25rem;font-weight:700;color:${cor || '#12263f'}">${val}</div></div>`;
  const atras = (d.atrasadas || []).map(a =>
    `<span style="white-space:nowrap">${esc(a.empresa)} · ${brl(a.valor)} · <b style="color:#b02a37">${a.dias_atraso}d</b></span>`
  ).join(' &nbsp;·&nbsp; ');
  alvo.innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px">
      ${kpi('MRR (receita recorrente)', brl(r.mrr))}
      ${kpi('Recebido no mês', brl(r.recebido_mes), '#146c43')}
      ${kpi('Pendente (total)', brl(r.pendente_total), '#c88a00')}
      ${kpi(`Vencidas (${r.vencidas_qtd})`, brl(r.vencidas_total), r.vencidas_qtd > 0 ? '#b02a37' : '#146c43')}
    </div>
    ${atras ? `<p class="dica" style="margin:0 0 10px">⏰ Em atraso: ${atras}</p>` : ''}`;
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
  const filtro = window._saFiltro || 'ativa';
  const fPlano = $('#sa-f-plano')?.value || '';
  const soInad = !!window._saInad;
  const soVenc = !!window._saVenc;
  const diasContrato = e2 => e2.contrato_fim
    ? Math.floor((new Date(e2.contrato_fim) - Date.now()) / 86400000) : null;
  const lista = (window._saEmpresas || []).filter(e => {
    const okStatus = filtro === 'todas' || e.status === filtro;
    const okPlano = !fPlano || e.plano === fPlano;
    const okInad = !soInad || Number(e.cobrancas_pendentes) > 0;
    const dCt = diasContrato(e);
    const okVenc = !soVenc || (dCt !== null && dCt <= 60);
    const okBusca = !termo
      || e.razao_social.toLowerCase().includes(termo)
      || (e.nome_fantasia || '').toLowerCase().includes(termo)
      || (termoNum && e.cnpj.replace(/\D/g, '').includes(termoNum));
    return okStatus && okPlano && okInad && okVenc && okBusca;
  });
  const bInad = $('#sa-f-inad');
  if (bInad) bInad.style.cssText = soInad ? 'background:#b02a37;color:#fff' : '';
  const bVenc = $('#sa-f-venc');
  if (bVenc) bVenc.style.cssText = soVenc ? 'background:#856404;color:#fff' : '';

  // realce do botão de filtro ativo
  ['todas', 'ativa', 'suspensa', 'cancelada'].forEach(f => {
    const b = $('#sa-f-' + f);
    if (b) b.style.cssText = f === filtro
      ? 'background:#0d3b2e;color:#fff' : '';
  });

  $('#sa-tbody').innerHTML = lista.map(e => `
    <tr onclick="abrirEmpresaSA('${e.id}')" style="cursor:pointer">
      <td><b>${esc(e.razao_social)}</b><br><span class="dica">${esc(e.cnpj)}${
        e.nome_fantasia ? ' · ' + esc(e.nome_fantasia) : ''}</span></td>
      <td>${esc(e.plano)}${(() => {
        if (e.tem_contrato) {
          const dCt2 = e.contrato_fim
            ? Math.floor((new Date(e.contrato_fim) - Date.now()) / 86400000) : null;
          if (dCt2 === null || dCt2 > 60) return '';
          return dCt2 >= 0
            ? `<br><span class="dica" style="color:#856404">📅 renova em ${dCt2}d</span>`
            : `<br><span class="dica" style="color:#b02a37">📅 contrato vencido há ${-dCt2}d</span>`;
        }
        if (e.status !== 'ativa') return '';
        const dias = 30 - Math.floor((Date.now() - new Date(e.criado_em)) / 86400000);
        return dias >= 0
          ? `<br><span class="dica" style="color:#856404">⏳ avaliação: ${dias}d</span>`
          : `<br><span class="dica" style="color:#b02a37">⏳ avaliação vencida há ${-dias}d</span>`;
      })()}</td>
      <td>${statusBadge(e.status)}</td>
      <td class="num">${e.qtd_usuarios}${e.limite_usuarios > 0 ? ' / ' + e.limite_usuarios : ''}</td>
      <td class="num">${e.qtd_certificados}</td>
      <td>${e.ultima_emissao ? new Date(e.ultima_emissao).toLocaleDateString('pt-BR') : '—'}${
        e.cobrancas_pendentes > 0
        ? ` <span class="venc-vencido" title="cobrança(s) pendente(s)">💰${e.cobrancas_pendentes}</span>` : ''}</td>
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
        <label>Anexar imagens (opcional)
          <input type="file" id="ch-imgs" accept="image/*" multiple>
          <span class="dica">Prints ou fotos ajudam a entender. Até 5 MB cada.</span></label>
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
    // envia as imagens anexadas (se houver)
    const imgs = $('#ch-imgs')?.files;
    if (imgs && imgs.length) {
      await enviarAnexosChamado(r.id, imgs);
    }
    document.querySelector('.modal-fundo')?.remove();
    toast(`Chamado #${String(r.numero).padStart(4, '0')} aberto. Responderemos em breve.`, 'ok');
    renderChamados();
  } catch (e) { $('#ch-erro').textContent = e.message; }
}

// Envia uma ou mais imagens para um chamado
async function enviarAnexosChamado(chamadoId, arquivos) {
  for (const arq of arquivos) {
    const fd = new FormData();
    fd.append('arquivo', arq);
    const r = await fetch('/api/chamados/' + chamadoId + '/anexos', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
      body: fd
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.erro || 'Falha ao enviar imagem.');
    }
  }
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
    <div class="card" id="ch-anexos-box"><p class="dica">Carregando anexos…</p></div>
    ${c.status !== 'fechado' ? `
    <div class="card">
      <label>Responder <textarea id="ch-resp" rows="3"></textarea></label>
      <label>Anexar imagens (opcional)
        <input type="file" id="ch-resp-imgs" accept="image/*" multiple></label>
      <button class="btn-primario btn-mini" onclick="responderChamado('${id}')">Enviar resposta</button>
      <p id="ch-resp-erro" class="erro"></p>
    </div>` : '<p class="dica">Chamado encerrado. Se precisar, abra um novo.</p>'}`;
  carregarAnexosChamado(id);
}

// Carrega e mostra as imagens anexadas ao chamado
async function carregarAnexosChamado(id) {
  const box = $('#ch-anexos-box');
  if (!box) return;
  let anexos;
  try { anexos = await api('/chamados/' + id + '/anexos'); }
  catch { box.remove(); return; }
  if (!anexos.length) { box.remove(); return; }
  box.innerHTML = `<h3 style="margin-bottom:10px">📎 Imagens anexadas</h3>
    <div class="anexos-galeria">
      ${anexos.map(a => `
        <a href="#" onclick="verAnexoChamado('${a.id}');return false" class="anexo-item" title="${esc(a.nome_arquivo)}">
          <img id="anx-${a.id}" alt="${esc(a.nome_arquivo)}">
          <span>${esc(a.nome_arquivo)}</span>
        </a>`).join('')}
    </div>`;
  // carrega as miniaturas autenticadas (blob)
  for (const a of anexos) {
    try {
      const r = await fetch('/api/chamados/anexos/' + a.id,
        { headers: { Authorization: 'Bearer ' + token } });
      if (r.ok) {
        const url = URL.createObjectURL(await r.blob());
        const img = document.getElementById('anx-' + a.id);
        if (img) img.src = url;
      }
    } catch {}
  }
}

// Abre a imagem em tamanho grande
async function verAnexoChamado(anexoId) {
  try {
    const r = await fetch('/api/chamados/anexos/' + anexoId,
      { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) throw new Error('Não foi possível abrir a imagem.');
    const url = URL.createObjectURL(await r.blob());
    const modal = `<div class="modal-fundo" onclick="this.remove()">
      <div style="max-width:90vw;max-height:90vh"><img src="${url}"
        style="max-width:90vw;max-height:90vh;border-radius:8px"></div></div>`;
    document.body.insertAdjacentHTML('beforeend', modal);
  } catch (e) { toast(e.message, 'erro'); }
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
    const imgs = $('#ch-resp-imgs')?.files;
    if (imgs && imgs.length) await enviarAnexosChamado(id, imgs);
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
    <div class="card" id="chsa-anexos-box"><p class="dica">Carregando anexos…</p></div>
    <div class="card">
      <label>Responder como suporte <textarea id="chsa-resp" rows="3"></textarea></label>
      <p class="dica">Ao responder, o chamado passa para "aguardando cliente" automaticamente.</p>
      <button class="btn-primario btn-mini" onclick="responderChamadoSA('${id}')">Enviar resposta</button>
      <p id="chsa-erro" class="erro"></p>
    </div>`;
  carregarAnexosChamadoSA(id);
}

// Anexos na visão do super-admin (usa os endpoints /sa)
async function carregarAnexosChamadoSA(id) {
  const box = $('#chsa-anexos-box');
  if (!box) return;
  let anexos;
  try { anexos = await saApi('/chamados/' + id + '/anexos'); }
  catch { box.remove(); return; }
  if (!anexos.length) { box.remove(); return; }
  box.innerHTML = `<h3 style="margin-bottom:10px">📎 Imagens anexadas</h3>
    <div class="anexos-galeria">
      ${anexos.map(a => `
        <a href="#" onclick="verAnexoChamadoSA('${a.id}');return false" class="anexo-item" title="${esc(a.nome_arquivo)}">
          <img id="anxsa-${a.id}" alt="${esc(a.nome_arquivo)}">
          <span>${esc(a.nome_arquivo)}</span>
        </a>`).join('')}
    </div>`;
  for (const a of anexos) {
    try {
      const r = await fetch('/api/sa/chamados/anexos/' + a.id,
        { headers: { Authorization: 'Bearer ' + token } });
      if (r.ok) {
        const url = URL.createObjectURL(await r.blob());
        const img = document.getElementById('anxsa-' + a.id);
        if (img) img.src = url;
      }
    } catch {}
  }
}

async function verAnexoChamadoSA(anexoId) {
  try {
    const r = await fetch('/api/sa/chamados/anexos/' + anexoId,
      { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) throw new Error('Não foi possível abrir a imagem.');
    const url = URL.createObjectURL(await r.blob());
    const modal = `<div class="modal-fundo" onclick="this.remove()">
      <div style="max-width:90vw;max-height:90vh"><img src="${url}"
        style="max-width:90vw;max-height:90vh;border-radius:8px"></div></div>`;
    document.body.insertAdjacentHTML('beforeend', modal);
  } catch (e) { toast(e.message, 'erro'); }
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

// ── Saúde do sistema (super-admin) ────────────────────────────
function fmtBytes(b) {
  if (!b) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return (b / Math.pow(1024, i)).toFixed(1) + ' ' + u[i];
}
function fmtUptime(s) {
  s = Number(s) || 0;
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}min`;
  if (h > 0) return `${h}h ${m}min`;
  if (m > 0) return `${m}min`;
  return `${Math.floor(s)}s`;
}

// Gráfico de rosca (donut) em SVG para uso de disco
function donutSVG(usadoPct, corUsado = '#1e3a5f') {
  const r = 52, c = 2 * Math.PI * r, off = c * (1 - usadoPct / 100);
  return `<svg viewBox="0 0 140 140" width="140" height="140">
    <circle cx="70" cy="70" r="${r}" fill="none" stroke="#e7edf2" stroke-width="16"/>
    <circle cx="70" cy="70" r="${r}" fill="none" stroke="${corUsado}" stroke-width="16"
      stroke-dasharray="${c}" stroke-dashoffset="${off}" stroke-linecap="round"
      transform="rotate(-90 70 70)"/>
    <text x="70" y="66" text-anchor="middle" font-size="24" font-weight="700" fill="#1f2a37">${usadoPct}%</text>
    <text x="70" y="86" text-anchor="middle" font-size="11" fill="#5b6b7d">usado</text>
  </svg>`;
}

// Gráfico de barras em SVG (série de meses)
function barrasSVG(serie) {
  if (!serie.length) return '<p class="dica">Sem dados.</p>';
  const max = Math.max(...serie.map(s => Number(s.total)), 1);
  const w = 620, h = 180, pad = 28, bw = (w - pad * 2) / serie.length;
  const barras = serie.map((s, i) => {
    const alt = (Number(s.total) / max) * (h - pad * 2);
    const x = pad + i * bw, y = h - pad - alt;
    const mesLabel = s.mes.slice(5); // MM
    return `
      <rect x="${x + bw * 0.15}" y="${y}" width="${bw * 0.7}" height="${alt}"
        rx="3" fill="#1e3a5f"><title>${s.mes}: ${s.total}</title></rect>
      <text x="${x + bw / 2}" y="${h - pad + 14}" text-anchor="middle" font-size="10" fill="#5b6b7d">${mesLabel}</text>
      ${Number(s.total) > 0 ? `<text x="${x + bw / 2}" y="${y - 4}" text-anchor="middle" font-size="10" fill="#1f2a37">${s.total}</text>` : ''}`;
  }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="max-width:${w}px">
    <line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="#d6dee7"/>
    ${barras}
  </svg>`;
}

async function renderSaudeSA() {
  $('#sa-conteudo').innerHTML = '<p class="dica">Carregando métricas…</p>';
  let s;
  try { s = await saApi('/saude'); }
  catch (e) { $('#sa-conteudo').innerHTML = `<p class="erro">${e.message}</p>`; return; }

  const b = s.banco, app = s.app, disco = s.disco;
  const discoPct = disco.total_bytes > 0
    ? Math.round((disco.usado_bytes / disco.total_bytes) * 100) : 0;
  const corLatencia = app.latencia_banco_ms < 50 ? '#17724a' : app.latencia_banco_ms < 200 ? '#b8860b' : '#b02a37';

  // busca quem está online
  let online = [];
  try { online = await saApi('/online?minutos=5'); } catch {}

  $('#sa-conteudo').innerHTML = `
    <div class="barra">
      <h2>📊 Saúde do sistema</h2>
      <div class="barra-btns">
        <button onclick="renderSaudeSA()">🔄 Atualizar</button>
        <button onclick="renderPainelSA()">← Empresas</button>
      </div>
    </div>

    <div class="saude-cards">
      <div class="saude-card" style="border-left:4px solid #17724a">
        <span class="saude-lbl">Online agora</span>
        <b class="saude-val" style="color:#17724a">${s.online || 0}</b>
        <span class="dica">ativos nos últimos 5 min · ${(s.usuariosHora || []).length} na última hora</span></div>
      <div class="saude-card"><span class="saude-lbl">Banco de dados</span>
        <b class="saude-val">${esc(b.banco_tamanho)}</b>
        <span class="dica">${b.conexoes_ativas} conexões ao banco</span></div>
      <div class="saude-card"><span class="saude-lbl">Memória da aplicação</span>
        <b class="saude-val">${fmtBytes(app.memoria_bytes)}</b>
        <span class="dica">GC: ${fmtBytes(app.memoria_gc_bytes)}</span></div>
      <div class="saude-card"><span class="saude-lbl">Tempo no ar</span>
        <b class="saude-val">${fmtUptime(app.uptime_segundos)}</b>
        <span class="dica">${app.processadores} CPUs · .NET ${esc(app.versao_dotnet.split('.').slice(0,2).join('.'))}</span></div>
      <div class="saude-card"><span class="saude-lbl">Latência do banco</span>
        <b class="saude-val" style="color:${corLatencia}">${app.latencia_banco_ms} ms</b>
        <span class="dica">tempo de resposta</span></div>
    </div>

    <div class="card">
      <h3>🟢 Quem está online (${online.length})</h3>
      ${online.length ? `
      <div class="tabela-scroll">
        <table>
          <thead><tr><th>Usuário</th><th>Papel</th><th>Empresa</th><th>Última atividade</th></tr></thead>
          <tbody>${online.map(o => `
            <tr>
              <td><b>${esc(o.nome)}</b><br><span class="dica">${esc(o.email)}</span></td>
              <td>${PAPEL_ROTULO[o.papel] || o.papel}</td>
              <td>${o.empresa ? esc(o.empresa) : '<span class="dica">—</span>'}</td>
              <td class="dica">${fmtAtras(o.segundos_atras)}</td>
            </tr>`).join('')}</tbody>
        </table>
      </div>` : '<p class="dica">Ninguém ativo nos últimos 5 minutos.</p>'}
    </div>

    <div class="saude-linha">
      <div class="card saude-disco">
        <h3>Espaço em disco</h3>
        ${donutSVG(discoPct, discoPct > 85 ? '#b02a37' : discoPct > 70 ? '#b8860b' : '#1e3a5f')}
        <div class="dica" style="text-align:center">
          ${fmtBytes(disco.usado_bytes)} de ${fmtBytes(disco.total_bytes)}<br>
          <b style="color:#17724a">${fmtBytes(disco.livre_bytes)} livres</b>
        </div>
        ${discoPct > 85 ? '<p class="erro" style="text-align:center;margin-top:8px">⚠️ Disco quase cheio</p>' : ''}
      </div>
      <div class="card" style="flex:1">
        <h3>Certificados emitidos (12 meses)</h3>
        ${barrasSVG(s.serie)}
      </div>
    </div>

    <div class="card">
      <h3>Contadores</h3>
      <div class="saude-contadores">
        <div><b>${b.total_empresas}</b><span>Empresas</span></div>
        <div><b>${b.empresas_ativas}</b><span>Ativas</span></div>
        <div><b>${b.total_usuarios}</b><span>Usuários</span></div>
        <div><b>${b.total_clientes}</b><span>Clientes</span></div>
        <div><b>${b.total_balancas}</b><span>Balanças</span></div>
        <div><b>${b.total_certificados}</b><span>Certificados</span></div>
        <div><b>${b.certificados_mes}</b><span>Este mês</span></div>
      </div>
    </div>
    <div class="card" style="margin-top:14px">
      <h3 style="margin-top:0">👥 Usuários ativos na última hora
        <span class="dica" style="font-weight:400">(${(s.usuariosHora || []).length})</span></h3>
      ${(s.usuariosHora || []).length === 0
        ? '<p class="dica">Ninguém acessou o sistema na última hora.</p>'
        : `<div class="tabela-scroll"><table>
            <thead><tr><th>Usuário</th><th>Empresa</th><th>Papel</th><th>Último acesso</th></tr></thead>
            <tbody>${s.usuariosHora.map(u => `<tr>
              <td><b>${esc(u.nome)}</b><br><span class="dica">${esc(u.email || '')}</span></td>
              <td>${esc(u.empresa || '—')}</td>
              <td class="dica">${esc(u.papel || '')}</td>
              <td class="dica">${dthr(u.ultimo_acesso)}</td></tr>`).join('')}
            </tbody></table></div>`}
    </div>`;
}

// Formata "há quanto tempo" a partir de segundos
function fmtAtras(seg) {
  if (seg < 60) return 'agora mesmo';
  const m = Math.floor(seg / 60);
  return `há ${m} min`;
}

// ── Log de logins (super-admin) ───────────────────────────────
const LOGIN_ACAO = {
  login_ok: '<span class="badge ok">Sucesso</span>',
  login_falha: '<span class="badge rep">Falha</span>',
  login_bloqueado: '<span class="badge" style="background:#fff3cd;color:#856404">Bloqueado</span>'
};
const PAPEL_ROTULO = {
  super_admin: 'Super-admin', admin: 'Administrador',
  responsavel_tecnico: 'Resp. Técnico', tecnico: 'Técnico'
};

let _saEmpresasFiltro = null;

// ── Uso do dia ────────────────────────────────────────────────
// Quem entrou no sistema num dia, agrupado por empresa. As em trial
// aparecem primeiro: é onde a falta de acesso indica que o cliente não
// engatou. Traz junto a lista de quem sumiu. João, 05/09/2026.
async function renderUsoDiaSA(dia) {
  const hoje = new Date().toISOString().slice(0, 10);
  dia = dia || hoje;
  $('#sa-conteudo').innerHTML = '<p class="dica">Carregando…</p>';

  let lista, sumidas;
  try {
    [lista, sumidas] = await Promise.all([
      saApi('/uso-dia?dia=' + dia),
      saApi('/sem-acesso?dias=7')
    ]);
  } catch (e) { $('#sa-conteudo').innerHTML = `<p class="erro">${esc(e.message)}</p>`; return; }

  const hora = t => t ? new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';
  const dataBr = t => t ? new Date(t).toLocaleDateString('pt-BR') : 'nunca';
  const trial = lista.filter(x => x.plano === 'trial');
  const totUsuarios = lista.reduce((a, x) => a + (x.usuarios_ativos || 0), 0);
  const totCerts = lista.reduce((a, x) => a + (x.certificados_dia || 0), 0);

  const cartao = x => `
    <div class="item-cert" style="align-items:flex-start;${x.plano === 'trial' ? 'border-left:3px solid #d68910' : ''}">
      <span style="flex:1">
        <b>${esc(x.empresa)}</b>
        ${x.plano === 'trial' ? '<span class="st st-rascunho">trial</span>' : ''}
        ${x.empresa_status !== 'ativa' ? `<span class="st st-cancelado">${esc(x.empresa_status)}</span>` : ''}
        <br>
        <span class="dica">
          ${x.usuarios_ativos} usuário${x.usuarios_ativos === 1 ? '' : 's'} ·
          ${x.total_logins} acesso${x.total_logins === 1 ? '' : 's'}
          ${x.falhas > 0 ? ` · <span style="color:#b02a37">${x.falhas} falha${x.falhas === 1 ? '' : 's'}</span>` : ''}
          · das ${hora(x.primeiro_acesso)} às ${hora(x.ultimo_acesso)}
          ${x.certificados_dia > 0 ? ` · <b>${x.certificados_dia} calibração${x.certificados_dia === 1 ? '' : 'ões'}</b>` : ' · nenhuma calibração'}
        </span><br>
        <span class="dica">${(x.usuarios || []).map(u =>
          `${esc(u.nome)}${u.acessos > 1 ? ` (${u.acessos}×)` : ''}`).join(' · ') || '—'}</span>
      </span>
    </div>`;

  $('#sa-conteudo').innerHTML = `
    <div class="barra">
      <h2>Uso do dia</h2>
      <div class="barra-btns">
        <input type="date" id="uso-dia" value="${dia}" max="${hoje}"
               onchange="renderUsoDiaSA(this.value)">
        <button onclick="renderUsoDiaSA('${hoje}')">Hoje</button>
        <button onclick="renderSA()">← Voltar</button>
      </div>
    </div>

    <div class="kpis">
      <div class="kpi"><span class="kpi-num">${lista.length}</span><span class="kpi-rotulo">Empresas ativas no dia</span></div>
      <div class="kpi"><span class="kpi-num kpi-atencao">${trial.length}</span><span class="kpi-rotulo">Delas em trial</span></div>
      <div class="kpi"><span class="kpi-num">${totUsuarios}</span><span class="kpi-rotulo">Usuários distintos</span></div>
      <div class="kpi"><span class="kpi-num">${totCerts}</span><span class="kpi-rotulo">Calibrações criadas</span></div>
    </div>

    ${trial.length ? `<h4 style="margin-top:16px">Em trial — acessaram</h4>${trial.map(cartao).join('')}` : ''}

    ${lista.filter(x => x.plano !== 'trial').length
      ? `<h4 style="margin-top:16px">Demais empresas</h4>
         ${lista.filter(x => x.plano !== 'trial').map(cartao).join('')}`
      : ''}

    ${lista.length === 0 ? '<p class="dica">Nenhum acesso registrado neste dia.</p>' : ''}

    <h4 style="margin-top:22px">Sem acessar há mais de 7 dias</h4>
    ${sumidas.length === 0
      ? '<p class="dica">Todas as empresas ativas acessaram na última semana.</p>'
      : sumidas.map(x => `
        <div class="item-cert" style="${x.plano === 'trial' ? 'border-left:3px solid #b02a37' : ''}">
          <span>
            <b>${esc(x.empresa)}</b>
            ${x.plano === 'trial' ? '<span class="st st-rascunho">trial</span>' : ''}<br>
            <span class="dica">Último acesso: ${dataBr(x.ultimo_acesso)}
              ${x.dias_sem_acesso != null ? ` (há ${x.dias_sem_acesso} dias)` : ''}
              · ${x.certificados} calibração${x.certificados === 1 ? '' : 'ões'} no total
              · cadastrada em ${dataBr(x.criada_em)}</span>
          </span>
        </div>`).join('')}`;
}

async function renderLoginsSA(filtros = {}) {
  window._saLoginFiltros = filtros;
  $('#sa-conteudo').innerHTML = '<p class="dica">Carregando…</p>';

  // Carrega a lista de empresas uma vez (para o seletor)
  if (_saEmpresasFiltro === null) {
    try { _saEmpresasFiltro = await saApi('/empresas-filtro'); }
    catch { _saEmpresasFiltro = []; }
  }

  let lista;
  try {
    const p = new URLSearchParams();
    if (filtros.busca) p.set('busca', filtros.busca);
    if (filtros.empresa) p.set('empresa', filtros.empresa);
    if (filtros.papel) p.set('papel', filtros.papel);
    if (filtros.resultado) p.set('resultado', filtros.resultado);
    if (filtros.de) p.set('de', filtros.de);
    if (filtros.ate) p.set('ate', filtros.ate + 'T23:59:59');
    const q = p.toString();
    lista = await saApi('/logins' + (q ? '?' + q : ''));
  } catch (e) { $('#sa-conteudo').innerHTML = `<p class="erro">${e.message}</p>`; return; }

  const opcoesEmpresa = _saEmpresasFiltro.map(e =>
    `<option value="${e.id}" ${filtros.empresa === e.id ? 'selected' : ''}>${esc(e.razao_social)}</option>`).join('');

  const linhas = lista.map(l => `
    <tr>
      <td class="dica" style="white-space:nowrap">${dthr(l.ocorrido_em)}</td>
      <td>${l.email ? `<b>${esc(l.email)}</b>` : '<span class="dica">—</span>'}
          ${l.nome ? `<br><span class="dica">${esc(l.nome)}</span>` : ''}
          ${l.email && !l.usuario_id
            ? '<br><span class="badge rep" title="Nenhum usuário cadastrado com este e-mail">e-mail não cadastrado</span>' : ''}</td>
      <td>${l.papel ? (PAPEL_ROTULO[l.papel] || l.papel) : '—'}</td>
      <td>${l.empresa ? esc(l.empresa) : '<span class="dica">—</span>'}</td>
      <td>${LOGIN_ACAO[l.acao] || l.acao}</td>
      <td class="dica">${esc(l.ip || '—')}</td>
      <td>${l.usuario_id
        ? `<button class="btn-mini" onclick="verUsuarioSA('${l.usuario_id}')">👤 Ver</button>` : ''}</td>
    </tr>`).join('');

  const temFiltro = filtros.busca || filtros.empresa || filtros.papel || filtros.resultado || filtros.de || filtros.ate;

  $('#sa-conteudo').innerHTML = `
    <div class="barra">
      <h2>🔑 Log de logins</h2>
      <div class="barra-btns"><button onclick="renderPainelSA()">← Empresas</button></div>
    </div>
    <div class="card" style="padding:16px 18px">
      <div class="filtros-login">
        <label>Usuário (e-mail ou nome)
          <input type="text" id="fl-busca" value="${esc(filtros.busca || '')}"
            placeholder="🔍 buscar…" onkeydown="if(event.key==='Enter')aplicarFiltroLogin()">
        </label>
        <label>Empresa
          <select id="fl-empresa"><option value="">Todas</option>${opcoesEmpresa}</select>
        </label>
        <label>Papel
          <select id="fl-papel">
            <option value="">Todos</option>
            <option value="super_admin" ${filtros.papel==='super_admin'?'selected':''}>Super-admin</option>
            <option value="admin" ${filtros.papel==='admin'?'selected':''}>Administrador</option>
            <option value="responsavel_tecnico" ${filtros.papel==='responsavel_tecnico'?'selected':''}>Responsável Técnico</option>
            <option value="tecnico" ${filtros.papel==='tecnico'?'selected':''}>Técnico</option>
          </select>
        </label>
        <label>Resultado
          <select id="fl-resultado">
            <option value="">Todos</option>
            <option value="login_ok" ${filtros.resultado==='login_ok'?'selected':''}>Sucesso</option>
            <option value="login_falha" ${filtros.resultado==='login_falha'?'selected':''}>Falha</option>
            <option value="login_bloqueado" ${filtros.resultado==='login_bloqueado'?'selected':''}>Bloqueado</option>
          </select>
        </label>
        <label>De
          <input type="date" id="fl-de" value="${esc(filtros.de || '')}">
        </label>
        <label>Até
          <input type="date" id="fl-ate" value="${esc(filtros.ate || '')}">
        </label>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn-mini btn-primario" onclick="aplicarFiltroLogin()">Filtrar</button>
        ${temFiltro ? '<button class="btn-mini" onclick="renderLoginsSA()">Limpar filtros</button>' : ''}
      </div>
    </div>
    <div class="card">
      <div class="tabela-scroll">
        <table>
          <thead><tr><th>Quando</th><th>Usuário</th><th>Papel</th><th>Empresa</th><th>Resultado</th><th>IP</th><th></th></tr></thead>
          <tbody>${linhas || '<tr><td colspan="7" class="dica">Nenhum login encontrado com esses filtros.</td></tr>'}</tbody>
        </table>
      </div>
      <p class="dica" style="margin-top:10px">Mostrando ${lista.length} evento(s)${lista.length >= 300 ? ' (limite de 300 — refine os filtros para ver mais antigos)' : ''}.</p>
    </div>`;
}

function aplicarFiltroLogin() {
  renderLoginsSA({
    busca: $('#fl-busca').value.trim(),
    empresa: $('#fl-empresa').value,
    papel: $('#fl-papel').value,
    resultado: $('#fl-resultado').value,
    de: $('#fl-de').value,
    ate: $('#fl-ate').value
  });
}

// ── Log de e-mails enviados (super-admin) ─────────────────────
const EMAIL_MOTIVO = {
  certificado: '📄 Certificado', convite: '✉️ Convite', cadastro_concluido: '✅ Cadastro',
  confirmacao_portal: '🔑 Acesso portal', chamado: '🎧 Chamado',
  contrato_vencendo: '📆 Contrato', teste: '🧪 Teste', sistema: '⚙️ Sistema'
};

async function renderEmailLogSA(filtros = {}) {
  window._saEmailFiltros = filtros;
  $('#sa-conteudo').innerHTML = '<p class="dica">Carregando…</p>';
  if (_saEmpresasFiltro === null) {
    try { _saEmpresasFiltro = await saApi('/empresas-filtro'); } catch { _saEmpresasFiltro = []; }
  }
  let lista, saude;
  try {
    const p = new URLSearchParams();
    if (filtros.empresa) p.set('empresa', filtros.empresa);
    if (filtros.cliente) p.set('cliente', filtros.cliente);
    if (filtros.status) p.set('status', filtros.status);
    if (filtros.de) p.set('de', filtros.de);
    if (filtros.ate) p.set('ate', filtros.ate + 'T23:59:59');
    const q = p.toString();
    [lista, saude] = await Promise.all([
      saApi('/email-log' + (q ? '?' + q : '')),
      saApi('/email-saude').catch(() => null)
    ]);
  } catch (e) { $('#sa-conteudo').innerHTML = `<p class="erro">${e.message}</p>`; return; }

  const opcoesEmpresa = _saEmpresasFiltro.map(e =>
    `<option value="${e.id}" ${filtros.empresa === e.id ? 'selected' : ''}>${esc(e.razao_social)}</option>`).join('');

  const alerta = saude && Number(saude.erros_24h) > 0
    ? `<div class="caixa-erro-email">📧 <b>${saude.erros_24h} falha(s)</b> de envio nas últimas 24h.
        ${saude.ultimo_erro_detalhe ? `Último erro: <span class="dica">${esc(String(saude.ultimo_erro_detalhe).slice(0,120))}</span>` : ''}</div>`
    : `<div class="caixa-ok-email">✅ Envio de e-mails sem falhas nas últimas 24h (${saude?.total_24h || 0} enviado(s)).</div>`;

  const linhas = lista.map(l => `
    <tr class="${l.status === 'erro' ? 'linha-erro-email' : ''}">
      <td class="dica" style="white-space:nowrap">${dthr(l.enviado_em)}</td>
      <td>${l.status === 'erro'
        ? '<span class="badge rep">ERRO</span>'
        : '<span class="badge ok">enviado</span>'}</td>
      <td>${EMAIL_MOTIVO[l.motivo] || esc(l.motivo)}</td>
      <td style="min-width:250px">
        <b>${esc(l.destinatario)}</b>${l.nome_destino ? ` <span class="dica">· ${esc(l.nome_destino)}</span>` : ''}
        <br><span style="font-size:12px;color:#16202c">${esc(l.assunto)}</span>
        ${l.certificado_numero ? `<span class="dica"> · ${esc(l.certificado_numero)}</span>` : ''}
        <button class="btn-mini" style="margin-left:6px;padding:1px 7px" title="Ver o e-mail enviado"
          onclick="verEmailEnviado('${l.id}')">👁 ver</button></td>
      <td class="dica">${l.empresa ? esc(l.empresa) : 'sistema'}${l.cliente ? '<br>' + esc(l.cliente) : ''}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="dica">Nenhum e-mail no período.</td></tr>';

  $('#sa-conteudo').innerHTML = `
    <div class="barra">
      <h2>📧 Log de e-mails</h2>
      <div class="barra-btns"><button onclick="renderPainelSA()">← Empresas</button></div>
    </div>
    ${alerta}
    <div class="card" style="padding:16px 18px">
      <div class="filtros-login">
        <label>Empresa
          <select id="fe-empresa" onchange="carregarClientesFiltroSA('fe-empresa','fe-cliente')"><option value="">Todas</option>${opcoesEmpresa}</select>
        </label>
        <label>Cliente
          <select id="fe-cliente"><option value="">Todos</option></select>
        </label>
        <label>Status
          <select id="fe-status">
            <option value="">Todos</option>
            <option value="enviado" ${filtros.status === 'enviado' ? 'selected' : ''}>Enviados</option>
            <option value="erro" ${filtros.status === 'erro' ? 'selected' : ''}>Com erro</option>
          </select>
        </label>
        <label>De <input type="date" id="fe-de" value="${filtros.de || ''}"></label>
        <label>Até <input type="date" id="fe-ate" value="${filtros.ate || ''}"></label>
        <button class="btn-primario" onclick="aplicarFiltroEmail()">Filtrar</button>
        <button class="btn-mini" onclick="renderEmailLogSA()">Limpar</button>
      </div>
      <div style="overflow-x:auto;margin-top:10px">
        <table class="tab-sa">
          <thead><tr><th>Quando</th><th>Status</th><th>Motivo</th><th>Destinatário e assunto</th><th>Empresa/Cliente</th></tr></thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>
      <p class="dica" style="margin-top:8px">${lista.length} registro(s) — máximo 500.</p>
    </div>`;
}

function aplicarFiltroEmail() {
  renderEmailLogSA({
    empresa: $('#fe-empresa').value, cliente: $('#fe-cliente').value,
    status: $('#fe-status').value, de: $('#fe-de').value, ate: $('#fe-ate').value
  });
}

// ══ PESQUISA DO TSCERT (produto) — super admin (João, 12/08/2026) ══
// Envio manual por empresa/papel, automático a cada N dias, NPS e leitura
// das respostas. Perguntas personalizadas por papel do usuário.
let psaasSel = new Set(), psaasFiltroEmp = '', psaasFiltroPapel = '';
const PAPEL_ROT = { admin: 'Admin', responsavel_tecnico: 'Resp. técnico', tecnico: 'Técnico' };

async function renderPsaasSA() {
  $('#sa-conteudo').innerHTML = '<p class="dica">Carregando a pesquisa…</p>';
  let d;
  try { d = await saApi('/psaas'); }
  catch (e) { $('#sa-conteudo').innerHTML = `<p class="erro">${e.message}</p>`; return; }
  window._psaas = d;
  const r = d.resumo || {}, cfg = d.cfg || {};
  let us = d.usuarios || [];
  if (psaasFiltroEmp) us = us.filter(u => u.empresa_id === psaasFiltroEmp);
  if (psaasFiltroPapel) us = us.filter(u => u.papel === psaasFiltroPapel);
  const empresas = [...new Map((d.usuarios || []).map(u => [u.empresa_id, u.empresa])).entries()];
  const taxa = r.enviadas > 0 ? Math.round(100 * r.respondidas / r.enviadas) : 0;
  const kpi = (v, rot, cor) => `<div class="kpi"><span class="kpi-num" style="color:${cor}">${v}</span>
    <span class="kpi-rotulo">${rot}</span></div>`;

  $('#sa-conteudo').innerHTML = `
    <div class="barra"><h2>⭐ Pesquisa do TSCert</h2>
      <div class="barra-btns"><button onclick="renderPainelSA()">← Empresas</button></div></div>

    <div class="kpis" style="margin-bottom:12px">
      ${kpi(r.enviadas || 0, 'Convites enviados', '#164066')}
      ${kpi((r.respondidas || 0) + ` (${taxa}%)`, 'Respondidas', '#1e7d46')}
      ${kpi(r.nps ?? '—', 'NPS do TSCert', (r.nps ?? 0) >= 50 ? '#1e7d46' : (r.nps ?? 0) >= 0 ? '#b7791f' : '#b02a37')}
      ${kpi(r.promotores || 0, 'Promotores (9-10)', '#1e7d46')}
      ${kpi(r.detratores || 0, 'Detratores (0-6)', (r.detratores || 0) > 0 ? '#b02a37' : '#5a7183')}
    </div>

    <div class="card" style="margin-bottom:12px">
      <h3 style="margin-top:0">⚙️ Envio automático e convite</h3>
      <label class="chk"><input type="checkbox" id="ps-ativo" ${cfg.ativo ? 'checked' : ''}
          onchange="psaasConfirmarAtivar(this)">
        Enviar automaticamente a cada
        <input type="number" id="ps-freq" value="${cfg.freq_dias ?? 180}" min="30" max="730"
          style="width:70px;display:inline-block;margin:0 4px"> dias por usuário</label>
      <div class="form-grid" style="margin-top:8px">
        <label>Só quem usou o sistema nos últimos (dias)
          <input type="number" id="ps-diasativo" value="${cfg.dias_ativo ?? 30}" min="7" max="365"></label>
        <label>E-mail para alerta de detrator (nota ≤ 6)
          <input type="email" id="ps-alerta" value="${esc(cfg.alerta_email || '')}"
            placeholder="compras@minasbalancas.com.br"></label>
      </div>
      <label style="margin-top:8px">Assunto do convite (opcional)
        <input type="text" id="ps-titulo" value="${esc(cfg.convite_titulo || '')}"
          placeholder="Sua opinião sobre o TSCert (2 minutos)"></label>
      <label style="margin-top:8px">Texto do convite (opcional — deixe vazio para o texto padrão,
        que já menciona o papel de cada pessoa)
        <textarea id="ps-texto" rows="3"
          placeholder="Ex.: Estamos preparando as próximas melhorias do TSCert e queremos ouvir você…">${esc(cfg.convite_texto || '')}</textarea></label>
      <p class="dica" id="ps-aviso-auto" style="margin-top:8px"></p>
      <div class="barra-btns" style="margin-top:10px;justify-content:flex-end">
        <button class="btn-primario" onclick="psaasSalvarCfg()">Salvar configuração</button></div>
    </div>

    <div class="card" style="margin-bottom:12px">
      <h3 style="margin-top:0">📨 Envio manual</h3>
      <div class="barra-btns" style="flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:8px">
        <select onchange="psaasFiltroEmp=this.value; renderPsaasSA()"
          style="width:auto;max-width:230px;padding:4px 6px;border:1px solid #dde5ec;border-radius:7px;font:inherit;font-size:.85rem">
          <option value="">🏢 todas as empresas</option>
          ${empresas.map(([id, nome]) => `<option value="${id}" ${psaasFiltroEmp === id ? 'selected' : ''}>${esc(nome)}</option>`).join('')}
        </select>
        <select onchange="psaasFiltroPapel=this.value; renderPsaasSA()"
          style="width:auto;padding:4px 6px;border:1px solid #dde5ec;border-radius:7px;font:inherit;font-size:.85rem">
          <option value="">todos os papéis</option>
          ${Object.entries(PAPEL_ROT).map(([v, rot]) => `<option value="${v}" ${psaasFiltroPapel === v ? 'selected' : ''}>${rot}</option>`).join('')}
        </select>
        <button class="btn-mini" onclick="psaasMarcarTodos(true)">Marcar todos</button>
        <button class="btn-mini" onclick="psaasMarcarTodos(false)">Limpar</button>
        <button class="btn-primario btn-mini" onclick="psaasEnviar()">📨 Enviar aos selecionados
          (<span id="ps-qtd">${psaasSel.size}</span>)</button>
      </div>
      <div class="tabela-scroll"><table>
        <thead><tr><th></th><th>Usuário</th><th>Empresa</th><th>Papel</th>
          <th>Último acesso</th><th>Último convite</th></tr></thead>
        <tbody>${us.length === 0 ? '<tr><td colspan="6" class="dica">Nenhum usuário no filtro.</td></tr>'
          : us.map(u => `<tr>
            <td><input type="checkbox" class="ps-chk" value="${u.usuario_id}"
              ${psaasSel.has(u.usuario_id) ? 'checked' : ''}
              onchange="psaasMarcar('${u.usuario_id}', this.checked)"></td>
            <td><b>${esc(u.nome)}</b><br><span class="dica">${esc(u.email)}</span></td>
            <td class="dica">${esc(u.empresa)}</td>
            <td class="dica">${PAPEL_ROT[u.papel] || u.papel}</td>
            <td class="dica">${u.visto_em ? dthr(u.visto_em) : '—'}</td>
            <td class="dica">${u.ultimo_envio
              ? dbrSA(u.ultimo_envio) + (u.respondeu ? ' <span style="color:#1e7d46">· respondeu</span>' : '')
              : 'nunca'}</td></tr>`).join('')}
        </tbody></table></div>
    </div>

    <div class="card">
      <h3 style="margin-top:0">💬 Respostas recebidas</h3>
      ${(d.respostas || []).length === 0
        ? '<p class="dica">Nenhuma resposta ainda.</p>'
        : d.respostas.map(rp => `
          <div style="border:1px solid #e8edf2;border-radius:10px;padding:10px 12px;margin-bottom:8px;
            border-left:3px solid ${rp.nps >= 9 ? '#1e7d46' : rp.nps <= 6 ? '#b02a37' : '#b7791f'}">
            <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px">
              <b>${esc(rp.nome)}</b>
              <span class="dica">${PAPEL_ROT[rp.papel] || rp.papel} · ${esc(rp.empresa)} · ${dthr(rp.quando)}</span>
            </div>
            <div style="margin-top:6px">${(rp.respostas || []).map(x => `
              <div style="font-size:12.5px;padding:3px 0;border-top:1px solid #f2f5f8">
                <span class="dica">${esc(x.pergunta)}</span><br>
                ${x.texto ? '<i>“' + esc(x.texto) + '”</i>'
                  : `<b style="color:${x.nota >= 9 ? '#1e7d46' : x.nota <= 6 ? '#b02a37' : '#b7791f'}">${x.nota}</b>`}
              </div>`).join('')}</div>
          </div>`).join('')}
    </div>`;
}
// Cinto de segurança (João, 14/08/2026): ligar o automático dispara para
// TODOS os elegíveis na madrugada seguinte. Mostra o tamanho antes de ativar.
function psaasElegiveis() {
  const d = window._psaas || {};
  const cfgD = d.cfg || {};
  const diasAtivo = Number(document.getElementById('ps-diasativo')?.value) || cfgD.dias_ativo || 30;
  const freq = Number(document.getElementById('ps-freq')?.value) || cfgD.freq_dias || 180;
  const agora = Date.now();
  return (d.usuarios || []).filter(u => {
    if (!u.visto_em) return false;
    if ((agora - new Date(u.visto_em)) / 86400000 > diasAtivo) return false;
    if (!u.ultimo_envio) return true;
    return (agora - new Date(u.ultimo_envio)) / 86400000 >= freq;
  });
}
async function psaasConfirmarAtivar(chk) {
  const av = document.getElementById('ps-aviso-auto');
  if (!chk.checked) { if (av) av.innerHTML = ''; return; }
  const n = psaasElegiveis().length;
  const ok = await modalConfirmar('⚠️ Ativar o envio automático',
    `Ao ativar e salvar, o próximo envio ocorre na <b>madrugada seguinte</b>, ` +
    `para <b>${n} usuário(s)</b> que se encaixam nos critérios agora ` +
    `(ativos no período e sem convite dentro do intervalo).\n\n` +
    `Confirme que o fluxo já foi testado de ponta a ponta antes de ligar.`,
    { textoSim: 'Entendi, ativar', textoNao: 'Cancelar' });
  if (!ok) { chk.checked = false; if (av) av.innerHTML = ''; return; }
  if (av) av.innerHTML = `<span style="color:#b7791f">⚠️ Ao salvar, <b>${n} pessoa(s)</b>
    receberão o convite na próxima madrugada.</span>`;
}

function psaasMarcar(id, on) {
  if (on) psaasSel.add(id); else psaasSel.delete(id);
  const el = document.getElementById('ps-qtd');
  if (el) el.textContent = psaasSel.size;
}
function psaasMarcarTodos(on) {
  document.querySelectorAll('.ps-chk').forEach(c => {
    c.checked = on; psaasMarcar(c.value, on);
  });
}
async function psaasSalvarCfg() {
  if ($('#ps-ativo').checked) {
    const n = psaasElegiveis().length;
    const ok = await modalConfirmar('Salvar com envio automático ligado',
      `Confirma? Na próxima madrugada o sistema enviará o convite para ` +
      `<b>${n} usuário(s)</b>.`, { textoSim: 'Salvar', textoNao: 'Cancelar' });
    if (!ok) return;
  }
  try {
    await saApi('/psaas/config', { method: 'PUT', body: JSON.stringify({
      ativo: $('#ps-ativo').checked,
      freqDias: Number($('#ps-freq').value) || 180,
      diasAtivo: Number($('#ps-diasativo').value) || 30,
      alertaEmail: $('#ps-alerta').value || null,
      conviteTitulo: $('#ps-titulo').value || null,
      conviteTexto: $('#ps-texto').value || null }) });
    toast('Configuração salva ✓', 'ok');
  } catch (e) { toast(e.message, 'erro'); }
}
async function psaasEnviar() {
  if (psaasSel.size === 0) { toast('Selecione ao menos um usuário.', 'erro'); return; }
  const ok = await modalConfirmar('📨 Enviar pesquisa',
    `Enviar o convite da pesquisa do TSCert para ${psaasSel.size} usuário(s)?\n\n` +
    'Cada pessoa recebe um link pessoal com as perguntas do papel dela.',
    { textoSim: 'Enviar', textoNao: 'Cancelar' });
  if (!ok) return;
  try {
    const r = await saApi('/psaas/enviar', { method: 'POST',
      body: JSON.stringify({ usuarios: [...psaasSel] }) });
    toast(`📨 ${r.enfileirado} convite(s) na fila de envio!`, 'ok', 6000);
    psaasSel.clear();
    renderPsaasSA();
  } catch (e) { toast(e.message, 'erro'); }
}

// ── Métricas do servidor: CPU, memória e usuários no tempo ───
// Coletadas a cada 5 min pelo worker; responde "quantas empresas o
// VPS aguenta" cruzando recursos com uso real (João, 12/08/2026).
let metHoras = 24;
async function renderMetricasSA() {
  $('#sa-conteudo').innerHTML = '<p class="dica">Carregando métricas…</p>';
  let d;
  try { d = await saApi('/metricas?horas=' + metHoras); }
  catch (e) { $('#sa-conteudo').innerHTML = `<p class="erro">${e.message}</p>`; return; }
  const s = d.serie || [], r = d.resumo || {};
  const per = [[6, '6 h'], [24, '24 h'], [168, '7 dias'], [720, '30 dias']];
  const btns = per.map(([h, rot]) => `<button class="btn-mini ${metHoras === h ? 'periodo-ativo' : ''}"
      onclick="metHoras=${h}; renderMetricasSA()">${rot}</button>`).join(' ');

  const kpiM = (v, rot, cor) => `<div class="kpi"><span class="kpi-num" style="color:${cor}">${v}</span>
    <span class="kpi-rotulo">${rot}</span></div>`;
  const corPico = (r.cpu_max ?? 0) > 80 ? '#b02a37' : (r.cpu_max ?? 0) > 50 ? '#b7791f' : '#1e7d46';

  // gráfico SVG: CPU (área), memória (linha) e usuários (barras ao fundo)
  let grafico = '<p class="dica">Ainda não há amostras suficientes. A coleta roda a cada 5 minutos — volte em alguns minutos.</p>';
  if (s.length >= 2) {
    const W = 900, H = 260, ml = 38, mb = 26, mt = 10, mr = 38;
    const gw = W - ml - mr, gh = H - mt - mb;
    const x = i => ml + (i / (s.length - 1)) * gw;
    const yPct = v => mt + gh - (Math.max(0, Math.min(100, Number(v) || 0)) / 100) * gh;
    const maxU = Math.max(1, ...s.map(p => Number(p.usuarios) || 0));
    const barras = s.map((p, i) => {
      const alt = ((Number(p.usuarios) || 0) / maxU) * gh * 0.55;
      const lw = Math.max(1, gw / s.length - 1);
      return `<rect x="${x(i) - lw / 2}" y="${mt + gh - alt}" width="${lw}" height="${alt}"
        fill="#164066" opacity=".13"></rect>`;
    }).join('');
    const linha = (campo, cor) => `<polyline fill="none" stroke="${cor}" stroke-width="1.8"
      points="${s.map((p, i) => `${x(i).toFixed(1)},${yPct(p[campo]).toFixed(1)}`).join(' ')}"></polyline>`;
    const rotulos = s.filter((_, i) => i % Math.ceil(s.length / 6) === 0).map((p, k, arr) => {
      const i = s.indexOf(p);
      const dt = new Date(p.momento);
      const txt = metHoras <= 24 ? dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        : dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      return `<text x="${x(i)}" y="${H - 8}" font-size="10" fill="#8ba0b5" text-anchor="middle">${txt}</text>`;
    }).join('');
    grafico = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">
      ${[0, 25, 50, 75, 100].map(v => `<line x1="${ml}" y1="${yPct(v)}" x2="${W - mr}" y2="${yPct(v)}"
          stroke="#e8edf2" stroke-width="1"></line>
        <text x="${ml - 6}" y="${yPct(v) + 3}" font-size="10" fill="#8ba0b5" text-anchor="end">${v}%</text>`).join('')}
      ${barras}${linha('cpu', '#b02a37')}${linha('mem_pct', '#164066')}${rotulos}
    </svg>
    <p class="dica" style="text-align:center;margin:4px 0 0">
      <span style="color:#b02a37">━</span> CPU ·
      <span style="color:#164066">━</span> memória ·
      <span style="color:#164066;opacity:.5">▮</span> usuários ativos (pico ${maxU})</p>`;
  }

  $('#sa-conteudo').innerHTML = `
    <div class="barra"><h2>📈 Servidor</h2>
      <div class="barra-btns">${btns}
        <button onclick="renderPainelSA()">← Empresas</button></div></div>
    <div class="kpis" style="margin-bottom:12px">
      ${kpiM((r.cpu_max ?? 0) + '%', 'Pico de CPU', corPico)}
      ${kpiM((r.cpu_med ?? 0) + '%', 'CPU média', '#5a7183')}
      ${kpiM((r.mem_max ?? 0) + '%', 'Pico de memória', '#164066')}
      ${kpiM(r.usuarios_max ?? 0, 'Máx. usuários simultâneos', '#1e7d46')}
      ${kpiM((r.disco_max ?? 0) + '%', 'Disco', (r.disco_max ?? 0) > 80 ? '#b02a37' : '#5a7183')}
    </div>
    <div class="card">${grafico}
      <p class="dica" style="margin-top:10px">${r.amostras || 0} amostra(s) no período ·
        coleta a cada 5 min · detalhe fino mantido por 7 dias.
        Se a CPU encosta em 80% com poucos usuários, é hora de pensar em upgrade do VPS.</p>
    </div>`;
}

// ── Memorial de cálculo da incerteza (João, 16/08/2026) ──────
// Abre a "caixa-preta": entradas, cada componente com sua fórmula, a
// combinação em quadratura e o U final, ponto a ponto. Serve à equipe
// e para responder cliente ou auditor.
// Imprime o memorial inteiro (o modal tem rolagem interna: sem isso o
// navegador repete o trecho visível em várias páginas — João, 18/08/2026).
function imprimirMemorial() {
  const m = document.getElementById('modal-memorial');
  if (!m) return;
  m.querySelectorAll('details').forEach(d => d.open = true);   // legenda aberta no papel
  const caixa = m.querySelector('.modal-caixa');
  if (caixa) caixa.scrollTop = 0;
  setTimeout(() => window.print(), 120);
}

async function verMemorialIncerteza(id) {
  document.getElementById('modal-memorial')?.remove();
  const m = document.createElement('div');
  m.className = 'modal-fundo'; m.id = 'modal-memorial';
  m.innerHTML = '<div class="modal-caixa" style="max-width:720px;width:96vw"><p class="dica">Reconstruindo o cálculo…</p></div>';
  document.body.appendChild(m);
  let d;
  try { d = await api('/certificados/' + id + '/memorial-incerteza'); }
  catch (e) {
    m.innerHTML = `<div class="modal-caixa" style="max-width:420px"><p class="erro">${e.message}</p>
      <button class="btn-mini" onclick="this.closest('.modal-fundo').remove()">Fechar</button></div>`;
    return;
  }
  if (!d || !d.length) { m.remove(); toast('Sem dados de cálculo para este certificado.', 'erro'); return; }
  const c = d[0];
  const un = c.unidade || 'kg';
  const f = (v, casas) => v == null ? '—' :
    Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas ?? 4, maximumFractionDigits: casas ?? 4 });
  const mpePpm = (Number(c.mpe_relativo) * 1e6).toFixed(1);

  const pontos = d.map(p => `
    <div class="ponto-mem" style="border:1px solid #e8edf2;border-radius:9px;padding:10px 12px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px;margin-bottom:6px">
        <b style="font-size:13px">Ponto ${p.ordem} · carga ${f(p.carga, 3)} ${un}</b>
        <span class="dica">indicação ${f(p.indicacao, 3)} · erro ${f(p.erro, 3)}</span>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <tr><td style="padding:5px 0;color:#5a7183;vertical-align:top">
              <b style="color:#16202c">1. Pesos-padrão</b> — u_pesos = carga × mpe_rel ÷ √3
              <br><span style="font-size:11.5px">Quanto os pesos usados podem estar afastados do valor
              nominal: a classe ${esc(c.classe_pesos)} admite ${mpePpm} ppm, o que nesta carga dá
              ${f(Number(p.carga) * Number(c.mpe_relativo), 4)} ${un} de tolerância — dividida por √3
              porque o erro pode estar em qualquer ponto dessa faixa.</span></td>
            <td style="text-align:right;font-family:monospace;vertical-align:top;white-space:nowrap">
              ${f(p.carga, 3)} × ${mpePpm}e-6 ÷ 1,732<br><b>= ${f(p.u_pesos, 6)}</b></td></tr>

        <tr><td style="padding:5px 0;color:#5a7183;vertical-align:top;border-top:1px solid #f2f5f8">
              <b style="color:#16202c">2. Resolução do indicador</b> — u_leitura = √2 × d ÷ √12
              <br><span style="font-size:11.5px">O display salta de ${f(p.divisao_ponto, 4)} em
              ${f(p.divisao_ponto, 4)} ${un}: o valor real está em algum ponto dentro dessa janela.
              Entra duas vezes (leitura do zero e da carga), por isso o √2.</span></td>
            <td style="text-align:right;font-family:monospace;vertical-align:top;white-space:nowrap;border-top:1px solid #f2f5f8">
              1,414 × ${f(p.divisao_ponto, 4)} ÷ 3,464<br><b>= ${f(p.u_leitura, 6)}</b></td></tr>

        <tr><td style="padding:5px 0;color:#5a7183;vertical-align:top;border-top:1px solid #f2f5f8">
              <b style="color:#16202c">3. Repetibilidade</b> — u_repet = s
              <br><span style="font-size:11.5px">${Number(c.desvio_rep) > 0
                ? 'Quanto a balança variou ao repetir a mesma carga no ensaio de repetibilidade.'
                : 'As leituras repetidas foram idênticas no ensaio, portanto esta contribuição é zero.'}</span></td>
            <td style="text-align:right;font-family:monospace;vertical-align:top;border-top:1px solid #f2f5f8">
              <b>= ${f(p.u_repet, 6)}</b></td></tr>

        <tr style="border-top:1px solid #dde5ec">
            <td style="padding:6px 0;color:#5a7183;vertical-align:top">
              <b style="color:#16202c">Combinação</b> — u_c = raiz(u1² + u2² + u3²)
              <br><span style="font-size:11.5px">As três fontes são independentes, então somam em
              quadratura (raiz da soma dos quadrados) — o maior componente domina o resultado.</span></td>
            <td style="text-align:right;font-family:monospace;vertical-align:top"><b>= ${f(p.u_combinada, 6)}</b></td></tr>

        <tr><td style="padding:6px 0;color:#164066;vertical-align:top">
              <b>Resultado — U = k × u_c</b> (k = ${f(c.fator_k, 2)})
              <br><span style="font-size:11.5px;color:#5a7183">Incerteza expandida: a faixa que cobre
              cerca de 95% dos resultados possíveis. É o "±" impresso no certificado.</span></td>
            <td style="text-align:right;font-family:monospace;color:#164066;vertical-align:top;white-space:nowrap">
              <b>± ${f(p.incerteza, 4)} ${un}</b>${p.ema != null
                ? `<br><span class="dica">EMA ± ${f(p.ema, 3)}</span>`
                : '<br><span style="color:#b02a37;font-size:11px">EMA não calculado</span>'}</td></tr>
      </table>
      ${(() => {
        const comp = [
          { n: 'pesos-padrão', v: Number(p.u_pesos) },
          { n: 'resolução do indicador', v: Number(p.u_leitura) },
          { n: 'repetibilidade', v: Number(p.u_repet) }];
        const soma = comp.reduce((s, x) => s + x.v * x.v, 0);
        if (!(soma > 0)) return '';
        const maior = comp.sort((a, b) => b.v - a.v)[0];
        const pct = Math.round(100 * maior.v * maior.v / soma);
        return `<p style="font-size:11.5px;color:#8ba0b5;margin:7px 0 0;border-top:1px dashed #e8edf2;padding-top:6px">
          <b>Quem manda neste ponto:</b> ${maior.n} responde por ${pct}% da incerteza.
          ${pct >= 80 ? 'Reduzir as demais fontes não mudaria o resultado de forma perceptível.' : ''}</p>`;
      })()}
    </div>`).join('');

  m.innerHTML = `<style>
      @media print {
        body > *:not(#modal-memorial) { display: none !important; }
        #modal-memorial { position: static !important; inset: auto !important;
          background: #fff !important; display: block !important; padding: 0 !important; }
        #modal-memorial .modal-caixa { max-height: none !important; overflow: visible !important;
          max-width: 100% !important; width: 100% !important; box-shadow: none !important;
          border: 0 !important; padding: 0 !important; }
        #modal-memorial .no-print { display: none !important; }
        #modal-memorial details { display: block !important; }
        #modal-memorial details > *:not(summary) { display: block !important; }
        #modal-memorial .ponto-mem { page-break-inside: avoid; break-inside: avoid; }
        @page { margin: 1.5cm; }
      }
    </style>
    <div class="modal-caixa" style="max-width:720px;width:96vw;max-height:88vh;overflow:auto">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
      <div><h3 style="margin:0 0 3px">🔬 Memorial de cálculo da incerteza</h3>
        <p class="dica" style="margin:0">Certificado <b>${esc(c.numero || '—')}</b> · ${esc(c.balanca)} · ${esc(c.cliente)}</p></div>
      <button class="btn-mini no-print" onclick="this.closest('.modal-fundo').remove()">✕ Fechar</button>
    </div>
    <div style="background:#f7f9fb;border:1px solid #e3e8ee;border-radius:9px;padding:10px 12px;margin:10px 0">
      <p style="font-size:12.5px;font-weight:600;color:#164066;margin:0 0 6px">Dados de entrada</p>
      <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:12.5px;color:#16202c">
        <span>Classe da balança <b>${esc(c.classe_balanca || '—')}</b></span>
        <span>Classe dos pesos <b>${esc(c.classe_pesos)}</b> (mpe ${mpePpm} ppm)</span>
        <span>Repetibilidade <b>s = ${f(c.desvio_rep, 4)} ${un}</b> em ${c.n_repeticoes} medições</span>
        <span>Fator k = <b>${f(c.fator_k, 2)}</b></span>
      </div>
    </div>
    ${pontos}
    <details style="background:#f7f9fb;border:1px solid #e3e8ee;border-radius:9px;padding:9px 12px;margin-bottom:8px">
      <summary style="cursor:pointer;font-size:12.5px;font-weight:600;color:#164066">
        📖 Entenda o cálculo em detalhes</summary>

      <p style="font-size:12px;color:#16202c;margin:10px 0 4px"><b>A ideia geral</b></p>
      <p style="font-size:12px;color:#5a7183;margin:0 0 10px">Nenhuma medição é exata. A incerteza responde
        "dentro de que faixa o valor verdadeiro provavelmente está?". Para chegar nela, lista-se cada fonte
        de dúvida do ensaio, converte-se cada uma para a mesma unidade da balança, somam-se em quadratura e
        multiplica-se por um fator de segurança (k). O resultado é o "±" do certificado.</p>

      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <tr><td colspan="2" style="padding:8px 0 4px;font-weight:600;color:#164066">As três fontes consideradas</td></tr>

        <tr><td style="padding:5px 10px 5px 0;white-space:nowrap;vertical-align:top"><b>u_pesos</b></td>
            <td style="color:#5a7183">Os pesos-padrão que você levou a campo não valem exatamente o nominal —
            um peso de 20 kg classe M1 pode valer 20,001 kg. A norma OIML R111 define o desvio máximo por
            classe, em partes por milhão (ppm): E2 = 1,6 · F1 = 5 · M1 = 50 · M2 = 160 ppm.
            <br><i>Cálculo:</i> multiplica-se a carga pelo ppm da classe e divide-se por √3.
            <br><i>Por que √3:</i> a norma dá um <b>limite</b>, não um erro conhecido. Como o valor real pode
            estar em qualquer ponto entre −limite e +limite com a mesma chance (distribuição retangular),
            a estatística manda dividir por √3 para obter o desvio-padrão equivalente.</td></tr>

        <tr><td style="padding:5px 10px 5px 0;white-space:nowrap;vertical-align:top"><b>u_leitura</b></td>
            <td style="color:#5a7183">O display não mostra valores contínuos: ele salta de uma divisão (d)
            para outra. Se d = 20 kg e o display marca 7.000, o valor real pode ser qualquer coisa entre
            6.990 e 7.010.
            <br><i>Cálculo:</i> d ÷ √12, que é o mesmo que (d/2) ÷ √3 — a metade da divisão tratada como
            distribuição retangular.
            <br><i>Por que ×√2:</i> a medição envolve <b>duas</b> leituras — o zero antes de carregar e a
            indicação com carga. Cada uma carrega essa incerteza, e duas fontes independentes somam em
            quadratura, o que resulta no fator √2.
            <br><b>Observação prática:</b> em balanças de grande capacidade essa costuma ser a maior fonte —
            comprar pesos de classe melhor não reduz a incerteza; só um indicador com divisão menor reduz.</td></tr>

        <tr><td style="padding:5px 10px 5px 0;white-space:nowrap;vertical-align:top"><b>u_repet</b></td>
            <td style="color:#5a7183">Mede a própria balança: aplicando a mesma carga várias vezes, quanto o
            resultado varia? É o desvio-padrão amostral dessas leituras (ensaio de repetibilidade).
            <br>Diferente das outras duas, esta é uma fonte <b>tipo A</b> — obtida por estatística sobre
            medições reais, não por um limite de norma. Se todas as leituras derem o mesmo valor, vale zero;
            isso não significa que a balança seja perfeita, apenas que a variação foi menor que a resolução
            do display.</td></tr>

        <tr><td colspan="2" style="padding:10px 0 4px;font-weight:600;color:#164066">Como as fontes se juntam</td></tr>

        <tr><td style="padding:5px 10px 5px 0;white-space:nowrap;vertical-align:top"><b>u_c</b></td>
            <td style="color:#5a7183">Incerteza-padrão combinada: raiz da soma dos quadrados das três
            contribuições.
            <br><i>Por que não somar direto:</i> as fontes são independentes — é improvável que todos os
            erros aconteçam no mesmo sentido ao mesmo tempo. A soma quadrática reflete isso.
            <br><b>Consequência prática:</b> quando um componente é bem maior que os outros, ele domina o
            resultado. Ex.: 8,16 e 0,20 combinam em 8,17 — o menor praticamente desaparece.</td></tr>

        <tr><td style="padding:5px 10px 5px 0;white-space:nowrap;vertical-align:top"><b>k</b></td>
            <td style="color:#5a7183">Fator de abrangência. Com k = 2, amplia-se a faixa para cobrir cerca de
            <b>95%</b> dos resultados possíveis (dois desvios-padrão). É a convenção adotada em calibração,
            conforme o GUM.</td></tr>

        <tr><td style="padding:5px 10px 5px 0;white-space:nowrap;vertical-align:top"><b>U</b></td>
            <td style="color:#5a7183">Incerteza <b>expandida</b> = k × u_c. É o "±" que aparece no certificado.
            Interpretação: o erro verdadeiro da balança naquele ponto está, com ~95% de confiança, dentro de
            (erro medido ± U).</td></tr>

        <tr><td colspan="2" style="padding:10px 0 4px;font-weight:600;color:#164066">Como isso vira conformidade</td></tr>

        <tr><td style="padding:5px 10px 5px 0;white-space:nowrap;vertical-align:top"><b>EMA</b></td>
            <td style="color:#5a7183">Erro máximo admissível: o quanto a balança pode errar naquele ponto e
            ainda ser aceita, conforme a classe de exatidão e a Portaria Inmetro nº 157/2022. O julgamento
            compara o erro medido com o EMA, levando a incerteza em conta.
            <br><b>Sinal de alerta:</b> se U for da mesma ordem do EMA, o ensaio não tem resolução suficiente
            para julgar com segurança — vale rever a instrumentação ou o método.</td></tr>
      </table>

      <p style="font-size:11.5px;color:#8ba0b5;margin:10px 0 0;border-top:1px solid #e8edf2;padding-top:8px">
        <b>Referências:</b> GUM — ISO/IEC Guide 98-3 (avaliação de incerteza) · OIML R111 (classes de
        pesos-padrão) · OIML R76 / Portaria Inmetro nº 157/2022 (erros máximos admissíveis e classes de
        exatidão) · VIM — Vocabulário Internacional de Metrologia.</p>
    </details>

    <div style="background:#eef3f7;border-radius:9px;padding:10px 12px;font-size:12px;color:#16202c">
      <b>Modelo adotado:</b> incerteza combinada pela raiz da soma quadrática das contribuições
      (GUM / ISO/IEC Guide 98-3), com fator de abrangência k = ${f(c.fator_k, 2)} para nível de
      confiança de aproximadamente 95%. Pesos-padrão por distribuição retangular sobre o erro
      máximo admissível da classe (OIML R111); resolução do indicador por distribuição retangular
      em dois pontos (zero e carga); repetibilidade pelo desvio-padrão amostral das medições.
    </div>
    <div class="barra-btns no-print" style="margin-top:12px;justify-content:flex-end">
      <button class="btn-mini" onclick="imprimirMemorial()">🖨️ Imprimir / salvar em PDF</button>
    </div>
  </div>`;
}

// ── Prévia do e-mail enviado (João, 12/08/2026) ──────────────
// O corpo fica guardado por 30 dias (expurgo automático no worker).
async function verEmailEnviado(id) {
  document.getElementById('modal-email-prev')?.remove();
  const m = document.createElement('div');
  m.className = 'modal-fundo'; m.id = 'modal-email-prev';
  m.innerHTML = `<div class="modal-caixa" style="max-width:680px;width:96vw">
      <p class="dica">Carregando o e-mail…</p></div>`;
  document.body.appendChild(m);
  try {
    const d = await saApi('/email-log/' + id);
    const cab = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
        <div>
          <h3 style="margin:0 0 4px">${esc(d.assunto || '(sem assunto)')}</h3>
          <p class="dica" style="margin:0">Para: <b>${esc(d.destinatario)}</b>
            ${d.nome_destino ? ' · ' + esc(d.nome_destino) : ''}<br>
            ${dthr(d.enviado_em)} · ${esc(d.motivo)} ·
            ${d.status === 'erro' ? '<span style="color:#b02a37">falhou</span>' : 'enviado'}
            ${d.empresa ? ' · ' + esc(d.empresa) : ''}</p>
          ${d.erro_detalhe ? `<p class="dica" style="color:#b02a37;margin:6px 0 0">
            Erro: ${esc(d.erro_detalhe)}</p>` : ''}
        </div>
        <button class="btn-mini" onclick="this.closest('.modal-fundo').remove()">✕ Fechar</button>
      </div>`;
    const corpo = d.corpo_html
      ? `<iframe style="width:100%;height:60vh;border:1px solid #e3e8ee;border-radius:8px;
           margin-top:10px;background:#fff" sandbox=""
           srcdoc="${String(d.corpo_html).replace(/"/g, '&quot;')}"></iframe>`
      : `<p class="dica" style="margin-top:12px;padding:10px;background:#f7f9fb;border-radius:8px">
           O conteúdo deste e-mail não está mais disponível (guardamos o corpo por 30 dias)
           ou é anterior a este recurso. Os dados de envio acima permanecem no histórico.</p>`;
    m.innerHTML = `<div class="modal-caixa" style="max-width:680px;width:96vw">${cab}${corpo}</div>`;
  } catch (e) {
    m.innerHTML = `<div class="modal-caixa" style="max-width:420px">
      <p class="erro">${e.message}</p>
      <button class="btn-mini" onclick="this.closest('.modal-fundo').remove()">Fechar</button></div>`;
  }
}

// ── Log de consultas por QR code (super-admin) ────────────────
// Traduz o user-agent num rótulo curto e diz se parece robô/ferramenta
function lerAgente(ua) {
  const s = String(ua || '');
  if (!s) return { rotulo: 'sem identificação', robo: false };
  const robo = /curl|wget|python|libwww|bot|spider|crawler|headless|monitor|postman|insomnia|okhttp|java\//i.test(s);
  if (/curl/i.test(s)) return { rotulo: '🤖 curl (linha de comando)', robo: true };
  if (/wget/i.test(s)) return { rotulo: '🤖 wget', robo: true };
  if (/python|requests/i.test(s)) return { rotulo: '🤖 script Python', robo: true };
  if (/headless/i.test(s)) return { rotulo: '🤖 navegador automatizado', robo: true };
  if (/bot|spider|crawler/i.test(s)) return { rotulo: '🤖 robô/indexador', robo: true };
  const so = /iPhone|iPad/i.test(s) ? 'iPhone' : /Android/i.test(s) ? 'Android'
    : /Windows/i.test(s) ? 'Windows' : /Mac OS X|Macintosh/i.test(s) ? 'Mac'
    : /X11|Linux/i.test(s) ? 'Linux' : 'outro';
  const nav = /Edg\//i.test(s) ? 'Edge' : /OPR\//i.test(s) ? 'Opera'
    : /Chrome\//i.test(s) ? 'Chrome' : /Firefox\//i.test(s) ? 'Firefox'
    : /Safari\//i.test(s) ? 'Safari' : 'navegador';
  const movel = /iPhone|iPad|Android|Mobile/i.test(s);
  return { rotulo: `${movel ? '📱' : '💻'} ${so} · ${nav}`, robo };
}
function ehRobo(ua) { return lerAgente(ua).robo; }

async function renderConsultaLogSA(filtros = {}) {
  window._saConsultaFiltros = filtros;
  $('#sa-conteudo').innerHTML = '<p class="dica">Carregando…</p>';
  if (_saEmpresasFiltro === null) {
    try { _saEmpresasFiltro = await saApi('/empresas-filtro'); } catch { _saEmpresasFiltro = []; }
  }
  let lista;
  try {
    const p = new URLSearchParams();
    if (filtros.empresa) p.set('empresa', filtros.empresa);
    if (filtros.cliente) p.set('cliente', filtros.cliente);
    if (filtros.de) p.set('de', filtros.de);
    if (filtros.ate) p.set('ate', filtros.ate + 'T23:59:59');
    const q = p.toString();
    lista = await saApi('/consulta-log' + (q ? '?' + q : ''));
  } catch (e) { $('#sa-conteudo').innerHTML = `<p class="erro">${e.message}</p>`; return; }

  const opcoesEmpresa = _saEmpresasFiltro.map(e =>
    `<option value="${e.id}" ${filtros.empresa === e.id ? 'selected' : ''}>${esc(e.razao_social)}</option>`).join('');

  const ORIGEM = { qrcode: '📱 QR code', link: '🔗 Link', portal: '🌐 Portal' };
  const ST_CERT = { emitido: '<span class="badge ok">válido</span>',
    substituido: '<span class="badge">substituído</span>',
    cancelado: '<span class="badge rep">cancelado</span>' };

  const robos = lista.filter(l => ehRobo(l.user_agent)).length;
  const achados = lista.filter(l => l.encontrado).length;
  const ips = new Set(lista.map(l => l.ip)).size;

  const linhas = lista.map(l => {
    const ua = lerAgente(l.user_agent);
    return `
    <tr${ua.robo ? ' style="background:#fbfbfc"' : ''}>
      <td class="dica" style="white-space:nowrap">${dthr(l.consultado_em)}</td>
      <td>${ORIGEM[l.origem] || esc(l.origem)}
        <br><span class="dica" title="${esc(l.user_agent || '')}">${ua.rotulo}</span></td>
      <td>${l.certificado_numero
        ? `<b>${esc(l.certificado_numero)}</b> ${ST_CERT[l.certificado_status] || ''}
           ${l.balanca ? `<br><span class="dica">⚖️ ${esc(l.balanca)}</span>` : ''}`
        : `<span class="badge rep">não encontrado</span>
           ${l.uuid_validacao ? `<br><span class="dica" title="${esc(l.uuid_validacao)}">código ${
             esc(String(l.uuid_validacao).substring(0, 8))}…</span>` : ''}`}</td>
      <td>${l.empresa ? esc(l.empresa) : '<span class="dica">—</span>'}
          ${l.cliente ? `<br><span class="dica">${esc(l.cliente)}</span>` : ''}</td>
      <td class="dica mono">${esc(l.ip || '—')}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="5" class="dica">Nenhuma consulta no período.</td></tr>';

  const kpis = !lista.length ? '' : `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 4px">
      <div style="flex:1;min-width:120px;background:#f7f9fb;border:1px solid #dde5ec;border-radius:10px;padding:8px 12px">
        <span class="dica">Consultas</span><br><b style="font-size:1.15rem">${lista.length}</b></div>
      <div style="flex:1;min-width:120px;background:#eef7f0;border:1px solid #cfe5d6;border-radius:10px;padding:8px 12px">
        <span class="dica">Certificado localizado</span><br>
        <b style="font-size:1.15rem;color:#146c43">${achados}</b></div>
      <div style="flex:1;min-width:120px;background:#fdf6ea;border:1px solid #ecdcc0;border-radius:10px;padding:8px 12px">
        <span class="dica">Código não encontrado</span><br>
        <b style="font-size:1.15rem;color:#c88a00">${lista.length - achados}</b></div>
      <div style="flex:1;min-width:120px;background:#f7f9fb;border:1px solid #dde5ec;border-radius:10px;padding:8px 12px">
        <span class="dica">Robôs/ferramentas</span><br><b style="font-size:1.15rem">${robos}</b></div>
      <div style="flex:1;min-width:120px;background:#f7f9fb;border:1px solid #dde5ec;border-radius:10px;padding:8px 12px">
        <span class="dica">IPs distintos</span><br><b style="font-size:1.15rem">${ips}</b></div>
    </div>`;

  $('#sa-conteudo').innerHTML = `
    <div class="barra">
      <h2>🔍 Consultas por QR code</h2>
      <div class="barra-btns"><button onclick="renderPainelSA()">← Empresas</button></div>
    </div>
    <div class="card" style="padding:16px 18px">
      <p class="dica">Cada linha é um acesso ao certificado pelo QR code ou link público — evidência de que o cliente consultou o documento.</p>
      ${kpis}
      <div class="filtros-login">
        <label>Empresa
          <select id="fc-empresa" onchange="carregarClientesFiltroSA('fc-empresa','fc-cliente')"><option value="">Todas</option>${opcoesEmpresa}</select>
        </label>
        <label>Cliente
          <select id="fc-cliente"><option value="">Todos</option></select>
        </label>
        <label>De <input type="date" id="fc-de" value="${filtros.de || ''}"></label>
        <label>Até <input type="date" id="fc-ate" value="${filtros.ate || ''}"></label>
        <button class="btn-primario" onclick="aplicarFiltroConsulta()">Filtrar</button>
        <button class="btn-mini" onclick="renderConsultaLogSA()">Limpar</button>
      </div>
      <div style="overflow-x:auto;margin-top:10px">
        <table class="tab-sa">
          <thead><tr><th>Quando</th><th>Origem</th><th>Certificado</th><th>Empresa/Cliente</th><th>IP</th></tr></thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>
      <p class="dica" style="margin-top:8px">${lista.length} consulta(s) — máximo 500.</p>
    </div>`;
}

function aplicarFiltroConsulta() {
  renderConsultaLogSA({
    empresa: $('#fc-empresa').value, cliente: $('#fc-cliente').value,
    de: $('#fc-de').value, ate: $('#fc-ate').value
  });
}

// Carrega os clientes de uma empresa no seletor de filtro (email/consulta)
async function carregarClientesFiltroSA(idEmpresa, idCliente) {
  const empresa = $('#' + idEmpresa)?.value;
  const sel = $('#' + idCliente);
  if (!sel) return;
  sel.innerHTML = '<option value="">Todos</option>';
  if (!empresa) return;
  try {
    const cs = await saApi('/clientes-filtro?empresa=' + empresa);
    sel.innerHTML = '<option value="">Todos</option>' +
      cs.map(c => `<option value="${c.id}">${esc(c.razao_social)}</option>`).join('');
  } catch { /* silencioso */ }
}

// ═══════ Log robusto de usuários (cadastro + atividade) ═══════
let _abaUsuariosLog = 'cadastro';

async function renderUsuariosLogSA(aba) {
  if (aba) _abaUsuariosLog = aba;
  if (_saEmpresasFiltro === null) {
    try { _saEmpresasFiltro = await saApi('/empresas-filtro'); } catch { _saEmpresasFiltro = []; }
  }
  const opcoesEmpresa = _saEmpresasFiltro.map(e =>
    `<option value="${e.id}">${esc(e.razao_social)}</option>`).join('');

  const abaCad = _abaUsuariosLog === 'cadastro';
  $('#sa-conteudo').innerHTML = `
    <div class="barra">
      <h2>👥 Log de usuários</h2>
      <div class="barra-btns"><button onclick="renderPainelSA()">← Empresas</button></div>
    </div>
    <div class="tabs-ulog">
      <button class="${abaCad ? 'ativo' : ''}" onclick="renderUsuariosLogSA('cadastro')">📋 Cadastro de usuários</button>
      <button class="${!abaCad ? 'ativo' : ''}" onclick="renderUsuariosLogSA('atividade')">📊 Histórico de atividade</button>
    </div>
    <div class="card" style="padding:16px 18px">
      <div class="filtros-login" id="ulog-filtros"></div>
      <div id="ulog-conteudo"><p class="dica">Carregando…</p></div>
    </div>`;

  if (abaCad) montarFiltrosCadastro(opcoesEmpresa);
  else montarFiltrosAtividade(opcoesEmpresa);
}

function montarFiltrosCadastro(opcoesEmpresa) {
  $('#ulog-filtros').innerHTML = `
    <label>Buscar (nome ou e-mail) <input type="text" id="ul-busca" placeholder="🔍"></label>
    <label>Empresa <select id="ul-empresa"><option value="">Todas</option>${opcoesEmpresa}</select></label>
    <label>Papel <select id="ul-papel">
      <option value="">Todos</option>
      <option value="admin">Administrador</option>
      <option value="responsavel_tecnico">Responsável Técnico</option>
      <option value="tecnico">Técnico</option>
    </select></label>
    <label>Status <select id="ul-ativo">
      <option value="">Todos</option><option value="true">Ativos</option><option value="false">Inativos</option>
    </select></label>
    <button class="btn-primario" onclick="carregarCadastroUsuarios()">Filtrar</button>
    <button class="btn-mini" onclick="exportarCadastroUsuarios('csv')">⬇️ CSV</button>
    <button class="btn-mini" onclick="exportarCadastroUsuarios('pdf')">📄 PDF</button>`;
  carregarCadastroUsuarios();
}

function filtrosCadastroQS() {
  const p = new URLSearchParams();
  const b = $('#ul-busca')?.value.trim(); if (b) p.set('busca', b);
  const e = $('#ul-empresa')?.value; if (e) p.set('empresa', e);
  const pa = $('#ul-papel')?.value; if (pa) p.set('papel', pa);
  const a = $('#ul-ativo')?.value; if (a) p.set('ativo', a);
  return p.toString();
}

async function carregarCadastroUsuarios() {
  const box = $('#ulog-conteudo');
  box.innerHTML = '<p class="dica">Carregando…</p>';
  try {
    const qs = filtrosCadastroQS();
    const lista = await saApi('/usuarios-log' + (qs ? '?' + qs : ''));
    const linhas = lista.map(u => `
      <tr>
        <td><b>${esc(u.nome)}</b><br><span class="dica">${esc(u.email)}</span></td>
        <td>${PAPEL_ROTULO[u.papel] || u.papel}</td>
        <td>${esc(u.empresa)}</td>
        <td>${u.ativo ? '<span class="badge ok">Ativo</span>' : '<span class="badge rep">Inativo</span>'}</td>
        <td class="dica">${dthr(u.criado_em)}</td>
        <td class="dica">${u.ultimo_login ? dthr(u.ultimo_login) : '—'}</td>
        <td class="num">${u.total_logins}</td>
        <td class="num">${u.certificados_emitidos}</td>
      </tr>`).join('') || '<tr><td colspan="8" class="dica">Nenhum usuário.</td></tr>';
    box.innerHTML = `
      <div style="overflow-x:auto">
        <table class="tab-sa">
          <thead><tr><th>Usuário</th><th>Papel</th><th>Empresa</th><th>Status</th>
            <th>Criado</th><th>Último login</th><th>Logins</th><th>Certif.</th></tr></thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>
      <p class="dica" style="margin-top:8px">${lista.length} usuário(s).</p>`;
  } catch (e) { box.innerHTML = `<p class="erro">${e.message}</p>`; }
}

function exportarCadastroUsuarios(formato) {
  const qs = filtrosCadastroQS();
  const sep = qs ? '&' : '';
  const base = '/api/sa/usuarios-log/exportar' + (qs ? '?' + qs : '');
  baixarComToken(base + (qs ? '&' : '?') + 'formato=' + (formato || 'csv'));
}

function montarFiltrosAtividade(opcoesEmpresa) {
  $('#ulog-filtros').innerHTML = `
    <label>Buscar (nome ou e-mail) <input type="text" id="ua-busca" placeholder="🔍"></label>
    <label>Empresa <select id="ua-empresa"><option value="">Todas</option>${opcoesEmpresa}</select></label>
    <label>Ação <select id="ua-acao">
      <option value="">Todas</option>
      <option value="login_ok">Login</option>
      <option value="login_falha">Login (falha)</option>
      <option value="insert">Criação</option>
      <option value="update">Alteração</option>
      <option value="delete">Exclusão</option>
      <option value="emissao">Emissão</option>
      <option value="visualizar_super_admin">Visualização (super-admin)</option>
    </select></label>
    <label>De <input type="date" id="ua-de"></label>
    <label>Até <input type="date" id="ua-ate"></label>
    <button class="btn-primario" onclick="carregarAtividadeUsuarios()">Filtrar</button>
    <button class="btn-mini" onclick="exportarAtividadeUsuarios('csv')">⬇️ CSV</button>
    <button class="btn-mini" onclick="exportarAtividadeUsuarios('pdf')">📄 PDF</button>`;
  carregarAtividadeUsuarios();
}

function filtrosAtividadeQS() {
  const p = new URLSearchParams();
  const b = $('#ua-busca')?.value.trim(); if (b) p.set('busca', b);
  const e = $('#ua-empresa')?.value; if (e) p.set('empresa', e);
  const a = $('#ua-acao')?.value; if (a) p.set('acao', a);
  const de = $('#ua-de')?.value; if (de) p.set('de', de);
  const ate = $('#ua-ate')?.value; if (ate) p.set('ate', ate + 'T23:59:59');
  return p.toString();
}

const ACAO_ROTULO = {
  login_ok: '🔑 Login', login_falha: '⚠️ Login (falha)', login_bloqueado: '🚫 Login bloqueado',
  insert: '➕ Criação', update: '✏️ Alteração',
  delete: '🗑️ Exclusão', emissao: '📄 Emissão', emitir: '📄 Emissão',
  criar_revisao: '🔄 Revisão', edicao_manual: '✏️ Edição manual', reprovar: '❌ Reprovação',
  consulta_manutencao_sa: '🗂 Consulta de manutenção (super-admin)',
  consulta_clientes_sa: '👥 Consulta de clientes (super-admin)',
  consulta_balancas_sa: '⚖️ Consulta de balanças (super-admin)',
  consulta_acessos_portal_sa: '🌐 Consulta de acessos do portal (super-admin)',
  editar_responsaveis: '👤 Troca de técnico/RT',
  enviar_aprovacao: '📤 Envio p/ aprovação', faixas: '📊 Faixas',
  troca_senha: '🔑 Troca de senha', reset_senha: '🔑 Reset de senha',
  enviar_convite: '✉️ Convite', inativar: '🚫 Inativação',
  upload_certificado: '📎 Upload', visualizar_super_admin: '👁 Visualização (SA)'
};

async function carregarAtividadeUsuarios() {
  const box = $('#ulog-conteudo');
  box.innerHTML = '<p class="dica">Carregando…</p>';
  try {
    const qs = filtrosAtividadeQS();
    const lista = await saApi('/atividade-log' + (qs ? '?' + qs : ''));
    const linhas = lista.map(a => `
      <tr>
        <td class="dica" style="white-space:nowrap">${dthr(a.ocorrido_em)}</td>
        <td>${ACAO_ROTULO[a.acao] || esc(a.acao)}</td>
        <td class="dica">${esc(a.entidade || '—')}</td>
        <td>${a.nome ? `<b>${esc(a.nome)}</b><br><span class="dica">${esc(a.email || '')}</span>` : '<span class="dica">—</span>'}</td>
        <td>${a.empresa ? esc(a.empresa) : '<span class="dica">—</span>'}</td>
        <td class="dica">${esc(a.ip || '—')}</td>
      </tr>`).join('') || '<tr><td colspan="6" class="dica">Nenhuma atividade no período.</td></tr>';
    box.innerHTML = `
      <div style="overflow-x:auto">
        <table class="tab-sa">
          <thead><tr><th>Quando</th><th>Ação</th><th>Entidade</th><th>Usuário</th><th>Empresa</th><th>IP</th></tr></thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>
      <p class="dica" style="margin-top:8px">${lista.length} registro(s) — máximo 1000 na tela (a exportação traz até 5000).</p>`;
  } catch (e) { box.innerHTML = `<p class="erro">${e.message}</p>`; }
}

function exportarAtividadeUsuarios(formato) {
  const qs = filtrosAtividadeQS();
  const base = '/api/sa/atividade-log/exportar' + (qs ? '?' + qs : '');
  baixarComToken(base + (qs ? '&' : '?') + 'formato=' + (formato || 'csv'));
}

// Baixa um arquivo autenticado (envia o token no header e força download)
async function baixarComToken(url) {
  try {
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) { toast('Falha ao exportar', 'erro'); return; }
    const blob = await r.blob();
    // pega o nome do arquivo do header, se houver
    let nome = 'export.csv';
    const cd = r.headers.get('Content-Disposition');
    const m = cd && cd.match(/filename="?([^"]+)"?/);
    if (m) nome = m[1];
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = nome;
    document.body.appendChild(link); link.click(); link.remove();
    URL.revokeObjectURL(link.href);
    toast('Exportado ✓', 'ok');
  } catch (e) { toast(e.message, 'erro'); }
}

async function verUsuarioSA(id) {
  let d;
  try { d = await saApi('/usuarios/' + id + '/detalhe'); }
  catch (e) { toast(e.message || 'Não foi possível carregar o usuário.', 'erro'); return; }
  if (!d) { toast('Usuário não encontrado.', 'erro'); return; }
  const modal = `
    <div class="modal-fundo" onclick="if(event.target===this)this.remove()">
      <div class="modal-caixa" style="max-width:480px">
        <h3>👤 ${esc(d.nome)}</h3>
        <table style="width:100%;font-size:.9rem;margin-top:10px">
          <tr><td class="dica" style="width:140px">E-mail</td><td><b>${esc(d.email)}</b></td></tr>
          <tr><td class="dica">Papel</td><td>${PAPEL_ROTULO[d.papel] || d.papel}</td></tr>
          <tr><td class="dica">Situação</td><td>${d.ativo ? '<span class="badge ok">Ativo</span>' : '<span class="badge rep">Bloqueado</span>'}</td></tr>
          <tr><td class="dica">Empresa</td><td>${esc(d.empresa || '—')}</td></tr>
          <tr><td class="dica">CNPJ</td><td>${esc(d.empresa_cnpj || '—')}</td></tr>
          <tr><td class="dica">Status empresa</td><td>${esc(d.empresa_status || '—')}</td></tr>
          <tr><td class="dica">Cadastrado em</td><td>${dthr(d.criado_em)}</td></tr>
          <tr><td class="dica">Último login</td><td>${d.ultimo_login ? dthr(d.ultimo_login) : 'nunca'}</td></tr>
          <tr><td class="dica">Total de logins</td><td>${d.total_logins}</td></tr>
        </table>
        <div class="rodape-acoes" style="margin-top:14px">
          <button onclick="this.closest('.modal-fundo').remove()">Fechar</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', modal);
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
      <td>${er.resolvido ? '<span class="badge ok">Resolvido</span>' : '<span class="badge rep">Aberto</span>'}
        ${er.correcao ? `<br><span class="dica" title="${esc(er.correcao)}">🔧 ${esc(
            String(er.correcao).length > 40 ? String(er.correcao).substring(0, 40) + '…' : er.correcao)}</span>` : ''}
        ${er.corrigido_em ? `<br><span class="dica">${dbrSA(er.corrigido_em)}</span>` : ''}</td>
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
      <button class="btn-mini" onclick="exportarErros('copiar')">📋 Copiar para análise</button>
      <button class="btn-mini" onclick="exportarErros('baixar')">⬇ Baixar .txt</button>
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

// Exporta os erros abertos num texto estruturado, pronto para análise
async function exportarErros(modo) {
  let g;
  try { g = await saApi('/erros/exportar?horas=168'); }
  catch (e) { toast(e.message, 'erro'); return; }
  if (!g.length) { toast('Nenhum erro aberto nos últimos 7 dias. 🎉', 'ok'); return; }

  const agora = new Date().toLocaleString('pt-BR');
  const linhas = [
    '=== TSCert — ERROS ABERTOS (últimos 7 dias) ===',
    'Exportado em: ' + agora,
    'Grupos: ' + g.length + ' · Ocorrências: ' + g.reduce((s, x) => s + Number(x.qtd), 0),
    ''
  ];
  g.forEach((x, i) => {
    linhas.push(`--- [${i + 1}] ${x.qtd}x · ${x.tipo} ---`);
    linhas.push(`rota: ${x.metodo || ''} ${x.rota}`.trim() +
      (Number(x.rotas_distintas) > 1 ? `  (${x.rotas_distintas} URLs distintas)` : ''));
    linhas.push(`mensagem: ${x.mensagem || '(sem mensagem)'}`);
    linhas.push(`primeiro: ${new Date(x.primeiro).toLocaleString('pt-BR')} · último: ${
      new Date(x.ultimo).toLocaleString('pt-BR')}`);
    if (x.empresas) linhas.push(`empresas afetadas: ${x.empresas}`);
    linhas.push(`ids: {${(x.ids || []).join(',')}}`);
    if (x.detalhe_exemplo) {
      const det = String(x.detalhe_exemplo).split('\n').slice(0, 14).join('\n');
      linhas.push('detalhe (exemplo, 14 primeiras linhas):');
      linhas.push(det);
    }
    linhas.push('');
  });
  linhas.push('=== FIM ===');
  const texto = linhas.join('\n');

  if (modo === 'baixar') {
    const blob = new Blob(['\ufeff' + texto], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tscert-erros-${new Date().toISOString().substring(0, 10)}.txt`;
    document.body.appendChild(a); a.click(); a.remove();
    toast('Arquivo gerado — anexe no chat para análise.', 'ok', 5000);
    return;
  }
  try {
    await navigator.clipboard.writeText(texto);
    toast(`${g.length} grupo(s) de erro copiados — cole no chat para análise.`, 'ok', 6000);
  } catch (e) {
    // sem permissão de área de transferência: mostra num modal para copiar à mão
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal-fundo" onclick="if(event.target===this)this.remove()">
        <div class="modal-caixa" style="max-width:760px">
          <h3>📋 Erros para análise</h3>
          <p class="dica">Selecione tudo (Ctrl+A dentro da caixa) e copie.</p>
          <textarea readonly style="width:100%;height:340px;font-family:monospace;font-size:11px;
            border:1px solid #dde5ec;border-radius:8px;padding:10px">${esc(texto)}</textarea>
          <div class="rodape-acoes" style="margin-top:10px">
            <button onclick="this.closest('.modal-fundo').remove()">Fechar</button>
          </div>
        </div>
      </div>`);
  }
}

function verDetalheErro(id) {
  const el = document.getElementById('erro-det-' + id);
  if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
}

async function resolverErro(id, resolvido) {
  let correcao = null;
  if (resolvido) {
    correcao = prompt('O que foi feito para corrigir? (fica registrado no histórico)\n' +
      'Ex.: "app.js: cobStatus promovido a global — o cronograma voltou a abrir"');
    if (correcao === null) return;   // cancelou
  }
  try {
    await saApi('/erros/' + id + '/resolver',
      { method: 'PUT', body: JSON.stringify({ resolvido, correcao }) });
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
      <h2>📈 Faturamento</h2>
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
      <h3 style="margin-top:0">Entradas do mês por empresa</h3>
      <div class="barra-btns" style="margin-bottom:8px;align-items:center">
        <button class="btn-mini" onclick="finEntradasMes--;carregarEntradasMes()">‹ mês anterior</button>
        <span class="dica" id="fin-entradas-mes" style="min-width:130px;text-align:center"></span>
        <button class="btn-mini" onclick="if(finEntradasMes<0){finEntradasMes++;carregarEntradasMes()}">próximo ›</button>
      </div>
      <div id="fin-entradas"><p class="dica">Carregando…</p></div>
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
  finEntradasMes = 0;
  carregarEntradasMes();
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
    <div class="card" style="margin-bottom:14px">
      <h3 style="margin-top:0">📉 Uso no período</h3>
      <div class="barra-btns" style="flex-wrap:wrap;align-items:center;margin-bottom:8px">
        <select id="uso-emp" onchange="carregarUsoPeriodo()"
          style="width:auto;max-width:230px;padding:4px 6px;border:1px solid #dde5ec;border-radius:7px;font:inherit;font-size:.82rem">
          <option value="">🏢 todas as empresas</option>
          ${(window._saEmpresas || []).map(e2 =>
            `<option value="${e2.id}">${esc(e2.razao_social)}</option>`).join('')}
        </select>
        <input type="date" id="uso-de" onchange="if(this.value)carregarUsoPeriodo()"
          style="width:auto;max-width:145px;padding:4px 6px;border:1px solid #dde5ec;border-radius:7px;font:inherit;font-size:.82rem">
        <span class="dica">até</span>
        <input type="date" id="uso-ate" onchange="if(this.value)carregarUsoPeriodo()"
          style="width:auto;max-width:145px;padding:4px 6px;border:1px solid #dde5ec;border-radius:7px;font:inherit;font-size:.82rem">
        <select id="uso-grupo" onchange="carregarUsoPeriodo()"
          style="width:auto;padding:4px 6px;border:1px solid #dde5ec;border-radius:7px;font:inherit;font-size:.82rem">
          <option value="">agrupar: automático</option>
          <option value="dia">por dia</option>
          <option value="semana">por semana</option>
          <option value="mes">por mês</option>
        </select>
        <span class="dica" id="uso-delta" style="margin-left:auto"></span>
      </div>
      <div id="uso-grafico"><p class="dica">Carregando…</p></div>
      <div id="uso-tabela"></div>
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
  usoPeriodoPadrao();
  carregarUsoPeriodo();
}

// ── WIZARD de nova empresa: cadastro COMPLETO em 4 passos ─────
function formNovaEmpresa() {
  window._wizEmp = { passo: 1, avaliacao: true };
  const modal = `
    <div class="modal-fundo" id="wiz-empresa">
      <div class="modal-caixa" style="max-width:560px">
        <h3 id="wiz-titulo">Nova empresa</h3>
        <div id="wiz-passos" style="display:flex;gap:6px;margin:6px 0 14px">
          ${[1, 2, 3, 4].map(n => `<div id="wiz-p${n}" style="flex:1;height:6px;border-radius:99px;background:#dde5ec"></div>`).join('')}
        </div>
        <div id="wiz-corpo"></div>
        <div class="rodape-acoes" style="margin-top:14px">
          <button id="wiz-voltar" onclick="wizEmpresaNav(-1)">← Voltar</button>
          <span style="flex:1"></span>
          <button onclick="document.getElementById('wiz-empresa').remove()">Cancelar</button>
          <button class="btn-primario" id="wiz-avancar" onclick="wizEmpresaNav(1)">Avançar →</button>
        </div>
        <p id="wiz-erro" class="erro"></p>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', modal);
  wizEmpresaRender();
}

// Guarda os valores digitados do passo atual antes de navegar
function wizEmpresaColeta() {
  const w = window._wizEmp;
  const v = id => document.getElementById(id)?.value.trim() ?? w[id.replace('we-', '')] ?? '';
  if (w.passo === 1) {
    w.cnpj = v('we-cnpj'); w.razao = v('we-razao'); w.autorizacao = v('we-autorizacao');
    w.sub = v('we-sub').toLowerCase(); w.prefixo = v('we-prefixo').toUpperCase();
    const rad = document.querySelector('input[name="we-tipo"]:checked');
    if (rad) w.avaliacao = rad.value === 'avaliacao';
  } else if (w.passo === 2) {
    w.endereco = v('we-endereco'); w.cep = v('we-cep'); w.cidadeuf = v('we-cidadeuf');
    w.fantasia = v('we-fantasia');
    w.fone = v('we-fone'); w.email = v('we-email');
  } else if (w.passo === 3) {
    w.repNome = v('we-rep-nome'); w.repCpf = v('we-rep-cpf');
    w.ctNome = v('we-ct-nome'); w.ctCargo = v('we-ct-cargo');
    w.ctEmail = v('we-ct-email'); w.ctFone = v('we-ct-fone');
    w.admNome = v('we-adm-nome'); w.admEmail = v('we-adm-email');
  }
}

function wizEmpresaNav(dir) {
  const w = window._wizEmp;
  const erro = $('#wiz-erro'); erro.textContent = '';
  wizEmpresaColeta();
  if (dir > 0) {
    // validação do passo atual
    const falta = [];
    if (w.passo === 1) {
      if (!w.cnpj) falta.push('CNPJ');
      if (!w.razao) falta.push('Razão social');
      if (!w.sub) falta.push('Subdomínio');
      if (!w.prefixo) falta.push('Prefixo do certificado');
    } else if (w.passo === 2) {
      // Cidade/UF é obrigatória SEMPRE — alimenta o mapa e o cadastro.
      const ufs = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA',
        'PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
      const mUf = /^(.{2,})\/([A-Za-z]{2})$/.exec((w.cidadeuf || '').trim());
      if (!w.cidadeuf) falta.push('Cidade/UF');
      else if (!mUf || !ufs.includes(mUf[2].toUpperCase()))
        falta.push('Cidade/UF no formato "Cidade/UF" (ex: Contagem/MG)');
      // Em avaliação, endereço/contato ficam para depois — a validação dura
      // do "📄 Contrato" cobra tudo na hora certa.
      if (!w.avaliacao) {
        if (!w.endereco) falta.push('Endereço');
        if (!w.cep) falta.push('CEP');
        if (!w.email) falta.push('E-mail da empresa');
      }
    } else if (w.passo === 3) {
      if (!w.avaliacao) {
        if (!w.repNome) falta.push('Representante legal (nome)');
        if (!w.repCpf) falta.push('CPF do representante');
      }
      if (!w.admNome) falta.push('Nome do administrador');
      if (!w.admEmail) falta.push('E-mail do administrador');
    }
    if (falta.length) { erro.textContent = 'Preencha: ' + falta.join(', ') + '.'; return; }
    if (w.passo === 4) { concluirWizardEmpresa(); return; }
    w.passo++;
  } else if (w.passo > 1) w.passo--;
  wizEmpresaRender();
}

function wizEmpresaRender() {
  const w = window._wizEmp;
  const e = s => esc(s || '');
  [1, 2, 3, 4].forEach(n =>
    document.getElementById('wiz-p' + n).style.background = n <= w.passo ? 'var(--primaria, #2563eb)' : '#dde5ec');
  $('#wiz-voltar').style.visibility = w.passo === 1 ? 'hidden' : 'visible';
  $('#wiz-avancar').textContent = w.passo === 4 ? '✅ Criar empresa' : 'Avançar →';

  const titulos = { 1: 'Passo 1 de 4 — Identificação', 2: 'Passo 2 de 4 — Endereço e contato',
    3: 'Passo 3 de 4 — Pessoas', 4: 'Passo 4 de 4 — Revisão' };
  $('#wiz-titulo').textContent = '🏢 Nova empresa · ' + titulos[w.passo];

  let html = '';
  if (w.passo === 1) html = `
    <div class="form-grid">
      <label>CNPJ *
        <div style="display:flex;gap:6px">
          <input type="text" id="we-cnpj" value="${e(w.cnpj)}" placeholder="00.000.000/0000-00" style="flex:1">
          <button type="button" class="btn-mini" onclick="wizBuscarCnpj()" title="Busca os dados na Receita e preenche o cadastro">🔍 Buscar</button>
        </div></label>
      <label>Razão social * <input type="text" id="we-razao" value="${e(w.razao)}"></label>
      <label>Autorização Inmetro <input type="text" id="we-autorizacao" value="${e(w.autorizacao)}" placeholder="ex.: 20000077"></label>
      <label>Subdomínio * <input type="text" id="we-sub" value="${e(w.sub)}" placeholder="ex.: acme"></label>
      <label>Prefixo do certificado * <input type="text" id="we-prefixo" value="${e(w.prefixo)}" placeholder="ex.: AC" maxlength="6"></label>
    </div>
    <div style="background:#f7f9fb;border:1px solid #dde5ec;border-radius:10px;padding:10px 12px;margin-top:12px">
      <b style="font-size:14px">Tipo de cadastro</b>
      <label style="display:block;margin-top:6px;font-weight:400">
        <input type="radio" name="we-tipo" value="avaliacao" ${w.avaliacao ? 'checked' : ''}
          onchange="wizEmpresaColeta();wizEmpresaRender()">
        🧪 <b>Período de avaliação</b> — 30 dias para testar
        <span class="dica" style="display:block;margin-left:22px">só o essencial agora;
          endereço e representante legal podem ser preenchidos depois</span></label>
      <label style="display:block;margin-top:6px;font-weight:400">
        <input type="radio" name="we-tipo" value="contrato" ${w.avaliacao ? '' : 'checked'}
          onchange="wizEmpresaColeta();wizEmpresaRender()">
        📄 <b>Cliente contratado</b> — vai fechar contrato
        <span class="dica" style="display:block;margin-left:22px">preenche tudo agora e o contrato
          já sai completo</span></label>
    </div>
    <p class="dica" id="we-cnpj-msg">💡 Digite o CNPJ e clique em 🔍 Buscar — razão social, endereço e contato
      são preenchidos automaticamente pela Receita Federal.</p>`;
  else if (w.passo === 2) html = `
    <div class="form-grid">
      <label>Endereço (rua, nº, bairro) ${w.avaliacao ? '' : '*'} <input type="text" id="we-endereco" value="${e(w.endereco)}"></label>
      <label>CEP ${w.avaliacao ? '' : '*'} <input type="text" id="we-cep" value="${e(w.cep)}"></label>
      <label>Nome fantasia <input type="text" id="we-fantasia" value="${e(w.fantasia)}" placeholder="Como a empresa é conhecida"></label>
      <label>Cidade/UF * <input type="text" id="we-cidadeuf" value="${e(w.cidadeuf)}" placeholder="Contagem/MG"></label>
      <label>Telefone <input type="text" id="we-fone" value="${e(w.fone)}"></label>
      <label>E-mail da empresa ${w.avaliacao ? '' : '*'} <input type="email" id="we-email" value="${e(w.email)}"></label>
    </div>
    <p class="dica">Estes dados saem no certificado e no contrato de fornecimento.${
      w.avaliacao ? ' <b>Em avaliação são opcionais</b> — dá para preencher depois em "Dados e plano".' : ''}</p>`;
  else if (w.passo === 3) html = `
    <p class="dica" style="margin-bottom:6px"><b>Representante legal</b> (assina o contrato)${
      w.avaliacao ? ' — <b>opcional em avaliação</b>' : ''}</p>
    <div class="form-grid">
      <label>Nome completo ${w.avaliacao ? '' : '*'} <input type="text" id="we-rep-nome" value="${e(w.repNome)}"></label>
      <label>CPF ${w.avaliacao ? '' : '*'} <input type="text" id="we-rep-cpf" value="${e(w.repCpf)}" placeholder="000.000.000-00"></label>
    </div>
    <p class="dica" style="margin:10px 0 6px"><b>Contato de referência</b> (opcional — comercial/financeiro)</p>
    <div class="form-grid">
      <label>Nome <input type="text" id="we-ct-nome" value="${e(w.ctNome)}"></label>
      <label>Cargo <input type="text" id="we-ct-cargo" value="${e(w.ctCargo)}" placeholder="Ex.: Financeiro"></label>
      <label>E-mail <input type="email" id="we-ct-email" value="${e(w.ctEmail)}"></label>
      <label>Telefone <input type="text" id="we-ct-fone" value="${e(w.ctFone)}"></label>
    </div>
    <p class="dica" style="margin:10px 0 6px"><b>Administrador do sistema</b> (recebe o convite por e-mail)</p>
    <div class="form-grid">
      <label>Nome * <input type="text" id="we-adm-nome" value="${e(w.admNome)}"></label>
      <label>E-mail * <input type="email" id="we-adm-email" value="${e(w.admEmail)}"></label>
    </div>`;
  else html = `
    <div style="line-height:1.9">
      <p><b>🏢 ${e(w.razao)}</b> · CNPJ ${e(w.cnpj)}${w.autorizacao ? ' · Aut. Inmetro ' + e(w.autorizacao) : ''}</p>
      <p class="dica">Subdomínio <b>${e(w.sub)}</b> · Prefixo <b>${e(w.prefixo)}</b></p>
      <p>📍 ${e(w.endereco)}, ${e(w.cidadeuf)}, CEP ${e(w.cep)}</p>
      <p>📞 ${e(w.fone) || '—'} · ✉️ ${e(w.email)}</p>
      <p>✍️ Representante legal: <b>${e(w.repNome)}</b> (CPF ${e(w.repCpf)})</p>
      ${w.ctNome ? `<p>👥 Contato: ${e(w.ctNome)}${w.ctCargo ? ' (' + e(w.ctCargo) + ')' : ''} · ${e(w.ctEmail) || '—'} · ${e(w.ctFone) || '—'}</p>` : ''}
      <p>🔑 Administrador: <b>${e(w.admNome)}</b> · ${e(w.admEmail)}
        <span class="dica">(receberá o convite para definir a senha)</span></p>
    </div>
    ${w.avaliacao ? `
      <p class="dica" style="background:#fdf6ea;border:1px solid #ecdcc0;border-radius:8px;padding:8px 10px;margin-top:10px">
        🧪 <b>Período de avaliação (30 dias).</b> ${
          [!w.endereco, !w.cep, !w.cidadeuf, !w.email, !w.repNome].some(Boolean)
          ? 'Pendências para o contrato: ' +
            [!w.endereco && 'endereço', !w.cep && 'CEP', !w.cidadeuf && 'cidade/UF',
             !w.email && 'e-mail da empresa', !w.repNome && 'representante legal']
              .filter(Boolean).join(', ') + ' — complete em "Dados e plano" antes de gerar o contrato.'
          : 'Os dados de contrato já estão completos.'}</p>` : ''}
    <p class="dica" style="margin-top:10px">Confira tudo — depois de criada, os dados podem ser
      ajustados em "Dados e plano". ${w.avaliacao
        ? 'A empresa começa em avaliação; quando fechar negócio, crie o <b>contrato</b>.'
        : 'O próximo passo natural é criar o <b>contrato</b> da empresa.'}</p>`;
  $('#wiz-corpo').innerHTML = html;
}

// Busca na BrasilAPI e preenche identificação + endereço + contato
async function wizBuscarCnpj() {
  const w = window._wizEmp;
  const cnpj = ($('#we-cnpj').value || '').replace(/\D/g, '');
  const msg = $('#we-cnpj-msg');
  if (cnpj.length !== 14) { msg.textContent = '⚠️ CNPJ inválido — digite os 14 dígitos.'; return; }
  msg.textContent = '⏳ Buscando na Receita Federal…';
  try {
    const r = await fetch('https://brasilapi.com.br/api/cnpj/v1/' + cnpj);
    if (!r.ok) throw new Error('CNPJ não encontrado na base da Receita.');
    const d = await r.json();
    $('#we-razao').value = d.razao_social || '';
    w.endereco = [d.logradouro, d.numero, d.bairro].filter(Boolean).join(', ');
    w.cep = d.cep ? String(d.cep).replace(/^(\d{5})(\d{3})$/, '$1-$2') : '';
    w.cidadeuf = d.municipio && d.uf ? `${d.municipio}/${d.uf}` : '';
    w.fone = d.ddd_telefone_1 ? `(${String(d.ddd_telefone_1).substring(0, 2)}) ${String(d.ddd_telefone_1).substring(2)}` : '';
    w.email = (d.email || '').toLowerCase();
    // sugestões de subdomínio/prefixo a partir da razão social
    if (!$('#we-sub').value && d.razao_social) {
      const s = d.razao_social.toLowerCase().normalize('NFD').replace(/[^a-z0-9 ]/g, '')
        .trim().split(/\s+/)[0];
      $('#we-sub').value = s.substring(0, 12);
      $('#we-prefixo').value = s.substring(0, 3).toUpperCase();
    }
    msg.textContent = '✅ Dados da Receita preenchidos — endereço e contato já vão aparecer no passo 2. Confira e ajuste o que precisar.';
  } catch (e) { msg.textContent = '⚠️ ' + (e.message || 'Falha na busca — preencha manualmente.'); }
}

// Cria a empresa e aplica todos os dados complementares
async function concluirWizardEmpresa() {
  const w = window._wizEmp;
  const erro = $('#wiz-erro');
  const btn = $('#wiz-avancar');
  btn.disabled = true; btn.textContent = '⏳ Criando…';
  let r;
  try {
    r = await saApi('/empresas', { method: 'POST', body: JSON.stringify({
      razaoSocial: w.razao, cnpj: w.cnpj, subdominio: w.sub, prefixoCert: w.prefixo,
      plano: 'trial', limiteUsuarios: 0, adminNome: w.admNome, adminEmail: w.admEmail
    })});
  } catch (e) {
    erro.textContent = e.message || 'Não foi possível criar a empresa.';
    btn.disabled = false; btn.textContent = '✅ Criar empresa';
    return;
  }
  // Dados complementares: falha aqui NÃO desfaz a criação — avisa para completar depois
  const pendencias = [];
  try {
    await saApi('/empresas/' + r.id + '/dados-contato', { method: 'PUT', body: JSON.stringify({
      endereco: w.endereco || null, cep: w.cep || null, cidadeUf: w.cidadeuf || null,
      telefone: w.fone || null, email: w.email || null }) });
  } catch (e) { pendencias.push('endereço/contato'); }
  if (w.fantasia) {
    try {
      await saApi('/empresas/' + r.id + '/nome-fantasia', { method: 'PUT',
        body: JSON.stringify({ nome: w.fantasia }) });
    } catch (e) { pendencias.push('nome fantasia'); }
  }
  try {
    await saApi('/empresas/' + r.id + '/rep-legal', { method: 'PUT',
      body: JSON.stringify({ nome: w.repNome || null, cpf: w.repCpf || null }) });
  } catch (e) { pendencias.push('representante legal'); }
  if (w.autorizacao) {
    try {
      await saApi('/empresas/' + r.id, { method: 'PUT', body: JSON.stringify({
        razaoSocial: w.razao, plano: 'trial', status: 'ativa', limiteUsuarios: 0,
        subdominio: w.sub, numAutorizacao: w.autorizacao, prefixoCert: null, carencia: 15 }) });
    } catch (e) { pendencias.push('autorização Inmetro'); }
  }
  if (w.ctNome) {
    try {
      await saApi('/empresas/' + r.id + '/contatos', { method: 'POST', body: JSON.stringify({
        nome: w.ctNome, cargo: w.ctCargo || null,
        email: w.ctEmail || null, telefone: w.ctFone || null }) });
    } catch (e) { pendencias.push('contato de referência'); }
  }
  if (pendencias.length)
    toast('Empresa criada, mas falhou salvar: ' + pendencias.join(', ') + '. Complete em "Dados e plano".', 'erro');
  window._wizEmpresaCriadaId = r.id;
  mostrarEmpresaCriada(w.razao, w.admEmail, r.linkConvite);
  renderPainelSA();
}

// ═══════════════════════════════════════════════════════════════
// SUBSTITUA a função salvarNovaEmpresa inteira por esta versão.
// (localize "async function salvarNovaEmpresa()" no app.js e troque
//  da linha "async function salvarNovaEmpresa() {" até o "}" final)
// ═══════════════════════════════════════════════════════════════
async function salvarNovaEmpresa() {
  const erro = $('#ne-erro');
  erro.textContent = '';

  const corpo = {
    razaoSocial: $('#ne-razao').value.trim(), cnpj: $('#ne-cnpj').value.trim(),
    subdominio: $('#ne-sub').value.trim().toLowerCase(),
    prefixoCert: $('#ne-prefixo').value.trim().toUpperCase(),
    plano: $('#ne-plano').value, limiteUsuarios: Number($('#ne-limite').value) || 0,
    adminNome: $('#ne-anome').value.trim(), adminEmail: $('#ne-aemail').value.trim()
  };
  if (!corpo.razaoSocial || !corpo.cnpj || !corpo.subdominio || !corpo.prefixoCert
      || !corpo.adminNome || !corpo.adminEmail) {
    erro.textContent = 'Preencha todos os campos obrigatórios.'; return;
  }

  // Anti-duplo-clique: desabilita o botão enquanto processa
  const btn = document.querySelector('.modal-fundo .btn-primario');
  const btnCancelar = document.querySelector('.modal-fundo .rodape-acoes button:first-child');
  const textoOriginal = btn ? btn.textContent : 'Criar empresa';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Criando...'; }
  if (btnCancelar) btnCancelar.disabled = true;

  try {
    const r = await saApi('/empresas', { method: 'POST', body: JSON.stringify(corpo) });
    // Sucesso: mostra a tela de confirmação com o link de convite
    mostrarEmpresaCriada(corpo.razaoSocial, corpo.adminEmail, r.linkConvite);
    renderPainelSA();
  } catch (e) {
    // Erro detalhado e reabilita o botão para tentar de novo
    erro.textContent = e.message || 'Não foi possível criar a empresa. Tente novamente.';
    if (btn) { btn.disabled = false; btn.textContent = textoOriginal; }
    if (btnCancelar) btnCancelar.disabled = false;
  }
}

// Tela de confirmação após criar a empresa (substitui o conteúdo do modal)
function mostrarEmpresaCriada(razaoSocial, adminEmail, linkConvite) {
  const modal = document.querySelector('#wiz-empresa') || document.querySelector('.modal-fundo');
  if (!modal) return;
  const caixa = modal.querySelector('.modal-caixa');
  const linkBloco = linkConvite ? `
    <div style="margin-top:16px">
      <p class="dica" style="margin-bottom:6px">Se o e-mail não chegar, envie este link ao administrador
        para ele definir a senha:</p>
      <div style="display:flex;gap:8px;align-items:stretch">
        <input type="text" id="link-convite-copia" readonly value="${esc(linkConvite)}"
          style="flex:1;font-size:.82rem" onclick="this.select()">
        <button class="btn-mini" onclick="copiarLinkConviteEmpresa()">📋 Copiar</button>
      </div>
    </div>` : '';

  caixa.innerHTML = `
    <div style="text-align:center;padding:8px 0 4px">
      <div style="font-size:44px;line-height:1">✅</div>
      <h3 style="color:#146c43;margin-top:6px">Empresa criada com sucesso!</h3>
    </div>
    <p style="margin-top:8px"><b>${esc(razaoSocial)}</b> foi cadastrada.</p>
    <p class="dica">Um convite foi enviado para <b>${esc(adminEmail)}</b> definir a senha de acesso.</p>
    ${linkBloco}
    <div class="rodape-acoes" style="margin-top:18px">
      ${window._wizEmpresaCriadaId ? `<button onclick="this.closest('.modal-fundo').remove(); abrirEmpresaSA(window._wizEmpresaCriadaId)">📋 Abrir a empresa (criar contrato)</button>` : ''}
      <button class="btn-primario" onclick="this.closest('.modal-fundo').remove()">Concluir</button>
    </div>`;
}

// Copia o link de convite para a área de transferência
// (renomeada: havia DUAS funções com o nome copiarLinkConvite; a definida
// depois sobrescrevia esta, e o botão desta tela copiava o campo errado)
function copiarLinkConviteEmpresa() {
  const campo = $('#link-convite-copia');
  if (!campo) return;
  campo.select();
  navigator.clipboard.writeText(campo.value)
    .then(() => toast('Link copiado ✓', 'ok'))
    .catch(() => { document.execCommand('copy'); toast('Link copiado ✓', 'ok'); });
}

// ── Servidor de e-mail (SMTP) — global do sistema, só super_admin ──
// ══ MANUTENÇÃO: todos os dados da empresa + clientes finais ══
async function abrirManutencaoSA() {
  const id = window._saEmpresaId;
  const box = $('#sa-conteudo');
  box.innerHTML = '<div class="card"><p class="dica">Carregando dados completos…</p></div>';
  let e, p, cli, usr;
  try {
    [e, p, cli, usr] = await Promise.all([
      saApi('/empresas/' + id),
      saApi('/empresas/' + id + '/panorama'),
      saApi('/empresas/' + id + '/clientes'),
      saApi('/empresas/' + id + '/usuarios')
    ]);
  } catch (err) { box.innerHTML = `<div class="card"><p class="erro">${err.message}</p></div>`; return; }
  window._manutClientes = cli;

  const linha = (r, v) => `<tr><td class="dica" style="white-space:nowrap">${r}</td><td><b>${v ?? '—'}</b></td></tr>`;
  const kpiN = (n, r, cor) => `<div style="flex:1;min-width:104px;background:#f7f9fb;border:1px solid #dde5ec;
      border-radius:10px;padding:8px 12px"><span class="dica">${r}</span><br>
      <b style="font-size:1.2rem${cor ? ';color:' + cor : ''}">${n}</b></div>`;
  const portalSit = c => !c.portal_email
    ? '<span class="dica">sem acesso</span>'
    : c.portal_validado
      ? `<span class="badge ok">ativo</span>${c.portal_ultimo_acesso
          ? `<br><span class="dica">${dbrSA(c.portal_ultimo_acesso)}</span>` : ''}`
      : '<span class="badge" style="background:#fff3cd;color:#856404">pendente</span>';

  box.innerHTML = `
    <div class="barra" style="margin-bottom:12px">
      <h3>🗂 ${esc(e.razao_social)} — dados completos</h3>
      <button class="btn-mini" onclick="abrirEmpresaSA('${id}')">← Voltar à empresa</button>
    </div>

    <div class="card">
      <h3>Panorama</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
        ${kpiN(p.usuarios_ativos + '/' + p.usuarios, 'Usuários ativos')}
        ${kpiN(p.clientes_ativos + '/' + p.clientes, 'Clientes')}
        ${kpiN(p.balancas, 'Balanças')}
        ${kpiN(p.pesos, 'Pesos-padrão')}
        ${kpiN(p.cert_emitido, 'Emitidos', '#146c43')}
        ${kpiN(p.cert_aguardando, 'Aguardando', '#c88a00')}
        ${kpiN(p.cert_rascunho, 'Rascunhos')}
        ${kpiN(p.cert_substituido, 'Substituídos')}
        ${kpiN(p.cert_cancelado, 'Cancelados', '#b02a37')}
        ${kpiN(p.acessos_validados + '/' + p.acessos_portal, 'Portal ativo')}
      </div>
      <p class="dica" style="margin-top:8px">Certificados emitidos de
        <b>${p.primeiro_cert ? dbrSA(p.primeiro_cert) : '—'}</b> até
        <b>${p.ultimo_cert ? dbrSA(p.ultimo_cert) : '—'}</b>.</p>
    </div>

    <div class="card">
      <h3>Cadastro da empresa</h3>
      <div class="tabela-scroll"><table>
        ${linha('Razão social', esc(e.razao_social))}
        ${linha('CNPJ', esc(e.cnpj))}
        ${linha('Subdomínio', esc(e.subdominio))}
        ${linha('Prefixo do certificado', esc(e.prefixo_cert))}
        ${linha('Autorização Inmetro', esc(e.num_autorizacao))}
        ${linha('Situação', `${esc(e.status)}${e.motivo_suspensao ? ' · ' + esc(e.motivo_suspensao) : ''}`)}
        ${linha('Plano', esc(e.plano))}
        ${linha('Endereço', [e.endereco, e.cidade_uf, e.cep].filter(Boolean).map(esc).join(' · '))}
        ${linha('Contato', [e.telefone, e.email].filter(Boolean).map(esc).join(' · '))}
        ${linha('Criada em', dbrSA(e.criado_em))}
      </table></div>
    </div>

    <div class="card">
      <h3>Usuários (${usr.length})</h3>
      <div class="tabela-scroll"><table>
        <thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Situação</th></tr></thead>
        <tbody>${usr.map(u => `<tr>
          <td><b>${esc(u.nome)}</b></td>
          <td class="mono">${esc(u.email)}</td>
          <td>${PAPEL_ROTULO[u.papel] || esc(u.papel)}</td>
          <td>${u.ativo ? '<span class="badge ok">ativo</span>' : '<span class="badge rep">inativo</span>'}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>

    <div class="card">
      <div class="barra"><h3>Clientes finais (${cli.length})</h3>
        <input type="search" placeholder="🔍 filtrar cliente…"
               oninput="filtrarClientesManut(this.value)"
               style="max-width:240px;padding:7px 10px;border:1px solid #dde5ec;border-radius:8px;font:inherit;font-size:.9rem">
      </div>
      ${!cli.length ? '<p class="dica">Esta empresa ainda não cadastrou clientes.</p>' : `
      <div class="tabela-scroll"><table>
        <thead><tr><th>Cliente</th><th>CNPJ/CPF</th><th>Contato</th><th>Cidade</th>
          <th class="num">Balanças</th><th class="num">Certif.</th><th>Último</th>
          <th>Portal</th><th></th></tr></thead>
        <tbody id="tb-clientes-manut">${cli.map(c => `<tr data-f="${esc(((c.razao_social || '') + ' ' +
            (c.cnpj || '') + ' ' + (c.email || '') + ' ' + (c.cidade || '')).toLowerCase())}">
          <td><b>${esc(c.razao_social)}</b>${c.nome_fantasia
              ? `<br><span class="dica">${esc(c.nome_fantasia)}</span>` : ''}
            ${c.ativo ? '' : '<br><span class="badge rep">inativo</span>'}</td>
          <td class="mono">${esc(c.cnpj || '—')}</td>
          <td>${c.email ? `<span class="mono">${esc(c.email)}</span>` : '<span class="dica">sem e-mail</span>'}
            ${c.telefone ? `<br><span class="dica">${esc(c.telefone)}</span>` : ''}</td>
          <td>${esc([c.cidade, c.uf].filter(Boolean).join('/') || '—')}</td>
          <td class="num">${c.balancas}</td>
          <td class="num">${c.certificados}</td>
          <td>${c.ultimo_cert ? dbrSA(c.ultimo_cert) : '<span class="dica">—</span>'}</td>
          <td>${portalSit(c)}</td>
          <td style="white-space:nowrap">
            <button class="btn-mini" onclick="verBalancasCliente('${c.id}','${esc(c.razao_social).replace(/'/g, "\\'")}')">⚖️ Balanças</button>
            <button class="btn-mini" title="Abrir o portal como este cliente veria"
              onclick="verPortalDoCliente('${c.id}','${esc(c.razao_social).replace(/'/g, "\\'")}')">👁 Portal</button>
          </td>
        </tr>`).join('')}</tbody>
      </table></div>`}
    </div>`;
  window.scrollTo(0, 0);
}

function filtrarClientesManut(termo) {
  const t = (termo || '').trim().toLowerCase();
  document.querySelectorAll('#tb-clientes-manut tr').forEach(tr => {
    tr.style.display = !t || (tr.dataset.f || '').includes(t) ? '' : 'none';
  });
}

// Balanças de um cliente final (modal)
async function verBalancasCliente(cid, nome) {
  let b;
  try { b = await saApi('/clientes/' + cid + '/balancas'); }
  catch (e) { toast(e.message, 'erro'); return; }
  const cel = v => v == null || v === '' ? '—' : esc(String(v));
  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-fundo" onclick="if(event.target===this)this.remove()">
      <div class="modal-caixa" style="max-width:820px">
        <h3>⚖️ Balanças de ${esc(nome)} (${b.length})</h3>
        ${!b.length ? '<p class="dica">Nenhuma balança cadastrada para este cliente.</p>' : `
        <div class="tabela-scroll" style="max-height:430px"><table>
          <thead><tr><th>Identificação</th><th>Marca/Modelo</th><th>Série</th>
            <th>Capacidade</th><th>Divisão</th><th>Classe</th><th>Inmetro</th><th>Situação</th></tr></thead>
          <tbody>${b.map(x => `<tr>
            <td><b>${cel(x.identificacao)}</b></td>
            <td>${cel(x.marca)} ${cel(x.modelo)}</td>
            <td class="mono">${cel(x.num_serie)}</td>
            <td class="mono">${cel(x.capacidade)}</td>
            <td class="mono">${cel(x.divisao_e ?? x.divisao_d)}</td>
            <td>${cel(x.classe_exatidao)}</td>
            <td class="mono">${cel(x.numero_inmetro)}</td>
            <td>${x.ativo === false ? '<span class="badge rep">inativa</span>' : '<span class="badge ok">ativa</span>'}</td>
          </tr>`).join('')}</tbody>
        </table></div>`}
        <div class="rodape-acoes" style="margin-top:12px">
          <button onclick="this.closest('.modal-fundo').remove()">Fechar</button>
        </div>
      </div>
    </div>`);
}

// ══ PAINEL DE E-MAILS ═══════════════════════════════════════
let _diasPainelEmail = 30;
async function renderPainelEmailSA(dias) {
  if (dias) _diasPainelEmail = dias;
  const box = $('#sa-conteudo');
  box.innerHTML = '<div class="card"><p class="dica">Carregando painel…</p></div>';
  let r;
  try { r = await saApi('/emails/painel?dias=' + _diasPainelEmail); }
  catch (e) { box.innerHTML = `<div class="card"><p class="erro">${e.message}</p></div>`; return; }
  const d = r.dados || {};
  window._painelEmail = r;          // guardado para a exportação
  const hoje = d.hoje || { total: 0, erros: 0 };
  const ontem = d.ontem || { total: 0, erros: 0 };
  const per = d.periodo || { total: 0, erros: 0, destinatarios: 0, empresas: 0 };

  const pct = (p, t) => t > 0 ? Math.round(1000 * p / t) / 10 : 0;
  const taxaOk = (t, e) => t > 0 ? (100 - pct(e, t)).toFixed(1) : '—';
  const dtc = v => v ? new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit' }) : '—';
  const MOTIVO = { certificado: '📄 Certificado ao cliente', convite: '🔑 Convite de usuário',
    convite_portal: '🔗 Convite do portal', confirmacao_portal: '✅ Boas-vindas do portal',
    portal_validacao: '📧 Validação de e-mail', cobranca: '💰 Cobrança',
    aviso_vencimento: '⏰ Aviso de vencimento', pesquisa: '⭐ Pesquisa de satisfação',
    aprovacao_pendente: '⏳ Aprovações pendentes', rascunho_pendente: '📝 Rascunhos parados',
    resumo_erros: '🐞 Resumo de erros', pico_erros: '🚨 Pico de erros',
    resumo_emails: '📧 Resumo de e-mails', pico_emails: '🚨 Pico de falhas de e-mail',
    teste: '🧪 Teste', sistema: '⚙️ Sistema', chamado: '💬 Chamado' };
  const rotMotivo = m => MOTIVO[m] || esc(m);

  // variação de hoje contra ontem
  const varia = ontem.total > 0
    ? Math.round(100 * (hoje.total - ontem.total) / ontem.total) : null;
  const setaVar = varia === null ? '' : varia > 0
    ? `<span style="color:#146c43">▲ ${varia}%</span>`
    : varia < 0 ? `<span style="color:#b02a37">▼ ${Math.abs(varia)}%</span>`
    : '<span class="dica">= igual</span>';

  const kpi = (rot, valor, sub2, cor, fundo) => `
    <div style="flex:1;min-width:150px;background:${fundo || '#f7f9fb'};
         border:1px solid ${cor ? cor + '33' : '#dde5ec'};border-radius:12px;padding:10px 14px">
      <span class="dica">${rot}</span><br>
      <b style="font-size:1.5rem;line-height:1.2${cor ? ';color:' + cor : ''}">${valor}</b>
      ${sub2 ? `<br><span class="dica">${sub2}</span>` : ''}</div>`;

  // gráfico de 14 dias (barras CSS)
  const serie = d.serie || [];
  const maxSerie = Math.max(1, ...serie.map(s => Number(s.total)));
  const grafico = `
    <div style="display:flex;align-items:flex-end;gap:4px;height:120px;margin:6px 0 2px">
      ${serie.map(s => {
        const t = Number(s.total), er = Number(s.erros), okh = Math.round(78 * (t - er) / maxSerie),
              erh = Math.round(78 * er / maxSerie);
        const dia = new Date(String(s.dia).substring(0, 10) + 'T00:00:00');
        return `<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;
                     align-items:center;gap:2px" title="${dia.toLocaleDateString('pt-BR')}: ${t} envio(s), ${er} falha(s)">
          <span class="dica" style="font-size:9px">${t || ''}</span>
          ${erh > 0 ? `<div style="width:100%;max-width:26px;height:${erh}px;background:#e8646f;border-radius:3px 3px 0 0"></div>` : ''}
          <div style="width:100%;max-width:26px;height:${Math.max(t > 0 ? 2 : 0, okh)}px;
               background:#2b6cb0;border-radius:${erh > 0 ? '0' : '3px 3px 0 0'}"></div>
          <span class="dica" style="font-size:9px">${dia.getDate()}</span>
        </div>`;
      }).join('')}
    </div>
    <p class="dica" style="text-align:center">
      <span style="display:inline-block;width:9px;height:9px;background:#2b6cb0;border-radius:2px"></span> entregues
      &nbsp;<span style="display:inline-block;width:9px;height:9px;background:#e8646f;border-radius:2px"></span> falhas
      &nbsp;· últimos 14 dias</p>`;

  // distribuição por hora (hoje)
  const ph = d.por_hora || [];
  const maxHora = Math.max(1, ...ph.map(x => Number(x.total)));
  const porHora = !ph.length ? '<p class="dica">Nenhum envio hoje ainda.</p>' : `
    <div style="display:flex;align-items:flex-end;gap:2px;height:56px">
      ${Array.from({ length: 24 }, (_, h) => {
        const item = ph.find(x => Number(x.hora) === h);
        const t = item ? Number(item.total) : 0;
        return `<div style="flex:1" title="${String(h).padStart(2, '0')}h: ${t} envio(s)">
          <div style="height:${Math.round(46 * t / maxHora)}px;background:${t ? '#35b6e8' : '#e8eef4'};
               border-radius:2px 2px 0 0;min-height:2px"></div></div>`;
      }).join('')}
    </div>
    <p class="dica" style="text-align:center">0h ————— distribuição de hoje por hora ————— 23h</p>`;

  const barrinha = (t, e) => {
    const p = t > 0 ? Math.round(100 * (t - e) / t) : 0;
    return `<div style="background:#f0d5d8;border-radius:99px;height:6px;width:70px;display:inline-block;
      vertical-align:middle;overflow:hidden"><div style="width:${p}%;height:100%;background:#2f9e5f"></div></div>`;
  };

  box.innerHTML = `
    <div class="barra" style="margin-bottom:12px">
      <h2>📊 Painel de e-mails</h2>
      <div class="barra-btns">
        ${[7, 30, 90].map(n => `<button class="btn-mini" style="${_diasPainelEmail === n
          ? 'background:#12263f;color:#fff' : ''}" onclick="renderPainelEmailSA(${n})">${n} dias</button>`).join('')}
        <button class="btn-mini" onclick="renderPainelEmailSA()">↻ Atualizar</button>
        <button class="btn-mini" onclick="exportarPainelEmail('copiar', false)"
          title="Copia um resumo estruturado para colar no chat">📋 Copiar para análise</button>
        <button class="btn-mini" onclick="exportarPainelEmail('copiar', true)"
          title="Mesmo resumo, com os endereços mascarados">🕶 Copiar sem e-mails</button>
        <button class="btn-mini" onclick="exportarPainelEmail('baixar', false)">⬇ .txt</button>
        <button onclick="renderPainelSA()">← Empresas</button>
      </div>
    </div>

    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
      ${kpi('Enviados hoje', hoje.total, `${setaVar} vs. ontem (${ontem.total})`, '#12263f', '#fff')}
      ${kpi('Falhas hoje', hoje.erros, hoje.total > 0
        ? `taxa de entrega ${taxaOk(hoje.total, hoje.erros)}%` : 'sem envios hoje',
        Number(hoje.erros) > 0 ? '#b02a37' : '#146c43', Number(hoje.erros) > 0 ? '#fdf0f1' : '#eef7f0')}
      ${kpi('Na fila agora', r.fila ?? 0, Number(r.fila) > 20 ? 'acumulando — worker parado?' : 'aguardando envio',
        Number(r.fila) > 20 ? '#c88a00' : null, Number(r.fila) > 20 ? '#fdf6ea' : null)}
      ${kpi(`Total em ${_diasPainelEmail} dias`, per.total,
        `${per.erros} falha(s) · entrega ${taxaOk(per.total, per.erros)}%`)}
      ${kpi('Destinatários únicos', per.destinatarios, `${per.empresas} empresa(s)`)}
    </div>

    <div class="card">
      <h3>Volume diário</h3>
      ${grafico}
    </div>

    <div class="card">
      <h3>Hoje, hora a hora</h3>
      ${porHora}
    </div>

    <div class="card">
      <div class="barra"><h3>Por empresa (${(d.por_empresa || []).length})</h3></div>
      ${!(d.por_empresa || []).length ? '<p class="dica">Nenhum envio no período.</p>' : `
      <div class="tabela-scroll" style="max-height:360px"><table>
        <thead><tr><th>Empresa</th><th class="num">Enviados</th><th class="num">Falhas</th>
          <th>Entrega</th><th class="num">Destinatários</th><th>Último envio</th></tr></thead>
        <tbody>${d.por_empresa.map(x => `<tr>
          <td><b>${esc(x.empresa)}</b></td>
          <td class="num">${x.total}</td>
          <td class="num">${Number(x.erros) > 0
            ? `<b style="color:#b02a37">${x.erros}</b>` : '0'}</td>
          <td>${barrinha(Number(x.total), Number(x.erros))}
            <span class="dica"> ${taxaOk(Number(x.total), Number(x.erros))}%</span></td>
          <td class="num">${x.destinatarios}</td>
          <td class="dica">${dtc(x.ultimo)}</td>
        </tr>`).join('')}</tbody>
      </table></div>`}
    </div>

    <div class="card">
      <h3>Por tipo de envio</h3>
      ${!(d.por_motivo || []).length ? '<p class="dica">—</p>' : `
      <div class="tabela-scroll" style="max-height:320px"><table>
        <thead><tr><th>Tipo</th><th class="num">Enviados</th><th class="num">Falhas</th><th>Entrega</th></tr></thead>
        <tbody>${d.por_motivo.map(x => `<tr>
          <td>${rotMotivo(x.motivo)}</td>
          <td class="num">${x.total}</td>
          <td class="num">${Number(x.erros) > 0 ? `<b style="color:#b02a37">${x.erros}</b>` : '0'}</td>
          <td>${barrinha(Number(x.total), Number(x.erros))}
            <span class="dica"> ${taxaOk(Number(x.total), Number(x.erros))}%</span></td>
        </tr>`).join('')}</tbody>
      </table></div>`}
      ${(d.por_status || []).length ? `<p class="dica" style="margin-top:8px">Situações registradas: ${
        d.por_status.map(s => `<b>${esc(s.status)}</b> ${s.total}`).join(' · ')}
        ${d.por_status.some(s => s.status === 'retry')
          ? '<br>“retry” = falha temporária do servidor de e-mail que foi <b>reenviada automaticamente</b>; só conta como falha quando as tentativas se esgotam.'
          : ''}</p>` : ''}
    </div>

    ${(d.top_falhas || []).length ? `
    <div class="card" style="border-left:4px solid #b7791f">
      <h3>⚠️ Endereços que falham sempre</h3>
      <p class="dica">Falharam 2 vezes ou mais — quase sempre é e-mail digitado errado no
        cadastro do cliente. Corrigir aqui vale mais que reenviar.</p>
      <div class="tabela-scroll"><table>
        <thead><tr><th>Destinatário</th><th class="num">Falhas</th><th>Empresa(s)</th>
          <th>Última</th><th></th></tr></thead>
        <tbody>${d.top_falhas.map(x => `<tr>
          <td class="mono"><b>${esc(x.destinatario)}</b></td>
          <td class="num"><b style="color:#b02a37">${x.qtd}</b></td>
          <td>${esc(x.empresas || '—')}</td>
          <td class="dica">${dtc(x.ultimo)}</td>
          <td><button class="btn-mini" title="Parar de enviar para este endereço"
            onclick="suprimirDoPainel('${esc(x.destinatario)}')">🔇</button></td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>` : ''}

    <div class="card">
      <div class="barra"><h3>Últimas falhas (${(d.falhas || []).length})</h3>
        <button class="btn-mini" onclick="renderEmailLogSA()">📧 Ver log completo</button></div>
      ${!(d.falhas || []).length ? '<p class="dica">Nenhuma falha no período. 🎉</p>' : `
      <div class="tabela-scroll" style="max-height:360px"><table>
        <thead><tr><th>Quando</th><th>Destinatário</th><th>Tipo</th><th>Motivo da falha</th></tr></thead>
        <tbody>${d.falhas.map(x => `<tr>
          <td class="dica" style="white-space:nowrap">${dtc(x.enviado_em)}</td>
          <td class="mono">${esc(x.destinatario)}
            ${x.empresa ? `<br><span class="dica">${esc(x.empresa)}</span>` : ''}</td>
          <td>${rotMotivo(x.motivo)}</td>
          <td class="dica">${esc(x.erro)}</td>
        </tr>`).join('')}</tbody>
      </table></div>`}
    </div>`;
  window.scrollTo(0, 0);
}

// Exporta o painel de e-mails em texto estruturado (para análise)
function exportarPainelEmail(modo, mascarar) {
  const r = window._painelEmail;
  if (!r) { toast('Abra o painel primeiro.', 'erro'); return; }
  const d = r.dados || {};
  const per = d.periodo || {}, hj = d.hoje || {}, ont = d.ontem || {};
  const taxa = (t, e) => Number(t) > 0 ? (100 - (100 * Number(e) / Number(t))).toFixed(1) + '%' : '—';
  const dtc = v => v ? new Date(v).toLocaleString('pt-BR') : '—';
  const oculta = e => {
    const s = String(e || '');
    if (!mascarar || !s.includes('@')) return s;
    const [u, dom] = s.split('@');
    return (u.length <= 2 ? u[0] + '*' : u.substring(0, 2) + '*'.repeat(Math.min(u.length - 2, 6))) + '@' + dom;
  };
  const col = (v, n) => String(v ?? '').padEnd(n).substring(0, n);

  const L = [];
  L.push('=== TSCert — PAINEL DE E-MAILS ===');
  L.push(`Exportado em: ${new Date().toLocaleString('pt-BR')}`);
  L.push(`Período analisado: ${d.dias} dias${mascarar ? '  [endereços mascarados]' : ''}`);
  L.push('');
  L.push('-- RESUMO --');
  L.push(`hoje:        ${hj.total || 0} enviados · ${hj.erros || 0} falhas · entrega ${taxa(hj.total, hj.erros)}`);
  L.push(`ontem:       ${ont.total || 0} enviados · ${ont.erros || 0} falhas`);
  L.push(`no período:  ${per.total || 0} enviados · ${per.erros || 0} falhas · entrega ${taxa(per.total, per.erros)}`);
  L.push(`destinatários únicos: ${per.destinatarios || 0} · empresas: ${per.empresas || 0}`);
  L.push(`fila do worker agora: ${r.fila ?? 0}`);
  if ((d.por_status || []).length)
    L.push('situações: ' + d.por_status.map(s => `${s.status}=${s.total}`).join(' · '));
  L.push('');

  L.push('-- VOLUME DIÁRIO (14 dias) --');
  (d.serie || []).forEach(s => {
    const dia = new Date(String(s.dia).substring(0, 10) + 'T00:00:00').toLocaleDateString('pt-BR');
    L.push(`${dia}  enviados=${String(s.total).padStart(4)}  falhas=${String(s.erros).padStart(3)}`);
  });
  L.push('');

  if ((d.por_hora || []).length) {
    L.push('-- HOJE POR HORA --');
    L.push((d.por_hora || []).map(h => `${String(h.hora).padStart(2, '0')}h=${h.total}`).join('  '));
    L.push('');
  }

  L.push('-- POR EMPRESA --');
  L.push(col('empresa', 42) + col('env', 7) + col('falhas', 8) + col('entrega', 9) + 'último envio');
  (d.por_empresa || []).forEach(x => L.push(
    col(x.empresa, 42) + col(x.total, 7) + col(x.erros, 8) +
    col(taxa(x.total, x.erros), 9) + dtc(x.ultimo)));
  L.push('');

  L.push('-- POR TIPO DE ENVIO --');
  L.push(col('tipo', 26) + col('env', 7) + col('falhas', 8) + 'entrega');
  (d.por_motivo || []).forEach(x => L.push(
    col(x.motivo, 26) + col(x.total, 7) + col(x.erros, 8) + taxa(x.total, x.erros)));
  L.push('');

  if ((d.top_falhas || []).length) {
    L.push('-- ENDEREÇOS QUE FALHAM SEMPRE (2+) --');
    d.top_falhas.forEach(x => L.push(
      `${x.qtd}x  ${oculta(x.destinatario)}  [${x.empresas || '-'}]  última: ${dtc(x.ultimo)}`));
    L.push('');
  }

  if ((d.falhas || []).length) {
    L.push('-- ÚLTIMAS FALHAS (com a mensagem do servidor) --');
    d.falhas.forEach(x => {
      L.push(`${dtc(x.enviado_em)} · ${x.motivo} · ${oculta(x.destinatario)} · ${x.empresa || '-'}`);
      L.push(`   assunto: ${x.assunto || '-'}`);
      L.push(`   erro: ${x.erro}`);
    });
    L.push('');
  }
  L.push('=== FIM ===');
  const texto = L.join('\n');

  if (modo === 'baixar') {
    const blob = new Blob(['\ufeff' + texto], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tscert-painel-emails-${new Date().toISOString().substring(0, 10)}.txt`;
    document.body.appendChild(a); a.click(); a.remove();
    toast('Arquivo gerado — anexe no chat para análise.', 'ok', 5000);
    return;
  }
  navigator.clipboard.writeText(texto)
    .then(() => toast('Painel copiado' + (mascarar ? ' (endereços mascarados)' : '') +
      ' — cole no chat para análise.', 'ok', 6000))
    .catch(() => {
      document.body.insertAdjacentHTML('beforeend', `
        <div class="modal-fundo" onclick="if(event.target===this)this.remove()">
          <div class="modal-caixa" style="max-width:800px">
            <h3>📋 Painel de e-mails para análise</h3>
            <p class="dica">Clique dentro da caixa, Ctrl+A e copie.</p>
            <textarea readonly style="width:100%;height:360px;font-family:monospace;font-size:11px;
              border:1px solid #dde5ec;border-radius:8px;padding:10px">${esc(texto)}</textarea>
            <div class="rodape-acoes" style="margin-top:10px">
              <button onclick="this.closest('.modal-fundo').remove()">Fechar</button>
            </div>
          </div>
        </div>`);
    });
}

const EVENTO_PORTAL = {
  login: '<span class="badge ok">entrou</span>',
  login_falha: '<span class="badge rep">falha no login</span>',
  cadastro: '<span class="badge">criou acesso</span>',
  validacao: '<span class="badge">validação de e-mail</span>',
  visualizacao_sa: '<span class="badge" style="background:#7a4b00;color:#fff">visualização do super-admin</span>'
};

// Abre o portal como QUALQUER cliente cadastrado veria — mesmo sem conta.
// Útil para conferir o conteúdo antes de convidar.
async function verPortalDoCliente(clienteId, nome) {
  try {
    const r = await fetch('/api/sa/portal/ver-cliente/' + clienteId,
      { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { toast(d.erro || 'Não foi possível abrir.', 'erro', 6000); return; }
    if (Number(d.certificados) === 0) {
      const ok = await modalConfirmar('Cliente sem certificados emitidos',
        `<b>${esc(nome)}</b> ainda não tem certificado emitido, então o portal vai aparecer vazio.` +
        '<br><br><span class="dica">Quer abrir mesmo assim para ver a tela?</span>',
        { textoSim: 'Abrir', textoNao: 'Cancelar' });
      if (!ok) return;
    }
    window.open(d.link, '_blank', 'noopener');
  } catch (e) { toast(e.message, 'erro'); }
}

// Abre o portal do cliente numa aba, com os dados reais dele (auditado)
async function verPortalComoCliente(acessoId, email) {
  if (!await modalConfirmar('Ver o portal como este cliente',
    `Abrir o portal com os dados de <b>${esc(email)}</b>?<br><br>` +
    '<span class="dica">É somente leitura, mas o acesso fica registrado na auditoria ' +
    'e no histórico do cliente — como deve ser, já que são dados de terceiro.</span>',
    { textoSim: 'Abrir portal', textoNao: 'Cancelar' })) return;
  try {
    const r = await fetch('/api/sa/portal/ver-como/' + acessoId,
      { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.erro || 'Falha'); }
    const d = await r.json();
    window.open(d.link, '_blank', 'noopener');
  } catch (e) { toast(e.message, 'erro'); }
}

// ══ Clientes finais (por documento) + abrir o portal deles ══
let _filtroEmpPortal = '';
async function renderClientesFinaisSA(empresaId) {
  if (empresaId !== undefined) _filtroEmpPortal = empresaId;
  const box = $('#sa-conteudo');
  box.innerHTML = '<div class="card"><p class="dica">Carregando clientes…</p></div>';
  let lista, empresas;
  try {
    [lista, empresas] = await Promise.all([
      fetch('/api/sa/portal/clientes' + (_filtroEmpPortal ? '?empresa=' + _filtroEmpPortal : ''),
        { headers: { Authorization: 'Bearer ' + token } }).then(r => r.json()),
      saApi('/empresas')
    ]);
  } catch (e) { box.innerHTML = `<div class="card"><p class="erro">${e.message}</p></div>`; return; }

  const doc = d => {
    const s = String(d || '').replace(/\D/g, '');
    if (s.length === 14) return s.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    if (s.length === 11) return s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    return d;
  };
  const dtc = v => v ? new Date(v).toLocaleDateString('pt-BR') : '—';
  const comAcesso = lista.filter(x => x.tem_acesso).length;
  const multi = lista.filter(x => Number(x.cadastros) > 1).length;

  box.innerHTML = `
    <div class="barra" style="margin-bottom:12px">
      <h2>👁 Portal dos clientes finais</h2>
      <div class="barra-btns">
        <button class="btn-mini" onclick="renderClientesFinaisSA()">↻ Atualizar</button>
        <button class="btn-mini" onclick="renderDiagPortalSA()">🩺 Diagnóstico</button>
        <button onclick="renderPainelSA()">← Empresas</button>
      </div>
    </div>

    <div class="card">
      <p class="dica">O portal é unificado por <b>CNPJ/CPF</b>: um mesmo cliente atendido por
        várias das suas empresas vê os certificados de todas numa tela só. Por isso a lista
        agrupa por documento. Clique em <b>👁 Abrir portal</b> para ver exatamente o que ele
        enxerga — mesmo que ainda não tenha conta criada.</p>

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0">
        <select onchange="renderClientesFinaisSA(this.value)"
          style="flex:1;min-width:200px;padding:9px 11px;border:1px solid #dde5ec;
                 border-radius:9px;font:inherit;font-size:.92rem">
          <option value="">🏢 Todas as empresas</option>
          ${empresas.map(e => `<option value="${e.id}" ${_filtroEmpPortal === e.id ? 'selected' : ''}>
            ${esc(e.razao_social)}</option>`).join('')}
        </select>
        <input type="search" placeholder="🔍 cliente, CNPJ ou empresa"
          oninput="filtrarClientesFinais(this.value)"
          style="flex:1;min-width:200px;padding:9px 11px;border:1px solid #dde5ec;
                 border-radius:9px;font:inherit;font-size:.92rem">
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        <div style="flex:1;min-width:130px;background:#f7f9fb;border:1px solid #dde5ec;
             border-radius:10px;padding:8px 12px"><span class="dica">Clientes (por documento)</span>
          <br><b style="font-size:1.2rem">${lista.length}</b></div>
        <div style="flex:1;min-width:130px;background:#eef7f0;border:1px solid #cfe5d6;
             border-radius:10px;padding:8px 12px"><span class="dica">Com acesso ao portal</span>
          <br><b style="font-size:1.2rem;color:#146c43">${comAcesso}</b></div>
        <div style="flex:1;min-width:130px;background:#f7f9fb;border:1px solid #dde5ec;
             border-radius:10px;padding:8px 12px"><span class="dica">Atendidos por 2+ empresas</span>
          <br><b style="font-size:1.2rem">${multi}</b></div>
      </div>

      ${!lista.length ? '<p class="dica">Nenhum cliente com CNPJ/CPF cadastrado nesta seleção.</p>' : `
      <div class="tabela-scroll" style="max-height:520px"><table>
        <thead><tr><th>Cliente</th><th>CNPJ/CPF</th><th>Empresa(s) que atendem</th>
          <th class="num">Balanças</th><th class="num">Certif.</th><th>Último</th>
          <th>Portal</th><th></th></tr></thead>
        <tbody id="tb-clientes-finais">${lista.map(c => `<tr data-f="${esc(((c.nomes || '') + ' ' +
            (c.documento || '') + ' ' + (c.empresas || '')).toLowerCase())}">
          <td><b>${esc(c.nomes)}</b>${Number(c.cadastros) > 1
            ? `<br><span class="dica">${c.cadastros} cadastros com este documento</span>` : ''}</td>
          <td class="mono">${doc(c.documento)}</td>
          <td>${esc(c.empresas)}</td>
          <td class="num">${c.balancas}</td>
          <td class="num">${c.certificados}</td>
          <td class="dica">${dtc(c.ultimo_cert)}</td>
          <td>${c.tem_acesso
            ? `<span class="badge ok">tem acesso</span>${c.ultimo_acesso
                ? `<br><span class="dica">entrou ${dtc(c.ultimo_acesso)}</span>`
                : '<br><span class="dica">nunca entrou</span>'}`
            : '<span class="dica">sem acesso</span>'}</td>
          <td><button class="btn-mini" title="Abrir o portal como este cliente"
            onclick="abrirPortalDocumento('${c.documento}')">👁 Abrir portal</button></td>
        </tr>`).join('')}</tbody>
      </table></div>`}
    </div>`;
  window.scrollTo(0, 0);
}

function filtrarClientesFinais(t) {
  const termo = (t || '').trim().toLowerCase();
  document.querySelectorAll('#tb-clientes-finais tr').forEach(tr => {
    tr.style.display = !termo || (tr.dataset.f || '').includes(termo) ? '' : 'none';
  });
}

async function abrirPortalDocumento(documento) {
  try {
    const r = await fetch('/api/sa/portal/ver-documento', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ documento })
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { toast(d.erro || 'Não foi possível abrir.', 'erro', 6000); return; }
    if (Number(d.certificados) === 0) {
      const ok = await modalConfirmar('Cliente sem certificados emitidos',
        `<b>${esc(d.cliente)}</b> ainda não tem certificado emitido — o portal vai aparecer vazio.` +
        '<br><br><span class="dica">Abrir mesmo assim para ver a tela?</span>',
        { textoSim: 'Abrir', textoNao: 'Cancelar' });
      if (!ok) return;
    }
    window.open(d.link, '_blank', 'noopener');
  } catch (e) { toast(e.message, 'erro'); }
}

// ══ Diagnóstico de acesso ao portal (super-admin) ══
async function renderDiagPortalSA() {
  const box = $('#sa-conteudo');
  box.innerHTML = '<div class="card"><p class="dica">Carregando diagnóstico…</p></div>';
  let d;
  try { d = await saApi('/portal/diagnostico?dias=30'); }
  catch (e) { box.innerHTML = `<div class="card"><p class="erro">${e.message}</p></div>`; return; }
  const r = d.resumo || {}, ct = d.contas || {}, cv = d.convites || {};
  const dt = v => v ? new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit' }) : '—';
  const kpi = (rot, val, sub, cor, fundo) => `
    <div style="flex:1;min-width:130px;background:${fundo || '#f7f9fb'};
         border:1px solid #dde5ec;border-radius:11px;padding:9px 13px">
      <span class="dica">${rot}</span><br>
      <b style="font-size:1.3rem${cor ? ';color:' + cor : ''}">${val}</b>
      ${sub ? `<br><span class="dica">${sub}</span>` : ''}</div>`;

  const MOTIVO = {
    'e-mail sem acesso criado': 'Tentou entrar sem ter conta — provavelmente não recebeu ou não usou o convite',
    'senha incorreta': 'Senha errada',
    'e-mail nao validado': 'Criou a conta mas não confirmou o e-mail',
    'acesso desativado': 'Conta desativada',
    'link reenviado': 'Pediu o reenvio do link de confirmação'
  };

  box.innerHTML = `
    <div class="barra" style="margin-bottom:12px">
      <h2>🩺 Diagnóstico do portal do cliente</h2>
      <div class="barra-btns">
        <button class="btn-mini" onclick="renderDiagPortalSA()">↻ Atualizar</button>
        <button class="btn-mini" onclick="renderPortalSA()">🌐 Acessos</button>
        <button onclick="renderPainelSA()">← Empresas</button>
      </div>
    </div>

    <div class="card">
      <h3>Situação das contas</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
        ${kpi('Contas criadas', ct.total ?? 0)}
        ${kpi('Nunca entraram', ct.nunca_entraram ?? 0, '', Number(ct.nunca_entraram) ? '#c88a00' : null)}
        ${kpi('E-mail não confirmado', ct.nao_validadas ?? 0, '', Number(ct.nao_validadas) ? '#b02a37' : null)}
        ${kpi('Desativadas', ct.desativadas ?? 0)}
      </div>
      <h3 style="margin-top:16px">Convites</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
        ${kpi('Aguardando uso', cv.pendentes ?? 0, 'ainda no prazo')}
        ${kpi('Expirados sem uso', cv.expirados ?? 0, 'precisa reenviar',
              Number(cv.expirados) ? '#b02a37' : null, Number(cv.expirados) ? '#fdf0f1' : null)}
        ${kpi('Usados', cv.usados ?? 0, 'viraram acesso', '#146c43')}
      </div>
      ${Number(ct.total) === 0 && Number(cv.pendentes) + Number(cv.expirados) > 0 ? `
        <p class="dica" style="background:#fdf6ea;border:1px solid #ecdcc0;border-radius:8px;
           padding:9px 12px;margin-top:12px">⚠️ Há convites enviados e <b>nenhuma conta criada</b>.
           Ou os e-mails não chegaram, ou o link expirou antes do uso. Vale conferir o
           <b>📊 Painel de e-mails</b> (tipo “convite_portal”) e reenviar.</p>` : ''}
    </div>

    <div class="card">
      <h3>Movimento nos últimos ${d.dias} dias</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
        ${kpi('Entradas', r.logins ?? 0, '', '#146c43')}
        ${kpi('Falhas', r.falhas ?? 0, '', Number(r.falhas) ? '#b02a37' : null)}
        ${kpi('Acessos criados', r.cadastros ?? 0)}
        ${kpi('Validações', r.validacoes ?? 0)}
        ${kpi('Pessoas distintas', r.pessoas ?? 0)}
      </div>
    </div>

    <div class="card">
      <h3>Por que estão falhando</h3>
      ${!(d.por_motivo || []).length ? '<p class="dica">Nenhuma falha registrada no período. 🎉</p>' : `
      <div class="tabela-scroll"><table>
        <thead><tr><th>Evento</th><th>Motivo</th><th>O que significa</th>
          <th class="num">Vezes</th><th class="num">Pessoas</th><th>Última</th></tr></thead>
        <tbody>${d.por_motivo.map(x => `<tr>
          <td>${EVENTO_PORTAL[x.evento] || esc(x.evento)}</td>
          <td class="mono">${esc(x.motivo)}</td>
          <td class="dica">${MOTIVO[x.motivo] || ''}</td>
          <td class="num"><b>${x.qtd}</b></td>
          <td class="num">${x.pessoas}</td>
          <td class="dica">${dt(x.ultimo)}</td>
        </tr>`).join('')}</tbody>
      </table></div>`}
    </div>

    <div class="card">
      <h3>Últimas tentativas (${(d.recentes || []).length})</h3>
      ${!(d.recentes || []).length ? '<p class="dica">Sem registros no período.</p>' : `
      <div class="tabela-scroll" style="max-height:400px"><table>
        <thead><tr><th>Quando</th><th>E-mail</th><th>Evento</th><th>Motivo</th><th>IP</th></tr></thead>
        <tbody>${d.recentes.map(x => `<tr>
          <td class="dica" style="white-space:nowrap">${dt(x.ocorrido_em)}</td>
          <td class="mono">${esc(x.email || '—')}</td>
          <td>${EVENTO_PORTAL[x.evento] || esc(x.evento)}</td>
          <td class="dica">${esc(x.motivo || '')}</td>
          <td class="mono dica">${esc(x.ip || '—')}</td>
        </tr>`).join('')}</tbody>
      </table></div>`}
    </div>`;
  window.scrollTo(0, 0);
}

// ══ Acessos do portal (todos os clientes finais, global) ══
let filtroPortalSA = '';
function filtrarPortalSA(f) {
  filtroPortalSA = filtroPortalSA === f ? '' : f;
  renderPortalSA();
}
let buscaPortalSA = '';
function buscarPortalSA(t) {
  buscaPortalSA = t;
  const termo = (t || '').trim().toLowerCase();
  document.querySelectorAll('#tb-portal tr').forEach(tr => {
    tr.style.display = !termo || (tr.dataset.f || '').includes(termo) ? '' : 'none';
  });
}

async function renderPortalSA() {
  const box = $('#sa-conteudo');
  box.innerHTML = '<div class="card"><p class="dica">Carregando acessos…</p></div>';
  let lista, log;
  try {
    [lista, log] = await Promise.all([
      saApi('/clientes-portal'),
      saApi('/clientes-portal/log')
    ]);
  } catch (e) { box.innerHTML = `<div class="card"><p class="erro">${e.message}</p></div>`; return; }

  const jaAcessou = x => !!x.ultimo_acesso;
  const total = lista.length;
  const cJa = lista.filter(jaAcessou).length;
  const cNunca = lista.filter(x => !jaAcessou(x) && x.email_validado).length;
  const cPend = lista.filter(x => !x.email_validado).length;

  let vis = lista;
  if (filtroPortalSA === 'ja') vis = lista.filter(jaAcessou);
  else if (filtroPortalSA === 'nunca') vis = lista.filter(x => !jaAcessou(x) && x.email_validado);
  else if (filtroPortalSA === 'pend') vis = lista.filter(x => !x.email_validado);

  const dt = v => v ? new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit',
    year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
  const dtc = v => v ? new Date(v).toLocaleDateString('pt-BR') : '—';
  const doc = d => {
    const s = String(d || '').replace(/\D/g, '');
    if (s.length === 14) return s.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    if (s.length === 11) return s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    return d || '—';
  };
  const kpi = (id, rot, n, cor, fundo) => `
    <button class="btn-mini" onclick="filtrarPortalSA('${id}')" style="flex:1;min-width:130px;
      text-align:left;border:1px solid ${cor}44;border-radius:10px;padding:8px 12px;
      background:${filtroPortalSA === id ? cor : fundo};color:${filtroPortalSA === id ? '#fff' : 'inherit'}">
      <span class="dica" style="${filtroPortalSA === id ? 'color:#e8f4fb' : ''}">${rot}</span><br>
      <b style="font-size:1.2rem;${filtroPortalSA === id ? '' : 'color:' + cor}">${n}</b></button>`;

  box.innerHTML = `
    <div class="barra" style="margin-bottom:12px">
      <h3>🌐 Acessos do portal do cliente</h3>
      <div class="barra-btns">
        <button class="btn-mini" onclick="renderPortalSA()">↻ Atualizar</button>
        <button onclick="renderPainelSA()">← Empresas</button>
      </div>
    </div>

    <div class="card">
      <p class="dica">Clientes finais que criaram acesso ao portal, com os cadastros e as
        empresas ligadas ao mesmo CNPJ/CPF.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 4px">
        ${kpi('', 'Total de acessos', total, '#43607f', '#f4f7fb')}
        ${kpi('ja', 'Já acessaram', cJa, '#146c43', '#eef7f0')}
        ${kpi('nunca', 'Criaram e nunca entraram', cNunca, '#c88a00', '#fdf6ea')}
        ${kpi('pend', 'E-mail não validado', cPend, '#b02a37', '#fdf0f1')}
      </div>
      ${filtroPortalSA ? `<p class="dica">Filtro ativo — clique de novo no cartão para limpar.</p>` : ''}
      <input type="search" placeholder="🔍 e-mail, cliente, empresa ou documento"
        oninput="buscarPortalSA(this.value)"
        style="width:100%;margin:10px 0 4px;padding:9px 12px;border:1px solid #dde5ec;
               border-radius:9px;font:inherit;font-size:.92rem">
      ${!vis.length ? '<p class="dica">Nenhum acesso nesta seleção.</p>' : `
      <div class="tabela-scroll" style="max-height:460px"><table>
        <thead><tr><th>Login (e-mail)</th><th>Cliente final</th><th>Empresa(s)</th>
          <th class="num">Balanças</th><th class="num">Certif.</th>
          <th>Situação</th><th>Criado</th><th>Último acesso</th><th></th></tr></thead>
        <tbody id="tb-portal">${vis.map(a => `<tr data-f="${esc(((a.email || '') + ' ' +
            (a.clientes || '') + ' ' + (a.empresas || '') + ' ' + (a.documento || '') + ' ' +
            (a.nome || '')).toLowerCase())}">
          <td class="mono"><b>${esc(a.email)}</b>${a.nome ? `<br><span class="dica">${esc(a.nome)}</span>` : ''}</td>
          <td>${a.clientes ? esc(a.clientes) : '<span class="dica">documento sem cadastro</span>'}
            <br><span class="dica mono">${doc(a.documento)}</span></td>
          <td>${a.empresas ? esc(a.empresas) : '<span class="dica">—</span>'}</td>
          <td class="num">${a.balancas ?? 0}</td>
          <td class="num">${a.certificados ?? 0}</td>
          <td>${a.ativo === false ? '<span class="badge rep">desativado</span>'
            : a.email_validado ? '<span class="badge ok">validado</span>'
            : '<span class="badge" style="background:#fff3cd;color:#856404">pendente</span>'}</td>
          <td>${dtc(a.criado_em)}</td>
          <td>${a.ultimo_acesso ? dt(a.ultimo_acesso)
            : '<span class="dica">nunca entrou</span>'}</td>
          <td>${a.id ? `<button class="btn-mini" title="Abrir o portal como este cliente"
            onclick="verPortalComoCliente('${a.id}','${esc(a.email)}')">👁</button>` : ''}</td>
        </tr>`).join('')}</tbody>
      </table></div>`}
    </div>

    <div class="card">
      <h3>Últimos acessos e tentativas (${log.length})</h3>
      ${!log.length ? '<p class="dica">Sem registros.</p>' : `
      <div class="tabela-scroll" style="max-height:340px"><table>
        <thead><tr><th>Quando</th><th>E-mail</th><th>Evento</th><th>Motivo</th><th>IP</th></tr></thead>
        <tbody>${log.map(l => `<tr>
          <td style="white-space:nowrap">${dt(l.ocorrido_em || l.criado_em)}</td>
          <td class="mono">${esc(l.email || '—')}</td>
          <td>${EVENTO_PORTAL[l.evento] || esc(l.evento || '—')}</td>
          <td class="dica">${esc(l.detalhe || '')}</td>
          <td class="mono">${esc(l.ip || '—')}</td>
        </tr>`).join('')}</tbody>
      </table></div>`}
    </div>`;
  window.scrollTo(0, 0);
}

// Tentativas de login falhas: quem tentou, com qual e-mail, de onde
async function renderTentativasLoginSA() {
  const box = $('#sa-conteudo');
  box.innerHTML = '<div class="card"><p class="dica">Carregando tentativas…</p></div>';
  let lista;
  try { lista = await saApi('/tentativas-login'); }
  catch (e) { box.innerHTML = `<div class="card"><p class="erro">${e.message}</p></div>`; return; }
  const agora = Date.now();
  const h24 = lista.filter(x => agora - new Date(x.quando).getTime() < 86400e3).length;
  const inexistentes = lista.filter(x => !x.usuario_existe).length;
  const dt = v => new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit' });
  const rotulo = x => x.acao === 'login_bloqueado'
    ? '<span class="badge rep">conta bloqueada</span>'
    : x.usuario_existe
      ? '<span class="badge">senha errada</span>'
      : '<span class="badge rep">e-mail não cadastrado</span>';
  box.innerHTML = `
    <div class="card">
      <div class="barra"><h3>🔐 Tentativas de login (últimas ${lista.length})</h3>
        <div class="barra-btns">
          <button class="btn-mini" onclick="renderTentativasLoginSA()">↻ Atualizar</button>
          <button onclick="renderPainelSA()">← Empresas</button>
        </div></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin:8px 0 12px">
        <div style="flex:1;min-width:140px;background:#f7f9fb;border:1px solid #dde5ec;border-radius:10px;padding:8px 12px">
          <span class="dica">Últimas 24h</span><br><b style="font-size:1.15rem">${h24}</b></div>
        <div style="flex:1;min-width:140px;background:${inexistentes ? '#fdf0f0' : '#f7f9fb'};border:1px solid ${inexistentes ? '#ecc8c8' : '#dde5ec'};border-radius:10px;padding:8px 12px">
          <span class="dica">E-mails não cadastrados</span><br>
          <b style="font-size:1.15rem;${inexistentes ? 'color:#b02a37' : ''}">${inexistentes}</b></div>
      </div>
      ${!lista.length ? '<p class="dica">Nenhuma tentativa falha registrada. 🎉</p>' : `
      <div class="tabela-scroll" style="max-height:520px">
        <table>
          <thead><tr><th>Quando</th><th>E-mail tentado</th><th>Situação</th><th>IP</th><th>Empresa</th></tr></thead>
          <tbody>${lista.map(x => `<tr>
            <td style="white-space:nowrap">${dt(x.quando)}</td>
            <td><b>${esc(x.email_tentado)}</b></td>
            <td>${rotulo(x)}</td>
            <td class="mono">${esc(x.ip)}</td>
            <td>${esc(x.empresa || '—')}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
      <p class="dica" style="margin-top:8px">💡 "E-mail não cadastrado" repetido do mesmo IP pode
        indicar tentativa de invasão; do e-mail certo com typo, um usuário confundido.
        O bloqueio automático na 5ª senha errada seguida já está ativo.</p>`}
    </div>`;
}

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

// ═══════ Visualização de empresa pelo super-admin (somente leitura) ═══════
// Papel escolhido pelo super admin (João, 10/08/2026): admin vê TUDO
// (inclusive Usuários e Configurações), RT e técnico mostram o sistema
// exatamente como cada perfil enxerga. Sempre somente leitura (middleware).
const PAPEL_VIS_ROTULO = { admin: 'Admin', responsavel_tecnico: 'Resp. técnico',
  tecnico: 'Técnico' };
async function visualizarEmpresa(id, nome, papel) {
  papel = PAPEL_VIS_ROTULO[papel] ? papel : 'responsavel_tecnico';
  const ok = await modalConfirmar(
    '👁 Visualizar dados da empresa',
    `Você vai entrar no modo de visualização (somente leitura) da empresa "${nome}" ` +
    `vendo o sistema como ${PAPEL_VIS_ROTULO[papel].toUpperCase()}.\n\n` +
    'Você verá os dados como esse perfil vê, mas não poderá alterar nada. ' +
    'Este acesso fica registrado. Deseja continuar?',
    { textoSim: 'Entrar na visualização', textoNao: 'Cancelar' });
  if (!ok) return;
  try {
    const r = await saApi('/empresas/' + id + '/visualizar?papel=' + papel,
      { method: 'POST' });
    // Troca para o token de visualização
    token = r.token;
    localStorage.setItem('token', token);
    // Atualiza o "usuario" local para refletir o modo visualização
    usuario = { ...usuario, papel, empresa: r.empresaNome,
      _visualizando: true, _empresaVis: r.empresaNome };
    localStorage.setItem('usuario', JSON.stringify(usuario));
    localStorage.setItem('_visualizando', '1');
    mostrarBannerVisualizacao(r.empresaNome, papel);
    irPainel();
  } catch (e) { toast(e.message, 'erro'); }
}

function mostrarBannerVisualizacao(nomeEmpresa, papel) {
  document.getElementById('banner-visualizacao')?.remove();
  const rotP = PAPEL_VIS_ROTULO[papel] || 'Resp. técnico';
  const banner = document.createElement('div');
  banner.id = 'banner-visualizacao';
  banner.innerHTML = `
    <span>👁 <b>Modo visualização</b> — vendo a empresa
      <b>${esc(nomeEmpresa)}</b> como <b>${rotP}</b> (somente leitura).</span>
    <button onclick="sairVisualizacao()">Sair da visualização</button>`;
  document.body.prepend(banner);
  document.body.classList.add('com-banner-vis');
}

async function sairVisualizacao() {
  try {
    const r = await saApi('/sair-visualizacao', { method: 'POST' });
    token = r.token;
    localStorage.setItem('token', token);
    localStorage.removeItem('_visualizando');
    // Volta a ser super-admin (o token novo já reflete isso)
    usuario = { ...usuario, papel: 'super_admin', _visualizando: false };
    delete usuario._empresaVis;
    localStorage.setItem('usuario', JSON.stringify(usuario));
    document.getElementById('banner-visualizacao')?.remove();
    document.body.classList.remove('com-banner-vis');
    irSuperAdmin();
  } catch (e) { toast(e.message, 'erro'); }
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
  window._saPlanoLegado = e.plano;   // preserva o valor legado no salvar
  window._saFantasiaCarregado = e.nome_fantasia ?? null;
  // Dados p/ o contrato (endereço, e-mail, representante) — carregados à parte
  carregarContatosSA(id);
  saApi('/empresas/' + id + '/dados-contrato').then(dc => {
    window._saDadosContrato = dc;
    const preencher = (idEl, v) => { const el = document.getElementById(idEl); if (el) el.value = v || ''; };
    preencher('ed-rep-nome', dc.rep_legal_nome);
    preencher('ed-rep-cpf', dc.rep_legal_cpf);
    preencher('ed-endereco', dc.endereco);
    preencher('ed-cep', dc.cep);
    preencher('ed-cidade-uf', dc.cidade_uf);
    preencher('ed-telefone', dc.telefone);
    preencher('ed-email-emp', dc.email);
    const chPortal = document.getElementById('ed-portal');
    if (chPortal) chPortal.checked = !!dc.portal_cliente_ativo;
    const chSusp = document.getElementById('ed-emails-susp');
    if (chSusp) chSusp.checked = !!dc.emails_suspensos;
    const bd = document.getElementById('sa-liberacao-badge');
    if (bd && dc.liberado_ate) {
      const ate = new Date(String(dc.liberado_ate).substring(0, 10) + 'T00:00:00');
      const vigente = ate >= new Date(new Date().toDateString());
      bd.innerHTML = vigente
        ? `<span class="badge ok" title="Suspensões automáticas suspensas até esta data">🔓 liberada até ${ate.toLocaleDateString('pt-BR')}</span>`
        : '';
    }
  }).catch(() => { window._saDadosContrato = null; });
  // GET /contratos agora devolve { contratos, planos }
  const _resCt = contratos;
  contratos = _resCt.contratos ?? _resCt;
  window._saPlanos = Object.fromEntries((_resCt.planos ?? []).map(p => [p.id, p]));
  window._saCobrancas = cobrancas;

  const statusSel = ['ativa', 'suspensa', 'cancelada'].map(s =>
    `<option value="${s}" ${e.status === s ? 'selected' : ''}>${s}</option>`).join('');

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
        <button class="btn-mini" style="color:#b02a37" title="Cancelar esta cobrança (com motivo)"
          onclick="cancelarCobrancaSA('${c.id}')">🚫</button>
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
        <button class="btn-mini" onclick="abrirEditarUsuarioSA('${u.id}','${esc(u.nome).replace(/'/g,"\\'")}','${esc(u.email)}','${u.papel}','${esc(u.registro_prof || '')}')">✏️ Editar</button>
        <button class="btn-mini" onclick="bloquearUsuarioSA('${u.id}', ${u.ativo ? 'false' : 'true'})">
          ${u.ativo ? '🔒 Bloquear' : '🔓 Reativar'}</button>
        <button class="btn-mini" style="color:#b02a37" onclick="excluirUsuarioSA('${u.id}','${esc(u.nome)}')">🗑 Excluir</button>
      </td>
    </tr>`).join('');

  window._saContratos = contratos;
  const linhasContrato = contratos.map(c => `
    <tr${c.ativo ? '' : ' style="opacity:.65"'}>
      <td><b>${esc(c.descricao)}</b>${window._saPlanos?.[c.id]?.plano
        ? ` <span class="badge ok" style="text-transform:capitalize">${window._saPlanos[c.id].plano}</span>` : ''}${c.ativo ? '' : ' <span class="badge rep">Encerrado</span>'}</td>
      <td class="num">${(() => {
        const pl = window._saPlanos?.[c.id];
        if (!pl || !Number(pl.desconto_valor)) return brl(c.valor);
        const efetivo = pl.desconto_tipo === 'percentual'
          ? c.valor * (1 - Math.min(Number(pl.desconto_valor), 100) / 100)
          : Math.max(0, c.valor - Number(pl.desconto_valor));
        const rot = pl.desconto_tipo === 'percentual'
          ? `−${Number(pl.desconto_valor)}%` : `−${brl(pl.desconto_valor)}`;
        const ate = pl.desconto_ate ? ` até ${dbrSA(pl.desconto_ate)}` : '';
        return `<b>${brl(efetivo)}</b> <span class="dica" title="Valor de tabela: ${brl(c.valor)}">(${rot}${ate})</span>`;
      })()}</td>
      <td>${esc(c.periodicidade)}</td>
      <td>${dbrSA(c.inicio)}${c.fim ? ' → ' + dbrSA(c.fim) : ''}</td>
      <td style="min-width:300px">
        ${c.ativo ? `<button class="btn-mini" onclick="formNovaCobranca('${c.id}','${esc(c.descricao)}',${c.valor})">+ Cobrança</button>` : ''}
        <button class="btn-mini" onclick="gerarContratoPreenchido('${c.id}')" title="Gera o contrato de fornecimento preenchido para assinatura">📄 Contrato</button>
        <button class="btn-mini" onclick="cronogramaContrato('${c.id}')" title="Projeção das próximas cobranças, com desconto aplicado">🗓 Cronograma</button>
        ${window._saPlanos?.[c.id]?.arquivo_assinado_nome
          ? `<button class="btn-mini" onclick="baixarContratoAssinado('${c.id}')" title="${esc(window._saPlanos[c.id].arquivo_assinado_nome)}">📄 Assinado</button>
             <button class="btn-mini" onclick="anexarContratoAssinado('${c.id}')" title="Substituir o PDF">↻</button>`
          : `<button class="btn-mini" onclick="anexarContratoAssinado('${c.id}')">📎 Anexar assinado</button>`}
        <button class="btn-mini" onclick="formEditarContrato('${c.id}')">✎ Editar</button>
        <button class="btn-mini" onclick="ativarContratoSA('${c.id}', ${c.ativo ? 'false' : 'true'})">${c.ativo ? '⏸ Encerrar' : '▶ Reativar'}</button>
        <button class="btn-mini" style="color:#b02a37" onclick="excluirContratoSA('${c.id}','${esc(c.descricao)}')">🗑</button>
      </td>
    </tr>`).join('');

  $('#sa-conteudo').innerHTML = `
    <div class="barra">
      <h2>${esc(e.razao_social)}</h2>
      <div class="barra-btns">
        <span class="dica" style="margin-right:4px">👁 Ver como:</span>
        <button class="btn-primario btn-mini" onclick="visualizarEmpresa('${id}', '${esc(e.razao_social).replace(/'/g, "\\'")}', 'admin')">Admin</button>
        <button class="btn-mini" onclick="visualizarEmpresa('${id}', '${esc(e.razao_social).replace(/'/g, "\\'")}', 'responsavel_tecnico')">RT</button>
        <button class="btn-mini" onclick="visualizarEmpresa('${id}', '${esc(e.razao_social).replace(/'/g, "\\'")}', 'tecnico')">Técnico</button>
        <button onclick="abrirManutencaoSA()" title="Todos os dados da empresa e dos clientes finais dela, para manutenção">🗂 Dados completos</button>
        <button onclick="liberarEmpresaSA()" title="Mantém a empresa ativa até a data escolhida, mesmo inadimplente (escudo contra as suspensões automáticas)">🔓 Liberar temporariamente</button>
        <span id="sa-liberacao-badge"></span>
        <button onclick="mostrarLinkConviteAdmin('${id}')">🔗 Link do convite</button>
        <button onclick="reenviarConviteAdmin('${id}')">✉️ Reenviar por e-mail</button>
        <button style="color:#b02a37;border-color:#b02a37" onclick="abrirLimparCertsSA(window._saEmpresaId, document.querySelector('#sa-conteudo h2')?.textContent || '')">🗑 Limpar certificados</button>
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
        <label>Nome fantasia <input type="text" id="ed-fantasia" value="${esc(e.nome_fantasia || '')}"
          placeholder="Como a empresa é conhecida"></label>
        <label>CNPJ <input type="text" value="${esc(e.cnpj)}" disabled></label>
        <label>Subdomínio <input type="text" id="ed-subdominio" value="${esc(e.subdominio || '')}"></label>
        <label>Autorização Inmetro
          <input type="text" id="ed-autorizacao" value="${esc(e.num_autorizacao || '')}"></label>
        <label>Prefixo do certificado${e.qtd_certificados > 0 ? ' 🔒' : ''}
          <input type="text" id="ed-prefixo" value="${esc(e.prefixo_cert || '')}" maxlength="8"
            ${e.qtd_certificados > 0 ? 'disabled title="Bloqueado: a empresa já emitiu certificados"' : ''}></label>
        <label>Próximo número (só leitura)
          <input type="text" value="${e.proximo_numero ?? '—'}" disabled></label>
        <label>Plano (definido pelo contrato ativo)
          <input type="text" style="text-transform:capitalize" disabled value="${(() => {
            const ativo = (contratos || []).find(x => x.ativo);
            return ativo ? (window._saPlanos?.[ativo.id]?.plano || 'personalizado') : 'sem contrato (avaliação)';
          })()}"></label>
        <label>Status <select id="ed-status">${statusSel}</select></label>
        <label>Limite de usuários (0 = ilimitado)
          <input type="number" id="ed-limite" value="${e.limite_usuarios}"></label>
        <label>Carência após fim do contrato (dias até o bloqueio)
          <input type="number" id="ed-carencia" min="0" value="${e.dias_carencia_contrato ?? 15}"></label>
        <label>Cadastrada em (só leitura)
          <input type="text" value="${e.criado_em ? new Date(e.criado_em).toLocaleDateString('pt-BR') : '—'}" disabled></label>
        <label>Representante legal (p/ contrato)
          <input type="text" id="ed-rep-nome" placeholder="Nome completo"></label>
        <label>CPF do representante
          <input type="text" id="ed-rep-cpf" placeholder="000.000.000-00"></label>
        <label>Endereço (rua, nº, bairro)
          <input type="text" id="ed-endereco" placeholder="Rua Exemplo, 123, Centro"></label>
        <label>CEP <input type="text" id="ed-cep" placeholder="00000-000"></label>
        <label>Cidade/UF <input type="text" id="ed-cidade-uf" placeholder="Contagem/MG"></label>
        <label>Telefone <input type="text" id="ed-telefone" placeholder="(31) 0000-0000"></label>
        <label>E-mail da empresa <input type="email" id="ed-email-emp" placeholder="contato@empresa.com.br"></label>
      </div>
      <div style="display:flex;align-items:flex-start;gap:10px;margin-top:12px;
                  background:#f7f9fb;border:1px solid #dde5ec;border-radius:10px;padding:10px 12px">
        <input type="checkbox" id="ed-portal" onchange="salvarPortalSA(this.checked)"
               style="width:18px;height:18px;margin:2px 0 0;flex:0 0 auto">
        <span style="line-height:1.45">🌐 <b>Portal do Cliente ativo</b><br>
          <span class="dica">Segue o plano automaticamente (Essencial não tem).
            Marque para abrir exceção a esta empresa.</span></span>
      </div>
      <div style="display:flex;align-items:flex-start;gap:10px;margin-top:8px;
                  background:#fdf6ea;border:1px solid #ecdcc0;border-radius:10px;padding:10px 12px">
        <input type="checkbox" id="ed-emails-susp" onchange="salvarEmailsSuspensosSA(this.checked)"
               style="width:18px;height:18px;margin:2px 0 0;flex:0 0 auto">
        <span style="line-height:1.45">🔇 <b>Suspender avisos a esta empresa</b><br>
          <span class="dica">Para quando a equipe dela pede para não receber mais.
            Bloqueia resumos, lembretes e avisos administrativos <b>para os usuários dela</b> —
            certificados, convites, senhas e cobranças continuam. O que a empresa envia aos
            clientes dela não é afetado.</span></span>
      </div>
      ${e.qtd_certificados > 0
        ? '<p class="dica">🔒 O prefixo fica bloqueado após a primeira emissão, para não misturar numerações. CNPJ e próximo número também não são editáveis.</p>'
        : '<p class="dica">⚠️ Defina o prefixo com cuidado: após a primeira emissão ele fica bloqueado.</p>'}
      <button class="btn-primario btn-mini" onclick="salvarEmpresaSA()">Salvar alterações</button>
      <p id="ed-msg" class="dica"></p>
    </div>

    <div class="card">
      <div class="barra"><h3>👥 Contatos</h3>
        <button class="btn-mini" onclick="formContatoSA()">+ Contato</button></div>
      <div id="sa-contatos"><p class="dica">Carregando contatos…</p></div>
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
      plano: window._saPlanoLegado,   // campo legado: agora o plano vem do contrato
      status: $('#ed-status').value,
      limiteUsuarios: Number($('#ed-limite').value) || 0,
      subdominio: $('#ed-subdominio').value.trim(),
      numAutorizacao: $('#ed-autorizacao').value.trim(),
      // prefixo só é enviado quando editável (empresa ainda sem certificados)
      prefixoCert: prefixoEl.disabled ? null : prefixoEl.value.trim().toUpperCase(),
      carencia: Number($('#ed-carencia').value)
    })});
    await saApi('/empresas/' + id + '/rep-legal', { method: 'PUT', body: JSON.stringify({
      nome: $('#ed-rep-nome')?.value.trim() || null,
      cpf: $('#ed-rep-cpf')?.value.trim() || null
    })});
    await saApi('/empresas/' + id + '/dados-contato', { method: 'PUT', body: JSON.stringify({
      endereco: $('#ed-endereco')?.value.trim() || null,
      cep: $('#ed-cep')?.value.trim() || null,
      cidadeUf: $('#ed-cidade-uf')?.value.trim() || null,
      telefone: $('#ed-telefone')?.value.trim() || null,
      email: $('#ed-email-emp')?.value.trim() || null
    })});
    // Nome fantasia: só grava se o valor foi carregado ou o campo foi preenchido
    // (evita apagar um fantasia existente caso o GET não devolva o campo)
    const nf = $('#ed-fantasia')?.value.trim() ?? '';
    if (nf || window._saFantasiaCarregado != null)
      await saApi('/empresas/' + id + '/nome-fantasia', { method: 'PUT',
        body: JSON.stringify({ nome: nf || null }) });
    $('#ed-msg').textContent = '✅ Salvo.';
    $('#ed-msg').style.color = '#146c43';
    toast('Empresa atualizada.', 'ok');
  } catch (e) { $('#ed-msg').textContent = e.message; $('#ed-msg').style.color = '#b02a37'; }
}

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
          <label>Plano comercial
            <select id="edc-plano" onchange="aplicarPlanoPadrao('edc')">
              ${['', 'essencial', 'profissional', 'enterprise'].map(p => `<option value="${p}"
                ${(window._saPlanos?.[c.id]?.plano || '') === p ? 'selected' : ''}>${p ? p.charAt(0).toUpperCase() + p.slice(1) : 'Personalizado (sem plano)'}</option>`).join('')}
            </select></label>
          <label>Máx. usuários <input type="number" id="edc-max-usu" min="1" placeholder="ilimitado"
            value="${window._saPlanos?.[c.id]?.max_usuarios ?? ''}"></label>
          <label>Máx. certificados/mês <input type="number" id="edc-max-certs" min="1" placeholder="ilimitado"
            value="${window._saPlanos?.[c.id]?.max_certs_mes ?? ''}"></label>
          <label>Início * <input type="date" id="edc-inicio" value="${d10(c.inicio)}"></label>
          <label>Fim (opcional) <input type="date" id="edc-fim" value="${d10(c.fim)}"></label>
          <label>Dia do vencimento <input type="number" id="edc-dia-venc" min="1" max="28" value="${c.dia_vencimento || 10}"></label>
          <label>Implantação/treinamento (R$)
            <input type="number" step="0.01" id="edc-implantacao"
              value="${Number(window._saPlanos?.[c.id]?.valor_implantacao) || 0}"
              title="Editar aqui NÃO relança a cobrança — só atualiza o valor usado no contrato impresso"></label>
          <label>Desconto
            <select id="edc-desc-tipo">
              ${['', 'percentual', 'valor'].map(t => `<option value="${t}"
                ${(window._saPlanos?.[c.id]?.desconto_tipo || '') === t ? 'selected' : ''}>${t === 'percentual' ? 'Percentual (%)' : t === 'valor' ? 'Valor fixo (R$)' : 'Sem desconto'}</option>`).join('')}
            </select></label>
          <label>Valor do desconto <input type="number" step="0.01" id="edc-desc-valor"
            value="${Number(window._saPlanos?.[c.id]?.desconto_valor) || ''}"></label>
          <label>Desconto válido até <input type="date" id="edc-desc-ate" title="Vazio = desconto permanente"
            value="${window._saPlanos?.[c.id]?.desconto_ate ? String(window._saPlanos[c.id].desconto_ate).substring(0, 10) : ''}"></label>
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
    gerarAutomatico: $('#edc-auto').checked,
    plano: $('#edc-plano').value || null,
    maxUsuarios: Number($('#edc-max-usu').value) || null,
    maxCertsMes: Number($('#edc-max-certs').value) || null,
    descontoTipo: $('#edc-desc-tipo').value || null,
    descontoValor: Number($('#edc-desc-valor').value) || null,
    descontoAte: $('#edc-desc-ate').value || null,
    valorImplantacao: Number($('#edc-implantacao').value) || 0
  };
  if (corpo.descontoTipo && !corpo.descontoValor) {
    erro.textContent = 'Informe o valor do desconto.'; $('#edc-desc-valor').focus(); return;
  }
  if (corpo.descontoTipo === 'percentual' && corpo.descontoValor > 100) {
    erro.textContent = 'Desconto percentual não pode passar de 100%.'; $('#edc-desc-valor').focus(); return;
  }
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

// Padrões comerciais dos planos (limites e preço de tabela)
const PLANOS_PADRAO = {
  essencial:    { usu: 3,    certs: 60,   valor: 397 },
  profissional: { usu: 8,    certs: 200,  valor: 747 },
  enterprise:   { usu: null, certs: null, valor: 1290 }
};
function aplicarPlanoPadrao(pref) {
  const p = PLANOS_PADRAO[$(`#${pref}-plano`).value];
  if (!p) return;
  $(`#${pref}-max-usu`).value = p.usu ?? '';
  $(`#${pref}-max-certs`).value = p.certs ?? '';
  const vEl = $(`#${pref}-valor`);
  if (vEl && (!vEl.value || Number(vEl.value) === 0)) vEl.value = p.valor;
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
          <label>Plano comercial
            <select id="nc-plano" onchange="aplicarPlanoPadrao('nc')">
              <option value="">Personalizado (sem plano)</option>
              <option value="essencial">Essencial</option>
              <option value="profissional">Profissional</option>
              <option value="enterprise">Enterprise</option>
            </select></label>
          <label>Máx. usuários <input type="number" id="nc-max-usu" min="1" placeholder="ilimitado"></label>
          <label>Máx. certificados/mês <input type="number" id="nc-max-certs" min="1" placeholder="ilimitado"></label>
          <label>Início * <input type="date" id="nc-inicio"></label>
          <label>Fim (opcional) <input type="date" id="nc-fim"></label>
          <label>Dia do vencimento <input type="number" id="nc-dia-venc" min="1" max="28" value="10"></label>
          <label>Implantação/treinamento (R$)
            <input type="number" step="0.01" id="nc-implantacao" value="1200"
              title="Cobrança única lançada no financeiro ao criar o contrato (0 = isenta)"></label>
          <label>Desconto
            <select id="nc-desc-tipo">
              <option value="">Sem desconto</option>
              <option value="percentual">Percentual (%)</option>
              <option value="valor">Valor fixo (R$)</option>
            </select></label>
          <label>Valor do desconto <input type="number" step="0.01" id="nc-desc-valor" placeholder="ex.: 20"></label>
          <label>Desconto válido até <input type="date" id="nc-desc-ate" title="Vazio = desconto permanente"></label>
          <label class="chk" style="align-self:end">
            <input type="checkbox" id="nc-auto" checked> Gerar cobranças automaticamente</label>
        </div>
        <label>Observação <textarea id="nc-obs" rows="2"></textarea></label>
        <div class="rodape-acoes" style="margin-top:10px">
          <button onclick="this.closest('.modal-fundo').remove()">Cancelar</button>
          <button class="btn-primario" onclick="salvarContrato()">🗓 Ver prévia e criar</button>
        </div>
        <p id="nc-erro" class="erro"></p>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', modal);
}

// Suspende os avisos administrativos a uma empresa (pedido da equipe dela)
async function salvarEmailsSuspensosSA(suspender) {
  try {
    await saApi('/empresas/' + window._saEmpresaId + '/emails-suspensos',
      { method: 'PUT', body: JSON.stringify({ suspender }) });
    toast(suspender
      ? 'Avisos administrativos suspensos para esta empresa 🔇'
      : 'Avisos administrativos reativados para esta empresa.', 'ok', 5000);
  } catch (e) { toast(e.message, 'erro'); }
}

// ── Lista de supressão de e-mails ────────────────────────────
async function renderSupressoesSA() {
  const box = $('#sa-conteudo');
  box.innerHTML = '<div class="card"><p class="dica">Carregando…</p></div>';
  let lista;
  try { lista = await saApi('/supressoes'); }
  catch (e) { box.innerHTML = `<div class="card"><p class="erro">${e.message}</p></div>`; return; }
  const dtc = v => v ? new Date(v).toLocaleDateString('pt-BR') : '—';
  const ESCOPO = {
    todos: '<span class="badge rep">tudo bloqueado</span>',
    avisos: '<span class="badge" style="background:#fff3cd;color:#856404">só avisos</span>'
  };
  box.innerHTML = `
    <div class="barra" style="margin-bottom:12px">
      <h2>🔇 E-mails suspensos</h2>
      <div class="barra-btns">
        <button class="btn-mini" onclick="renderSupressoesSA()">↻ Atualizar</button>
        <button onclick="renderPainelSA()">← Empresas</button>
      </div>
    </div>

    <div class="card">
      <h3>Suspender um endereço</h3>
      <p class="dica">Use quando alguém pedir para não receber mais. O bloqueio vale
        imediatamente para qualquer envio do sistema, e cada tentativa fica registrada
        no log como “suprimido” (nada é enviado às escondidas).</p>
      <div class="form-grid" style="margin-top:10px">
        <label>E-mail <input type="email" id="sup-email" placeholder="pessoa@empresa.com.br"></label>
        <label>O que bloquear
          <select id="sup-escopo">
            <option value="todos">Tudo — nenhum e-mail do sistema</option>
            <option value="avisos">Só avisos e lembretes (mantém certificado, convite, senha e cobrança)</option>
          </select></label>
        <label>Motivo (fica no histórico)
          <input type="text" id="sup-motivo" placeholder="ex.: cliente pediu por telefone em 29/07"></label>
      </div>
      <button class="btn-primario btn-mini" style="margin-top:10px"
        onclick="salvarSupressao()">🔇 Suspender envios</button>
      <p id="sup-erro" class="erro"></p>
    </div>

    <div class="card">
      <div class="barra"><h3>Endereços suspensos (${lista.length})</h3></div>
      ${!lista.length ? '<p class="dica">Nenhum endereço suspenso.</p>' : `
      <div class="tabela-scroll"><table>
        <thead><tr><th>E-mail</th><th>Escopo</th><th>Motivo</th><th>Desde</th>
          <th>Por</th><th class="num">Bloqueados</th><th></th></tr></thead>
        <tbody>${lista.map(s => `<tr>
          <td class="mono"><b>${esc(s.email)}</b></td>
          <td>${ESCOPO[s.escopo] || esc(s.escopo)}</td>
          <td class="dica">${esc(s.motivo || '—')}</td>
          <td class="dica">${dtc(s.criado_em)}</td>
          <td class="dica">${esc(s.criado_por_nome || '—')}</td>
          <td class="num">${s.suprimidos || 0}${s.ultimo_bloqueio
            ? `<br><span class="dica">${dtc(s.ultimo_bloqueio)}</span>` : ''}</td>
          <td><button class="btn-mini" onclick="liberarSupressao('${esc(s.email)}')">↩ Liberar</button></td>
        </tr>`).join('')}</tbody>
      </table></div>`}
    </div>

    <div class="card">
      <p class="dica">💡 Para suspender os avisos de <b>uma empresa inteira</b> (a equipe dela),
        abra a empresa em <b>Empresas → Dados e plano</b> e marque
        <b>🔇 Suspender avisos a esta empresa</b>. Aquela chave não afeta os e-mails que a
        empresa envia aos clientes dela.</p>
    </div>`;
  window.scrollTo(0, 0);
}

async function salvarSupressao() {
  const email = $('#sup-email').value.trim();
  if (!email || !email.includes('@')) { $('#sup-erro').textContent = 'Informe um e-mail válido.'; return; }
  try {
    await saApi('/supressoes', { method: 'POST', body: JSON.stringify({
      email, escopo: $('#sup-escopo').value, motivo: $('#sup-motivo').value.trim() || null }) });
    toast('Envios suspensos para ' + email + ' 🔇', 'ok', 5000);
    renderSupressoesSA();
  } catch (e) { $('#sup-erro').textContent = e.message; }
}

async function liberarSupressao(email) {
  if (!await modalConfirmar('Liberar envios',
    `Voltar a enviar e-mails para ${email}?`, { textoSim: 'Liberar', textoNao: 'Cancelar' })) return;
  try {
    await saApi('/supressoes?email=' + encodeURIComponent(email), { method: 'DELETE' });
    toast('Envios liberados para ' + email, 'ok');
    renderSupressoesSA();
  } catch (e) { toast(e.message, 'erro'); }
}

// atalho: suprimir direto do painel de e-mails
async function suprimirDoPainel(email) {
  const motivo = prompt(`Suspender envios para ${email}.\n\nMotivo (fica no histórico):`,
    'endereço com falhas repetidas');
  if (motivo === null) return;
  try {
    await saApi('/supressoes', { method: 'POST',
      body: JSON.stringify({ email, escopo: 'todos', motivo }) });
    toast('Envios suspensos para ' + email + ' 🔇', 'ok', 5000);
    renderPainelEmailSA();
  } catch (e) { toast(e.message, 'erro'); }
}

// Portal do Cliente: exceção manual por empresa (o plano define o padrão)
async function salvarPortalSA(ativo) {
  try {
    await saApi('/empresas/' + window._saEmpresaId + '/portal',
      { method: 'PUT', body: JSON.stringify({ ativo }) });
    toast(ativo ? 'Portal do Cliente liberado para esta empresa ✓'
                : 'Portal do Cliente desativado para esta empresa.', 'ok');
  } catch (e) { toast(e.message, 'erro'); }
}

// Liberação temporária: mantém a empresa ativa mesmo inadimplente até a data
async function liberarEmpresaSA() {
  const dc = window._saDadosContrato;
  const atual = dc?.liberado_ate
    ? new Date(String(dc.liberado_ate).substring(0, 10) + 'T00:00:00').toLocaleDateString('pt-BR')
    : null;
  const dias = prompt(
    (atual ? `Liberação vigente até ${atual}.\n` : '') +
    'Liberar a empresa por quantos DIAS a partir de hoje?\n' +
    '(a empresa fica ativa mesmo inadimplente até a data — digite 0 para REMOVER a liberação)',
    '15');
  if (dias === null) return;
  const n = Number(dias);
  if (isNaN(n) || n < 0 || n > 90) { toast('Informe um número de dias entre 0 e 90.', 'erro'); return; }
  let ate = null;
  if (n > 0) {
    const d = new Date(); d.setDate(d.getDate() + n);
    ate = d.toISOString().substring(0, 10);
  }
  try {
    await saApi('/empresas/' + window._saEmpresaId + '/liberar',
      { method: 'PUT', body: JSON.stringify({ ate }) });
    toast(n > 0
      ? `Empresa liberada por ${n} dia(s), até ${new Date(ate + 'T00:00:00').toLocaleDateString('pt-BR')} ✓`
      : 'Liberação removida — as regras automáticas voltam a valer.', 'ok');
    abrirEmpresaSA(window._saEmpresaId);
  } catch (e) { toast(e.message, 'erro'); }
}

// ── Contatos da empresa (super-admin) ─────────────────────────
async function carregarContatosSA(id) {
  const box = document.getElementById('sa-contatos');
  if (!box) return;
  let lista;
  try { lista = await saApi('/empresas/' + id + '/contatos'); }
  catch (e) { box.innerHTML = '<p class="erro">Erro ao carregar contatos.</p>'; return; }
  window._saContatos = lista;
  if (!lista.length) {
    box.innerHTML = '<p class="dica">Nenhum contato cadastrado. Use "+ Contato" para registrar as pessoas de referência (comercial, financeiro, técnico…).</p>';
    return;
  }
  box.innerHTML = `<div class="tabela-scroll"><table>
    <thead><tr><th>Nome</th><th>Cargo</th><th>E-mail</th><th>Telefone</th><th></th></tr></thead>
    <tbody>${lista.map(ct => `<tr>
      <td><b>${esc(ct.nome)}</b></td>
      <td>${esc(ct.cargo || '—')}</td>
      <td>${ct.email ? `<a href="mailto:${esc(ct.email)}">${esc(ct.email)}</a>` : '—'}</td>
      <td>${esc(ct.telefone || '—')}</td>
      <td style="white-space:nowrap">
        <button class="btn-mini" onclick="formContatoSA('${ct.id}')">✏️</button>
        <button class="btn-mini" style="color:#b02a37" onclick="excluirContatoSA('${ct.id}','${esc(ct.nome).replace(/'/g, "\\'")}')">🗑</button>
      </td></tr>`).join('')}</tbody></table></div>`;
}

function formContatoSA(id) {
  const ct = id ? (window._saContatos || []).find(x => x.id === id) : null;
  const modal = `
    <div class="modal-fundo" onclick="if(event.target===this)this.remove()">
      <div class="modal-caixa" style="max-width:440px">
        <h3>${ct ? 'Editar contato' : 'Novo contato'}</h3>
        <div class="form-grid">
          <label>Nome * <input type="text" id="ct-nome" value="${ct ? esc(ct.nome) : ''}"></label>
          <label>Cargo <input type="text" id="ct-cargo" value="${ct ? esc(ct.cargo || '') : ''}" placeholder="Ex.: Financeiro"></label>
          <label>E-mail <input type="email" id="ct-email" value="${ct ? esc(ct.email || '') : ''}"
            style="text-transform:lowercase" autocapitalize="off" autocorrect="off" spellcheck="false"
            oninput="this.value = this.value.replace(/\s+/g, '').toLowerCase()"></label>
          <label>Telefone <input type="text" id="ct-fone" value="${ct ? esc(ct.telefone || '') : ''}" placeholder="(31) 90000-0000"></label>
        </div>
        <div class="rodape-acoes" style="margin-top:10px">
          <button onclick="this.closest('.modal-fundo').remove()">Cancelar</button>
          <button class="btn-primario" onclick="salvarContatoSA(${ct ? `'${ct.id}'` : 'null'})">${ct ? '💾 Salvar' : 'Criar'}</button>
        </div>
        <p id="ct-erro" class="erro"></p>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', modal);
}

async function salvarContatoSA(id) {
  const corpo = {
    nome: $('#ct-nome').value.trim(),
    cargo: $('#ct-cargo').value.trim() || null,
    email: $('#ct-email').value.trim() || null,
    telefone: $('#ct-fone').value.trim() || null
  };
  if (!corpo.nome) { $('#ct-erro').textContent = 'Informe o nome.'; return; }
  try {
    await saApi('/empresas/' + window._saEmpresaId + '/contatos' + (id ? '/' + id : ''),
      { method: id ? 'PUT' : 'POST', body: JSON.stringify(corpo) });
    document.querySelector('.modal-fundo')?.remove();
    toast('Contato salvo ✓', 'ok');
    carregarContatosSA(window._saEmpresaId);
  } catch (e) { $('#ct-erro').textContent = e.message; }
}

async function excluirContatoSA(id, nome) {
  if (!confirm(`Excluir o contato "${nome}"?`)) return;
  try {
    await saApi('/empresas/' + window._saEmpresaId + '/contatos/' + id, { method: 'DELETE' });
    toast('Contato excluído.', 'ok');
    carregarContatosSA(window._saEmpresaId);
  } catch (e) { toast(e.message, 'erro'); }
}

// Projeta as cobranças de um contrato (mesma regra da geração automática):
// competências pela periodicidade, desconto enquanto vigente. Retorna linhas + totais.
function projetarCobrancas(cfg) {
  const intervalo = { mensal: 1, trimestral: 3, semestral: 6, anual: 12 }[cfg.periodicidade] || 1;
  const ini = new Date(String(cfg.inicio).substring(0, 10) + 'T00:00:00');
  const fim = cfg.fim ? new Date(String(cfg.fim).substring(0, 10) + 'T00:00:00') : null;
  const descAte = cfg.descontoAte ? new Date(String(cfg.descontoAte).substring(0, 10) + 'T00:00:00') : null;
  const descValor = Number(cfg.descontoValor) || 0;
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const mesesDesde = (a, b) => (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  const base = cfg.desdeInicio ? ini : new Date(Math.max(ini, hoje));
  let comp = new Date(base.getFullYear(), base.getMonth(), 1);
  while (mesesDesde(new Date(ini.getFullYear(), ini.getMonth(), 1), comp) % intervalo !== 0)
    comp = new Date(comp.getFullYear(), comp.getMonth() + 1, 1);

  const linhas = [];
  const tot = { tabela: 0, desconto: 0, cobrar: 0 };
  const maxN = cfg.maxParcelas || 12;
  for (let i = 0; i < maxN; i++) {
    if (fim && comp > fim) break;
    const venc = new Date(comp.getFullYear(), comp.getMonth(), 1 + ((cfg.diaVencimento || 10) - 1));
    const comDesc = descValor > 0 && (!descAte || comp <= descAte);
    const efetivo = !comDesc ? Number(cfg.valor)
      : cfg.descontoTipo === 'percentual'
        ? Number(cfg.valor) * (1 - Math.min(descValor, 100) / 100)
        : Math.max(0, Number(cfg.valor) - descValor);
    const descAplicado = Number(cfg.valor) - efetivo;
    tot.tabela += Number(cfg.valor); tot.desconto += descAplicado; tot.cobrar += efetivo;
    linhas.push({
      comp, venc, tabela: Number(cfg.valor), descAplicado, efetivo,
      chave: `${comp.getFullYear()}-${String(comp.getMonth() + 1).padStart(2, '0')}`,
      rotDesc: !comDesc ? '—'
        : cfg.descontoTipo === 'percentual'
          ? `−${descValor}% (−${brl(descAplicado)})` : `−${brl(descValor)}`
    });
    comp = new Date(comp.getFullYear(), comp.getMonth() + intervalo, 1);
  }
  return { linhas, tot, ateFim: !!fim };
}

// Cronograma do contrato: projeta as próximas cobranças exatamente como a
// geração automática fará (competências pela periodicidade, desconto vigente),
// cruzando com as cobranças JÁ geradas para mostrar o status real
function cronogramaContrato(cid) {
  const c = (window._saContratos || []).find(x => x.id === cid);
  if (!c) { toast('Contrato não encontrado. Recarregue a tela.', 'erro'); return; }
  const pl = window._saPlanos?.[cid] || {};

  if (c.periodicidade === 'avulso') {
    toast('Contrato avulso não gera cobranças automáticas — use "+ Cobrança".', 'erro'); return;
  }

  const proj = projetarCobrancas({
    valor: c.valor, periodicidade: c.periodicidade, inicio: c.inicio, fim: c.fim,
    diaVencimento: c.dia_vencimento, descontoTipo: pl.desconto_tipo,
    descontoValor: pl.desconto_valor, descontoAte: pl.desconto_ate
  });

  // cobranças já geradas deste contrato, por competência YYYY-MM
  const geradas = {};
  (window._saCobrancas || []).forEach(cb => {
    if (cb.contrato === c.descricao)
      geradas[String(cb.competencia).substring(0, 7)] = cb.status;
  });

  const linhas = proj.linhas.map(l => {
    const st = geradas[l.chave];
    return `<tr${st ? '' : ' style="opacity:.8"'}>
      <td>${l.comp.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</td>
      <td>${l.venc.toLocaleDateString('pt-BR')}</td>
      <td class="num">${brl(l.tabela)}</td>
      <td class="num">${l.rotDesc}</td>
      <td class="num"><b>${brl(l.efetivo)}</b></td>
      <td>${st ? cobStatus(st) : '<span class="dica">a gerar</span>'}</td>
    </tr>`;
  });
  const totalPeriodo = proj.tot.cobrar;

  const aviso = !c.ativo
    ? '<p class="erro">⏸ Contrato encerrado: nada será gerado enquanto estiver inativo.</p>'
    : !c.gerar_automatico
      ? '<p class="erro">⚠️ "Gerar cobranças automaticamente" está desligado neste contrato — a projeção abaixo NÃO será gerada sozinha.</p>'
      : '';

  const modal = `
    <div class="modal-fundo" onclick="if(event.target===this)this.remove()">
      <div class="modal-caixa" style="max-width:640px">
        <h3>🗓 Cronograma — ${esc(c.descricao)}</h3>
        <p class="dica">Projeção das próximas ${linhas.length} cobranças
          (${esc(c.periodicidade)}, vencimento dia ${c.dia_vencimento || 10})${c.fim ? `, até o fim do contrato em ${dbrSA(c.fim)}` : ''}.
          Espelha exatamente a regra da geração automática, incluindo o desconto vigente.</p>
        ${aviso}
        <div class="tabela-scroll" style="max-height:340px">
          <table>
            <thead><tr><th>Competência</th><th>Vencimento</th><th class="num">Tabela</th>
              <th class="num">Desconto</th><th class="num">A cobrar</th><th>Situação</th></tr></thead>
            <tbody>${linhas.join('') || '<tr><td colspan="6" class="dica">Nada a projetar.</td></tr>'}</tbody>
          </table>
        </div>
        <p class="dica" style="margin-top:8px">Período projetado —
          tabela: <b>${brl(proj.tot.tabela)}</b> ·
          descontos: <b style="color:#c88a00">−${brl(proj.tot.desconto)}</b> ·
          a cobrar: <b style="color:#146c43">${brl(totalPeriodo)}</b></p>
        <div class="rodape-acoes" style="margin-top:10px">
          <button onclick="this.closest('.modal-fundo').remove()">Fechar</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', modal);
}

// Valor em reais por extenso (até centenas de milhões)
function valorPorExtenso(v) {
  const u = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove',
    'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
  const d = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  const c = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos',
    'setecentos', 'oitocentos', 'novecentos'];
  const ate999 = n => {
    if (n === 0) return '';
    if (n === 100) return 'cem';
    const cc = Math.floor(n / 100), r = n % 100;
    const dd = Math.floor(r / 10), uu = r % 10;
    let s = cc ? c[cc] : '';
    if (r) {
      if (s) s += ' e ';
      if (r < 20) s += u[r];
      else { s += d[dd]; if (uu) s += ' e ' + u[uu]; }
    }
    return s;
  };
  const inteiro = Math.floor(v), cent = Math.round((v - inteiro) * 100);
  const mi = Math.floor(inteiro / 1000000), milhar = Math.floor((inteiro % 1000000) / 1000), resto = inteiro % 1000;
  const partes = [];
  if (mi) partes.push(ate999(mi) + (mi === 1 ? ' milhão' : ' milhões'));
  if (milhar) partes.push(milhar === 1 ? 'mil' : ate999(milhar) + ' mil');
  if (resto) partes.push(ate999(resto));
  let s = partes.join(' e ') || 'zero';
  s += inteiro === 1 ? ' real' : ' reais';
  if (cent) s += ' e ' + ate999(cent) + (cent === 1 ? ' centavo' : ' centavos');
  return s;
}

// Gera o contrato de fornecimento PREENCHIDO com os dados da empresa e do
// contrato selecionado; abre em nova aba pronta para imprimir/assinar
async function gerarContratoPreenchido(cid) {
  const c = (window._saContratos || []).find(x => x.id === cid);
  const pl = window._saPlanos?.[cid] || {};
  let dc = window._saDadosContrato;
  if (!dc) {
    try { dc = await saApi('/empresas/' + window._saEmpresaId + '/dados-contrato'); }
    catch (e) { toast('Não foi possível carregar os dados da empresa.', 'erro'); return; }
  }
  if (!c) { toast('Contrato não encontrado. Recarregue a tela.', 'erro'); return; }

  // ── VALIDAÇÃO DURA: o contrato só sai com TODOS os dados do sistema ──
  const faltando = [];
  const exigir = (v, rotulo, onde) => { if (!v || !String(v).trim()) faltando.push(`<b>${rotulo}</b> <span class="dica">(${onde})</span>`); };
  exigir(dc.razao_social, 'Razão social', 'Dados e plano');
  exigir(dc.cnpj, 'CNPJ', 'Dados e plano');
  exigir(dc.endereco, 'Endereço', 'Dados e plano');
  exigir(dc.cep, 'CEP', 'Dados e plano');
  exigir(dc.cidade_uf, 'Cidade/UF', 'Dados e plano');
  exigir(dc.email, 'E-mail da empresa', 'Dados e plano');
  exigir(dc.rep_legal_nome, 'Representante legal (nome)', 'Dados e plano');
  exigir(dc.rep_legal_cpf, 'CPF do representante', 'Dados e plano');
  exigir(c.valor, 'Valor da mensalidade', 'no contrato — ✎ Editar');
  exigir(c.inicio, 'Data de início', 'no contrato — ✎ Editar');
  exigir(c.dia_vencimento, 'Dia do vencimento', 'no contrato — ✎ Editar');
  if (faltando.length) {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal-fundo" onclick="if(event.target===this)this.remove()">
        <div class="modal-caixa" style="max-width:480px">
          <h3>⚠️ Contrato não gerado — dados faltando</h3>
          <p class="dica">Para garantir um contrato completo e sem lacunas, preencha antes:</p>
          <ul style="margin:10px 0 0 20px;line-height:1.9">${faltando.map(f => `<li>${f}</li>`).join('')}</ul>
          <div class="rodape-acoes" style="margin-top:14px">
            <button class="btn-primario" onclick="this.closest('.modal-fundo').remove()">Entendi, vou preencher</button>
          </div>
        </div>
      </div>`);
    return;
  }

  const implantacaoNum = Number(pl.valor_implantacao) || 0;

  let modelo;
  try { modelo = await (await fetch('/contrato-modelo.html')).text(); }
  catch (e) { toast('Modelo do contrato não encontrado no servidor.', 'erro'); return; }

  const brData = dt => new Date(dt).toLocaleDateString('pt-BR');
  const hoje = new Date();
  const meses = ['janeiro','fevereiro','março','abril','maio','junho','julho',
                 'agosto','setembro','outubro','novembro','dezembro'];
  const dataExtenso = `${hoje.getDate()} de ${meses[hoje.getMonth()]} de ${hoje.getFullYear()}`;

  // Desconto: linha no quadro + cláusula 4.6 condicional
  let linhaDesc = '', clausulaDesc = '';
  if (Number(pl.desconto_valor) > 0) {
    const rot = pl.desconto_tipo === 'percentual'
      ? `${Number(pl.desconto_valor)}% (${valorPorExtenso(Number(pl.desconto_valor)).replace(/ rea(l|is).*/, ' por cento')})`
      : `R$ ${Number(pl.desconto_valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    const ate = pl.desconto_ate
      ? ` para as competências até ${brData(pl.desconto_ate)}` : ', em caráter permanente';
    linhaDesc = ` Fica concedido desconto de ${rot} sobre a mensalidade${ate}.`;
    clausulaDesc = `<p>4.6. Fica concedido ao CONTRATANTE desconto de <b>${rot}</b> sobre a
      mensalidade${ate}, aplicado automaticamente na geração de cada cobrança. Cessado o período
      do desconto, prevalece integralmente o valor do Quadro Resumo.</p>`;
  }

  // Vigência: quadro + cláusula 3ª conforme prazo determinado ou indeterminado
  const vigenciaResumo = c.fim
    ? `De ${brData(c.inicio)} a <b>${brData(c.fim)}</b> (prazo determinado).`
    : `Início em ${brData(c.inicio)}, por <b>prazo indeterminado</b>.`;
  const clausulaVigencia = c.fim
    ? `<p>3.1. Este contrato vigora por <b>prazo determinado</b>, de ${brData(c.inicio)} até
       <b>${brData(c.fim)}</b>, quando se encerra independentemente de notificação, salvo se as
       partes formalizarem a renovação.</p>
       <p>3.2. A rescisão antecipada imotivada pelo CONTRATANTE não o exonera dos valores
       relativos aos períodos já utilizados, aplicando-se, quanto aos dados, a cláusula 8.2.</p>`
    : `<p>3.1. Este contrato vigora por <b>prazo indeterminado</b> a partir de ${brData(c.inicio)},
       podendo ser denunciado por qualquer das partes, sem ônus, mediante comunicação escrita com
       <b>30 (trinta) dias</b> de antecedência.</p>
       <p>3.2. Havendo contratação na modalidade anual com benefício promocional, o período anual
       será cumprido integralmente, renovando-se por iguais períodos salvo manifestação em contrário
       de qualquer das partes com 30 dias de antecedência do término.</p>`;

  // Resumo financeiro do quadro: mensalidade efetiva, total do período, implantação
  const projC = projetarCobrancas({
    valor: c.valor, periodicidade: c.periodicidade, inicio: c.inicio, fim: c.fim,
    diaVencimento: c.dia_vencimento, descontoTipo: pl.desconto_tipo,
    descontoValor: pl.desconto_valor, descontoAte: pl.desconto_ate,
    desdeInicio: true, maxParcelas: c.fim ? 120 : 12
  });
  const mensalEfetiva = projC.linhas.length ? projC.linhas[0].efetivo : Number(c.valor);
  const money = v => 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  const resumoValores =
    `Mensalidade vigente: <b>${money(mensalEfetiva)}</b>` +
    (mensalEfetiva !== Number(c.valor) ? ` (tabela ${money(c.valor)}, com o desconto do item 4.6)` : '') +
    (c.fim
      ? `. Valor total do período contratado (${projC.linhas.length} parcela(s)): <b>${money(projC.tot.cobrar)}</b>` +
        (projC.tot.desconto > 0 ? `, já considerados ${money(projC.tot.desconto)} em descontos` : '') + '.'
      : `. Contrato por prazo indeterminado: as 12 primeiras competências somam <b>${money(projC.tot.cobrar)}</b>` +
        (projC.tot.desconto > 0 ? ` (${money(projC.tot.desconto)} em descontos)` : '') + '.') +
    (implantacaoNum > 0
      ? ` Implantação: <b>${money(implantacaoNum)}</b> em parcela única, cobrada à parte.`
      : ' Implantação: isenta.');

  // Suporte conforme o plano
  const suportePorPlano = {
    essencial: `<p>6.3. <b>Suporte técnico (plano Essencial):</b> atendimento por WhatsApp e e-mail
      em horário comercial (segunda a sexta, 8h às 18h), com primeira resposta em até
      <b>1 (um) dia útil</b>.</p>`,
    profissional: `<p>6.3. <b>Suporte técnico (plano Profissional):</b> atendimento por WhatsApp,
      e-mail e telefone em horário comercial (segunda a sexta, 8h às 18h), com primeira resposta
      em até <b>4 (quatro) horas úteis</b>.</p>`,
    enterprise: `<p>6.3. <b>Suporte técnico prioritário (plano Enterprise):</b> atendimento por
      WhatsApp, e-mail e telefone com fila prioritária, primeira resposta em até
      <b>2 (duas) horas úteis</b> em horário comercial e canal de urgência para indisponibilidade
      total do sistema, inclusive fora do horário comercial.</p>`
  };
  const clausulaSuporte = suportePorPlano[pl.plano] ||
    `<p>6.3. <b>Suporte técnico:</b> atendimento por WhatsApp e e-mail em horário comercial
      (segunda a sexta, 8h às 18h), com primeira resposta em até <b>1 (um) dia útil</b>.</p>`;

  const dados = {
    '##Cliente##': dc.razao_social || '____________________',
    '##CPF/CNPJ##': dc.cnpj || '____________________',
    '##EnderecoCliente##': [dc.endereco, dc.cidade_uf, dc.cep ? 'CEP ' + dc.cep : null].filter(Boolean).join(', ') || '____________________',
    '##RepresentanteLegal##': dc.rep_legal_nome
      ? `${dc.rep_legal_nome}${dc.rep_legal_cpf ? ' (CPF ' + dc.rep_legal_cpf + ')' : ''}`
      : '____________________',
    '##EmailCliente##': dc.email || '____________________',
    '##Plano##': (pl.plano || 'Personalizado').charAt(0).toUpperCase() + (pl.plano || 'personalizado').slice(1),
    '##MaxUsuarios##': pl.max_usuarios != null ? String(pl.max_usuarios) : 'usuários ilimitados —',
    '##MaxCertificadosMes##': pl.max_certs_mes != null ? String(pl.max_certs_mes) : 'ilimitados',
    '##ValorMensal##': Number(c.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
    '##ValorMensalExtenso##': valorPorExtenso(Number(c.valor)),
    '##DiaVencimento##': String(c.dia_vencimento || 10),
    '##ValorImplantacao##': implantacaoNum > 0
      ? Number(implantacaoNum).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) +
        ' (' + valorPorExtenso(implantacaoNum) + ')'
      : '0,00 — implantação isenta',
    '##DataInicio##': brData(c.inicio),
    '##VigenciaResumo##': vigenciaResumo,
    '##ResumoValores##': resumoValores,
    '##ClausulaVigencia##': clausulaVigencia,
    '##ClausulaSuporte##': clausulaSuporte,
    '##DiasCarencia##': String(dc.dias_carencia_contrato ?? 15),
    '##DataAssinatura##': dataExtenso,
    '##LinhaDesconto##': linhaDesc,
    '##ClausulaDesconto##': clausulaDesc
  };
  for (const [k, v] of Object.entries(dados)) modelo = modelo.split(k).join(v);

  const jan = window.open('', '_blank');
  if (!jan) { toast('Libere o pop-up para visualizar o contrato.', 'erro'); return; }
  jan.document.write(modelo);
  jan.document.close();
}

// Anexa o PDF do contrato assinado (armazenado no MinIO, vinculado ao contrato)
function anexarContratoAssinado(cid) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/pdf';
  input.onchange = async () => {
    const arq = input.files[0];
    if (!arq) return;
    if (arq.size > 10 * 1024 * 1024) { toast('Arquivo muito grande (máx. 10 MB).', 'erro'); return; }
    const fd = new FormData();
    fd.append('arquivo', arq);
    try {
      const r = await fetch(`/api/sa/empresas/${window._saEmpresaId}/contratos/${cid}/arquivo`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
        body: fd
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.erro || 'Falha ao enviar o PDF.');
      }
      toast('Contrato assinado anexado ✓', 'ok');
      abrirEmpresaSA(window._saEmpresaId);
    } catch (e) { toast(e.message, 'erro'); }
  };
  input.click();
}

async function baixarContratoAssinado(cid) {
  try {
    const r = await fetch(`/api/sa/empresas/${window._saEmpresaId}/contratos/${cid}/arquivo`, {
      headers: { Authorization: 'Bearer ' + token }
    });
    if (!r.ok) throw new Error('Arquivo não encontrado.');
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (window._saPlanos?.[cid]?.arquivo_assinado_nome) || 'contrato-assinado.pdf';
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) { toast(e.message, 'erro'); }
}

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
    gerarAutomatico: $('#nc-auto').checked,
    plano: $('#nc-plano').value || null,
    maxUsuarios: Number($('#nc-max-usu').value) || null,
    maxCertsMes: Number($('#nc-max-certs').value) || null,
    descontoTipo: $('#nc-desc-tipo').value || null,
    descontoValor: Number($('#nc-desc-valor').value) || null,
    descontoAte: $('#nc-desc-ate').value || null,
    valorImplantacao: Number($('#nc-implantacao').value) || 0
  };
  if (corpo.descontoTipo && !corpo.descontoValor) {
    erro.textContent = 'Informe o valor do desconto.'; $('#nc-desc-valor').focus(); return;
  }
  if (corpo.descontoTipo === 'percentual' && corpo.descontoValor > 100) {
    erro.textContent = 'Desconto percentual não pode passar de 100%.'; $('#nc-desc-valor').focus(); return;
  }

  // Validação detalhada, campo a campo
  if (!corpo.descricao) { erro.textContent = 'Informe a descrição do contrato.'; $('#nc-desc').focus(); return; }
  if (!$('#nc-valor').value || isNaN(corpo.valor)) { erro.textContent = 'Informe o valor do contrato (ex.: 150,00).'; $('#nc-valor').focus(); return; }
  if (corpo.valor <= 0) { erro.textContent = 'O valor deve ser maior que zero.'; $('#nc-valor').focus(); return; }
  if (!corpo.inicio) { erro.textContent = 'Informe a data de início do contrato.'; $('#nc-inicio').focus(); return; }
  if (corpo.fim && corpo.fim < corpo.inicio) { erro.textContent = 'A data de fim não pode ser anterior à data de início.'; $('#nc-fim').focus(); return; }
  if (corpo.diaVencimento < 1 || corpo.diaVencimento > 28) { erro.textContent = 'O dia do vencimento deve ser entre 1 e 28.'; $('#nc-dia-venc').focus(); return; }

  // PRÉVIA antes de criar: cronograma completo com totais para conferência
  const proj = projetarCobrancas({
    valor: corpo.valor, periodicidade: corpo.periodicidade,
    inicio: corpo.inicio, fim: corpo.fim, diaVencimento: corpo.diaVencimento,
    descontoTipo: corpo.descontoTipo, descontoValor: corpo.descontoValor,
    descontoAte: corpo.descontoAte,
    desdeInicio: true, maxParcelas: corpo.fim ? 120 : 12
  });
  window._contratoPendente = corpo;

  const linhas = proj.linhas.map(l => `<tr>
      <td>${l.comp.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</td>
      <td>${l.venc.toLocaleDateString('pt-BR')}</td>
      <td class="num">${brl(l.tabela)}</td>
      <td class="num">${l.rotDesc}</td>
      <td class="num"><b>${brl(l.efetivo)}</b></td>
    </tr>`).join('');

  const rotuloImplant = corpo.valorImplantacao > 0
    ? `<p class="dica">➕ Implantação/treinamento: <b>${brl(corpo.valorImplantacao)}</b> —
       lançada no financeiro como cobrança única, com vencimento em 7 dias.</p>` : '';
  const rotuloPeriodo = corpo.periodicidade === 'avulso'
    ? 'Contrato avulso: nenhuma cobrança automática será gerada (use "+ Cobrança").'
    : corpo.fim
      ? `${proj.linhas.length} cobrança(s) até o fim do contrato (${dbrSA(corpo.fim)})`
      : `próximas 12 competências (contrato por prazo indeterminado — segue gerando depois)`;

  const modal = `
    <div class="modal-fundo" id="modal-previa-contrato" onclick="if(event.target===this)this.remove()">
      <div class="modal-caixa" style="max-width:660px">
        <h3>🗓 Prévia do contrato — confira antes de criar</h3>
        <p class="dica"><b>${esc(corpo.descricao)}</b> · ${corpo.plano
          ? `plano <b style="text-transform:capitalize">${corpo.plano}</b> · ` : ''}${esc(corpo.periodicidade)} ·
          mensalidade de tabela <b>${brl(corpo.valor)}</b> · vencimento dia ${corpo.diaVencimento}</p>
        <p class="dica">${rotuloPeriodo}</p>
        ${rotuloImplant}
        ${corpo.periodicidade === 'avulso' ? '' : `
        <div class="tabela-scroll" style="max-height:300px">
          <table>
            <thead><tr><th>Competência</th><th>Vencimento</th><th class="num">Tabela</th>
              <th class="num">Desconto</th><th class="num">A cobrar</th></tr></thead>
            <tbody>${linhas}</tbody>
          </table>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
          <div style="flex:1;min-width:150px;background:#f7f9fb;border:1px solid #dde5ec;border-radius:10px;padding:8px 12px">
            <span class="dica">Total de tabela</span><br><b>${brl(proj.tot.tabela)}</b></div>
          <div style="flex:1;min-width:150px;background:#fdf6ea;border:1px solid #ecdcc0;border-radius:10px;padding:8px 12px">
            <span class="dica">Total de descontos</span><br><b style="color:#c88a00">−${brl(proj.tot.desconto)}</b></div>
          <div style="flex:1;min-width:150px;background:#eef7f0;border:1px solid #cfe5d6;border-radius:10px;padding:8px 12px">
            <span class="dica">Total do contrato${corpo.fim ? '' : ' (12 comp.)'}</span><br>
            <b style="color:#146c43;font-size:1.1rem">${brl(proj.tot.cobrar)}</b></div>
        </div>`}
        <div class="rodape-acoes" style="margin-top:14px">
          <button onclick="document.getElementById('modal-previa-contrato').remove()">← Voltar e ajustar</button>
          <button class="btn-primario" onclick="confirmarCriacaoContrato(this)">✅ Confirmar e criar contrato</button>
        </div>
        <p id="pv-erro" class="erro"></p>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', modal);
}

// Efetiva a criação após a prévia confirmada
async function confirmarCriacaoContrato(btn) {
  const corpo = window._contratoPendente;
  if (!corpo) return;
  btn.disabled = true; btn.textContent = '⏳ Criando...';
  try {
    await saApi('/empresas/' + window._saEmpresaId + '/contratos',
      { method: 'POST', body: JSON.stringify(corpo) });
    window._contratoPendente = null;
    document.getElementById('modal-previa-contrato')?.remove();
    document.querySelector('.modal-fundo')?.remove();
    toast('Contrato criado com sucesso ✓', 'ok');
    abrirEmpresaSA(window._saEmpresaId);
  } catch (e) {
    const el = document.getElementById('pv-erro');
    if (el) el.textContent = e.message || 'Não foi possível criar o contrato. Tente novamente.';
    btn.disabled = false; btn.textContent = '✅ Confirmar e criar contrato';
  }
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
// Cancelar substitui o excluir (João, 14/08/2026): em contrato com geração
// automática, excluir é inútil — a rotina recria a competência na madrugada
// seguinte. Cancelada, a linha permanece e bloqueia a recriação, com motivo
// registrado para auditoria.
async function cancelarCobrancaSA(id) {
  document.getElementById('modal-canc-cob')?.remove();
  const m = document.createElement('div');
  m.className = 'modal-fundo'; m.id = 'modal-canc-cob';
  m.innerHTML = `<div class="modal-caixa" style="max-width:420px">
    <h3 style="margin-top:0">🚫 Cancelar cobrança</h3>
    <p class="dica">A cobrança deixa de ser devida, mas continua no histórico —
      é isso que impede o sistema de recriá-la automaticamente.</p>
    <label>Motivo
      <select id="cc-motivo" onchange="document.getElementById('cc-outro').style.display =
        this.value === 'Outro' ? '' : 'none'">
        <option>Cortesia / bonificação</option>
        <option>Cobrança em duplicidade</option>
        <option>Contrato encerrado ou suspenso</option>
        <option>Renegociação de valores</option>
        <option>Lançamento criado por engano</option>
        <option>Outro</option>
      </select></label>
    <label id="cc-outro" style="display:none;margin-top:8px">Descreva
      <input type="text" id="cc-motivo-txt" placeholder="motivo do cancelamento"></label>
    <div class="barra-btns" style="margin-top:12px;justify-content:flex-end">
      <button class="btn-mini" onclick="this.closest('.modal-fundo').remove()">Voltar</button>
      <button class="btn-primario" onclick="cancelarCobrancaOk('${id}')">Cancelar cobrança</button>
    </div></div>`;
  document.body.appendChild(m);
}
async function cancelarCobrancaOk(id) {
  const sel = $('#cc-motivo').value;
  const motivo = sel === 'Outro' ? ($('#cc-motivo-txt').value || '').trim() : sel;
  if (!motivo) { toast('Descreva o motivo.', 'erro'); return; }
  try {
    await saApi('/cobrancas/' + id, { method: 'PUT',
      body: JSON.stringify({ status: 'cancelado', observacao: motivo }) });
    document.getElementById('modal-canc-cob')?.remove();
    toast('Cobrança cancelada — ' + motivo, 'ok', 5000);
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
     usuarios: renderUsuarios, config: renderConfig, avisos: renderAvisos,
     pesquisa: renderPesquisa }[tab])();
}

// Campos de e-mail: minúsculas na tela e no valor, sem autocapitalizar
// (no celular a primeira letra vinha maiúscula) e sem autocorreção.
const ATTRS_EMAIL = 'style="text-transform:lowercase" autocapitalize="off" '
  + 'autocorrect="off" spellcheck="false" '
  + 'oninput="this.value = this.value.replace(/\\s+/g, \'\').toLowerCase()"';

const campo = (rotulo, id, tipo = 'text', valor = '', extra = '') =>
  `<label>${rotulo}<input type="${tipo}" id="${id}" value="${esc(valor)}" ` +
  `${tipo === 'email' ? ATTRS_EMAIL + ' ' : ''}${extra}></label>`;

// ── Clientes ────────────────────────────────────────────────────
let clientesListaCache = [];

async function renderClientes() {
  const cs = await api('/clientes?incluirInativos=true');
  clientesListaCache = cs;
  $('#cad-conteudo').innerHTML = `
    <div class="card">
      <div class="barra"><h3>Clientes</h3>
        ${podeCriarCliente() ? '<button class="btn-primario btn-mini" onclick="formCliente()">+ Novo</button>' : ''}</div>
      <div id="form-area"></div>
      ${cs.length === 0 ? '' : `
        <input type="text" class="filtro-hist" placeholder="🔍 Buscar cliente por nome, CNPJ ou cidade..."
               oninput="filtrarClientesLista(this.value)">`}
      <div id="clientes-lista">${htmlClientes(cs)}</div>
    </div>`;
}

function htmlClientes(lista) {
  if (lista.length === 0) return '<p class="dica">Nenhum cliente encontrado.</p>';
  return lista.map(c => {
    const temEmail = !!c.email;
    const botaoPesquisa = ehGestor() ? (temEmail
      ? `<button class="btn-mini" title="Enviar pesquisa de satisfação"
           onclick="enviarPesquisaCliente('${c.id}', ${JSON.stringify(esc(c.razao_social)).replace(/"/g, '&quot;')})">⭐ Pesquisa</button>`
      : `<button class="btn-mini" disabled title="Cliente sem e-mail cadastrado">⭐ Pesquisa</button>`) : '';
    const botaoPortal = ehGestor() ? (c.cnpj
      ? `<button class="btn-mini" title="Escolher os contatos que receberão o convite do portal"
           onclick="convidarPortal('${c.id}', ${JSON.stringify(esc(c.razao_social)).replace(/"/g, '&quot;')})">🔗 Portal</button>`
      : `<button class="btn-mini" disabled title="Cadastre o CNPJ/CPF do cliente para liberar o portal">🔗 Portal</button>`) : '';
    return `
    <div class="item-cert">
      <span onclick="detalheCliente('${c.id}')" style="cursor:pointer">
        <b>${esc(c.razao_social)}</b>${c.nome_fantasia ? ' <span class="dica">(' + esc(c.nome_fantasia) + ')</span>' : ''}
        ${c.ativo ? '' : '<span class="badge rep">inativo</span>'}<br>
        <span class="dica">${esc(c.cidade || '')} ${esc(c.uf || '')} ${c.cnpj ? '· CNPJ ' + esc(c.cnpj) : ''}</span>
      </span>
      <span class="acoes">
        ${ehGestor() ? `<button class="btn-mini"
          title="Filiais e unidades — para escolher onde a calibração foi feita"
          onclick="abrirEnderecos('${c.id}', ${JSON.stringify(esc(c.razao_social)).replace(/"/g, '&quot;')})">📍 Endereços</button>` : ''}
        ${botaoPortal}
        ${botaoPesquisa}
        <button class="btn-mini" onclick="detalheCliente('${c.id}')">Balanças ➜</button>
      </span>
    </div>`;
  }).join('');
}

// ── Endereços do cliente (filiais, plantas, unidades) ───────
// O endereço do CADASTRO é sempre o principal; aqui ficam os adicionais.
// Com dois ou mais, o ensaio passa a perguntar onde a calibração foi feita.
async function abrirEnderecos(clienteId, nome) {
  let lista;
  try { lista = await api('/clientes/' + clienteId + '/enderecos'); }
  catch (e) { toast(e.message, 'erro'); return; }

  const linha = e => `
    <tr>
      <td><b>${esc(e.apelido)}</b>
        ${e.principal ? '<br><span class="badge">do cadastro do cliente</span>' : ''}</td>
      <td class="dica">${esc(e.endereco || '—')}
        ${e.cidade ? `<br>${esc(e.cidade)}${e.uf ? '/' + esc(e.uf) : ''}` : ''}
        ${e.cep ? ` · CEP ${esc(e.cep)}` : ''}</td>
      <td style="white-space:nowrap">${e.principal
        ? '<span class="dica">edite em Clientes</span>'
        : `<button class="btn-mini" onclick="editarEndereco('${clienteId}','${e.id}')">✏️</button>
           <button class="btn-mini" onclick="excluirEndereco('${clienteId}','${e.id}','${esc(e.apelido).replace(/'/g, "\\'")}')">🗑</button>`}
      </td>
    </tr>`;

  document.querySelector('#modal-enderecos')?.remove();
  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-fundo" id="modal-enderecos" onclick="if(event.target===this)this.remove()">
      <div class="modal-caixa" style="max-width:620px">
        <h3>📍 Endereços de ${esc(nome)}</h3>
        <p class="dica">Cadastre aqui as filiais, plantas ou unidades. Quando o cliente
          tiver <b>mais de um endereço</b>, o técnico escolhe no ensaio onde a calibração
          foi feita — e isso sai no certificado, na linha do local.</p>

        <div class="tabela-scroll" style="max-height:250px;margin:12px 0">
          <table><thead><tr><th>Nome</th><th>Endereço</th><th></th></tr></thead>
          <tbody>${lista.map(linha).join('')}</tbody></table>
        </div>

        <div style="border-top:1px solid #e3eaf2;padding-top:12px">
          <b style="font-size:.92rem" id="end-titulo">Novo endereço</b>
          <input type="hidden" id="end-id">
          <div class="form-grid" style="margin-top:8px">
            <label>Nome / apelido <input type="text" id="end-apelido"
              placeholder="Ex.: Filial Betim, Planta 2, Matriz"></label>
            <label>CEP <input type="text" id="end-cep" placeholder="00000-000"
              onblur="buscarCepEndereco()"></label>
          </div>
          <label>Endereço <input type="text" id="end-endereco"
            placeholder="Rua, número, bairro"></label>
          <div class="form-grid">
            <label>Cidade <input type="text" id="end-cidade"></label>
            <label>UF <input type="text" id="end-uf" maxlength="2" style="text-transform:uppercase"></label>
          </div>
          <div class="rodape-acoes" style="margin-top:10px">
            <button onclick="document.getElementById('modal-enderecos').remove()">Fechar</button>
            <button class="btn-primario" onclick="salvarEndereco('${clienteId}')"
              id="end-btn">Adicionar endereço</button>
          </div>
          <p id="end-erro" class="erro"></p>
        </div>
      </div>
    </div>`);
}

async function salvarEndereco(clienteId) {
  const id = $('#end-id').value;
  const dados = {
    apelido: $('#end-apelido').value.trim(),
    endereco: $('#end-endereco').value.trim() || null,
    cidade: $('#end-cidade').value.trim() || null,
    uf: $('#end-uf').value.trim().toUpperCase() || null,
    cep: $('#end-cep').value.trim() || null
  };
  if (!dados.apelido) {
    $('#end-erro').textContent = 'Dê um nome ao endereço (ex.: Filial Betim).'; return;
  }
  try {
    if (id) await api('/clientes/enderecos/' + id, { method: 'PUT', body: JSON.stringify(dados) });
    else await api('/clientes/' + clienteId + '/enderecos', { method: 'POST', body: JSON.stringify(dados) });
    toast(id ? 'Endereço atualizado ✓' : 'Endereço adicionado ✓', 'ok');
    const nome = document.querySelector('#modal-enderecos h3').textContent.replace('📍 Endereços de ', '');
    document.getElementById('modal-enderecos').remove();
    abrirEnderecos(clienteId, nome);
  } catch (e) { $('#end-erro').textContent = e.message; }
}

async function editarEndereco(clienteId, eid) {
  let lista;
  try { lista = await api('/clientes/' + clienteId + '/enderecos'); } catch (e) { return; }
  const e = lista.find(x => x.id === eid);
  if (!e) return;
  $('#end-id').value = eid;
  $('#end-apelido').value = e.apelido || '';
  $('#end-endereco').value = e.endereco || '';
  $('#end-cidade').value = e.cidade || '';
  $('#end-uf').value = e.uf || '';
  $('#end-cep').value = e.cep || '';
  $('#end-titulo').textContent = 'Editando: ' + e.apelido;
  $('#end-btn').textContent = 'Salvar alterações';
  $('#end-apelido').focus();
}

async function excluirEndereco(clienteId, eid, apelido) {
  if (!await modalConfirmar('Remover endereço',
    `Remover <b>${esc(apelido)}</b> da lista?<br><br>` +
    '<span class="dica">Os certificados já emitidos neste endereço continuam ' +
    'mostrando ele — o texto fica gravado no documento.</span>',
    { textoSim: 'Remover', textoNao: 'Cancelar' })) return;
  try {
    await api('/clientes/enderecos/' + eid, { method: 'DELETE' });
    toast('Endereço removido', 'ok');
    const nome = document.querySelector('#modal-enderecos h3').textContent.replace('📍 Endereços de ', '');
    document.getElementById('modal-enderecos').remove();
    abrirEnderecos(clienteId, nome);
  } catch (e) { toast(e.message, 'erro'); }
}

// Preenche o endereço pelo CEP (mesma API usada no cadastro de empresa)
async function buscarCepEndereco() {
  const cep = ($('#end-cep').value || '').replace(/\D/g, '');
  if (cep.length !== 8) return;
  try {
    const r = await fetch(`https://brasilapi.com.br/api/cep/v1/${cep}`).then(x => x.json());
    if (r.street && !$('#end-endereco').value) $('#end-endereco').value = r.street +
      (r.neighborhood ? ', ' + r.neighborhood : '');
    if (r.city) $('#end-cidade').value = r.city;
    if (r.state) $('#end-uf').value = r.state;
  } catch (e) { /* CEP não encontrado: o usuário digita */ }
}

// Convite ao portal: escolher QUAIS contatos do cliente vão receber
async function convidarPortal(clienteId, nome) {
  let lista, hist;
  try {
    [lista, hist] = await Promise.all([
      api('/portal-convites/' + clienteId + '/contatos'),
      api('/portal-convites/' + clienteId + '/historico').catch(() => [])
    ]);
  } catch (e) { toast(e.message, 'erro', 6000); return; }
  window._convHist = hist || [];

  if (!lista.length) {
    await modalConfirmar('Nenhum e-mail cadastrado',
      `O cliente <b>${esc(nome)}</b> não tem e-mail no cadastro nem contatos com e-mail.\n\n` +
      'Cadastre o e-mail em Cadastros → Clientes (ou adicione um contato) e tente de novo.',
      { textoSim: 'Entendi', textoNao: '' });
    return;
  }

  const linha = c => {
    const bloqueado = c.ja_tem_acesso;
    const marca = !bloqueado && !c.convite_pendente;
    return `
    <label style="display:flex;gap:10px;align-items:flex-start;padding:9px 4px;
           border-bottom:1px solid #eef2f7;${bloqueado ? 'opacity:.55' : 'cursor:pointer'}">
      <input type="checkbox" class="cv-alvo" value="${esc(c.email)}"
        ${marca ? 'checked' : ''} ${bloqueado ? 'disabled' : ''}
        style="width:17px;height:17px;margin-top:2px;flex:0 0 auto">
      <span style="line-height:1.4">
        <b>${esc(c.nome || c.email)}</b>
        ${c.origem === 'principal'
          ? '<span class="badge" style="margin-left:6px">e-mail do cadastro</span>'
          : c.cargo ? `<span class="dica"> · ${esc(c.cargo)}</span>` : ''}
        <br><span class="mono dica">${esc(c.email)}</span>
        ${c.ja_tem_acesso ? '<br><span class="badge ok">já tem acesso ao portal</span>' : ''}
        ${!c.ja_tem_acesso && c.convite_pendente
          ? `<br><span class="badge" style="background:#fff3cd;color:#856404">convite pendente${
              c.convite_expira ? ' até ' + new Date(c.convite_expira).toLocaleDateString('pt-BR') : ''
            }</span> <span class="dica">— marque para reenviar</span>` : ''}
      </span>
    </label>`;
  };

  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-fundo" id="modal-convite-portal" onclick="if(event.target===this)this.remove()">
      <div class="modal-caixa" style="max-width:560px">
        <h3>🔗 Convidar para o portal</h3>
        <p class="dica">Escolha quem de <b>${esc(nome)}</b> deve receber o convite para criar
          a senha de acesso. Cada pessoa entra com o próprio e-mail e vê os certificados
          das balanças desta empresa. O convite vale <b>7 dias</b>.</p>
        <div style="max-height:320px;overflow:auto;margin:12px 0;border:1px solid #dde5ec;
             border-radius:10px;padding:4px 12px">
          ${lista.map(linha).join('')}
        </div>
        ${(hist || []).length ? `
        <details style="margin-top:4px">
          <summary style="cursor:pointer;font-size:.9rem;color:#43607f">
            📋 Convites já enviados (${hist.length})</summary>
          <div class="tabela-scroll" style="max-height:230px;margin-top:8px">
            <table><thead><tr><th>Contato</th><th>Enviado</th><th>Situação</th><th></th></tr></thead>
            <tbody>${hist.map(h => `<tr>
              <td><b>${esc(h.nome || '')}</b><br><span class="mono dica">${esc(h.email)}</span></td>
              <td class="dica">${dbrSA(h.criado_em)}${h.por ? `<br>por ${esc(h.por)}` : ''}
                ${h.email_status
                  ? `<br><span class="${h.email_status === 'erro' ? 'erro' : 'dica'}" ${
                      h.email_erro ? `title="${esc(h.email_erro)}"` : ''}>e-mail: ${
                      h.email_status === 'enviado' ? '✓ entregue'
                      : h.email_status === 'erro' ? '✕ falhou'
                      : h.email_status === 'suprimido' ? '🔇 suprimido'
                      : esc(h.email_status)}</span>`
                  : '<br><span class="dica">e-mail: sem registro</span>'}</td>
              <td>${h.ja_tem_acesso
                  ? '<span class="badge ok">acesso criado</span>'
                  : h.situacao === 'usado' ? '<span class="badge ok">usado</span>'
                  : h.situacao === 'expirado' ? '<span class="badge rep">expirado</span>'
                  : `<span class="badge" style="background:#fff3cd;color:#856404">pendente</span>
                     <br><span class="dica">até ${dbrSA(h.expira_em)}</span>`}</td>
              <td>${h.link
                  ? `<button class="btn-mini" title="Copiar o link para mandar por WhatsApp"
                       onclick="copiarLinkPortal('${esc(h.link)}', this)">🔗 Link</button>` : ''}</td>
            </tr>`).join('')}</tbody></table>
          </div>
          <p class="dica" style="margin-top:6px">💡 Se o e-mail não chegou, copie o link e mande
            por WhatsApp — ele abre a mesma tela de criar senha.</p>
        </details>` : ''}
        <div class="rodape-acoes" style="margin-top:12px">
          <button onclick="document.getElementById('modal-convite-portal').remove()">Cancelar</button>
          <button class="btn-primario" onclick="enviarConvitesPortal('${clienteId}')">
            📨 Enviar convites</button>
        </div>
        <p id="cvp-erro" class="erro"></p>
      </div>
    </div>`);
}

async function enviarConvitesPortal(clienteId) {
  const emails = [...document.querySelectorAll('.cv-alvo:checked')].map(c => c.value);
  if (!emails.length) { $('#cvp-erro').textContent = 'Selecione ao menos um contato.'; return; }
  try {
    const r = await api('/portal-convites/' + clienteId + '/varios',
      { method: 'POST', body: JSON.stringify({ emails }) });
    document.getElementById('modal-convite-portal')?.remove();
    const env = r.enviados || [], ign = r.ignorados || [];
    if (!env.length) {
      toast('Nenhum convite enviado. ' +
        ign.map(i => `${i.email}: ${i.motivo}`).join(' · '), 'erro', 8000);
      return;
    }
    // Mostra os LINKS: se o e-mail não chegar, a empresa manda por WhatsApp
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal-fundo" id="modal-links-convite" onclick="if(event.target===this)this.remove()">
        <div class="modal-caixa" style="max-width:560px">
          <h3>✓ ${env.length === 1 ? 'Convite enviado' : env.length + ' convites enviados'}</h3>
          <p class="dica">O e-mail já está a caminho. Se o cliente disser que não recebeu
            (ou cair no spam), use o link abaixo — ele abre a mesma tela de criar senha.
            Vale por <b>7 dias</b>.</p>
          <div class="tabela-scroll" style="max-height:300px;margin-top:10px">
            <table><tbody>${env.map(e => `<tr>
              <td><b>${esc(e.nome || '')}</b><br><span class="mono dica">${esc(e.email)}</span></td>
              <td style="white-space:nowrap">
                <button class="btn-mini" onclick="copiarLinkPortal('${esc(e.link)}', this)">🔗 Copiar link</button>
              </td></tr>`).join('')}</tbody></table>
          </div>
          ${ign.length ? `<p class="dica" style="margin-top:10px;color:#b02a37">
            ${ign.length} ignorado(s): ${ign.map(i => `${esc(i.email)} (${esc(i.motivo)})`).join('; ')}</p>` : ''}
          <div class="rodape-acoes" style="margin-top:12px">
            <button class="btn-primario" onclick="this.closest('.modal-fundo').remove()">Fechar</button>
          </div>
        </div>
      </div>`);
  } catch (e) { $('#cvp-erro').textContent = e.message; }
}

// Copia o link do convite (para mandar por WhatsApp quando o e-mail falha)
function copiarLinkPortal(link, botao) {
  navigator.clipboard.writeText(link).then(() => {
    const antes = botao.textContent;
    botao.textContent = '✓ copiado';
    setTimeout(() => { botao.textContent = antes; }, 2200);
  }).catch(() => prompt('Copie o link do convite:', link));
}

async function enviarPesquisaCliente(clienteId, nome) {
  const ok = await modalConfirmar('Enviar pesquisa de satisfação',
    `Enviar a pesquisa de satisfação para ${nome}?`,
    { textoSim: 'Enviar', textoNao: 'Cancelar' });
  if (!ok) return;
  try {
    await api('/pesquisa/enviar', { method: 'POST', body: JSON.stringify({ clienteId }) });
    toast('Pesquisa na fila de envio ✓ — chegará em instantes.', 'ok', 5000);
  } catch (e) { toast(e.message, 'erro'); }
}

function filtrarClientesLista(termo) {
  const t = (termo || '').toLowerCase().trim();
  const filt = !t ? clientesListaCache : clientesListaCache.filter(c =>
    (c.razao_social || '').toLowerCase().includes(t) ||
    (c.nome_fantasia || '').toLowerCase().includes(t) ||
    (c.cnpj || '').toLowerCase().includes(t) ||
    (c.cidade || '').toLowerCase().includes(t));
  $('#clientes-lista').innerHTML = htmlClientes(filt);
}

async function buscarCnpj() {
  const el = $('#f-cnpj');
  const cnpj = (el.value || '').replace(/\D/g, '');
  const err = $('#f-erro');
  err.textContent = '';
  if (cnpj.length !== 14) { err.textContent = 'Digite o CNPJ completo (14 dígitos) para buscar.'; el.focus(); return; }
  const btn = document.querySelector('.temp-wrap .btn-clima');
  const txt = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  try {
    const r = await fetch('https://brasilapi.com.br/api/cnpj/v1/' + cnpj);
    if (!r.ok) throw new Error(r.status === 404 ? 'CNPJ não encontrado na base da Receita.' : 'Não foi possível consultar agora.');
    const d = await r.json();
    // Preenche o que veio (sem sobrescrever com vazio)
    const set = (id, val) => { if (val) $(id).value = val; };
    set('#f-razao', d.razao_social);
    set('#f-fantasia', d.nome_fantasia);
    set('#f-email', (d.email || '').toLowerCase());
    set('#f-fone', d.ddd_telefone_1);
    set('#f-cidade', d.municipio);
    set('#f-uf', d.uf);
    set('#f-cep', d.cep);
    const endereco = [d.descricao_tipo_de_logradouro, d.logradouro, d.numero, d.complemento, d.bairro]
      .filter(Boolean).join(', ');
    set('#f-end', endereco);
    toast('Dados preenchidos a partir do CNPJ ✓', 'ok');
  } catch (e) {
    err.textContent = e.message || 'Falha na consulta do CNPJ.';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = txt || '🔍'; }
  }
}

function formCliente(c = null) {
  $('#form-area').innerHTML = `
    <div class="subcard">
      <h4>${c ? 'Editar cliente' : 'Novo cliente'}</h4>
      <div class="seg-tipo" style="grid-column:1/-1;display:flex;gap:6px;margin-bottom:6px">
        <button type="button" id="tp-pj" class="btn-mini" onclick="setTipoPessoa('PJ')">Pessoa Jurídica</button>
        <button type="button" id="tp-pf" class="btn-mini" onclick="setTipoPessoa('PF')">Pessoa Física</button>
      </div>
      <div class="form-grid">
        <label style="grid-column:1/-1" id="lbl-doc">CNPJ
          <span class="temp-wrap">
            <input type="text" id="f-cnpj" value="${c?.cnpj || ''}" placeholder="Só números">
            <button type="button" id="btn-buscar-cnpj" class="btn-clima" onclick="buscarCnpj()"
              title="Buscar dados do CNPJ na Receita">🔍</button>
          </span>
        </label>
        <label id="lbl-razao">Razão social *<input type="text" id="f-razao" value="${c?.razao_social || ''}"></label>
        <label id="lbl-fantasia">Nome fantasia<input type="text" id="f-fantasia" value="${c?.nome_fantasia || ''}"></label>
        ${campo('Email', 'f-email', 'email', c?.email)}
        ${campo('Telefone', 'f-fone', 'text', c?.telefone)}
        ${campo('Cidade', 'f-cidade', 'text', c?.cidade)}
        ${campo('UF', 'f-uf', 'text', c?.uf, 'maxlength="2"')}
        ${campo('CEP', 'f-cep', 'text', c?.cep, 'inputmode="numeric"')}
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

  // aplica o tipo (PJ padrão, ou o salvo no cliente)
  setTipoPessoa(c?.tipo_pessoa || 'PJ');
}

// Alterna o formulário entre Pessoa Jurídica e Pessoa Física
window._tipoPessoa = 'PJ';
function setTipoPessoa(tp) {
  window._tipoPessoa = tp;
  const pj = tp === 'PJ';
  const bpj = $('#tp-pj'), bpf = $('#tp-pf');
  if (bpj) bpj.classList.toggle('btn-primario', pj);
  if (bpf) bpf.classList.toggle('btn-primario', !pj);
  // rótulo do documento
  const lblDoc = $('#lbl-doc');
  if (lblDoc) lblDoc.childNodes[0].nodeValue = pj ? 'CNPJ' : 'CPF';
  const inpDoc = $('#f-cnpj');
  if (inpDoc) inpDoc.placeholder = pj ? 'Só números' : 'CPF (só números)';
  // botão buscar só no PJ
  const btnB = $('#btn-buscar-cnpj');
  if (btnB) btnB.style.display = pj ? '' : 'none';
  // rótulo do nome e fantasia
  const lblRazao = $('#lbl-razao');
  if (lblRazao) lblRazao.childNodes[0].nodeValue = pj ? 'Razão social *' : 'Nome completo *';
  const lblFant = $('#lbl-fantasia');
  if (lblFant) lblFant.style.display = pj ? '' : 'none';
}

// ── E-mail: mesma regra do backend (CertSaas.Api.Infra.Email) ──
// Tira espaços de qualquer posição — colar de planilha traz espaço fino e
// quebra de linha, e foi assim que um endereço terminado em ".com.b r"
// entrou no cadastro e só falhou na hora de enviar o certificado.
function limparEmail(v) {
  if (!v) return null;
  const limpo = String(v).replace(/\s+/g, '').toLowerCase();
  return limpo || null;
}
function emailValido(v) {
  const e = limparEmail(v);
  return !!e && e.length <= 254 && /^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/.test(e);
}
// Devolve a mensagem de erro, ou null quando está tudo certo (vazio passa)
function erroEmail(v, campo = 'E-mail') {
  if (!v || !String(v).trim()) return null;
  return emailValido(v) ? null
    : `${campo} inválido: "${String(v).trim()}". Verifique se não há espaço `
      + 'sobrando ou letra faltando (ex.: .com.br).';
}

async function salvarCliente(id) {
  const corpo = {
    razaoSocial: $('#f-razao').value, cnpj: $('#f-cnpj').value || null,
    tipoPessoa: window._tipoPessoa || 'PJ',
    nomeFantasia: $('#f-fantasia').value || null,
    email: $('#f-email').value || null, telefone: $('#f-fone').value || null,
    cidade: $('#f-cidade').value || null, uf: $('#f-uf').value || null,
    cep: $('#f-cep').value || null,
    endereco: $('#f-end').value || null
  };
  const eErro = erroEmail(corpo.email);
  if (eErro) { $('#f-erro').textContent = eErro; return; }
  corpo.email = limparEmail(corpo.email);
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
  return lista.map(b => {
    const linha2 = [
      [b.marca, b.modelo].filter(Boolean).join(' '),
      `${fmt(b.capacidade)} ${esc(normUnid(b.unidade) || 'kg')}`,
      `e=${fmt(b.divisao_e)}`,
      `Classe ${b.classe_exatidao}`,
      b.numero_inmetro ? `Inmetro ${esc(b.numero_inmetro)}` : ''
    ].filter(Boolean).join(' · ');
    return `
    <div class="item-cert">
      <span><b>${esc(b.identificacao)}</b>${b.num_serie ? ' · Série ' + esc(b.num_serie) : ''}
        ${b.ativa ? '' : '<span class="badge rep">inativa</span>'}<br>
        <span class="dica">${linha2}</span>
      </span>
      <span class="acoes">
        <button class="btn-mini"
          onclick='formBalanca("${clienteId}", ${JSON.stringify(b)})'>✏️</button>
      </span>
    </div>`;
  }).join('');
}

// (renomeada: colidia com a filtrarBalancas() da tela de nova calibração,
// definida depois e que sobrescrevia esta — o filtro daqui não funcionava)
function filtrarBalancasCliente(clienteId, termo) {
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
  setTimeout(() => carregarContatos(id), 0);   // carrega os contatos apos montar a tela
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
      <div class="barra" style="margin-top:14px"><h4>Contatos</h4>
        ${ehGestor() ? `<button class="btn-primario btn-mini" onclick="formContato('${id}')">+ Novo contato</button>` : ''}</div>
      <div id="contatos-lista"><p class="dica">Carregando…</p></div>
      <div class="barra" style="margin-top:14px"><h4>Balanças</h4>
        ${podeCriarBalanca() ? `<button class="btn-primario btn-mini" onclick="formBalanca('${id}')">+ Nova balança</button>` : ''}</div>
      ${bs.length === 0 ? '<p class="dica">Nenhuma balança.</p>' : `
        <input type="text" class="filtro-hist" placeholder="🔍 Buscar balança por identificação, série, marca ou modelo..."
               oninput="filtrarBalancasCliente('${id}', this.value)">
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
  // Emitido/substituído abre o PDF; rascunho e aguardando aprovação abrem
  // o certificado para continuar ou aprovar, sem ter que voltar ao painel
  // e caçar na lista. abrirCert() já roteia por status. João, 01/09/2026.
  const emPdf = h => h.status === 'emitido' || h.status === 'substituido';
  const emAberto = h => h.status === 'rascunho' || h.status === 'aguardando_aprovacao';
  const rotuloAcao = h => h.status === 'rascunho' ? '✏️ Continuar'
    : h.status === 'aguardando_aprovacao' ? '⏳ Revisar e emitir' : '📄 PDF';
  return lista.map(h => `
    <div class="item-cert ${emPdf(h) || emAberto(h) ? 'clicavel' : ''}"
         ${emPdf(h) ? `onclick="abrirPdfCertificado('${h.id}')"`
           : emAberto(h) ? `onclick="abrirCert('${h.id}','${h.status}')"` : ''}>
      <span>
        <b>${h.numero || '(sem número)'}</b> · ${esc(h.balanca)}${h.num_serie ? ' · Série ' + esc(h.num_serie) : ''}
        <span class="st st-${h.status}">${rotuloStatus(h.status)}</span><br>
        <span class="dica">
          ${h.data_calibracao ? 'Calibração: ' + new Date(h.data_calibracao).toLocaleDateString('pt-BR') : ''}
          ${h.data_emissao ? ' · Emitido: ' + new Date(h.data_emissao).toLocaleDateString('pt-BR') : ''}
          · Téc.: ${esc(h.tecnico)}</span>
      </span>
      ${emPdf(h) || emAberto(h)
        ? `<span class="acoes"><button class="btn-mini">${rotuloAcao(h)}</button></span>` : ''}
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
    `<option value="${o}" ${o === normUnid(atual) ? 'selected' : ''}>${o}</option>`).join('');
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
        <label>Nº de série (plataforma)
          <button type="button" class="btn-ajuda" onclick="ajudaNumeroSerie()" title="Qual número usar?" style="margin-left:4px">?</button>
          <input type="text" id="b-serie" value="${b?.num_serie ?? ''}"></label>
        <label>Nº de série do indicador
          <button type="button" class="btn-ajuda" onclick="ajudaNumeroSerie()" title="Qual número usar?" style="margin-left:4px">?</button>
          <input type="text" id="b-serie-ind" value="${b?.num_serie_indicador ?? ''}" placeholder="opcional"></label>
        ${campo('Número do Inmetro', 'b-inmetro', 'text', b?.numero_inmetro)}
        ${campo('Patrimônio', 'b-patrimonio', 'text', b?.patrimonio)}
        ${campo('Portaria de aprovação', 'b-portaria', 'text', b?.portaria_aprovacao)}
        <label>Unidade *<select id="b-unid" onchange="sugerirClasse()">${selUnid(b?.unidade)}</select></label>
        ${campo('Capacidade *', 'b-cap', 'number', b?.capacidade, 'step="any" inputmode="decimal" oninput="sugerirClasse()"')}
        <div id="b-e-wrap">
          ${campo('Divisão e *', 'b-e', 'number', b?.divisao_e, 'step="any" inputmode="decimal" oninput="sugerirClasse()"')}
        </div>
        <div id="b-d-wrap">
          ${campo('Divisão d *', 'b-d', 'number', b?.divisao_d ?? '', 'step="any" inputmode="decimal" oninput="sugerirClasse()"')}
          <p class="dica" style="grid-column:1/-1;margin-top:-6px">Divisão real do visor.
            Se a balança não distingue as duas, informe o mesmo valor do e —
            o botão abaixo preenche para você.</p>
          <button type="button" class="btn-mini" style="grid-column:1/-1;justify-self:start"
            onclick="copiarEparaD()">d = e · copiar a divisão e</button>
        </div>
        <label>Classe *
          <button type="button" class="btn-ajuda" onclick="ajudaClasse()" title="Como a classe é calculada" style="margin-left:4px">?</button>
          <select id="b-classe" onchange="this.dataset.editadoManual=1;sugerirClasse()">${sel(CLASSES, b?.classe_exatidao || 'III')}</select></label>
        ${campo('Periodicidade (meses)', 'b-per', 'number', b?.periodicidade_meses ?? 12)}
      </div>
      <p id="b-classe-dica" class="dica"></p>

      <div class="subcard" style="margin-top:12px;background:#f8fafc;border-left:3px solid #6c8ab0">
        <label class="chk"><input type="checkbox" id="b-multi" onchange="toggleFaixas()"
          ${b?.multi_intervalo ? 'checked' : ''}>
          Balança multi-intervalo (divisão muda por faixa)</label>
        <div id="b-faixas-area" class="${b?.multi_intervalo ? '' : 'oculta'}">
          <p class="dica">Informe o limite superior e a divisão (e) de cada faixa, em ordem crescente.
            A última faixa deve terminar exatamente na capacidade da balança.</p>
          <div id="b-faixas-linhas"></div>
          <button type="button" class="btn-mini" onclick="addFaixaLinha()">+ Adicionar faixa</button>
          <p class="dica" style="margin:10px 0 4px">Cobertura das faixas até a capacidade</p>
          <div id="b-regua" style="position:relative;height:38px;border-radius:6px;overflow:hidden;display:flex;background:#eef1f4"></div>
          <p id="b-regua-aviso" style="font-size:12.5px;margin:6px 0 0"></p>
        </div>
      </div>

      <div class="subcard" style="margin-top:12px;background:#f8fafc">
        <p class="dica" style="margin:0 0 6px"><b>Ensaios aplicáveis</b> — desmarque
          o que não se aplica a este instrumento (ex.: balanças suspensas/de gancho
          não realizam excentricidade nem sensibilidade). O certificado registrará
          "Não aplicável".</p>
        <label class="chk"><input type="checkbox" id="b-faz-exc"
          ${b?.faz_excentricidade === false ? '' : 'checked'}>
          Realiza ensaio de excentricidade</label>
        <label class="chk"><input type="checkbox" id="b-faz-sens"
          ${b?.faz_sensibilidade === false ? '' : 'checked'}>
          Realiza ensaio de sensibilidade</label>
      </div>

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
  // carrega as faixas existentes (ao editar) ou uma linha em branco
  if (b?.id && b?.multi_intervalo) carregarFaixas(b.id);
  else if (b?.multi_intervalo) addFaixaLinha();
  toggleFaixas();
}

// ── Faixas (multi-intervalo) ──────────────────────────────────
// Copia a divisão e para o campo d — atalho para as balanças em que os
// dois valores coincidem (a maioria das de escala única)
function copiarEparaD() {
  const e = $('#b-e')?.value;
  if (!e) { toast('Preencha primeiro a divisão e.', 'aviso'); return; }
  $('#b-d').value = e;
  sugerirClasse();
}

function toggleFaixas() {
  const area = $('#b-faixas-area');
  const marcado = $('#b-multi').checked;
  area.classList.toggle('oculta', !marcado);
  const eWrap = $('#b-e-wrap'), dWrap = $('#b-d-wrap');
  if (eWrap) eWrap.style.display = marcado ? 'none' : '';
  if (dWrap) dWrap.style.display = marcado ? 'none' : '';
  if (marcado && !$('#b-faixas-linhas').children.length) addFaixaLinha();
  sugerirClasse();
  renderRegua();
}

// Desenha a régua proporcional de faixas até a capacidade, e avisa
// se a última faixa não bater exatamente com a capacidade cadastrada.
function renderRegua() {
  const regua = $('#b-regua'), aviso = $('#b-regua-aviso');
  if (!regua || !aviso) return;
  const cap = Number($('#b-cap')?.value) || 0;
  const { faixas } = coletarFaixas();
  regua.innerHTML = '';
  const cores = ['#dbe9f7', '#dcefd6', '#fbe9c9'];
  const textos = ['#1e4a72', '#245c1a', '#7a5205'];
  let anterior = 0;
  faixas.forEach((f, i) => {
    const largura = Math.max((f.limiteSup || 0) - anterior, 0);
    const pct = cap > 0 ? (largura / cap * 100) : 0;
    const seg = document.createElement('div');
    seg.style.cssText = `width:${pct}%;background:${cores[i % 3]};color:${textos[i % 3]};` +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'font-size:10.5px;font-weight:600;border-right:1px solid #fff;overflow:hidden';
    seg.innerHTML = `<span>até ${fmt(f.limiteSup || 0)}</span><span style="font-weight:400">e=${fmt(f.divisaoE || 0)}</span>`;
    regua.appendChild(seg);
    anterior = f.limiteSup || 0;
  });
  const ultima = faixas.length ? faixas[faixas.length - 1].limiteSup : 0;
  if (faixas.length && Math.abs((ultima || 0) - cap) > 1e-9) {
    aviso.style.color = '#b02a37';
    aviso.textContent = `⚠️ A última faixa vai até ${fmt(ultima || 0)}, mas a capacidade é ${fmt(cap)}. Ajuste antes de salvar.`;
  } else if (faixas.length) {
    aviso.style.color = '#1e6b3a';
    aviso.textContent = '✓ Faixas cobrem toda a capacidade.';
  } else {
    aviso.textContent = '';
  }
}

function addFaixaLinha(limite = '', e = '') {
  const cont = $('#b-faixas-linhas');
  if (cont.children.length >= 3) { toast('Máximo de 3 faixas.', 'erro'); return; }
  const div = document.createElement('div');
  div.className = 'faixa-linha';
  div.innerHTML = `
    <span class="dica">Faixa ${cont.children.length + 1}</span>
    <label>até <input type="number" step="any" inputmode="decimal" class="faixa-lim" value="${limite}" oninput="sugerirClasse()"></label>
    <label>e = <input type="number" step="any" inputmode="decimal" class="faixa-e" value="${e}" oninput="sugerirClasse()"></label>
    <button type="button" class="btn-mini btn-vinho" onclick="this.closest('.faixa-linha').remove();renumerarFaixas();sugerirClasse()">✕</button>`;
  cont.appendChild(div);
}

function renumerarFaixas() {
  [...$('#b-faixas-linhas').children].forEach((l, i) => {
    const s = l.querySelector('.dica'); if (s) s.textContent = 'Faixa ' + (i + 1);
  });
}

async function carregarFaixas(balancaId) {
  try {
    const faixas = await api('/balancas/' + balancaId + '/faixas');
    $('#b-faixas-linhas').innerHTML = '';
    if (faixas.length) faixas.forEach(f => addFaixaLinha(f.limite_sup, f.divisao_e));
    else addFaixaLinha();
  } catch { addFaixaLinha(); }
  renderRegua();
}

// Coleta as faixas do formulário (validando ordem crescente)
function coletarFaixas() {
  if (!$('#b-multi')?.checked) return { multi: false, faixas: [] };
  const linhas = [...$('#b-faixas-linhas').querySelectorAll('.faixa-linha')];
  const faixas = [];
  for (const l of linhas) {
    const lim = Number(l.querySelector('.faixa-lim').value);
    const e = Number(l.querySelector('.faixa-e').value);
    if (!lim || !e) continue;
    faixas.push({ limiteSup: lim, divisaoE: e });
  }
  return { multi: true, faixas };
}

let timerClasse = null;
// Explica como a classe da balança é determinada, com a tabela da portaria
// Memória de cálculo da classe (usa o último resultado do sugerir-classe)
function memoriaClasseHtml() {
  const r = window._ultimaClasse;
  if (!r || !r.memoria || !r.memoria.length) return '';
  const linhas = r.memoria.map(m => {
    const icone = m.compativel ? '\u2713' : '\u2717';
    const cor = m.compativel ? '#146c43' : '#8a8f98';
    return '<div style="margin:3px 0;color:' + cor + '">' +
      '<b>' + icone + ' ' + esc(m.classe) + '</b> \u2014 ' + esc(m.regra) +
      '<br><span style="margin-left:18px;font-size:11px">' + esc(m.motivo) + '</span></div>';
  }).join('');
  return '<div style="padding:10px 14px;background:#f8f9fb;border-left:4px solid #1e3a5f;border-radius:6px;margin:10px 0">' +
    '<b>Mem\u00f3ria de c\u00e1lculo desta balan\u00e7a:</b>' +
    '<div class="dica" style="margin:6px 0">' + esc(r.resumoMemoria || '') + '</div>' +
    linhas +
    '<div style="margin-top:8px;padding:6px 10px;background:#1e3a5f;color:#fff;border-radius:5px">' +
      'Sugerida: <b>Classe ' + esc(r.sugerida) + '</b>' +
      (r.classesCompativeis && r.classesCompativeis.length > 1
        ? ' <span style="opacity:.8">(compat\u00edveis: ' + r.classesCompativeis.join(', ') + ')</span>' : '') +
    '</div></div>';
}

// Explica a diferenca entre o numero de serie da plataforma e o do indicador
function ajudaNumeroSerie() {
  const modal = document.createElement('div');
  modal.className = 'modal-fundo';
  modal.onclick = e => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `
    <div class="modal-caixa" style="max-width:560px">
      <h3>Qual número de série usar?</h3>
      <div style="background:#e7f3ee;border-left:4px solid #0a5c40;border-radius:6px;padding:12px;margin:12px 0">
        <b>A referência oficial é sempre o número de série da PLATAFORMA</b>
        (a estrutura mecânica do instrumento). É ele que identifica a balança no
        certificado e ao qual a <b>portaria de aprovação do Inmetro</b> se vincula.
      </div>
      <p>O <b>número de série do indicador</b> (o cabeçote eletrônico) é um
        registro <b>complementar</b>. É útil quando:</p>
      <ul style="font-size:13px;line-height:1.7">
        <li>O indicador é trocado ao longo da vida do equipamento</li>
        <li>O cliente identifica a balança pelo número do cabeçote</li>
        <li>Há mais de um indicador no mesmo local</li>
      </ul>
      <p class="dica">Deixe em branco se não houver, ou se o instrumento tiver
        apenas um número de série. Quando vazio, ele não aparece no certificado
        nem nas listagens.</p>
      <div style="text-align:right;margin-top:14px">
        <button class="btn-primario" onclick="this.closest('.modal-fundo').remove()">Entendi</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function ajudaClasse() {
  const cap = Number($('#b-cap')?.value);
  const e = Number($('#b-e')?.value);
  const un = normUnid($('#b-unid')?.value);
  let exemplo = '';
  if (cap && e) {
    const n = Math.round(cap / e);
    exemplo = `<p style="padding:8px 12px;background:#eef4fb;border-radius:6px;margin:10px 0">
      <b>Esta balança:</b> capacidade ${fmt(cap)} ${un} ÷ divisão ${fmt(e)} ${un}
      = <b>n = ${n.toLocaleString('pt-BR')} divisões</b></p>`;
  }

  const modal = document.createElement('div');
  modal.className = 'modal-fundo';
  modal.onclick = e => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `
    <div class="modal-caixa" style="max-width:600px;max-height:85vh;overflow-y:auto">
      <h3>Como a classe de exatidão é determinada</h3>
      <p>A classe depende de dois valores da balança, conforme a
        <b>Portaria Inmetro nº 157/2022</b> (que substituiu a 236/94):</p>
      <p style="padding:8px 12px;background:#f4f7fa;border-radius:6px;margin:10px 0">
        <b>n = Capacidade ÷ Divisão (e)</b><br>
        <span class="dica">n é o número de divisões de verificação da balança.</span></p>
      ${exemplo}
      ${memoriaClasseHtml()}
      <p>Com o valor de <b>e</b> e o número de divisões <b>n</b>, consulta-se a tabela:</p>

      <table class="tab-classe">
        <thead><tr><th>Classe</th><th>Divisão (e)</th><th>Nº de divisões (n)</th></tr></thead>
        <tbody>
          <tr><td><b>I</b> — Especial</td><td>e ≥ 1 mg</td><td>n ≥ 50.000</td></tr>
          <tr><td rowspan="2"><b>II</b> — Fina</td><td>1 mg ≤ e ≤ 50 mg</td><td>100 a 100.000</td></tr>
          <tr><td>e ≥ 100 mg</td><td>5.000 a 100.000</td></tr>
          <tr><td rowspan="2"><b>III</b> — Média</td><td>100 mg ≤ e ≤ 2 g</td><td>100 a 10.000</td></tr>
          <tr><td>e ≥ 5 g</td><td>500 a 10.000</td></tr>
          <tr><td><b>IIII</b> — Ordinária</td><td>e ≥ 5 g</td><td>100 a 1.000</td></tr>
        </tbody>
      </table>

      <p class="dica" style="margin-top:12px">A balança pode ser compatível com mais de
        uma classe; o sistema sugere a mais adequada, mas você pode ajustar manualmente
        conforme a placa de identificação do fabricante.</p>
      <p class="dica">Em balanças de <b>múltiplas faixas</b> (multi-intervalo), a classe é a
        interseção das classes compatíveis com cada faixa — por isso pode diferir do cálculo
        feito só com a menor divisão.</p>

      <div style="text-align:right;margin-top:14px">
        <button class="btn-primario" onclick="this.closest('.modal-fundo').remove()">Entendi</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function sugerirClasse() {
  renderRegua();
  clearTimeout(timerClasse);
  timerClasse = setTimeout(async () => {
    const cap = Number($('#b-cap')?.value);
    const multi = !!$('#b-multi')?.checked;
    const faixasMulti = (multi && typeof coletarFaixas === 'function')
      ? coletarFaixas().faixas.map(f => ({ limiteSup: f.limiteSup, divisaoE: f.divisaoE }))
      : null;
    const faixasValidas = !!(faixasMulti && faixasMulti.length >= 2);
    const e = Number($('#b-e')?.value);
    const dica = $('#b-classe-dica');
    // Em multi-intervalo com faixas válidas, o "e" único não é necessário —
    // a classe é calculada a partir das faixas. Só exige "e" em faixa única.
    if (!dica || !cap || (!faixasValidas && !e)) { if (dica) dica.textContent = ''; return; }
    try {
      const r = await api('/balancas/sugerir-classe', { method: 'POST',
        body: JSON.stringify({ capacidade: cap, divisaoE: faixasValidas ? (faixasMulti[0].divisaoE || 0) : e,
          unidade: $('#b-unid').value, tipo: $('#b-tipo').value,
          classeEscolhida: $('#b-classe').value,
          faixas: faixasValidas ? faixasMulti : null }) });

      // Preenche o campo Classe automaticamente com a classe calculada,
      // mas só se o usuário ainda não tiver alterado manualmente
      window._ultimaClasse = r;  // guarda p/ a memória de cálculo (botão ?)
      const selClasse = $('#b-classe');
      if (selClasse && !selClasse.dataset.editadoManual && r.sugerida) {
        selClasse.value = r.sugerida;
      }

      if (r.alerta) {
        dica.innerHTML = '⚠️ ' + esc(r.alerta);
        dica.style.color = '#b02a37';
      } else if (faixasValidas) {
        dica.innerHTML = `Classe <b>${r.sugerida}</b> calculada a partir das ${faixasMulti.length} faixas ` +
          `(maior nº de divisões entre elas: n = ${r.numeroDivisoes.toLocaleString('pt-BR')})` +
          (r.classesCompativeis.length > 1 ? ` · também compatível: ${r.classesCompativeis.filter(x => x !== r.sugerida).join(', ')}` : '') +
          ` — ajuste se a placa indicar outra.`;
        dica.style.color = '#146c43';
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
    numSerieIndicador: $('#b-serie-ind')?.value || null,
    fazExcentricidade: $('#b-faz-exc') ? $('#b-faz-exc').checked : true,
    fazSensibilidade: $('#b-faz-sens') ? $('#b-faz-sens').checked : true,
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
  const { multi, faixas } = coletarFaixas();
  corpo.multiIntervalo = multi;

  // Em escala única o d é obrigatório: o certificado sempre declara d e e
  if (!multi && (!corpo.divisaoD || corpo.divisaoD <= 0)) {
    $('#f-erro').textContent = 'Informe a divisão d. Se a balança não distingue '
      + 'as duas divisões, use o botão "d = e" para repetir o valor do e.';
    return;
  }
  if (!multi && corpo.divisaoD > corpo.divisaoE) {
    $('#f-erro').textContent = 'A divisão d não pode ser maior que a divisão e.';
    return;
  }

  // Validação das faixas (se multi-intervalo)
  if (multi) {
    if (faixas.length < 2) {
      $('#f-erro').textContent = 'Multi-intervalo precisa de ao menos 2 faixas. Preencha ou desmarque a opção.';
      return;
    }
    // limites em ordem crescente
    for (let i = 1; i < faixas.length; i++) {
      if (faixas[i].limiteSup <= faixas[i - 1].limiteSup) {
        $('#f-erro').textContent = 'Os limites das faixas devem estar em ordem crescente.';
        return;
      }
    }
    // a última faixa deve terminar exatamente na capacidade
    const cap = corpo.capacidade;
    const ultima = faixas[faixas.length - 1].limiteSup;
    if (Math.abs(ultima - cap) > 0.0000001) {
      $('#f-erro').textContent = `A última faixa vai até ${ultima}, mas a capacidade é ${cap}. Ajuste antes de salvar.`;
      return;
    }
    // O campo "Divisão e" único fica oculto em multi-intervalo: usa como
    // referência o "e" da faixa 1 (a mais fina) e não envia "d".
    if (!corpo.divisaoE || corpo.divisaoE <= 0) corpo.divisaoE = faixas[0].divisaoE;
    corpo.divisaoD = null;
  }
  try {
    const salva = await api(id ? '/balancas/' + id : `/clientes/${clienteId}/balancas`, {
      method: id ? 'PUT' : 'POST', body: JSON.stringify(corpo) });
    // salva as faixas (o backend substitui as existentes)
    const balancaId = id || salva?.id;
    if (balancaId) {
      await api('/balancas/' + balancaId + '/faixas', {
        method: 'PUT', body: JSON.stringify({ faixas: multi ? faixas : [] }) });
    }
    detalheCliente(clienteId);
  } catch (e) { $('#f-erro').textContent = e.message; }
}

// ── Pesos padrão ────────────────────────────────────────────────
const CLASSES_PESO = ['E1', 'E2', 'F1', 'F2', 'M1', 'M2', 'M3'];

async function renderPesos() {
  const ps = await api('/pesos');
  const admin = ehGestor();
  // RBC: descobre se a empresa é acreditada (para mostrar campos extras no peso)
  try { const cfg = await api('/empresa/config'); window._empresaAcreditada = !!cfg.acreditada; }
  catch (e) { window._empresaAcreditada = false; }
  $('#cad-conteudo').innerHTML = `
    <div class="card">
      <div class="barra"><h3>Pesos padrão</h3>
        ${admin ? '<button class="btn-primario btn-mini" onclick="formPeso()">+ Novo</button>' : ''}</div>
      ${admin ? '' : '<p class="dica">Somente o administrador cadastra pesos.</p>'}
      <div id="form-area"></div>
      ${ps.length === 0 ? '<p class="dica">Nenhum peso cadastrado.</p>' : ps.map(p => `
        <div class="item-cert">
          <span><b>${esc(p.identificacao)}</b> · ${esc(p.valor_nominal || '')} · ${esc(p.classe)}${
            Number(p.massa_total_kg) > 0
              ? ` · ${fmt(Number(p.massa_total_kg))} kg no total`
              : ' <span style="background:#fdf6e3;color:#8a6d1a;border:1px solid #e6d9a8;border-radius:99px;padding:1px 8px;font-size:10.5px">⚠️ informe a massa total</span>'}
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
  $('#form-area').innerHTML = `
    <div class="subcard">
      <h4>${p ? 'Editar peso ' + esc(p.identificacao) : 'Novo peso padrão'}</h4>
      <div class="form-grid">
        ${campo('Identificação *', 'p-id', 'text', p?.identificacao)}
        ${campo('Faixa de indicação *', 'p-valor', 'text', p?.valor_nominal, 'placeholder="ex.: 20 ou 1mg a 200g"')}
        ${campo('Massa total do conjunto (kg) *', 'p-massa', 'number', p?.massa_total_kg,
          'step="0.000001" min="0" placeholder="ex.: 1200" title="Soma de TODOS os pesos deste certificado"')}
        <label>Classe *<select id="p-classe">${sel}</select></label>
        ${campo('Data de calibração', 'p-datacal', 'date', p?.data_calibracao ? String(p.data_calibracao).slice(0,10) : '')}
        ${campo('Validade do certificado *', 'p-val', 'date', p?.validade ? String(p.validade).slice(0,10) : '')}
        ${campo('Nº certificado do peso', 'p-cert', 'text', p?.num_certificado)}
        ${campo('Laboratório', 'p-lab', 'text', p?.laboratorio)}
        ${window._empresaAcreditada ? `
        <div style="grid-column:1/-1;margin-top:6px;padding-top:8px;border-top:2px solid #cdd7e5">
          <b style="color:#1e3a5f;font-size:13px">Dados RBC (acreditação ISO/IEC 17025)</b>
          <p class="dica" style="margin:2px 0 8px">Usados no cálculo de incerteza da calibração RBC.</p>
        </div>
        <div style="grid-column:1/-1">
          <label>Material (densidade)
            <select id="p-densmat" onchange="ajustarDensidade()">
              <option value="8000" ${(!p?.densidade_material || Number(p?.densidade_material)===8000)?'selected':''}>Aço inox — 8000 kg/m³</option>
              <option value="7850" ${Number(p?.densidade_material)===7850?'selected':''}>Aço carbono — 7850 kg/m³</option>
              <option value="7200" ${Number(p?.densidade_material)===7200?'selected':''}>Ferro fundido — 7200 kg/m³</option>
              <option value="8400" ${Number(p?.densidade_material)===8400?'selected':''}>Latão — 8400 kg/m³</option>
              <option value="outro">Outro (informar)</option>
            </select></label>
          <label id="p-densmanual-wrap" style="display:none">Densidade (kg/m³)
            <input type="number" id="p-densmanual" step="any" value="${p?.densidade_material || ''}"></label>

          <label style="margin-top:10px">Pontos do certificado</label>
          <p class="dica" style="margin:2px 0 6px">Peso simples? Deixe 1 linha. Conjunto (ex.: CP01-B, PE-20)? Adicione quantas precisar. Cada ponto tem seu valor convencional e incerteza.</p>
          <table class="tab-pontos" style="width:100%;border-collapse:collapse;font-size:12px">
            <thead><tr style="background:#1e3a5f;color:#fff">
              <th style="padding:4px 6px;border:1px solid #d5dde5">Valor nominal</th>
              <th style="padding:4px 6px;border:1px solid #d5dde5">Valor convencional</th>
              <th style="padding:4px 6px;border:1px solid #d5dde5">Incerteza (U)</th>
              <th style="padding:4px 6px;border:1px solid #d5dde5">k</th>
              <th style="padding:4px 6px;border:1px solid #d5dde5"></th>
            </tr></thead>
            <tbody id="pontos-corpo"></tbody>
          </table>
          <button type="button" class="btn-mini" onclick="addPontoRbc()">+ Adicionar ponto</button>

          <div style="background:#fff8e6;border-left:4px solid #e0a800;padding:8px 12px;border-radius:6px;font-size:11.5px;margin-top:10px">
            <b>Assistente de colar:</b> copie a tabela do PDF do certificado e cole abaixo. O sistema separa em linhas/colunas — <b>você confere e corrige</b> antes de salvar.
          </div>
          <textarea id="p-colar" placeholder="Cole aqui as linhas do certificado (ex.: 1  1,00000  0,00003  2,01)…" style="width:100%;box-sizing:border-box;height:52px;border:1px dashed #9db2c9;border-radius:6px;padding:6px;font-size:12px;font-family:monospace;margin-top:6px"></textarea>
          <button type="button" class="btn-mini" onclick="interpretarColagem()">Interpretar e preencher a tabela ⬇</button>
        </div>
        ` : ''}
      </div>
      ${p ? `<div class="anexo-area">
        <label>Certificado do peso (PDF)</label>
        ${p.certificado_pdf_url
          ? `<button type="button" class="btn-mini" onclick="verCertPeso('${p.id}')">📄 Ver certificado anexado</button>
             <button type="button" class="btn-mini" onclick="anexarCertPeso('${p.id}')">🔄 Substituir</button>`
          : `<button type="button" class="btn-mini" onclick="anexarCertPeso('${p.id}')">📎 Anexar PDF</button>`}
      </div>`
        : '<p class="dica">💡 Salve o peso primeiro; depois você poderá anexar o PDF do certificado dele.</p>'}
      <p class="dica" style="margin-top:6px">💡 <b>Massa total do conjunto (obrigatório):</b> some todos os
        pesos cobertos por este certificado — ex.: 60 peças de 20 kg = <b>1.200 kg</b>. É esse valor
        que o sistema usa para calcular os degraus do método da substituição (lote de carga).</p>
      <div class="rodape-acoes">
        <button onclick="renderPesos()">Cancelar</button>
        <button class="btn-primario" onclick="salvarPeso('${p?.id || ''}')">Salvar</button>
      </div>
      ${p ? `<button class="btn-mini btn-vinho"
        onclick="toggleAtivo('pesos','${p.id}',${!p.ativo},renderPesos)">
        ${p.ativo ? 'Inativar peso' : 'Reativar peso'}</button>` : ''}
      <p id="f-erro" class="erro"></p>
    </div>`;
  carregarPontos(p);
}

// RBC: estado dos pontos em edição
window.pontosRbc = [];

// Carrega os pontos do peso (ou 1 linha vazia) e desenha a tabela
async function carregarPontos(p) {
  if (!window._empresaAcreditada) return;
  window.pontosRbc = [];
  if (p && p.id) {
    try {
      const pts = await api('/pesos/' + p.id + '/pontos');
      window.pontosRbc = (pts || []).map(x => ({
        valorNominal: x.valor_nominal || '', valorConvencional: x.valor_convencional ?? '',
        incerteza: x.incerteza ?? '', k: x.k ?? 2 }));
    } catch (e) { window.pontosRbc = []; }
  }
  if (window.pontosRbc.length === 0)
    window.pontosRbc = [{ valorNominal: '', valorConvencional: '', incerteza: '', k: 2 }];
  desenharPontos();
}

// Desenha as linhas da tabela a partir de window.pontosRbc
function desenharPontos() {
  const corpo = document.getElementById('pontos-corpo');
  if (!corpo) return;
  corpo.innerHTML = window.pontosRbc.map((pt, i) => `
    <tr>
      <td style="border:1px solid #d5dde5;padding:2px"><input value="${(pt.valorNominal ?? '').toString().replace(/"/g,'&quot;')}" oninput="editarPonto(${i},'valorNominal',this.value)" style="width:100%;border:none;padding:3px;font-size:12px;text-align:center"></td>
      <td style="border:1px solid #d5dde5;padding:2px"><input value="${pt.valorConvencional ?? ''}" oninput="editarPonto(${i},'valorConvencional',this.value)" style="width:100%;border:none;padding:3px;font-size:12px;text-align:center"></td>
      <td style="border:1px solid #d5dde5;padding:2px"><input value="${pt.incerteza ?? ''}" oninput="editarPonto(${i},'incerteza',this.value)" style="width:100%;border:none;padding:3px;font-size:12px;text-align:center"></td>
      <td style="border:1px solid #d5dde5;padding:2px"><input value="${pt.k ?? 2}" oninput="editarPonto(${i},'k',this.value)" style="width:100%;border:none;padding:3px;font-size:12px;text-align:center"></td>
      <td style="border:1px solid #d5dde5;padding:2px;text-align:center"><span style="color:#b02a37;cursor:pointer;font-weight:bold" onclick="removerPonto(${i})">✕</span></td>
    </tr>`).join('');
}

function editarPonto(i, campo, valor) { if (window.pontosRbc[i]) window.pontosRbc[i][campo] = valor; }
function addPontoRbc() { window.pontosRbc.push({ valorNominal:'', valorConvencional:'', incerteza:'', k:2 }); desenharPontos(); }
function removerPonto(i) { window.pontosRbc.splice(i,1); if (window.pontosRbc.length===0) addPontoRbc(); else desenharPontos(); }

// Assistente de colar: separa o texto colado em linhas/colunas
function interpretarColagem() {
  const txt = ($('#p-colar')?.value || '').trim();
  if (!txt) { toast('Cole a tabela do certificado primeiro.', 'erro'); return; }
  const ehNum = (t) => /^[+-]?\d+(?:[.,]\d+)?$/.test(t);
  const normNum = (t) => String(t).replace(',', '.').replace(/^\+/, '');
  const linhas = txt.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const tokensPorLinha = linhas.map(l => l.split(/\t|;|\s{2,}|\s/).filter(Boolean));
  const linhasComUmToken = tokensPorLinha.filter(t => t.length === 1).length;
  const formatoVertical = linhasComUmToken > linhas.length * 0.5;
  const novos = [];
  if (formatoVertical) {
    // FORMATO A (WL vertical): números empilhados; fecha um ponto no k (~2,0).
    const nums = [];
    for (const l of linhas) {
      const t = l.trim();
      if (t === '---' || t === '\u221e' || /^n\/?c$/i.test(t) || t === '-') continue;
      const limpo = t.replace(/\s*(kg|g)\b/gi, '').trim();
      if (ehNum(limpo)) nums.push(limpo);
    }
    let buf = [];
    for (const nRaw of nums) {
      buf.push(nRaw);
      const val = parseFloat(normNum(nRaw));
      if (val >= 1.9 && val <= 2.2 && buf.length >= 3) {
        const k = buf[buf.length - 1];
        const incerteza = buf[buf.length - 2];
        const convencional = buf[buf.length - 3];
        const nominal = buf[buf.length - 4] || convencional;
        novos.push({ valorNominal: nominal, valorConvencional: normNum(convencional),
                     incerteza: normNum(incerteza), k: normNum(k) });
        buf = [];
      }
    }
  } else {
    // FORMATO B (FNA, uma linha por ponto): nominal = número redondo antes do convencional.
    for (const l of linhas) {
      const matches = l.match(/[+-]?\d+(?:[.,]\d+)?/g);
      if (!matches || matches.length < 2) continue;
      let idxConv = -1;
      for (let i = 0; i < matches.length; i++) {
        if (/[.,]/.test(matches[i])) { idxConv = i; break; }
      }
      let nominal, convencional, incerteza;
      if (idxConv >= 1) {
        convencional = matches[idxConv];
        nominal = matches[idxConv - 1];
        incerteza = matches[matches.length - 1];
      } else {
        nominal = matches[0]; convencional = matches[1] || ''; incerteza = matches[matches.length - 1];
      }
      novos.push({ valorNominal: nominal, valorConvencional: normNum(convencional || ''),
                   incerteza: normNum(incerteza || ''), k: 2 });
    }
  }
  if (novos.length === 0) {
    toast('Nao consegui separar. Tente colar so a tabela de resultados (sem cabecalho).', 'erro');
    return;
  }
  window.pontosRbc = novos;
  desenharPontos();
  toast(novos.length + ' ponto(s) preenchido(s). CONFIRA cada valor antes de salvar!', 'ok');
}

// RBC: mostra campo manual de densidade quando material = "outro"
function ajustarDensidade() {
  const sel = $('#p-densmat'); const wrap = $('#p-densmanual-wrap');
  if (!sel || !wrap) return;
  wrap.style.display = sel.value === 'outro' ? '' : 'none';
}

async function salvarPeso(id) {
  // Massa total é OBRIGATÓRIA (João, 13/08/2026): é ela que alimenta a soma
  // dos padrões no método da substituição e a rastreabilidade real do conjunto.
  const mt = Number($('#p-massa')?.value);
  if (!$('#p-massa')?.value || !isFinite(mt) || mt <= 0) {
    toast('Informe a MASSA TOTAL do conjunto em kg — a soma de todos os pesos ' +
          'cobertos por este certificado (ex.: 60 peças de 20 kg = 1200).', 'erro', 8000);
    $('#p-massa')?.classList.add('campo-faltando');
    $('#p-massa')?.focus();
    return;
  }
  const corpo = {
    identificacao: $('#p-id').value,
    valorNominal: $('#p-valor').value.trim() || null,
    massaTotalKg: $('#p-massa')?.value ? Number($('#p-massa').value) : null,
    classe: $('#p-classe').value,
    dataCalibracao: $('#p-datacal').value || null,
    validade: $('#p-val').value,
    numCertificado: $('#p-cert').value || null,
    laboratorio: $('#p-lab').value || null
  };
  // RBC: material/densidade continua no peso (default do conjunto)
  if (window._empresaAcreditada) {
    const densSel = $('#p-densmat');
    const densidade = densSel && densSel.value === 'outro'
      ? Number($('#p-densmanual')?.value) || null
      : Number(densSel?.value) || null;
    corpo.densidadeMaterial = densidade;
  }
  try {
    const r = await api('/pesos' + (id ? '/' + id : ''), {
      method: id ? 'PUT' : 'POST', body: JSON.stringify(corpo) });
    // RBC: salva os pontos do certificado (se acreditada)
    if (window._empresaAcreditada) {
      const pesoId = id || (r && r.id);
      if (pesoId) {
        const num = (v) => {
          if (v === '' || v === null || v === undefined) return null;
          const n = Number(String(v).trim().replace(',', '.'));
          return isNaN(n) ? null : n;
        };
        const pontos = (window.pontosRbc || [])
          .filter(pt => (pt.valorNominal || pt.valorConvencional !== '' || pt.incerteza !== ''))
          .map(pt => ({
            valorNominal: pt.valorNominal || null,
            valorConvencional: num(pt.valorConvencional),
            incerteza: num(pt.incerteza),
            k: num(pt.k) ?? 2
          }));
        await api('/pesos/' + pesoId + '/pontos', { method: 'PUT', body: JSON.stringify({ pontos }) });
      }
    }
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
    const rot = `${esc(p.identificacao)} · ${esc(p.valor_nominal || '')} · ${esc(p.classe)}` +
    (Number(p.massa_total_kg) > 0 ? ` · <b>${fmt(Number(p.massa_total_kg))} kg no total</b>` : '');
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
        ${campo('Nome fantasia', 'cf-fantasia', 'text', c.nome_fantasia)}
        ${campo('Cláusula da norma — método da substituição', 'cf-clausula-sub', 'text', c.clausula_substituicao)}
        ${campo('Endereço', 'cf-end', 'text', c.endereco)}
        ${campo('Cidade / UF', 'cf-ciduf', 'text', c.cidade_uf)}
        ${campo('Telefone', 'cf-fone', 'text', c.telefone)}
        ${campo('Email', 'cf-email', 'email', c.email)}
      </div>
      <label class="chk" style="margin-top:6px"><input type="checkbox" id="cf-email-auto" ${sim(c.envia_email_automatico ?? true)}>
        📧 Enviar o certificado por e-mail automaticamente na emissão</label>
      <p class="dica" style="margin:0 0 8px 24px">Vai para o e-mail do cadastro do cliente
        e para os contatos marcados com "Recebe certificados".</p>
      <label>Texto de autorização (linha livre no cabeçalho, ex.: "Autorização Inmetro nº 20000077")
        <input type="text" id="cf-autoriz-txt" value="${esc(c.texto_autorizacao || '')}"></label>
      ${campo('Título do documento', 'cf-titulo', 'text', c.titulo_documento)}
      <label>Método / procedimento (texto no certificado)
        <textarea id="cf-metodo" rows="3">${esc(c.metodo_calibracao || '')}</textarea></label>
      <label>Texto de periodicidade
        <textarea id="cf-period" rows="3">${esc(c.texto_periodicidade || '')}</textarea></label>
      <label>Texto de rodapé
        <textarea id="cf-rodape" rows="6">${esc(c.texto_rodape || '')}</textarea></label>
    </div>

    <div class="card">
      <h3>📦 Exportação de dados (backup da empresa)</h3>
      <p class="dica">Gera um arquivo .zip com todos os dados da empresa em CSV (clientes,
        balanças, ensaios, usuários) e os PDFs de todos os certificados emitidos.
        O arquivo fica disponível por 7 dias. Fotos e anexos não são incluídos.</p>
      <button class="btn-mini btn-primario" onclick="solicitarExportacao()">📦 Gerar exportação</button>
      <button class="btn-mini" onclick="carregarExportacoes()">🔄 Atualizar lista</button>
      <div id="cf-exports" style="margin-top:8px"></div>
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
      <div class="form-grid" style="margin-top:8px">
        <label>Largura do logo no PDF
          <input type="number" id="cf-logo-larg" min="30" max="200" value="${c.logo_largura ?? 90}"></label>
        <label>Altura máxima do logo
          <input type="number" id="cf-logo-alt" min="20" max="120" value="${c.logo_altura ?? 55}"></label>
        <label>Alinhamento vertical
          <select id="cf-logo-alin">
            <option value="topo" ${(c.logo_alinhamento ?? 'topo') === 'topo' ? 'selected' : ''}>Topo</option>
            <option value="centro" ${c.logo_alinhamento === 'centro' ? 'selected' : ''}>Centralizado</option>
            <option value="base" ${c.logo_alinhamento === 'base' ? 'selected' : ''}>Base</option>
          </select></label>
      </div>
      <p class="dica">Ajusta o tamanho e a posição do logo no cabeçalho do certificado (padrão: 90 × 55, topo).
        Gere o "exemplo em PDF" para conferir o resultado.</p>
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
        <select id="cf-modelo" onchange="document.getElementById('cf-instrucao-wrap')?.classList.toggle('oculta', this.value !== 'formulario4')">
          <option value="classico" ${(c.modelo_certificado||'classico')==='classico'?'selected':''}>Modelo 1 — formato relatório</option>
          <option value="completo" ${c.modelo_certificado==='completo'?'selected':''}>Modelo 2 — com sensibilidade, TUR, k e veff</option>
          <option value="formulario" ${c.modelo_certificado==='formulario'?'selected':''}>Modelo 3 — formato formulário (seções numeradas)</option>
          <option value="formulario4" ${c.modelo_certificado==='formulario4'?'selected':''}>Modelo 4 — formulário em caixas (com conforme/não conforme)</option>
        </select></label>
      <div id="cf-instrucao-wrap" class="${c.modelo_certificado==='formulario4'?'':'oculta'}">
        <p class="dica" style="margin-bottom:4px">Instrução de calibração — sai no Modelo 4, igual em todos os certificados.</p>
        <div class="grid2">
          ${campo('IT (instrução de trabalho)', 'cf-it', 'text', c.instrucao_it ?? '', 'placeholder="Ex.: MB 01"')}
          ${campo('Revisão', 'cf-rev', 'text', c.instrucao_rev ?? '', 'placeholder="Ex.: 1.0"')}
        </div>
      </div>
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

    <div class="card" style="border-left:4px solid #1e3a5f;background:#f7f9fb">
      <div class="barra"><h3 style="color:#1e3a5f">Acreditação RBC (ISO/IEC 17025)</h3></div>
      <p class="dica">Marque apenas se sua empresa é acreditada pela Cgcre/Inmetro. Isso habilita a emissão de certificados de calibração RBC (com selo de acreditação e cálculo de incerteza).</p>
      <label class="chk"><input type="checkbox" id="cf-acreditada" ${c.acreditada ? 'checked' : ''}> Somos acreditados Cgcre/RBC</label>
      ${campo('Nº de acreditação (ex.: CAL 0123)', 'cf-numacred', 'text', c.num_acreditacao)}
      <label>Selo RBC (imagem PNG/JPG)
        <input type="file" id="cf-selo" accept="image/png,image/jpeg"></label>
      <div id="cf-selo-preview">${c.selo_rbc_url ? '<span class="dica">Selo enviado ✓</span>' : '<span class="dica">Nenhum selo enviado ainda.</span>'}</div>
      <button class="btn-mini" onclick="enviarSeloRbc()">Enviar selo</button>
      <p id="cf-selo-msg" class="dica"></p>
    </div>

    <div class="rodape-acoes">
      <button class="btn-primario" onclick="salvarConfig()">Salvar configurações</button>
    </div>
    <p id="cf-msg" class="dica"></p>`;
  if (c.logo_url) carregarLogoPreview();
}

// RBC: envia o selo de acreditação (espelha o envio de logo)
async function enviarSeloRbc() {
  const inp = $('#cf-selo');
  if (!inp || !inp.files || !inp.files[0]) { $('#cf-selo-msg').textContent = 'Escolha um arquivo primeiro.'; return; }
  const fd = new FormData(); fd.append('file', inp.files[0]);
  $('#cf-selo-msg').textContent = 'Enviando...';
  try {
    const r = await fetch('/api/empresa/selo-rbc', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd });
    if (!r.ok) throw new Error('Falha ao enviar o selo.');
    $('#cf-selo-msg').textContent = 'Selo enviado ✓';
  } catch (e) { $('#cf-selo-msg').textContent = e.message; }
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
    nomeFantasia: $('#cf-fantasia').value || null,
    clausulaSubstituicao: $('#cf-clausula-sub')?.value || null,
    enviaEmailAutomatico: $('#cf-email-auto')?.checked ?? true,
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
    logoLargura: Number($('#cf-logo-larg')?.value) || 90,
    logoAltura: Number($('#cf-logo-alt')?.value) || 55,
    logoAlinhamento: $('#cf-logo-alin')?.value || 'topo',
    textoAutorizacao: $('#cf-autoriz-txt').value || null,
    mostraValidade: $('#cf-validade').checked,
    etiquetaTamanho: $('#cf-etiqueta').value,
    validarPermiteDownload: $('#cf-vdownload').checked,
    modeloCertificado: $('#cf-modelo').value,
    instrucaoIt: $('#cf-it')?.value.trim() || null,
    instrucaoRev: $('#cf-rev')?.value.trim() || null,
    acreditada: $('#cf-acreditada').checked,
    numAcreditacao: $('#cf-numacred').value || null
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
// ── Avisos de vencimento de calibração ──────────────────────
async function renderAvisos() {
  if (!ehGestor()) { $('#cad-conteudo').innerHTML = '<p class="dica">Sem permissão.</p>'; return; }
  let cfg;
  try { cfg = await api('/avisos-vencimento/config'); }
  catch (e) { $('#cad-conteudo').innerHTML = `<p class="erro">${e.message}</p>`; return; }

  // Marcos de dias oferecidos como checkbox + os já configurados
  const marcosPadrao = [60, 45, 30, 15, 7, 3, 1];
  const diasAtivos = (cfg.dias || '30,15,7').split(',')
    .map(s => parseInt(s.trim())).filter(n => n > 0);
  // Inclui qualquer marco personalizado que não esteja na lista padrão
  const marcos = [...new Set([...marcosPadrao, ...diasAtivos])].sort((a, b) => b - a);

  const checksDias = marcos.map(d => `
    <label class="chk-dia">
      <input type="checkbox" class="av-dia" value="${d}" ${diasAtivos.includes(d) ? 'checked' : ''}>
      <span>${d} ${d === 1 ? 'dia' : 'dias'}</span>
    </label>`).join('');

  $('#cad-conteudo').innerHTML = `
    <div class="card">
      <h3>📨 Avisos de vencimento de calibração
        <button type="button" class="btn-ajuda" onclick="ajuda('avisos_vencimento')" title="Como funciona este procedimento">?</button></h3>
      <p class="dica">Avise seus clientes quando a calibração das balanças estiver próxima do vencimento.
        As balanças de cada cliente são agrupadas em um único e-mail.</p>

      <label class="toggle-linha">
        <input type="checkbox" id="av-ativo" ${cfg.ativo ? 'checked' : ''}>
        <b>Enviar avisos automaticamente</b>
      </label>

      <div class="campo-bloco">
        <span class="campo-rotulo">Avisar com quantos dias de antecedência</span>
        <span class="dica">Marque um ou mais momentos para avisar antes do vencimento.</span>
        <div class="chks-dias">${checksDias}</div>
      </div>

      <div class="campo-bloco">
        <label class="campo-rotulo" for="av-freq">Não reenviar ao mesmo cliente antes de</label>
        <div style="display:flex;align-items:center;gap:8px">
          <input type="number" id="av-freq" value="${cfg.freqDias ?? 30}" min="1" style="max-width:100px">
          <span class="dica">dias</span>
        </div>
      </div>

      <label class="toggle-linha">
        <input type="checkbox" id="av-copia" ${cfg.copiaGestor ? 'checked' : ''}>
        Enviar cópia para os gestores da empresa
      </label>

      <button class="btn-primario btn-mini" style="margin-top:8px" onclick="salvarConfigAvisos()">Salvar configuração</button>
    </div>

    <div class="card">
      <div class="barra">
        <h3>Enviar agora (manual)</h3>
      </div>
      <p class="dica">Veja quais clientes têm balanças a vencer e dispare o aviso na hora.</p>
      <button class="btn-mini" onclick="carregarPreviaAvisos()">🔍 Ver quem seria avisado</button>
      <div id="av-previa" style="margin-top:12px"></div>
    </div>

    <div class="card">
      <h3>Histórico de avisos enviados</h3>
      <div id="av-historico"><button class="btn-mini" onclick="carregarHistoricoAvisos()">Carregar histórico</button></div>
    </div>`;
}

async function salvarConfigAvisos() {
  // Lê os dias marcados nos checkboxes (ordena do maior para o menor)
  const dias = Array.from(document.querySelectorAll('.av-dia:checked'))
    .map(c => parseInt(c.value)).sort((a, b) => b - a);
  if (dias.length === 0) {
    toast('Marque ao menos um prazo de antecedência.', 'erro');
    return;
  }
  const body = {
    ativo: $('#av-ativo').checked,
    dias: dias.join(','),
    freqDias: parseInt($('#av-freq').value) || 30,
    copiaGestor: $('#av-copia').checked
  };
  try {
    await api('/avisos-vencimento/config', { method: 'PUT', body: JSON.stringify(body) });
    toast('Configuração salva ✓', 'ok');
  } catch (e) { toast(e.message, 'erro'); }
}

async function carregarPreviaAvisos() {
  const box = $('#av-previa');
  box.innerHTML = '<p class="dica">Carregando…</p>';
  try {
    const lista = await api('/avisos-vencimento/previa');
    if (!lista.length) { box.innerHTML = '<p class="dica">Nenhum cliente com balanças a vencer no período.</p>'; return; }
    const linhas = lista.map(c => {
      const bal = JSON.parse(c.balancas);
      const semEmail = !c.email;
      return `<tr>
        <td><b>${esc(c.cliente)}</b>${semEmail ? ' <span class="badge rep">sem e-mail</span>' : ''}</td>
        <td>${esc(c.email || '—')}</td>
        <td class="num">${c.qtd}</td>
        <td><button class="btn-mini" onclick="enviarAvisoManual('${c.cliente_id}', '${esc(c.cliente).replace(/'/g, "\\'")}')"
              ${semEmail ? 'disabled title="Cliente sem e-mail"' : ''}>Enviar</button></td>
      </tr>`;
    }).join('');
    box.innerHTML = `
      <table class="tab-sa">
        <thead><tr><th>Cliente</th><th>E-mail</th><th>Balanças</th><th></th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>
      <button class="btn-primario btn-mini" style="margin-top:12px" onclick="enviarAvisoManual(null, 'todos os clientes')">
        📨 Enviar para todos (${lista.filter(c => c.email).length})
      </button>`;
  } catch (e) { box.innerHTML = `<p class="erro">${e.message}</p>`; }
}

async function enviarAvisoManual(clienteId, nome) {
  const ok = await modalConfirmar('Enviar aviso de vencimento',
    `Enviar o aviso de vencimento para ${nome}?`,
    { textoSim: 'Enviar', textoNao: 'Cancelar' });
  if (!ok) return;
  try {
    await api('/avisos-vencimento/enviar', { method: 'POST',
      body: JSON.stringify({ clienteId: clienteId }) });
    toast('Aviso(s) na fila de envio ✓ — chegará(ão) em instantes.', 'ok', 5000);
  } catch (e) { toast(e.message, 'erro'); }
}

async function carregarHistoricoAvisos() {
  const box = $('#av-historico');
  box.innerHTML = '<p class="dica">Carregando…</p>';
  try {
    const h = await api('/avisos-vencimento/historico');
    if (!h.length) { box.innerHTML = '<p class="dica">Nenhum aviso enviado ainda.</p>'; return; }
    box.innerHTML = `
      <table class="tab-sa">
        <thead><tr><th>Quando</th><th>Cliente</th><th>Modo</th><th>Balanças</th><th>E-mail</th></tr></thead>
        <tbody>${h.map(a => `<tr>
          <td class="dica">${dthr(a.enviado_em)}</td>
          <td>${esc(a.cliente)}</td>
          <td>${a.modo === 'automatico' ? '🤖 Automático' : '👤 Manual'}</td>
          <td class="num">${a.qtd_balancas}</td>
          <td class="dica">${esc(a.email_para || '—')}</td>
        </tr>`).join('')}</tbody>
      </table>`;
  } catch (e) { box.innerHTML = `<p class="erro">${e.message}</p>`; }
}

// ── Pesquisa de satisfação (config + perguntas + envio) ─────
async function renderPesquisa() {
  if (!ehGestor()) { $('#cad-conteudo').innerHTML = '<p class="dica">Sem permissão.</p>'; return; }
  let cfg, perguntas;
  try {
    cfg = await api('/pesquisa/config');
    perguntas = await api('/pesquisa/perguntas');
  } catch (e) { $('#cad-conteudo').innerHTML = `<p class="erro">${e.message}</p>`; return; }

  const temNps = perguntas.some(p => p.tipo === 'nps' && p.ativa);
  const listaPerg = perguntas.filter(p => p.ativa).map(p => `
    <div class="perg-item">
      <span class="perg-tipo ${p.tipo === 'nps' ? 'nps' : ''}">${p.tipo === 'nps' ? '⭐ NPS' : 'Nota'}</span>
      <span class="perg-txt">${esc(p.texto)}</span>
      <span class="perg-acoes">
        <button class="btn-mini" onclick="editarPergunta('${p.id}', ${JSON.stringify(esc(p.texto)).replace(/"/g, '&quot;')})">✏️</button>
        <button class="btn-mini" onclick="removerPergunta('${p.id}')">🗑️</button>
      </span>
    </div>`).join('') || '<p class="dica">Nenhuma pergunta cadastrada ainda.</p>';

  $('#cad-conteudo').innerHTML = `
    <div class="card">
      <h3>⭐ Pesquisa de satisfação (NPS)
        <button type="button" class="btn-ajuda" onclick="ajuda('pesq_config')" title="Como funciona a pesquisa e cada configuração">?</button></h3>
      <p class="dica">Colete a opinião dos seus clientes de forma estruturada — gera indicadores
        para certificação ISO 9001. Cada cliente recebe um link para responder (nota 0 a 10).</p>

      <label class="toggle-linha">
        <input type="checkbox" id="pq-ativa" ${cfg.ativa ? 'checked' : ''}>
        <b>Enviar pesquisa periodicamente</b>
      </label>
      <div class="campo-bloco">
        <label class="campo-rotulo" for="pq-freq">Enviar a cada</label>
        <div style="display:flex;align-items:center;gap:8px">
          <input type="number" id="pq-freq" value="${cfg.freqDias ?? 180}" min="1" style="max-width:100px">
          <span class="dica">dias (180 = semestral)</span>
        </div>
      </div>
      <label class="toggle-linha">
        <input type="checkbox" id="pq-anonima" ${cfg.anonima ? 'checked' : ''}>
        Respostas anônimas (não identifica qual cliente respondeu)
      </label>
      <button class="btn-primario btn-mini" style="margin-top:8px" onclick="salvarConfigPesquisa()">Salvar configuração</button>
    </div>

    <div class="card">
      <div class="barra"><h3>Perguntas
        <button type="button" class="btn-ajuda" onclick="ajuda('pesq_perguntas')" title="NPS principal, dimensões e como o NPS é calculado">?</button></h3></div>
      <p class="dica">${temNps ? '' : '⚠️ Adicione uma pergunta NPS principal (a pergunta "recomendaria?").'}
        Você pode adicionar dimensões como prazo, atendimento e qualidade técnica.</p>
      <div class="perg-lista">${listaPerg}</div>
      <div class="form-grid" style="margin-top:14px">
        <label style="flex:2">Nova pergunta
          <input type="text" id="pq-nova" placeholder="Ex.: Como avalia o prazo de entrega?">
        </label>
        <label>Tipo
          <select id="pq-tipo">
            <option value="nota">Dimensão (nota)</option>
            <option value="nps" ${temNps ? 'disabled' : ''}>NPS principal ${temNps ? '(já existe)' : ''}</option>
          </select>
        </label>
      </div>
      <button class="btn-mini" onclick="adicionarPergunta()">+ Adicionar pergunta</button>
    </div>

    <div class="card">
      <h3>👁 Antes de enviar: veja como chega ao cliente
        <button type="button" class="btn-ajuda" onclick="ajuda('pesq_previa')" title="O que são a prévia e o e-mail de teste">?</button></h3>
      <p class="dica">Confira a experiência exata do seu cliente — a página da pesquisa com a sua marca
        e o e-mail que ele recebe.</p>
      <button class="btn-mini" onclick="previaPesquisa()">👁 Abrir a pesquisa como o cliente vê</button>
      <button class="btn-mini" onclick="enviarPesquisaTeste()">✉️ Enviar e-mail de teste para mim</button>
      <p class="dica" style="margin-top:6px">O teste não conta nas estatísticas nem aparece no dashboard.</p>
    </div>

    <div class="card">
      <h3>Enviar agora (manual)
        <button type="button" class="btn-ajuda" onclick="ajuda('pesq_envio')" title="Envio manual × automático e quem recebe">?</button></h3>
      <p class="dica">Dispare a pesquisa na hora para os clientes com e-mail cadastrado.</p>
      <button class="btn-mini" onclick="enviarPesquisaManual(null)">📨 Enviar para todos os clientes</button>
      <p class="dica" style="margin-top:8px">Ou veja o dashboard de resultados em <b>Relatórios → Satisfação (NPS)</b>.</p>
    </div>

    <div class="card">
      <div class="barra"><h3>📊 Acompanhamento dos envios
        <button type="button" class="btn-ajuda" onclick="ajuda('pesq_acompanhamento')" title="Como ler os números e o que é uma boa taxa de resposta">?</button></h3>
        <button class="btn-mini" onclick="carregarEnviosPesquisa()">↻ Atualizar</button></div>
      <div id="pq-envios"><p class="dica">Carregando…</p></div>
    </div>`;
  carregarEnviosPesquisa();
}

// Prévia da pesquisa (link temporário de demonstração, com a marca da empresa)
async function previaPesquisa() {
  try {
    const r = await api('/pesquisa/previa-link', { method: 'POST' });
    window.open(r.link, '_blank');
  } catch (e) { toast(e.message, 'erro'); }
}

// E-mail de teste para o próprio gestor (não conta nas estatísticas)
async function enviarPesquisaTeste() {
  const email = prompt('Enviar o e-mail de teste para qual endereço?',
    (usuario && usuario.email) || '');
  if (!email) return;
  try {
    await api('/pesquisa/teste', { method: 'POST', body: JSON.stringify({ email }) });
    toast('E-mail de teste enviado para ' + email + ' ✓ (verifique também o spam)', 'ok');
  } catch (e) { toast(e.message, 'erro'); }
}

// Dashboard dos envios: enviados × respondidos × aguardando + últimos 20
async function carregarEnviosPesquisa() {
  const box = document.getElementById('pq-envios');
  if (!box) return;
  let envios;
  try { envios = await api('/pesquisa/envios'); }
  catch (e) { box.innerHTML = `<p class="erro">${e.message}</p>`; return; }
  const reais = envios.filter(e => e.modo !== 'teste');
  if (!reais.length) {
    box.innerHTML = '<p class="dica">Nenhum envio ainda. Use "Enviar para todos os clientes" ou aguarde o envio automático.</p>';
    return;
  }
  const respondidos = reais.filter(e => e.respondido_em).length;
  const taxa = Math.round(100 * respondidos / reais.length);
  const corTaxa = taxa >= 40 ? '#146c43' : taxa >= 20 ? '#c88a00' : '#b02a37';
  const dbr = v => v ? new Date(v).toLocaleDateString('pt-BR') : '—';
  box.innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px">
      <div style="flex:1;min-width:120px;background:#f7f9fb;border:1px solid #dde5ec;border-radius:10px;padding:8px 12px">
        <span class="dica">Enviadas (últimas)</span><br><b style="font-size:1.15rem">${reais.length}</b></div>
      <div style="flex:1;min-width:120px;background:#eef7f0;border:1px solid #cfe5d6;border-radius:10px;padding:8px 12px">
        <span class="dica">Respondidas</span><br><b style="font-size:1.15rem;color:#146c43">${respondidos}</b></div>
      <div style="flex:1;min-width:120px;background:#fdf6ea;border:1px solid #ecdcc0;border-radius:10px;padding:8px 12px">
        <span class="dica">Aguardando</span><br><b style="font-size:1.15rem;color:#c88a00">${reais.length - respondidos}</b></div>
      <div style="flex:1;min-width:120px;background:#f7f9fb;border:1px solid #dde5ec;border-radius:10px;padding:8px 12px">
        <span class="dica">Taxa de resposta</span><br><b style="font-size:1.15rem;color:${corTaxa}">${taxa}%</b></div>
    </div>
    <div class="tabela-scroll" style="max-height:260px">
      <table>
        <thead><tr><th>Enviada em</th><th>Cliente</th><th>Situação</th><th>Nota NPS</th></tr></thead>
        <tbody>${reais.map(e => `<tr>
          <td>${dbr(e.enviado_em)}</td>
          <td>${esc(e.cliente || '(anônima)')}</td>
          <td>${e.respondido_em
            ? `<span class="badge ok">Respondida em ${dbr(e.respondido_em)}</span>`
            : '<span class="badge">Aguardando</span>'}</td>
          <td>${e.nps_nota != null ? `<b>${e.nps_nota}</b>` : '—'}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
    <p class="dica" style="margin-top:6px">Resultados completos (NPS, evolução, dimensões):
      <b>Relatórios → Satisfação (NPS)</b>.</p>`;
}

async function salvarConfigPesquisa() {
  const body = {
    ativa: $('#pq-ativa').checked,
    freqDias: parseInt($('#pq-freq').value) || 180,
    anonima: $('#pq-anonima').checked
  };
  try { await api('/pesquisa/config', { method: 'PUT', body: JSON.stringify(body) });
    toast('Configuração salva ✓', 'ok'); }
  catch (e) { toast(e.message, 'erro'); }
}

async function adicionarPergunta() {
  const texto = $('#pq-nova').value.trim();
  if (!texto) { toast('Digite o texto da pergunta.', 'erro'); return; }
  const tipo = $('#pq-tipo').value;
  try {
    await api('/pesquisa/perguntas', { method: 'POST',
      body: JSON.stringify({ texto, tipo, ordem: tipo === 'nps' ? 0 : 99 }) });
    toast('Pergunta adicionada ✓', 'ok');
    renderPesquisa();
  } catch (e) { toast(e.message, 'erro'); }
}

async function editarPergunta(id, textoAtual) {
  const novo = prompt('Editar pergunta:', textoAtual);
  if (novo === null || !novo.trim()) return;
  try {
    await api('/pesquisa/perguntas/' + id, { method: 'PUT',
      body: JSON.stringify({ texto: novo.trim(), tipo: 'nota', ordem: 1 }) });
    toast('Pergunta atualizada ✓', 'ok');
    renderPesquisa();
  } catch (e) { toast(e.message, 'erro'); }
}

async function removerPergunta(id) {
  const ok = await modalConfirmar('Remover pergunta',
    'Deseja remover esta pergunta? As respostas já coletadas são mantidas.',
    { textoSim: 'Remover', perigo: true });
  if (!ok) return;
  try { await api('/pesquisa/perguntas/' + id, { method: 'DELETE' });
    toast('Pergunta removida ✓', 'ok'); renderPesquisa(); }
  catch (e) { toast(e.message, 'erro'); }
}

async function enviarPesquisaManual(clienteId) {
  const ok = await modalConfirmar('Enviar pesquisa',
    'Enviar a pesquisa de satisfação para os clientes com e-mail cadastrado?',
    { textoSim: 'Enviar' });
  if (!ok) return;
  try { await api('/pesquisa/enviar', { method: 'POST', body: JSON.stringify({ clienteId }) });
    toast('Pesquisa(s) na fila de envio ✓', 'ok', 5000); }
  catch (e) { toast(e.message, 'erro'); }
}

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
        <label>Papel *<select id="u-papel" onchange="document.getElementById('u-permissoes').style.display = this.value === 'tecnico' ? '' : 'none'">${sel}</select></label>
        ${campo('Registro profissional', 'u-reg', 'text', u?.registro_prof)}
        ${u ? '' : '<p class="dica" style="grid-column:1/-1">📧 O usuário receberá um email com um link para definir a própria senha. Você também poderá copiar o link e enviar por WhatsApp.</p>'}
      </div>

      <div id="u-permissoes" style="margin-top:10px;background:#f7f9fb;border:1px solid #e3e8ee;
        border-radius:9px;padding:10px 12px;display:${(u?.papel || 'tecnico') === 'tecnico' ? '' : 'none'}">
        <p style="font-size:12.5px;font-weight:600;color:#164066;margin:0 0 6px">
          Permissões do técnico</p>
        <label class="chk" style="display:block;margin:4px 0">
          <input type="checkbox" id="u-pode-cliente" ${u?.pode_criar_cliente ? 'checked' : ''}>
          Pode <b>cadastrar clientes</b>
          <span class="dica" style="display:block;margin-left:24px">Permite criar clientes novos
            durante o ensaio. Não permite editar nem excluir os existentes.</span></label>
        <label class="chk" style="display:block;margin:4px 0">
          <input type="checkbox" id="u-pode-balanca" ${(u ? u.pode_criar_balanca : true) ? 'checked' : ''}>
          Pode <b>cadastrar equipamentos</b>
          <span class="dica" style="display:block;margin-left:24px">Permite cadastrar balanças novas
            para clientes já existentes. Não permite editar as atuais.</span></label>
        <p class="dica" style="margin:6px 0 0">Administrador e responsável técnico têm essas
          permissões sempre — o bloco vale apenas para o papel Técnico.</p>
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
    papel: $('#u-papel').value, registroProf: $('#u-reg').value || null,
    podeCriarCliente: document.getElementById('u-pode-cliente')?.checked || false,
    podeCriarBalanca: document.getElementById('u-pode-balanca')?.checked ?? true,
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
let filtroTipoBal = '', filtroCapBal = '', verTodasBal = false;

// Permissões do técnico (definidas pelo admin no cadastro do usuário).
// Gestor sempre pode; o backend valida de novo — a interface só evita
// mostrar caminho que terminaria em erro.
function podeCriarCliente() {
  return ehGestor() || usuario?.pode_criar_cliente === true;
}
function podeCriarBalanca() {
  return ehGestor() || usuario?.pode_criar_balanca !== false;
}

// Aviso do que o técnico pode fazer nesta tela (João, 19/08/2026):
// as permissões de criar cliente e equipamento são definidas pelo
// administrador no cadastro do usuário.
// Atalho da busca do ensaio: abre o cadastro de balança já no cliente
// selecionado, e volta para a calibração ao terminar.
function abrirCadastroBalancaDoEnsaio() {
  const cli = $('#sel-cliente')?.value;
  if (!cli) { toast('Escolha o cliente primeiro.', 'erro'); return; }
  irCadastrosNaAba('clientes');
  setTimeout(() => { verBalancas(cli); setTimeout(() => formBalanca(cli), 300); }, 300);
}

function avisoPermissoesTecnico() {
  document.getElementById('aviso-perm')?.remove();
  if (ehGestor()) return;                       // admin e RT podem tudo
  const podeCli = usuario?.pode_criar_cliente === true;
  const podeBal = usuario?.pode_criar_balanca !== false;   // padrão: pode
  const itens = [];
  itens.push(podeCli
    ? '<span style="color:#1e7d46">✔ cadastrar clientes novos</span>'
    : '<span style="color:#8a6d1a">✖ cadastrar clientes</span>');
  itens.push(podeBal
    ? '<span style="color:#1e7d46">✔ cadastrar equipamentos</span>'
    : '<span style="color:#8a6d1a">✖ cadastrar equipamentos</span>');
  const tudo = podeCli && podeBal;
  const div = document.createElement('div');
  div.id = 'aviso-perm';
  div.style.cssText = 'margin:0 0 12px;padding:9px 12px;border-radius:9px;font-size:12.5px;' +
    'background:' + (tudo ? '#e7f5ec' : '#f7f9fb') + ';border:1px solid ' +
    (tudo ? '#bfe3cd' : '#e3e8ee');
  div.innerHTML = `<b>Nesta tela você pode:</b> ${itens.join(' &nbsp;·&nbsp; ')}
    ${(!podeCli || !podeBal)
      ? '<br><span class="dica">O que estiver marcado com ✖ deve ser solicitado ao administrador da empresa.</span>'
      : ''}`;
  const tela = document.getElementById('tela-nova');
  tela?.insertBefore(div, tela.firstElementChild?.nextSibling || tela.firstChild);
}

async function novaCalibracao() {
  setTimeout(carregarTecnicosExecutor, 0);   // seletor 'executado por' (gestores)
  mostrar('tela-nova');
  avisoPermissoesTecnico();
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
  // RBC: mostra o seletor de tipo só para empresa acreditada
  const blocoTipo = document.getElementById('bloco-tipo-rbc');
  if (blocoTipo) {
    blocoTipo.style.display = window._empresaAcreditada ? '' : 'none';
    const sel = document.getElementById('sel-tipo-rbc');
    if (sel) sel.value = 'padrao';
  }
  // garante saber se a empresa é acreditada (caso não tenha passado por Pesos)
  if (window._empresaAcreditada === undefined) {
    try { const cfg = await api('/empresa/config'); window._empresaAcreditada = !!cfg.acreditada;
      if (blocoTipo) blocoTipo.style.display = window._empresaAcreditada ? '' : 'none';
    } catch (e) {}
  }
}

function filtrarClientes() {
  const termo = $('#busca-cliente').value.toLowerCase().trim();
  const lista = $('#lista-clientes-busca');
  if (termo.length < 1) { lista.innerHTML = ''; return; }
  // Busca também por cidade, UF e endereço — filiais têm a mesma razão
  // social, e é a localização que diferencia (João, 11/08/2026)
  const achados = clientesCache.filter(c =>
    (c.razao_social || '').toLowerCase().includes(termo) ||
    (c.cnpj || '').toLowerCase().includes(termo) ||
    (c.cidade || '').toLowerCase().includes(termo) ||
    (c.uf || '').toLowerCase().includes(termo) ||
    (c.endereco || '').toLowerCase().includes(termo)
  ).slice(0, 8);
  lista.innerHTML = achados.length === 0
    ? `<div class="busca-vazio">Nenhum cliente encontrado${podeCriarCliente()
        ? `<br><button class="btn-mini btn-primario" style="margin-top:6px"
             onclick="irCadastrosNaAba('clientes'); setTimeout(formCliente, 300)">+ Cadastrar cliente</button>`
        : '<br><span class="dica">Peça ao administrador da empresa para cadastrá-lo.</span>'}</div>`
    : achados.map(c => {
      const local = [
        c.cidade ? esc(c.cidade) + (c.uf ? '/' + esc(c.uf) : '') : '',
        c.endereco ? esc(String(c.endereco).slice(0, 48)) : ''
      ].filter(Boolean).join(' — ');
      return `
      <div class="busca-item" onclick="escolherCliente('${c.id}')">
        <b>${esc(c.razao_social)}</b>
        ${c.cnpj ? `<span class="dica"> · ${esc(c.cnpj)}</span>` : ''}
        ${local ? `<br><span class="dica">📍 ${local}</span>` : ''}
      </div>`; }).join('');
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
  campo.placeholder = balancasNova.length > 12
    ? `Buscar entre ${balancasNova.length} balanças — série, Inmetro, marca…`
    : `Buscar entre ${balancasNova.length} balança(s)…`;
  // mostra todas de início (lista pronta para escolher sem digitar)
  filtroTipoBal = ''; filtroCapBal = ''; verTodasBal = false;
  montarFiltrosBalanca();
  aplicarFiltrosBalanca();
}

// Descreve uma balança em uma linha (para a lista de busca)
function descreverBalanca(b) {
  const partes = [];
  if (b.marca || b.modelo) partes.push(`${esc(b.marca || '')} ${esc(b.modelo || '')}`.trim());
  if (b.num_serie) partes.push('Série ' + esc(b.num_serie));
  if (b.numero_inmetro) partes.push('Inmetro ' + esc(b.numero_inmetro));
  if (b.capacidade) partes.push(fmt(b.capacidade) + ' ' + (normUnid(b.unidade) || 'kg'));
  return partes.join(' · ');
}

function renderListaBalancas(lista) {
  const alvo = $('#lista-balancas-busca');
  alvo.style.maxHeight = verTodasBal ? '420px' : '';
  alvo.style.overflowY = verTodasBal ? 'auto' : '';
  alvo.innerHTML = lista.length === 0
    ? `<div class="busca-vazio">Nenhuma balança encontrada${podeCriarBalanca()
        ? `<br><button class="btn-mini btn-primario" style="margin-top:6px"
             onclick="abrirCadastroBalancaDoEnsaio()">+ Cadastrar equipamento</button>`
        : '<br><span class="dica">Peça ao administrador para cadastrar este equipamento.</span>'}</div>`
    : (() => {
        // Ordena por urgência: vencidas primeiro, depois as que vencem antes.
        // Numa visita, a balança procurada quase sempre é uma dessas.
        const hoje = new Date();
        const dias = b => {
          if (!b.vence_em) return 99999;
          return Math.floor((new Date(String(b.vence_em).slice(0, 10)) - hoje) / 86400000);
        };
        const ord = [...lista].sort((a, b) => dias(a) - dias(b));
        const LIM = verTodasBal ? ord.length : 30;
        const itens = ord.slice(0, LIM).map(b => {
          const d = dias(b);
          const selo = d === 99999 ? ''
            : d < 0 ? '<span style="background:#fdecee;color:#b02a37;border-radius:99px;padding:1px 7px;font-size:10.5px;margin-left:6px">vencida</span>'
            : d <= 30 ? `<span style="background:#fdf6e3;color:#8a6d1a;border-radius:99px;padding:1px 7px;font-size:10.5px;margin-left:6px">vence em ${d}d</span>`
            : '';
          return `
      <div class="busca-item" onclick="escolherBalanca('${b.id}')">
        <b>⚖️ ${esc(b.identificacao)}</b>${selo}
        <span class="dica"> · ${descreverBalanca(b)}</span>
      </div>`;
        }).join('');
        const resto = ord.length - LIM;
        return itens + (resto > 0
          ? `<div class="dica" style="padding:8px 10px;text-align:center;border-top:1px solid #eef2f6">
               mostrando ${LIM} de ${ord.length} — <b>digite para filtrar</b> ou
               <button class="btn-mini" onclick="verTodasBalancas()">Ver todas (${ord.length})</button></div>`
          : (ord.length > 6
            ? `<div class="dica" style="padding:6px 10px;text-align:center">${ord.length} balança(s) ·
                 digite para filtrar</div>` : ''));
      })();
}

// Busca por identificação, marca, modelo, série ou número Inmetro
function filtrarBalancas() { aplicarFiltrosBalanca(); }

// Converte a capacidade para kg (para as faixas do filtro)
function capKgBal(b) {
  const u = (normUnid(b.unidade) || 'kg').toLowerCase();
  const v = Number(b.capacidade) || 0;
  if (u === 'g') return v / 1000;
  if (u === 't') return v * 1000;
  return v;
}

const FAIXAS_CAP_BAL = [
  { id: 'ate30',  rot: 'até 30 kg',    teste: kg => kg > 0 && kg <= 30 },
  { id: '30a300', rot: '30–300 kg',    teste: kg => kg > 30 && kg <= 300 },
  { id: '300a5t', rot: '300 kg – 5 t', teste: kg => kg > 300 && kg <= 5000 },
  { id: 'mais5t', rot: 'acima de 5 t', teste: kg => kg > 5000 },
];

// Linha de filtros (Tipo / Capacidade / Ver todas) — só quando >10 balanças
function montarFiltrosBalanca() {
  const lista = $('#lista-balancas-busca');
  let row = document.getElementById('filtros-balanca');
  if (balancasNova.length < 7) { if (row) row.remove(); return; }
  if (!row) {
    row = document.createElement('div');
    row.id = 'filtros-balanca';
    row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 8px';
    lista.parentNode.insertBefore(row, lista);
  }
  const tipos = {};
  balancasNova.forEach(b => { const t = (b.tipo || 'plataforma'); tipos[t] = (tipos[t] || 0) + 1; });
  const faixas = FAIXAS_CAP_BAL.filter(f => balancasNova.some(b => f.teste(capKgBal(b))));
  row.innerHTML =
    '<select id="filtro-tipo-bal" class="btn-mini" onchange="filtroTipoBal=this.value;aplicarFiltrosBalanca()">'
    + '<option value="">Tipo: todos</option>'
    + Object.keys(tipos).sort().map(t =>
        `<option value="${esc(t)}">${esc(t)} (${tipos[t]})</option>`).join('')
    + '</select>'
    + '<select id="filtro-cap-bal" class="btn-mini" onchange="filtroCapBal=this.value;aplicarFiltrosBalanca()">'
    + '<option value="">Capacidade: todas</option>'
    + faixas.map(f => `<option value="${f.id}">${f.rot}</option>`).join('')
    + '</select>'
    + (balancasNova.length > 30
        ? `<button class="btn-mini" onclick="verTodasBalancas()">Ver todas (${balancasNova.length})</button>`
        : `<span class="dica">${balancasNova.length} balanças</span>`);
  row.style.display = 'flex';
}

function verTodasBalancas() {
  verTodasBal = true;
  aplicarFiltrosBalanca();
}

// Filtro combinado: texto + tipo + faixa de capacidade
function aplicarFiltrosBalanca() {
  const row = document.getElementById('filtros-balanca');
  if (row) row.style.display = 'flex';
  const termo = ($('#busca-balanca').value || '').toLowerCase().trim();
  let lista = balancasNova;
  if (filtroTipoBal) lista = lista.filter(b => (b.tipo || 'plataforma') === filtroTipoBal);
  if (filtroCapBal) {
    const fx = FAIXAS_CAP_BAL.find(f => f.id === filtroCapBal);
    if (fx) lista = lista.filter(b => fx.teste(capKgBal(b)));
  }
  if (termo) lista = lista.filter(b =>
    (b.identificacao || '').toLowerCase().includes(termo) ||
    (b.marca || '').toLowerCase().includes(termo) ||
    (b.modelo || '').toLowerCase().includes(termo) ||
    (b.num_serie || '').toLowerCase().includes(termo) ||
    (b.numero_inmetro || '').toLowerCase().includes(termo) ||
    (b.tipo || '').toLowerCase().includes(termo)
  );
  renderListaBalancas(lista);
}

function escolherBalanca(id) {
  const b = balancasNova.find(x => x.id === id);
  if (!b) return;
  $('#sel-balanca').value = id;
  $('#busca-balanca').value = b.identificacao;
  $('#lista-balancas-busca').innerHTML = '';
  const rowFb = document.getElementById('filtros-balanca');
  if (rowFb) rowFb.style.display = 'none';
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
    const tipoSel = document.getElementById('sel-tipo-rbc');
    const emitirRbc = !!(window._empresaAcreditada && tipoSel && tipoSel.value === 'rbc');
    // Ja existe um ensaio em andamento (rascunho) desta balanca?
    if (await avisoRascunhoAberto(balancaId)) return;   // abriu o rascunho ou cancelou

    // AVISO: esta balanca ja foi calibrada nos ultimos 30 dias?
    if (!(await avisoCalibracaoRecente(balancaId))) return;

    window._ensaioRbc = emitirRbc;  // guarda para a coleta (fase 3b)
    await api('/certificados', { method: 'POST',
      body: JSON.stringify({ id: certId, clienteId, balancaId, emitirRbc,
        tecnicoExecutorId: document.getElementById('sel-executor')?.value || null }) });
    plano = await api('/balancas/' + balancaId + '/plano-ensaio');
    window._clienteEnsaio = clienteId;   // usado pelo seletor de endereço

    // Oferece aproveitar as cargas do último certificado desta balança
    let base = null;
    try {
      const u = await api('/balancas/' + balancaId + '/ultimo-plano', { opcional: true });
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
    if (window._ensaioRbc) montarTelaEnsaioRbc(); else montarTelaEnsaio(base);
  } catch (e) {
    $('#nova-erro').textContent = e.message;
  }
}

// ── Ajuda contextual (modal) ────────────────────────────────────
const AJUDA = {
  lote_carga: {
    titulo: 'Método da substituição (lote de carga)',
    corpo: `<p>Permite calibrar até cargas <b>maiores que os pesos-padrão
      disponíveis</b>, usando uma carga auxiliar (o "lote": blocos de concreto,
      veículo, ou qualquer lastro estável).</p>

      <p><b>⚙️ Como funciona na prática</b></p>
      <p style="margin:4px 0 10px;padding:6px 10px;background:#f4f7fa;border-radius:6px">
        1. Aplique os <b>pesos-padrão</b> e anote a indicação<br>
        2. Retire-os e coloque o <b>lote</b> até reproduzir a mesma indicação<br>
        3. Recoloque os padrões por cima → novo ponto<br>
        4. Repita os <b>degraus</b> até a carga desejada</p>
      <p>Exemplo: com 10 t de padrões, o ponto de 40 t leva <b>3 degraus</b>
      de substituição.</p>

      <hr style="margin:12px 0;border:none;border-top:1px solid #e3e8ee">
      <p><b>🖥️ No sistema</b><br>
      Marque a caixa e descreva o lote. A soma dos pesos selecionados é
      calculada sozinha, e cada ponto da tabela ganha o selo
      <b>☐ SUBST</b>: toque para marcar/desmarcar o ponto como substituição
      (os acima da soma já vêm sugeridos) e toque no número para ajustar os
      degraus.</p>
      <p>O certificado sai com <b>asterisco (*)</b> nos pontos marcados e a
      <b>nota do método</b> nas observações, citando a cláusula configurada
      em Configurações.</p>

      <p><b>📏 Atenção normativa</b><br>
      Para verificação, a Portaria Inmetro nº 157/2022 (OIML R76-1) exige
      pesos-padrão de no mínimo <b>½ da capacidade</b> — redutível a
      <b>⅓</b> se a repetibilidade for ≤ 0,3e, ou <b>⅕</b> se ≤ 0,2e.
      Respeitar essa fração é responsabilidade do procedimento do
      laboratório.</p>`
  },
  pesq_config: {
    titulo: '⭐ Como funciona a pesquisa de satisfação',
    corpo: `
      <p>A pesquisa mede a satisfação dos seus clientes com um link simples que eles
      abrem no celular ou computador, <b>com a marca da sua empresa</b> — sem login e sem instalar nada.</p>
      <p><b>Enviar pesquisa periodicamente:</b> com a chave ligada, o sistema envia sozinho,
      por e-mail, para os clientes com e-mail cadastrado — sem você precisar lembrar.
      Desligada, você ainda pode disparar manualmente quando quiser.</p>
      <p><b>Enviar a cada X dias:</b> o intervalo mínimo entre envios <u>para o mesmo cliente</u>.
      Com 180 dias, cada cliente é convidado no máximo 2x por ano. Valores comuns:
      90 (trimestral), 180 (semestral), 365 (anual). Intervalos curtos demais cansam o cliente
      e derrubam a taxa de resposta.</p>
      <p><b>Respostas anônimas:</b> ligada, você vê as notas e comentários, mas
      <u>não</u> qual cliente respondeu — algumas empresas preferem assim para respostas
      mais francas. Desligada, cada resposta aparece com o nome do cliente, o que permite
      agir diretamente com quem avaliou mal.</p>
      <p>💡 Os resultados servem de <b>evidência de monitoramento da satisfação do cliente
      para a ISO 9001</b> (requisito 9.1.2).</p>`
  },
  pesq_perguntas: {
    titulo: '📝 As perguntas da pesquisa',
    corpo: `
      <p>Há dois tipos de pergunta, e a diferença importa:</p>
      <p><b>⭐ NPS principal (obrigatória, apenas uma):</b> é a clássica
      <i>"De 0 a 10, o quanto você recomendaria nossa empresa?"</i>. É dela que sai o
      indicador NPS. A classificação é padrão mundial:
      notas <b>9–10 = promotores</b> (fãs da sua empresa),
      <b>7–8 = neutros</b> (satisfeitos, mas não engajados),
      <b>0–6 = detratores</b> (risco de perder e de falarem mal).</p>
      <p><b>NPS = % de promotores − % de detratores</b>, variando de −100 a +100.
      Acima de 0 já é positivo; acima de 50, muito bom; acima de 75, excelente.</p>
      <p><b>Dimensões (opcionais, quantas quiser):</b> notas de 0 a 10 sobre aspectos
      específicos — prazo de atendimento, qualidade técnica, atendimento da equipe, preço.
      Elas não entram no cálculo do NPS, mas mostram <u>onde</u> melhorar: um NPS baixo
      com nota ruim em "prazo" já diz o que atacar primeiro.</p>
      <p>💡 Menos é mais: 1 pergunta NPS + 2 a 4 dimensões respondem em menos de 1 minuto
      — e pesquisa curta tem taxa de resposta muito maior.</p>`
  },
  pesq_previa: {
    titulo: '👁 Prévia e e-mail de teste',
    corpo: `
      <p>Antes de disparar para clientes de verdade, veja exatamente o que eles vão receber:</p>
      <p><b>👁 Abrir a pesquisa como o cliente vê:</b> abre a página real da pesquisa,
      com o seu logotipo e suas perguntas, num link de demonstração. Você pode até responder
      para sentir o fluxo completo.</p>
      <p><b>✉️ Enviar e-mail de teste para mim:</b> envia para o endereço que você indicar
      o mesmo e-mail que o cliente recebe (assunto, texto e botão). Confira como aparece na
      caixa de entrada — e se não caiu no spam.</p>
      <p><b>Nada disso conta nas estatísticas:</b> aberturas, respostas e notas dos testes
      ficam fora do dashboard e do NPS. Teste à vontade.</p>`
  },
  pesq_envio: {
    titulo: '📨 Envio manual × envio automático',
    corpo: `
      <p><b>Enviar para todos os clientes (manual):</b> dispara agora, uma única vez, para
      todos os clientes com e-mail cadastrado — bom para a primeira rodada ou após um mutirão
      de atualização de cadastro. O intervalo mínimo é respeitado: quem recebeu há menos de
      X dias (a periodicidade configurada) <u>não</u> recebe de novo.</p>
      <p><b>Envio automático:</b> com a chave "Enviar pesquisa periodicamente" ligada, o
      sistema cuida do calendário sozinho, cliente a cliente, sempre respeitando o intervalo.</p>
      <p>💡 Clientes <u>sem e-mail cadastrado</u> não recebem — vale conferir os cadastros
      em Clientes antes da primeira rodada.</p>`
  },
  pesq_acompanhamento: {
    titulo: '📊 Lendo o acompanhamento dos envios',
    corpo: `
      <p><b>Enviadas:</b> convites que saíram (os últimos 20 aparecem na lista).</p>
      <p><b>Respondidas:</b> clientes que abriram o link e concluíram a pesquisa —
      com a data e a nota NPS de cada um na lista.</p>
      <p><b>Aguardando:</b> convites ainda sem resposta. Normal: a maioria responde nos
      primeiros 2–3 dias; depois disso, dificilmente responde.</p>
      <p><b>Taxa de resposta:</b> respondidas ÷ enviadas. Em pesquisas B2B por e-mail,
      <b>20–40% é um bom resultado</b> — verde acima de 40%, âmbar entre 20 e 40%,
      vermelho abaixo de 20%. Para melhorar a taxa: pesquisa curta, enviar logo após um
      serviço concluído e avisar o cliente de que a pesquisa vai chegar.</p>
      <p>💡 Os resultados consolidados (NPS, evolução mês a mês e médias por dimensão)
      ficam em <b>Relatórios → Satisfação (NPS)</b>.</p>`
  },
  avisos_vencimento: {
    titulo: 'Como funcionam os avisos de vencimento',
    corpo: `<p>O sistema acompanha o <b>vencimento da calibração</b> de cada balança
      (data da última calibração + periodicidade cadastrada) e avisa seus clientes
      por e-mail quando ele se aproxima.</p>
      <p><b>Envio automático:</b> com a opção ligada, o sistema verifica os vencimentos
      e dispara os e-mails sozinho, sem você precisar fazer nada.</p>
      <p><b>Marcos de antecedência:</b> os prazos marcados (ex.: 30 e 15 dias) definem
      <i>quando</i> o cliente é avisado antes do vencimento. Você pode marcar mais de um
      para ter aviso inicial e lembrete de reforço.</p>
      <p><b>Um e-mail por cliente:</b> se o cliente tem várias balanças vencendo,
      todas são agrupadas numa única mensagem, listando cada equipamento.</p>
      <p><b>Não reenviar antes de N dias:</b> é a trava anti-repetição. Depois de avisado,
      o mesmo cliente só recebe novo e-mail passado esse período — assim os marcos
      seguintes não viram spam. Ex.: com marcos 30/15 e trava de 30 dias, o cliente
      recebe um aviso por ciclo; com trava de 10 dias, recebe também o reforço dos 15.</p>
      <p><b>Cópia para os gestores:</b> quando marcado, os administradores e responsáveis
      técnicos da sua empresa recebem cópia de cada aviso enviado — útil para o
      comercial acompanhar e fazer o contato ativo.</p>
      <p><b>Envio manual:</b> o botão "Ver quem seria avisado" mostra a prévia dos
      clientes com balanças a vencer, e você pode disparar o aviso na hora para
      um cliente específico, sem esperar o automático.</p>
      <p><b>Histórico:</b> registra cada aviso enviado (data, cliente, quantidade de
      balanças e e-mail de destino), para auditoria e acompanhamento. Os envios também
      aparecem em Cadastros › E-mails enviados.</p>
      <p class="dica">O e-mail é enviado para o endereço cadastrado no cliente.
      Clientes sem e-mail cadastrado não recebem aviso — mantenha os cadastros em dia.</p>`
  },
  exc_na: {
    titulo: 'Excentricidade — Não aplicável',
    corpo: `<p>O ensaio de <b>excentricidade</b> verifica se a balança indica o mesmo
      valor quando a carga é aplicada em diferentes regiões do receptor de carga
      (centro, cantos ou seções da plataforma).</p>
      <p>Este equipamento foi cadastrado como <b>não sujeito</b> a esse ensaio.
      É o caso, por exemplo, de <b>balanças suspensas / de gancho (dinamômetros)</b>,
      em que a carga é aplicada num único ponto de suspensão — não existe uma
      superfície com múltiplas regiões de apoio a serem comparadas.</p>
      <p>O certificado registrará <b>"Não aplicável"</b> nesta seção. Se este
      equipamento deveria realizar o ensaio, ajuste o cadastro da balança
      (Cadastros › cliente › balança › Ensaios aplicáveis).</p>`
  },
  sens_na: {
    titulo: 'Sensibilidade — Não aplicável',
    corpo: `<p>O ensaio de <b>sensibilidade</b> verifica se, ao adicionar 1 divisão (e)
      sobre uma carga de referência, a indicação do display acompanha a variação.</p>
      <p>Este equipamento foi cadastrado como <b>não sujeito</b> a esse ensaio,
      conforme definido no cadastro da balança (ex.: balanças suspensas/de gancho
      ou instrumentos em que o procedimento não é exequível com segurança).</p>
      <p>O certificado registrará <b>"Não aplicável"</b> nesta seção. Se este
      equipamento deveria realizar o ensaio, ajuste o cadastro da balança
      (Cadastros › cliente › balança › Ensaios aplicáveis).</p>`
  },
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
    titulo: 'Ensaio de indicação — como os cálculos funcionam',
    corpo: `<p>Verifica se a balança indica corretamente ao longo de toda a faixa.
      Aplicam-se cargas crescentes e compara-se a indicação com o valor real.</p>
      <p>A prática recomenda <b>pelo menos 5 pontos</b> distribuídos: tipicamente
      a carga mínima, 25%, 50%, 75% e 100% da capacidade.</p>

      <hr style="margin:12px 0;border:none;border-top:1px solid #e3e8ee">
      <p><b>📐 Erro</b><br>
      É a diferença entre o que a balança mostrou e a carga real aplicada:</p>
      <p style="margin:4px 0 10px;padding:6px 10px;background:#f4f7fa;border-radius:6px">
        <b>Erro = Indicação − Carga</b></p>
      <p style="margin:-4px 0 10px">Exemplo: carga de 10 kg, a balança mostrou 10,002 kg
      → erro = <b>+0,002 kg</b>. Um erro positivo indica que a balança leu a mais;
      negativo, a menos.</p>

      <p><b>🎯 EMA (Erro Máximo Admissível)</b><br>
      É o limite de erro tolerado pela Portaria Inmetro nº 157/2022. Depende da
      classe da balança, do valor de divisão (<b>e</b>) e da faixa de carga — cargas
      maiores toleram um pouco mais de erro. É calculado como um múltiplo de <b>e</b>
      (por exemplo ±1e, ±2e ou ±3e conforme a faixa).</p>
      <p style="margin:-4px 0 10px">Em balanças de múltiplas faixas (multi-intervalo),
      o EMA usa o <b>e</b> da faixa em que a carga se encontra.</p>

      <p><b>✅ Status (OK / &gt; EMA)</b><br>
      O sistema compara o erro com o EMA daquele ponto, considerando a incerteza:</p>
      <p style="margin:4px 0 10px;padding:6px 10px;background:#f4f7fa;border-radius:6px">
        <b>|Erro| + Incerteza ≤ EMA → Conforme (OK)</b></p>
      <p style="margin:-4px 0 10px">Se o erro (em módulo, somado à incerteza) couber
      dentro do EMA, o ponto fica <b>OK</b>. Se ultrapassar, aparece <b>&gt; EMA</b>
      (não conforme naquele ponto). Esse é o critério de conformidade da Portaria 157/2022.</p>

      <p><b>⚠️ Fora do limite</b><br>
      Se a carga digitada for menor que a <b>carga mínima</b> ou maior que a
      <b>capacidade</b> da balança, o ponto é marcado como fora do limite — nesses
      valores a pesagem não é metrologicamente válida.</p>

      <p class="dica" style="margin-top:10px">Você pode adicionar, remover e editar
      os pontos conforme os pesos que realmente aplicou.</p>`
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

// ── Ordem de serviço: sugere a última usada ────────────────
// O mesmo atendimento costuma cobrir várias balanças; digitar a OS de novo
// a cada certificado é trabalho repetido.
async function sugerirUltimaOS() {
  const btn = document.getElementById('btn-os-sugerir');
  if (!btn) return;
  try {
    const r = await api('/certificados/ultima-os');
    if (!r?.ordem_servico) { btn.style.display = 'none'; return; }
    window._ultimaOS = r.ordem_servico;
    btn.style.display = '';
    btn.title = `Usar a mesma do atendimento anterior: ${r.ordem_servico}`;
  } catch (e) { btn.style.display = 'none'; }
}

function usarUltimaOS() {
  if (!window._ultimaOS) return;
  $('#ens-os').value = window._ultimaOS;
  sujo = true;
  toast('Ordem de serviço ' + window._ultimaOS, 'ok', 2500);
}

// ── Endereço da calibração: só aparece se o cliente tiver mais de um ──
async function carregarEnderecosEnsaio(selecionado) {
  const wrap = document.getElementById('wrap-endereco');
  const sel = document.getElementById('ens-endereco');
  const cli = window._clienteEnsaio;
  if (!wrap || !sel || !cli) return;
  let lista;
  try { lista = await api('/clientes/' + cli + '/enderecos'); }
  catch (e) { wrap.style.display = 'none'; return; }

  // Com um endereço só, o campo não aparece: não faz sentido escolher
  // entre uma opção. Aparece a partir de dois.
  if (!lista || lista.length < 2) { wrap.style.display = 'none'; return; }

  sel.innerHTML = '<option value="">— Selecione —</option>' + lista.map(e => {
    const txt = e.texto || e.apelido;
    return `<option value="${e.id || ''}" data-texto="${esc(
      e.principal ? txt : `${e.apelido}${e.texto ? ' · ' + e.texto : ''}`)}"
      ${(e.id || '') === (selecionado || '') ? 'selected' : ''}>
      ${esc(e.apelido)}${e.cidade ? ' — ' + esc(e.cidade) : ''}</option>`;
  }).join('');
  wrap.style.display = '';
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
function linhaIndicacaoHtml(carga, indic, antes = '', semLeitura = false, semLeituraAntes = false) {
  const mostrarAntes = $('#ens-houve-ajuste')?.checked;
  const slaInp = semLeituraAntes
    ? 'disabled placeholder="sem leitura" style="background:#fdecee;border-color:#b02a37;color:#b02a37;font-style:italic"'
    : '';
  const slaBtn = semLeituraAntes
    ? 'background:#b02a37;color:#fff;border-color:#b02a37'
    : '';
  const slInp = semLeitura
    ? 'disabled placeholder="sem leitura" style="background:#fdecee;border-color:#b02a37;color:#b02a37;font-style:italic"'
    : '';
  const slBtn = semLeitura
    ? 'background:#b02a37;color:#fff;border-color:#b02a37'
    : '';
  return `<td><input type="number" step="any" inputmode="decimal" class="in-carga"
             value="${fmtCampo(carga, plano?.faixas?.length ? eDaFaixa(Number(carga)) : null)}" onchange="atualizarCarga(this)" onblur="arredondarCampo(this)"></td>
    <td class="col-antes" style="${mostrarAntes ? '' : 'display:none'}">
      <div class="ind-wrap">
      <input type="number" step="any" inputmode="decimal" class="in-antes"
             value="${semLeituraAntes ? '' : fmtCampo(antes, plano?.faixas?.length ? eDaFaixa(Number(carga)) : null)}" ${slaInp} onblur="arredondarCampo(this)">
      <button type="button" class="btn-sem-leitura btn-sla${semLeituraAntes ? ' sl-on' : ''}" tabindex="-1"
              style="${slaBtn}" onclick="toggleSemLeituraAntes(this)"
              title="Sem leitura antes do ajuste: o visor não indicou nesta carga antes de ajustar">∅</button>
      </div></td>
    <td><div class="ind-wrap">
      <input type="number" step="any" inputmode="decimal" class="in-indic"
             value="${semLeitura ? '' : fmtCampo(indic, plano?.faixas?.length ? eDaFaixa(Number(carga)) : null)}" ${slInp} oninput="recalcular()" onblur="arredondarCampo(this)">
      <button type="button" class="btn-copiar-carga" tabindex="-1" onclick="copiarCargaParaIndicacao(this)"
              title="Copiar a carga para a indicação (leitura igual à carga)">=</button>
      <button type="button" class="btn-sem-leitura${semLeitura ? ' sl-on' : ''}" tabindex="-1"
              style="${slBtn}" onclick="toggleSemLeitura(this)"
              title="Sem leitura: a balança não mostrou indicação nesta carga">∅</button>
    </div></td>
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
  document.querySelectorAll('#tab-exc .col-antes-exc').forEach(el =>
    el.style.display = mostrar ? '' : 'none');
  sujo = true;
}

// Quando o usuário edita a carga, atualiza o data-carga da linha
function atualizarCarga(input) {
  const tr = input.closest('tr');
  if (!validarCapacidade(input)) return;    // acima da capacidade: recusa
  tr.dataset.carga = input.value || '0';
  arredondarCampo(input);
  recalcular();
}

// Trava de carga: barra o erro de digitação, não o ensaio legítimo.
//
// Muitas balanças continuam indicando acima da capacidade (a norma prevê
// indicação até Max + 9e), e ensaiar um pouco além do Max é procedimento
// válido. Por isso o limite não é a capacidade seca: são MAIS 20 DIVISÕES.
// O que se quer pegar é o zero a mais — 5000 em vez de 500 —, que geraria
// um certificado impossível.
const MARGEM_DIVISOES = 20;

function limiteCarga() {
  const temFaixas = plano?.faixas?.length > 0;
  // Multi-intervalo: a capacidade é o limite superior da ÚLTIMA faixa e a
  // margem usa o e daquela faixa (é o e que vale perto do Max).
  const cap = temFaixas
    ? Number(plano.faixas[plano.faixas.length - 1].limite_sup)
    : Number(plano?.capacidade);
  if (!cap || !isFinite(cap)) return null;
  const e = temFaixas
    ? Number(plano.faixas[plano.faixas.length - 1].divisao_e)
    : Number(plano?.divisao_e ?? plano?.divisaoE);
  return { cap, e: isFinite(e) && e > 0 ? e : 0,
           max: cap + MARGEM_DIVISOES * (isFinite(e) && e > 0 ? e : 0) };
}

function validarCapacidade(input) {
  const L = limiteCarga();
  if (!L) { input.classList.remove('campo-erro'); return true; }   // sem capacidade: não trava
  const v = Number(String(input.value).replace(',', '.'));
  if (!isFinite(v) || v <= L.max) { input.classList.remove('campo-erro'); return true; }

  const un = normUnid(plano?.unidade) || 'kg';
  input.classList.add('campo-erro');
  toast(`Carga de ${fmt(v)} ${un} acima do limite do ensaio. ` +
        `A capacidade é ${fmt(L.cap)} ${un}` +
        (L.e > 0 ? ` e o sistema aceita até ${fmt(L.max)} ${un} ` +
                   `(${MARGEM_DIVISOES} divisões acima).` : '.') +
        ' Confira o valor digitado.', 'erro', 7000);
  input.value = '';
  input.focus();
  return false;
}

// Copia o valor da carga da linha para o campo de indicação (agiliza
// o preenchimento quando a balança leu exatamente a carga — erro zero).
function copiarCargaParaIndicacao(btn) {
  const tr = btn.closest('tr');
  const carga = tr?.querySelector('.in-carga')?.value ?? tr?.dataset.carga;
  const alvo = tr?.querySelector('.in-indic');
  if (carga == null || carga === '' || !alvo) return;
  const eFaixa = plano?.faixas?.length ? eDaFaixa(Number(carga)) : null;
  const valor = fmtCampo(carga, eFaixa);
  alvo.value = valor;
  // Se a coluna "Antes do ajuste" está ativa, preenche também (a leitura
  // antes do ajuste normalmente parte da mesma carga aplicada).
  const antes = tr?.querySelector('.in-antes');
  const colAntes = tr?.querySelector('.col-antes');
  if (antes && colAntes && colAntes.style.display !== 'none')
    antes.value = valor;
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
        `&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,surface_pressure`;
      const r = await fetch(url);
      if (!r.ok) throw new Error('clima indisponível');
      const dados = await r.json();
      const temp = dados?.current?.temperature_2m;
      const umid = dados?.current?.relative_humidity_2m;
      const press = dados?.current?.surface_pressure;
      if (temp != null) $('#ens-temp').value = Math.round(temp * 10) / 10;
      if (umid != null) $('#ens-umid').value = Math.round(umid);
      if (press != null && $('#ens-pressao')) $('#ens-pressao').value = Math.round(press * 10) / 10;
      sujo = true;
      alert('Valores sugeridos a partir do clima da região.\n\n' +
        '⚠️ Confirme com os instrumentos do local — a balança pode estar ' +
        'num ambiente com condições diferentes das externas.');
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
function linhaExcHtml(pos, indic = '', numero = null, antes = '') {
  const ehCentro = pos === 'centro';
  // número de exibição: centro = 1; seções = 2, 3, 4...
  const rotulo = numero != null ? numero : (ehCentro ? 1 : '?');
  const comAjuste = $('#ens-houve-ajuste')?.checked;
  // Resolução de exibição: o "e" da FAIXA da carga do ensaio (multi-intervalo)
  const resExc = plano?.faixas?.length ? eDaFaixa(Number(plano.excentricidade.carga)) : null;
  return `<tr data-pos="${esc(pos)}" data-carga="${plano.excentricidade.carga}">
    <td>${rotulo}${ehCentro ? ' <span class="dica">(ref.)</span>' : ''}</td>
    <td class="col-antes-exc" style="display:${comAjuste ? '' : 'none'}"><input type="number" step="any"
         inputmode="decimal" class="in-exc-antes" value="${fmtCampo(antes, resExc)}"
         onblur="arredondarCampo(this)"></td>
    <td><div class="ind-wrap"><input type="number" step="any" inputmode="decimal" class="in-exc"
         value="${fmtCampo(indic, resExc)}"
         oninput="recalcular()" onblur="arredondarCampo(this)">
      ${ehCentro ? '' : `<button type="button" class="btn-copiar-carga" tabindex="-1"
              onclick="copiarExcReferencia(this)"
              title="Copiar a leitura da referência (posição 1) para esta posição">=</button>`}
    </div></td>
    <td class="num exc-erro">—</td>
    <td class="exc-acao"></td>
  </tr>`;
}

// Copia a leitura da posição de referência (centro) para a posição da linha
function copiarExcReferencia(btn) {
  const ref = document.querySelector('#tab-exc tbody tr[data-pos="centro"] .in-exc');
  if (!ref || ref.value === '') { toast('Preencha primeiro a leitura da posição 1 (referência).', 'aviso'); return; }
  const inp = btn.closest('td').querySelector('.in-exc');
  inp.value = ref.value;
  sujo = true;
  recalcular();
}

// Copia a leitura da MEDIÇÃO 1 da repetibilidade para a medição da linha
function copiarRepPrimeira(btn) {
  const primeira = document.querySelector('#tab-rep tbody tr:first-child input');
  if (!primeira || primeira.value === '') { toast('Preencha primeiro a medição 1.', 'aviso'); return; }
  const inp = btn.closest('tr').querySelector('input');
  inp.value = primeira.value;
  sujo = true;
  recalcular();
}

// Preenche o "Resultado no display" da sensibilidade com o valor esperado
// (carga de referência + 1 divisão da faixa)
function copiarSensEsperado() {
  const num = s => s === '' || s == null ? null : Number(s);
  const ref = num($('#sens-ref')?.value);
  const adic = num($('#sens-adicao')?.value);
  if (ref == null || adic == null) { toast('Preencha primeiro a carga de referência.', 'aviso'); return; }
  const eFaixa = plano?.faixas?.length ? eDaFaixa(ref) : null;
  $('#sens-display').value = fmtCampo(ref + adic, eFaixa);
  sujo = true;
  recalcular();
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
  // Ensaios aplicáveis (definidos no cadastro da balança). Se a flag não
  // vier no plano (backend antigo), assume que o ensaio se aplica.
  const fazExc = b.faz_excentricidade !== false;
  const fazSens = b.faz_sensibilidade !== false;
  $('#exc-conteudo')?.classList.toggle('oculta', !fazExc);
  $('#exc-na')?.classList.toggle('oculta', fazExc);
  $('#sens-conteudo')?.classList.toggle('oculta', !fazSens);
  $('#sens-na')?.classList.toggle('oculta', fazSens);
  $('#ens-titulo').textContent = `${b.cliente} · ${b.identificacao}`;
  $('#ens-chips').innerHTML = `
    <span class="chip">${esc([b.marca, b.modelo].filter(Boolean).join(' ') || 'Sem marca/modelo')}</span>
    ${b.num_serie ? `<span class="chip">Série: ${esc(b.num_serie)}</span>` : ''}
    ${b.numero_inmetro ? `<span class="chip">Inmetro: ${esc(b.numero_inmetro)}</span>` : ''}
    ${b.patrimonio ? `<span class="chip">Patrimônio: ${esc(b.patrimonio)}</span>` : ''}
    <span class="chip">Classe ${b.classe_exatidao}</span>
    <span class="chip">Capacidade ${fmtU(b.capacidade)} ${unid()}</span>
    ${plano.faixas?.length
      ? ''
      : `<span class="chip">Divisão e = ${fmtU(b.divisao_e)} ${unid()}${b.divisao_d && b.divisao_d != b.divisao_e ? ` · d = ${fmtU(b.divisao_d)} ${unid()}` : ''}</span>`}`;

  // Caixa amarela de múltipla escala (multi-intervalo) no topo da emissão
  const boxMulti = $('#ens-multi-box');
  if (boxMulti) {
    if (plano.faixas?.length) {
      boxMulti.innerHTML = `
        <div class="caixa-multi">
          <div class="caixa-multi-titulo">⚖️ Balança de múltipla escala (multi-intervalo)</div>
          <div class="caixa-multi-faixas">
            <div><span class="cm-rot">Capacidades:</span> ${plano.faixas.map(f => fmtCampo(f.limite_sup, f.divisao_e)).join(' / ')} ${unid()}</div>
            <div><span class="cm-rot">Divisões (e):</span> ${plano.faixas.map(f => fmtCampo(f.divisao_e, f.divisao_e)).join(' / ')} ${unid()}</div>
          </div>
        </div>`;
    } else {
      boxMulti.innerHTML = '';
    }
  }
  $('#ens-data').value = rascunho?.dataCalibracao || new Date().toISOString().slice(0, 10);
  $('#ens-temp').value = rascunho?.temperatura ?? '';
  $('#ens-umid').value = rascunho?.umidade ?? '';
  if ($('#ens-pressao')) $('#ens-pressao').value = rascunho?.pressao ?? '';
  $('#ens-contexto').value = rascunho?.contextoEma || 'subsequente';
  $('#ens-lacre').value = rascunho?.numeroLacre ?? '';
  $('#ens-selo').value = rascunho?.seloInmetro ?? '';
  $('#ens-local-tipo').value = rascunho?.localTipo || '';
  $('#ens-local-detalhe').value = rascunho?.localDetalhe ?? '';
  $('#ens-os').value = rascunho?.ordemServico ?? '';
  carregarEnderecosEnsaio(rascunho?.enderecoId || '');
  if (!rascunho?.ordemServico) sugerirUltimaOS();
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
      <span><b>${esc(p.identificacao)}</b> · ${esc(p.valor_nominal || '')} · ${esc(p.classe)} ${badge}
      ${p.certificado_pdf_url ? '<span class="dica">📄 certificado anexado</span>' : ''}</span>
    </label>`;
  }).join('') || '<p class="dica">Nenhum peso padrão cadastrado. Cadastre em Cadastros › Pesos padrão.</p>';
  window._pesosEnsaio = pesos;
  $('#ens-pesos').onchange = atualizarSubstituicao;
  montarBlocoSubstituicao(rascunho?.substituicao);

  const cargas = rascunho?.indicacao?.map(p => p.carga) || plano.indicacao;
  $('#tab-indicacao tbody').innerHTML = cargas.map((c, i) => `
    <tr data-carga="${c}">${linhaIndicacaoHtml(c, rascunho?.indicacao?.[i]?.indicacao ?? '', rascunho?.indicacao?.[i]?.indicacaoAntes ?? '', rascunho?.indicacao?.[i]?.semLeitura ?? false, rascunho?.indicacao?.[i]?.semLeituraAntes ?? false)}</tr>
  `).join('');
  toggleColunaAjuste();

  if (fazExc) {
    const exc = plano.excentricidade;
    if (rascunho?.excentricidade?.[0]?.carga != null)
      exc.carga = rascunho.excentricidade[0].carga;
    const excRasc = (pos, i) =>
      rascunho?.excentricidade?.find(x => x.posicao === pos) ?? rascunho?.excentricidade?.[i];
    // Posições: do rascunho (preserva as adicionadas/removidas pelo técnico);
    // sem rascunho, as sugeridas pelo tipo da balança
    const posicoesExc = rascunho?.excentricidade?.length > 0
      ? rascunho.excentricidade.map(x => x.posicao)
      : exc.posicoes;
    $('#tab-exc tbody').innerHTML =
      posicoesExc.map((pos, i) => {
        const r = excRasc(pos, i);
        return linhaExcHtml(pos, r?.indicacao ?? '', null, r?.indicacaoAntes ?? '');
      }).join('');
    atualizarExcControles();
    renumerarExc();
  } else {
    // Não aplicável: nenhuma linha é montada (nada é exigido nem enviado)
    $('#tab-exc tbody').innerHTML = '';
  }

  const rep = plano.repetibilidade;
  if (rascunho?.repetibilidade?.[0]?.carga != null)
    rep.carga = rascunho.repetibilidade[0].carga;
  $('#tab-rep tbody').innerHTML = Array.from({ length: rep.medicoes }, (_, i) => `
    <tr data-carga="${rep.carga}">
      <td>${i + 1}</td>
      <td><div class="ind-wrap"><input type="number" step="any" inputmode="decimal"
           value="${fmtCampo(rascunho?.repetibilidade?.[i]?.indicacao ?? '', plano?.faixas?.length ? eDaFaixa(Number(rep.carga)) : null)}"
           oninput="recalcular()" onblur="arredondarCampo(this)" step="any" inputmode="decimal">
        ${i === 0 ? '' : `<button type="button" class="btn-copiar-carga" tabindex="-1" onclick="copiarRepPrimeira(this)"
                title="Copiar a leitura da medição 1 para esta medição">=</button>`}
      </div></td>
    </tr>`).join('');

  $('#ens-erro').textContent = '';
  $('#ens-resultado').classList.add('oculta');
  mostrar('tela-ensaio');
  document.querySelectorAll('.u-unid').forEach(el => el.textContent = unid());
  document.getElementById('exc-carga').textContent = fazExc
    ? `(carga: ${fmtU(plano.excentricidade.carga)} ${unid()})` : '';
  document.getElementById('rep-carga').textContent = `(carga: ${fmtU(plano.repetibilidade.carga)} ${unid()})`;
  if (!document.getElementById('rep-veredito')) {
    const rv = document.createElement('span');
    rv.id = 'rep-veredito';
    rv.style.cssText = 'margin-left:10px;font-size:12.5px';
    document.getElementById('rep-carga')?.after(rv);
  } else document.getElementById('rep-veredito').textContent = '';

  // Sensibilidade (adição = 1 divisão da FAIXA da carga de referência) — opcional
  if (fazSens && $('#sens-ref')) {
    const s = rascunho?.sensibilidade;
    // Sugestão do plano (hoje só a balança RODOVIÁRIA envia: 10.000 kg —
    // regra de 09/08/2026); nos demais tipos vem nulo e o campo fica vazio
    // como sempre foi. O rascunho do técnico continua tendo prioridade.
    const ref = s?.cargaReferencia ?? plano?.sensibilidade?.carga;
    // resolução da faixa onde a carga de referência está (multi-intervalo)
    const eFaixa = (ref != null && ref !== '') ? eDaFaixa(Number(ref)) : Number(plano.balanca.divisao_e);
    $('#sens-ref').value = fmtCampo(ref ?? '', eFaixa);
    $('#sens-adicao').value = fmtCampo(eFaixa, eFaixa);
    $('#sens-display').value = fmtCampo(s?.resultadoDisplay ?? '', eFaixa);
  } else if ($('#sens-ref')) {
    // Não aplicável: limpa os campos (a SPA reaproveita o DOM entre ensaios;
    // valores antigos não podem vazar para coletarDados deste certificado)
    $('#sens-ref').value = '';
    $('#sens-adicao').value = '';
    $('#sens-display').value = '';
    $('#sens-aviso') && ($('#sens-aviso').textContent = '');
  }

  recalcular();

  carregarFotosEnsaio();

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

// Lista os pontos de indicação cujo erro ultrapassa o EMA (reprovados).
// Retorna descrições curtas para exibir no aviso de confirmação.
function pontosReprovados() {
  const un = normUnid(plano?.unidade);
  const reprovados = [];
  document.querySelectorAll('#tab-indicacao tbody tr').forEach(tr => {
    const carga = Number(tr.dataset.carga);
    const ind = num(tr.querySelector('.in-indic')?.value);
    if (ind == null || !isFinite(carga)) return;
    const ema = emaKg(carga);
    if (ema == null) return;
    const erro = ind - carga;
    if (!dentroDoEma(erro, ema)) {
      const sinal = erro > 0 ? '+' : '';
      reprovados.push(`${fmtU(carga)} ${un} (erro ${sinal}${fmtU(erro)}, EMA ±${fmtU(ema)})`);
    }
  });
  return reprovados;
}

// Resolve o "e" da faixa onde a carga está (multi-intervalo).
// Sem faixas cadastradas, usa a divisão única da balança.
function eDaFaixa(cargaKg) {
  const faixas = plano?.faixas;
  if (!faixas || !faixas.length) return Number(plano.balanca.divisao_e);
  for (const f of faixas)          // ordenadas por limite
    if (cargaKg <= Number(f.limite_sup)) return Number(f.divisao_e);
  return Number(faixas[faixas.length - 1].divisao_e);  // acima do último: última faixa
}

function emaKg(cargaKg) {
  const e = eDaFaixa(cargaKg);
  const ctx = $('#ens-contexto').value;
  const m = cargaKg / e;
  const regra = plano.emaRegras.find(r =>
    r.contexto === ctx && m > Number(r.faixa_min_e) &&
    (r.faixa_max_e == null || m <= Number(r.faixa_max_e)));
  return regra ? Number(regra.ema_multiplo_e) * e : null;
}

// Carga mínima (Min) conforme a classe de exatidão (OIML R76 / Portaria 236/94):
//   Classe I   → 100e     Classe II  → 50e
//   Classe III → 20e      Classe IIII → 10e
// Em multi-intervalo usa o "e" da PRIMEIRA faixa (a menor divisão).
function cargaMinimaKg() {
  const b = plano?.balanca;
  if (!b) return null;
  // menor e: em multi-intervalo é o e da faixa 1
  const e = plano?.faixas?.length ? Number(plano.faixas[0].divisao_e) : Number(b.divisao_e);
  if (!e || e <= 0) return null;
  const mult = { 'I': 100, 'II': 50, 'III': 20, 'IIII': 10 };
  const n = mult[b.classe_exatidao] ?? 20;   // padrão conservador (III)
  return n * e;
}

// Carga máxima (Max) = capacidade da balança
function cargaMaximaKg() {
  return plano?.balanca ? Number(plano.balanca.capacidade) : null;
}

// Arredonda o valor digitado para a resolução (divisão d, ou e) da balança
// Formata um valor para os campos do ensaio: múltiplo da divisão da
// balança, com as casas decimais derivadas da própria divisão.
// Usado tanto ao digitar (blur) quanto ao MONTAR a tela com valores
// vindos do banco (rascunho / aproveitamento do último certificado).
// Casas decimais de EXIBIÇÃO da balança: baseadas na menor divisão
// (em multi-intervalo, a menor faixa), para padronizar a apresentação.
// Ex.: balança com faixas 0,002 / 0,005 / 0,010 → sempre 3 casas.
// Resolução de arredondamento da balança para escala ÚNICA:
// usa o valor de divisão real (d) quando existe e é válido; senão o e.
// (d é a menor variação que o mostrador exibe; quando d < e, os campos
// devem ser arredondados pelo d, não pelo e.)
function resolucaoEscalaUnica() {
  const b = plano?.balanca;
  const d = Number(b?.divisao_d);
  if (isFinite(d) && d > 0) return d;
  return Number(b?.divisao_e);
}

function casasExibicao() {
  const b = plano?.balanca;
  let menor = resolucaoEscalaUnica();
  if (plano?.faixas?.length) {
    const es = plano.faixas.map(f => Number(f.divisao_e)).filter(x => x > 0);
    if (es.length) menor = Math.min(menor || Infinity, ...es);
  }
  if (!menor || menor <= 0) return 3;
  const sD = String(menor);
  const pt = sD.indexOf('.');
  return pt < 0 ? 0 : sD.slice(pt + 1).replace(/0+$/, '').length;
}

function fmtCampo(v, resolucao) {
  if (v == null || v === '') return '';
  const b = plano?.balanca;
  // resolução para ARREDONDAR: se informada (faixa multi-intervalo), usa ela;
  // senão usa a divisão real (d) da balança — ou o e se não houver d.
  const d = resolucao != null ? Number(resolucao) : resolucaoEscalaUnica();
  const n = Number(v);
  if (!b || !d || d <= 0 || !isFinite(n)) return String(v);
  // casas para EXIBIR: sempre as da menor divisão da balança (padroniza)
  const casas = casasExibicao();
  return (Math.round(n / d) * d).toFixed(casas);
}

function arredondarCampo(input) {
  if (input.value === '') return;
  // Se a balança é multi-intervalo, arredonda pela divisão da faixa da carga
  let resolucao = null;
  const tr = input.closest('tr');
  if (tr && tr.dataset.carga && plano?.faixas?.length) {
    resolucao = eDaFaixa(Number(tr.dataset.carga));
  }
  const f = fmtCampo(input.value, resolucao);
  if (f !== '') input.value = f;
  recalcular();
}

// ── Método da SUBSTITUIÇÃO / lote de carga — Fase 1 (João, 10/08/2026) ──
// Pontos ACIMA da soma dos pesos-padrão selecionados são realizados por
// substituição; degraus sugeridos = teto(ponto÷soma)−1, ajustáveis no toque
// do selo. Viaja no rascunho como substituicao:{ativa, somaPadroesKg,
// descricao, degraus:{carga:n}} — o worker põe asterisco + nota no PDF.
window._subDegraus = {};   // pontos MARCADOS: {carga: degraus}
function pesoEmKgSub(p) {
  // Massa total do conjunto (cadastro) é a fonte correta: um certificado
  // cobre N peças (ex.: 60 × 20 kg = 1.200 kg). Só cai na leitura do texto
  // quando o campo ainda não foi preenchido (João, 12/08/2026).
  const mt = Number(p.massa_total_kg);
  if (isFinite(mt) && mt > 0) return mt;
  let s = String(p.valor_nominal ?? '').trim();
  if (/^\d{1,3}(\.\d{3})+(,\d+)?/.test(s)) s = s.replace(/\./g, '');
  s = s.replace(',', '.');
  const n = parseFloat(s);
  if (!isFinite(n)) return 0;
  const u = String(p.unidade || 'kg').toLowerCase();
  return u === 'g' ? n / 1000 : u === 't' ? n * 1000 : n;
}
function somaPadroesSubKg() {
  const ids = [...document.querySelectorAll('#ens-pesos input:checked')].map(c => c.value);
  return (window._pesosEnsaio || []).filter(p => ids.includes(p.id))
    .reduce((s, p) => s + pesoEmKgSub(p), 0);
}
function sugestaoDegraus(carga) {
  const soma = somaPadroesSubKg();
  return soma > 0 && carga > soma ? Math.ceil(carga / soma) - 1 : 1;
}
function montarBlocoSubstituicao(sub) {
  document.getElementById('bloco-sub')?.remove();
  window._subDegraus = (sub && sub.degraus) || {};
  const alvo = $('#ens-pesos');
  if (!alvo) return;
  const div = document.createElement('div');
  div.id = 'bloco-sub';
  div.style.cssText = 'margin-top:10px;background:#f7f9fb;border:1px solid #dde5ec;' +
    'border-radius:10px;padding:10px 12px';
  div.innerHTML = `
    <label style="display:flex;gap:8px;align-items:center;cursor:pointer;margin:0">
      <input type="checkbox" id="sub-ativa" ${sub?.ativa ? 'checked' : ''}
        onchange="ligarSubstituicao(this.checked)" style="width:16px;height:16px">
      <b>Método da substituição (lote de carga)</b>
      <button type="button" class="btn-ajuda" title="Como funciona o lote de carga"
        onclick="event.preventDefault(); event.stopPropagation(); ajuda('lote_carga')">?</button></label>
    <div id="sub-corpo" style="display:${sub?.ativa ? '' : 'none'};margin-top:8px">
      <div class="form-grid">
        <label>Padrões selecionados (soma)
          <input type="text" id="sub-soma" readonly style="background:#eef2f7"></label>
        <label>Descrição da carga de substituição
          <input type="text" id="sub-desc" placeholder="ex.: blocos de concreto (~10 t por degrau)"
            value="${esc(sub?.descricao || '')}" oninput="sujo = true"></label>
      </div>
      <p class="dica" id="sub-aviso-massa" style="margin:6px 0 0"></p>
      <p class="dica" style="margin:6px 0 0">Marque em cada ponto da tabela o selo
        <b>SUBST</b> (os pontos acima da soma já vêm sugeridos — você decide).
        Nos marcados, toque no número para ajustar os degraus.</p>
    </div>`;
  alvo.insertAdjacentElement('afterend', div);
  atualizarSubstituicao();
}
// Liga/desliga o método. Ao LIGAR pela primeira vez (sem marcações), sugere
// os pontos acima da soma — o técnico marca/desmarca livremente depois.
function ligarSubstituicao(ligado) {
  if (ligado && Object.keys(window._subDegraus).length === 0) {
    const soma = somaPadroesSubKg();
    document.querySelectorAll('#tab-indicacao tbody tr').forEach(tr => {
      const carga = Number(tr.dataset.carga);
      if (soma > 0 && carga > soma)
        window._subDegraus[carga] = Math.ceil(carga / soma) - 1;
    });
  }
  atualizarSubstituicao();
}
function atualizarSubstituicao() {
  const chk = document.getElementById('sub-ativa');
  if (!chk) return;
  const corpo = document.getElementById('sub-corpo');
  if (corpo) corpo.style.display = chk.checked ? '' : 'none';
  const soma = somaPadroesSubKg();
  const el = document.getElementById('sub-soma');
  if (el) el.value = soma > 0 ? fmt(soma) + ' kg' : '— selecione os pesos —';
  // Avisa se algum peso marcado está sem a massa total no cadastro
  const ids = [...document.querySelectorAll('#ens-pesos input:checked')].map(c => c.value);
  const semMassa = (window._pesosEnsaio || []).filter(p =>
    ids.includes(p.id) && !(Number(p.massa_total_kg) > 0));
  const av = document.getElementById('sub-aviso-massa');
  if (av) av.innerHTML = semMassa.length === 0 ? '' :
    `<span style="color:#b7791f">⚠️ ${semMassa.map(p => esc(p.identificacao)).join(', ')}
     sem <b>massa total do conjunto</b> no cadastro — a soma acima pode estar incompleta.
     Ajuste em Cadastros › Pesos padrão.</span>`;
  atualizarSubBadges();
  sujo = true;
}
function alternarSubPonto(carga) {
  if (carga in window._subDegraus) delete window._subDegraus[carga];
  else window._subDegraus[carga] = sugestaoDegraus(carga);
  sujo = true;
  atualizarSubBadges();
}
function editarSubDegraus(carga) {
  const atual = window._subDegraus[carga] ?? sugestaoDegraus(carga);
  const v = prompt('Degraus de substituição para o ponto de ' + fmt(carga) + ' kg:', atual);
  if (v === null) return;
  const n = parseInt(v);
  if (isFinite(n) && n > 0) { window._subDegraus[carga] = n; sujo = true; }
  atualizarSubBadges();
}
function atualizarSubBadges() {
  const ativa = document.getElementById('sub-ativa')?.checked;
  document.querySelectorAll('#tab-indicacao tbody tr').forEach(tr => {
    tr.querySelector('.sub-badge')?.remove();
    if (!ativa) return;
    const carga = Number(tr.dataset.carga);
    const marcado = carga in window._subDegraus;
    const b = document.createElement('span');
    b.className = 'sub-badge';
    if (marcado) {
      const d = window._subDegraus[carga];
      b.innerHTML = '☑ SUBST · <u>' + d + ' degrau' + (d === 1 ? '' : 's') + '</u>';
      b.style.cssText = 'display:inline-block;margin-top:3px;background:#fdf6e3;color:#8a6d1a;' +
        'border:1px solid #e6d9a8;border-radius:99px;padding:1px 8px;font-size:10.5px;cursor:pointer';
      b.title = 'Ponto pelo método da substituição — toque para desmarcar; toque no número para ajustar';
      b.onclick = ev => {
        if (ev.target.tagName === 'U') editarSubDegraus(carga);
        else alternarSubPonto(carga);
      };
    } else {
      b.textContent = '☐ SUBST';
      b.style.cssText = 'display:inline-block;margin-top:3px;background:#f1f5f9;color:#8ba0b5;' +
        'border:1px dashed #c9d6e2;border-radius:99px;padding:1px 8px;font-size:10.5px;cursor:pointer';
      b.title = 'Toque para marcar este ponto como método da substituição';
      b.onclick = () => alternarSubPonto(carga);
    }
    tr.querySelector('td')?.appendChild(b);
  });
}
function coletarSubstituicao() {
  const chk = document.getElementById('sub-ativa');
  if (!chk?.checked) return null;
  const degraus = {};
  const cargasNaTela = new Set([...document.querySelectorAll('#tab-indicacao tbody tr')]
    .map(tr => Number(tr.dataset.carga)));
  for (const [c, d] of Object.entries(window._subDegraus))
    if (cargasNaTela.has(Number(c))) degraus[c] = d;
  return { ativa: true, somaPadroesKg: somaPadroesSubKg(),
    descricao: (document.getElementById('sub-desc')?.value || '').trim() || null, degraus };
}

function recalcular() {
  sujo = true;
  try { atualizarSubBadges(); } catch (e) {}
  // Limite físico AO VIVO (João, 11/08/2026): valor acima de Máx + 20e
  // fica vermelho na hora da digitação (o envio continua bloqueado também).
  try {
    const capV = Number(plano?.balanca?.capacidade) || 0;
    const eV = Number(plano?.balanca?.divisao_e) || 0;
    const tetoV = capV > 0 ? capV + 20 * eV : 0;
    if (tetoV > 0)
      document.querySelectorAll(
        '#tab-indicacao tbody input, #tab-rep tbody input, #tab-exc tbody input')
        .forEach(inp => {
          if (inp.disabled) return;   // ponto sem leitura: mantém o visual próprio
          const v = num(inp.value);
          const estourou = v != null && v > tetoV;
          inp.style.background = estourou ? '#fdecee' : '';
          inp.style.borderColor = estourou ? '#b02a37' : '';
          inp.style.color = estourou ? '#b02a37' : '';
          inp.title = estourou
            ? 'Acima do limite físico da balança (Máx + 20e = ' + fmtU(tetoV) + ' ' + unid() + ')'
            : '';
        });
  } catch (e) {}
  // Veredito da repetibilidade (R76): a diferença entre a maior e a menor
  // leitura na mesma carga não pode exceder o |EMA| daquela carga.
  try {
    const el = document.getElementById('rep-veredito');
    if (el) {
      const vals = [...document.querySelectorAll('#tab-rep tbody input')]
        .map(i => num(i.value)).filter(v => v != null);
      if (vals.length >= 2) {
        const dif = Math.max(...vals) - Math.min(...vals);
        const cargaRep = Number(document.querySelector('#tab-rep tbody tr')?.dataset.carga);
        const ema = isFinite(cargaRep) ? emaKg(cargaRep) : null;
        if (ema != null) {
          const ok = dif <= ema;
          el.innerHTML = ok
            ? '<span style="color:#1e7d46">Conforme (dif. ' + fmtU(dif) + ' ≤ EMA ' + fmtU(ema) + ')</span>'
            : '<span style="color:#b02a37;font-weight:600">NÃO CONFORME — diferença ' +
              fmtU(dif) + ' ' + unid() + ' excede o EMA ' + fmtU(ema) + ' ' + unid() + '</span>';
        } else el.textContent = '';
      } else el.textContent = '';
    }
  } catch (e) {}
  const cargaMin = cargaMinimaKg();
  const cargaMax = cargaMaximaKg();
  document.querySelectorAll('#tab-indicacao tbody tr').forEach(tr => {
    const carga = Number(tr.dataset.carga);
    const inp = tr.querySelector('.in-indic');
    const v = inp ? inp.value : '';

    // Aviso de carga fora dos limites metrológicos (Min / Max)
    const cargaCel = tr.querySelector('.in-carga');
    let avisoLimite = '';
    if (isFinite(carga) && carga > 0) {
      if (cargaMin != null && carga < cargaMin)
        avisoLimite = `abaixo da carga mínima (${fmtU(cargaMin)} ${unid()})`;
      else if (cargaMax != null && carga > cargaMax)
        avisoLimite = `acima da capacidade (${fmtU(cargaMax)} ${unid()})`;
    }
    if (cargaCel) cargaCel.classList.toggle('carga-fora-limite', !!avisoLimite);
    if (cargaCel) cargaCel.title = avisoLimite || '';

    if (v === '') {
      tr.querySelector('.erro-cel').textContent = '—';
      tr.querySelector('.ema-cel').textContent = fmtU(emaKg(carga));
      tr.querySelector('.status-cel').innerHTML = avisoLimite
        ? `<span class="badge aviso" title="${avisoLimite}">⚠️ fora do limite</span>` : '—';
      return;
    }
    const erro = Number(v) - carga, ema = emaKg(carga);
    tr.querySelector('.erro-cel').textContent = (erro > 0 ? '+' : '') + fmtU(erro);
    tr.querySelector('.ema-cel').textContent = ema == null ? '—' : '± ' + fmtU(ema);
    tr.querySelector('.status-cel').innerHTML = avisoLimite
      ? `<span class="badge aviso" title="${avisoLimite}">⚠️ fora do limite</span>`
      : ema == null ? '—'
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

// Sensibilidade: a adição é 1 divisão (e) da FAIXA da carga de referência.
// Em multi-intervalo, o "e" muda conforme a carga; por isso lê a carga de ref.
function atualizarSensAdicao() {
  if (!$('#sens-adicao')) return;
  const ref = num($('#sens-ref')?.value);
  const eFaixa = (ref != null) ? eDaFaixa(ref) : Number(plano?.balanca?.divisao_e);
  $('#sens-adicao').value = fmtCampo(eFaixa, eFaixa);
}

// Arredonda a carga de referência pela resolução da sua faixa
function arredondarSensRef() {
  const inp = $('#sens-ref');
  if (!inp || inp.value === '') return;
  const ref = Number(inp.value);
  const eFaixa = eDaFaixa(ref);
  inp.value = fmtCampo(ref, eFaixa);
  atualizarSensAdicao();
  validarSensCapacidade();
}

// Verifica se a carga de referência + adição não passam da capacidade máxima.
// Destaca os campos em vermelho e mostra aviso. Retorna true se está OK.
function validarSensCapacidade() {
  const inpRef = $('#sens-ref');
  const aviso = $('#sens-aviso');
  if (!inpRef) return true;
  const ref = num(inpRef.value);
  const cargaMax = cargaMaximaKg();
  const adicao = num($('#sens-adicao')?.value) || 0;
  let erro = '';
  if (ref != null && cargaMax != null) {
    if (ref > cargaMax)
      erro = `A carga de referência (${fmtU(ref)} ${unid()}) ultrapassa a capacidade máxima da balança (${fmtU(cargaMax)} ${unid()}).`;
    else if (ref + adicao > cargaMax)
      erro = `Carga de referência + adição (${fmtU(ref + adicao)} ${unid()}) ultrapassa a capacidade máxima (${fmtU(cargaMax)} ${unid()}). Use uma carga de referência menor.`;
  }
  inpRef.classList.toggle('campo-faltando', !!erro);
  if (aviso) aviso.textContent = erro;
  return !erro;
}

// Arredonda o resultado do display pela resolução da faixa da carga de ref
function arredondarSensDisplay() {
  const inp = $('#sens-display');
  if (!inp || inp.value === '') return;
  const ref = num($('#sens-ref')?.value);
  const eFaixa = (ref != null) ? eDaFaixa(ref) : Number(plano?.balanca?.divisao_e);
  inp.value = fmtCampo(inp.value, eFaixa);
}

function coletarDados() {
  const num = v => v === '' ? null : Number(v);
  return {
    dataCalibracao: $('#ens-data').value || null,
    temperatura: num($('#ens-temp').value),
    umidade: num($('#ens-umid').value),
    pressao: num($('#ens-pressao')?.value),
    contextoEma: $('#ens-contexto').value,
    numeroLacre: $('#ens-lacre').value || null,
    seloInmetro: $('#ens-selo').value || null,
    localTipo: $('#ens-local-tipo').value,
    localDetalhe: $('#ens-local-detalhe').value || null,
    ordemServico: ($('#ens-os')?.value || '').trim() || null,
    enderecoId: $('#ens-endereco')?.value || null,
    enderecoTexto: (() => {
      const s = $('#ens-endereco');
      if (!s || !s.value) return null;
      return s.options[s.selectedIndex]?.dataset.texto || null;
    })(),
    houveAjuste: $('#ens-houve-ajuste')?.checked || false,
    substituicao: coletarSubstituicao(),
    pesos: [...document.querySelectorAll('#ens-pesos input:checked')].map(c => c.value),
    indicacao: [...document.querySelectorAll('#tab-indicacao tbody tr')].map(tr => ({
      carga: Number(tr.dataset.carga),
      indicacao: num(tr.querySelector('.in-indic').value),
      indicacaoAntes: num(tr.querySelector('.in-antes')?.value),
      semLeitura: !!tr.querySelector('.btn-sem-leitura.sl-on:not(.btn-sla)'),
      semLeituraAntes: !!tr.querySelector('.btn-sla.sl-on')
    })),
    excentricidade: [...document.querySelectorAll('#tab-exc tbody tr')].map(tr => ({
      posicao: tr.dataset.pos, carga: Number(tr.dataset.carga),
      indicacao: num(tr.querySelector('.in-exc').value),
      indicacaoAntes: num(tr.querySelector('.in-exc-antes')?.value)
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
  // limpa destaques anteriores
  document.querySelectorAll('.campo-faltando').forEach(el => el.classList.remove('campo-faltando'));

  // ── Limite físico (João, 11/08/2026): nenhuma leitura pode passar de
  // Máx + 20e — indicador real apaga acima disso; valor maior é erro de
  // digitação (ex.: 120.000 numa balança de 80.000). Bloqueia o envio.
  const capMaxFis = Number(plano?.balanca?.capacidade) || 0;
  const eFis = Number(plano?.balanca?.divisao_e) || 0;
  const tetoFis = capMaxFis > 0 ? capMaxFis + 20 * eFis : 0;
  if (tetoFis > 0) {
    const estourados = [];
    document.querySelectorAll(
      '#tab-indicacao tbody input, #tab-rep tbody input, #tab-exc tbody input')
      .forEach(inp => {
        const v = num(inp.value);
        if (v != null && v > tetoFis) { inp.classList.add('campo-faltando'); estourados.push(inp); }
      });
    if (estourados.length) {
      $('#ens-erro').textContent = 'Há leitura acima do limite físico da balança ' +
        '(Máx ' + fmtU(capMaxFis) + ' + 20e = ' + fmtU(tetoFis) + ' ' + unid() +
        ') — corrija os campos destacados.';
      estourados[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
      estourados[0].focus();
      return;
    }
  }

  const faltando = [];

  // Indicação: cada linha com carga precisa de indicação preenchida
  const ajusteAtivo = $('#ens-houve-ajuste')?.checked;
  document.querySelectorAll('#tab-indicacao tbody tr').forEach(tr => {
    const temCarga = tr.dataset.carga != null && tr.dataset.carga !== '';
    const inp = tr.querySelector('.in-indic');
    // Ponto marcado SEM LEITURA conta como preenchido (João, 23/08/2026)
    const slFinal = !!tr.querySelector('.btn-sem-leitura.sl-on:not(.btn-sla)');
    const slAntes = !!tr.querySelector('.btn-sla.sl-on');
    if (temCarga && !slFinal && num(inp?.value) == null) {
      inp?.classList.add('campo-faltando');
      faltando.push(inp);
    }
    // Se a coluna "Antes do ajuste" está ativa, ela também é obrigatória
    if (ajusteAtivo && temCarga) {
      const antes = tr.querySelector('.in-antes');
      const colAntes = tr.querySelector('.col-antes');
      if (antes && colAntes && colAntes.style.display !== 'none' && !slAntes && num(antes.value) == null) {
        antes.classList.add('campo-faltando');
        faltando.push(antes);
      }
    }
  });
  // Excentricidade
  document.querySelectorAll('#tab-exc tbody tr').forEach(tr => {
    const inp = tr.querySelector('.in-exc');
    if (tr.dataset.carga && num(inp?.value) == null) {
      inp?.classList.add('campo-faltando');
      faltando.push(inp);
    }
  });
  // Repetibilidade
  document.querySelectorAll('#tab-rep tbody tr').forEach(tr => {
    const inp = tr.querySelector('input');
    if (tr.dataset.carga && num(inp?.value) == null) {
      inp?.classList.add('campo-faltando');
      faltando.push(inp);
    }
  });

  if (faltando.length) {
    $('#ens-erro').textContent = `⚠️ ${faltando.length} campo(s) obrigatório(s) sem preencher (destacados em vermelho). Complete antes de enviar.`;
    faltando[0]?.focus();
    faltando[0]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  // Precisa de ao menos 3 indicações preenchidas — ponto marcado como
  // SEM LEITURA foi ensaiado e conta (João, 23/08/2026)
  const preenchidas = [...document.querySelectorAll('#tab-indicacao tbody tr')]
    .filter(tr => num(tr.querySelector('.in-indic')?.value) != null
      || !!tr.querySelector('.btn-sem-leitura.sl-on:not(.btn-sla)')).length;
  if (preenchidas < 3) {
    $('#ens-erro').textContent = 'Preencha ao menos 3 pontos de indicação antes de enviar.';
    return;
  }

  // Peso padrão obrigatório: sem peso selecionado, não dá para calibrar
  const pesosSelecionados = document.querySelectorAll('#ens-pesos input:checked').length;
  if (pesosSelecionados === 0) {
    await modalConfirmar(
      '⚖️ Nenhum peso padrão selecionado',
      'Selecione ao menos um peso padrão usado na calibração antes de enviar.\n\n' +
      'O certificado precisa registrar quais pesos rastreáveis foram utilizados nos ensaios.',
      { textoSim: 'Entendi', textoNao: 'Fechar' });
    // destaca visualmente a área de pesos
    const box = $('#ens-pesos');
    if (box) {
      box.classList.add('area-faltando');
      box.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => box.classList.remove('area-faltando'), 4000);
    }
    return;
  }

  // Sensibilidade: a carga de referência não pode ultrapassar a capacidade
  // máxima da balança (erro técnico — bloqueia o envio, não só avisa).
  if (!validarSensCapacidade()) {
    const inpRef = $('#sens-ref');
    $('#ens-erro').textContent = '⚠️ Corrija a carga de referência da sensibilidade: ela ultrapassa a capacidade máxima da balança.';
    inpRef?.focus();
    inpRef?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  // Aviso de carga reprovada (erro > EMA): pede confirmação consciente
  let reprovados = [];
  try { reprovados = pontosReprovados(); }
  catch (err) { console.error('Falha ao checar EMA (seguindo sem bloquear):', err); }
  if (reprovados.length) {
    const ok = await modalConfirmar(
      `⚠️ ${reprovados.length} ponto(s) reprovado(s)`,
      `Um ou mais pontos têm erro ACIMA do EMA (erro máximo admissível):\n\n` +
      `${reprovados.join('\n')}\n\n` +
      `Isso significa que a balança NÃO está conforme nesses pontos. O certificado ` +
      `será emitido registrando essa não-conformidade.\n\n` +
      `Deseja enviar mesmo assim para aprovação?`,
      { textoSim: 'Enviar mesmo assim', textoNao: 'Voltar e revisar', perigoso: true });
    if (!ok) return;
  }

  try {
    await salvarRascunho(true);
    const r = await api(`/certificados/${certId}/enviar`, { method: 'POST' });
    clearInterval(timerAutosave);
    toast('✅ Certificado enviado para aprovação com sucesso!', 'ok', 5000);
    $('#ens-resultado').classList.remove('oculta');
    $('#ens-resultado').innerHTML = `
      <div class="envio-sucesso">
        <div class="envio-sucesso-icone">✅</div>
        <div>
          <h3 style="margin:0">Enviado para aprovação</h3>
          <p class="dica" style="margin:2px 0 0">Agora aguarda a análise do responsável técnico ou administrador.</p>
        </div>
      </div>
      <p class="dica" style="margin-top:14px">Resultado calculado pelo servidor (com incerteza, k=2):</p>
      <table><thead><tr><th>Carga</th><th>Indicação</th><th>Erro</th>
        <th>Incerteza</th><th>EMA</th><th>Status</th></tr></thead>
      <tbody>${(() => { window._casasU = casasTabelaU(
          r.indicacao.map(p => p.incerteza), plano?.casasDecimais ?? 3); return ''; })()}
        ${r.indicacao.map(p => `
        <tr><td class="num">${fmtU(p.carga_aplicada, window._casasU)}</td>
            <td class="num">${fmtU(p.indicacao, window._casasU)}</td>
            <td class="num">${(p.erro > 0 ? '+' : '') + fmtU(p.erro, window._casasU)}</td>
            <td class="num">${fmtUInc(p.incerteza, window._casasU)}</td>
            <td class="num">${fmtU(p.ema, window._casasU)}</td>
            <td>${p.aprovado == null ? '—' : p.aprovado
              ? '<span class="badge ok">OK</span>'
              : '<span class="badge rep">&gt; EMA</span>'}</td></tr>`).join('')}
      </tbody></table>
      <br><button class="btn-primario" onclick="imprimirEtiqueta('${certId}')">🏷️ Imprimir etiqueta agora</button>
      <button class="btn-mini" style="margin-left:8px" onclick="irPainel()">Voltar ao painel</button>`;
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
  const ehReset = location.hash.startsWith('#reset=');
  const tok = location.hash.replace(ehReset ? '#reset=' : '#convite=', '').trim();
  try {
    const r = await fetch(ehReset ? '/api/auth/redefinir-senha' : '/api/auth/definir-senha', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: tok, novaSenha: s1 }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || 'Erro ao definir a senha.');
    history.replaceState(null, '', location.pathname);
    toast(ehReset ? 'Senha redefinida com sucesso! Agora faça login.'
                  : 'Senha definida com sucesso! Agora faça login.', 'ok', 6000);
    mostrar('tela-login');
  } catch (e) { err.textContent = e.message; }
}

// Lê um claim do JWT atual (sem validar assinatura — só para UI)
function claimDoToken(nome) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload[nome];
  } catch { return undefined; }
}

// ── Boot ────────────────────────────────────────────────────────
if (location.hash.startsWith('#convite=')) mostrar('tela-convite');
else if (location.hash.startsWith('#reset=')) {
  $('#conv-titulo').textContent = '🔑 Redefinir senha';
  $('#conv-dica').textContent = 'Escolha uma nova senha para voltar a acessar o sistema.';
  mostrar('tela-convite');
}
else if (token && usuario) {
  // O banner só aparece se o TOKEN atual for de fato de visualização
  // (claim impersonando=true). Não confia apenas no flag do localStorage,
  // para não vazar o banner para um login normal posterior.
  if (claimDoToken('impersonando') === 'true') {
    const nome = claimDoToken('empresa_nome') || usuario._empresaVis || 'empresa';
    localStorage.setItem('_visualizando', '1');
    mostrarBannerVisualizacao(nome, claimDoToken('papel'));
  } else {
    // Não é visualização: limpa qualquer resíduo
    localStorage.removeItem('_visualizando');
    document.getElementById('banner-visualizacao')?.remove();
    document.body.classList.remove('com-banner-vis');
  }
  irPainel();
} else mostrar('tela-login');
$('#login-senha').addEventListener('keydown', e => { if (e.key === 'Enter') fazerLogin(); });

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
    // Modais fixos (têm id e usam .oculta) — fecham primeiro, sem remover do DOM
    for (const id of ['modal-assinatura', 'modal-ajuda']) {
      const m = document.getElementById(id);
      if (m && !m.classList.contains('oculta')) { m.classList.add('oculta'); return true; }
    }
    // Modais dinâmicos (.modal-fundo SEM id) — criados via insertAdjacentHTML
    const fundos = [...document.querySelectorAll('.modal-fundo')].filter(el => !el.id);
    if (fundos.length) { fundos[fundos.length - 1].remove(); return true; }
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
  // exposta para outras partes realinharem a pilha (ex.: ao entrar no painel)
  window._reporSentinela = () => reporSentinela();
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
    <label>Tipo de certificado
      <select id="lc-tipo" style="width:100%">
        <option value="todos">Todos (padrão + RBC)</option>
        <option value="padrao">Somente PADRÃO (conformidade)</option>
        <option value="rbc">Somente RBC (acreditado)</option>
      </select>
    </label>
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
      method: 'POST', body: JSON.stringify({ pin, tipo: document.getElementById('lc-tipo')?.value || 'todos' })
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

// ═══════ Editar usuário (super-admin) ═══════
function abrirEditarUsuarioSA(id, nome, email, papel, registro) {
  const div = document.createElement('div');
  div.className = 'modal-fundo';
  div.setAttribute('onclick', 'if(event.target===this)this.remove()');
  const opt = (v, r) => `<option value="${v}" ${papel === v ? 'selected' : ''}>${r}</option>`;
  div.innerHTML = `<div class="modal-caixa" style="max-width:460px">
    <h3>✏️ Editar usuário</h3>
    <label>Nome <input type="text" id="eu-nome" value="${esc(nome || '')}" style="width:100%"></label>
    <label>E-mail <input type="email" id="eu-email" value="${esc(email || '')}" style="width:100%"></label>
    <label>Papel
      <select id="eu-papel" style="width:100%">
        ${opt('admin', 'Administrador')}
        ${opt('responsavel_tecnico', 'Responsável Técnico')}
        ${opt('tecnico', 'Técnico')}
      </select></label>
    <label>Registro profissional <input type="text" id="eu-registro" value="${esc(registro || '')}" style="width:100%"></label>
    <p class="dica">A senha não é alterada aqui — o usuário pode redefini-la pelo "Esqueci minha senha".</p>
    <p id="eu-erro" class="erro"></p>
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn-primario" onclick="salvarUsuarioSA('${id}')">Salvar</button>
      <button onclick="this.closest('.modal-fundo').remove()">Cancelar</button>
    </div>
  </div>`;
  document.body.appendChild(div);
}

async function salvarUsuarioSA(id) {
  const erro = document.getElementById('eu-erro');
  const corpo = {
    nome: document.getElementById('eu-nome')?.value || null,
    email: document.getElementById('eu-email')?.value || null,
    papel: document.getElementById('eu-papel')?.value || null,
    registro: document.getElementById('eu-registro')?.value || null
  };
  try {
    await saApi('/usuarios/' + id, { method: 'PUT', body: JSON.stringify(corpo) });
    document.querySelector('.modal-fundo')?.remove();
    toast('Usuário atualizado.', 'ok');
    if (window._saEmpresaId) abrirEmpresaSA(window._saEmpresaId);
  } catch (e) { if (erro) erro.textContent = e.message; }
}

// ═══════ Aviso de calibração recente (últimos 30 dias) ═══════
// Retorna true para seguir, false para cancelar.
async function avisoCalibracaoRecente(balancaId) {
  let d;
  try { d = await api('/balancas/' + balancaId + '/ultima-calibracao', { opcional: true }); }
  catch (e) { return true; }   // sem informação: segue normalmente
  if (!d || !d.temRecente) return true;

  const dt = d.dataCalibracao ? new Date(d.dataCalibracao).toLocaleDateString('pt-BR') : '—';
  const dias = d.dias === 0 ? 'HOJE' : d.dias === 1 ? 'ONTEM' : `há ${d.dias} dias`;
  return await new Promise(resolve => {
    const div = document.createElement('div');
    div.className = 'modal-fundo';
    div.innerHTML = `
      <div class="modal-caixa" style="max-width:520px;border-top:6px solid #d97706">
        <div style="text-align:center;margin-bottom:6px">
          <div style="font-size:46px;line-height:1">\u26A0\uFE0F</div>
          <h2 style="color:#b45309;margin:4px 0 2px">Esta balança já foi calibrada!</h2>
        </div>
        <div style="background:#fff7ed;border:2px solid #fdba74;border-radius:10px;padding:14px;margin:12px 0;text-align:center">
          <div style="font-size:15px;color:#7c2d12">Última calibração em</div>
          <div style="font-size:26px;font-weight:800;color:#b45309;margin:4px 0">${dt}</div>
          <div style="font-size:17px;font-weight:700;color:#c2410c">(${dias})</div>
          ${d.numero ? `<div style="margin-top:8px;font-size:13px;color:#7c2d12">Certificado <b>${esc(d.numero)}</b></div>` : ''}
        </div>
        <p class="dica" style="text-align:center;font-size:13px">
          Confirme se realmente é necessário calibrar novamente. Uma nova calibração
          gera um novo certificado e um novo número.</p>
        <div style="display:flex;gap:10px;margin-top:14px">
          <button style="flex:1;padding:12px;font-size:15px" id="av-nao">\u2715 Cancelar</button>
          <button class="btn-primario" style="flex:1;padding:12px;font-size:15px;background:#d97706" id="av-sim">
            Continuar mesmo assim \u2192</button>
        </div>
      </div>`;
    document.body.appendChild(div);
    div.querySelector('#av-sim').onclick = () => { div.remove(); resolve(true); };
    div.querySelector('#av-nao').onclick = () => { div.remove(); resolve(false); };
  });
}

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

// Verifica se ja ha um ensaio em andamento (rascunho) para esta balanca.
// Retorna TRUE quando o fluxo deve PARAR (abriu o rascunho ou o usuario cancelou).
async function avisoRascunhoAberto(balancaId) {
  let d;
  try { d = await api('/balancas/' + balancaId + '/rascunho-aberto', { opcional: true }); }
  catch (e) { return false; }   // sem informacao: segue o fluxo normal
  if (!d || !d.temRascunho) return false;

  const dt = d.criadoEm ? new Date(d.criadoEm).toLocaleDateString('pt-BR') : '';
  const hr = d.criadoEm ? new Date(d.criadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
  const meu = usuario && d.tecnicoId === usuario.id;

  const continuar = await new Promise(resolve => {
    const div = document.createElement('div');
    div.className = 'modal-fundo';
    div.innerHTML = `
      <div class="modal-caixa" style="max-width:500px;border-top:6px solid #d97706">
        <div style="text-align:center;margin-bottom:6px">
          <div style="font-size:44px;line-height:1">⚠️</div>
          <h2 style="color:#b45309;margin:4px 0 2px">Já existe um ensaio em andamento</h2>
        </div>
        <div style="background:#fff7ed;border:2px solid #fdba74;border-radius:10px;padding:14px;margin:12px 0;text-align:center">
          <div style="font-size:14px;color:#7c2d12">Esta balança tem um rascunho iniciado por</div>
          <div style="font-size:20px;font-weight:800;color:#b45309;margin:4px 0">
            ${meu ? 'você' : esc(d.tecnico || 'outro técnico')}</div>
          ${dt ? `<div style="font-size:14px;color:#7c2d12">em ${dt} às ${hr}</div>` : ''}
          ${d.emitirRbc ? '<div style="margin-top:6px"><span style="background:#0a5c40;color:#fff;font-size:10px;padding:2px 8px;border-radius:8px;font-weight:700">RBC</span></div>' : ''}
        </div>
        <p class="dica" style="text-align:center;font-size:13px">
          ${meu ? 'Continue de onde parou.'
                : 'Ao continuar, você assume este ensaio e fica como responsável pelo certificado.'}</p>
        <div style="display:flex;gap:10px;margin-top:14px">
          <button style="flex:1;padding:12px;font-size:15px" id="ra-nao">Cancelar</button>
          <button class="btn-primario" style="flex:1;padding:12px;font-size:15px;background:#d97706" id="ra-sim">
            Continuar →</button>
        </div>
      </div>`;
    document.body.appendChild(div);
    div.querySelector('#ra-sim').onclick = () => { div.remove(); resolve(true); };
    div.querySelector('#ra-nao').onclick = () => { div.remove(); resolve(false); };
  });

  if (continuar) {
    // abre o rascunho existente (o abrirCert ja trata assumir de outro tecnico)
    try { await abrirCert(d.id, 'rascunho'); }
    catch (e) { toast('Nao foi possivel abrir o ensaio: ' + e.message, 'erro'); }
  }
  return true;   // em ambos os casos o fluxo da nova calibracao para aqui
}

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
            ${c.recebe_certificado ? ' <span style="background:#e7f0f8;color:#164066;border-radius:99px;padding:1px 8px;font-size:10.5px">📧 recebe certificados</span>' : ''}
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
    <label class="chk" style="margin-top:6px"><input type="checkbox" id="ct-recebe" ${c?.recebe_certificado ? 'checked' : ''}>
      📧 Recebe certificados <span class="dica">(entra nos envios automáticos da emissão)</span></label>
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
    recebeCertificado: document.getElementById('ct-recebe')?.checked || false,
    observacao: document.getElementById('ct-obs')?.value || null
  };
  if (!corpo.nome.trim()) { if (erro) erro.textContent = 'Informe o nome.'; return; }
  const ctErro = erroEmail(corpo.email);
  if (ctErro) { if (erro) erro.textContent = ctErro; return; }
  if (corpo.recebeCertificado && !corpo.email) {
    if (erro) erro.textContent = 'Contato marcado para receber certificados precisa de e-mail.';
    return;
  }
  corpo.email = limparEmail(corpo.email);
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


// ── Exportação de dados da empresa (backup/offboarding) ─────────
async function solicitarExportacao() {
  const ok = await modalConfirmar('Exportar dados da empresa',
    'Gerar um arquivo .zip com todos os dados e certificados da empresa? O processamento leva alguns minutos.',
    { textoSim: 'Gerar', textoNao: 'Cancelar' });
  if (!ok) return;
  try {
    await api('/empresa/exportar', { method: 'POST' });
    toast('Exportação iniciada — atualize a lista em alguns minutos', 'ok');
  } catch (e) { toast(e.message, 'erro'); }
  carregarExportacoes();
}

async function carregarExportacoes() {
  const alvo = document.getElementById('cf-exports');
  if (!alvo) return;
  try {
    const lista = await api('/empresa/exportacoes');
    if (!lista.length) {
      alvo.innerHTML = '<p class="dica">Nenhuma exportação gerada ainda.</p>';
      return;
    }
    const dt = v => v ? new Date(v).toLocaleString('pt-BR') : '—';
    alvo.innerHTML = lista.map(e => {
      const mb = e.tamanho_bytes ? (e.tamanho_bytes / 1048576).toFixed(1) + ' MB' : '';
      const st = e.status === 'pronto' ? '✅ Pronta'
        : (e.status === 'gerando' || e.status === 'pendente') ? '⏳ Gerando…'
        : e.status === 'expirado' ? 'Expirada' : '❌ Erro';
      const acao = e.status === 'pronto'
        ? `<button class="btn-mini btn-primario" onclick="baixarExportacao('${e.id}')">⬇️ Baixar</button>
           <span class="dica">expira em ${dt(e.expira_em)}</span>`
        : (e.erro ? `<span class="dica" style="color:#b02a37">${esc(e.erro)}</span>` : '');
      return `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:6px 0;border-top:1px solid #eef2f6">
        <span>${st}</span><span class="dica">${dt(e.criado_em)}</span><span class="dica">${mb}</span>${acao}</div>`;
    }).join('');
  } catch (e) {
    alvo.innerHTML = `<p class="dica" style="color:#b02a37">${esc(e.message)}</p>`;
  }
}

async function baixarExportacao(id) {
  try {
    toast('Preparando download…', 'ok');
    const r = await fetch('/api/empresa/exportacao/' + id + '/download',
      { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) { toast('Arquivo indisponível', 'erro'); return; }
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'backup-empresa-' + new Date().toISOString().slice(0, 10) + '.zip';
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) { toast('Falha no download — verifique a conexão', 'erro'); }
}


// ── Entradas do mês por empresa (financeiro SA) ─────────────────
let finEntradasMes = 0;
async function carregarEntradasMes() {
  const alvo = document.getElementById('fin-entradas');
  if (!alvo) return;
  const pad = n => String(n).padStart(2, '0');
  const base = new Date();
  const m = new Date(base.getFullYear(), base.getMonth() + finEntradasMes, 1);
  const ano = m.getFullYear(), mes = m.getMonth() + 1;
  const ultimoDia = new Date(ano, mes, 0).getDate();
  const de = ano + '-' + pad(mes) + '-01';
  const ate = ano + '-' + pad(mes) + '-' + pad(ultimoDia);
  const span = document.getElementById('fin-entradas-mes');
  if (span) span.textContent = m.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  alvo.innerHTML = '<p class="dica">Carregando…</p>';
  try {
    const lista = await saApi('/relatorio-financeiro?de=' + de + '&ate=' + ate + '&status=pago');
    const doMes = (lista || []).filter(c => c.pago_em &&
      String(c.pago_em).slice(0, 7) === de.slice(0, 7));
    if (!doMes.length) {
      alvo.innerHTML = '<p class="dica">Nenhuma entrada neste mês.</p>';
      return;
    }
    doMes.sort((a, b) => Number(b.valor) - Number(a.valor));
    const total = doMes.reduce((t, c) => t + Number(c.valor), 0);
    alvo.innerHTML = `<div class="tabela-scroll"><table>
      <thead><tr><th>Empresa</th><th>Contrato</th><th class="num">Valor</th><th>Pago em</th></tr></thead>
      <tbody>${doMes.map(c => `<tr>
        <td><b>${esc(c.empresa)}</b></td>
        <td class="dica">${esc(c.contrato || '—')}</td>
        <td class="num"><b>${brl(c.valor)}</b></td>
        <td>${dbrSA(c.pago_em)}</td></tr>`).join('')}
      <tr style="border-top:2px solid #dde5ec"><td colspan="2"><b>Total do mês</b></td>
        <td class="num"><b>${brl(total)}</b></td><td></td></tr></tbody>
    </table></div>`;
  } catch (e) { alvo.innerHTML = `<p class="erro">${esc(e.message)}</p>`; }
}


// ── Monitor de uso por empresa/periodo (tela Atividade) ─────────
function usoPeriodoPadrao() {
  const pad = n => String(n).padStart(2, '0');
  const h = new Date();
  const de = new Date(h.getFullYear(), h.getMonth() - 2, 1);   // ultimos ~3 meses
  const el = id => document.getElementById(id);
  if (el('uso-de') && !el('uso-de').value)
    el('uso-de').value = de.getFullYear() + '-' + pad(de.getMonth() + 1) + '-01';
  if (el('uso-ate') && !el('uso-ate').value)
    el('uso-ate').value = h.getFullYear() + '-' + pad(h.getMonth() + 1) + '-' + pad(h.getDate());
}

function usoGrupoAuto(de, ate) {
  const dias = Math.floor((new Date(ate) - new Date(de)) / 86400000) + 1;
  return dias <= 31 ? 'dia' : dias <= 190 ? 'semana' : 'mes';
}

async function carregarUsoPeriodo() {
  const alvoG = document.getElementById('uso-grafico');
  const alvoT = document.getElementById('uso-tabela');
  if (!alvoG) return;
  const de = document.getElementById('uso-de').value;
  const ate = document.getElementById('uso-ate').value;
  const emp = document.getElementById('uso-emp').value;
  if (!de || !ate) return;
  const grupo = document.getElementById('uso-grupo').value || usoGrupoAuto(de, ate);
  alvoG.innerHTML = '<p class="dica">Carregando…</p>';
  try {
    const qs = e2 => '?de=' + e2.de + '&ate=' + e2.ate + '&grupo=' + grupo
      + (emp ? '&empresaId=' + emp : '');
    // periodo anterior de mesmo tamanho, para o comparativo
    const dias = Math.floor((new Date(ate) - new Date(de)) / 86400000) + 1;
    const deAnt = new Date(new Date(de) - dias * 86400000).toISOString().slice(0, 10);
    const ateAnt = new Date(new Date(de) - 86400000).toISOString().slice(0, 10);
    const [serie, serieAnt] = await Promise.all([
      saApi('/uso-periodo' + qs({ de, ate })),
      saApi('/uso-periodo' + qs({ de: deAnt, ate: ateAnt })).catch(() => [])]);

    const totalAtual = serie.reduce((t, r) => t + Number(r.qtd), 0);
    const totalAnt = (serieAnt || []).reduce((t, r) => t + Number(r.qtd), 0);
    const delta = document.getElementById('uso-delta');
    if (delta) {
      if (totalAnt > 0) {
        const pct = Math.round(100 * (totalAtual - totalAnt) / totalAnt);
        delta.innerHTML = `<b>${totalAtual}</b> emissões · ${pct >= 0 ? '📈 +' : '📉 '}${pct}% vs período anterior (${totalAnt})`;
        delta.style.color = pct >= 0 ? '#146c43' : '#b02a37';
      } else delta.innerHTML = `<b>${totalAtual}</b> emissões no período`;
    }

    if (!serie.length) {
      alvoG.innerHTML = '<p class="dica">Nenhuma emissão no período.</p>';
      alvoT.innerHTML = '';
      return;
    }

    // Grafico: total por periodo (todas somadas, ou so a escolhida)
    const porPeriodo = {};
    serie.forEach(r => { const k = String(r.periodo).slice(0, 10);
      porPeriodo[k] = (porPeriodo[k] || 0) + Number(r.qtd); });
    const chaves = Object.keys(porPeriodo).sort();
    const maxV = Math.max(...chaves.map(k => porPeriodo[k]), 1);
    const rotulo = k => grupo === 'mes' ? k.slice(5, 7) + '/' + k.slice(2, 4)
      : k.slice(8, 10) + '/' + k.slice(5, 7);
    alvoG.innerHTML = '<div style="display:flex;align-items:flex-end;gap:4px;height:132px;padding:6px 0;overflow-x:auto">'
      + chaves.map(k => {
        const h2 = Math.round((porPeriodo[k] / maxV) * 88) + 3;
        return `<div style="display:flex;flex-direction:column;align-items:center;gap:3px;min-width:34px;flex:1">
          <div style="font-size:10px;color:#667">${porPeriodo[k]}</div>
          <div style="width:70%;height:${h2}px;background:#164066;border-radius:3px 3px 0 0"></div>
          <div style="font-size:9.5px;color:#667;white-space:nowrap">${rotulo(k)}</div></div>`;
      }).join('') + '</div>';

    // Tabela por empresa (so quando "todas"): total, media/semana, ultimo
    if (!emp) {
      const porEmp = {};
      serie.forEach(r => {
        const k = r.empresa_id;
        porEmp[k] = porEmp[k] || { nome: r.empresa, id: k, total: 0, ultimo: null };
        porEmp[k].total += Number(r.qtd);
        const p2 = String(r.periodo).slice(0, 10);
        if (!porEmp[k].ultimo || p2 > porEmp[k].ultimo) porEmp[k].ultimo = p2;
      });
      const semanas = Math.max(1, dias / 7);
      const linhas2 = Object.values(porEmp).sort((a, b) => b.total - a.total)
        .map(e3 => `<tr onclick="abrirEmpresaSA('${e3.id}')" style="cursor:pointer">
          <td><b>${esc(e3.nome)}</b></td>
          <td class="num">${e3.total}</td>
          <td class="num">${(e3.total / semanas).toFixed(1).replace('.', ',')}</td>
          <td>${e3.ultimo ? e3.ultimo.split('-').reverse().join('/') : '—'}</td></tr>`).join('');
      alvoT.innerHTML = `<div class="tabela-scroll" style="margin-top:8px"><table style="width:100%">
        <thead><tr><th>Empresa</th><th class="num" style="width:110px">Emitidos</th>
          <th class="num" style="width:130px">Média/semana</th>
          <th style="width:150px">Última no período</th></tr></thead>
        <tbody>${linhas2}</tbody></table></div>`;
    } else alvoT.innerHTML = '';
  } catch (e) {
    alvoG.innerHTML = `<p class="erro">${esc(e.message)}</p>`;
  }
}


// ── Mapa do Brasil: onde o TSCert esta instalado ────────────────
// Estados com empresa em verde, pin por cidade com a contagem.
// Cidade vem do cadastro (empresa.cidade_uf, texto livre "Cidade/UF").
const MAPA_CIDADES = {
  'contagem': [-19.93, -44.05], 'belo horizonte': [-19.92, -43.94],
  'itabuna': [-14.79, -39.28], 'passo fundo': [-28.26, -52.41],
  'rio grande': [-32.03, -52.10], 'maracaju': [-21.61, -55.17],
  'rio verde': [-17.79, -50.92], 'fortaleza': [-3.73, -38.52],
  'jaboatao dos guararapes': [-8.11, -35.02], 'sao paulo': [-23.55, -46.63],
  'goiania': [-16.69, -49.26], 'curitiba': [-25.43, -49.27],
  'porto alegre': [-30.03, -51.23], 'salvador': [-12.97, -38.50],
  'recife': [-8.05, -34.90], 'campo grande': [-20.47, -54.62],
  'cuiaba': [-15.60, -56.10], 'brasilia': [-15.79, -47.88],
  'rio de janeiro': [-22.91, -43.17], 'vitoria': [-20.32, -40.34],
  'manaus': [-3.12, -60.02], 'belem': [-1.46, -48.49],
  'sao luis': [-2.53, -44.30], 'teresina': [-5.09, -42.80],
  'natal': [-5.79, -35.21], 'joao pessoa': [-7.12, -34.86],
  'maceio': [-9.67, -35.74], 'aracaju': [-10.91, -37.07],
  'florianopolis': [-27.60, -48.55], 'palmas': [-10.24, -48.36],
  'porto velho': [-8.76, -63.90], 'rio branco': [-9.97, -67.81],
  'boa vista': [2.82, -60.67], 'macapa': [0.03, -51.07]
};

function mapaNorm(t) {
  return String(t || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').trim();
}

async function renderMapaSA() {
  $('#sa-conteudo').innerHTML = '<p class="dica">Carregando o mapa…</p>';
  let empresas = window._saEmpresas;
  if (!empresas || !empresas.length) {
    try { empresas = await saApi('/empresas'); }
    catch (e) { $('#sa-conteudo').innerHTML =
      '<p class="erro">Abra o painel de empresas antes do mapa.</p>'; return; }
  }
  let geo;
  try { geo = await (await fetch('/br-uf.json')).json(); }
  catch (e) { $('#sa-conteudo').innerHTML =
    `<p class="erro">Falha ao carregar o mapa: ${esc(e.message)}</p>`; return; }

  const W = 640, H = 620;
  const LON0 = -74.1, LON1 = -34.6, LAT0 = 5.4, LAT1 = -33.9;
  const px = lon => (lon - LON0) / (LON1 - LON0) * W;
  const py = lat => (LAT0 - lat) / (LAT0 - LAT1) * H;

  // Empresas por local (ignora a SISTEMA)
  const uteis = empresas.filter(e2 => e2.razao_social !== 'SISTEMA');
  const porLocal = {}; const semLocal = []; const ufsComEmpresa = new Set();
  uteis.forEach(e2 => {
    const bruto = mapaNorm(e2.cidade_uf);
    const cidade = bruto.split('/')[0].trim();
    const uf = (bruto.split('/')[1] || '').trim().toUpperCase();
    const coord = MAPA_CIDADES[cidade];
    if (!coord) { semLocal.push(e2); return; }
    if (uf) ufsComEmpresa.add(uf);
    const k = cidade;
    porLocal[k] = porLocal[k] || { cidade, uf, coord, empresas: [] };
    porLocal[k].empresas.push(e2);
  });

  // UF de cada pin sem UF explicita: descobre pelo ponto dentro do estado
  function dentroDe(poly, x, y) {
    let dentro = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi))
        dentro = !dentro;
    }
    return dentro;
  }
  Object.values(porLocal).forEach(l => {
    if (l.uf) return;
    const x = l.coord[1], y = l.coord[0];
    for (const f of geo.features) {
      const polys = f.geometry.type === 'Polygon'
        ? [f.geometry.coordinates] : f.geometry.coordinates;
      if (polys.some(p2 => dentroDe(p2[0], x, y))) {
        l.uf = f.properties.uf; ufsComEmpresa.add(l.uf); break;
      }
    }
  });

  // SVG dos estados
  const anel2d = a => 'M' + a.map(c =>
    px(c[0]).toFixed(1) + ' ' + py(c[1]).toFixed(1)).join('L') + 'Z';
  const pathUF = g2 => (g2.type === 'Polygon' ? [g2.coordinates] : g2.coordinates)
    .map(p2 => p2.map(anel2d).join('')).join('');
  const estados = geo.features.map(f => {
    const tem = ufsComEmpresa.has(f.properties.uf);
    return `<path d="${pathUF(f.geometry)}"
      fill="${tem ? '#cfe5d6' : '#eef1f4'}"
      stroke="${tem ? '#5a8a68' : '#c6ced6'}" stroke-width="0.8">
      <title>${f.properties.nome}</title></path>`;
  }).join('');

  // Pins
  const pins = Object.values(porLocal).map(l => {
    const n = l.empresas.length;
    const r = n >= 3 ? 12 : n === 2 ? 10 : 8;
    const cx = px(l.coord[1]).toFixed(1), cy = py(l.coord[0]).toFixed(1);
    const nomes = l.empresas.map(e3 => e3.razao_social).join(', ');
    return `<g style="cursor:pointer" onclick="abrirEmpresaSA('${l.empresas[0].id}')">
      <title>${esc(l.cidade.toUpperCase())}${l.uf ? '/' + l.uf : ''} — ${esc(nomes)}</title>
      <circle cx="${cx}" cy="${cy}" r="${r + 4}" fill="#164066" opacity="0.18"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="#164066" stroke="#fff" stroke-width="1.6"/>
      <text x="${cx}" y="${Number(cy) + 3.5}" text-anchor="middle"
        style="fill:#fff;font-size:10.5px;font-weight:600">${n}</text></g>`;
  }).join('');

  // Lista por estado
  const porUf = {};
  Object.values(porLocal).forEach(l => {
    const k = l.uf || '??';
    porUf[k] = porUf[k] || [];
    l.empresas.forEach(e3 => porUf[k].push({ e: e3, cidade: l.cidade }));
  });
  const listaUf = Object.keys(porUf).sort().map(uf => `
    <div style="margin-bottom:8px"><b>${uf}</b> — ${porUf[uf].map(x =>
      `<span class="dica">${esc(x.e.razao_social)} (${esc(x.cidade)})</span>`).join(' · ')}</div>`).join('');

  $('#sa-conteudo').innerHTML = `
    <div class="barra">
      <h2>🗺️ Onde o TSCert está instalado</h2>
      <div class="barra-btns"><button onclick="renderPainelSA()">← Empresas</button></div>
    </div>
    <p class="dica" style="margin-bottom:10px">
      ${uteis.length - semLocal.length} empresa(s) no mapa · ${ufsComEmpresa.size} estado(s) ·
      posição vem do campo Cidade/UF do cadastro. Clique no pin para abrir a empresa.</p>
    <div class="card" style="margin-bottom:12px;text-align:center">
      <svg viewBox="0 0 ${W} ${H}" style="max-width:640px;width:100%">${estados}${pins}</svg>
    </div>
    <div class="card">
      <h3 style="margin-top:0">Por estado</h3>
      ${listaUf || '<p class="dica">Nenhuma empresa localizada.</p>'}
      ${semLocal.length ? `<p class="dica" style="margin-top:10px;color:#856404">
        ⚠️ Sem localização (preencha Cidade/UF no cadastro):
        ${semLocal.map(e3 => esc(e3.razao_social)).join(' · ')}</p>` : ''}
    </div>`;
}


// ── Ponto SEM LEITURA no ensaio de indicação (João, 22/08/2026) ──
// A balança não mostrou indicação na carga: o campo trava, o ponto vai
// reprovado (Não conforme) e o certificado sai não conforme no geral.
function toggleSemLeitura(btn) {
  const wrap = btn.closest('.ind-wrap');
  const inp = wrap?.querySelector('.in-indic');
  if (!inp) return;
  const ligar = !btn.classList.contains('sl-on');
  btn.classList.toggle('sl-on', ligar);
  if (ligar) {
    inp.value = '';
    inp.disabled = true;
    inp.placeholder = 'sem leitura';
    inp.style.cssText = 'background:#fdecee;border-color:#b02a37;color:#b02a37;font-style:italic';
    btn.style.cssText = 'background:#b02a37;color:#fff;border-color:#b02a37';
    toast('Ponto marcado como SEM LEITURA — será reprovado no certificado', 'erro', 5000);
  } else {
    inp.disabled = false;
    inp.placeholder = '';
    inp.style.cssText = '';
    btn.style.cssText = '';
  }
  sujo = true;
  try { recalcular(); } catch (e) {}
}


// Sem leitura ANTES do ajuste: não reprova — a conformidade é avaliada
// sobre a leitura final (João, 23/08/2026).
function toggleSemLeituraAntes(btn) {
  const inp = btn.closest('.ind-wrap')?.querySelector('.in-antes');
  if (!inp) return;
  const ligar = !btn.classList.contains('sl-on');
  btn.classList.toggle('sl-on', ligar);
  if (ligar) {
    inp.value = '';
    inp.disabled = true;
    inp.placeholder = 'sem leitura';
    inp.style.cssText = 'background:#fdecee;border-color:#b02a37;color:#b02a37;font-style:italic';
    btn.style.cssText = 'background:#b02a37;color:#fff;border-color:#b02a37';
  } else {
    inp.disabled = false;
    inp.placeholder = '';
    inp.style.cssText = '';
    btn.style.cssText = '';
  }
  sujo = true;
  try { recalcular(); } catch (e) {}
}


// ── Toque longo = sem leitura (celular) — João, 23/08/2026 ──────
// Segurar ~0,6s no campo de indicação (ou no "antes") marca/desmarca o
// ponto como sem leitura. No desktop os botões ∅ continuam visíveis.
(function () {
  let slTimer = null, slX = 0, slY = 0;
  function cancelarSl() { if (slTimer) { clearTimeout(slTimer); slTimer = null; } }
  document.addEventListener('pointerdown', ev => {
    const wrap = ev.target.closest('#tab-indicacao .ind-wrap');
    if (!wrap) return;
    slX = ev.clientX; slY = ev.clientY;
    cancelarSl();
    slTimer = setTimeout(() => {
      slTimer = null;
      const btn = wrap.querySelector('.btn-sem-leitura');
      if (btn) { btn.click(); if (navigator.vibrate) navigator.vibrate(30); }
    }, 600);
  }, { passive: true });
  document.addEventListener('pointermove', ev => {
    if (slTimer && (Math.abs(ev.clientX - slX) > 12 || Math.abs(ev.clientY - slY) > 12))
      cancelarSl();
  }, { passive: true });
  document.addEventListener('pointerup', cancelarSl, { passive: true });
  document.addEventListener('pointercancel', cancelarSl, { passive: true });
})();
