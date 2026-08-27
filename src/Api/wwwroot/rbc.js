// ════════════════════════════════════════════════════════════════
// COLETA RBC (acreditada ISO/IEC 17025) — arquivo isolado
// Usa funções globais do app.js: $, api, toast, fmtU, unid, mostrar,
// eDaFaixa, casasExibicao, fmtCampo, arredondarCampo, plano, certId.
// Não modifica nada do fluxo Portaria 157.
// ════════════════════════════════════════════════════════════════

// Estado da coleta RBC
window._rbc = {
  numLeituras: 3,      // N (3 ou 5)
  numPosExc: 5,        // posições da excentricidade (mín 4)
  pontos: [],          // cargas: [{carga, leituras:[], pesos:[], orcamento}]
  exc: [],             // excentricidade: [{ordem, nome, leituras:[]}]
  mob: { cargaRef:'', divisao:'', esperado:'', leituras:[] },
  pesosDisponiveis: [] // pontos de peso cadastrados (peso_ponto_rbc)
};

// Ponto de entrada (chamado pela bifurcação no iniciarEnsaio)
async function montarTelaEnsaioRbc() {
  const R = window._rbc;
  // config: N leituras e posições
  try {
    const cfg = await api('/empresa/config');
    R.numLeituras = Number(cfg.rbc_num_leituras) || 3;
    R.numPosExc = Number(cfg.rbc_num_posicoes_exc) || 5;
  } catch (e) { R.numLeituras = 3; R.numPosExc = 5; }

  // carrega os pontos de peso disponíveis (para a composição)
  try {
    R.pesosDisponiveis = await api('/pesos/pontos-rbc-todos') || [];
  } catch (e) { R.pesosDisponiveis = []; }

  // cargas sugeridas do plano (plano.indicacao é o array direto de cargas)
  let cargas = Array.isArray(plano?.indicacao) ? plano.indicacao
             : (plano?.indicacao?.cargas || plano?.cargas || []);
  if (!cargas.length) cargas = ['', '', '', '', ''];  // 5 pontos em branco
  R.pontos = cargas.map(c => ({
    carga: (c === '' || c == null) ? '' :
      fmtCampo(c, (plano?.faixas?.length ? eDaFaixa(Number(c)) : null)) || c,
    leituras: Array(R.numLeituras).fill(''), pesos: [], orcamento: null
  }));

  // excentricidade: posições numéricas (1, 2, 3, 4, 5...) — a posição 1 é o centro
  R.exc = Array.from({length: R.numPosExc}, (_, i) => ({
    ordem: i+1, nome: String(i+1),
    leituras: Array(R.numLeituras).fill('')
  }));

  // mobilidade
  R.mob = { cargaRef:'', divisao: Number(plano?.balanca?.divisao_e)||'', esperado:'', leituras: Array(R.numLeituras).fill('') };

  // Reabertura: carrega a coleta salva (se houver) e vai direto ao resumo
  let temColetaSalva = false;
  try {
    const d = await api('/certificados/' + certId + '/coleta-rbc');
    if (d && d.leituras && d.leituras.length) {
      temColetaSalva = true;
      const resDe = (carga) => (plano?.faixas?.length && carga) ? eDaFaixa(Number(carga)) : null;
      // cargas + leituras
      const porPonto = {};
      for (const l of d.leituras) {
        if (!porPonto[l.ordem_ponto]) porPonto[l.ordem_ponto] = { carga: l.carga, leituras: [] };
        porPonto[l.ordem_ponto].leituras[l.ordem_leitura - 1] = fmtCampo(l.indicacao, resDe(l.carga)) || String(l.indicacao);
      }
      // pesos por ponto (a composição salva)
      const pesosPorPonto = {};
      for (const w of (d.pesos || [])) {
        (pesosPorPonto[w.ordem_ponto] = pesosPorPonto[w.ordem_ponto] || []).push({
          peso_ponto_rbc_id: w.peso_ponto_rbc_id, peso_identificacao: w.peso_identificacao,
          valor_nominal: w.valor_nominal, valor_convencional: w.valor_convencional,
          incerteza: w.incerteza, k: w.k, num_certificado: w.num_certificado });
      }
      R.pontos = Object.keys(porPonto).sort((a, b) => a - b).map(op => {
        const pt = porPonto[op];
        const leituras = Array(R.numLeituras).fill('');
        (pt.leituras || []).forEach((v, i) => { if (i < R.numLeituras && v != null) leituras[i] = v; });
        return { carga: fmtCampo(pt.carga, resDe(pt.carga)) || String(pt.carga),
                 leituras, pesos: pesosPorPonto[op] || [], orcamento: null };
      });
      // excentricidade
      if (d.excentricidade && d.excentricidade.length) {
        const porPos = {};
        for (const x of d.excentricidade) {
          if (!porPos[x.ordem_posicao]) porPos[x.ordem_posicao] = { ordem: x.ordem_posicao, nome: x.nome_posicao, leituras: [] };
          porPos[x.ordem_posicao].leituras[x.ordem_leitura - 1] = fmtCampo(x.indicacao, resDe(x.carga)) || String(x.indicacao);
        }
        R.exc = Object.values(porPos).sort((a, b) => a.ordem - b.ordem).map(pos => {
          const leituras = Array(R.numLeituras).fill('');
          (pos.leituras || []).forEach((v, i) => { if (i < R.numLeituras && v != null) leituras[i] = v; });
          return { ordem: pos.ordem, nome: String(pos.nome || pos.ordem), leituras };
        });
      }
      // mobilidade
      if (d.mobilidade && d.mobilidade.length) {
        const m0 = d.mobilidade[0];
        R.mob.cargaRef = m0.carga_referencia != null ? String(m0.carga_referencia) : '';
        R.mob.divisao = m0.divisao_e != null ? Number(m0.divisao_e) : R.mob.divisao;
        R.mob.esperado = m0.esperado != null ? String(m0.esperado) : '';
        const leituras = Array(R.numLeituras).fill('');
        d.mobilidade.forEach(x => { if (x.ordem_leitura - 1 < R.numLeituras) leituras[x.ordem_leitura - 1] = String(x.display_leu); });
        R.mob.leituras = leituras;
      }
      // orçamentos calculados (a U por ponto)
      aplicarOrcamentosRbc(d.orcamentos || []);
    }
  } catch (e) { /* sem coleta salva ainda — segue vazio */ }

  mostrar('tela-ensaio-rbc');
  const t = document.getElementById('rbc-titulo');
  if (t) t.textContent = `Coleta RBC · ${plano?.balanca?.identificacao || ''}`;
  document.querySelectorAll('.u-unid-rbc').forEach(el => el.textContent = unid());
  renderCabecalhoRbc();
  renderRbcTudo();
  // Abre no resumo quando ja ha coleta salva, ou quando veio da "edicao manual"
  const irAoResumo = temColetaSalva || window._rbcAbrirNoResumo === true;
  window._rbcAbrirNoResumo = false;   // consome o sinalizador
  iniciarWizardRbc(irAoResumo);
}

