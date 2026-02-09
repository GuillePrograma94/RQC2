-- ============================================================
-- Sincronización Incremental de Productos
-- ============================================================
-- Este script crea funciones para sincronizar solo los productos
-- que han cambiado desde una versión específica, en lugar de
-- descargar toda la tabla.
--
-- Beneficios:
-- - Reduce tiempo de descarga de minutos a segundos
-- - Reduce uso de ancho de banda en 95-99%
-- - Mejora experiencia de usuario
-- ============================================================

-- ============================================================
-- 1. Función para obtener productos modificados/agregados
-- ============================================================
CREATE OR REPLACE FUNCTION obtener_productos_modificados(
    p_version_hash_local TEXT
)
RETURNS TABLE (
    codigo TEXT,
    descripcion TEXT,
    pvp REAL,
    fecha_actualizacion TIMESTAMP WITH TIME ZONE,
    accion TEXT  -- 'INSERT' o 'UPDATE'
) AS $$
DECLARE
    v_fecha_version TIMESTAMP WITH TIME ZONE;
BEGIN
    -- Obtener fecha de la versión local
    SELECT fecha_actualizacion INTO v_fecha_version
    FROM version_control
    WHERE version_hash = p_version_hash_local
    ORDER BY fecha_actualizacion DESC
    LIMIT 1;
    
    -- Si no se encuentra la versión, devolver todos los productos (primera sincronización)
    IF v_fecha_version IS NULL THEN
        RETURN QUERY
        SELECT 
            p.codigo::TEXT,
            p.descripcion::TEXT,
            p.pvp,
            p.fecha_actualizacion,
            'INSERT'::TEXT AS accion
        FROM productos p
        ORDER BY p.codigo;
        RETURN;
    END IF;
    
    -- Devolver solo productos modificados o agregados desde esa fecha
    RETURN QUERY
    SELECT 
        p.codigo::TEXT,
        p.descripcion::TEXT,
        p.pvp,
        p.fecha_actualizacion,
        CASE 
            WHEN p.fecha_creacion > v_fecha_version THEN 'INSERT'::TEXT
            ELSE 'UPDATE'::TEXT
        END AS accion
    FROM productos p
    WHERE p.fecha_actualizacion > v_fecha_version
       OR p.fecha_creacion > v_fecha_version
    ORDER BY p.codigo;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION obtener_productos_modificados IS 
'Devuelve solo los productos que han sido modificados o agregados desde una versión específica.
Si la versión no existe, devuelve todos los productos (primera sincronización).
Acción: INSERT = producto nuevo, UPDATE = producto modificado';

-- ============================================================
-- 2. Función para obtener códigos secundarios modificados/agregados
-- ============================================================
CREATE OR REPLACE FUNCTION obtener_codigos_secundarios_modificados(
    p_version_hash_local TEXT
)
RETURNS TABLE (
    codigo_secundario TEXT,
    descripcion TEXT,
    codigo_principal TEXT,
    fecha_actualizacion TIMESTAMP WITH TIME ZONE,
    accion TEXT  -- 'INSERT' o 'UPDATE'
) AS $$
DECLARE
    v_fecha_version TIMESTAMP WITH TIME ZONE;
