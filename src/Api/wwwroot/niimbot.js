// ═══════════════════════════════════════════════════════════════════
// Impressão direta em impressoras NIIMBOT via Web Bluetooth.
//
// Protocolo conforme a documentação da comunidade (printers.niim.blue).
// Testado contra a especificação; a validação final é com a impressora
// na mão — protocolo binário sem hardware sempre exige ajuste fino.
//
// Requisitos: Chrome/Edge, HTTPS, Windows ou Android (o Safari/iOS não
// implementa Web Bluetooth).
// ═══════════════════════════════════════════════════════════════════

const NB_SERVICO = 'e7810a71-73ae-499d-8c15-faa9aef0c3f2';
const NB_CARACT  = 'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f';

// Modelos: printhead em pixels e dpi. O cabeçote LIMITA a largura útil.
const NB_MODELOS = {
  b1:      { nome: 'B1',      dpi: 203, cabecote: 384 },
  // v4 desligado de propósito (08/08/2026): os testes T19/T20 validaram o
  // protocolo CLÁSSICO com página dupla; o V4 continua implementado abaixo
  // para reativar quando a comunidade resolver o bug de BT dos modelos Pro.
  b1_pro:  { nome: 'B1 Pro',  dpi: 300, cabecote: 567 },
  b21:     { nome: 'B21',     dpi: 203, cabecote: 384 },
  b21_pro: { nome: 'B21 Pro', dpi: 300, cabecote: 591, v4: true },
  b3s:     { nome: 'B3S',     dpi: 203, cabecote: 576 },
  d110:    { nome: 'D110',    dpi: 203, cabecote: 96  }
};

const CMD = {
  PrintStart: 0x01, PageStart: 0x03, SetPageSize: 0x13, PrintQuantity: 0x15,
  PrintClear: 0x20, SetDensity: 0x21, SetLabelType: 0x23,
  PrintBitmapRowIndexed: 0x83, PrintEmptyRow: 0x84, PrintBitmapRow: 0x85,
  PrintStatus: 0xa3, Heartbeat: 0xdc, PageEnd: 0xe3, PrintEnd: 0xf3
};

class NiimbotWeb {
  static log = [];
  static registrar(tipo, msg) {
    const t = new Date().toLocaleTimeString('pt-BR');
    NiimbotWeb.log.push({ t, tipo, msg });
    if (NiimbotWeb.log.length > 200) NiimbotWeb.log.shift();
    console.log(`[niimbot] ${tipo}: ${msg}`);
  }

  constructor(modelo = 'b1_pro') {
    this.modelo = NB_MODELOS[modelo] || NB_MODELOS.b1_pro;
    this.dispositivo = null;
    this.caract = null;
    this.aguardando = new Map();   // comando de resposta -> resolve
    this.buffer = new Uint8Array(0);
  }

  // ── pacote: 55 55 CMD LEN DADOS CHECKSUM AA AA ──
  // Checksum = XOR de tudo, do comando ao último byte de dados.
  montar(cmd, dados) {
    const d = dados instanceof Uint8Array ? dados : new Uint8Array(dados);
    const p = new Uint8Array(7 + d.length);
    p[0] = 0x55; p[1] = 0x55; p[2] = cmd; p[3] = d.length;
    p.set(d, 4);
    let ck = cmd ^ d.length;
    for (const b of d) ck ^= b;
    p[4 + d.length] = ck;
    p[5 + d.length] = 0xaa; p[6 + d.length] = 0xaa;
    return p;
  }

  // Reconecta na impressora já usada, sem abrir a janela de seleção.
  // Guarda a referência em memória (funciona enquanto a aba estiver aberta)
  // e tenta o getDevices() do navegador. NÃO altera nada da impressão.
  // Android: o gatt.connect() pode ficar pendurado PARA SEMPRE quando a
  // impressora dormiu (bug do Chrome Android) — corrida com timeout evita
  // travar a tela; quem chamar cai no modal de parear (20/08/2026).
  async abrirGattComTimeout(dev, ms = 6000) {
    let timer;
    const tempo = new Promise((resolver, rejeitar) => {
      timer = setTimeout(() => rejeitar(new Error('tempo esgotado na reconexão')), ms);
    });
    try { return await Promise.race([this.abrirGatt(dev), tempo]); }
    finally { clearTimeout(timer); }
  }

