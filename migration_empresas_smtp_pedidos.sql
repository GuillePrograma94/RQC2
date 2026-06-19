-- SMTP por almacen para emails de pedido (confirmacion cliente / alerta ADMINISTRADOR)
-- Ejecutar en Supabase SQL Editor.
-- La contrasena solo la leen las APIs serverless (service role); no incluir en SELECT del cliente.

ALTER TABLE empresas_por_almacen
    ADD COLUMN IF NOT EXISTS smtp_enabled BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS smtp_host TEXT,
    ADD COLUMN IF NOT EXISTS smtp_port INTEGER DEFAULT 587,
    ADD COLUMN IF NOT EXISTS smtp_user TEXT,
    ADD COLUMN IF NOT EXISTS smtp_password TEXT,
    ADD COLUMN IF NOT EXISTS smtp_secure BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN empresas_por_almacen.smtp_enabled IS 'Si true y hay host/usuario/password, los emails de pedido usan SMTP de este almacen.';
COMMENT ON COLUMN empresas_por_almacen.smtp_host IS 'Servidor SMTP (ej. smtp.office365.com).';
COMMENT ON COLUMN empresas_por_almacen.smtp_port IS 'Puerto SMTP (587 STARTTLS o 465 SSL).';
COMMENT ON COLUMN empresas_por_almacen.smtp_user IS 'Usuario SMTP (suele coincidir con el email remitente).';
COMMENT ON COLUMN empresas_por_almacen.smtp_password IS 'Contrasena SMTP; solo lectura server-side (API Vercel).';
COMMENT ON COLUMN empresas_por_almacen.smtp_secure IS 'true = SSL directo (puerto 465). false = STARTTLS (587).';
