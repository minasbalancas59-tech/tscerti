-- E-mails gravados com espaco (colar de planilha traz espaco fino e quebra
-- de linha) faziam o envio do certificado falhar so na hora do disparo —
-- foi o caso do MB-2026/0081, com o endereco terminando em ".com.b r".
-- O cadastro passou a limpar na entrada; aqui limpamos o que ja existe.
-- Joao, 28/08/2026.

-- Cliente
UPDATE cliente
   SET email = lower(regexp_replace(email, '\s', '', 'g'))
 WHERE email IS NOT NULL
   AND email <> lower(regexp_replace(email, '\s', '', 'g'));

-- Contatos do cliente
UPDATE cliente_contato
   SET email = lower(regexp_replace(email, '\s', '', 'g'))
 WHERE email IS NOT NULL
   AND email <> lower(regexp_replace(email, '\s', '', 'g'));

-- Enderecos de e-mail vazios apos a limpeza viram NULL
UPDATE cliente        SET email = NULL WHERE email = '';
UPDATE cliente_contato SET email = NULL WHERE email = '';
