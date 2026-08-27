# Etapa 3 — Deploy e roteiro de testes

## Deploy (na VPS)

1. **FileZilla**: substitua a pasta `src/Api` inteira (apague a antiga
   antes) e adicione o novo arquivo `db/seed/12_migracao_etapa3.sql`.

2. **Terminal**:

       cd /root/cert-saas
       sed -i 's/\r$//' db/seed/12_migracao_etapa3.sql
       docker compose exec -T db psql -U certsaas -d certsaas < db/seed/12_migracao_etapa3.sql
       docker compose up -d --build api
       curl http://localhost:8080/health

## Testes — agora é NO NAVEGADOR 🎉

Abra **https://certificados.minasbalancas.com.br** (funciona no
notebook e no celular).

**T1 — Login**: seu email + senha. Deve abrir o painel com o nome
da empresa no topo.

**T2 — Pré-requisito**: cadastre ao menos um peso padrão (ainda é
via curl — a tela de pesos vem depois; use o T6 da etapa 2 se não fez):

    TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login \
      -H "Content-Type: application/json" \
      -d '{"email":"SEU_EMAIL","senha":"SUA_SENHA"}' | grep -o '"token":"[^"]*' | cut -d'"' -f4)
    curl -s -X POST http://localhost:8080/api/pesos \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
      -d '{"identificacao":"MB-P01","valorNominal":500,"classe":"M1","validade":"2027-10-01"}'

**T3 — Nova calibração**: botão "+ Nova calibração" → Rio Branco →
BAL-01 → Iniciar. A tela deve abrir com: chips da classe e capacidade,
5 cargas sugeridas (8.000 / 20.000 / 40.000 / 60.000 / 80.000 para a
BAL-01), 5 posições de excentricidade com carga ~1/3, 3 medições de
repetibilidade a 50%.

**T4 — Cálculo ao vivo**: digite 20.000 na primeira carga → erro 0,
EMA ± e status OK na hora. Digite 40.100 na segunda → "> EMA" em
vermelho. Troque o critério para "Em uso" → o EMA dobra e o status
pode virar OK. Volte pra "subsequente".

**T5 — Autosave**: preencha alguns campos e aguarde ~4s → aparece
"💾 salvo HH:MM:SS" no topo. Feche o navegador, entre de novo, abra o
rascunho no painel → os valores estão lá.

**T6 — Validações do envio**: tente "Enviar para aprovação" sem
selecionar peso padrão → erro claro. Selecione o peso, preencha menos
de 3 pontos → erro. Preencha 3+ pontos e as 3 repetibilidades → envia.

**T7 — Resultado do servidor**: após enviar, aparece a tabela final
com a INCERTEZA calculada (± X kg, k=2) em cada ponto. O certificado
some da lista de rascunhos e aparece como "Aguardando aprovação".

**T8 — Celular**: repita o T3/T4 no navegador do celular. Layout deve
empilhar em uma coluna, inputs confortáveis pro dedo.

**T9 — Conferência metrológica (a mais importante)**: compare os erros,
EMAs e incertezas calculados com 2–3 certificados reais já emitidos
pela Minas Balanças. Qualquer divergência: anotar carga, valor esperado
e valor calculado, e reportar pra ajuste do modelo.
