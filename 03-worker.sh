#!/bin/bash
# ══ PESQUISA DO TSCERT — parte 3: worker ══
# Envio dos convites, rotina automática a cada N dias e alerta de detrator.
set -e
cd /root/cert-saas
python3 - <<'PY'
import re
p = 'src/Worker/Program.cs'
s = open(p, encoding='utf-8').read()
if 'PsaasEnviar' in s:
    print('Worker: JA APLICADO'); raise SystemExit

# descobre as linhas de conexão e urlBase do próprio código
mc = re.search(r'await using var conn = await db\.OpenConnectionAsync\(\);', s)
assert mc, 'conn?'
CONN = mc.group(0)
mu = re.search(r'var urlBase = [^;\n]+;', s)
URLBASE = mu.group(0) if mu else 'var urlBase = cfg["App:UrlBase"] ?? "https://certificados.totalscale.com.br";'

# 1) dispatcher
v = '                else if (tipo == "email_convite")'
assert v in s and s.count(v) == 1, 'ANCORA dispatcher'
s = s.replace(v, '''                else if (tipo == "psaas_enviar")
                    await PsaasEnviar(t);
                else if (tipo == "psaas_alerta_detrator")
                    await PsaasAlertaDetrator(t);
''' + v)

# 2) métodos
v = '    async Task ExpurgarLogAntigo()'
assert v in s and s.count(v) == 1, 'ANCORA metodos'
metodos = '''    // ══ PESQUISA DO TSCERT (produto) — João, 12/08/2026 ══════════
    // Convite personalizado por papel; envio manual (lista) e automático
    // (a cada N dias, só para quem usou o sistema recentemente).
    async Task PsaasEnviar(JsonElement t)
    {
        ''' + CONN + '''
        var ids = t.GetProperty("usuarios").EnumerateArray()
            .Select(x => Guid.Parse(x.GetString()!)).ToList();
        var modo = t.TryGetProperty("modo", out var m) ? m.GetString() ?? "manual" : "manual";
        ''' + URLBASE + '''
        var cfg2 = await conn.QuerySingleOrDefaultAsync(
            "SELECT convite_titulo, convite_texto FROM psaas_config WHERE id");
        var titulo = (string?)cfg2?.convite_titulo;
        var textoCfg = (string?)cfg2?.convite_texto;
        var rEmail = redis.GetDatabase();
        int n = 0;
        foreach (var uid in ids)
        {
            try
            {
                var e = await conn.QuerySingleOrDefaultAsync(
                    "SELECT * FROM psaas_criar_envio(@u, @m)", new { u = uid, m = modo });
                if (e is null) continue;
                string nome = e.nome, email = e.email, papel = e.papel, empresa = e.empresa;
                var papelTxt = papel switch {
                    "admin" => "administrador",
                    "responsavel_tecnico" => "responsável técnico",
                    _ => "técnico" };
                var link = $"{urlBase.TrimEnd('/')}/pesquisa-tscert/{e.token}";
                var assunto = string.IsNullOrWhiteSpace(titulo)
                    ? "Sua opinião sobre o TSCert (2 minutos)" : titulo;
                var corpoTexto = string.IsNullOrWhiteSpace(textoCfg)
                    ? $"Você usa o TSCert no dia a dia como <b>{papelTxt}</b> — e é exatamente por isso "
                      + "que sua opinião vale tanto para nós.<br><br>São poucas perguntas e leva menos de "
                      + "<b>2 minutos</b>. Suas respostas vão direto para quem desenvolve o sistema."
                    : System.Net.WebUtility.HtmlEncode(textoCfg).Replace("\\n", "<br>");
                var html =
                    "<div style=\\"background:#eef2f6;padding:26px 10px;font-family:Arial,Helvetica,sans-serif\\">" +
                    "<table role=\\"presentation\\" width=\\"100%\\" cellpadding=\\"0\\" cellspacing=\\"0\\" style=\\"max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden\\">" +
                    "<tr><td style=\\"background:#164066;padding:20px 26px\\">" +
                    "<span style=\\"color:#fff;font-size:19px;font-weight:bold\\">TSCert</span><br>" +
                    "<span style=\\"color:#b9cbdc;font-size:12.5px\\">Sua opinião sobre o sistema</span></td></tr>" +
                    "<tr><td style=\\"padding:24px 26px\\">" +
                    $"<p style=\\"margin:0 0 12px;font-size:14px;color:#16202c\\">Olá, <b>{System.Net.WebUtility.HtmlEncode(nome)}</b>,</p>" +
                    $"<p style=\\"margin:0 0 16px;font-size:14px;color:#16202c;line-height:1.55\\">{corpoTexto}</p>" +
                    "<p style=\\"text-align:center;margin:20px 0\\">" +
                    $"<a href=\\"{link}\\" style=\\"background:#164066;color:#fff;text-decoration:none;padding:12px 26px;border-radius:8px;font-size:14px;display:inline-block\\">Responder a pesquisa</a></p>" +
                    "<p style=\\"margin:0;font-size:11.5px;color:#8ba0b5\\">O link é pessoal e não pede senha. " +
                    "Se preferir não responder, é só ignorar este e-mail.</p></td></tr>" +
                    "<tr><td style=\\"background:#f4f7fa;padding:12px 26px;font-size:11px;color:#8ba0b5;border-top:1px solid #e8edf2\\">" +
                    "TSCert — Total Scale · certificados.totalscale.com.br</td></tr>" +
                    "</table></div>";
                await EnfileirarEmail(rEmail, email, nome, assunto, html, "psaas_convite", null, null);
                n++;
            }
            catch (Exception ex) { log.LogWarning(ex, "Pesquisa TSCert: falha ao preparar envio para {U}", uid); }
        }
        log.LogInformation("Pesquisa TSCert ({Modo}): {Qtd} convite(s) enfileirado(s).", modo, n);
    }

    // Alerta imediato quando alguém responde como detrator (nota <= 6)
    async Task PsaasAlertaDetrator(JsonElement t)
    {
        ''' + CONN + '''
        var destino = await conn.ExecuteScalarAsync<string?>(
            "SELECT alerta_email FROM psaas_config WHERE id");
        if (string.IsNullOrWhiteSpace(destino))
        {
            var sa = (await SuperAdmins(conn)).FirstOrDefault();
            destino = sa.Email;
        }
        if (string.IsNullOrWhiteSpace(destino)) return;
        var nome = t.TryGetProperty("nome", out var n1) ? n1.GetString() : "(usuário)";
        var empresa = t.TryGetProperty("empresa", out var e1) ? e1.GetString() : "";
        var papel = t.TryGetProperty("papel", out var p1) ? p1.GetString() : "";
        var nota = t.TryGetProperty("nota", out var nt) ? nt.GetInt32() : 0;
        var html =
            "<div style=\\"font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#16202c\\">" +
            $"<p><b>Atenção:</b> nota <b style=\\"color:#b02a37;font-size:18px\\">{nota}</b> na pesquisa do TSCert.</p>" +
            $"<p><b>{System.Net.WebUtility.HtmlEncode(nome ?? "")}</b> ({papel}) — {System.Net.WebUtility.HtmlEncode(empresa ?? "")}</p>" +
            "<p>Vale ligar hoje: detrator recuperado costuma virar o cliente mais fiel. " +
            "Veja as respostas completas no painel, em <b>Pesquisa do TSCert</b>.</p></div>";
        await EnviarEmailSimples(destino!, "Super Admin",
            $"Pesquisa TSCert: nota {nota} de {empresa}", html, "psaas_alerta");
        log.LogWarning("Pesquisa TSCert: DETRATOR nota {N} — {Nome} / {Emp}", nota, nome, empresa);
    }

''' + v
s = s.replace(v, metodos)

