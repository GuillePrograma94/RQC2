-- ============================================================
-- FIX: Función simplificada para historial SIN filtros
-- Problema: Las funciones con filtros complejos causan errores
-- Solución: Función simple que devuelve TODO el historial del usuario
-- ============================================================

-- Función simplificada que devuelve TODO el historial del usuario
CREATE OR REPLACE FUNCTION buscar_productos_historial_usuario_optimizado(
    p_usuario_id INTEGER,
    p_codigo TEXT DEFAULT NULL,
    p_descripcion TEXT DEFAULT NULL
)
RETURNS TABLE (
    codigo TEXT,
    descripcion TEXT,
    pvp REAL,
    fecha_ultima_compra TIMESTAMP WITH TIME ZONE,
    veces_comprado INTEGER
) AS $$
BEGIN
    -- Función simplificada: devuelve TODO el historial del usuario
    -- Los filtros se harán en el frontend (búsqueda local)
    RETURN QUERY
    SELECT 
        h.codigo_producto::TEXT AS codigo,
        p.descripcion::TEXT,
        p.pvp,
        h.fecha_ultima_compra,
        h.veces_comprado
    FROM historial_compras_usuario h
    INNER JOIN productos p ON h.codigo_producto = p.codigo
    WHERE h.usuario_id = p_usuario_id
    ORDER BY h.fecha_ultima_compra DESC;
END;
$$ LANGUAGE plpgsql;

-- Comentario actualizado
COMMENT ON FUNCTION buscar_productos_historial_usuario_optimizado IS 
'Simplified function that returns ALL user purchase history.
Filters are applied in frontend (local search) for better performance.
No complex SQL logic - just returns all purchased products for the user.';

-- ============================================================
-- VERIFICATION
-- ============================================================

-- Test the simplified function
-- SELECT * FROM buscar_productos_historial_usuario_optimizado(1, NULL, NULL);

-- ============================================================
-- SUCCESS MESSAGE
-- ============================================================
DO $$
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Historial Simple Function Applied! ✅';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    RAISE NOTICE 'Changes applied:';
    RAISE NOTICE '1. Simplified function - no complex filters';
    RAISE NOTICE '2. Returns ALL user purchase history';
    RAISE NOTICE '3. Frontend will do local filtering';
    RAISE NOTICE '4. No more PostgreSQL errors';
    RAISE NOTICE '';
    RAISE NOTICE 'Test with:';
    RAISE NOTICE 'SELECT * FROM buscar_productos_historial_usuario_optimizado(1, NULL, NULL);';
    RAISE NOTICE '========================================';
END $$;