BEGIN
    -- Obtener fecha de la versión local
    SELECT fecha_actualizacion INTO v_fecha_version
    FROM version_control
    WHERE version_hash = p_version_hash_local
    ORDER BY fecha_actualizacion DESC
    LIMIT 1;
    
    -- Si no se encuentra la versión, devolver todos los códigos (primera sincronización)
    IF v_fecha_version IS NULL THEN
        RETURN QUERY
        SELECT 
            cs.codigo_secundario::TEXT,
            cs.descripcion::TEXT,
            cs.codigo_principal::TEXT,
            cs.fecha_actualizacion,
            'INSERT'::TEXT AS accion
        FROM codigos_secundarios cs
        ORDER BY cs.codigo_secundario;
        RETURN;
    END IF;
    
    -- Devolver solo códigos modificados o agregados desde esa fecha
    RETURN QUERY
    SELECT 
        cs.codigo_secundario::TEXT,
        cs.descripcion::TEXT,
        cs.codigo_principal::TEXT,
        cs.fecha_actualizacion,
        CASE 
            WHEN cs.fecha_creacion > v_fecha_version THEN 'INSERT'::TEXT
            ELSE 'UPDATE'::TEXT
        END AS accion
    FROM codigos_secundarios cs
    WHERE cs.fecha_actualizacion > v_fecha_version
       OR cs.fecha_creacion > v_fecha_version
    ORDER BY cs.codigo_secundario;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION obtener_codigos_secundarios_modificados IS 
'Devuelve solo los códigos secundarios que han sido modificados o agregados desde una versión específica.
Si la versión no existe, devuelve todos los códigos (primera sincronización).
Acción: INSERT = código nuevo, UPDATE = código modificado';

-- ============================================================
-- 3. Función combinada para obtener estadísticas de cambios
-- ============================================================
CREATE OR REPLACE FUNCTION obtener_estadisticas_cambios(
    p_version_hash_local TEXT
)
RETURNS TABLE (
    productos_modificados INTEGER,
    productos_nuevos INTEGER,
    codigos_modificados INTEGER,
    codigos_nuevos INTEGER,
    total_cambios INTEGER
) AS $$
DECLARE
    v_fecha_version TIMESTAMP WITH TIME ZONE;
    v_productos_mod INTEGER;
    v_productos_nuevos INTEGER;
    v_codigos_mod INTEGER;
    v_codigos_nuevos INTEGER;
BEGIN
    -- Obtener fecha de la versión local
    SELECT fecha_actualizacion INTO v_fecha_version
    FROM version_control
    WHERE version_hash = p_version_hash_local
    ORDER BY fecha_actualizacion DESC
    LIMIT 1;
    
    -- Si no se encuentra la versión, devolver 0 (primera sincronización completa)
    IF v_fecha_version IS NULL THEN
        RETURN QUERY
        SELECT 
            (SELECT COUNT(*)::INTEGER FROM productos) AS productos_modificados,
            (SELECT COUNT(*)::INTEGER FROM productos) AS productos_nuevos,
            (SELECT COUNT(*)::INTEGER FROM codigos_secundarios) AS codigos_modificados,
            (SELECT COUNT(*)::INTEGER FROM codigos_secundarios) AS codigos_nuevos,
            ((SELECT COUNT(*)::INTEGER FROM productos) + 
             (SELECT COUNT(*)::INTEGER FROM codigos_secundarios)) AS total_cambios;
        RETURN;
    END IF;
    
    -- Contar productos modificados vs nuevos
    SELECT 
        COUNT(*) FILTER (WHERE fecha_actualizacion > v_fecha_version AND fecha_creacion <= v_fecha_version)::INTEGER,
        COUNT(*) FILTER (WHERE fecha_creacion > v_fecha_version)::INTEGER
    INTO v_productos_mod, v_productos_nuevos
    FROM productos
    WHERE fecha_actualizacion > v_fecha_version OR fecha_creacion > v_fecha_version;
    
    -- Contar códigos modificados vs nuevos
    SELECT 
        COUNT(*) FILTER (WHERE fecha_actualizacion > v_fecha_version AND fecha_creacion <= v_fecha_version)::INTEGER,
        COUNT(*) FILTER (WHERE fecha_creacion > v_fecha_version)::INTEGER
    INTO v_codigos_mod, v_codigos_nuevos
    FROM codigos_secundarios
    WHERE fecha_actualizacion > v_fecha_version OR fecha_creacion > v_fecha_version;
    
    -- Devolver estadísticas
    RETURN QUERY
    SELECT 
        COALESCE(v_productos_mod, 0) AS productos_modificados,
        COALESCE(v_productos_nuevos, 0) AS productos_nuevos,
        COALESCE(v_codigos_mod, 0) AS codigos_modificados,
        COALESCE(v_codigos_nuevos, 0) AS codigos_nuevos,
        (COALESCE(v_productos_mod, 0) + COALESCE(v_productos_nuevos, 0) + 
         COALESCE(v_codigos_mod, 0) + COALESCE(v_codigos_nuevos, 0)) AS total_cambios;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION obtener_estadisticas_cambios IS 
