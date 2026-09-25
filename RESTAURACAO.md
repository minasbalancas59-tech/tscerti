# Restauração total — VPS nova do zero

Guia pra reconstruir o TSCert inteiro numa VPS nova, caso a atual
(`216.144.247.115`) morra ou fique inacessível. Testado/documentado em
25/09/2026, contra o estado real do servidor de produção.

**Antes de começar, você precisa ter em mãos:**

1. Acesso a uma conta na Hetzner/DigitalOcean/etc. pra criar a VPS nova.
2. Acesso ao Google Drive onde os backups ficam (`gdrive:cert-saas-backups`).
3. **O arquivo `~/.config/rclone/rclone.conf` de uma cópia salva à parte**
   (ver nota de segurança abaixo — ele NÃO está em nenhum backup
   automático, de propósito).
4. Acesso ao painel de DNS dos domínios (`totalscale.com.br` e
   `minasbalancas.com.br`) pra apontar os registros A pro IP novo.
5. Uma chave SSH sua (pode gerar uma nova na hora).

> **Nota de segurança sobre o `rclone.conf`**: ele contém o token de
> acesso à sua conta do Google Drive. De propósito, ele **não** é
> incluído em nenhum backup automático — colocar a chave de acesso ao
> cofre DENTRO do próprio cofre não ajuda se o Drive ficar inacessível
> ou a VPS for comprometida. Guarde uma cópia dele (`scp` pra sua
> máquina) num gerenciador de senhas ou local seguro separado, e
> atualize essa cópia sempre que reconfigurar o rclone. **Isto ainda
> não foi feito — é uma ação sua, não automatizável com segurança.**
> Alternativa se você perder essa cópia: rode `rclone config reconnect
> gdrive:` na VPS nova e reautorize pelo navegador — funciona, só
> exige um passo manual interativo.

---

## 1 · Provisionar a VPS nova

- Ubuntu 22.04 LTS (mesma versão da atual), no mínimo 4 GB RAM / 2 vCPU
  / 80 GB disco (a atual usa ~20-25 GB hoje, mas o `docker builder
  prune` já é rotina — dê folga).
- Anote o IP novo — vai precisar pra apontar o DNS no passo 9.

## 2 · Configuração inicial do Linux

```bash
# Conectar como root pela primeira vez, depois:
apt update && apt upgrade -y

# Fuso horário (crítico — o sistema inteiro depende disso pra datas
# de calibração/vencimento baterem certo)
timedatectl set-timezone America/Sao_Paulo

# Usuário próprio + chave SSH (não fique só no root)
adduser deploy
usermod -aG sudo deploy
mkdir -p /home/deploy/.ssh
# cole sua chave pública em /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh && chmod 600 /home/deploy/.ssh/authorized_keys

# Firewall — só o essencial (SSH, HTTP, HTTPS)
apt install -y ufw
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# Proteção contra força bruta no SSH
apt install -y fail2ban
systemctl enable --now fail2ban

# Atualizações de segurança automáticas
apt install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades
```

> **Diferente do servidor atual**: no `216.144.247.115` hoje,
> `PasswordAuthentication` ainda está `yes` no SSH (veio da imagem
> padrão do provedor) — numa VPS nova, comece já **sem** essa
> pendência: em `/etc/ssh/sshd_config.d/99-hardening.conf`, adicione
> `PasswordAuthentication no` e `PermitRootLogin no` antes de colocar
> em produção, e reinicie o SSH (`systemctl restart ssh`) só depois de
> confirmar que a chave funciona num terminal separado.

## 3 · Docker + Docker Compose

```bash
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy
```
(A versão atual em produção é Docker 29.7.2 / Compose v5.5.0 — o
script oficial acima sempre traz a mais recente, o que é adequado.)

## 4 · nginx + certbot

```bash
apt install -y nginx certbot python3-certbot-nginx
systemctl enable --now nginx
```

