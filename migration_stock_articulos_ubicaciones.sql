-- ============================================================
-- MIGRATION: stock_almacen_articulo_ubicacion
-- Detalle exacto de stock por almacen, articulo y ubicacion
-- ============================================================

CREATE TABLE IF NOT EXISTS stock_almacen_articulo_ubicacion (
    codigo_almacen   TEXT    NOT NULL,
    codigo_articulo  TEXT    NOT NULL,
    codigo_ubicacion TEXT    NOT NULL,
    stock            INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (codigo_almacen, codigo_articulo, codigo_ubicacion)
);

CREATE INDEX IF NOT EXISTS idx_stock_ubicacion_articulo
    ON stock_almacen_articulo_ubicacion (codigo_articulo);

CREATE INDEX IF NOT EXISTS idx_stock_ubicacion_almacen_articulo
    ON stock_almacen_articulo_ubicacion (codigo_almacen, codigo_articulo);

ALTER TABLE stock_almacen_articulo_ubicacion ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Lectura publica stock ubicacion"
    ON stock_almacen_articulo_ubicacion
    FOR SELECT
    USING (true);

CREATE POLICY "Escritura solo service_role stock ubicacion"
    ON stock_almacen_articulo_ubicacion
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
