using System.Text.Json;
using System.Security.Claims;
using System.Security.Cryptography;
using Amazon.S3;
using CertSaas.Api.Auth;
using CertSaas.Api.Certificados;
using CertSaas.Api.Infra;
using Dapper;
using Npgsql;
using StackExchange.Redis;

namespace CertSaas.Api.Sistema;

public record NovaEmpresaRequest(string RazaoSocial, string Cnpj, string Subdominio,
    string PrefixoCert, string Plano, int LimiteUsuarios,
    string AdminNome, string AdminEmail);
public record AtualizarEmpresaRequest(string? RazaoSocial, string? Plano,
    string? Status, int? LimiteUsuarios,
    string? Subdominio, string? NumAutorizacao, string? PrefixoCert, int? Carencia);
// Plano/limites: essencial, profissional, enterprise ou null (personalizado)
public record NovoContratoRequest(string Descricao, decimal Valor, string Periodicidade,
    DateOnly Inicio, DateOnly? Fim, string? Observacao,
    int? DiaVencimento, bool? GerarAutomatico,
    string? Plano = null, int? MaxUsuarios = null, int? MaxCertsMes = null,
    string? DescontoTipo = null, decimal? DescontoValor = null, DateOnly? DescontoAte = null,
    decimal? ValorImplantacao = null);
public record RepLegalRequest(string? Nome, string? Cpf);
public record LiberacaoRequest(DateOnly? Ate);
public record PortalEmpresaRequest(bool Ativo);
public record SupressaoRequest(string Email, string? Escopo, string? Motivo);
public record SuspenderEmailsRequest(bool Suspender);
public record DadosContatoRequest(string? Endereco, string? Cep, string? CidadeUf,
    string? Telefone, string? Email);
public record ContatoRequest(string Nome, string? Email, string? Telefone, string? Cargo);
public record NomeFantasiaRequest(string? Nome);
public record NovaCobrancaRequest(Guid ContratoId, DateOnly Competencia,
    DateOnly Vencimento, decimal Valor, string? Observacao);
public record StatusCobrancaRequest(string Status, DateOnly? PagoEm);
public record EditarUsuarioSaRequest(string? Nome, string? Email, string? Papel, string? Registro);
public record BloqueioRequest(bool Ativo);
public record MensagemSuporteRequest(string Mensagem);
public record StatusChamadoRequest(string? Status, string? Prioridade);
public record ResolverErroRequest(bool Resolvido, string? Correcao = null);
public record LimparCertsRequest(string? Pin, string? Tipo);
public record DefinirPinRequest(string? NovoPin, string? PinAtual);
public record EditarCobrancaRequest(DateOnly? Competencia, DateOnly? Vencimento,
    decimal? Valor, string? Observacao);