function renderRbcTudo() {
  renderRbcCarga();
  renderRbcExc();
  renderRbcMob();
}

// Cabeçalho: dados completos da balança + cliente
function renderCabecalhoRbc() {
  const b = plano?.balanca || {};
  const cab = document.getElementById('rbc-cabecalho');
  if (!cab) return;
  const u = unid();
  const item = (rot, val) => (val != null && val !== '') ? '<span class="rbc-dado"><b>' + rot + ':</b> ' + esc(String(val)) + '</span>' : '';
  cab.innerHTML =
    '<div class="rbc-cliente">👤 ' + esc(b.cliente || 'Cliente') + '</div>' +
    '<div class="rbc-dados">' +
      item('Identificação', b.identificacao) +
      item('Marca', b.marca) +
      item('Modelo', b.modelo) +
      item('Nº série', b.num_serie) +
      item('Capacidade', b.capacidade != null ? b.capacidade + ' ' + u : null) +
      item('Divisão (e)', b.divisao_e != null ? b.divisao_e + ' ' + u : null) +
      item('Divisão (d)', b.divisao_d != null ? b.divisao_d + ' ' + u : null) +
      item('Classe', b.classe_exatidao) +
      item('Inmetro', b.numero_inmetro) +
      item('Patrimônio', b.patrimonio) +
      item('Tipo', b.tipo) +
    '</div>';
}

// Busca temp/umidade/pressão via Open-Meteo (escreve nos campos do RBC)
function sugerirClimaRbc() {
  if (!navigator.geolocation) { alert('Seu navegador não permite obter a localização.'); return; }
  const btn = document.querySelector('#rbc-btn-clima');
  const original = btn ? btn.textContent : '';
  if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
  const restaurar = () => { if (btn) { btn.textContent = original; btn.disabled = false; } };
  navigator.geolocation.getCurrentPosition(async (pos) => {
    try {
      const lat = pos.coords.latitude, lon = pos.coords.longitude;
      const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat +
        '&longitude=' + lon + '&current=temperature_2m,relative_humidity_2m,surface_pressure';
      const r = await fetch(url);
      if (!r.ok) throw new Error('clima indisponível');
      const d = await r.json();
      const temp = d && d.current ? d.current.temperature_2m : null;
      const umid = d && d.current ? d.current.relative_humidity_2m : null;
      const press = d && d.current ? d.current.surface_pressure : null;
      if (temp != null) $('#rbc-temp').value = Math.round(temp*10)/10;
      if (umid != null) $('#rbc-umid').value = Math.round(umid);
      if (press != null) $('#rbc-pressao').value = Math.round(press*10)/10;
      alert('Valores sugeridos a partir do clima da região.\n\n⚠️ Confirme com os instrumentos do local.');
    } catch (e) { alert('Não foi possível obter o clima agora. Preencha manualmente.'); }
    finally { restaurar(); }
  }, function() { restaurar(); alert('Não foi possível obter sua localização. Preencha manualmente.'); },
  { timeout: 10000, enableHighAccuracy: false });
}

// ── ENSAIO 1: CARGA ──────────────────────────────────────────────
function renderRbcCarga() {
  const R = window._rbc, n = R.numLeituras;
  const thead = document.getElementById('rbc-carga-thead');
  if (thead) thead.innerHTML = `<tr>
    <th>Carga (<span class="u-unid-rbc">kg</span>)</th>
    ${Array.from({length:n},(_,i)=>`<th>L${i+1}</th>`).join('')}
    <th>Média</th><th>Pesos usados</th><th>U</th><th>📋</th><th></th></tr>`;

  const tbody = document.getElementById('rbc-carga-tbody');
  if (!tbody) return;
  tbody.innerHTML = R.pontos.map((p, i) => {
    const media = mediaRbc(p.leituras);
    const u = p.orcamento ? '± ' + fmtU(p.orcamento.u_expandida) : '—';
    const nPesos = (p.pesos || []).length;
    const dv = divergenciaPesos(p);
    const alerta = dv && dv.grave
      ? `<br><span style="color:#b02a37;font-size:10px">⚠ pesos somam ${fmtLivre(dv.soma)} ${unid()} (carga ${fmtLivre(dv.carga)})</span>` : '';
    const rotPesos = (nPesos === 0 ? '<span class="dica">sem pesos</span>'
      : (p.pesos.map(w => `<span class="rbc-pill">${esc(w.peso_identificacao||'?')}·${esc(w.valor_nominal||'')}</span>`).join('') )) + alerta;
    return `<tr data-carga="${p.carga}">
      <td><input type="number" step="any" inputmode="decimal" value="${p.carga}"
           onblur="arredondarCampoRbc(this,${i},'carga')" oninput="setRbcCarga(${i},this.value)" style="width:90px"></td>
      ${p.leituras.map((l,j)=>`<td><input type="number" step="any" inputmode="decimal" value="${l}"
           onblur="arredondarCampoRbc(this,${i},'leitura',${j})" oninput="setRbcLeitura(${i},${j},this.value)" style="width:78px"></td>`).join('')}
      <td>${media==null?'—':fmtMediaRbc(media)}</td>
      <td>${rotPesos}<br><span class="rbc-link" onclick="abrirModalPesos(${i})">＋ escolher pesos</span>
        ${(p.degrausSub > 0)
          ? `<br><span class="rbc-pill" style="background:#fdf6e3;color:#8a6d1a;border-color:#e6d9a8;cursor:pointer"
               title="Método da substituição — toque para ajustar ou remover"
               onclick="editarDegrausRbc(${i})">SUBST · ${p.degrausSub} degrau${p.degrausSub === 1 ? '' : 's'}</span>`
          : `<br><span class="rbc-link" style="color:#8a6d1a" onclick="editarDegrausRbc(${i})">＋ substituição</span>`}</td>
      <td><span class="rbc-u">${u}</span></td>
      <td><button type="button" class="btn-mini" onclick="verMemoriaRbc(${i})" title="Memória de cálculo">📋</button></td>
      <td><button type="button" class="btn-mini btn-vinho" onclick="removerCargaRbc(${i})">✕</button></td>
    </tr>`;
  }).join('');
}

