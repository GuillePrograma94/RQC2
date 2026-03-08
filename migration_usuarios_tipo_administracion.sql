-- Anade ADMINISTRACION al tipo de usuario (mismo proyecto, vista distinta).
-- Ejecutar en Supabase SQL Editor.

ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_tipo_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_tipo_check
    CHECK (tipo IN ('CLIENTE', 'COMERCIAL', 'DEPENDIENTE', 'ADMINISTRADOR', 'ADMINISTRACION'));

COMMENT ON COLUMN usuarios.tipo IS 'CLIENTE, COMERCIAL, DEPENDIENTE, ADMINISTRADOR, ADMINISTRACION (panel gestion solicitudes).';
