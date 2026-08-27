-- 132: lembra o ULTIMO modelo de etiqueta usado, por usuário.
-- Guardado por USUÁRIO (não por empresa): cada técnico tem a sua rotina, e
-- o que o Bruno usa na Gaúcha não precisa mudar o que o João usa na Minas.
BEGIN;

ALTER TABLE usuario ADD COLUMN IF NOT EXISTS etiqueta_ultimo_modelo text;
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS etiqueta_ultimo_em timestamptz;

CREATE OR REPLACE FUNCTION public.usuario_etiqueta_usada(p_usuario uuid, p_modelo text)
 RETURNS text
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
    UPDATE usuario
       SET etiqueta_ultimo_modelo = NULLIF(trim(p_modelo), ''),
           etiqueta_ultimo_em = now()
     WHERE id = p_usuario
     RETURNING etiqueta_ultimo_modelo;
$function$;

COMMIT;

\echo '--- prova ---'
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'usuario' AND column_name LIKE 'etiqueta%' ORDER BY 1;