// ── Método da substituição por ponto (Fase 2 — João, 14/08/2026) ──
// Cada degrau reintroduz a repetibilidade da balança na incerteza:
// u_sub = fator · √(degraus) · s_rep, somado em quadratura no servidor.
function editarDegrausRbc(i) {
  const R = window._rbc, p = R.pontos[i];
  const atual = p.degrausSub || 0;
  const v = prompt(
    'Degraus de substituição neste ponto de ' + (p.carga || '?') + ' ' + unid() + ':\n\n' +
    '0 = ponto realizado só com pesos-padrão\n' +
    'N = número de trocas pela carga de substituição\n\n' +
    'A incerteza do ponto cresce com √N.', atual);
  if (v === null) return;
  const n = parseInt(v);
  p.degrausSub = (isFinite(n) && n > 0) ? n : 0;
  marcarSujoRbc?.();
  renderRbcCarga();
}

// ── ENSAIO 2: EXCENTRICIDADE ─────────────────────────────────────
function renderRbcExc() {
  const R = window._rbc, n = R.numLeituras;
  const thead = document.getElementById('rbc-exc-thead');
  if (thead) thead.innerHTML = `<tr><th>Posição</th>
    ${Array.from({length:n},(_,i)=>`<th>L${i+1}</th>`).join('')}
    <th>Média</th><th>Erro (vs centro)</th></tr>`;

  const tbody = document.getElementById('rbc-exc-tbody');
  if (!tbody) return;
  // média do centro (ordem 1)
  const centro = R.exc.find(x => x.ordem === 1);
  const mediaCentro = centro ? mediaRbc(centro.leituras) : null;
  tbody.innerHTML = R.exc.map((pos, i) => {
    const media = mediaRbc(pos.leituras);
    let erro = '—';
    if (pos.ordem === 1) erro = '<span class="dica">referência</span>';
    else if (media != null && mediaCentro != null) {
      const e = media - mediaCentro;
      erro = (e>=0?'+':'') + fmtMediaRbc(e);
    }
    return `<tr>
      <td>${esc(pos.nome)}</td>
      ${pos.leituras.map((l,j)=>`<td><input type="number" step="any" inputmode="decimal" value="${l}"
           onblur="arredondarCampoRbc(this,${i},'exc',${j})" oninput="setRbcExc(${i},${j},this.value)" style="width:78px"></td>`).join('')}
      <td>${media==null?'—':fmtMediaRbc(media)}</td>
      <td>${erro}</td>
    </tr>`;
  }).join('');

  // maior erro
  const maior = maiorErroExc();
  const info = document.getElementById('rbc-exc-info');
  if (info) info.innerHTML = maior > 0
    ? `<b>Maior erro de excentricidade: ${fmtMediaRbc(maior)} ${unid()}</b> → alimenta o u_exc de todas as cargas.`
    : 'Preencha as posições para calcular o erro de excentricidade.';
}

// ── ENSAIO 3: MOBILIDADE ─────────────────────────────────────────
function renderRbcMob() {
  const R = window._rbc, n = R.numLeituras;
  const thead = document.getElementById('rbc-mob-thead');
  if (thead) thead.innerHTML = `<tr><th>Repetição</th>
    ${Array.from({length:n},(_,i)=>`<th>${i+1}</th>`).join('')}</tr>`;
  const tbody = document.getElementById('rbc-mob-tbody');
  if (tbody) tbody.innerHTML = `<tr><td>Leituras</td>
    ${R.mob.leituras.map((l,j)=>`<td><input type="number" step="any" inputmode="decimal" value="${l}"
         oninput="setRbcMob(${j},this.value)" onblur="mobBlur(this,${j})" style="width:78px"></td>`).join('')}</tr>`;
  // campos de referência (com arredondamento pela divisão)
  const cr = document.getElementById('rbc-mob-ref');
  if (cr) { cr.value = R.mob.cargaRef; cr.onblur = () => mobBlur(cr, 'ref'); }
  const cd = document.getElementById('rbc-mob-div'); if (cd) cd.value = R.mob.divisao;
  const ce = document.getElementById('rbc-mob-esp');
  if (ce) { ce.value = R.mob.esperado; ce.onblur = () => mobBlur(ce, 'esp'); }
}

// Divergência entre a soma dos pesos escolhidos e a carga aplicada.
// O erro do RBC é (média − valor convencional dos padrões): se os pesos
// não corresponderem à carga, o erro sai completamente distorcido.
function divergenciaPesos(ponto) {
  if (!ponto || !ponto.pesos || !ponto.pesos.length) return null;
  const carga = Number(String(ponto.carga).replace(',', '.'));
  if (!isFinite(carga) || carga <= 0) return null;
  const soma = ponto.pesos.reduce((a, w) => a + (Number(w.valor_convencional) || 0), 0);
  if (soma <= 0) return null;
  const dif = Math.abs(soma - carga);
  const pct = (dif / carga) * 100;
  return { soma, carga, dif, pct, grave: pct > 1 };
}

// helpers de média
function mediaRbc(leituras) {
  const v = (leituras||[]).map(x => String(x).trim()).filter(Boolean).map(x => Number(x.replace(',','.'))).filter(x => !isNaN(x));
  return v.length ? v.reduce((a,b)=>a+b,0)/v.length : null;
}
// Média/erros: 2 casas A MAIS que a divisão (a média cai entre as divisões)
function fmtMediaRbc(n) {
  if (n == null) return '—';
  const casas = (plano?.casasDecimais ?? 3) + 2;
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}
// Valores de certificado de peso (convencional/incerteza): como estão, até 6 casas
function fmtLivre(n) {
  if (n == null || n === '') return '—';
  return Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 6 });
}
function maiorErroExc() {
  const R = window._rbc;
  const centro = R.exc.find(x => x.ordem === 1);
  const mc = centro ? mediaRbc(centro.leituras) : null;
  if (mc == null) return 0;
  let maior = 0;
  for (const pos of R.exc) {
    if (pos.ordem === 1) continue;
    const m = mediaRbc(pos.leituras);
    if (m != null) maior = Math.max(maior, Math.abs(m - mc));
  }
  return maior;
}

