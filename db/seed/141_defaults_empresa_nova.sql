-- Defaults de empresa nova (Joao, 22/08/2026):
--   usa_ajuste      false -> TRUE  (registrar "antes do ajuste" e rotina do
--                                   servico; nasceu escondido na demo Rogerio)
--   mostra_validade false -> TRUE  (validade impressa no certificado e valor
--                                   percebido pelo cliente final)
-- Aviso de vencimento continua desligado por padrao (dispara e-mail a
-- clientes; deve ser decisao consciente — entra no guia de primeiros passos).
-- Vale apenas para empresas criadas a partir de agora; as existentes nao mudam.

ALTER TABLE empresa ALTER COLUMN usa_ajuste      SET DEFAULT true;
ALTER TABLE empresa ALTER COLUMN mostra_validade SET DEFAULT true;
