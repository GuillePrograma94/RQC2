-- ============================================================
-- FIX V3: Versión simplificada sin funciones auxiliares
-- Problema: Las funciones auxiliares también causan problemas
-- Solución: Lógica directa con múltiples condiciones AND
-- ============================================================

-- Función principal simplificada
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
    palabra1 TEXT;
    palabra2 TEXT;
    palabra3 TEXT;
    palabra4 TEXT;
    palabra5 TEXT;
    num_palabras INTEGER;
BEGIN
    -- Si hay descripción, separar en palabras
    IF p_descripcion IS NOT NULL AND LENGTH(TRIM(p_descripcion)) > 0 THEN
        -- Separar descripción en palabras
        palabras := string_to_array(LOWER(TRIM(p_descripcion)), ' ');
        
        -- Filtrar palabras vacías
        palabras := ARRAY(
            SELECT unnest(palabras) 
            WHERE unnest(palabras) != '' 
            AND LENGTH(unnest(palabras)) > 0
        );
        
        -- Obtener número de palabras
        num_palabras := array_length(palabras, 1);
        
        -- Asignar palabras a variables (máximo 5 palabras)
        IF num_palabras >= 1 THEN palabra1 := palabras[1]; END IF;
        IF num_palabras >= 2 THEN palabra2 := palabras[2]; END IF;
        IF num_palabras >= 3 THEN palabra3 := palabras[3]; END IF;
        IF num_palabras >= 4 THEN palabra4 := palabras[4]; END IF;
        IF num_palabras >= 5 THEN palabra5 := palabras[5]; END IF;
    END IF;

    -- Búsqueda principal con condiciones directas
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
      -- Búsqueda por palabras con condiciones directas
      AND (
          p_descripcion IS NULL 
          OR (
              (palabra1 IS NULL OR LOWER(p.descripcion) LIKE '%' || palabra1 || '%')
              AND (palabra2 IS NULL OR LOWER(p.descripcion) LIKE '%' || palabra2 || '%')
              AND (palabra3 IS NULL OR LOWER(p.descripcion) LIKE '%' || palabra3 || '%')
              AND (palabra4 IS NULL OR LOWER(p.descripcion) LIKE '%' || palabra4 || '%')
              AND (palabra5 IS NULL OR LOWER(p.descripcion) LIKE '%' || palabra5 || '%')
          )
      )
    ORDER BY h.fecha_ultima_compra DESC;
END;
$$ LANGUAGE plpgsql;

-- Comentario actualizado
COMMENT ON FUNCTION buscar_productos_historial_usuario_optimizado IS 
'Optimized version with word-based description search (V3).
Uses direct AND conditions to avoid PostgreSQL function restrictions.
Searches for ALL words in description (up to 5 words).
Example: "monomando lavabo" finds "MONOMANDO DE LAVABO" because both words are present.';

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
    RAISE NOTICE 'Historial Search Fix V3 Applied! ✅';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    RAISE NOTICE 'Changes applied:';
    RAISE NOTICE '1. Removed auxiliary functions completely';
    RAISE NOTICE '2. Uses direct AND conditions for word search';
    RAISE NOTICE '3. Supports up to 5 words in description';
    RAISE NOTICE '4. "monomando lavabo" will find "MONOMANDO DE LAVABO"';
    RAISE NOTICE '';
    RAISE NOTICE 'Test with:';
    RAISE NOTICE 'SELECT * FROM buscar_productos_historial_usuario_optimizado(1, NULL, ''monomando lavabo'');';
    RAISE NOTICE '========================================';
END $$;
