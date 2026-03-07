-- Proveedores: tabla maestra y asignacion en productos.
-- Ejecutar cuando exista la tabla productos (setup_supabase.sql).
-- La tabla solicitudes_articulos_nuevos depende de proveedores; ejecutar esta migracion antes.

-- ============================================
-- 1. TABLA PROVEEDORES
-- ============================================
CREATE TABLE IF NOT EXISTS proveedores (
    codigo_proveedor TEXT PRIMARY KEY,
    nombre_proveedor TEXT NOT NULL
);

COMMENT ON TABLE proveedores IS 'Maestro de proveedores: codigo y nombre para productos y solicitudes de articulos nuevos.';
COMMENT ON COLUMN proveedores.codigo_proveedor IS 'Codigo unico del proveedor (ej. SALGAR).';
COMMENT ON COLUMN proveedores.nombre_proveedor IS 'Nombre para mostrar en formularios y listados.';

-- ============================================
-- 2. COLUMNA CODIGO_PROVEEDOR EN PRODUCTOS
-- ============================================
ALTER TABLE productos
    ADD COLUMN IF NOT EXISTS codigo_proveedor TEXT;

ALTER TABLE productos
    DROP CONSTRAINT IF EXISTS fk_productos_proveedor;

ALTER TABLE productos
    ADD CONSTRAINT fk_productos_proveedor
    FOREIGN KEY (codigo_proveedor)
    REFERENCES proveedores (codigo_proveedor)
    ON UPDATE CASCADE
    ON DELETE SET NULL;

COMMENT ON COLUMN productos.codigo_proveedor IS 'Proveedor del articulo. FK a proveedores.codigo_proveedor.';

CREATE INDEX IF NOT EXISTS idx_productos_codigo_proveedor ON productos(codigo_proveedor);

-- ============================================
-- 3. DATOS INICIALES (opcional)
-- ============================================
INSERT INTO proveedores (codigo_proveedor, nombre_proveedor)
VALUES ('SALGAR', 'SALGAR')
ON CONFLICT (codigo_proveedor) DO NOTHING;
