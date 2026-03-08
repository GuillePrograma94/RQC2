-- Anade campo observaciones a solicitudes_articulos_nuevos (opcional).
-- Para que Dependiente/Comercial puedan indicar detalles: articulo similar creado, precio compra fabricante, nombre del cliente que pide el articulo, etc.
-- Ejecutar DESPUES de migration_solicitudes_articulos_nuevos.sql.

ALTER TABLE solicitudes_articulos_nuevos
ADD COLUMN IF NOT EXISTS observaciones TEXT;

COMMENT ON COLUMN solicitudes_articulos_nuevos.observaciones IS 'Detalles opcionales: articulo similar creado, precio compra fabricante, nombre del cliente que pide el articulo, etc.';
