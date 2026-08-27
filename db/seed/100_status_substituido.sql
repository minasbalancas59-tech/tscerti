-- 100: o status 'substituido' faltava na constraint de status do certificado.
--      A funcao emitir_certificado() marca o ORIGINAL como 'substituido' ao
--      emitir uma REVISAO -> sem isto, aprovar revisao falha com
--      "violates check constraint certificado_status_check".
ALTER TABLE certificado DROP CONSTRAINT IF EXISTS certificado_status_check;
ALTER TABLE certificado ADD CONSTRAINT certificado_status_check
  CHECK (status = ANY (ARRAY['rascunho', 'aguardando_aprovacao', 'emitido',
                             'substituido', 'cancelado']));