## 5 · Restaurar o acesso ao Google Drive (rclone)

```bash
apt install -y rclone
mkdir -p ~/.config/rclone
# copie sua cópia salva do rclone.conf pra cá, OU:
rclone config reconnect gdrive:   # reautoriza pelo navegador, se não tiver a cópia
rclone lsl gdrive:cert-saas-backups --max-age 2d   # confere que enxerga os backups recentes
```

## 6 · Clonar o projeto

```bash
cd /root   # ou /home/deploy, mantendo consistência com os scripts (eles assumem /root/cert-saas)
git clone https://github.com/minasbalancas59-tech/tscerti.git cert-saas
cd cert-saas
```

## 7 · Restaurar o `.env`

O `.env` vem dentro do backup do PROJETO (não do banco):

```bash
# baixa o backup de projeto mais recente
rclone copy gdrive:cert-saas-backups/projeto/ /root/backups/ \
  --include "projeto_*.tar.gz" --max-age 3d

# pega o mais recente e extrai só o .env
ARQ=$(ls -t /root/backups/projeto_*.tar.gz | head -1)
tar xzf "$ARQ" -C /tmp cert-saas/.env
cp /tmp/cert-saas/.env /root/cert-saas/.env
chmod 600 /root/cert-saas/.env
```

Confira o `.env` restaurado — as variáveis esperadas (ver
`docker-compose.yml`) são: `DB_NAME`, `DB_USER`, `DB_PASSWORD`,
`APP_DB_USER`, `APP_DB_PASSWORD`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`,
`S3_BUCKET`, `JWT_SECRET`, `JWT_ISSUER`, `SMTP_HOST`, `SMTP_PORT`,
`SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`.

## 8 · Baixar os backups de dados mais recentes

```bash
mkdir -p /root/backups
rclone copy gdrive:cert-saas-backups/ /root/backups/ \
  --include "{db,minio}_*.{sql.gz,tar.gz}" --max-age 2d
ls -lh /root/backups/
```

## 9 · Subir o banco, restaurar, só depois subir a aplicação

**Cuidado com a ordem** — `docker compose up` roda os scripts de
`db/init/` sozinho na primeira subida (cria o schema do zero), e o
dump do backup TAMBÉM traz o schema completo (`pg_dump` sem
`--clean`). Aplicar o dump por cima do schema que o `init` já criou dá
erro em cada tabela ("already exists"). A ordem que evita isso:

```bash
cd /root/cert-saas

# 1) só a infraestrutura de dados por enquanto — NÃO api/worker ainda
#    (o banco roda o init sozinho na primeira subida; minio não tem
#    esse problema, pode subir junto)
docker compose up -d db redis minio
docker compose ps db minio   # os dois "healthy"?

# 2) limpa o schema recem-criado pelo init — o dump do backup vai
#    recriar tudo (schema + dados) sozinho, sem conflito
docker compose exec -T db psql -U certsaas -d certsaas -c \
  "DROP SCHEMA public CASCADE; CREATE SCHEMA public;
   GRANT ALL ON SCHEMA public TO certsaas; GRANT ALL ON SCHEMA public TO public;"

# 3) agora sim restaura banco + arquivos (pede confirmação "CONFIRMO")
./restaurar.sh /root/backups/db_AAAA-MM-DD_HH-MM.sql.gz /root/backups/minio_AAAA-MM-DD_HH-MM.tar.gz

# 4) só agora sobe api e worker — já encontram o banco pronto
docker compose up -d --build
docker compose ps   # todos "healthy"/"running"?

