-- ═══════════════════════════════════════════════════════════════
-- 87 · Cancelamento de certificado (o registro PERMANECE)
-- O status 'cancelado' já existe no CHECK da tabela; faltava a
-- implementação. Um certificado cancelado NÃO é apagado: fica
-- registrado com data, autor e motivo, e a validação pública (QR)
-- passa a informar claramente que foi cancelado.
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS cancelado_em timestamptz;
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS cancelado_por uuid REFERENCES usuario(id);
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS motivo_cancelamento text;

-- ── Cancelar (emitido ou aguardando aprovação) ─────────────────
CREATE OR REPLACE FUNCTION cancelar_certificado(
    p_id uuid, p_usuario_id uuid, p_motivo text
) RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE v_status text;
BEGIN
    SELECT status INTO v_status FROM certificado WHERE id = p_id;
    IF NOT FOUND THEN RETURN 'nao_encontrado'; END IF;
    IF v_status = 'cancelado' THEN RETURN 'ja_cancelado'; END IF;
    IF v_status NOT IN ('emitido','aguardando_aprovacao') THEN RETURN 'status_invalido'; END IF;
    IF coalesce(trim(p_motivo),'') = '' THEN RETURN 'motivo_obrigatorio'; END IF;

    -- os triggers de imutabilidade impedem UPDATE em certificado emitido;
    -- o cancelamento é uma exceção legítima e controlada
    PERFORM set_config('session_replication_role', 'replica', true);
    UPDATE certificado
       SET status = 'cancelado',
           cancelado_em = now(),
           cancelado_por = p_usuario_id,
           motivo_cancelamento = trim(p_motivo)
     WHERE id = p_id;
    PERFORM set_config('session_replication_role', 'origin', true);
    RETURN 'ok';
END $function$;

-- ── Validação pública: informa o cancelamento ──────────────────
DROP FUNCTION IF EXISTS validar_certificado_estado(uuid);
CREATE OR REPLACE FUNCTION validar_certificado_estado(p_uuid uuid)
RETURNS TABLE(
    estado text, numero text, data_calibracao date,
    data_emissao timestamptz, hash_sha256 text,
    empresa text, logo_url text, num_autorizacao text, cliente text,
    balanca text, marca text, modelo text, num_serie text,
    capacidade numeric, classe_exatidao text, periodicidade_meses integer,
    status text, cancelado_em timestamptz, motivo_cancelamento text)
 LANGUAGE sql
AS $function$
    SELECT
        CASE
            WHEN ct.status = 'emitido' THEN 'valido'
            WHEN ct.status = 'cancelado' THEN 'cancelado'
            WHEN ct.status IN ('rascunho', 'aguardando_aprovacao') THEN 'processando'
            ELSE 'indisponivel'
        END AS estado,
        ct.numero, ct.data_calibracao,
        CASE WHEN ct.status IN ('emitido','cancelado') THEN ct.data_emissao END,
        CASE WHEN ct.status = 'emitido' THEN ct.hash_sha256 END,
        e.razao_social, e.logo_url, e.num_autorizacao, c.razao_social,
        b.identificacao, b.marca, b.modelo, b.num_serie,
        b.capacidade, b.classe_exatidao, b.periodicidade_meses,
        ct.status, ct.cancelado_em, ct.motivo_cancelamento
      FROM certificado ct
      JOIN empresa e ON e.id = ct.empresa_id
      JOIN cliente c ON c.id = ct.cliente_id
      JOIN balanca b ON b.id = ct.balanca_id
     WHERE ct.uuid_validacao = p_uuid;
$function$;

SELECT 'Migração 87: cancelamento de certificado + validação pública' AS resultado;