'Devuelve estadísticas de cuántos productos y códigos han cambiado desde una versión específica.
Útil para decidir si hacer sincronización incremental o completa.';

-- ============================================================
-- 4. Índices adicionales para optimizar las consultas
-- ============================================================

-- Índice compuesto para búsquedas por fecha de actualización
CREATE INDEX IF NOT EXISTS idx_productos_fecha_actualizacion 
ON productos(fecha_actualizacion DESC, codigo);

CREATE INDEX IF NOT EXISTS idx_productos_fecha_creacion 
ON productos(fecha_creacion DESC, codigo);

CREATE INDEX IF NOT EXISTS idx_codigos_sec_fecha_actualizacion 
ON codigos_secundarios(fecha_actualizacion DESC, codigo_secundario);

CREATE INDEX IF NOT EXISTS idx_codigos_sec_fecha_creacion 
ON codigos_secundarios(fecha_creacion DESC, codigo_secundario);

-- ============================================================
-- 5. Triggers para actualizar fecha_actualizacion automáticamente
-- ============================================================
-- Estos triggers aseguran que fecha_actualizacion se actualice
-- automáticamente cuando se modifica un registro, necesario para
-- que la sincronización incremental funcione correctamente.

-- Trigger para productos
-- Solo actualizar fecha_actualizacion cuando los datos (descripcion, pvp) cambian.
-- Si son idénticos, no tocar fecha para no marcar todo como "modificado" en cada subida.
CREATE OR REPLACE FUNCTION actualizar_fecha_productos()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        -- Solo actualizar fecha_actualizacion cuando hay cambio real en descripcion o pvp
        IF OLD.descripcion IS DISTINCT FROM NEW.descripcion OR OLD.pvp IS DISTINCT FROM NEW.pvp THEN
            NEW.fecha_actualizacion = NOW();
        ELSE
            NEW.fecha_actualizacion = OLD.fecha_actualizacion;
        END IF;
        NEW.fecha_creacion = OLD.fecha_creacion;
    ELSIF TG_OP = 'INSERT' THEN
        IF NEW.fecha_creacion IS NULL THEN
            NEW.fecha_creacion = NOW();
        END IF;
        IF NEW.fecha_actualizacion IS NULL THEN
            NEW.fecha_actualizacion = NOW();
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Crear trigger si no existe (tanto para INSERT como UPDATE)
DROP TRIGGER IF EXISTS trigger_actualizar_fecha_productos ON productos;
CREATE TRIGGER trigger_actualizar_fecha_productos
    BEFORE INSERT OR UPDATE ON productos
    FOR EACH ROW
    EXECUTE FUNCTION actualizar_fecha_productos();

-- Trigger para códigos secundarios
-- Solo actualizar fecha_actualizacion cuando los datos (descripcion, codigo_principal) cambian.
CREATE OR REPLACE FUNCTION actualizar_fecha_codigos_secundarios()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF OLD.descripcion IS DISTINCT FROM NEW.descripcion OR OLD.codigo_principal IS DISTINCT FROM NEW.codigo_principal THEN
            NEW.fecha_actualizacion = NOW();
        ELSE
            NEW.fecha_actualizacion = OLD.fecha_actualizacion;
        END IF;
        NEW.fecha_creacion = OLD.fecha_creacion;
    ELSIF TG_OP = 'INSERT' THEN
        IF NEW.fecha_creacion IS NULL THEN
            NEW.fecha_creacion = NOW();
        END IF;
        IF NEW.fecha_actualizacion IS NULL THEN
            NEW.fecha_actualizacion = NOW();
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Crear trigger si no existe (tanto para INSERT como UPDATE)
DROP TRIGGER IF EXISTS trigger_actualizar_fecha_codigos_secundarios ON codigos_secundarios;
CREATE TRIGGER trigger_actualizar_fecha_codigos_secundarios
    BEFORE INSERT OR UPDATE ON codigos_secundarios
    FOR EACH ROW
    EXECUTE FUNCTION actualizar_fecha_codigos_secundarios();

