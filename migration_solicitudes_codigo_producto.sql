-- Anade codigo_producto a solicitudes_articulos_nuevos para que ADMINISTRACION
-- pueda responder con el codigo del producto al completar o marcar "articulo ya existente".
-- Ejecutar DESPUES de migration_solicitudes_articulos_nuevos.sql.

ALTER TABLE solicitudes_articulos_nuevos
ADD COLUMN IF NOT EXISTS codigo_producto TEXT;

COMMENT ON COLUMN solicitudes_articulos_nuevos.codigo_producto IS 'Codigo del producto asignado por Administracion al completar la solicitud o al marcar articulo ya existente.';
