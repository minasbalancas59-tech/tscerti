#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# Instala a página de manutenção do TSCert para o nginx da VPS.
#
# O que faz:
#   1) Cria /var/www/manutencao
#   2) Copia manutencao.html para lá
#   3) Ajusta as permissões para o nginx ler
#   4) Mostra os próximos passos (edição do nginx)
#
# NÃO mexe na configuração do nginx sozinho (isso é manual, por
# segurança). Só prepara a página.
#
# Uso (no servidor):
#   cd /root/cert-saas/deploy
#   chmod +x instalar-manutencao.sh
#   sudo ./instalar-manutencao.sh
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

# Diretório onde este script está (para achar o manutencao.html ao lado)
DIR_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ORIGEM="$DIR_SCRIPT/manutencao.html"
DESTINO_DIR="/var/www/manutencao"
DESTINO="$DESTINO_DIR/manutencao.html"

# Precisa ser root (para escrever em /var/www e recarregar o nginx)
if [[ $EUID -ne 0 ]]; then
    echo "❌ Rode com sudo:  sudo ./instalar-manutencao.sh"
    exit 1
fi

# Confere se o arquivo de origem existe
if [[ ! -f "$ORIGEM" ]]; then
    echo "❌ Não encontrei manutencao.html em: $ORIGEM"
    echo "   Certifique-se de rodar o script de dentro da pasta deploy/."
    exit 1
fi

echo "→ Criando $DESTINO_DIR ..."
mkdir -p "$DESTINO_DIR"

echo "→ Copiando a página de manutenção ..."
cp "$ORIGEM" "$DESTINO"

echo "→ Ajustando permissões (leitura para o nginx) ..."
chmod 644 "$DESTINO"
# www-data é o usuário padrão do nginx no Ubuntu/Debian
if id www-data >/dev/null 2>&1; then
    chown www-data:www-data "$DESTINO_DIR" "$DESTINO"
fi

echo ""
echo "✅ Página de manutenção instalada em: $DESTINO"
echo ""
echo "─────────────────────────────────────────────────────────────"
echo "PRÓXIMO PASSO (manual — edição do nginx):"
echo ""
echo "1) Abra a config do seu site, por exemplo:"
echo "     sudo nano /etc/nginx/sites-available/certificados.minasbalancas.com.br"
echo ""
echo "2) FAÇA BACKUP antes de editar:"
echo "     sudo cp {arquivo} {arquivo}.bak"
echo ""
echo "3) Dentro do server { } que faz proxy para a API, adicione:"
echo ""
echo "     root /var/www/manutencao;"
echo "     error_page 502 503 504 = @manutencao;"
echo ""
echo "     location @manutencao {"
echo "         default_type text/html;"
echo "         add_header Retry-After 30 always;"
echo "         add_header Cache-Control \"no-store\" always;"
echo "         try_files /manutencao.html =503;"
echo "     }"
echo ""
echo "   E no location / (o do proxy_pass), acrescente:"
echo "         proxy_connect_timeout 3s;"
echo "         proxy_next_upstream error timeout http_502 http_503 http_504;"
echo ""
echo "4) Teste e recarregue:"
echo "     sudo nginx -t"
echo "     sudo systemctl reload nginx"
echo ""
echo "5) Para TESTAR a página:"
echo "     cd /root/cert-saas && docker compose stop api"
echo "     (acesse o site — deve mostrar a manutenção)"
echo "     docker compose start api"
echo "─────────────────────────────────────────────────────────────"