  async reconectar() {
    if (NiimbotWeb.ultimoDispositivo) {
      try {
        const n = await this.abrirGattComTimeout(NiimbotWeb.ultimoDispositivo);
        if (n) return n;
      } catch (e) {
        NiimbotWeb.registrar('reconexão', 'dispositivo lembrado falhou: ' + e.message);
        try { NiimbotWeb.ultimoDispositivo.gatt.disconnect(); } catch (e2) {}
        this.caract = null;
      }
    }
    if (!navigator.bluetooth?.getDevices) return null;
    let conhecidos = [];
    try { conhecidos = await navigator.bluetooth.getDevices(); } catch (e) { return null; }
    for (const dev of conhecidos) {
      try { const n = await this.abrirGattComTimeout(dev); if (n) return n; }
      catch (e) {
        try { dev.gatt.disconnect(); } catch (e2) {}
        this.caract = null;
      }
    }
    return null;
  }

  // Abre a conexão GATT num dispositivo conhecido (usado pela reconexão)
  async abrirGatt(dev) {
    this.dispositivo = dev;
    const servidor = dev.gatt.connected ? dev.gatt : await dev.gatt.connect();
    const servico = await servidor.getPrimaryService(NB_SERVICO);
    this.caract = await servico.getCharacteristic(NB_CARACT);
    await this.caract.startNotifications();
    this.caract.addEventListener('characteristicvaluechanged',
      e => this.receber(new Uint8Array(e.target.value.buffer)));
    dev.addEventListener('gattserverdisconnected', () => { this.caract = null; });
    await this.handshake();
    NiimbotWeb.ultimoDispositivo = dev;
    return dev.name || 'impressora';
  }

  // Consulta a impressora (só no diagnóstico — fora do fluxo de impressão)
  async lerEtiqueta() {
    const hex = d => [...d].map(b => b.toString(16).padStart(2, '0')).join(' ');
    try { NiimbotWeb.registrar('impressora', 'RFID: ' +
      hex(await this.enviarEsperar(0x1a, [1], 0x1b, 2500))); }
    catch (e) { NiimbotWeb.registrar('impressora', 'RFID: sem resposta'); }
  }

  async conectar(todosOsAparelhos = false) {
    if (!navigator.bluetooth)
      throw new Error('Este navegador não suporta Bluetooth. Use o Chrome ou Edge ' +
                      '(no iPhone não funciona — o Safari não implementa Web Bluetooth).');

    // Busca por NOME: a maioria das Niimbot não anuncia o UUID do serviço,
    // então filtrar por serviço devolvia lista vazia.
    const PREFIXOS = ['B1', 'B21', 'B3', 'B31', 'B18', 'B2', 'D11', 'D110',
                      'K3', 'M2', 'M3', 'A20', 'S1', 'T6', 'NIIMBOT', 'Niimbot', 'JC'];
    this.dispositivo = await navigator.bluetooth.requestDevice(
      todosOsAparelhos
        ? { acceptAllDevices: true, optionalServices: [NB_SERVICO] }
        : { filters: PREFIXOS.map(p => ({ namePrefix: p })),
            optionalServices: [NB_SERVICO] });
    this.dispositivo.addEventListener('gattserverdisconnected', () => {
      this.caract = null;
    });

    const servidor = await this.dispositivo.gatt.connect();
    const servico = await servidor.getPrimaryService(NB_SERVICO);
    this.caract = await servico.getCharacteristic(NB_CARACT);
    await this.caract.startNotifications();
    this.caract.addEventListener('characteristicvaluechanged',
      e => this.receber(new Uint8Array(e.target.value.buffer)));
    NiimbotWeb.ultimoDispositivo = this.dispositivo;
    await this.handshake();
    return this.dispositivo.name || 'impressora';
  }

  desconectar(deVerdade = false) {
    if (!deVerdade) return;   // manter viva: desconectar faria repedir o pareamento
    try { this.dispositivo?.gatt?.disconnect(); } catch (e) {}
    this.caract = null;
  }

