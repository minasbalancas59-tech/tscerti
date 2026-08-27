using System.IdentityModel.Tokens.Jwt;
using CertSaas.Api.Infra;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Amazon.S3;
using Dapper;
using Microsoft.IdentityModel.Tokens;
using Npgsql;
using StackExchange.Redis;

namespace CertSaas.Api.Portal;

public record PortalCadastroRequest(string Documento, string Email, string Nome, string Senha);
public record PortalLoginRequest(string Email, string Senha);
public record PortalValidarRequest(string Token);
public record PortalConviteRequest(string Token, string Senha, string? Nome);
public record ConviteVariosRequest(string[] Emails);
public record VerDocumentoRequest(string Documento);
public record SolicitarCalibracaoRequest(string[]? Balancas, string? Mensagem);

/// <summary>
/// Portal do cliente final: login próprio (separado dos usuários das
/// empresas) para baixar os certificados emitidos para o seu documento
/// (CNPJ/CPF), em qualquer empresa, e os certificados dos pesos-padrão
/// usados. Autocadastro seguro: só com e-mail já constante no cadastro
/// de um cliente (prova o vínculo). Todo acesso a dados é mediado por
/// funções SECURITY DEFINER que filtram pelo documento autenticado.
/// </summary>
public static class ClientePortalEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/portal");

        // ── Cadastro (Opção B): exige e-mail já cadastrado por uma empresa ──
        g.MapPost("/cadastro", async (PortalCadastroRequest req, NpgsqlDataSource ds,
            IConnectionMultiplexer redis, HttpContext ctx) =>
        {
            if (string.IsNullOrWhiteSpace(req.Email) || string.IsNullOrWhiteSpace(req.Senha)
                || string.IsNullOrWhiteSpace(req.Documento))
                return Results.BadRequest(new { erro = "Documento, e-mail e senha são obrigatórios." });
            if (req.Senha.Length < 8)
                return Results.BadRequest(new { erro = "A senha deve ter ao menos 8 caracteres." });

            await using var conn = await ds.OpenConnectionAsync();

            // Já existe acesso com este e-mail?
            var existe = await conn.QuerySingleOrDefaultAsync<string?>(
                "SELECT email FROM cliente_acesso WHERE lower(email) = lower(@e)",
                new { e = req.Email });
            if (existe is not null)
                return Results.Conflict(new { erro = "Já existe um acesso com este e-mail." });

            // Opção B: o e-mail + documento precisam bater com um cliente cadastrado
            var doc = await conn.ExecuteScalarAsync<string?>(
                "SELECT cliente_pode_cadastrar(@e, @d)",
                new { e = req.Email, d = req.Documento });
            if (string.IsNullOrEmpty(doc))
                return Results.BadRequest(new
                {
                    erro = "Não encontramos este e-mail vinculado a este documento em nenhuma " +
                           "empresa. Peça à empresa que emitiu seu certificado para cadastrar " +
                           "seu e-mail, ou confira os dados."
                });

            // O portal é recurso dos planos Profissional/Enterprise: só segue
            // se alguma empresa vinculada a este e-mail/documento o tiver ativo
            var disponivel = await conn.ExecuteScalarAsync<bool>(
                "SELECT cliente_portal_disponivel(@e, @d)",
                new { e = req.Email, d = req.Documento });
            if (!disponivel)
                return Results.BadRequest(new
                {
                    erro = "A empresa que emitiu seu certificado ainda não disponibiliza o " +
                           "portal de clientes. Fale com ela para receber seus certificados."
                });

            var hash = BCrypt.Net.BCrypt.HashPassword(req.Senha);
            var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(24));
            var id = await conn.ExecuteScalarAsync<Guid>(
                "SELECT cliente_criar_acesso(@d, @e, @n, @h, @t)",
                new { d = doc, e = req.Email, n = req.Nome, h = hash, t = token });

            await conn.ExecuteAsync("SELECT cliente_log(@id, @d, @e, 'cadastro', @det, @ip)",
                new { id, d = doc, e = req.Email, det = "autocadastro",
                      ip = Ip(ctx) });

            // envia e-mail de validação pela fila do worker
            await redis.GetDatabase().ListLeftPushAsync("fila:tarefas",
                $"{{\"tipo\":\"email_portal_validacao\",\"acesso_id\":\"{id}\"," +
                $"\"email\":\"{req.Email}\",\"token\":\"{token}\"}}");

            return Results.Ok(new { ok = true,
                mensagem = "Cadastro criado. Enviamos um e-mail para você confirmar o acesso." });
        });

        // ── Convite: dados da tela (público, pelo token) ──────────
        g.MapGet("/convite/{token}", async (string token, NpgsqlDataSource ds) =>
        {
            await using var conn = await ds.OpenConnectionAsync();
            var c = await conn.QuerySingleOrDefaultAsync(
                "SELECT * FROM cliente_convite_ver(@t)", new { t = token });
            if (c is null) return Results.NotFound(new { erro = "Convite não encontrado." });
            return Results.Ok(new
            {
                email = (string)c.email,
                nome = (string?)c.nome,
                documento = (string)c.documento,
                empresa = (string?)c.empresa,
                valido = (bool)c.valido,
                jaTemAcesso = (bool)c.ja_tem_acesso
            });
        });

        // ── Convite: definir a senha e ativar o acesso (público) ───
        g.MapPost("/convite", async (PortalConviteRequest req, NpgsqlDataSource ds,
            IConnectionMultiplexer redis, HttpContext ctx) =>
        {
            if (string.IsNullOrWhiteSpace(req.Token) || string.IsNullOrWhiteSpace(req.Senha))
                return Results.BadRequest(new { erro = "Informe a senha." });
            if (req.Senha.Length < 8)
                return Results.BadRequest(new { erro = "A senha deve ter ao menos 8 caracteres." });

            await using var conn = await ds.OpenConnectionAsync();
            var hash = BCrypt.Net.BCrypt.HashPassword(req.Senha);
            var r = await conn.QuerySingleAsync(
                "SELECT * FROM cliente_convite_usar(@t, @h, @n)",
                new { t = req.Token, h = hash, n = req.Nome });
            if (!(bool)r.ok) return Results.BadRequest(new { erro = (string)r.erro });

            var email = (string)r.email;
            await conn.ExecuteAsync(
                "SELECT cliente_log(NULL, NULL, @e, 'cadastro', 'convite da empresa', @ip)",
                new { e = email, ip = Ip(ctx) });

            // e-mail de boas-vindas com o endereço do portal e o login
            await redis.GetDatabase().ListLeftPushAsync("fila:tarefas",
                $"{{\"tipo\":\"email_portal_boasvindas\",\"email\":\"{email}\"}}");

            return Results.Ok(new { ok = true,
                mensagem = "Acesso criado! Você já pode entrar com seu e-mail e a senha que acabou de definir." });
        });

        // ── Esqueci minha senha: pedir o link (público) ──────────
        g.MapPost("/senha/solicitar", async (PortalValidarRequest req, NpgsqlDataSource ds,
            IConnectionMultiplexer redis, HttpContext ctx) =>
        {
            var email = (req.Token ?? "").Trim();     // record de campo único
            if (email.Length < 5 || !email.Contains('@'))
                return Results.BadRequest(new { erro = "Informe um e-mail válido." });

            await using var conn = await ds.OpenConnectionAsync();
            var r = await conn.QuerySingleOrDefaultAsync(
                "SELECT * FROM cliente_reset_criar(@e)", new { e = email });
            if (r is not null)
            {
                await redis.GetDatabase().ListLeftPushAsync("fila:tarefas",
                    $"{{\"tipo\":\"email_portal_senha\",\"email\":\"{email}\"," +
                    $"\"nome\":\"{(string?)r.nome}\",\"token\":\"{(string)r.token}\"}}");
                await conn.ExecuteAsync(
                    "SELECT cliente_log(NULL, NULL, @e, 'reset_senha', 'link solicitado', @ip)",
                    new { e = email, ip = Ip(ctx) });
            }
            else
            {
                // registra a tentativa (ajuda no suporte), mas responde igual
                await conn.ExecuteAsync(
                    "SELECT cliente_log(NULL, NULL, @e, 'reset_senha', " +
                    "'solicitado para e-mail sem conta ativa', @ip)",
                    new { e = email, ip = Ip(ctx) });
            }
            return Results.Ok(new
            {
                ok = true,
                mensagem = "Se existir uma conta com este e-mail, o link para criar uma nova " +
                           "senha acabou de ser enviado. Ele vale por 1 hora — verifique também o spam."
            });
        });

        // ── Dados da tela de nova senha ──────────────────────────
        g.MapGet("/senha/{token}", async (string token, NpgsqlDataSource ds) =>
        {
            await using var conn = await ds.OpenConnectionAsync();
            var r = await conn.QuerySingleOrDefaultAsync(
                "SELECT * FROM cliente_reset_ver(@t)", new { t = token });
            if (r is null) return Results.NotFound(new { erro = "Link não encontrado." });
            return Results.Ok(new
            {
                email = (string)r.email,
                nome = (string?)r.nome,
                valido = (bool)r.valido
            });
        });

        // ── Definir a nova senha ─────────────────────────────────
        g.MapPost("/senha", async (PortalConviteRequest req, NpgsqlDataSource ds,
            HttpContext ctx) =>
        {
            if (string.IsNullOrWhiteSpace(req.Token) || string.IsNullOrWhiteSpace(req.Senha))
                return Results.BadRequest(new { erro = "Informe a nova senha." });
            if (req.Senha.Length < 8)
                return Results.BadRequest(new { erro = "A senha deve ter ao menos 8 caracteres." });

            await using var conn = await ds.OpenConnectionAsync();
            var hash = BCrypt.Net.BCrypt.HashPassword(req.Senha);
            var r = await conn.QuerySingleAsync(
                "SELECT * FROM cliente_reset_usar(@t, @h)", new { t = req.Token, h = hash });
            if (!(bool)r.ok) return Results.BadRequest(new { erro = (string)r.erro });

            await conn.ExecuteAsync(
                "SELECT cliente_log(NULL, NULL, @e, 'reset_senha', 'senha alterada', @ip)",
                new { e = (string)r.email, ip = Ip(ctx) });
            return Results.Ok(new
            {
                ok = true, email = (string)r.email,
                mensagem = "Senha alterada! Você já pode entrar com ela."
            });
        });

        // ── Reenviar o link de validação (público, sem revelar cadastro) ──
        g.MapPost("/reenviar-validacao", async (PortalValidarRequest req, NpgsqlDataSource ds,
            IConnectionMultiplexer redis, HttpContext ctx) =>
        {
            var email = (req.Token ?? "").Trim();   // reaproveita o record: campo único
            if (email.Length < 5 || !email.Contains('@'))
                return Results.BadRequest(new { erro = "Informe um e-mail válido." });
            await using var conn = await ds.OpenConnectionAsync();
            var token = await conn.ExecuteScalarAsync<string?>(
                "SELECT cliente_novo_token_validacao(@e)", new { e = email });
            if (token is not null)
            {
                await redis.GetDatabase().ListLeftPushAsync("fila:tarefas",
                    $"{{\"tipo\":\"email_portal_validacao\",\"email\":\"{email}\"," +
                    $"\"token\":\"{token}\"}}");
                await conn.ExecuteAsync(
                    "SELECT cliente_log(NULL, NULL, @e, 'validacao', 'link reenviado', @ip)",
                    new { e = email, ip = Ip(ctx) });
            }
            // resposta igual nos dois casos: não revela quem tem cadastro
            return Results.Ok(new { ok = true,
                mensagem = "Se existir um acesso com este e-mail aguardando confirmação, " +
                           "o link acabou de ser reenviado. Verifique também o spam." });
        });

        // ── Validar e-mail pelo token ──
        g.MapPost("/validar-email", async (PortalValidarRequest req, NpgsqlDataSource ds,
            HttpContext ctx) =>
        {
            await using var conn = await ds.OpenConnectionAsync();
            var ok = await conn.ExecuteScalarAsync<bool>(
                "SELECT cliente_validar_email(@t)", new { t = req.Token });
            if (!ok) return Results.BadRequest(new { erro = "Link inválido ou expirado." });
            await conn.ExecuteAsync(
                "SELECT cliente_log(NULL, NULL, NULL, 'validacao', 'email confirmado', @ip)",
                new { ip = Ip(ctx) });
            return Results.Ok(new { ok = true, mensagem = "E-mail confirmado. Você já pode entrar." });
        });

        // ── Login do cliente final ──
        g.MapPost("/login", async (PortalLoginRequest req, NpgsqlDataSource ds,
            IConfiguration cfg, HttpContext ctx) =>
        {
            await using var conn = await ds.OpenConnectionAsync();
            var a = await conn.QuerySingleOrDefaultAsync(
                "SELECT * FROM cliente_buscar_acesso(@e)", new { e = req.Email });

            // Toda falha é registrada COM O MOTIVO — sem isso, ninguém consegue
            // ajudar o cliente que liga dizendo "não entro".
            if (a is null)
            {
                await conn.ExecuteAsync(
                    "SELECT cliente_log(NULL, NULL, @e, 'login_falha', 'e-mail sem acesso criado', @ip)",
                    new { e = req.Email, ip = Ip(ctx) });
                return Results.Json(new
                {
                    erro = "Ainda não existe acesso para este e-mail.",
                    detalhe = "Se você recebeu um convite, use o link do e-mail para criar sua senha. " +
                              "Se não recebeu, peça o convite à empresa que calibra suas balanças.",
                    codigo = "sem_acesso"
                }, statusCode: 401);
            }
            if (!BCrypt.Net.BCrypt.Verify(req.Senha, (string)a.senha_hash))
            {
                await conn.ExecuteAsync(
                    "SELECT cliente_log(@id, @d, @e, 'login_falha', 'senha incorreta', @ip)",
                    new { id = (Guid)a.id, d = (string)a.documento, e = req.Email, ip = Ip(ctx) });
                return Results.Json(new
                {
                    erro = "Senha incorreta.",
                    detalhe = "Se não lembra a senha, use “Esqueci minha senha” abaixo.",
                    codigo = "senha"
                }, statusCode: 401);
            }
            if (!(bool)a.ativo)
            {
                await conn.ExecuteAsync(
                    "SELECT cliente_log(@id, @d, @e, 'login_falha', 'acesso desativado', @ip)",
                    new { id = (Guid)a.id, d = (string)a.documento, e = req.Email, ip = Ip(ctx) });
                return Results.Json(new
                {
                    erro = "Este acesso está desativado.",
                    detalhe = "Fale com a empresa que calibra suas balanças para reativar.",
                    codigo = "desativado"
                }, statusCode: 403);
            }
            if (!(bool)a.email_validado)
            {
                await conn.ExecuteAsync(
                    "SELECT cliente_log(@id, @d, @e, 'login_falha', 'e-mail nao validado', @ip)",
                    new { id = (Guid)a.id, d = (string)a.documento, e = req.Email, ip = Ip(ctx) });
                return Results.Json(new
                {
                    erro = "Falta confirmar seu e-mail.",
                    detalhe = "Enviamos um link de confirmação quando o acesso foi criado. " +
                              "Não achou? Clique abaixo que reenviamos agora.",
                    codigo = "nao_validado"
                }, statusCode: 403);
            }

            var id = (Guid)a.id;
            var doc = (string)a.documento;
            await conn.ExecuteAsync("SELECT cliente_marcar_acesso(@id)", new { id });
            await conn.ExecuteAsync("SELECT cliente_log(@id, @d, @e, 'login', NULL, @ip)",
                new { id, d = doc, e = req.Email, ip = Ip(ctx) });

            var token = GerarToken(cfg, id, doc, (string?)a.nome ?? "Cliente", (string)a.email);
            return Results.Ok(new { token, nome = (string?)a.nome, documento = doc });
        });

        // ════════ LADO DA EMPRESA: convidar cliente ao portal ════════
        var emp = app.MapGroup("/api/portal-convites").RequireAuthorization();

        // Contatos do cliente que podem receber o convite (principal + cadastrados)
        emp.MapGet("/{clienteId:guid}/contatos", async (Guid clienteId,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            var papel0 = Tenant.Papel(user);
            if (papel0 is not ("admin" or "responsavel_tecnico")) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            return Results.Ok(await conn.QueryAsync(
                "SELECT * FROM cliente_contatos_portal(@cli)", new { cli = clienteId }));
        });

        // Histórico dos convites deste cliente (com link para reenviar)
        emp.MapGet("/{clienteId:guid}/historico", async (Guid clienteId,
            ClaimsPrincipal user, NpgsqlDataSource ds, IConfiguration cfg) =>
        {
            var papelH = Tenant.Papel(user);
            if (papelH is not ("admin" or "responsavel_tecnico")) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var baseUrl = cfg["App:PortalUrl"] ?? "https://portalclientes.totalscale.com.br";
            var rows = (await conn.QueryAsync(
                "SELECT * FROM cliente_convites_historico(@cli)", new { cli = clienteId })).ToList();
            return Results.Ok(rows.Select(r => new
            {
                id = (Guid)r.id,
                email = (string)r.email,
                nome = (string?)r.nome_contato,
                criado_em = (DateTime)r.criado_em,
                expira_em = (DateTime)r.expira_em,
                usado_em = (DateTime?)r.usado_em,
                por = (string?)r.criado_por_nome,
                situacao = (string)r.situacao,
                email_status = (string?)r.email_status,
                email_em = (DateTime?)r.email_em,
                email_erro = (string?)r.email_erro,
                ja_tem_acesso = (bool)r.ja_tem_acesso,
                // link só faz sentido enquanto o convite vale
                link = (string)r.situacao == "pendente"
                    ? $"{baseUrl}/portal.html?convite={(string)r.token}" : null
            }));
        });

        // Convida os e-mails escolhidos (um ou vários de uma vez)
        emp.MapPost("/{clienteId:guid}/varios", async (Guid clienteId, ConviteVariosRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds, IConnectionMultiplexer redis,
            IConfiguration cfg) =>
        {
            var papel1 = Tenant.Papel(user);
            if (papel1 is not ("admin" or "responsavel_tecnico")) return Results.Forbid();
            if (req.Emails is null || req.Emails.Length == 0)
                return Results.BadRequest(new { erro = "Selecione ao menos um contato." });

            await using var conn = await Tenant.AbrirConexao(ds, user);
            var temPortal = await conn.ExecuteScalarAsync<bool>(
                "SELECT portal_cliente_ativo FROM empresa WHERE id = current_empresa_id()");
            if (!temPortal)
                return Results.Json(new
                {
                    erro = "O Portal do Cliente está disponível a partir do plano Profissional. " +
                           "Fale com a Total Scale — (31) 3357-4000."
                }, statusCode: 403);

            var enviados = new List<object>();
            var ignorados = new List<object>();
            var fila = redis.GetDatabase();
            var baseUrlConv = cfg["App:PortalUrl"] ?? "https://portalclientes.totalscale.com.br";
            foreach (var email in req.Emails.Distinct())
            {
                try
                {
                    var c = await conn.QuerySingleAsync(
                        "SELECT * FROM cliente_convite_criar_para(@cli, @email, @usr)",
                        new { cli = clienteId, email, usr = Tenant.UsuarioId(user) });
                    if ((bool)c.ja_tem_acesso)
                    {
                        ignorados.Add(new { email, motivo = "já tem acesso ao portal" });
                        continue;
                    }
                    await fila.ListLeftPushAsync("fila:tarefas",
                        $"{{\"tipo\":\"email_portal_convite\",\"email\":\"{(string)c.email}\"," +
                        $"\"nome\":\"{(string?)c.nome}\",\"token\":\"{(string)c.token}\"}}");
                    enviados.Add(new
                    {
                        email = (string)c.email,
                        nome = (string?)c.nome,
                        link = $"{baseUrlConv}/portal.html?convite={(string)c.token}"
                    });
                }
                catch (PostgresException pe)
                {
                    // P0001 = RAISE EXCEPTION nosso (mensagem escrita para o
                    // usuário). Outros códigos são falha TÉCNICA: mostrar
                    // "column reference is ambiguous" ao usuário não ajuda —
                    // mas some do radar se ninguém registrar. Então grava no
                    // log de erros e SEGUE com os outros contatos do lote.
                    var tecnico = pe.SqlState != "P0001";
                    ignorados.Add(new
                    {
                        email,
                        motivo = tecnico
                            ? "erro interno ao gerar o convite — já registrado para análise"
                            : pe.MessageText
                    });
                    if (tecnico)
                    {
                        try
                        {
                            await conn.ExecuteAsync("""
                                INSERT INTO erro_sistema (tipo, metodo, rota, mensagem, detalhe)
                                VALUES ('PostgresException', 'POST',
                                        '/api/portal-convites/{id}/varios', @m, @d)
                                """,
                                new { m = $"{pe.SqlState}: {pe.MessageText}",
                                      d = $"e-mail: {email}\n{pe}" });
                        }
                        catch { /* não deixar o log derrubar o convite */ }
                    }
                }
            }
            return Results.Ok(new
            {
                enviados,
                ignorados,
                total = enviados.Count
            });
        });

        emp.MapPost("/{clienteId:guid}", async (Guid clienteId, ClaimsPrincipal user,
            NpgsqlDataSource ds, IConnectionMultiplexer redis) =>
        {
            var papel = Tenant.Papel(user);
            if (papel is not ("admin" or "responsavel_tecnico"))
                return Results.Forbid();

            await using var conn = await Tenant.AbrirConexao(ds, user);

            var temPortal = await conn.ExecuteScalarAsync<bool>(
                "SELECT portal_cliente_ativo FROM empresa WHERE id = current_empresa_id()");
            if (!temPortal)
                return Results.Json(new
                {
                    erro = "O Portal do Cliente está disponível a partir do plano Profissional. " +
                           "Com ele, seus clientes baixam os certificados quando quiserem, com a " +
                           "sua marca. Fale com a Total Scale — (31) 3357-4000."
                }, statusCode: 403);

            dynamic c;
            try
            {
                c = await conn.QuerySingleAsync(
                    "SELECT * FROM cliente_convite_criar(@cli, @usr)",
                    new { cli = clienteId, usr = Tenant.UsuarioId(user) });
            }
            catch (PostgresException pe)
            {
                return Results.BadRequest(new { erro = pe.MessageText });
            }

            if ((bool)c.ja_tem_acesso)
                return Results.BadRequest(new
                {
                    erro = "Este e-mail já tem acesso ao portal. Peça ao cliente para entrar " +
                           "com a senha dele ou usar \"Esqueci minha senha\"."
                });

            await redis.GetDatabase().ListLeftPushAsync("fila:tarefas",
                $"{{\"tipo\":\"email_portal_convite\",\"email\":\"{(string)c.email}\"," +
                $"\"nome\":\"{(string?)c.nome}\",\"token\":\"{(string)c.token}\"}}");

            return Results.Ok(new { enviado = true, email = (string)c.email });
        });

        // ════════ SUPER-ADMIN: ver o portal como o cliente ════════
        var sa = app.MapGroup("/api/sa/portal").RequireAuthorization();

        sa.MapPost("/ver-como/{acessoId:guid}", async (Guid acessoId, ClaimsPrincipal user,
            NpgsqlDataSource ds, IConfiguration cfg, HttpContext ctx) =>
        {
            if (Tenant.Papel(user) != "super_admin") return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            var a = await conn.QuerySingleOrDefaultAsync(
                "SELECT * FROM sa_portal_acesso(@id)", new { id = acessoId });
            if (a is null) return Results.NotFound(new { erro = "Acesso não encontrado." });

            // fica registrado: é acesso a dados de terceiro
            await Auditoria.Registrar(conn, null, Tenant.UsuarioId(user),
                "cliente_acesso", acessoId, "ver_portal_como_cliente",
                new { email = (string)a.email, documento = (string)a.documento },
                Auditoria.Ip(ctx));
            await conn.ExecuteAsync(
                "SELECT cliente_log(@id, @d, @e, 'visualizacao_sa', " +
                "'super-admin visualizou o portal', @ip)",
                new { id = acessoId, d = (string)a.documento, e = (string)a.email,
                      ip = Auditoria.Ip(ctx) });

            var token = GerarToken(cfg, acessoId, (string)a.documento,
                (string?)a.nome ?? "Cliente", (string)a.email);
            var baseUrl = cfg["App:PortalUrl"] ?? "https://portalclientes.totalscale.com.br";
            return Results.Ok(new
            {
                token,
                link = $"{baseUrl}/portal.html?ver={token}",
                email = (string)a.email,
                nome = (string?)a.nome,
                documento = (string)a.documento
            });
        });

        // Ver o portal de QUALQUER cliente cadastrado — mesmo sem conta criada.
        // Serve para conferir o que ele encontraria lá antes de convidar.
        sa.MapPost("/ver-cliente/{clienteId:guid}", async (Guid clienteId, ClaimsPrincipal user,
            NpgsqlDataSource ds, IConfiguration cfg, HttpContext ctx) =>
        {
            if (Tenant.Papel(user) != "super_admin") return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            var c = await conn.QuerySingleOrDefaultAsync(
                "SELECT * FROM sa_cliente_para_portal(@id)", new { id = clienteId });
            if (c is null) return Results.NotFound(new { erro = "Cliente não encontrado." });
            var doc = (string?)c.documento ?? "";
            if (doc.Length < 11)
                return Results.BadRequest(new
                {
                    erro = "Este cliente não tem CNPJ/CPF cadastrado — o portal identifica " +
                           "o cliente pelo documento, então não há o que mostrar."
                });

            await Auditoria.Registrar(conn, (Guid?)c.empresa_id, Tenant.UsuarioId(user),
                "cliente", clienteId, "ver_portal_do_cliente",
                new { cliente = (string)c.razao_social, documento = doc }, Auditoria.Ip(ctx));

            var token = GerarToken(cfg, clienteId, doc,
                (string)c.razao_social, (string?)c.email ?? "sem-email@portal");
            var baseUrl = cfg["App:PortalUrl"] ?? "https://portalclientes.totalscale.com.br";
            return Results.Ok(new
            {
                link = $"{baseUrl}/portal.html?ver={token}",
                cliente = (string)c.razao_social,
                documento = doc,
                certificados = (long)c.certificados,
                tem_acesso = (bool)c.tem_acesso
            });
        });

        // Lista de clientes finais por DOCUMENTO (filtro opcional por empresa)
        sa.MapGet("/clientes", async (Guid? empresa, ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (Tenant.Papel(user) != "super_admin") return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            return Results.Ok(await conn.QueryAsync(
                "SELECT * FROM sa_clientes_documento(@emp)", new { emp = empresa }));
        });

        // Abre o portal pelo DOCUMENTO — mostra tudo de todas as empresas
        sa.MapPost("/ver-documento", async (VerDocumentoRequest req, ClaimsPrincipal user,
            NpgsqlDataSource ds, IConfiguration cfg, HttpContext ctx) =>
        {
            if (Tenant.Papel(user) != "super_admin") return Results.Forbid();
            var doc = new string((req.Documento ?? "").Where(char.IsDigit).ToArray());
            if (doc.Length < 11)
                return Results.BadRequest(new { erro = "Documento inválido." });

            await using var conn = await ds.OpenConnectionAsync();
            var d = await conn.QuerySingleOrDefaultAsync(
                "SELECT * FROM sa_documento_para_portal(@doc)", new { doc });
            if (d is null || d.nome is null)
                return Results.NotFound(new { erro = "Nenhum cliente com este documento." });

            await Auditoria.Registrar(conn, null, Tenant.UsuarioId(user),
                "cliente", null, "ver_portal_do_cliente",
                new { documento = doc, cliente = (string)d.nome }, Auditoria.Ip(ctx));

            // token de VISUALIZAÇÃO: vida curta (30 min), o suficiente para conferir
            var token = GerarTokenCurto(cfg, doc, (string)d.nome);
            var baseUrl = cfg["App:PortalUrl"] ?? "https://portalclientes.totalscale.com.br";
            return Results.Ok(new
            {
                link = $"{baseUrl}/portal.html?ver={token}",
                cliente = (string)d.nome,
                empresas = (string?)d.empresas,
                certificados = (long)d.certificados,
                tem_acesso = (bool)d.tem_acesso
            });
        });

        // ── Meus certificados (unificado por documento) ──
        g.MapGet("/certificados", async (ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            var doc = DocDoCliente(user);
            if (doc is null) return Results.Unauthorized();
            await using var conn = await ds.OpenConnectionAsync();
            return Results.Ok(await conn.QueryAsync(
                "SELECT * FROM cliente_certificados(@d)", new { d = doc }));
        }).RequireAuthorization("portal");

        // ── Baixar TODOS os certificados vigentes num ZIP ───────
        // O momento em que isso salva o dia é a auditoria: o auditor pede
        // "os certificados de todas as balanças" e o cliente entrega um
        // arquivo só, com índice.
        g.MapGet("/certificados/zip", async (bool? pesos, ClaimsPrincipal user,
            NpgsqlDataSource ds, IConfiguration cfg, HttpContext ctx) =>
        {
            const int TETO = 60;                 // proteção contra cliente gigante
            var doc = DocDoCliente(user);
            if (doc is null) return Results.Unauthorized();
            var incluirPesos = pesos ?? false;

            await using var conn = await ds.OpenConnectionAsync();
            var certs = (await conn.QueryAsync(
                "SELECT * FROM cliente_certificados_vigentes(@d)", new { d = doc })).ToList();
            if (certs.Count == 0)
                return Results.NotFound(new { erro = "Nenhum certificado com PDF disponível." });

            var pesosList = incluirPesos
                ? (await conn.QueryAsync("SELECT * FROM cliente_pesos_pdf(@d)",
                    new { d = doc })).ToList()
                : new List<dynamic>();

            var total = certs.Count + pesosList.Count;
            var truncou = total > TETO;

            using var ms = new MemoryStream();
            var indice = new System.Text.StringBuilder();
            indice.AppendLine("CERTIFICADOS DE CALIBRACAO — RELACAO DO ARQUIVO");
            indice.AppendLine($"Gerado em {DateTime.Now:dd/MM/yyyy HH:mm}");
            indice.AppendLine(new string('=', 74));
            indice.AppendLine();
            indice.AppendLine("CERTIFICADOS DAS BALANCAS (vigente de cada uma)");
            indice.AppendLine(new string('-', 74));

            var incluidos = 0;
            using (var zip = new System.IO.Compression.ZipArchive(
                       ms, System.IO.Compression.ZipArchiveMode.Create, true))
            {
                foreach (var c in certs)
                {
                    if (incluidos >= TETO) break;
                    var bytes = await BytesS3((string)c.pdf_url, cfg);
                    var venc = c.vence_em is null ? "sem periodicidade"
                        : ((DateTime)c.vence_em).ToString("dd/MM/yyyy");
                    var situacao = c.vence_em is null ? ""
                        : ((DateTime)c.vence_em).Date < DateTime.Today ? "  [VENCIDO]" : "";
                    var nome = NomeArquivo((string?)c.balanca, (string?)c.numero) + ".pdf";

                    indice.AppendLine($"{(string?)c.balanca}");
                    indice.AppendLine($"   serie: {(string?)c.num_serie ?? "-"}");
                    indice.AppendLine($"   certificado: {(string?)c.numero}" +
                        $" | calibrada em {((DateTime?)c.data_calibracao)?.ToString("dd/MM/yyyy") ?? "-"}");
                    indice.AppendLine($"   valida ate: {venc}{situacao}");
                    indice.AppendLine($"   emitido por: {(string?)c.empresa}");
                    indice.AppendLine($"   arquivo: {(bytes is null ? "(PDF indisponivel)" : nome)}");
                    indice.AppendLine();

                    if (bytes is null) continue;
                    var e = zip.CreateEntry("certificados/" + nome,
                        System.IO.Compression.CompressionLevel.Fastest);
                    using var s = e.Open();
                    await s.WriteAsync(bytes);
                    incluidos++;
                }

                if (pesosList.Count > 0)
                {
                    indice.AppendLine();
                    indice.AppendLine("CERTIFICADOS DOS PESOS-PADRAO (rastreabilidade)");
                    indice.AppendLine(new string('-', 74));
                    foreach (var p in pesosList)
                    {
                        if (incluidos >= TETO) break;
                        var bytes = await BytesS3((string)p.pdf_url, cfg);
                        var nome = NomeArquivo("peso", (string?)p.identificacao,
                            (string?)p.num_certificado) + ".pdf";
                        indice.AppendLine($"{(string?)p.identificacao}" +
                            $" | cert. {(string?)p.num_certificado ?? "-"}" +
                            $" | validade {((DateTime?)p.validade)?.ToString("dd/MM/yyyy") ?? "-"}");
                        indice.AppendLine($"   arquivo: {(bytes is null ? "(PDF indisponivel)" : nome)}");
                        if (bytes is null) continue;
                        var e = zip.CreateEntry("pesos-padrao/" + nome,
                            System.IO.Compression.CompressionLevel.Fastest);
                        using var s = e.Open();
                        await s.WriteAsync(bytes);
                        incluidos++;
                    }
                }

                if (truncou)
                {
                    indice.AppendLine();
                    indice.AppendLine($"ATENCAO: o arquivo foi limitado a {TETO} documentos.");
                    indice.AppendLine("Baixe o restante pelo portal, balanca a balanca.");
                }
                indice.AppendLine();
                indice.AppendLine(new string('=', 74));
                indice.AppendLine("Autenticidade: cada certificado traz um QR Code que confirma");
                indice.AppendLine("a validade do documento online, sem necessidade de senha.");

                var ie = zip.CreateEntry("INDICE.txt",
                    System.IO.Compression.CompressionLevel.Fastest);
                using var iss = ie.Open();
                await iss.WriteAsync(System.Text.Encoding.UTF8.GetBytes(indice.ToString()));
            }

            await conn.ExecuteAsync(
                "SELECT cliente_log(NULL, @d, NULL, 'download', @det, @ip)",
                new { d = doc, det = $"lote zip: {incluidos} arquivo(s)", ip = Ip(ctx) });

            return Results.File(ms.ToArray(), "application/zip",
                $"certificados_{DateTime.Now:yyyy-MM-dd}.zip");
        }).RequireAuthorization("portal");

        // ── Solicitar calibração (o cliente pede a visita) ──────
        g.MapPost("/solicitar-calibracao", async (SolicitarCalibracaoRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds, IConnectionMultiplexer redis) =>
        {
            var doc = DocDoCliente(user);
            if (doc is null) return Results.Unauthorized();
            var quem = user.FindFirst("email")?.Value ?? "cliente";
            var balancas = req.Balancas is { Length: > 0 }
                ? string.Join(", ", req.Balancas.Take(30)) : null;

            await using var conn = await ds.OpenConnectionAsync();
            var criadas = (await conn.QueryAsync(
                "SELECT * FROM portal_solicitar_calibracao(@d, @q, @b, @m)",
                new { d = doc, q = quem, b = balancas, m = req.Mensagem })).ToList();
            if (criadas.Count == 0)
                return Results.BadRequest(new { erro = "Não encontramos a empresa que atende você." });

            var fila = redis.GetDatabase();
            foreach (var c in criadas)
                await fila.ListLeftPushAsync("fila:tarefas",
                    $"{{\"tipo\":\"email_solicitacao_calibracao\"," +
                    $"\"solicitacao_id\":\"{(Guid)c.solicitacao_id}\"}}");

            await conn.ExecuteAsync(
                "SELECT cliente_log(NULL, @d, @e, 'solicitacao', @det, NULL)",
                new { d = doc, e = quem,
                      det = "calibração solicitada" + (balancas is null ? "" : ": " + balancas) });

            return Results.Ok(new
            {
                ok = true,
                empresas = criadas.Select(c => (string)c.empresa).ToArray(),
                mensagem = criadas.Count == 1
                    ? $"Pedido enviado para {(string)criadas[0].empresa}. Eles vão entrar em contato."
                    : $"Pedido enviado para {criadas.Count} empresas que atendem você."
            });
        }).RequireAuthorization("portal");

        // ── Quem atende este cliente (para o bloco "precisa de ajuda?") ──
        g.MapGet("/empresas-contato", async (ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            var doc = DocDoCliente(user);
            if (doc is null) return Results.Unauthorized();
            await using var conn = await ds.OpenConnectionAsync();
            return Results.Ok(await conn.QueryAsync(
                "SELECT * FROM cliente_empresas_contato(@d)", new { d = doc }));
        }).RequireAuthorization("portal");

        // ── Pesos-padrão usados nos meus certificados ──
        g.MapGet("/pesos", async (ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            var doc = DocDoCliente(user);
            if (doc is null) return Results.Unauthorized();
            await using var conn = await ds.OpenConnectionAsync();
            return Results.Ok(await conn.QueryAsync(
                "SELECT * FROM cliente_pesos_agrupado(@d)", new { d = doc }));
        }).RequireAuthorization("portal");

        // ── Download do PDF de um certificado meu ──
        g.MapGet("/certificados/{id:guid}/pdf", async (Guid id, ClaimsPrincipal user,
            NpgsqlDataSource ds, IConfiguration cfg, HttpContext ctx) =>
        {
            var doc = DocDoCliente(user);
            if (doc is null) return Results.Unauthorized();
            await using var conn = await ds.OpenConnectionAsync();

            // Guarda + URL na MESMA função (SECURITY DEFINER). Antes, a guarda
            // passava e o SELECT direto na tabela caía no RLS, devolvendo
            // vazio — e o portal dizia "PDF indisponível" com o arquivo lá.
            var pdfUrl = await conn.ExecuteScalarAsync<string?>(
                "SELECT cliente_pdf_certificado(@d, @id)", new { d = doc, id });
            if (string.IsNullOrEmpty(pdfUrl))
                return Results.NotFound(new
                {
                    erro = "Este certificado não está disponível para download. " +
                           "Se ele aparece na sua lista, avise a empresa que o emitiu."
                });

            await conn.ExecuteAsync(
                "SELECT cliente_log(NULL, @d, NULL, 'download', @det, @ip)",
                new { d = doc, det = "certificado:" + id, ip = Ip(ctx) });

            return await BaixarS3(pdfUrl, cfg);
        }).RequireAuthorization("portal");

        // ── Download do PDF do certificado de um peso-padrão ──
        g.MapGet("/pesos/{id:guid}/pdf", async (Guid id, ClaimsPrincipal user,
            NpgsqlDataSource ds, IConfiguration cfg, HttpContext ctx) =>
        {
            var doc = DocDoCliente(user);
            if (doc is null) return Results.Unauthorized();
            await using var conn = await ds.OpenConnectionAsync();

            // Guarda + URL na MESMA função (SECURITY DEFINER) — o SELECT
            // direto anterior caía no RLS e devolvia vazio.
            var pdfUrl = await conn.ExecuteScalarAsync<string?>(
                "SELECT cliente_pdf_peso(@d, @id)", new { d = doc, id });
            if (string.IsNullOrEmpty(pdfUrl))
                return Results.NotFound(new
                {
                    erro = "O certificado deste peso-padrão não está disponível. " +
                           "Avise a empresa que fez a calibração."
                });

            await conn.ExecuteAsync(
                "SELECT cliente_log(NULL, @d, NULL, 'download', @det, @ip)",
                new { d = doc, det = "peso:" + id, ip = Ip(ctx) });

            return await BaixarS3(pdfUrl, cfg);
        }).RequireAuthorization("portal");
    }

    // ── Helpers ──
    static string? DocDoCliente(ClaimsPrincipal user)
    {
        if (user.FindFirstValue("tipo") != "cliente") return null;
        return user.FindFirstValue("doc");
    }

    // Token de VISUALIZAÇÃO do super-admin: mesma estrutura, vida curta.
    // 30 minutos bastam para conferir a tela e reduzem muito o risco de o
    // link vazar (ele fica no histórico do navegador).
    static string GerarTokenCurto(IConfiguration cfg, string doc, string nome)
    {
        var claims = new[]
        {
            new Claim("sub", Guid.Empty.ToString()),
            new Claim("tipo", "cliente"),
            new Claim("doc", doc),
            new Claim("nome", nome),
            new Claim("email", "visualizacao@super-admin"),
            new Claim("visu", "1")
        };
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(cfg["Jwt:Secret"]!));
        var jwt = new JwtSecurityToken(
            issuer: cfg["Jwt:Issuer"], claims: claims,
            expires: DateTime.UtcNow.AddMinutes(30),
            signingCredentials: new SigningCredentials(key, SecurityAlgorithms.HmacSha256));
        return new JwtSecurityTokenHandler().WriteToken(jwt);
    }

    static string GerarToken(IConfiguration cfg, Guid id, string doc, string nome, string email)
    {
        var claims = new[]
        {
            new Claim("sub", id.ToString()),
            new Claim("tipo", "cliente"),
            new Claim("doc", doc),
            new Claim("nome", nome),
            new Claim("email", email),
        };
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(cfg["Jwt:Secret"]!));
        var jwt = new JwtSecurityToken(
            issuer: cfg["Jwt:Issuer"],
            claims: claims,
            expires: DateTime.UtcNow.AddHours(8),
            signingCredentials: new SigningCredentials(key, SecurityAlgorithms.HmacSha256));
        return new JwtSecurityTokenHandler().WriteToken(jwt);
    }

    // Baixa um objeto do MinIO em bytes (usado no ZIP).
    // Devolve null se o arquivo não existir — o ZIP segue sem ele.
    static async Task<byte[]?> BytesS3(string pdfUrl, IConfiguration cfg)
    {
        try
        {
            var semPrefixo = pdfUrl.Replace("s3://", "");
            var barra = semPrefixo.IndexOf('/');
            var bucket = semPrefixo[..barra];
            var chave = semPrefixo[(barra + 1)..];
            var s3 = new AmazonS3Client(cfg["S3:AccessKey"], cfg["S3:SecretKey"],
                new AmazonS3Config
                {
                    ServiceURL = cfg["S3:Endpoint"] ?? "http://minio:9000",
                    ForcePathStyle = true, AuthenticationRegion = "us-east-1"
                });
            using var r = await s3.GetObjectAsync(bucket, chave);
            using var ms = new MemoryStream();
            await r.ResponseStream.CopyToAsync(ms);
            return ms.ToArray();
        }
        catch { return null; }
    }

    // Nome de arquivo legível e seguro: "BAL-001_Balanca-rodoviaria_MB-2026-0147.pdf"
    static string NomeArquivo(params string?[] partes)
    {
        var texto = string.Join("_", partes.Where(p => !string.IsNullOrWhiteSpace(p)));
        var semAcento = new string(texto.Normalize(System.Text.NormalizationForm.FormD)
            .Where(c => System.Globalization.CharUnicodeInfo.GetUnicodeCategory(c)
                     != System.Globalization.UnicodeCategory.NonSpacingMark).ToArray());
        var limpo = new string(semAcento.Select(c =>
            char.IsLetterOrDigit(c) || c is '_' or '-' ? c :
            c is ' ' or '.' or '/' ? '-' : '-').ToArray());
        while (limpo.Contains("--")) limpo = limpo.Replace("--", "-");
        return limpo.Trim('-', '_');
    }

    static async Task<IResult> BaixarS3(string pdfUrl, IConfiguration cfg)
    {
        var semPrefixo = pdfUrl.Replace("s3://", "");
        var barra = semPrefixo.IndexOf('/');
        var bucket = semPrefixo[..barra];
        var chave = semPrefixo[(barra + 1)..];
        var s3 = new AmazonS3Client(cfg["S3:AccessKey"], cfg["S3:SecretKey"],
            new AmazonS3Config
            {
                ServiceURL = cfg["S3:Endpoint"] ?? "http://minio:9000",
                ForcePathStyle = true, AuthenticationRegion = "us-east-1"
            });
        try
        {
            using var r = await s3.GetObjectAsync(bucket, chave);
            using var ms = new MemoryStream();
            await r.ResponseStream.CopyToAsync(ms);
            return Results.File(ms.ToArray(), "application/pdf", chave.Split('/').Last());
        }
        catch (AmazonS3Exception)
        {
            return Results.NotFound(new { erro = "Arquivo não encontrado no storage." });
        }
    }

    static string Ip(HttpContext ctx) =>
        ctx.Request.Headers["X-Forwarded-For"].FirstOrDefault()
        ?? ctx.Connection.RemoteIpAddress?.ToString() ?? "";
}
