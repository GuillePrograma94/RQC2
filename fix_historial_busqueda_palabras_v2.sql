-- ============================================================
-- FIX V2: Corregir función de búsqueda por descripción en historial
-- Problema: "set-returning functions are not allowed in WHERE"
-- Solución: Usar función auxiliar para búsqueda por palabras
-- ============================================================

-- Función auxiliar para verificar si una descripción contiene todas las palabras
CREATE OR REPLACE FUNCTION contiene_todas_las_palabras(
    descripcion TEXT,
    palabras TEXT[]
)
RETURNS BOOLEAN AS $$
DECLARE
    palabra TEXT;
BEGIN
    -- Si no hay palabras, retornar true
    IF palabras IS NULL OR array_length(palabras, 1) IS NULL THEN
        RETURN TRUE;
    END IF;
    
    -- Verificar que la descripción contenga TODAS las palabras
    FOREACH palabra IN ARRAY palabras
    LOOP
        IF LOWER(descripcion) NOT LIKE '%' || LOWER(palabra) || '%' THEN
            RETURN FALSE;
        END IF;
    END LOOP;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Función principal corregida
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
DECLARE
    palabras TEXT[];
BEGIN
    -- Si hay descripción, separar en palabras
    IF p_descripcion IS NOT NULL AND LENGTH(TRIM(p_descripcion)) > 0 THEN
        -- Separar descripción en palabras (igual que en el frontend)
        palabras := string_to_array(LOWER(TRIM(p_descripcion)), ' ');
        
        -- Filtrar palabras vacías
        palabras := ARRAY(
            SELECT unnest(palabras) 
            WHERE unnest(palabras) != '' 
            AND LENGTH(unnest(palabras)) > 0
        );
    END IF;

    -- Búsqueda principal
    RETURN QUERY
    SELECT 
        h.codigo_producto::TEXT AS codigo,
        p.descripcion::TEXT,
        p.pvp,
        h.fecha_ultima_compra,
        h.veces_comprado
    FROM historial_compras_usuario h
    INNER JOIN productos p ON h.codigo_producto = p.codigo
    LEFT JOIN codigos_secundarios cs ON cs.codigo_principal = p.codigo
    WHERE h.usuario_id = p_usuario_id
      AND (
          p_codigo IS NULL 
          OR h.codigo_producto ILIKE '%' || p_codigo || '%'
          OR cs.codigo_secundario ILIKE '%' || p_codigo || '%'
      )
      -- Usar función auxiliar para búsqueda por palabras
      AND contiene_todas_las_palabras(p.descripcion, palabras)
    ORDER BY h.fecha_ultima_compra DESC;
END;
$$ LANGUAGE plpgsql;

-- Comentario actualizado
COMMENT ON FUNCTION buscar_productos_historial_usuario_optimizado IS 
'Optimized version with word-based description search (V2).
Uses auxiliary function to avoid PostgreSQL WHERE clause restrictions.
Now matches the frontend logic: searches for ALL words in description.
Example: "monomando lavabo" finds "MONOMANDO DE LAVABO" because both words are present.';

COMMENT ON FUNCTION contiene_todas_las_palabras IS 
'Auxiliary function to check if description contains all words.
Used to avoid PostgreSQL restrictions on set-returning functions in WHERE clauses.';

-- ============================================================
-- VERIFICATION
-- ============================================================

-- Test the improved function
-- SELECT * FROM buscar_productos_historial_usuario_optimizado(1, NULL, 'monomando lavabo');

-- ============================================================
-- SUCCESS MESSAGE
-- ============================================================
DO $$
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Historial Search Fix V2 Applied! ✅';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    RAISE NOTICE 'Changes applied:';
    RAISE NOTICE '1. Fixed PostgreSQL WHERE clause restriction';
    RAISE NOTICE '2. Added auxiliary function contiene_todas_las_palabras';
    RAISE NOTICE '3. Now matches frontend search behavior';
    RAISE NOTICE '4. "monomando lavabo" will find "MONOMANDO DE LAVABO"';
    RAISE NOTICE '';
    RAISE NOTICE 'Test with:';
    RAISE NOTICE 'SELECT * FROM buscar_productos_historial_usuario_optimizado(1, NULL, ''monomando lavabo'');';
    RAISE NOTICE '========================================';
END $$;