/// <summary>
/// Painel de super-administração (gestão comercial multiempresa).
/// Todos os endpoints exigem papel super_admin e operam via funções
/// SECURITY DEFINER (sa_*), que atravessam o isolamento por empresa.
/// </summary>
public static class SuperAdminEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/sa").RequireAuthorization();

        // Guard: todo endpoint checa o papel antes de tocar no banco
        static bool Ok(ClaimsPrincipal u) => Tenant.EhSuperAdmin(u);

        // ── Resumo global (topo do painel) ──────────────────────
        g.MapGet("/resumo", async (ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            await conn.ExecuteAsync("SELECT sa_atualizar_vencidas()");
            await conn.ExecuteAsync("SELECT sa_aplicar_bloqueio_contratos()");
            var r = await conn.QuerySingleAsync("SELECT * FROM sa_resumo()");
            return Results.Ok(r);
        });

        // ── Empresas ────────────────────────────────────────────
        g.MapGet("/empresas", async (ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            return Results.Ok(await conn.QueryAsync("SELECT * FROM sa_listar_empresas()"));
        });

        g.MapGet("/empresas/{id:guid}", async (Guid id, ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            var e = await conn.QuerySingleOrDefaultAsync("SELECT * FROM sa_empresa(@id)", new { id });
            return e is null ? Results.NotFound() : Results.Ok(e);
        });

        // ── Entrar em modo de VISUALIZAÇÃO (somente leitura) de uma empresa ──
        // Gera um token de impersonação que faz o RLS mostrar os dados da
        // empresa-alvo. Registra o acesso na auditoria. Só leitura.
        g.MapPost("/empresas/{id:guid}/visualizar", async (string? papel, Guid id, ClaimsPrincipal user,
            NpgsqlDataSource ds, TokenService tokens, HttpContext ctx) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();

            // Confere que a empresa existe e pega o nome (para o banner).
            // Usa sa_empresa (SECURITY DEFINER) porque a tabela empresa tem RLS
            // e esta conexão não tem tenant setado.
            var emp = await conn.QuerySingleOrDefaultAsync(
                "SELECT id, razao_social FROM sa_empresa(@id)", new { id });
            if (emp is null) return Results.NotFound(new { erro = "Empresa não encontrada." });
            string empNome = (string)emp.razao_social;

            var saId = Tenant.UsuarioId(user);
            var saNome = user.FindFirstValue("nome") ?? "Super-admin";

            // Nova sessão (o SessaoUnicaMiddleware valida o sid ativo)
            var sid = await conn.ExecuteScalarAsync<Guid>(
                "SELECT auth_nova_sessao(@id)", new { id = saId });

            // Registra na auditoria o acesso de visualização
            await conn.ExecuteAsync(
                "SELECT set_config('app.empresa_id', @id, false)", new { id = id.ToString() });
            await Auditoria.Registrar(conn, id, saId,
                "empresa", id, "visualizar_super_admin",
                new { super_admin = saNome, empresa = empNome }, Auditoria.Ip(ctx));

            papel = papel is "admin" or "tecnico" ? papel : "responsavel_tecnico";
            var (token, expiraEm) = tokens.GerarVisualizacao(saId, saNome, id, empNome, sid, papel);
            return Results.Ok(new
            {
                token, expiraEm,
                empresaNome = empNome,
                modo = "visualizacao"
            });
        });

        // ── Sair do modo de visualização: volta a ser super-admin normal ──
        // Gera um novo token normal de super-admin (nova sessão). Aceita o
        // token de visualização (que tem impersonando=true) para autorizar.
        g.MapPost("/sair-visualizacao", async (ClaimsPrincipal user,
            NpgsqlDataSource ds, TokenService tokens) =>
        {
            // Só faz sentido se estiver realmente em visualização
            if (!Tenant.EstaVisualizando(user))
                return Results.BadRequest(new { erro = "Não está em modo de visualização." });

            var saId = Tenant.UsuarioId(user);
            await using var conn = await ds.OpenConnectionAsync();

            // Confirma que o usuário é mesmo super-admin. Usa função
            // SECURITY DEFINER porque a tabela usuario tem RLS e esta
            // conexão não tem tenant setado (SELECT direto viria vazio).
            var dados = await conn.QuerySingleOrDefaultAsync(
                "SELECT empresa_id, nome, papel FROM auth_buscar_usuario_id(@id)", new { id = saId });
            if (dados is null || (string)dados.papel != "super_admin")
                return Results.Forbid();

            var sid = await conn.ExecuteScalarAsync<Guid>(
                "SELECT auth_nova_sessao(@id)", new { id = saId });
            var (token, expiraEm) = tokens.Gerar(
                saId, (Guid)dados.empresa_id, (string)dados.nome, "super_admin", sid);
            return Results.Ok(new { token, expiraEm });
        });

        // Cria empresa + admin inicial; devolve o link de convite do admin
        g.MapPost("/empresas", async (NovaEmpresaRequest req, ClaimsPrincipal user,
            NpgsqlDataSource ds, IConfiguration cfg, IConnectionMultiplexer redis, HttpContext ctx) =>
        {
            if (!Ok(user)) return Results.Forbid();
            if (string.IsNullOrWhiteSpace(req.RazaoSocial) || string.IsNullOrWhiteSpace(req.Cnpj))
                return Results.BadRequest(new { erro = "Razão social e CNPJ são obrigatórios." });
            if (string.IsNullOrWhiteSpace(req.AdminEmail) || !req.AdminEmail.Contains('@'))
                return Results.BadRequest(new { erro = "Email do administrador inválido." });

            var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(24)).ToLowerInvariant();
            await using var conn = await ds.OpenConnectionAsync();
            try
            {
                var id = await conn.ExecuteScalarAsync<Guid>("""
                    SELECT sa_criar_empresa(@RazaoSocial, @Cnpj, @Subdominio, @PrefixoCert,
                        @Plano, @LimiteUsuarios, @AdminNome, @AdminEmail, @token)
                    """, new { req.RazaoSocial, req.Cnpj, req.Subdominio, req.PrefixoCert,
                        req.Plano, req.LimiteUsuarios, req.AdminNome, req.AdminEmail, token });

                // dispara o email de convite ao admin (mesmo mecanismo do convite comum)
                var idAdmin = await conn.ExecuteScalarAsync<Guid>(
                    "SELECT id FROM usuario WHERE lower(email)=lower(@e) ORDER BY criado_em DESC LIMIT 1",
                    new { e = req.AdminEmail });
                await redis.GetDatabase().ListLeftPushAsync("fila:tarefas",
                    $"{{\"tipo\":\"email_convite\",\"usuario_id\":\"{idAdmin}\"}}");

                var urlBase = cfg["App:UrlBase"] ?? $"{ctx.Request.Scheme}://{ctx.Request.Host}";
                return Results.Ok(new { id, linkConvite = $"{urlBase}/#convite={token}" });
            }
            catch (PostgresException ex) when (ex.SqlState == "23505")
            {
                return Results.Conflict(new { erro = "CNPJ, subdomínio ou email já cadastrado." });
            }
        });

        g.MapPut("/empresas/{id:guid}", async (Guid id, AtualizarEmpresaRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            if (req.Status is not null and not ("ativa" or "suspensa" or "cancelada"))
                return Results.BadRequest(new { erro = "Status inválido." });
            await using var conn = await ds.OpenConnectionAsync();
            await conn.ExecuteAsync("""
                SELECT sa_atualizar_empresa(@id, @RazaoSocial, @Plano, @Status, @LimiteUsuarios,
                                            @Subdominio, @NumAutorizacao, @PrefixoCert, @Carencia)
                """, new { id, req.RazaoSocial, req.Plano, req.Status, req.LimiteUsuarios,
                           req.Subdominio, req.NumAutorizacao, req.PrefixoCert, req.Carencia });
            return Results.Ok(new { atualizado = true });
        });

        // Uso de certificados por período
        g.MapGet("/empresas/{id:guid}/uso", async (Guid id, DateTime? de, DateTime? ate,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            var n = await conn.ExecuteScalarAsync<long>(
                "SELECT sa_uso_certificados(@id, @de, @ate)", new { id, de, ate });
            return Results.Ok(new { certificados = n });
        });

        // ── Contratos ───────────────────────────────────────────
        g.MapGet("/empresas/{id:guid}/contratos", async (Guid id, ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            var contratos = await conn.QueryAsync("SELECT * FROM sa_contratos(@id)", new { id });
            var planos = await conn.QueryAsync(
                """
                SELECT id, plano, max_usuarios, max_certs_mes,
                       arquivo_assinado_nome, arquivo_assinado_em,
                       desconto_tipo, desconto_valor, desconto_ate, valor_implantacao
                  FROM contrato WHERE empresa_id = @id
                """, new { id });
            return Results.Ok(new { contratos, planos });
        });

        g.MapPost("/empresas/{id:guid}/contratos", async (Guid id, NovoContratoRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            var cid = await conn.ExecuteScalarAsync<Guid>("""
                SELECT sa_criar_contrato(@id, @Descricao, @Valor, @Periodicidade,
                    @Inicio, @Fim, @Observacao, @DiaVencimento, @GerarAutomatico)
                """, new { id, req.Descricao, req.Valor, req.Periodicidade,
                    req.Inicio, req.Fim, req.Observacao,
                    DiaVencimento = req.DiaVencimento ?? 10,
                    GerarAutomatico = req.GerarAutomatico ?? true });
            // Plano, limites e desconto (contrato não tem RLS; update direto)
            if (req.DescontoTipo == "percentual" && req.DescontoValor is > 100 or < 0)
                return Results.BadRequest(new { erro = "Desconto percentual deve estar entre 0 e 100." });
            await conn.ExecuteAsync("""
                UPDATE contrato SET plano = @Plano,
                       max_usuarios = @MaxUsuarios, max_certs_mes = @MaxCertsMes,
                       desconto_tipo = @DescontoTipo,
                       desconto_valor = COALESCE(@DescontoValor, 0),
                       desconto_ate = @DescontoAte,
                       valor_implantacao = COALESCE(@ValorImplantacao, 0)
                 WHERE id = @cid
                """, new { cid, req.Plano, req.MaxUsuarios, req.MaxCertsMes,
                    req.DescontoTipo, req.DescontoValor, req.DescontoAte, req.ValorImplantacao });
            // O plano da empresa acompanha o contrato (João, 12/08/2026):
            // evita a divergência que fazia a lista mostrar "trial" para quem
            // já tinha contrato profissional.
            await conn.ExecuteAsync(
                "UPDATE empresa SET plano = COALESCE(@Plano, plano) WHERE id = @id",
                new { req.Plano, id });
            // Portal do cliente segue o plano (essencial não tem)
            // Contrato ativo reativa a empresa suspensa por motivo automático
            // (avaliação encerrada ou contrato vencido). Suspensão MANUAL não é
            // desfeita aqui — essa você reverte de propósito. (João, 19/08/2026)
            await conn.ExecuteAsync("""
                UPDATE empresa SET status = 'ativa', motivo_suspensao = NULL
                 WHERE id = @id AND status = 'suspensa'
                   AND motivo_suspensao IN ('avaliacao_encerrada', 'contrato_vencido')
                """, new { id });
            await conn.ExecuteAsync("SELECT empresa_portal_por_plano(@id)", new { id });
            // Implantação vira cobrança no financeiro (vencimento em 7 dias;
            // competência no mês ANTERIOR ao início para não colidir com a
            // checagem de "1 cobrança por competência" da mensalidade)
            if (req.ValorImplantacao is > 0)
                await conn.ExecuteAsync("""
                    INSERT INTO cobranca (empresa_id, contrato_id, competencia, vencimento,
                                          valor, status, observacao)
                    VALUES (@id, @cid,
                            (date_trunc('month', @Inicio::date) - interval '1 month')::date,
                            GREATEST(current_date, @Inicio::date) + 7,
                            @ValorImplantacao, 'pendente', 'Implantação e treinamento')
                    """, new { id, cid, req.Inicio, req.ValorImplantacao });
            // Gera na hora a cobrança da competência atual (idempotente — o worker
            // continua cuidando dos meses seguintes no ciclo diário)
            try { await conn.ExecuteAsync("SELECT gerar_cobrancas_do_mes()"); } catch { }
            return Results.Ok(new { id = cid });
        });

        // ── Resumo financeiro (MRR, mês corrente, inadimplência) ──
        g.MapGet("/financeiro-resumo", async (ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            await conn.ExecuteAsync("SELECT sa_atualizar_vencidas()");
            var r = await conn.QuerySingleAsync("""
                SELECT
                  -- MRR: contratos ativos mensalizados pela periodicidade
                  COALESCE((SELECT SUM(valor / CASE periodicidade
                        WHEN 'mensal' THEN 1 WHEN 'trimestral' THEN 3
                        WHEN 'semestral' THEN 6 WHEN 'anual' THEN 12 ELSE 1 END)
                     FROM contrato WHERE ativo AND periodicidade <> 'avulso'
                      AND inicio <= current_date
                      AND (fim IS NULL OR fim >= current_date)), 0) AS mrr,
                  COALESCE((SELECT SUM(valor) FROM cobranca
                     WHERE status = 'pago'
                       AND date_trunc('month', pago_em) = date_trunc('month', current_date)), 0) AS recebido_mes,
                  COALESCE((SELECT SUM(valor) FROM cobranca
                     WHERE status = 'pendente'), 0) AS pendente_total,
                  (SELECT COUNT(*) FROM cobranca WHERE status = 'vencido') AS vencidas_qtd,
                  COALESCE((SELECT SUM(valor) FROM cobranca WHERE status = 'vencido'), 0) AS vencidas_total
                """);
            var atrasadas = await conn.QueryAsync("""
                SELECT e.razao_social AS empresa, cb.valor,
                       (current_date - cb.vencimento) AS dias_atraso, cb.vencimento
                  FROM cobranca cb JOIN empresa e ON e.id = cb.empresa_id
                 WHERE cb.status = 'vencido'
                 ORDER BY cb.vencimento LIMIT 5
                """);
            return Results.Ok(new { resumo = r, atrasadas });
        });

        // ── Representante legal + dados para o contrato preenchido ──
        g.MapPut("/empresas/{id:guid}/rep-legal", async (Guid id, RepLegalRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            await conn.ExecuteAsync("SELECT sa_editar_rep_legal(@id, @Nome, @Cpf)",
                new { id, req.Nome, req.Cpf });
            return Results.Ok(new { atualizado = true });
        });

        g.MapGet("/empresas/{id:guid}/dados-contrato", async (Guid id,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            var d = await conn.QuerySingleOrDefaultAsync(
                "SELECT * FROM sa_dados_contrato(@id)", new { id });
            return d is null ? Results.NotFound() : Results.Ok(d);
        });

        // ── Manutenção: panorama + clientes finais + balanças ──
        g.MapGet("/empresas/{id:guid}/panorama", async (Guid id,
            ClaimsPrincipal user, NpgsqlDataSource ds, HttpContext ctx) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            var dados = await conn.QuerySingleAsync(
                "SELECT * FROM sa_empresa_panorama(@id)", new { id });
            // LGPD/auditoria: fica registrado quem abriu os dados de quem
            await Auditoria.Registrar(conn, id, Tenant.UsuarioId(user),
                "empresa", id, "consulta_manutencao_sa",
                new { tela = "dados completos" }, Auditoria.Ip(ctx));
            return Results.Ok(dados);
        });

        g.MapGet("/empresas/{id:guid}/clientes", async (Guid id,
            ClaimsPrincipal user, NpgsqlDataSource ds, HttpContext ctx) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            var lista = (await conn.QueryAsync(
                "SELECT * FROM sa_empresa_clientes(@id)", new { id })).ToList();
            await Auditoria.Registrar(conn, id, Tenant.UsuarioId(user),
                "cliente", id, "consulta_clientes_sa",
                new { qtd = lista.Count }, Auditoria.Ip(ctx));
            return Results.Ok(lista);
        });

        g.MapGet("/clientes/{cid:guid}/balancas", async (Guid cid,
            ClaimsPrincipal user, NpgsqlDataSource ds, HttpContext ctx) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            var lista = (await conn.QueryAsync(
                "SELECT * FROM sa_cliente_balancas(@cid)", new { cid })).ToList();
            var empId = await conn.ExecuteScalarAsync<Guid?>(
                "SELECT empresa_id FROM cliente WHERE id = @cid", new { cid });
            await Auditoria.Registrar(conn, empId, Tenant.UsuarioId(user),
                "cliente", cid, "consulta_balancas_sa",
                new { qtd = lista.Count }, Auditoria.Ip(ctx));
            return Results.Ok(lista);
        });

        // ── Detalhe do usuário (botão "👤 Ver" do log de logins) ──
        g.MapGet("/usuarios/{id:guid}/detalhe", async (Guid id,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            var d = await conn.QuerySingleOrDefaultAsync(
                "SELECT * FROM sa_usuario_detalhe(@id)", new { id });
            return d is null
                ? Results.NotFound(new { erro = "Usuário não encontrado." })
                : Results.Ok(d);
        });

        // ── Tentativas de login (quem tentou entrar e falhou) ──
        g.MapGet("/tentativas-login", async (ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            return Results.Ok(await conn.QueryAsync(
                "SELECT * FROM sa_tentativas_login(150)"));
        });

        // ── Portal do cliente: liga/desliga manual (exceção comercial) ──
        g.MapPut("/empresas/{id:guid}/portal", async (Guid id, PortalEmpresaRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            var ativo = await conn.ExecuteScalarAsync<bool>(
                "SELECT sa_portal_empresa(@id, @Ativo)", new { id, req.Ativo });
            return Results.Ok(new { portalAtivo = ativo });
        });

        // ── Liberação temporária (escudo contra suspensões automáticas) ──
        g.MapPut("/empresas/{id:guid}/liberar", async (Guid id, LiberacaoRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            if (req.Ate is { } d && d < DateOnly.FromDateTime(DateTime.Today))
                return Results.BadRequest(new { erro = "A data de liberação deve ser hoje ou futura." });
            await using var conn = await ds.OpenConnectionAsync();
            await conn.ExecuteAsync("SELECT sa_liberar_empresa(@id, @Ate)", new { id, req.Ate });
            return Results.Ok(new { liberado = req.Ate is not null });
        });

        // ── Endereço/contato principal da empresa (edição pelo SA) ──
        g.MapPut("/empresas/{id:guid}/dados-contato", async (Guid id, DadosContatoRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            await conn.ExecuteAsync(
                "SELECT sa_editar_dados_contato(@id, @Endereco, @Cep, @CidadeUf, @Telefone, @Email)",
                new { id, req.Endereco, req.Cep, req.CidadeUf, req.Telefone, req.Email });
            return Results.Ok(new { atualizado = true });
        });
        g.MapPut("/empresas/{id:guid}/nome-fantasia", async (Guid id, NomeFantasiaRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            await conn.ExecuteAsync("SELECT sa_editar_nome_fantasia(@id, @Nome)",
                new { id, req.Nome });
            return Results.Ok(new { atualizado = true });
        });

        // ── Contatos da empresa (nome, e-mail, telefone, cargo) ──
        g.MapGet("/empresas/{id:guid}/contatos", async (Guid id, ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            return Results.Ok(await conn.QueryAsync("""
                SELECT id, nome, email, telefone, cargo FROM empresa_contato
                 WHERE empresa_id = @id ORDER BY nome
                """, new { id }));
        });

        g.MapPost("/empresas/{id:guid}/contatos", async (Guid id, ContatoRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            if (string.IsNullOrWhiteSpace(req.Nome))
                return Results.BadRequest(new { erro = "Informe o nome do contato." });
            await using var conn = await ds.OpenConnectionAsync();
            var cid = await conn.ExecuteScalarAsync<Guid>("""
                INSERT INTO empresa_contato (empresa_id, nome, email, telefone, cargo)
                VALUES (@id, @Nome, @Email, @Telefone, @Cargo) RETURNING id
                """, new { id, req.Nome, req.Email, req.Telefone, req.Cargo });
            return Results.Ok(new { id = cid });
        });

        g.MapPut("/empresas/{id:guid}/contatos/{cid:guid}", async (Guid id, Guid cid,
            ContatoRequest req, ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            if (string.IsNullOrWhiteSpace(req.Nome))
                return Results.BadRequest(new { erro = "Informe o nome do contato." });
            await using var conn = await ds.OpenConnectionAsync();
            var n = await conn.ExecuteAsync("""
                UPDATE empresa_contato SET nome = @Nome, email = @Email,
                       telefone = @Telefone, cargo = @Cargo
                 WHERE id = @cid AND empresa_id = @id
                """, new { cid, id, req.Nome, req.Email, req.Telefone, req.Cargo });
            return n > 0 ? Results.Ok(new { atualizado = true }) : Results.NotFound();
        });

        g.MapDelete("/empresas/{id:guid}/contatos/{cid:guid}", async (Guid id, Guid cid,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            await conn.ExecuteAsync(
                "DELETE FROM empresa_contato WHERE id = @cid AND empresa_id = @id", new { cid, id });
            return Results.Ok(new { removido = true });
        });

        // ── Contrato assinado (PDF anexado ao contrato) ─────────
        g.MapPost("/empresas/{id:guid}/contratos/{cid:guid}/arquivo", async (Guid id, Guid cid,
            IFormFile arquivo, ClaimsPrincipal user, NpgsqlDataSource ds, IConfiguration cfg) =>
        {
            if (!Ok(user)) return Results.Forbid();
            if (arquivo is null || arquivo.Length == 0)
                return Results.BadRequest(new { erro = "Selecione o arquivo PDF." });
            if (arquivo.Length > 10 * 1024 * 1024)
                return Results.BadRequest(new { erro = "Arquivo muito grande (máx. 10 MB)." });
            if (!arquivo.FileName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase))
                return Results.BadRequest(new { erro = "Envie o contrato assinado em PDF." });

            var chave = $"contratos-assinados/{cid}.pdf";
            var s3 = new AmazonS3Client(cfg["S3:AccessKey"], cfg["S3:SecretKey"],
                new AmazonS3Config { ServiceURL = cfg["S3:Endpoint"] ?? "http://minio:9000",
                    ForcePathStyle = true, AuthenticationRegion = "us-east-1" });
            using var ms = new MemoryStream();
            await arquivo.CopyToAsync(ms);
            ms.Position = 0;
            await s3.PutObjectAsync(new Amazon.S3.Model.PutObjectRequest
            {
                BucketName = "certificados", Key = chave,
                InputStream = ms, ContentType = "application/pdf"
            });
            await using var conn = await ds.OpenConnectionAsync();
            var ok = await conn.ExecuteAsync("""
                UPDATE contrato SET arquivo_assinado = @chaveS3,
                       arquivo_assinado_nome = @nome, arquivo_assinado_em = now()
                 WHERE id = @cid AND empresa_id = @id
                """, new { cid, id, chaveS3 = $"s3://certificados/{chave}", nome = arquivo.FileName });
            return ok > 0 ? Results.Ok(new { anexado = true }) : Results.NotFound();
        }).DisableAntiforgery();

        g.MapGet("/empresas/{id:guid}/contratos/{cid:guid}/arquivo", async (Guid id, Guid cid,
            ClaimsPrincipal user, NpgsqlDataSource ds, IConfiguration cfg) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            var c = await conn.QuerySingleOrDefaultAsync("""
                SELECT arquivo_assinado, arquivo_assinado_nome FROM contrato
                 WHERE id = @cid AND empresa_id = @id
                """, new { cid, id });
            if (c?.arquivo_assinado is null) return Results.NotFound();
            var url = ((string)c.arquivo_assinado).Replace("s3://", "");
            var barra = url.IndexOf('/');
            var s3 = new AmazonS3Client(cfg["S3:AccessKey"], cfg["S3:SecretKey"],
                new AmazonS3Config { ServiceURL = cfg["S3:Endpoint"] ?? "http://minio:9000",
                    ForcePathStyle = true, AuthenticationRegion = "us-east-1" });
            try
            {
                using var r = await s3.GetObjectAsync(url[..barra], url[(barra + 1)..]);
                using var ms = new MemoryStream();
                await r.ResponseStream.CopyToAsync(ms);
                return Results.File(ms.ToArray(), "application/pdf",
                    (string?)c.arquivo_assinado_nome ?? "contrato-assinado.pdf");
            }
            catch (AmazonS3Exception) { return Results.NotFound(); }
        });

        g.MapDelete("/empresas/{id:guid}/contratos/{cid:guid}/arquivo", async (Guid id, Guid cid,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            await conn.ExecuteAsync("""
                UPDATE contrato SET arquivo_assinado = NULL,
                       arquivo_assinado_nome = NULL, arquivo_assinado_em = NULL
                 WHERE id = @cid AND empresa_id = @id
                """, new { cid, id });
            return Results.Ok(new { removido = true });
        });

        // ── Cobranças ───────────────────────────────────────────
        g.MapGet("/empresas/{id:guid}/cobrancas", async (Guid id, ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            await conn.ExecuteAsync("SELECT sa_atualizar_vencidas()");
            return Results.Ok(await conn.QueryAsync("SELECT * FROM sa_cobrancas(@id)", new { id }));
        });

        // ══ FINANCEIRO GLOBAL — lançamentos, emissão e pagamento ══
        g.MapGet("/financeiro-global", async (DateTime? de, DateTime? ate, Guid? empresaId,
            bool? porPagamento, ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            // Consulta cross-empresa: SECURITY DEFINER (RLS bloqueava a query direta)
            var cobrancasJson = await conn.ExecuteScalarAsync<string>(
                "SELECT sa_cobrancas_global(@de, @ate, @empresaId, @porPag)::text",
                new { de = de is null ? (DateOnly?)null : DateOnly.FromDateTime(de.Value),
                      ate = ate is null ? (DateOnly?)null : DateOnly.FromDateTime(ate.Value),
                      empresaId, porPag = porPagamento ?? false });
            var cobrancas = System.Text.Json.JsonDocument.Parse(cobrancasJson ?? "[]").RootElement;
            var mrr = await conn.ExecuteScalarAsync<decimal>("""
                SELECT COALESCE(SUM(CASE periodicidade
                    WHEN 'mensal' THEN valor WHEN 'trimestral' THEN valor/3
                    WHEN 'semestral' THEN valor/6 WHEN 'anual' THEN valor/12
                    ELSE 0 END), 0)
                  FROM contrato WHERE ativo AND (fim IS NULL OR fim >= CURRENT_DATE)
                """);
            var gerarAuto = await conn.ExecuteScalarAsync<bool>("SELECT financeiro_flag_ler()");
            var contratosElegiveis = await conn.ExecuteScalarAsync<int>("""
                SELECT count(*)::int FROM contrato c JOIN empresa e ON e.id = c.empresa_id
                 WHERE c.ativo AND c.gerar_automatico AND c.periodicidade <> 'avulso'
                   AND c.inicio <= current_date
                   AND (c.fim IS NULL OR c.fim >= date_trunc('month', current_date)::date)
                   AND e.status = 'ativa'
                """);
            return Results.Ok(new { cobrancas, mrr, gerarAuto, contratosElegiveis });
        });

        // Interruptor geral da geração automática de cobranças
        g.MapPut("/financeiro/gerar-auto", async (JsonElement body, ClaimsPrincipal user,
            NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            var ativo = body.GetProperty("ativo").GetBoolean();
            var novo = await conn.ExecuteScalarAsync<bool>(
                "SELECT financeiro_flag_gravar(@ativo)", new { ativo });
            return Results.Ok(new { gerarAuto = novo });
        });

        g.MapPut("/cobrancas/{id:guid}/emitir", async (Guid id, JsonElement body,
            ClaimsPrincipal user, NpgsqlDataSource ds, HttpContext ctx) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var doc = body.TryGetProperty("documento", out var dj)
                && dj.ValueKind == JsonValueKind.String ? dj.GetString() : null;
            var n = await conn.ExecuteAsync("""
                UPDATE cobranca SET emitida_em = now(), documento = @doc
                 WHERE id = @id AND status NOT IN ('pago','cancelado')
                """, new { id, doc });
            if (n == 0) return Results.BadRequest(new { erro = "Cobrança não encontrada ou já finalizada." });
            return Results.Ok(new { ok = true });
        });

        g.MapPut("/cobrancas/{id:guid}/pagar", async (Guid id, JsonElement body,
            ClaimsPrincipal user, NpgsqlDataSource ds, HttpContext ctx) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var pagoEm = body.GetProperty("pagoEm").GetDateTime();
            var valorPago = body.GetProperty("valorPago").GetDecimal();
            var forma = body.GetProperty("forma").GetString();
            var banco = body.TryGetProperty("banco", out var bj)
                && bj.ValueKind == JsonValueKind.String ? bj.GetString() : null;
            if (valorPago <= 0) return Results.BadRequest(new { erro = "Valor inválido." });
            var n = await conn.ExecuteAsync("""
                UPDATE cobranca SET status = 'pago', pago_em = @pagoEm,
                       valor_pago = @valorPago, forma_pagamento = @forma, banco = @banco
                 WHERE id = @id AND status <> 'cancelado'
                """, new { id, pagoEm, valorPago, forma, banco });
            if (n == 0) return Results.BadRequest(new { erro = "Cobrança não encontrada ou cancelada." });
            return Results.Ok(new { ok = true });
        });

        g.MapPost("/cobrancas", async (NovaCobrancaRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            var cid = await conn.ExecuteScalarAsync<Guid>("""
                SELECT sa_criar_cobranca(@ContratoId, @Competencia, @Vencimento, @Valor, @Observacao)
                """, new { req.ContratoId, req.Competencia, req.Vencimento, req.Valor, req.Observacao });
            return Results.Ok(new { id = cid });
        });

        g.MapPut("/cobrancas/{id:guid}", async (Guid id, StatusCobrancaRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            if (req.Status is not ("pendente" or "pago" or "vencido" or "cancelado"))
                return Results.BadRequest(new { erro = "Status inválido." });
            await using var conn = await ds.OpenConnectionAsync();
            await conn.ExecuteAsync("SELECT sa_status_cobranca(@id, @Status, @PagoEm)",
                new { id, req.Status, req.PagoEm });
            return Results.Ok(new { atualizado = true });
        });

        // ── Editar cobrança (corrigir valor/datas/observação) ──
        g.MapPut("/cobrancas/{id:guid}/dados", async (Guid id, EditarCobrancaRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            await conn.ExecuteAsync(
                "SELECT sa_atualizar_cobranca(@id, @Competencia, @Vencimento, @Valor, @Observacao)",
                new { id, req.Competencia, req.Vencimento, req.Valor, req.Observacao });
            return Results.Ok(new { atualizado = true });
        });

        // ── Excluir cobrança (lançamento por engano) ──
        g.MapDelete("/cobrancas/{id:guid}", async (Guid id,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            await conn.ExecuteAsync("SELECT sa_excluir_cobranca(@id)", new { id });
            return Results.Ok(new { excluido = true });
        });

        // ── Editar / encerrar / excluir contrato ──
        g.MapPut("/empresas/{id:guid}/contratos/{cid:guid}", async (Guid id, Guid cid,
            NovoContratoRequest req, ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            if (string.IsNullOrWhiteSpace(req.Descricao))
                return Results.BadRequest(new { erro = "Informe a descrição do contrato." });
            await using var conn = await ds.OpenConnectionAsync();
            var ok = await conn.ExecuteScalarAsync<bool>("""
                SELECT sa_editar_contrato(@cid, @Descricao, @Valor, @Periodicidade,
                    @Inicio, @Fim, @Observacao, @DiaVencimento, @GerarAutomatico)
                """, new { cid, req.Descricao, req.Valor, req.Periodicidade,
                    req.Inicio, req.Fim, req.Observacao, req.DiaVencimento, req.GerarAutomatico });
            if (req.DescontoTipo == "percentual" && req.DescontoValor is > 100 or < 0)
                return Results.BadRequest(new { erro = "Desconto percentual deve estar entre 0 e 100." });
            if (ok) await conn.ExecuteAsync("""
                UPDATE contrato SET plano = @Plano,
                       max_usuarios = @MaxUsuarios, max_certs_mes = @MaxCertsMes,
                       desconto_tipo = @DescontoTipo,
                       desconto_valor = COALESCE(@DescontoValor, 0),
                       desconto_ate = @DescontoAte,
                       valor_implantacao = COALESCE(@ValorImplantacao, valor_implantacao)
                 WHERE id = @cid
                """, new { cid, req.Plano, req.MaxUsuarios, req.MaxCertsMes,
                    req.DescontoTipo, req.DescontoValor, req.DescontoAte, req.ValorImplantacao });
            // O plano da empresa acompanha o contrato (edição)
            await conn.ExecuteAsync(
                "UPDATE empresa SET plano = COALESCE(@Plano, plano) WHERE id = @id",
                new { req.Plano, id });
            await conn.ExecuteAsync("""
                SELECT empresa_portal_por_plano(empresa_id) FROM contrato WHERE id = @cid
                """, new { cid });
            return ok ? Results.Ok(new { atualizado = true }) : Results.NotFound();
        });

        g.MapPut("/empresas/{id:guid}/contratos/{cid:guid}/ativo", async (Guid id, Guid cid,
            BloqueioRequest req, ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            var ok = await conn.ExecuteScalarAsync<bool>(
                "SELECT sa_ativar_contrato(@cid, @Ativo)", new { cid, req.Ativo });
            return ok ? Results.Ok(new { atualizado = true }) : Results.NotFound();
        });

        g.MapDelete("/empresas/{id:guid}/contratos/{cid:guid}", async (Guid id, Guid cid,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            var r = await conn.ExecuteScalarAsync<string>(
                "SELECT sa_excluir_contrato(@cid)", new { cid });
            return r switch
            {
                "ok" => Results.Ok(new { excluido = true }),
                "tem_cobrancas" => Results.BadRequest(new { erro =
                    "Este contrato tem cobranças registradas. Encerre-o em vez de excluir (o histórico fica preservado)." }),
                _ => Results.NotFound()
            };
        });

        // ── Vigência dos contratos (avisos + situação por empresa) ──
        g.MapGet("/vigencia-contratos", async (ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            await conn.ExecuteAsync("SELECT sa_aplicar_bloqueio_contratos()");
            return Results.Ok(await conn.QueryAsync("SELECT * FROM sa_vigencia_contratos()"));
        });

        // ── Relatório financeiro detalhado (para CSV/PDF) ──
        g.MapGet("/relatorio-financeiro", async (DateOnly? de, DateOnly? ate, string? status,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            await conn.ExecuteAsync("SELECT sa_atualizar_vencidas()");
            return Results.Ok(await conn.QueryAsync(
                "SELECT * FROM sa_relatorio_financeiro(@de, @ate, @status)",
                new { de, ate, status }));
        });

        // ── Dashboard financeiro (MRR, faturado, aberto, vencido) ──
        g.MapGet("/financeiro", async (ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            await conn.ExecuteAsync("SELECT sa_atualizar_vencidas()");
            var fin = await conn.QuerySingleAsync("SELECT * FROM sa_financeiro()");
            var mensal = await conn.QueryAsync("SELECT * FROM sa_faturamento_mensal()");
            return Results.Ok(new { financeiro = fin, mensal });
        });

        // ── Log de atividade por empresa ──
        g.MapGet("/atividade", async (ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            return Results.Ok(await conn.QueryAsync("SELECT * FROM sa_atividade_empresas()"));
        });

        // ── Monitor de uso: emissoes por empresa no periodo (serie) ──
        g.MapGet("/uso-periodo", async (DateOnly de, DateOnly ate, string? grupo,
            Guid? empresaId, ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            return Results.Ok(await conn.QueryAsync(
                "SELECT * FROM sa_uso_periodo(@de, @ate, @grupo, @empresaId)",
                new { de, ate, grupo = grupo ?? "dia", empresaId }));
        });

        // ── Reenviar convite ao admin da empresa ──
        g.MapPost("/empresas/{id:guid}/convite-admin", async (Guid id,
            ClaimsPrincipal user, NpgsqlDataSource ds, IConnectionMultiplexer redis) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            var admin = await conn.QuerySingleOrDefaultAsync(
                "SELECT * FROM sa_reenviar_convite_admin(@id)", new { id });
            if (admin is null)
                return Results.BadRequest(new { erro = "Esta empresa não tem um administrador cadastrado." });
            // dispara o e-mail de convite (mesmo mecanismo dos demais)
            await redis.GetDatabase().ListLeftPushAsync("fila:tarefas",
                $"{{\"tipo\":\"email_convite\",\"usuario_id\":\"{admin.usuario_id}\"}}");
            return Results.Ok(new { enviado = true, email = (string)admin.email, nome = (string)admin.nome });
        });

        // Recupera o LINK de convite atual do admin (sem gerar novo token)
        g.MapGet("/empresas/{id:guid}/link-convite", async (Guid id,
            ClaimsPrincipal user, NpgsqlDataSource ds, IConfiguration cfg, HttpContext ctx) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            var adm = await conn.QuerySingleOrDefaultAsync(
                "SELECT * FROM sa_link_convite_admin(@id)", new { id });
            if (adm is null)
                return Results.BadRequest(new { erro = "Esta empresa não tem um administrador cadastrado." });
            string? token = (string?)adm.token;
            if (string.IsNullOrEmpty(token))
                return Results.Ok(new { temLink = false, nome = (string)adm.nome, email = (string)adm.email });
            var urlBase = cfg["App:UrlBase"] ?? $"{ctx.Request.Scheme}://{ctx.Request.Host}";
            return Results.Ok(new {
                temLink = true,
                nome = (string)adm.nome, email = (string)adm.email,
                linkConvite = $"{urlBase}/#convite={token}"
            });
        });

        // ── Usuários de uma empresa ──
        g.MapGet("/empresas/{id:guid}/usuarios", async (Guid id,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            return Results.Ok(await conn.QueryAsync(
                "SELECT * FROM sa_usuarios_empresa(@id)", new { id }));
        });

        // ── Bloquear / reativar usuário ──

        // ── Editar usuário (super-admin) ──────────────────────────
        g.MapPut("/usuarios/{id:guid}", async (Guid id, EditarUsuarioSaRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds, HttpContext ctx) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);
            var r = await conn.ExecuteScalarAsync<string>(
                "SELECT sa_editar_usuario(@id, @Nome, @Email, @Papel, @Registro)",
                new { id, req.Nome, req.Email, req.Papel, req.Registro });
            if (r != "ok")
                return Results.BadRequest(new { erro = r switch {
                    "nao_encontrado" => "Usuário não encontrado.",
                    "papel_invalido" => "Papel inválido.",
                    "ultimo_admin" => "Este é o único administrador ativo da empresa; promova outro antes de mudar o papel.",
                    "email_em_uso" => "Já existe outro usuário com este e-mail.",
                    _ => "Não foi possível editar." } });
            await Auditoria.Registrar(conn, null, Tenant.UsuarioId(user),
                "usuario", id, "editar_super_admin", req, Auditoria.Ip(ctx));
            return Results.Ok(new { editado = true });
        });

        g.MapPut("/usuarios/{id:guid}/bloqueio", async (Guid id, BloqueioRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            var r = await conn.ExecuteScalarAsync<string>(
                "SELECT sa_bloquear_usuario(@id, @Ativo)", new { id, req.Ativo });
            return r switch
            {
                "ok" => Results.Ok(new { atualizado = true }),
                "ultimo_admin" => Results.BadRequest(new { erro = "Não é possível bloquear o único administrador ativo da empresa." }),
                _ => Results.NotFound()
            };
        });

        // ── Excluir usuário ──
        g.MapDelete("/usuarios/{id:guid}", async (Guid id,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            try
            {
                var r = await conn.ExecuteScalarAsync<string>(
                    "SELECT sa_excluir_usuario(@id)", new { id });
                return r switch
                {
                    "ok" => Results.Ok(new { excluido = true }),
                    "ultimo_admin" => Results.BadRequest(new { erro = "Não é possível excluir o único administrador ativo da empresa." }),
                    _ => Results.NotFound()
                };
            }
            catch (PostgresException)
            {
                // Usuário com registros vinculados: sugerir bloqueio
                return Results.BadRequest(new { erro = "Este usuário tem registros vinculados e não pode ser excluído. Bloqueie-o em vez de excluir." });
            }
        });
        // ── Chamados de suporte (helpdesk) ──
        g.MapGet("/chamados", async (string? status, ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            return Results.Ok(await conn.QueryAsync(
                "SELECT * FROM sa_chamados(@status)", new { status }));
        });

        g.MapGet("/chamados/abertos", async (ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            var n = await conn.ExecuteScalarAsync<int>("SELECT sa_chamados_abertos()");
            return Results.Ok(new { abertos = n });
        });

        g.MapGet("/chamados/{id:guid}", async (Guid id, ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            var c = await conn.QuerySingleOrDefaultAsync("SELECT * FROM sa_chamado(@id)", new { id });
            if (c is null) return Results.NotFound();
            var msgs = await conn.QueryAsync("SELECT * FROM sa_chamado_mensagens(@id)", new { id });
            return Results.Ok(new { chamado = c, mensagens = msgs });
        });

        g.MapPost("/chamados/{id:guid}/mensagens", async (Guid id, MensagemSuporteRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds, IConnectionMultiplexer redis) =>
        {
            if (!Ok(user)) return Results.Forbid();
            if (string.IsNullOrWhiteSpace(req.Mensagem))
                return Results.BadRequest(new { erro = "Escreva a mensagem." });
            await using var conn = await ds.OpenConnectionAsync();
            var nome = user.FindFirstValue("nome") ?? "Suporte";
            await conn.ExecuteAsync("SELECT sa_responder_chamado(@id, @nome, @Mensagem)",
                new { id, nome, req.Mensagem });
            // avisa o cliente por e-mail (assíncrono, via fila)
            await redis.GetDatabase().ListLeftPushAsync("fila:tarefas",
                $"{{\"tipo\":\"email_chamado\",\"chamado_id\":\"{id}\",\"destino\":\"cliente\"}}");
            return Results.Ok(new { enviado = true });
        });

        g.MapPut("/chamados/{id:guid}/status", async (Guid id, StatusChamadoRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            if (req.Status is not null and not ("aberto" or "em_atendimento" or "aguardando_cliente" or "resolvido" or "fechado"))
                return Results.BadRequest(new { erro = "Status inválido." });
            if (req.Prioridade is not null and not ("baixa" or "normal" or "alta" or "urgente"))
                return Results.BadRequest(new { erro = "Prioridade inválida." });
            await using var conn = await ds.OpenConnectionAsync();
            await conn.ExecuteAsync("SELECT sa_status_chamado(@id, @Status, @Prioridade)",
                new { id, req.Status, req.Prioridade });
            return Results.Ok(new { atualizado = true });
        });
        // ── Log de erros do sistema ──
        g.MapGet("/erros", async (bool? abertos, ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            return Results.Ok(await conn.QueryAsync(
                "SELECT * FROM sa_erros_v2(@abertos, 200)", new { abertos = abertos ?? false }));
        });

        g.MapGet("/erros/abertos", async (ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            var n = await conn.ExecuteScalarAsync<int>("SELECT sa_erros_abertos()");
            return Results.Ok(new { abertos = n });
        });

        // ── Diagnóstico do portal do cliente final ──
        g.MapGet("/portal/diagnostico", async (int? dias, ClaimsPrincipal user,
            NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            var json = await conn.ExecuteScalarAsync<string>(
                "SELECT sa_portal_diagnostico(@d)::text", new { d = dias ?? 30 }) ?? "{}";
            return Results.Content(json, "application/json");
        });

        // ── Supressão de envios (pedidos de "não quero mais receber") ──
        g.MapGet("/supressoes", async (ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            return Results.Ok(await conn.QueryAsync("SELECT * FROM sa_supressoes()"));
        });

        g.MapPost("/supressoes", async (SupressaoRequest req, ClaimsPrincipal user,
            NpgsqlDataSource ds, HttpContext ctx) =>
        {
            if (!Ok(user)) return Results.Forbid();
            if (string.IsNullOrWhiteSpace(req.Email) || !req.Email.Contains('@'))
                return Results.BadRequest(new { erro = "Informe um e-mail válido." });
            await using var conn = await ds.OpenConnectionAsync();
            var id = await conn.ExecuteScalarAsync<Guid>(
                "SELECT sa_suprimir_email(@Email, @Escopo, @Motivo, @usr)",
                new { req.Email, req.Escopo, req.Motivo, usr = Tenant.UsuarioId(user) });
            await Auditoria.Registrar(conn, null, Tenant.UsuarioId(user),
                "email_supressao", null, "suprimir_email",
                new { req.Email, req.Escopo, req.Motivo }, Auditoria.Ip(ctx));
            return Results.Ok(new { id });
        });

        g.MapDelete("/supressoes", async (string email, ClaimsPrincipal user,
            NpgsqlDataSource ds, HttpContext ctx) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            await conn.ExecuteAsync("SELECT sa_liberar_email(@email)", new { email });
            await Auditoria.Registrar(conn, null, Tenant.UsuarioId(user),
                "email_supressao", null, "liberar_email", new { email }, Auditoria.Ip(ctx));
            return Results.Ok(new { liberado = true });
        });

        g.MapPut("/empresas/{id:guid}/emails-suspensos", async (Guid id,
            SuspenderEmailsRequest req, ClaimsPrincipal user, NpgsqlDataSource ds, HttpContext ctx) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            var st = await conn.ExecuteScalarAsync<bool>(
                "SELECT sa_suspender_emails_empresa(@id, @Suspender)", new { id, req.Suspender });
            await Auditoria.Registrar(conn, id, Tenant.UsuarioId(user),
                "empresa", id, "suspender_emails", new { req.Suspender }, Auditoria.Ip(ctx));
            return Results.Ok(new { suspensos = st });
        });

        // ── Painel de e-mails (tudo em uma chamada + fila do Redis) ──
        g.MapGet("/emails/painel", async (int? dias, ClaimsPrincipal user,
            NpgsqlDataSource ds, IConnectionMultiplexer redis) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            var json = await conn.ExecuteScalarAsync<string>(
                "SELECT sa_email_painel(@d)::text", new { d = dias ?? 30 }) ?? "{}";
            long fila = 0;
            try { fila = await redis.GetDatabase().ListLengthAsync("fila:tarefas"); }
            catch { /* Redis fora: painel continua funcionando */ }
            return Results.Content($"{{\"fila\":{fila},\"dados\":{json}}}", "application/json");
        });

        // ── Exportar erros para análise (agrupados, com IDs) ──
        g.MapGet("/erros/exportar", async (int? horas, ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            return Results.Ok(await conn.QueryAsync(
                "SELECT * FROM sa_erros_exportar(@h)", new { h = horas ?? 168 }));
        });

        g.MapPut("/erros/{id:long}/resolver", async (long id, ResolverErroRequest req,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            await conn.ExecuteAsync("SELECT sa_resolver_erro(@id, @Resolvido)", new { id, req.Resolvido });
            // registra O QUE foi feito (quando informado)
            if (req.Resolvido && !string.IsNullOrWhiteSpace(req.Correcao))
                await conn.ExecuteAsync(
                    "SELECT sa_resolver_erros(ARRAY[@id]::bigint[], @Correcao)",
                    new { id, req.Correcao });
            return Results.Ok(new { atualizado = true });
        });


        // ── Limpar certificados de uma empresa (destrutivo, com PIN) ──
        g.MapPost("/empresas/{id:guid}/limpar-certificados", async (Guid id,
            LimparCertsRequest req, ClaimsPrincipal user, NpgsqlDataSource ds, HttpContext ctx) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await Tenant.AbrirConexao(ds, user);

            // valida o PIN destrutivo (guardado na empresa SISTEMA)
            var pinHash = await conn.ExecuteScalarAsync<string?>(
                "SELECT pin_destrutivo_hash FROM empresa WHERE id = '00000000-0000-0000-0000-000000000001'");
            if (string.IsNullOrEmpty(pinHash))
                return Results.BadRequest(new { erro = "PIN destrutivo não configurado. Configure-o antes de usar esta função." });
            if (string.IsNullOrEmpty(req.Pin) || !BCrypt.Net.BCrypt.Verify(req.Pin, pinHash))
                return Results.BadRequest(new { erro = "PIN incorreto." });

            try
            {
                var r = await conn.QuerySingleAsync<(int qtd, string identificacao)>(
                    "SELECT qtd, identificacao FROM sa_limpar_certificados(@id, @uid, @tipo)",
                    new { id, uid = Tenant.UsuarioId(user), tipo = string.IsNullOrWhiteSpace(req.Tipo) ? "todos" : req.Tipo });
                await Auditoria.Registrar(conn, id, Tenant.UsuarioId(user),
                    "certificado", id, "limpeza_certificados",
                    new { r.qtd, r.identificacao }, Auditoria.Ip(ctx));
                return Results.Ok(new { limpo = true, quantidade = r.qtd, backup = r.identificacao });
            }
            catch (PostgresException e)
            {
                return Results.BadRequest(new { erro = e.MessageText });
            }
        });

        // ── Definir/atualizar o PIN destrutivo ──
        g.MapPost("/pin-destrutivo", async (DefinirPinRequest req, ClaimsPrincipal user,
            NpgsqlDataSource ds, HttpContext ctx) =>
        {
            if (!Ok(user)) return Results.Forbid();
            if (string.IsNullOrEmpty(req.NovoPin) || req.NovoPin.Length < 6)
                return Results.BadRequest(new { erro = "O PIN deve ter ao menos 6 caracteres." });
            await using var conn = await Tenant.AbrirConexao(ds, user);
            // se já existe um PIN, exige o atual para trocar
            var atual = await conn.ExecuteScalarAsync<string?>(
                "SELECT pin_destrutivo_hash FROM empresa WHERE id = '00000000-0000-0000-0000-000000000001'");
            if (!string.IsNullOrEmpty(atual) && (string.IsNullOrEmpty(req.PinAtual) || !BCrypt.Net.BCrypt.Verify(req.PinAtual, atual)))
                return Results.BadRequest(new { erro = "PIN atual incorreto." });
            var novoHash = BCrypt.Net.BCrypt.HashPassword(req.NovoPin, 12);
            await conn.ExecuteAsync(
                "UPDATE empresa SET pin_destrutivo_hash = @h WHERE id = '00000000-0000-0000-0000-000000000001'",
                new { h = novoHash });
            await Auditoria.Registrar(conn, null, Tenant.UsuarioId(user),
                "sistema", null, "definir_pin_destrutivo", null, Auditoria.Ip(ctx));
            return Results.Ok(new { definido = true });
        });

        g.MapPost("/erros/limpar", async (ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            var n = await conn.ExecuteScalarAsync<int>("SELECT sa_limpar_erros(30)");
            return Results.Ok(new { removidos = n });
        });
        // ── Portal do cliente final: log e lista de acessos ──
        g.MapGet("/clientes-portal", async (ClaimsPrincipal user, NpgsqlDataSource ds,
            HttpContext ctx) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            var acessos = (await conn.QueryAsync("SELECT * FROM sa_portal_acessos_completo()")).ToList();
            await Auditoria.Registrar(conn, null, Tenant.UsuarioId(user),
                "cliente_acesso", null, "consulta_acessos_portal_sa",
                new { qtd = acessos.Count }, Auditoria.Ip(ctx));
            return Results.Ok(acessos);
        });

        g.MapGet("/clientes-portal/log", async (ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            return Results.Ok(await conn.QueryAsync("SELECT * FROM sa_cliente_acessos(300)"));
        });
        // ── Log de logins de todos os usuários (com filtros) ──
        g.MapGet("/logins", async (string? busca, Guid? empresa, string? papel,
            string? resultado, DateTime? de, DateTime? ate,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            return Results.Ok(await conn.QueryAsync(
                "SELECT * FROM sa_logins(@busca, @empresa, @papel, @resultado, @de, @ate, 300)",
                new { busca, empresa, papel, resultado, de, ate }));
        });

        // Empresas para o seletor do filtro
        g.MapGet("/empresas-filtro", async (ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            return Results.Ok(await conn.QueryAsync("SELECT * FROM sa_empresas_filtro()"));
        });

        // ── Saúde do e-mail (alerta no topo do super-admin) ──
        g.MapGet("/email-saude", async (ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            return Results.Ok(await conn.QuerySingleAsync("SELECT * FROM sa_email_saude()"));
        });

        // ── Log de e-mails enviados (com filtros) ──
        g.MapGet("/email-log", async (Guid? empresa, Guid? cliente, string? status,
            DateTime? de, DateTime? ate, ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            return Results.Ok(await conn.QueryAsync(
                "SELECT * FROM sa_email_log(@empresa, @cliente, @de, @ate, @status)",
                new { empresa, cliente, de, ate, status }));
        });

        // ── Prévia de um e-mail enviado (corpo guardado por 30 dias) ──
        g.MapGet("/email-log/{id:guid}", async (Guid id, ClaimsPrincipal user,
            NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            var r = await conn.QuerySingleOrDefaultAsync("""
                SELECT el.id, el.destinatario, el.nome_destino, el.assunto, el.motivo,
                       el.status, el.erro_detalhe, el.enviado_em, el.corpo_html,
                       e.razao_social AS empresa
                  FROM email_log el LEFT JOIN empresa e ON e.id = el.empresa_id
                 WHERE el.id = @id
                """, new { id });
            return r is null ? Results.NotFound() : Results.Ok(r);
        });

        // ── Métricas do servidor (gráfico com filtro de período) ──
        g.MapGet("/metricas", async (int? horas, ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            var h = horas is > 0 and <= 4320 ? horas.Value : 24;
            var serie = await conn.QueryAsync("SELECT * FROM sa_metricas_serie(@h)", new { h });
            var resumo = await conn.QuerySingleOrDefaultAsync("SELECT * FROM sa_metricas_resumo(@h)", new { h });
            return Results.Ok(new { serie, resumo, horas = h });
        });

        // ══ PESQUISA DO TSCERT (produto) — super admin ══════════
        g.MapGet("/psaas", async (ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            var resumo = await conn.QuerySingleOrDefaultAsync("SELECT * FROM psaas_resumo()");
            var usuarios = await conn.QueryAsync("SELECT * FROM psaas_usuarios_alvo()");
            var respostas = await conn.QueryAsync("SELECT * FROM psaas_respostas_lista()");
            var cfg = await conn.QuerySingleOrDefaultAsync("SELECT * FROM psaas_config WHERE id");
            var perguntas = await conn.QueryAsync(
                "SELECT id, papel, texto, tipo, ordem, ativa FROM psaas_pergunta ORDER BY papel, ordem");
            return Results.Ok(new { resumo, usuarios, respostas, cfg, perguntas });
        });

        g.MapPut("/psaas/config", async (JsonElement body, ClaimsPrincipal user,
            NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            string? Txt(string k) => body.TryGetProperty(k, out var v2)
                && v2.ValueKind == JsonValueKind.String ? v2.GetString() : null;
            await conn.ExecuteAsync("""
                UPDATE psaas_config SET
                    ativo = @ativo, freq_dias = @freq, dias_ativo = @diasAtivo,
                    alerta_email = @alerta, convite_titulo = @titulo, convite_texto = @texto
                 WHERE id
                """, new {
                    ativo = body.GetProperty("ativo").GetBoolean(),
                    freq = body.GetProperty("freqDias").GetInt32(),
                    diasAtivo = body.TryGetProperty("diasAtivo", out var da) ? da.GetInt32() : 30,
                    alerta = Txt("alertaEmail"), titulo = Txt("conviteTitulo"), texto = Txt("conviteTexto") });
            return Results.Ok(new { ok = true });
        });

        // Envio manual: lista de usuários selecionados
        g.MapPost("/psaas/enviar", async (JsonElement body, ClaimsPrincipal user,
            NpgsqlDataSource ds, IConnectionMultiplexer redis) =>
        {
            if (!Ok(user)) return Results.Forbid();
            var ids = body.GetProperty("usuarios").EnumerateArray()
                .Select(x => Guid.Parse(x.GetString()!)).Distinct().ToList();
            if (ids.Count == 0) return Results.BadRequest(new { erro = "Selecione ao menos um usuário." });
            if (ids.Count > 100) return Results.BadRequest(new { erro = "Máximo de 100 por envio." });
            await redis.GetDatabase().ListLeftPushAsync("fila:tarefas",
                System.Text.Json.JsonSerializer.Serialize(new {
                    tipo = "psaas_enviar",
                    usuarios = ids.Select(i => i.ToString()).ToList(), modo = "manual" }));
            return Results.Ok(new { enfileirado = ids.Count });
        });

        // ── Log de consultas por QR code (com filtros) ──
        g.MapGet("/consulta-log", async (Guid? empresa, Guid? cliente,
            DateTime? de, DateTime? ate, ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            return Results.Ok(await conn.QueryAsync(
                "SELECT * FROM sa_consulta_log(@empresa, @cliente, @de, @ate)",
                new { empresa, cliente, de, ate }));
        });

        // Clientes de uma empresa (para o seletor de filtro por cliente)
        g.MapGet("/clientes-filtro", async (Guid? empresa, ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            return Results.Ok(await conn.QueryAsync("""
                SELECT id, razao_social FROM cliente
                 WHERE (@empresa IS NULL OR empresa_id = @empresa)
                 ORDER BY razao_social LIMIT 500
                """, new { empresa }));
        });

        // ══ LOG ROBUSTO DE USUÁRIOS ═══════════════════════════════

        // Cadastro completo de usuários (JSON para a tela)
        g.MapGet("/usuarios-log", async (string? busca, Guid? empresa, string? papel,
            bool? ativo, ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            return Results.Ok(await conn.QueryAsync(
                "SELECT * FROM sa_usuarios_completo(@busca, @empresa, @papel, @ativo)",
                new { busca, empresa, papel, ativo }));
        });

        // Histórico de atividade de usuários (JSON para a tela)
        g.MapGet("/atividade-log", async (string? busca, Guid? empresa, Guid? usuario,
            string? acao, DateTime? de, DateTime? ate, ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            return Results.Ok(await conn.QueryAsync(
                "SELECT * FROM sa_atividade_usuarios(@busca, @empresa, @usuario, @acao, @de, @ate, 1000)",
                new { busca, empresa, usuario, acao, de, ate }));
        });

        // Exportar CADASTRO de usuários (CSV ou PDF)
        g.MapGet("/usuarios-log/exportar", async (string? busca, Guid? empresa, string? papel,
            bool? ativo, string? formato, ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            var linhas = (await conn.QueryAsync(
                "SELECT * FROM sa_usuarios_completo(@busca, @empresa, @papel, @ativo)",
                new { busca, empresa, papel, ativo })).ToList();

            var cab = new[] { "Nome", "E-mail", "Papel", "Registro", "Status", "Empresa",
                "Criado em", "Último login", "Total de logins", "Certificados emitidos" };
            string[] Campos(dynamic u) => new string[] {
                (string?)u.nome ?? "", (string?)u.email ?? "", PapelExt((string?)u.papel),
                (string?)u.registro_prof ?? "", (bool)u.ativo ? "Ativo" : "Inativo",
                (string?)u.empresa ?? "", Dt(u.criado_em), Dt(u.ultimo_login),
                ((long)u.total_logins).ToString(), ((long)u.certificados_emitidos).ToString() };

            if (formato == "pdf")
            {
                var pesos = new[] { 2.4f, 2.6f, 1.6f, 1.2f, 0.9f, 2.2f, 1.5f, 1.5f, 0.9f, 0.9f };
                var cols = cab.Select((t, i) => new RelPdf.Coluna(t, pesos[i])).ToList();
                var dados = linhas.Select(Campos).ToList();
                var totais = new List<string> { $"Total de usuários: {linhas.Count}" };
                var pdf = RelPdf.Gerar("TSCert — Log de Usuários", "Cadastro de Usuários",
                    null, cols, dados, totais);
                return Results.File(pdf, "application/pdf", $"usuarios_{DateTime.Now:yyyyMMdd_HHmm}.pdf");
            }
            var csv = MontarCsv(cab, linhas.Select(u => CsvJoinArr(Campos(u))));
            return CsvResult(csv, $"usuarios_{DateTime.Now:yyyyMMdd_HHmm}.csv");
        });

        // Exportar ATIVIDADE de usuários (CSV ou PDF)
        g.MapGet("/atividade-log/exportar", async (string? busca, Guid? empresa, Guid? usuario,
            string? acao, DateTime? de, DateTime? ate, string? formato,
            ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            var linhas = (await conn.QueryAsync(
                "SELECT * FROM sa_atividade_usuarios(@busca, @empresa, @usuario, @acao, @de, @ate, 5000)",
                new { busca, empresa, usuario, acao, de, ate })).ToList();

            var cab = new[] { "Data/hora", "Ação", "Entidade", "Usuário", "E-mail",
                "Papel", "Empresa", "IP" };
            string[] Campos(dynamic a) => new string[] {
                Dt(a.ocorrido_em), AcaoExt((string?)a.acao), (string?)a.entidade ?? "",
                (string?)a.nome ?? "", (string?)a.email ?? "", PapelExt((string?)a.papel),
                (string?)a.empresa ?? "", (string?)a.ip ?? "" };

            if (formato == "pdf")
            {
                var pesos = new[] { 1.6f, 1.4f, 1.2f, 2f, 2.4f, 1.6f, 2f, 1.4f };
                var cols = cab.Select((t, i) => new RelPdf.Coluna(t, pesos[i])).ToList();
                var dados = linhas.Select(Campos).ToList();
                var totais = new List<string> { $"Total de registros: {linhas.Count}" };
                var pdf = RelPdf.Gerar("TSCert — Log de Usuários", "Histórico de Atividade",
                    null, cols, dados, totais);
                return Results.File(pdf, "application/pdf", $"atividade_usuarios_{DateTime.Now:yyyyMMdd_HHmm}.pdf");
            }
            var csv = MontarCsv(cab, linhas.Select(a => CsvJoinArr(Campos(a))));
            return CsvResult(csv, $"atividade_usuarios_{DateTime.Now:yyyyMMdd_HHmm}.csv");
        });

        // ── Usuários online agora (super-admin) ──
        g.MapGet("/online", async (int? minutos, ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            return Results.Ok(await conn.QueryAsync(
                "SELECT * FROM sa_online(@min)", new { min = minutos ?? 5 }));
        });

        // ── Saúde do sistema (métricas para o super-admin) ──
        g.MapGet("/saude", async (ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();

            // Métricas do banco e contadores
            var banco = await conn.QuerySingleAsync("SELECT * FROM sa_saude_banco()");
            var serie = await conn.QueryAsync("SELECT * FROM sa_certificados_serie()");
            var online = await conn.ExecuteScalarAsync<int>("SELECT sa_online_total(5)");
            var usuariosHora = await conn.QueryAsync("SELECT * FROM sa_usuarios_ultima_hora()");

            // Métricas do processo da aplicação (.NET)
            var proc = System.Diagnostics.Process.GetCurrentProcess();
            var memoriaApp = proc.WorkingSet64;                     // memória da API
            // Uptime a partir da subida da aplicação (confiável em container)
            var uptimeSeg = (long)(DateTime.UtcNow - CertSaas.Api.Infra.AppInfo.InicioEm).TotalSeconds;
            if (uptimeSeg < 0) uptimeSeg = 0;
            var gcMem = GC.GetTotalMemory(false);

            // Disco do volume que a aplicação enxerga
            var drive = new DriveInfo(Path.GetPathRoot(Environment.CurrentDirectory) ?? "/");
            long discoTotal = 0, discoLivre = 0;
            try { discoTotal = drive.TotalSize; discoLivre = drive.AvailableFreeSpace; } catch { }

            // Teste de latência do banco
            var sw = System.Diagnostics.Stopwatch.StartNew();
            await conn.ExecuteScalarAsync<int>("SELECT 1");
            sw.Stop();

            return Results.Ok(new
            { usuariosHora,
                banco,
                serie,
                online,
                app = new
                {
                    memoria_bytes = memoriaApp,
                    memoria_gc_bytes = gcMem,
                    uptime_segundos = uptimeSeg,
                    processadores = Environment.ProcessorCount,
                    versao_dotnet = Environment.Version.ToString(),
                    latencia_banco_ms = sw.ElapsedMilliseconds
                },
                disco = new
                {
                    total_bytes = discoTotal,
                    livre_bytes = discoLivre,
                    usado_bytes = discoTotal - discoLivre
                }
            });
        });

        // ── Avisos ao logar (resumo de pendências) ──
        g.MapGet("/avisos", async (ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            var chamadosAbertos = await conn.ExecuteScalarAsync<int>(
                "SELECT count(*) FROM chamado WHERE status IN ('aberto','em_atendimento','aguardando_cliente')");
            var chamadosNovos = await conn.ExecuteScalarAsync<int>(
                "SELECT count(*) FROM chamado WHERE status = 'aberto' AND criado_em >= now() - interval '24 hours'");
            var errosAbertos = await conn.ExecuteScalarAsync<int>(
                "SELECT count(*) FROM erro_sistema WHERE resolvido = false");
            var errosNovos = await conn.ExecuteScalarAsync<int>(
                "SELECT count(*) FROM erro_sistema WHERE resolvido = false AND ocorrido_em >= now() - interval '24 hours'");
            return Results.Ok(new { chamadosAbertos, chamadosNovos, errosAbertos, errosNovos });
        });

        g.MapGet("/chamados/{id:guid}/anexos", async (Guid id, ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            return Results.Ok(await conn.QueryAsync(
                "SELECT * FROM sa_chamado_anexos(@id)", new { id }));
        });

        g.MapGet("/chamados/anexos/{anexoId:guid}", async (Guid anexoId, ClaimsPrincipal user,
            NpgsqlDataSource ds, IConfiguration cfg) =>
        {
            if (!Ok(user)) return Results.Forbid();
            await using var conn = await ds.OpenConnectionAsync();
            var a = await conn.QuerySingleOrDefaultAsync(
                "SELECT * FROM sa_chamado_anexo(@anexoId)", new { anexoId });
            if (a is null) return Results.NotFound();
            var url = ((string)a.chave_s3).Replace("s3://", "");
            var barra = url.IndexOf('/');
            var bucket = url[..barra];
            var chave = url[(barra + 1)..];
            var s3 = new AmazonS3Client(cfg["S3:AccessKey"], cfg["S3:SecretKey"],
                new AmazonS3Config { ServiceURL = cfg["S3:Endpoint"] ?? "http://minio:9000",
                    ForcePathStyle = true, AuthenticationRegion = "us-east-1" });
            try
            {
                using var r = await s3.GetObjectAsync(bucket, chave);
                using var ms = new MemoryStream();
                await r.ResponseStream.CopyToAsync(ms);
                return Results.File(ms.ToArray(), (string)a.content_type, (string)a.nome_arquivo);
            }
            catch (AmazonS3Exception) { return Results.NotFound(); }
        });
    }

    // ── Helpers de exportação CSV ────────────────────────────────

    // Junta campos numa linha CSV, escapando aspas/;/quebras
    static string CsvJoin(params string?[] campos) =>
        string.Join(";", campos.Select(EscaparCsv));

    // Versão que recebe um array já montado (para reusar a mesma lógica CSV/PDF)
    static string CsvJoinArr(string[] campos) =>
        string.Join(";", campos.Select(c => EscaparCsv(c)));

    static string EscaparCsv(string? v)
    {
        v ??= "";
        // Se tem separador, aspas ou quebra de linha, envolve em aspas
        if (v.Contains(';') || v.Contains('"') || v.Contains('\n') || v.Contains('\r'))
            return "\"" + v.Replace("\"", "\"\"") + "\"";
        return v;
    }

    // Monta o CSV completo (cabeçalho + linhas), com separador ; (padrão Excel-BR)
    static string MontarCsv(string[] cabecalho, IEnumerable<string> linhas)
    {
        var sb = new System.Text.StringBuilder();
        sb.Append("sep=;\r\n");   // dica ao Excel: usar ; como separador
        sb.Append(string.Join(";", cabecalho.Select(EscaparCsv))).Append("\r\n");
        foreach (var l in linhas) sb.Append(l).Append("\r\n");
        return sb.ToString();
    }

    // Resultado de arquivo CSV com BOM UTF-8 (acentos corretos no Excel)
    static IResult CsvResult(string csv, string nomeArquivo)
    {
        var bom = new byte[] { 0xEF, 0xBB, 0xBF };
        var corpo = System.Text.Encoding.UTF8.GetBytes(csv);
        var bytes = new byte[bom.Length + corpo.Length];
        Buffer.BlockCopy(bom, 0, bytes, 0, bom.Length);
        Buffer.BlockCopy(corpo, 0, bytes, bom.Length, corpo.Length);
        return Results.File(bytes, "text/csv; charset=utf-8", nomeArquivo);
    }

    static string Dt(object? v) =>
        v is DateTime dt ? dt.ToLocalTime().ToString("dd/MM/yyyy HH:mm") : "";

    static string PapelExt(string? p) => p switch
    {
        "super_admin" => "Super-admin", "admin" => "Administrador",
        "responsavel_tecnico" => "Responsável Técnico", "tecnico" => "Técnico",
        _ => p ?? ""
    };

    static string AcaoExt(string? a) => a switch
    {
        "login" => "Login", "insert" => "Criação", "update" => "Alteração",
        "delete" => "Exclusão", "emissao" => "Emissão", "visualizar_super_admin" => "Visualização (super-admin)",
        _ => a ?? ""
    };
}