// ── Edição de campos (atualiza o estado) ─────────────────────────
function setRbcCarga(i, v) { if (window._rbc.pontos[i]) window._rbc.pontos[i].carga = v; }
function setRbcLeitura(i, j, v) { if (window._rbc.pontos[i]) { window._rbc.pontos[i].leituras[j] = v; atualizarMediaCargaLinha(i); } }
function setRbcExc(i, j, v) { if (window._rbc.exc[i]) { window._rbc.exc[i].leituras[j] = v; renderRbcExc(); } }
function setRbcMob(j, v) { window._rbc.mob.leituras[j] = v; }
// Arredonda os campos da mobilidade pela divisão (faixa da carga de referência)
function mobBlur(input, alvo) {
  if (input.value === '') return;
  const R = window._rbc;
  const ref = Number(String(R.mob.cargaRef).replace(',', '.'));
  const res = (plano?.faixas?.length && ref) ? eDaFaixa(ref) : null;
  const f = fmtCampo(input.value, res);
  if (f === '') return;
  input.value = f;
  if (alvo === 'ref') R.mob.cargaRef = f;
  else if (alvo === 'esp') R.mob.esperado = f;
  else if (typeof alvo === 'number') R.mob.leituras[alvo] = f;
}

// atualização leve da média da carga (sem redesenhar, preserva foco)
function atualizarMediaCargaLinha(i) {
  const tbody = document.getElementById('rbc-carga-tbody');
  const linha = tbody?.children[i];
  if (!linha) return;
  const m = mediaRbc(window._rbc.pontos[i].leituras);
  const nCols = window._rbc.numLeituras;
  const tdMedia = linha.children[1 + nCols];
  if (tdMedia) tdMedia.textContent = m==null?'—':fmtMediaRbc(m);
}

// arredondamento — REUSA fmtCampo/eDaFaixa do app.js (mesmo da conformidade)
function arredondarCampoRbc(input, i, tipo, j) {
  if (input.value === '') return;
  const R = window._rbc;
  // resolução: da faixa da carga (multi-intervalo) ou escala única
  let cargaRef;
  if (tipo === 'carga' || tipo === 'leitura') cargaRef = Number(R.pontos[i]?.carga);
  else if (tipo === 'exc') cargaRef = Number(R.exc[i]?.leituras[j]) || Number(plano?.excentricidade?.carga);
  const resolucao = (plano?.faixas?.length && cargaRef) ? eDaFaixa(cargaRef) : null;
  const f = fmtCampo(input.value, resolucao);
  if (f !== '') {
    input.value = f;
    // reflete no estado
    if (tipo === 'carga') setRbcCarga(i, f);
    else if (tipo === 'leitura') { setRbcLeitura(i, j, f); }
    else if (tipo === 'exc') { R.exc[i].leituras[j] = f; renderRbcExc(); }
  }
}

// adicionar/remover
function addCargaRbc() { window._rbc.pontos.push({ carga:'', leituras:Array(window._rbc.numLeituras).fill(''), pesos:[], orcamento:null, degrausSub:0 }); renderRbcCarga(); }
function removerCargaRbc(i) { window._rbc.pontos.splice(i,1); if (!window._rbc.pontos.length) addCargaRbc(); else renderRbcCarga(); }
function addPosicaoExc() {
  const R = window._rbc;
  R.exc.push({ ordem: R.exc.length+1, nome: 'Posição '+(R.exc.length+1), leituras: Array(R.numLeituras).fill('') });
  renderRbcExc();
}

// ── MODAL: composição de pesos por carga ─────────────────────────
function abrirModalPesos(idx) {
  const R = window._rbc;
  const ponto = R.pontos[idx];
  if (!ponto) return;
  const cargaAlvo = Number(String(ponto.carga).replace(',','.')) || 0;
  window._rbc._cargaModal = cargaAlvo;
  const jaEscolhidos = new Set((ponto.pesos||[]).map(w => w.peso_ponto_rbc_id));

  // sugestão: pontos cujo valor nominal se aproxima (para pré-marcar)
  const linhas = R.pesosDisponiveis.map(pt => {
    const id = pt.id;
    const marcado = jaEscolhidos.has(id);
    const conv = pt.valor_convencional ?? '';
    const inc = pt.incerteza ?? '';
    return `<tr>
      <td><input type="checkbox" class="rbc-chk" value="${id}" ${marcado?'checked':''}
           data-ident="${esc(pt.peso_identificacao||'')}" data-nominal="${esc(pt.valor_nominal||'')}"
           data-conv="${conv}" data-inc="${inc}" data-k="${pt.k??2}" data-cert="${esc(pt.num_certificado||'')}"
           onchange="recalcComposicao()"></td>
      <td style="text-align:left">${esc(pt.peso_identificacao||'?')} — ${esc(pt.valor_nominal||'')}
          ${pt.num_certificado?`<br><span class="dica">cert. ${esc(pt.num_certificado)}</span>`:''}</td>
      <td>${conv!==''?fmtLivre(conv):'—'}</td>
      <td>${inc!==''?fmtLivre(inc):'—'}</td>
    </tr>`;
  }).join('');

  const semPesos = R.pesosDisponiveis.length === 0
    ? '<p class="dica" style="color:#b02a37">Nenhum ponto de peso cadastrado. Cadastre os pesos padrão (com a tabela de pontos) antes.</p>'
    : '';

  const html = `
    <div class="rbc-sug">💡 Marque os pesos/pontos que compõem a carga de <b>${fmtU(ponto.carga)} ${unid()}</b>.
      Pode combinar pontos de certificados diferentes. O sistema soma os valores e combina as incertezas.</div>
    ${semPesos}
    <table class="rbc-modal-tab">
      <thead><tr><th></th><th style="text-align:left">Peso / ponto</th><th>Valor convenc.</th><th>Incerteza (U)</th></tr></thead>
      <tbody>${linhas}</tbody>
    </table>
    <div id="rbc-comp-resumo" class="rbc-resumo"></div>`;

  abrirModalRbcGenerico('Pesos usados na carga', html, () => confirmarComposicao(idx), 'Confirmar composição');
  recalcComposicao();
}

