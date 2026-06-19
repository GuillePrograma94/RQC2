-- Email de respuesta (Reply-To) por almacen: correo humano cuando el cliente pulsa Responder
-- Ejecutar en Supabase SQL Editor.

ALTER TABLE empresas_por_almacen
    ADD COLUMN IF NOT EXISTS email_respuesta TEXT;

COMMENT ON COLUMN empresas_por_almacen.email_respuesta IS
'Email Reply-To monitorizado por un humano. El remitente (De:) puede ser noreply; al responder llega aqui.';