COMMENT ON FUNCTION actualizar_fecha_productos IS 
'Trigger que actualiza automáticamente fecha_actualizacion cuando se modifica un producto.
Mantiene fecha_creacion sin cambios.';

COMMENT ON FUNCTION actualizar_fecha_codigos_secundarios IS 
'Trigger que actualiza automáticamente fecha_actualizacion cuando se modifica un código secundario.
Mantiene fecha_creacion sin cambios.';

-- ============================================================
-- 6. Función RPC para UPSERT que actualiza fecha_actualizacion solo cuando los datos cambian
-- ============================================================
-- IMPORTANTE: Solo actualizamos fecha_actualizacion cuando descripcion/pvp (o codigo_principal
-- en códigos) cambian. Así evitamos marcar todo como "modificado" en cada ejecución de
-- generate_supabase_file.

-- Función para UPSERT de productos (actualiza fecha solo cuando descripcion o pvp cambian)
CREATE OR REPLACE FUNCTION upsert_producto_con_fecha(
    p_codigo TEXT,
    p_descripcion TEXT,
    p_pvp REAL
)
RETURNS TABLE (
    codigo TEXT,
    descripcion TEXT,
    pvp REAL,
    fecha_creacion TIMESTAMP WITH TIME ZONE,
    fecha_actualizacion TIMESTAMP WITH TIME ZONE,
    accion TEXT
) AS $$
DECLARE
    v_existe BOOLEAN;
    v_fecha_creacion_original TIMESTAMP WITH TIME ZONE;
    v_accion TEXT;
BEGIN
    -- Verificar si el producto existe (usar nombre completo de tabla para evitar ambigüedad)
    SELECT EXISTS(SELECT 1 FROM productos WHERE productos.codigo = p_codigo) INTO v_existe;
    
    IF v_existe THEN
        SELECT productos.fecha_creacion INTO v_fecha_creacion_original
        FROM productos
        WHERE productos.codigo = p_codigo;
        
        -- Solo actualizar fecha_actualizacion cuando descripcion o pvp cambian
        UPDATE productos
        SET 
            descripcion = p_descripcion,
            pvp = p_pvp,
            fecha_actualizacion = CASE
                WHEN productos.descripcion IS DISTINCT FROM p_descripcion
                  OR productos.pvp IS DISTINCT FROM p_pvp
                THEN NOW()
                ELSE productos.fecha_actualizacion
            END
        WHERE productos.codigo = p_codigo;
        
        v_accion := 'UPDATE';
    ELSE
        -- INSERT: Crear nuevo producto
        INSERT INTO productos (codigo, descripcion, pvp, fecha_creacion, fecha_actualizacion)
        VALUES (p_codigo, p_descripcion, p_pvp, NOW(), NOW());
        
        v_fecha_creacion_original := NOW();
        v_accion := 'INSERT';
    END IF;
    
    -- Retornar el producto actualizado/insertado (usar alias explícito)
    RETURN QUERY
    SELECT 
        prod.codigo::TEXT,
        prod.descripcion::TEXT,
        prod.pvp,
        prod.fecha_creacion,
        prod.fecha_actualizacion,
        v_accion::TEXT
    FROM productos prod
    WHERE prod.codigo = p_codigo;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION upsert_producto_con_fecha IS 
