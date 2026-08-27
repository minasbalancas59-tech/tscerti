-- ================================================================
-- Revisão / substituição de certificado emitido
--   docker compose exec -T db psql -U certsaas -d certsaas < db/seed/20_revisao.sql
-- ================================================================

ALTER TABLE certificado
    ADD COLUMN IF NOT EXISTS substitui_id   uuid REFERENCES certificado(id),
    ADD COLUMN IF NOT EXISTS substituido_por_id uuid REFERENCES certificado(id),
    ADD COLUMN IF NOT EXISTS revisao_num    int NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS motivo_revisao text;

-- Novo status possível: 'substituido' (certificado antigo que foi revisado).
-- O status é texto (não enum), então nada a alterar no schema além de usá-lo.

-- Permitir que o trigger de imutabilidade aceite a marcação de substituição
-- (o certificado emitido pode receber substituido_por_id e virar 'substituido').
CREATE OR REPLACE FUNCTION bloqueia_certificado_emitido() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'emitido' THEN
            RAISE EXCEPTION 'Certificado emitido não pode ser excluído (nº %)', OLD.numero;
        END IF;
        RETURN OLD;
    END IF;
    -- Campos que PODEM mudar após emissão: metadados de PDF/email e a
    -- marcação de que este certificado foi substituído por uma revisão.
    IF OLD.status = 'emitido'
       AND (to_jsonb(NEW) - 'email_enviado_em' - 'atualizado_em' - 'pdf_url'
                          - 'hash_sha256' - 'status' - 'substituido_por_id')
           IS DISTINCT FROM
           (to_jsonb(OLD) - 'email_enviado_em' - 'atualizado_em' - 'pdf_url'
                          - 'hash_sha256' - 'status' - 'substituido_por_id') THEN
        RAISE EXCEPTION 'Certificado emitido é imutável (nº %). Emita uma revisão.', OLD.numero;
    END IF;
    -- Só permite mudar status de 'emitido' para 'substituido'
    IF OLD.status = 'emitido' AND NEW.status <> 'emitido'
       AND NEW.status <> 'substituido' THEN
        RAISE EXCEPTION 'Certificado emitido só pode passar para substituído.';
    END IF;
    NEW.atualizado_em := now();
    RETURN NEW;
END $$;

SELECT 'revisão de certificado habilitada' AS resultado;