function recalcComposicao() {
  const chks = document.querySelectorAll('.rbc-chk:checked');
  let conv = 0, somaU2 = 0, n = 0;
  chks.forEach(c => {
    const cv = Number(c.dataset.conv); const u = Number(c.dataset.inc); const k = Number(c.dataset.k)||2;
    if (!isNaN(cv)) conv += cv;
    if (!isNaN(u)) { const up = k>0?u/k:u; somaU2 += up*up; }
    n++;
  });
  const uPad = Math.sqrt(somaU2);
  const resumo = document.getElementById('rbc-comp-resumo');
  const cargaAlvoEl = window._rbc._cargaModal;
  let avisoDiv = '';
  if (n > 0 && cargaAlvoEl > 0) {
    const pctD = Math.abs(conv - cargaAlvoEl) / cargaAlvoEl * 100;
    if (pctD > 1) avisoDiv = `<div style="color:#b02a37;margin-top:6px">⚠ A soma (${fmtLivre(conv)}) difere da carga (${fmtLivre(cargaAlvoEl)}) em ${pctD.toFixed(1)}%. Confira se marcou os pesos certos.</div>`;
  }
  if (resumo) resumo.innerHTML = n === 0
    ? '<span class="dica">Nenhum peso selecionado.</span>'
    : `<b>Composição:</b> ${n} peso(s)<br>
       Valor convencional total = <b>${fmtLivre(conv)} ${unid()}</b><br>
       Incerteza dos padrões = √(Σ(u/k)²) = <b>${fmtLivre(uPad)} ${unid()}</b> <span class="dica">(quadratura)</span>` + avisoDiv;
}

function confirmarComposicao(idx) {
  const chks = document.querySelectorAll('.rbc-chk:checked');
  const pesos = [];
  chks.forEach(c => {
    pesos.push({
      peso_ponto_rbc_id: c.value,
      peso_identificacao: c.dataset.ident,
      valor_nominal: c.dataset.nominal,
      valor_convencional: c.dataset.conv !== '' ? Number(c.dataset.conv) : null,
      incerteza: c.dataset.inc !== '' ? Number(c.dataset.inc) : null,
      k: Number(c.dataset.k) || 2,
      num_certificado: c.dataset.cert
    });
  });
  window._rbc.pontos[idx].pesos = pesos;
  document.querySelector('.modal-fundo')?.remove();
  renderRbcCarga();
  if (window._rbc.wiz && window._rbc.wiz.fase !== 'resumo') renderWizard();
  toast(`${pesos.length} peso(s) vinculado(s) à carga.`, 'ok');
}

// ── Salvar a coleta (backend calcula e devolve orçamentos) ───────
async function salvarColetaRbc(enviar) {
  const R = window._rbc;
  const num = v => { const n = Number(String(v).replace(',','.')); return isNaN(n) ? null : n; };

  const corpo = {
    pontos: R.pontos.filter(p => String(p.carga).trim()).map(p => ({
      carga: num(p.carga),
      degrausSub: p.degrausSub || 0,
      leituras: p.leituras.map(num).filter(x => x != null),
      pesos: (p.pesos||[]).map(w => ({
        pesoPontoRbcId: w.peso_ponto_rbc_id || null,
        pesoIdentificacao: w.peso_identificacao,
        valorNominal: w.valor_nominal,
        valorConvencional: w.valor_convencional,
        incerteza: w.incerteza, k: w.k,
        numCertificado: w.num_certificado
      })),
      densidadePeso: 8000
    })),
    excentricidade: R.exc.map(pos => ({
      ordemPosicao: pos.ordem, nomePosicao: pos.nome,
      carga: num(plano?.excentricidade?.carga),
      leituras: pos.leituras.map(num).filter(x => x != null)
    })).filter(p => p.leituras.length > 0),
    mobilidade: R.mob.leituras.map(num).filter(x => x != null),
    mobCargaRef: num(R.mob.cargaRef), mobDivisao: num(R.mob.divisao), mobEsperado: num(R.mob.esperado),
    divisao: Number(plano?.balanca?.divisao_e) || 0.001,
    tempC: num($('#rbc-temp')?.value), pressaoHpa: num($('#rbc-pressao')?.value), umidadePct: num($('#rbc-umid')?.value)
  };

  try {
    const r = await api('/certificados/' + certId + '/coleta-rbc', { method: 'PUT', body: JSON.stringify(corpo) });
    // relê orçamentos calculados
    const dados = await api('/certificados/' + certId + '/coleta-rbc');
    aplicarOrcamentosRbc(dados.orcamentos || []);
    renderRbcCarga();
    if (enviar) {
      const corpoEnv = {
        dataCalibracao: $('#rbc-data')?.value || null,
        temperatura: num($('#rbc-temp')?.value),
        umidade: num($('#rbc-umid')?.value),
        pressao: num($('#rbc-pressao')?.value),
        localTipo: $('#rbc-local')?.value || 'in_loco'
      };
      await api('/certificados/' + certId + '/enviar-rbc', { method: 'POST', body: JSON.stringify(corpoEnv) });
      toast('Certificado RBC enviado para aprovação.', 'ok', 5000);
      irPainel();
      return;
    }
    toast('Coleta salva e incerteza calculada.', 'ok');
  } catch (e) { toast(e.message, 'erro'); }
}

function aplicarOrcamentosRbc(orcamentos) {
  for (const o of orcamentos) {
    const idx = (o.ordem_ponto||0) - 1;
    if (window._rbc.pontos[idx]) window._rbc.pontos[idx].orcamento = o;
  }
}

