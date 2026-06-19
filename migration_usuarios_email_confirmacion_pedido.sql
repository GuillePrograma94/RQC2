-- Migracion: email de clientes y trazabilidad de confirmacion por pedido
-- Ejecutar en el SQL Editor de Supabase.
--
-- 1. usuarios.email: correo del cliente para confirmaciones de pedido remoto
-- 2. carritos_clientes.email_confirmacion_enviado_at: evita reenvios duplicados

ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS email TEXT;

COMMENT ON COLUMN usuarios.email IS
'Email del cliente para recibir confirmacion de pedidos remotos desde scan_client_mobile.';

CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email)
    WHERE email IS NOT NULL AND trim(email) <> '';

ALTER TABLE carritos_clientes
    ADD COLUMN IF NOT EXISTS email_confirmacion_enviado_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN carritos_clientes.email_confirmacion_enviado_at IS
'Fecha/hora en que se envio el email de confirmacion de pedido al cliente (y CC al comercial).';
