-- ============================================================
-- NORMALIZACIÓN DE DATOS EXISTENTES
-- ============================================================
-- Este script debe ejecutarse UNA SOLA VEZ después de aplicar
-- la migración de sincronización incremental.
--
-- Normaliza TODOS los productos y códigos secundarios existentes:
-- - Elimina espacios al inicio/final de descripciones
-- - Redondea precios a 2 decimales
-- - NO actualiza fecha_actualizacion (mantiene fechas actuales)
-- ============================================================

-- Desactivar temporalmente el trigger para que no actualice las fechas
ALTER TABLE productos DISABLE TRIGGER trigger_actualizar_fecha_productos;
ALTER TABLE codigos_secundarios DISABLE TRIGGER trigger_actualizar_fecha_codigos_secundarios;

-- Normalizar productos (eliminar espacios y redondear precios)
UPDATE productos
SET 
    descripcion = TRIM(COALESCE(descripcion, '')),
    pvp = ROUND(pvp::numeric, 2)::real
WHERE 
    -- Solo actualizar si hay cambios
    descripcion != TRIM(COALESCE(descripcion, ''))
    OR pvp != ROUND(pvp::numeric, 2)::real;

-- Normalizar códigos secundarios (eliminar espacios)
UPDATE codigos_secundarios
SET 
    descripcion = TRIM(COALESCE(descripcion, '')),
    codigo_principal = TRIM(COALESCE(codigo_principal, ''))
WHERE 
    -- Solo actualizar si hay cambios
    descripcion != TRIM(COALESCE(descripcion, ''))
    OR codigo_principal != TRIM(COALESCE(codigo_principal, ''));

-- Reactivar triggers
ALTER TABLE productos ENABLE TRIGGER trigger_actualizar_fecha_productos;
ALTER TABLE codigos_secundarios ENABLE TRIGGER trigger_actualizar_fecha_codigos_secundarios;

-- Mostrar estadísticas de normalización
SELECT 
    'NORMALIZACIÓN COMPLETADA' as resultado,
    COUNT(*) as total_productos,
    SUM(CASE WHEN descripcion LIKE ' %' OR descripcion LIKE '% ' THEN 1 ELSE 0 END) as productos_con_espacios_restantes,
    SUM(CASE WHEN pvp != ROUND(pvp::numeric, 2)::real THEN 1 ELSE 0 END) as productos_con_decimales_extra
FROM productos;

SELECT 
    'CÓDIGOS SECUNDARIOS NORMALIZADOS' as resultado,
    COUNT(*) as total_codigos,
    SUM(CASE WHEN descripcion LIKE ' %' OR descripcion LIKE '% ' THEN 1 ELSE 0 END) as codigos_con_espacios_restantes
FROM codigos_secundarios;