  // Os pacotes chegam FRAGMENTADOS — acumula e extrai um por vez.
  receber(pedaco) {
    const novo = new Uint8Array(this.buffer.length + pedaco.length);
    novo.set(this.buffer); novo.set(pedaco, this.buffer.length);
    this.buffer = novo;

    while (this.buffer.length >= 7) {
      if (this.buffer[0] !== 0x55 || this.buffer[1] !== 0x55) {
        this.buffer = this.buffer.subarray(1);   // ressincroniza
        continue;
      }
      const len = this.buffer[3];
      const total = 7 + len;
      if (this.buffer.length < total) break;     // pacote incompleto
      const cmd = this.buffer[2];
      const dados = this.buffer.subarray(4, 4 + len);
      const espera = this.aguardando.get(cmd);
      if (espera) { this.aguardando.delete(cmd); espera(new Uint8Array(dados)); }
      this.buffer = this.buffer.subarray(total);
    }
  }

  // Handshake do protocolo (initialNegotiate da referência niimbluelib):
  // Connect 0xc1 + consulta de versão. O app oficial SEMPRE faz antes de
  // imprimir; sem ele firmwares novas podem operar em modo limitado.
  async handshake() {
    try {
      const rc = await this.enviarEsperar(0xc1, [1], 0xc2, 4000);
      NiimbotWeb.registrar('handshake', 'Connect -> ' + rc[0] +
        ' (' + ({0:'Disconnect',1:'Connected',2:'ConnectedNew',3:'ConnectedV3',90:'FirmwareErrors'}[rc[0]] || '?') + ')');
      if (rc[0] === 3) {
        const st = await this.enviarEsperar(0xa5, [1], 0xb5, 4000);
        NiimbotWeb.registrar('handshake', 'StatusData: firmware ' +
          (st.length > 12 ? st[11] + '.' + st[12] : '?'));
      }
    } catch (e) {
      NiimbotWeb.registrar('handshake', 'sem resposta (' + e.message + ') — seguindo assim mesmo');
    }
  }

  // Derruba a conexão Bluetooth de propósito (fluxo do João, 08/08/2026:
  // desconectar após CADA impressão para liberar a impressora para outros
  // aparelhos/técnicos; a próxima impressão reconecta sozinha).
  desconectar() {
    try { this.dispositivo?.gatt?.disconnect(); } catch (e) {}
    this.caract = null;
  }

  // iOS (Bluefy/WebBLE): o CoreBluetooth DESCARTA writeWithoutResponse em
  // silêncio quando o buffer enche — linhas da imagem somem e a etiqueta
  // sai em branco (visto em 09/08/2026). Nesses aparelhos usamos escrita
  // CONFIRMADA (com resposta): mais lenta, porém sem perda. Android e
  // desktop seguem no modo rápido de sempre.
  static ehIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

  async enviar(cmd, dados) {
    if (!this.caract) throw new Error('Impressora desconectada.');
    const p = this.montar(cmd, dados);
    if (NiimbotWeb.ehIOS && typeof this.caract.writeValueWithResponse === 'function')
      await this.caract.writeValueWithResponse(p);
    else
      await this.caract.writeValueWithoutResponse(p);
  }

  // Envia e espera a resposta (com timeout, para não travar a tela)
  async enviarEsperar(cmd, dados, respostaCmd, ms = 4000) {
    const p = new Promise((ok, err) => {
      this.aguardando.set(respostaCmd, ok);
      setTimeout(() => {
        if (this.aguardando.has(respostaCmd)) {
          this.aguardando.delete(respostaCmd);
          err(new Error(`a impressora não respondeu (comando 0x${cmd.toString(16)})`));
        }
      }, ms);
    });
    await this.enviar(cmd, dados);
    return p;
  }

  u16(v) { return [(v >> 8) & 0xff, v & 0xff]; }   // big-endian

  // ── Converte o canvas em linhas de pixels (1 = preto) ──
  // Retorna { cols, rows, linhas: [Uint8Array por linha] }
  imagemDoCanvas(canvas, limiar = 128) {
    const ctx = canvas.getContext('2d');
    const { width: cols, height: rows } = canvas;
    const px = ctx.getImageData(0, 0, cols, rows).data;
    const bytesPorLinha = Math.ceil(cols / 8);
    const linhas = [];
    for (let y = 0; y < rows; y++) {
      const linha = new Uint8Array(bytesPorLinha);
      for (let x = 0; x < cols; x++) {
        const i = (y * cols + x) * 4;
        // luminância; alfa 0 conta como branco
        const lum = px[i + 3] < 32 ? 255
          : 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        if (lum < limiar) linha[x >> 3] |= 0x80 >> (x & 7);   // MSB primeiro
      }
      linhas.push(linha);
    }
    return { cols, rows, linhas };
  }