# prova que restaurou certo (mesmo script usado na produção atual)
./testar-restauracao.sh /root/backups/db_AAAA-MM-DD_HH-MM.sql.gz
```

## 10 · nginx: os 4 domínios + certificados TLS

O sistema atende 4 domínios (confira `git log`/README se a lista
mudou): `certificados.totalscale.com.br`, `portalclientes.totalscale.com.br`,
`tscerti.totalscale.com.br`, `certificados.minasbalancas.com.br` — todos
proxy reverso pra `127.0.0.1:8080`.

As 3 configs (o 4º domínio, `portalclientes`, está dentro de
`totalscale.com.br`) ficam versionadas em `infra/nginx/` neste mesmo
repositório — vêm junto no `git clone` do passo 6, então não dependem
de nenhuma cópia separada. **Importante**: elas já referenciam os
certificados do Let's Encrypt (`ssl_certificate /etc/letsencrypt/live/...`)
— o nginx não sobe com esse config ANTES desses arquivos existirem.
Por isso, emita os certificados primeiro, com o nginx ainda "cru":

**Aponte o DNS agora** (passo 11) antes de emitir os certificados — o
certbot valida por HTTP, então cada domínio já precisa resolver pro IP
novo.

```bash
# 1) Certificados primeiro (--nginx encontra a porta 80 sozinho,
#    mesmo sem nenhum site configurado ainda)
certbot certonly --nginx -d certificados.totalscale.com.br
certbot certonly --nginx -d portalclientes.totalscale.com.br
certbot certonly --nginx -d tscerti.totalscale.com.br
certbot certonly --nginx -d certificados.minasbalancas.com.br

# 2) Só agora os configs completos (já podem referenciar os
#    certificados, que acabaram de ser criados)
mkdir -p /var/www/manutencao /var/www/html
cp infra/nginx/totalscale.com.br /etc/nginx/sites-available/
cp infra/nginx/tscerti /etc/nginx/sites-available/
cp infra/nginx/certificados.minasbalancas.com.br /etc/nginx/sites-available/

ln -s /etc/nginx/sites-available/totalscale.com.br /etc/nginx/sites-enabled/
ln -s /etc/nginx/sites-available/tscerti /etc/nginx/sites-enabled/
ln -s /etc/nginx/sites-available/certificados.minasbalancas.com.br /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

## 11 · DNS

No painel do registrador de cada domínio, aponte os registros **A**
pro IP novo da VPS:
- `certificados.totalscale.com.br`
- `portalclientes.totalscale.com.br`
- `tscerti.totalscale.com.br`
- `certificados.minasbalancas.com.br`

Propagação pode levar de minutos a algumas horas — teste com
`dig +short <dominio>` até bater com o IP novo antes do passo 10.

## 12 · Recriar o crontab

```bash
crontab -e
```
Cole:
```cron
0 3 * * * /root/cert-saas/backup.sh >> /root/cert-saas/backup.log 2>&1
30 3 * * * /root/cert-saas/backup-projeto.sh >> /root/cert-saas/backup.log 2>&1
25 3 */5 * * cd /root/cert-saas && ./testar-restauracao.sh >> /root/cert-saas/backup.log 2>&1
```

## 13 · Validação final

- [ ] `docker compose ps` — todos os containers `healthy`
- [ ] `curl https://certificados.totalscale.com.br/health` — responde
- [ ] Login funciona (teste com um usuário real ou `sa/ver-documento`)
- [ ] Um certificado antigo abre e o PDF baixa certo (prova que o MinIO
      restaurou)
- [ ] `./testar-restauracao.sh` rodado manualmente uma vez — confirma
      que o NOVO backup.sh (rodando no servidor novo) também restaura
- [ ] `crontab -l` confere com o passo 12
- [ ] `rclone lsl gdrive:cert-saas-backups --max-age 1d` — o backup de
      hoje já foi enviado (prova que o rclone.conf restaurado funciona
      de verdade, não só existe)

---

*Documento gerado em 25/09/2026 a partir da configuração real do
servidor de produção (nginx, certbot, ufw, fail2ban, Docker, crontab).
Atualize esta lista de domínios/passos se a infraestrutura mudar —
ele só serve se continuar batendo com a realidade.*
