-- Alias de proveedores para busqueda flexible (ej. "roca sanitario", "san roc").
-- Ejecutar DESPUES de migration_proveedores_productos.sql.

-- ============================================
-- 1. TABLA PROVEEDORES_ALIAS
-- ============================================
CREATE TABLE IF NOT EXISTS proveedores_alias (
    codigo_proveedor TEXT NOT NULL REFERENCES proveedores(codigo_proveedor) ON UPDATE CASCADE ON DELETE CASCADE,
    alias TEXT NOT NULL,
    PRIMARY KEY (codigo_proveedor, alias)
);

COMMENT ON TABLE proveedores_alias IS 'Alias de proveedores para busqueda en el desplegable de Solicitar articulo nuevo (ej. sanitario roca, roc san).';
CREATE INDEX IF NOT EXISTS idx_proveedores_alias_codigo ON proveedores_alias(codigo_proveedor);
CREATE INDEX IF NOT EXISTS idx_proveedores_alias_alias_lower ON proveedores_alias(LOWER(alias));

-- ============================================
-- 2. RLS
-- ============================================
ALTER TABLE proveedores_alias ENABLE ROW LEVEL SECURITY;

-- SELECT: todos los autenticados pueden leer (para filtrar en el combobox).
DROP POLICY IF EXISTS "proveedores_alias_select_authenticated" ON proveedores_alias;
CREATE POLICY "proveedores_alias_select_authenticated"
    ON proveedores_alias FOR SELECT
    TO authenticated
    USING (true);

-- INSERT/DELETE: solo ADMINISTRACION (gestion de alias desde el panel).
DROP POLICY IF EXISTS "proveedores_alias_insert_administracion" ON proveedores_alias;
CREATE POLICY "proveedores_alias_insert_administracion"
    ON proveedores_alias FOR INSERT
    TO authenticated
    WITH CHECK (
        ((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::boolean IS TRUE
    );

DROP POLICY IF EXISTS "proveedores_alias_delete_administracion" ON proveedores_alias;
CREATE POLICY "proveedores_alias_delete_administracion"
    ON proveedores_alias FOR DELETE
    TO authenticated
    USING (
        ((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::boolean IS TRUE
    );
