using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using CertSaas.Api.Infra;
using Dapper;
using Microsoft.IdentityModel.Tokens;
using Npgsql;
using StackExchange.Redis;

namespace CertSaas.Api.Auth;

public sealed class TokenService(IConfiguration cfg)
{
    public (string token, DateTime expiraEm) Gerar(
        Guid usuarioId, Guid empresaId, string nome, string papel, Guid sessaoId)
    {
        var expira = DateTime.UtcNow.AddHours(8);
        var claims = new[]
        {
            new Claim("sub", usuarioId.ToString()),
            new Claim("empresa_id", empresaId.ToString()),
            new Claim("nome", nome),
            new Claim("papel", papel),
            new Claim("sid", sessaoId.ToString())
        };
        var key = new SymmetricSecurityKey(
            Encoding.UTF8.GetBytes(cfg["Jwt:Secret"]!));
        var jwt = new JwtSecurityToken(
            issuer: cfg["Jwt:Issuer"],
            claims: claims,
            expires: expira,
            signingCredentials: new SigningCredentials(key, SecurityAlgorithms.HmacSha256));
        return (new JwtSecurityTokenHandler().WriteToken(jwt), expira);
    }

    /// <summary>
    /// Token de VISUALIZAÇÃO (impersonação somente-leitura) para o super-admin
    /// inspecionar os dados de uma empresa. Mantém o papel efetivo de leitura,
    /// carrega a empresa-alvo e marca impersonando=true para bloquear escritas.
    /// Guarda também o id e nome do super-admin de origem (para o banner e auditoria).
    /// </summary>
    public (string token, DateTime expiraEm) GerarVisualizacao(
        Guid superAdminId, string superAdminNome, Guid empresaAlvo, string empresaNome, Guid sessaoId,
        string papel = "responsavel_tecnico")
    {
        var expira = DateTime.UtcNow.AddHours(2);   // sessão de visualização mais curta
        var claims = new[]
        {
            new Claim("sub", superAdminId.ToString()),  // continua sendo o super-admin
            new Claim("empresa_id", empresaAlvo.ToString()),
            new Claim("nome", superAdminNome),
            new Claim("papel", papel),  // papel escolhido pelo super admin (admin/RT/tecnico)
            new Claim("sid", sessaoId.ToString()),
            new Claim("impersonando", "true"),
            new Claim("sa_origem", superAdminId.ToString()),
            new Claim("empresa_nome", empresaNome)
        };
        var key = new SymmetricSecurityKey(
            Encoding.UTF8.GetBytes(cfg["Jwt:Secret"]!));
        var jwt = new JwtSecurityToken(
            issuer: cfg["Jwt:Issuer"],
            claims: claims,
            expires: expira,
            signingCredentials: new SigningCredentials(key, SecurityAlgorithms.HmacSha256));
        return (new JwtSecurityTokenHandler().WriteToken(jwt), expira);
    }
}

public record LoginRequest(string Email, string Senha);
public record TrocarSenhaRequest(string SenhaAtual, string NovaSenha);
public record DefinirSenhaRequest(string Token, string NovaSenha);