// ── MODAL: memória de cálculo (um ponto, ou todos se idx==null) ──
function verMemoriaRbc(idx) {
  const R = window._rbc;
  const pts = (idx == null) ? R.pontos : [R.pontos[idx]];
  const corpo = pts.map(p => {
    if (!p) return '';
    if (!p.orcamento) return `<div class="mem-bloco"><b>Carga ${fmtU(p.carga)} ${unid()}</b><br><span class="dica">Salve a coleta para calcular a incerteza deste ponto.</span></div>`;
    return memoriaHtmlRbc(p);
  }).join('');
  abrirModalRbcGenerico('Memória de cálculo', corpo + textoMetodoRbc(), null);
}

function memoriaHtmlRbc(p) {
  const o = p.orcamento, u = unid();
  const f = (x,d=6) => x==null ? '—' : Number(x).toFixed(d).replace('.', ',');
  const pesos = (p.pesos||[]).length
    ? p.pesos.map(w => `${esc(w.peso_identificacao||'?')} (${esc(w.valor_nominal||'')}, cert. ${esc(w.num_certificado||'—')})`).join(' + ')
    : '—';
  return `<div class="mem-bloco">
    <b>━━━ Carga: ${fmtU(p.carga)} ${u} ━━━</b>
    <div class="mem-linha">Pesos usados: ${pesos}</div>
    <div class="mem-linha">Leituras (n=${p.leituras.filter(x=>String(x).trim()).length}): ${p.leituras.filter(x=>String(x).trim()).join(' · ')}</div>
    <div class="mem-linha">Média (x̄) = <b>${f(o.media)}</b> ${u}</div>
    <div class="mem-linha">Erro (E = x̄ − valor convencional) = <b>${f(o.erro)}</b> ${u}</div>
    <div class="mem-sec">Componentes de incerteza:</div>
    <div class="mem-comp">① Repetibilidade &nbsp;<span class="mem-f">u_rep = s/√n</span><br>&nbsp;&nbsp;s = ${f(o.s_rep)} ; u_rep = <b>${f(o.u_rep)}</b></div>
    <div class="mem-comp">② Resolução &nbsp;<span class="mem-f">u_res = √2·d/(2√3)</span><br>&nbsp;&nbsp;u_res = <b>${f(o.u_res)}</b></div>
    <div class="mem-comp">③ Padrão &nbsp;<span class="mem-f">u_pad = √(Σ(u/k)²)</span><br>&nbsp;&nbsp;u_pad = <b>${f(o.u_pad)}</b></div>
    <div class="mem-comp">④ Excentricidade &nbsp;<span class="mem-f">u_exc = |erro_exc|/√3</span><br>&nbsp;&nbsp;u_exc = <b>${f(o.u_exc)}</b></div>
    <div class="mem-comp">⑤ Empuxo do ar &nbsp;<span class="mem-f">u_buoy = m·u(ρar)/ρpeso</span><br>&nbsp;&nbsp;u_buoy = <b>${f(o.u_buoy,8)}</b></div>
    <div class="mem-sec">Combinação:</div>
    <div class="mem-linha">u_c = √(u_rep² + u_res² + u_pad² + u_exc² + u_buoy²) = <b>${f(o.u_c)}</b></div>
    <div class="mem-linha">v_eff (Welch-Satterthwaite) = ${f(o.veff,1)} → k = ${f(o.k,2)}</div>
    <div class="mem-final">U = k · u_c = ${f(o.k,2)} × ${f(o.u_c)} = ± ${f(o.u_expandida)} ${u}</div>
  </div>`;
}

function textoMetodoRbc() {
  return `<div class="mem-metodo">
    <b>Método (para auditoria)</b>
    <p>A incerteza segue o EURAMET cg-18 / GUM. Para cada ponto de carga combinam-se em
    quadratura: a repetibilidade (s/√n das N leituras), a resolução (√2·d/2√3), a incerteza
    dos padrões (√(Σ(u/k)²) da composição de pesos), a excentricidade (|maior erro|/√3, do
    ensaio de excentricidade) e o empuxo do ar (CIPM-2007). Os graus de liberdade efetivos
    são estimados por Welch-Satterthwaite e o fator k corresponde a ~95,45%. U = k·u_c.</p>
    <p class="dica">Rastreabilidade ao SI pelos certificados dos padrões. A mobilidade é
    registrada como caracterização (a resolução já cobre essa fonte). Esta memória é
    conferência interna — o PDF do certificado traz apenas o resultado final.</p>
  </div>`;
}

// ── Modal genérico (padrão modal-fundo do app.js) ────────────────
function abrirModalRbcGenerico(titulo, corpoHtml, onConfirmar, textoConfirmar) {
  const div = document.createElement('div');
  div.className = 'modal-fundo';
  div.setAttribute('onclick', 'if(event.target===this)this.remove()');
  const btnConfirmar = onConfirmar
    ? `<button class="btn-primario" id="rbc-modal-ok">${textoConfirmar||'Confirmar'}</button>`
    : '';
  div.innerHTML = `<div class="modal-caixa" style="max-width:660px;max-height:86vh;overflow:auto">
    <h3>${titulo}</h3>
    <div class="mem-wrap">${corpoHtml}</div>
    <div style="display:flex;gap:8px;margin-top:12px">
      ${btnConfirmar}
      <button ${onConfirmar?'':'class="btn-primario"'} onclick="this.closest('.modal-fundo').remove()">${onConfirmar?'Cancelar':'Fechar'}</button>
    </div>
  </div>`;
  document.body.appendChild(div);
  if (onConfirmar) {
    const b = div.querySelector('#rbc-modal-ok');
    if (b) b.onclick = onConfirmar;
  }
}

// ═══════ MODO GUIADO (wizard): um ponto por vez, resumo no final ═══════
function cardRbcDe(idElemento) {
  const el = document.getElementById(idElemento);
  return el ? el.closest('.card') : null;
}