# 3) rotina automática (junto das demais rotinas diárias)
v3 = '''        // 3.6) Pesquisas de satisfação periódicas'''
assert v3 in s, 'ANCORA rotina'
rotina = '''        // 3.55) Pesquisa do TSCERT (produto) — automática por usuário
        try
        {
            var cfgP = await conn.QuerySingleOrDefaultAsync(
                "SELECT ativo, freq_dias, dias_ativo FROM psaas_config WHERE id");
            if (cfgP is not null && (bool)cfgP.ativo)
            {
                var alvos = (await conn.QueryAsync<Guid>("""
                    SELECT u.usuario_id FROM psaas_usuarios_alvo() u
                     WHERE u.visto_em > now() - make_interval(days => @diasAtivo)
                       AND (u.ultimo_envio IS NULL
                            OR u.ultimo_envio < now() - make_interval(days => @freq))
                     LIMIT 50
                    """, new { diasAtivo = (int)cfgP.dias_ativo, freq = (int)cfgP.freq_dias })).ToList();
                if (alvos.Count > 0)
                {
                    var el = System.Text.Json.JsonSerializer.SerializeToElement(new {
                        usuarios = alvos.Select(a => a.ToString()).ToArray(), modo = "automatico" });
                    await PsaasEnviar(el);
                }
            }
        }
        catch (Exception ex) { log.LogWarning(ex, "Pesquisa TSCert automática falhou."); }

''' + v3
s = s.replace(v3, rotina, 1)
open(p, 'w', encoding='utf-8').write(s)
print('Worker: APLICADO')
PY
echo
docker compose up -d --build worker && ./backup-projeto.sh
