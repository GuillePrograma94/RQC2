-- ============================================================
-- MIGRATION: stock_almacen_articulo
-- Tabla de stock por almacen y articulo (sin detalle de ubicacion)
-- Las ubicaciones "perdidas/reservadas" deben excluirse ANTES de importar
-- ============================================================

-- Tabla principal de stock
CREATE TABLE IF NOT EXISTS stock_almacen_articulo (
    codigo_almacen  TEXT    NOT NULL,
    codigo_articulo TEXT    NOT NULL,
    stock           INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (codigo_almacen, codigo_articulo)
);

-- Indice para busquedas por articulo (el caso mas frecuente desde la app)
CREATE INDEX IF NOT EXISTS idx_stock_articulo
    ON stock_almacen_articulo (codigo_articulo);

-- Row Level Security: lectura publica (igual que la tabla productos)
ALTER TABLE stock_almacen_articulo ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Lectura publica stock"
    ON stock_almacen_articulo
    FOR SELECT
    USING (true);

-- Solo roles autenticados con permisos de servicio pueden escribir
CREATE POLICY "Escritura solo service_role"
    ON stock_almacen_articulo
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