function iniciarWizardRbc(irResumo) {
  const R = window._rbc;
  R.wiz = irResumo ? { fase: 'resumo', idx: 0 } : { fase: 'carga', idx: 0 };
  // CSS do wizard (injetado uma vez)
  if (!document.getElementById('rbc-wiz-css')) {
    const st = document.createElement('style');
    st.id = 'rbc-wiz-css';
    st.textContent = [
      '.wiz-prog{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}',
      '.wiz-dot{min-width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center;',
      ' border-radius:15px;background:#e8edf3;color:#33475b;font-size:11px;font-weight:700;cursor:pointer;padding:0 8px}',
      '.wiz-dot.feito{background:#cfe3d8;color:#0a5c40}',
      '.wiz-dot.ativo{background:#1e3a5f;color:#fff}',
      '.wiz-leituras{display:flex;flex-wrap:wrap;gap:10px;margin:10px 0}',
      '.wiz-leituras label{flex:1;min-width:110px}',
      '.wiz-campo{font-size:17px;padding:9px 10px;width:100%;box-sizing:border-box}'
    ].join('');
    document.head.appendChild(st);
  }
  // esconde as grades e o rodapé (viram o resumo final)
  ['rbc-carga', 'rbc-exc', 'rbc-mob'].forEach(id => {
    const c = cardRbcDe(id); if (c) c.style.display = 'none';
  });
  const rodape = document.querySelector('#tela-ensaio-rbc .rodape-acoes');
  if (rodape) rodape.style.display = 'none';
  // injeta o card do wizard (se ainda não existe) após o card das condições
  if (!document.getElementById('rbc-wizard')) {
    const cardCond = document.querySelector('#tela-ensaio-rbc main .card:nth-of-type(2)');
    const div = document.createElement('div');
    div.className = 'card';
    div.id = 'rbc-wizard';
    (cardCond || document.querySelector('#tela-ensaio-rbc main')).insertAdjacentElement(
      cardCond ? 'afterend' : 'beforeend', div);
  }
  document.getElementById('rbc-wizard').style.display = '';
  renderWizard();
}

function passosWizard() {
  const R = window._rbc, passos = [];
  for (let i = 0; i < R.pontos.length; i++) passos.push({ fase: 'carga', idx: i, rot: 'C' + (i + 1) });
  for (let j = 0; j < R.exc.length; j++) passos.push({ fase: 'exc', idx: j, rot: 'E' + (j + 1) });
  passos.push({ fase: 'mob', idx: 0, rot: 'M' });
  passos.push({ fase: 'resumo', idx: 0, rot: '\u2713' });
  return passos;
}

function renderWizard() {
  const R = window._rbc, W = R.wiz;
  const box = document.getElementById('rbc-wizard');
  if (!box || !W) return;
  if (W.fase === 'resumo') { mostrarResumoRbc(); return; }
  const n = R.numLeituras;
  const passos = passosWizard();
  const atual = passos.findIndex(x => x.fase === W.fase && x.idx === W.idx);
  const prog = passos.map((x, k) =>
    `<span class="wiz-dot${k === atual ? ' ativo' : ''}${k < atual ? ' feito' : ''}" onclick="wizIr('${x.fase}',${x.idx})">${x.rot}</span>`).join('');

  let corpo = '';
  if (W.fase === 'carga') {
    const p = R.pontos[W.idx];
    const media = mediaRbc(p.leituras);
    const u = p.orcamento ? '\u00b1 ' + fmtU(p.orcamento.u_expandida) : '\u2014';
    const pills = (p.pesos || []).length
      ? p.pesos.map(w => `<span class="rbc-pill">${esc(w.peso_identificacao || '?')}\u00b7${esc(w.valor_nominal || '')}</span>`).join('')
      : '<span class="dica">sem pesos</span>';
    corpo = `
      <h3>1 \u00b7 Carga \u2014 ponto ${W.idx + 1} de ${R.pontos.length}</h3>
      <label>Carga (<span class="u-unid-rbc">${unid()}</span>)
        <input type="number" step="any" inputmode="decimal" id="wiz-carga" value="${p.carga}"
          oninput="window._rbc.pontos[${W.idx}].carga=this.value"
          onblur="wizBlurCarga(this, ${W.idx})" class="wiz-campo"></label>
      <div style="margin:8px 0">${pills}
        <span class="rbc-link" onclick="abrirModalPesos(${W.idx})">\uFF0B escolher pesos</span></div>
      <div class="wiz-leituras">
        ${p.leituras.map((l, j) => `
          <label>Leitura ${j + 1}
            <input type="number" step="any" inputmode="decimal" value="${l}"
              oninput="wizLeitura(${W.idx}, ${j}, this.value)"
              onblur="wizBlurLeitura(this, ${W.idx}, ${j})" class="wiz-campo"></label>`).join('')}
      </div>
      <p class="dica">M\u00e9dia: <b id="wiz-media">${media == null ? '\u2014' : fmtMediaRbc(media)}</b>
        &nbsp;\u00b7&nbsp; U: <span class="rbc-u">${u}</span></p>`;
  } else if (W.fase === 'exc') {
    const pos = R.exc[W.idx];
    const centro = R.exc.find(x => x.ordem === 1);
    const mc = centro ? mediaRbc(centro.leituras) : null;
    const m = mediaRbc(pos.leituras);
    let erro = '';
    if (pos.ordem === 1) erro = '<span class="dica">(refer\u00eancia \u2014 centro do prato)</span>';
    else if (m != null && mc != null) {
      const e2 = m - mc;
      erro = `Erro vs centro: <b>${(e2 >= 0 ? '+' : '') + fmtMediaRbc(e2)}</b>`;
    }
    const cargaExc = plano?.excentricidade?.carga;
    corpo = `
      <h3>2 \u00b7 Excentricidade \u2014 posi\u00e7\u00e3o ${pos.nome} de ${R.exc.length}</h3>
      ${cargaExc ? `<p class="dica">Carga recomendada: <b>${fmtU(cargaExc)} ${unid()}</b> (\u224833% da capacidade), na posi\u00e7\u00e3o ${pos.nome} do prato.</p>` : ''}
      <div class="wiz-leituras">
        ${pos.leituras.map((l, j) => `
          <label>Leitura ${j + 1}
            <input type="number" step="any" inputmode="decimal" value="${l}"
              oninput="wizExc(${W.idx}, ${j}, this.value)"
              onblur="wizBlurExc(this, ${W.idx}, ${j})" class="wiz-campo"></label>`).join('')}
      </div>
      <p class="dica" id="wiz-exc-erro">${erro}</p>`;
  } else if (W.fase === 'mob') {
    corpo = `
      <h3>3 \u00b7 Mobilidade <span class="tag-reg">registro \u2014 n\u00e3o entra no c\u00e1lculo</span></h3>
      <p class="dica">Carga de refer\u00eancia + 1 divis\u00e3o (e), medida ${n} vezes.</p>
      <div class="linha-3">
        <label>Carga de refer\u00eancia (<span class="u-unid-rbc">${unid()}</span>)
          <input type="number" step="any" inputmode="decimal" value="${R.mob.cargaRef}"
            oninput="window._rbc.mob.cargaRef=this.value" onblur="mobBlur(this,'ref')" class="wiz-campo"></label>
        <label>Adi\u00e7\u00e3o (1 divis\u00e3o e)
          <input type="number" step="any" value="${R.mob.divisao}" readonly class="wiz-campo"></label>
        <label>Esperado no display
          <input type="number" step="any" inputmode="decimal" value="${R.mob.esperado}"
            oninput="window._rbc.mob.esperado=this.value" onblur="mobBlur(this,'esp')" class="wiz-campo"></label>
      </div>
      <div class="wiz-leituras">
        ${R.mob.leituras.map((l, j) => `
          <label>Leitura ${j + 1}
            <input type="number" step="any" inputmode="decimal" value="${l}"
              oninput="setRbcMob(${j}, this.value)" onblur="mobBlur(this,${j})" class="wiz-campo"></label>`).join('')}
      </div>`;
  }

  const ehPrimeiro = atual === 0;
  const ehUltimoAntesResumo = passos[atual + 1] && passos[atual + 1].fase === 'resumo';
  box.innerHTML = `
    <div class="wiz-prog">${prog}</div>
    ${corpo}
    <div style="display:flex;gap:8px;margin-top:14px">
      <button type="button" ${ehPrimeiro ? 'disabled' : ''} onclick="wizNav(-1)">\u2190 Anterior</button>
      <button type="button" class="btn-primario" onclick="wizNav(1)">
        ${ehUltimoAntesResumo ? 'Concluir \u2192 Resumo' : 'Pr\u00f3ximo \u2192'}</button>
    </div>`;
}

