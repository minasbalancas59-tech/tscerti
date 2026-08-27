# Etapa 2 — Deploy e roteiro de testes

## Deploy (na VPS)

1. **Suba os arquivos novos** (FileZilla): substitua a pasta `src/Api`
   inteira, adicione `db/seed/`, e substitua `docker-compose.yml`.

2. **Edite os dois EDITE_AQUI dos seeds**:

       nano db/seed/10_app_role.sql   # senha do api_app
       nano db/seed/11_empresas.sql   # CNPJ e email do admin

3. **Adicione ao .env** as duas linhas novas (mesma senha do passo 2):

       nano .env
       # APP_DB_USER=api_app
       # APP_DB_PASSWORD=a-senha-que-voce-escolheu

4. **Rode os seeds** (o banco já existe, então é manual mesmo):

       sed -i 's/\r$//' db/seed/*.sql
       docker compose exec -T db psql -U certsaas -d certsaas < db/seed/10_app_role.sql
       docker compose exec -T db psql -U certsaas -d certsaas < db/seed/11_empresas.sql

5. **Rebuild da API**:

       docker compose up -d --build api
       curl http://localhost:8080/health

## Roteiro de testes (pode rodar da própria VPS)

**T1 — Login** (use o email/senha do seed):

    curl -s -X POST http://localhost:8080/api/auth/login \
      -H "Content-Type: application/json" \
      -d '{"email":"SEU_EMAIL_DO_SEED","senha":"MudarJa!2026"}'

Esperado: JSON com `token`. Guarde-o numa variável:

    TOKEN="cole_o_token_aqui"

**T2 — Senha errada devolve 401 e vai pra auditoria**:

    curl -s -o /dev/null -w "%{http_code}\n" -X POST \
      http://localhost:8080/api/auth/login \
      -H "Content-Type: application/json" \
      -d '{"email":"SEU_EMAIL_DO_SEED","senha":"errada"}'

**T3 — Criar um cliente**:

    curl -s -X POST http://localhost:8080/api/clientes \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
      -d '{"razaoSocial":"Rio Branco Alimentos S/A","cidade":"Visconde do Rio Branco","uf":"MG"}'

Esperado: `{"id":"..."}`. Guarde: `CLIENTE="id_retornado"`

**T4 — Criar uma balança nesse cliente**:

    curl -s -X POST http://localhost:8080/api/clientes/$CLIENTE/balancas \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
      -d '{"identificacao":"BAL-01","tipo":"rodoviaria","marca":"Toledo","modelo":"8530","capacidade":80000,"divisaoE":20,"classeExatidao":"III"}'

**T5 — Validação funcionando** (capacidade inválida → 400):

    curl -s -X POST http://localhost:8080/api/clientes/$CLIENTE/balancas \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
      -d '{"identificacao":"BAL-X","tipo":"rodoviaria","capacidade":0,"divisaoE":20,"classeExatidao":"III"}'

**T6 — Cadastrar peso padrão (admin)**:

    curl -s -X POST http://localhost:8080/api/pesos \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
      -d '{"identificacao":"MB-P01","valorNominal":500,"classe":"M1","validade":"2027-10-01"}'

**T7 — TESTE DE FOGO do multiempresa.** Logue na empresa de teste:

    curl -s -X POST http://localhost:8080/api/auth/login \
      -H "Content-Type: application/json" \
      -d '{"email":"admin@teste.local","senha":"Teste!2026"}'
    TOKEN2="token_da_empresa_teste"

Liste os clientes de cada uma:

    curl -s http://localhost:8080/api/clientes -H "Authorization: Bearer $TOKEN"
    curl -s http://localhost:8080/api/clientes -H "Authorization: Bearer $TOKEN2"

**Critério de aceite**: a primeira lista mostra só a Rio Branco;
a segunda, só o "Cliente Secreto da Outra Empresa". Nenhum
cruzamento = RLS aprovado.

**T8 — Sem token → 401**:

    curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/api/clientes

**T9 — Troque a senha inicial do admin**:

    curl -s -X PUT http://localhost:8080/api/auth/senha \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
      -d '{"senhaAtual":"MudarJa!2026","novaSenha":"SUA_SENHA_DEFINITIVA"}'

**T10 — Auditoria registrando** (direto no banco):

    docker compose exec db psql -U certsaas -d certsaas \
      -c "SELECT acao, entidade, ip_origem, criado_em FROM log_auditoria ORDER BY criado_em DESC LIMIT 10;"

Todos os testes também funcionam de fora, trocando
`http://localhost:8080` por `https://certificados.minasbalancas.com.br`
(ou via Postman/Insomnia no Windows).