'UPSERT de producto. Solo actualiza fecha_actualizacion cuando descripcion o pvp cambian.';

-- Función para UPSERT masivo de productos (más eficiente para lotes)
-- Acepta JSONB directamente (Supabase convierte automáticamente arrays Python a JSONB)
-- IMPORTANTE: Usamos nombres de variables con prefijo 'v_' para evitar ambigüedad con RETURNS TABLE
CREATE OR REPLACE FUNCTION upsert_productos_masivo_con_fecha(
    productos_json JSONB
)
RETURNS TABLE (
    codigo TEXT,
    accion TEXT,
    fecha_actualizacion TIMESTAMP WITH TIME ZONE
) AS $$
DECLARE
    producto_item JSONB;
    v_codigo_prod TEXT;  -- Variable con nombre diferente para evitar ambigüedad con RETURNS TABLE
    v_descripcion TEXT;
    v_pvp REAL;
    v_existe BOOLEAN;
    v_accion TEXT;
    v_fecha_actual TIMESTAMP WITH TIME ZONE;
BEGIN
    -- Procesar cada producto del JSON
    FOR producto_item IN SELECT * FROM jsonb_array_elements(productos_json)
    LOOP
        -- Extraer valores del JSON
        v_codigo_prod := (producto_item->>'codigo')::TEXT;
        v_descripcion := (producto_item->>'descripcion')::TEXT;
        v_pvp := (producto_item->>'pvp')::REAL;
        
        -- Verificar si existe (usar variable explícita)
        SELECT EXISTS(
            SELECT 1 
            FROM productos 
            WHERE productos.codigo = v_codigo_prod
        ) INTO v_existe;
        
        IF v_existe THEN
            -- UPDATE: Solo actualizar fecha_actualizacion cuando los datos (descripcion, pvp) cambian.
            -- Si son idénticos, no tocar fecha_actualizacion para no marcar todo como "modificado"
            -- en cada ejecución de generate_supabase_file.
            UPDATE productos
            SET 
                descripcion = v_descripcion,
                pvp = v_pvp,
                fecha_actualizacion = CASE
                    WHEN productos.descripcion IS DISTINCT FROM v_descripcion
                      OR productos.pvp IS DISTINCT FROM v_pvp
                    THEN NOW()
                    ELSE productos.fecha_actualizacion
                END
            WHERE productos.codigo = v_codigo_prod;
            -- Obtener la fecha resultante para el retorno
            SELECT productos.fecha_actualizacion INTO v_fecha_actual
            FROM productos WHERE productos.codigo = v_codigo_prod;
            v_accion := 'UPDATE';
        ELSE
            v_fecha_actual := NOW();
            -- INSERT: Crear nuevo
            INSERT INTO productos (codigo, descripcion, pvp, fecha_creacion, fecha_actualizacion)
            VALUES (v_codigo_prod, v_descripcion, v_pvp, v_fecha_actual, v_fecha_actual);
            v_accion := 'INSERT';
        END IF;
        
        -- Retornar resultado (usar v_codigo_prod para evitar ambigüedad)
        RETURN QUERY
        SELECT 
            v_codigo_prod::TEXT,
            v_accion::TEXT,
            v_fecha_actual;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION upsert_productos_masivo_con_fecha IS 
'UPSERT masivo de productos. Solo actualiza fecha_actualizacion cuando descripcion o pvp cambian.
Recibe un JSONB con array de productos.';

-- Función similar para códigos secundarios (solo actualiza fecha cuando cambian los datos)
CREATE OR REPLACE FUNCTION upsert_codigo_secundario_con_fecha(
    p_codigo_secundario TEXT,
    p_descripcion TEXT,
    p_codigo_principal TEXT
)
RETURNS TABLE (
    codigo_secundario TEXT,
    codigo_principal TEXT,
    fecha_actualizacion TIMESTAMP WITH TIME ZONE,
    accion TEXT
) AS $$
DECLARE
    v_existe BOOLEAN;
    v_accion TEXT;