public static class AuthEndpoints
{
    public static void Map(WebApplication app)
    {
        // ── Definir senha por convite (público, pré-login) ─────
        // Usa função SECURITY DEFINER (RLS bloquearia o UPDATE direto).
        app.MapPost("/api/auth/definir-senha", async (
            DefinirSenhaRequest req, NpgsqlDataSource ds,
            IConnectionMultiplexer redis) =>
        {
            if (string.IsNullOrWhiteSpace(req.Token))
                return Results.BadRequest(new { erro = "Link inválido." });
            if (req.NovaSenha is null || req.NovaSenha.Length < 8)
                return Results.BadRequest(new { erro = "Senha: mínimo 8 caracteres." });

            await using var conn = await ds.OpenConnectionAsync();
            var id = await conn.ExecuteScalarAsync<Guid?>(
                "SELECT auth_definir_senha_por_token(@token, @hash)",
                new { token = req.Token.Trim(),
                    hash = BCrypt.Net.BCrypt.HashPassword(req.NovaSenha, 12) });
            if (id is null)
                return Results.BadRequest(new { erro =
                    "Link inválido ou expirado. Peça um novo convite ao administrador." });

            await redis.GetDatabase().ListLeftPushAsync("fila:tarefas",
                "{\"tipo\":\"email_confirmacao\",\"usuario_id\":\"" + id + "\"}");
            return Results.Ok(new { definida = true });
        });

        // ── Login ───────────────────────────────────────────────
        // Usa a função SECURITY DEFINER auth_buscar_usuario porque,
        // antes do login, não há tenant na sessão e o RLS bloquearia
        // a leitura direta da tabela usuario.
        app.MapPost("/api/auth/login", async (
            LoginRequest req, NpgsqlDataSource ds, TokenService tokens,
            HttpContext ctx) =>
        {
            if (string.IsNullOrWhiteSpace(req.Email) ||
                string.IsNullOrWhiteSpace(req.Senha))
                return Results.BadRequest(new { erro = "Informe email e senha." });

            await using var conn = await ds.OpenConnectionAsync();

            // Aplica o bloqueio automático por contrato vencido (carência
            // esgotada) antes de verificar o status da empresa no login
            try { await conn.ExecuteAsync("SELECT sa_aplicar_bloqueio_contratos()"); }
            catch { /* função pode não existir em bases antigas; login segue */ }

            var u = await conn.QuerySingleOrDefaultAsync<UsuarioLogin>(
                "SELECT * FROM auth_buscar_usuario(@email)",
                new { email = req.Email.Trim().ToLowerInvariant() });

            var ip = Auditoria.Ip(ctx);

            // 1) Credencial: se o usuário não existe ou a senha está errada,
            //    resposta genérica de propósito (não revelar se o email existe)
            if (u is null || !BCrypt.Net.BCrypt.Verify(req.Senha, u.SenhaHash))
            {
                await Auditoria.Registrar(conn, u?.EmpresaId, u?.Id,
                    "usuario", u?.Id, "login_falha",
                    new { email = req.Email }, ip);
                if (u is null) return Results.Unauthorized();
                // Conta a tentativa e bloqueia na 5ª (seguidas; zera ao acertar)
                var tent = await conn.QuerySingleAsync<(int Tentativas, bool Bloqueado)>(
                    "SELECT * FROM auth_erro_senha(@id, 5)", new { id = u.Id });
                var msgSenha = tent.Bloqueado
                    ? "Conta bloqueada por excesso de tentativas. Use \"Esqueci minha senha\" para redefinir."
                    : $"Email ou senha incorretos. Tentativa {tent.Tentativas} de 5.";
                return Results.Json(new { erro = msgSenha, tentativas = tent.Tentativas,
                    bloqueado = tent.Bloqueado }, statusCode: 401);
            }

            // Conta bloqueada por tentativas: mesmo com a senha certa,
            // exige redefinição (segurança)
            if (u.BloqueadoLogin)
            {
                await Auditoria.Registrar(conn, u.EmpresaId, u.Id,
                    "usuario", u.Id, "login_bloqueado",
                    new { motivo = "excesso_tentativas" }, ip);
                return Results.Json(new { erro = "Sua conta foi bloqueada por excesso de tentativas de senha. " +
                    "Use \"Esqueci minha senha\" para redefinir e voltar a acessar." }, statusCode: 403);
            }

            // 2) Senha correta: agora é seguro informar o motivo real
            if (!u.Ativo)
            {
                await Auditoria.Registrar(conn, u.EmpresaId, u.Id,
                    "usuario", u.Id, "login_bloqueado",
                    new { motivo = "usuario_inativo" }, ip);
                return Results.Json(new { erro = "Seu usuário está bloqueado. Fale com o administrador da sua empresa." },
                    statusCode: 403);
            }
            // O super_admin NUNCA é barrado pelo status da empresa: ele
            // administra o SaaS e não pode ser trancado para fora por uma
            // regra automática (contrato/suspensão) que atinja a empresa SISTEMA.
            if (u.Papel != "super_admin" && u.EmpresaStatus != "ativa")
            {
                await Auditoria.Registrar(conn, u.EmpresaId, u.Id,
                    "usuario", u.Id, "login_bloqueado",
                    new { motivo = "empresa_" + u.EmpresaStatus }, ip);
                var msg = u.MotivoSuspensao == "contrato_vencido"
                    ? "O acesso da sua empresa está suspenso por contrato vencido. Entre em contato para regularizar."
                    : u.MotivoSuspensao == "avaliacao_encerrada"
                    ? "O período de avaliação de 30 dias terminou. Contrate um plano com a Total Scale — (31) 3357-4000 — para reativar o acesso. Seus dados estão preservados."
                    : u.EmpresaStatus == "cancelada"
                        ? "O acesso da sua empresa foi encerrado. Entre em contato para mais informações."
                        : "O acesso da sua empresa está suspenso. Entre em contato para regularizar.";
                return Results.Json(new { erro = msg }, statusCode: 403);
            }

            // Login ok: zera o contador de tentativas
            await conn.ExecuteAsync("SELECT auth_zerar_tentativas(@id)", new { id = u.Id });

            // Sessão única: cada login gera um novo sid e invalida o anterior
            var sid = await conn.ExecuteScalarAsync<Guid>(
                "SELECT auth_nova_sessao(@id)", new { id = u.Id });
            var (token, expiraEm) = tokens.Gerar(u.Id, u.EmpresaId, u.Nome, u.Papel, sid);
            await Auditoria.Registrar(conn, u.EmpresaId, u.Id,
                "usuario", u.Id, "login_ok", null, ip);

            return Results.Ok(new
            {
                token, expiraEm,
                usuario = new { u.Id, u.Nome, u.Papel, u.Empresa }
            });
        });

        // ── Esqueci a senha (público) ───────────────────────────
        app.MapPost("/api/auth/esqueci-senha", async (
            EsqueciSenhaRequest req, NpgsqlDataSource ds, IConfiguration cfg,
            StackExchange.Redis.IConnectionMultiplexer redis, HttpContext ctx) =>
        {
            if (string.IsNullOrWhiteSpace(req.Email) || !req.Email.Contains('@'))
                return Results.BadRequest(new { erro = "Informe um email válido." });
            await using var conn = await ds.OpenConnectionAsync();
            var r = await conn.QuerySingleOrDefaultAsync(
                "SELECT * FROM auth_iniciar_reset(@email)",
                new { email = req.Email.Trim().ToLowerInvariant() });
            if (r is not null)
            {
                var urlBase = cfg["App:UrlBase"] ?? $"{ctx.Request.Scheme}://{ctx.Request.Host}";
                var link = $"{urlBase}/#reset={(string)r.token}";
                await redis.GetDatabase().ListLeftPushAsync("fila:tarefas",
                    $"{{\"tipo\":\"email_reset_senha\",\"usuario_id\":\"{(Guid)r.id}\",\"link\":\"{link}\"}}");
            }
            // Resposta sempre genérica: não revela se o email existe
            return Results.Ok(new { mensagem =
                "Se o email estiver cadastrado, enviaremos um link de redefinição. Verifique sua caixa de entrada." });
        });

        // ── Redefinir a senha pelo link (público) ───────────────
        app.MapPost("/api/auth/redefinir-senha", async (
            RedefinirSenhaRequest req, NpgsqlDataSource ds) =>
        {
            if (string.IsNullOrWhiteSpace(req.Token))
                return Results.BadRequest(new { erro = "Link inválido." });
            if (string.IsNullOrWhiteSpace(req.NovaSenha) || req.NovaSenha.Length < 8)
                return Results.BadRequest(new { erro = "A nova senha deve ter ao menos 8 caracteres." });
            await using var conn = await ds.OpenConnectionAsync();
            var ok = await conn.ExecuteScalarAsync<bool>(
                "SELECT auth_redefinir_senha(@t, @h)",
                new { t = req.Token.Trim(),
                      h = BCrypt.Net.BCrypt.HashPassword(req.NovaSenha, 12) });
            return ok
                ? Results.Ok(new { mensagem = "Senha redefinida com sucesso. Faça login." })
                : Results.BadRequest(new { erro = "Link inválido ou expirado. Solicite a redefinição novamente." });
        });

        // ── Trocar a própria senha ──────────────────────────────
        app.MapPut("/api/auth/senha", async (
            TrocarSenhaRequest req, ClaimsPrincipal user, NpgsqlDataSource ds) =>
        {
            if (string.IsNullOrWhiteSpace(req.NovaSenha) || req.NovaSenha.Length < 8)
                return Results.BadRequest(new { erro = "Nova senha deve ter ao menos 8 caracteres." });

            await using var conn = await Tenant.AbrirConexao(ds, user);
            var uid = Tenant.UsuarioId(user);

            var hashAtual = await conn.ExecuteScalarAsync<string?>(
                "SELECT senha_hash FROM usuario WHERE id = @uid", new { uid });
            if (hashAtual is null || !BCrypt.Net.BCrypt.Verify(req.SenhaAtual, hashAtual))
                return Results.BadRequest(new { erro = "Senha atual incorreta." });

            await conn.ExecuteAsync(
                "UPDATE usuario SET senha_hash = @hash WHERE id = @uid",
                new { hash = BCrypt.Net.BCrypt.HashPassword(req.NovaSenha, 12), uid });

            await Auditoria.Registrar(conn, Tenant.EmpresaId(user), uid,
                "usuario", uid, "troca_senha", null, null);
            return Results.Ok(new { mensagem = "Senha alterada." });
        }).RequireAuthorization();
    }

    private sealed record EsqueciSenhaRequest(string Email);
    private sealed record RedefinirSenhaRequest(string Token, string NovaSenha);
    private sealed record UsuarioLogin(
        Guid Id, Guid EmpresaId, string Nome, string Papel,
        string SenhaHash, bool Ativo, string Empresa, string EmpresaStatus,
        string? MotivoSuspensao, int TentativasLogin, bool BloqueadoLogin);
}

        
