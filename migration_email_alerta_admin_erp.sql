-- Alerta email a usuarios ADMINISTRADOR cuando un pedido no llega al ERP
-- Ejecutar en Supabase SQL Editor (despues de migration_usuarios_email_confirmacion_pedido.sql)

ALTER TABLE carritos_clientes
    ADD COLUMN IF NOT EXISTS email_alerta_admin_erp_enviado_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN carritos_clientes.email_alerta_admin_erp_enviado_at IS
'Fecha/hora en que se envio email de alerta ERP a usuarios con tipo ADMINISTRADOR (no ADMINISTRACION).';
