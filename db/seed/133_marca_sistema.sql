-- 133: assinatura discreta do TSCert no rodapé do certificado.
--
-- LIGADA por padrão, mas DESLIGÁVEL por empresa. O certificado é documento
-- da empresa emissora, não nosso: quem paga um plano superior pode querer o
-- documento sem marca de terceiro, e isso vira argumento comercial em vez
-- de atrito.
BEGIN;

ALTER TABLE empresa ADD COLUMN IF NOT EXISTS marca_sistema_pdf boolean NOT NULL DEFAULT true;

COMMIT;

\echo '--- empresas e a marca no PDF ---'
SELECT razao_social, marca_sistema_pdf FROM empresa ORDER BY 1;
