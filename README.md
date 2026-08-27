# SaaS de Certificados de Calibração

Sistema multiempresa para emissão de certificados de calibração de balanças,
com portal do cliente, validação por QR Code e PWA de campo.

## Arquitetura

| Serviço  | Papel                                        | Porta local |
|----------|----------------------------------------------|-------------|
| api      | API REST (.NET 8, JWT, RLS por tenant)       | 8080        |
| worker   | Fila: gera PDF, envia email, alertas         | —           |
| db       | PostgreSQL 16 (schema + RLS em db/init)      | 5432        |
| redis    | Fila de tarefas                              | —           |
| minio    | Storage S3 dos PDFs (console em :9001)       | 9000/9001   |
| mailpit  | Email fake de desenvolvimento (web em :8025) | 8025        |

## Subindo pela primeira vez

```bash
cp .env.example .env       # edite as senhas!
docker compose up -d --build
curl http://localhost:8080/health
```

Os scripts em `db/init/` (schema completo + seed de EMA) rodam
automaticamente na primeira subida do Postgres. Para recriar o banco
do zero: `docker compose down -v && docker compose up -d`.

## Pontos de atenção

- **RLS**: a API executa `SET app.empresa_id` a cada request com o valor
  do JWT. Crie um usuário de banco sem privilégio de superusuário para a
  aplicação (instruções comentadas no fim de `01_schema.sql`) — o
  superusuário ignora RLS.
- **Imutabilidade**: certificado com status `emitido` é travado por
  trigger no banco. Alteração exige emitir revisão (novo registro
  apontando para `cert_original_id`).
- **Numeração**: sempre via `SELECT emitir_certificado(id)` — nunca
  atribua número manualmente.
- **Seed de EMA**: confira `db/init/02_seed_ema.sql` contra o texto
  vigente da Portaria Inmetro 157/2022 antes de emitir certificados reais.
- **Produção**: coloque um nginx na VPS fazendo proxy 443 → 8080 com
  certificado do Let's Encrypt (certbot), e troque o Mailpit por um
  provedor SMTP real no `.env`.

## Roadmap (resumo)

1. Fundações — este esqueleto ✔
2. Cadastros + auth multiempresa
3. Motor de calibração (ensaios, EMA, incerteza)
4. Emissão (PDF, hash, QR, email)
5. Portal do cliente + alertas de vencimento
6. PWA offline com sincronização
7. Piloto em produção
8. Abertura do SaaS (cobrança, onboarding)
