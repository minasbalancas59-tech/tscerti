-- A divisao d (divisao real do visor) passa a ser obrigatoria no cadastro
-- de balancas de escala unica. Balancas ja cadastradas sem ela recebem o
-- valor do e: nao ter o d preenchido sempre significou, na pratica, que a
-- balanca nao distingue as duas divisoes (d = e). Joao, 28/08/2026.
UPDATE balanca
   SET divisao_d = divisao_e
 WHERE (divisao_d IS NULL OR divisao_d <= 0)
   AND divisao_e > 0;