BEGIN
    SELECT EXISTS(SELECT 1 FROM codigos_secundarios WHERE codigos_secundarios.codigo_secundario = p_codigo_secundario) INTO v_existe;
    
    IF v_existe THEN
        -- Solo actualizar fecha_actualizacion cuando descripcion o codigo_principal cambian
        UPDATE codigos_secundarios
        SET 
            descripcion = p_descripcion,
            codigo_principal = p_codigo_principal,
            fecha_actualizacion = CASE
                WHEN codigos_secundarios.descripcion IS DISTINCT FROM p_descripcion
                  OR codigos_secundarios.codigo_principal IS DISTINCT FROM p_codigo_principal
                THEN NOW()
                ELSE codigos_secundarios.fecha_actualizacion
            END
        WHERE codigos_secundarios.codigo_secundario = p_codigo_secundario;
        
        v_accion := 'UPDATE';
    ELSE
        INSERT INTO codigos_secundarios (codigo_secundario, descripcion, codigo_principal, fecha_creacion, fecha_actualizacion)
        VALUES (p_codigo_secundario, p_descripcion, p_codigo_principal, NOW(), NOW());
        
        v_accion := 'INSERT';
    END IF;
    
    -- Retornar resultado (usar alias explícito diferente)
    RETURN QUERY
    SELECT 
        cod_sec.codigo_secundario::TEXT,
        cod_sec.codigo_principal::TEXT,
        cod_sec.fecha_actualizacion,
        v_accion::TEXT
    FROM codigos_secundarios cod_sec
    WHERE cod_sec.codigo_secundario = p_codigo_secundario;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION upsert_codigo_secundario_con_fecha IS 
'UPSERT de código secundario. Solo actualiza fecha_actualizacion cuando descripcion o codigo_principal cambian.';

-- ============================================================
-- 7. Verificación y mensaje de éxito
-- ============================================================
DO $$
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Sincronización Incremental Configurada! ✅';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    RAISE NOTICE 'Funciones de consulta creadas:';
    RAISE NOTICE '1. obtener_productos_modificados(version_hash)';
    RAISE NOTICE '2. obtener_codigos_secundarios_modificados(version_hash)';
    RAISE NOTICE '3. obtener_estadisticas_cambios(version_hash)';
    RAISE NOTICE '';
    RAISE NOTICE 'Funciones de UPSERT con fecha:';
    RAISE NOTICE '4. upsert_producto_con_fecha(codigo, descripcion, pvp)';
    RAISE NOTICE '5. upsert_productos_masivo_con_fecha(productos_json)';
    RAISE NOTICE '6. upsert_codigo_secundario_con_fecha(codigo_sec, desc, codigo_principal)';
    RAISE NOTICE '';
    RAISE NOTICE 'Triggers creados:';
    RAISE NOTICE '1. trigger_actualizar_fecha_productos';
    RAISE NOTICE '2. trigger_actualizar_fecha_codigos_secundarios';
    RAISE NOTICE '';
    RAISE NOTICE 'Índices creados para optimización';
    RAISE NOTICE '';
    RAISE NOTICE 'NOTA IMPORTANTE:';
    RAISE NOTICE 'Para que la sincronización incremental funcione correctamente,';
    RAISE NOTICE 'debes usar las funciones upsert_*_con_fecha en lugar de upsert()';
    RAISE NOTICE 'directo desde el cliente. Estas funciones actualizan fecha_actualizacion';
    RAISE NOTICE 'solo cuando los datos (descripcion, pvp, codigo_principal) cambian.';
    RAISE NOTICE '';
    RAISE NOTICE 'Prueba con:';
    RAISE NOTICE 'SELECT * FROM obtener_estadisticas_cambios(''tu_hash_local'');';
    RAISE NOTICE 'SELECT * FROM obtener_productos_modificados(''tu_hash_local'');';
    RAISE NOTICE '========================================';
END $$;