  contarBits(linha) {
    let n = 0;
    for (const b of linha) { let v = b; while (v) { n += v & 1; v >>= 1; } }
    return n;
  }

  // ── Impressão (sequência do B1 e modelos de 2024+) ──
  // Contagem de pixels pretos do header 0x85, formato do niimbluelib:
  // se a linha cabe em 3 terços do cabeçote, conta por terço (1 byte cada);
  // senão devolve [0, total&0xff, total>>8].
  contagemPretos(linha) {
    const chunk = Math.floor(this.modelo.cabecote / 8 / 3);
    const split = linha.length <= chunk * 3;
    let total = 0; const partes = [0, 0, 0];
    for (let i = 0; i < linha.length; i++) {
      let v = linha[i];
      const ci = Math.min(Math.floor(i / chunk), 2);
      while (v) { if (v & 1) { total++; if (split) partes[ci]++; } v >>= 1; }
    }
    if (split) return partes.map(x => Math.min(x, 255));
    return [0, total & 0xff, (total >> 8) & 0xff];
  }

  linhasIguais(a, b) {
    if (!b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  async imprimir(canvas, opcoes = {}) {
    const densidade = opcoes.densidade ?? 3;
    const tipoEtiqueta = opcoes.tipoEtiqueta ?? 1;    // 1 = com gap
    const copias = opcoes.copias ?? 1;
    const progresso = opcoes.progresso || (() => {});

    const img = this.imagemDoCanvas(canvas, opcoes.limiar);
    if (img.cols > this.modelo.cabecote)
      throw new Error(
        `A imagem tem ${img.cols} px de largura e o cabeçote da ${this.modelo.nome} ` +
        `imprime até ${this.modelo.cabecote} px (${Math.round(this.modelo.cabecote /
        this.modelo.dpi * 25.4)} mm). Gire a etiqueta ou reduza a largura.`);

    NiimbotWeb.log = [];
    NiimbotWeb.registrar('início',
      `${canvas.width}x${canvas.height} px · ${img.cols}x${img.rows} imagem`);

    // resposta em hex de cada comando: é o que diz se a impressora ACEITOU
    const hx = d => [...d].map(b => b.toString(16).padStart(2, '0')).join(' ');

    const v4 = !!this.modelo.v4;
    NiimbotWeb.registrar('protocolo', v4
      ? 'V4 (D110M_V4 — exigido pela ' + this.modelo.nome + ', mapa niimbluelib)'
      : 'clássico B1');

    progresso('preparando…');
    let r = await this.enviarEsperar(CMD.SetDensity, [densidade], 0x31);
    NiimbotWeb.registrar('resposta', `SetDensity(${densidade}) -> ${hx(r)}`);
    r = await this.enviarEsperar(CMD.SetLabelType, [tipoEtiqueta], 0x33);
    NiimbotWeb.registrar('resposta', `SetLabelType(${tipoEtiqueta}) -> ${hx(r)}`);

    if (v4) {
      // PrintStart de 9 bytes: totalPages(u16) + 4 zeros + cor + velocidade + flag
      r = await this.enviarEsperar(CMD.PrintStart,
        [...this.u16(copias), 0, 0, 0, 0, 0, 1, 0], 0x02);
      NiimbotWeb.registrar('resposta', `PrintStart 9B (copias=${copias}) -> ${hx(r)}`);
      // A impressora DESCARTA o 1º pacote após o PrintStart no Bluetooth:
      // manda um PrintStatus sacrificável, sem esperar resposta (quirk oficial)
      await this.enviar(CMD.PrintStatus, [1]);
      NiimbotWeb.registrar('v4', 'PrintStatus descartável enviado (sem esperar)');
      // V4 NÃO tem PageStart. SetPageSize de 13 bytes:
      // rows, cols, copies, cutHeight(u16)=0, cutType=0, 0x00, sendAll=0, partHeight(u16)=0
      NiimbotWeb.registrar('página',
        `SetPageSize 13B: rows=${img.rows} cols=${img.cols} copias=${copias}`);
      r = await this.enviarEsperar(CMD.SetPageSize,
        [...this.u16(img.rows), ...this.u16(img.cols), ...this.u16(copias),
         0, 0, 0, 0, 0, 0, 0], 0x14);
      NiimbotWeb.registrar('resposta', `SetPageSize 13B -> ${hx(r)}`);
    } else {
      // PrintStart de 7 bytes (B1 clássica): totalPages(u16) + 4 zeros + cor
      r = await this.enviarEsperar(CMD.PrintStart,
        [...this.u16(copias), 0, 0, 0, 0, 0], 0x02);
      NiimbotWeb.registrar('resposta', `PrintStart(copias=${copias}) -> ${hx(r)}`);
      r = await this.enviarEsperar(CMD.PageStart, [1], 0x04);
      NiimbotWeb.registrar('resposta', `PageStart -> ${hx(r)}`);
      NiimbotWeb.registrar('página',
        `SetPageSize: rows=${img.rows} cols=${img.cols} copias=${copias}`);
      r = await this.enviarEsperar(CMD.SetPageSize,
        [...this.u16(img.rows), ...this.u16(img.cols), ...this.u16(copias)], 0x14);
      NiimbotWeb.registrar('resposta', `SetPageSize -> ${hx(r)}`);
    }

    progresso('enviando a imagem…');
    // LINHA POR LINHA, repeat=1, SEM agrupamento — byte a byte idêntico aos
    // testes T19/T20 que imprimiram no papel (08/08/2026). O agrupamento de
    // linhas idênticas (repeat>1) entrou no v5 e é suspeito de derrubar o
    // job nesta firmware; não reintroduzir sem validar na página de teste.
    let linhasComTinta = 0, pontosPretos = 0;
    for (let y = 0; y < img.rows; y++) {
      const linha = img.linhas[y];
      const pretos = this.contarBits(linha);
      if (pretos === 0) {
        await this.enviar(CMD.PrintEmptyRow, [...this.u16(y), 1]);
      } else {
        linhasComTinta++; pontosPretos += pretos;
        const cont = v4 ? this.contagemPretos(linha) : [0, 0, 0];
        await this.enviar(CMD.PrintBitmapRow,
          [...this.u16(y), ...cont, 1, ...linha]);
      }
      if (y % 40 === 0) {
        progresso(`enviando a imagem… ${Math.round(100 * y / img.rows)}%`);
        await new Promise(r => setTimeout(r, 6));   // fôlego para o buffer BLE
      }
    }
    NiimbotWeb.registrar('imagem',
      `${linhasComTinta} de ${img.rows} linhas com conteúdo · ${pontosPretos} pontos pretos`);
    if (linhasComTinta === 0)
      NiimbotWeb.registrar('ALERTA', 'NENHUMA linha tinha conteúdo — a imagem foi ao Bluetooth EM BRANCO');

    r = await this.enviarEsperar(CMD.PageEnd, [1], 0xe4, 8000);
    NiimbotWeb.registrar('resposta', `PageEnd -> ${hx(r)}`);

    progresso('imprimindo…');
    // aguarda a impressão terminar consultando o status
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 500));
      try {
        const st = await this.enviarEsperar(CMD.PrintStatus, [1], 0xb3, 1500);
        NiimbotWeb.registrar('status',
          `após ${(i + 1) * 0.5}s -> ${hx(st)} (byte0=página, byte2/3=progresso)`);
        break;
      } catch (e) { /* ainda imprimindo */ }
    }
    try {
      const rf = await this.enviarEsperar(CMD.PrintEnd, [1], 0xf4, 5000);
      NiimbotWeb.registrar('resposta', `PrintEnd -> ${hx(rf)}`);
    } catch (e) { NiimbotWeb.registrar('ALERTA', 'PrintEnd SEM RESPOSTA'); }
    if (v4) {
      // a impressora descarta o 1º pacote após o PrintEnd — heartbeat
      // sacrificável, sem esperar resposta (quirk oficial do V4)
      try { await this.enviar(CMD.Heartbeat, [1]); } catch (e) {}
      NiimbotWeb.registrar('v4', 'Heartbeat descartável enviado');
    }
    NiimbotWeb.registrar('fim', 'concluído');
    progresso('pronto');
  }
}

// Exposto globalmente para o app.js
if (typeof window !== 'undefined') {
  window.NiimbotWeb = NiimbotWeb;
  window.NB_MODELOS_INFO = Object.fromEntries(
    Object.entries(NB_MODELOS).map(([k, v]) => [k, v.cabecote]));
  window.NB_MODELOS_FULL = NB_MODELOS;
}