function wizNav(delta) {
  const passos = passosWizard(), W = window._rbc.wiz;
  const atual = passos.findIndex(x => x.fase === W.fase && x.idx === W.idx);
  const alvo = passos[atual + delta];
  if (!alvo) return;
  W.fase = alvo.fase; W.idx = alvo.idx;
  renderWizard();
}
function wizIr(fase, idx) {
  window._rbc.wiz = { fase, idx };
  renderWizard();
}

// setters do wizard (com média ao vivo e arredondamento pela divisão)
function wizLeitura(i, j, v) {
  window._rbc.pontos[i].leituras[j] = v;
  const m = mediaRbc(window._rbc.pontos[i].leituras);
  const el = document.getElementById('wiz-media');
  if (el) el.textContent = m == null ? '\u2014' : fmtMediaRbc(m);
}
function wizBlurLeitura(input, i, j) {
  if (input.value === '') return;
  const carga = Number(String(window._rbc.pontos[i].carga).replace(',', '.'));
  const res = (plano?.faixas?.length && carga) ? eDaFaixa(carga) : null;
  const f = fmtCampo(input.value, res);
  if (f !== '') { input.value = f; wizLeitura(i, j, f); }
}
function wizBlurCarga(input, i) {
  if (input.value === '') return;
  const v = Number(String(input.value).replace(',', '.'));
  const res = (plano?.faixas?.length && v) ? eDaFaixa(v) : null;
  const f = fmtCampo(input.value, res);
  if (f !== '') { input.value = f; window._rbc.pontos[i].carga = f; }
}
function wizExc(i, j, v) {
  window._rbc.exc[i].leituras[j] = v;
  // erro ao vivo
  const R = window._rbc;
  const centro = R.exc.find(x => x.ordem === 1);
  const mc = centro ? mediaRbc(centro.leituras) : null;
  const m = mediaRbc(R.exc[i].leituras);
  const el = document.getElementById('wiz-exc-erro');
  if (el && R.exc[i].ordem !== 1 && m != null && mc != null) {
    const e2 = m - mc;
    el.innerHTML = 'Erro vs centro: <b>' + ((e2 >= 0 ? '+' : '') + fmtMediaRbc(e2)) + '</b>';
  }
}
function wizBlurExc(input, i, j) {
  if (input.value === '') return;
  const cargaExc = Number(plano?.excentricidade?.carga);
  const res = (plano?.faixas?.length && cargaExc) ? eDaFaixa(cargaExc) : null;
  const f = fmtCampo(input.value, res);
  if (f !== '') { input.value = f; wizExc(i, j, f); }
}

// Resumo final: mostra as grades preenchidas + salvar
function mostrarResumoRbc() {
  const box = document.getElementById('rbc-wizard');
  if (box) box.style.display = 'none';
  renderRbcTudo();
  ['rbc-carga', 'rbc-exc', 'rbc-mob'].forEach(id => {
    const c = cardRbcDe(id); if (c) c.style.display = '';
  });
  const rodape = document.querySelector('#tela-ensaio-rbc .rodape-acoes');
  if (rodape) rodape.style.display = '';
  // botão de voltar ao guiado (uma vez)
  if (!document.getElementById('rbc-voltar-wiz')) {
    const cardCarga = cardRbcDe('rbc-carga');
    if (cardCarga) {
      const div = document.createElement('div');
      div.id = 'rbc-voltar-wiz';
      div.style.margin = '0 0 10px';
      div.innerHTML = '<button type="button" class="btn-mini" onclick="voltarWizardRbc()">\u270F\uFE0F Voltar ao preenchimento guiado</button>';
      cardCarga.insertAdjacentElement('beforebegin', div);
    }
  } else {
    document.getElementById('rbc-voltar-wiz').style.display = '';
  }
}
function voltarWizardRbc() {
  ['rbc-carga', 'rbc-exc', 'rbc-mob'].forEach(id => {
    const c = cardRbcDe(id); if (c) c.style.display = 'none';
  });
  const rodape = document.querySelector('#tela-ensaio-rbc .rodape-acoes');
  if (rodape) rodape.style.display = 'none';
  const v = document.getElementById('rbc-voltar-wiz');
  if (v) v.style.display = 'none';
  const box = document.getElementById('rbc-wizard');
  if (box) box.style.display = '';
  window._rbc.wiz = { fase: 'carga', idx: 0 };
  renderWizard();
}
