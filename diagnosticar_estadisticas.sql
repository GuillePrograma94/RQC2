-- ============================================================
-- DIAGNÓSTICO: ¿Por qué obtener_estadisticas_cambios retorna 0?
-- ============================================================

-- 1. Ver las últimas 3 versiones con sus fechas
SELECT 
    '=== ÚLTIMAS VERSIONES ===' as seccion,
    version_hash,
    fecha_actualizacion,
    descripcion
FROM version_control
ORDER BY fecha_actualizacion DESC
LIMIT 3;

-- 2. Ver productos modificados recientemente (últimos 10 minutos)
SELECT 
    '=== PRODUCTOS MODIFICADOS RECIENTEMENTE ===' as seccion,
    codigo,
    descripcion,
    pvp,
    fecha_creacion,
    fecha_actualizacion,
    EXTRACT(EPOCH FROM (NOW() - fecha_actualizacion)) / 60 as minutos_desde_actualizacion
FROM productos
WHERE fecha_actualizacion > NOW() - INTERVAL '10 minutes'
ORDER BY fecha_actualizacion DESC
LIMIT 10;

-- 3. Probar la función con el hash anterior (CORRECTO)
SELECT 
    '=== ESTADÍSTICAS CON HASH ANTERIOR ===' as seccion,
    * 
FROM obtener_estadisticas_cambios('fe74b94e5312bf43a9b0814e424745ea');

-- 4. Ver la fecha exacta del hash anterior
SELECT 
    '=== FECHA DEL HASH ANTERIOR ===' as seccion,
    version_hash,
    fecha_actualizacion
FROM version_control
WHERE version_hash = 'fe74b94e5312bf43a9b0814e424745ea';

-- 5. Comparación manual: ¿Cuántos productos tienen fecha_actualizacion DESPUÉS del hash anterior?
WITH version_anterior AS (
    SELECT fecha_actualizacion as fecha_version
    FROM version_control
    WHERE version_hash = 'fe74b94e5312bf43a9b0814e424745ea'
    LIMIT 1
)
SELECT 
    '=== COMPARACIÓN MANUAL ===' as seccion,
    COUNT(*) as productos_con_fecha_mayor,
    (SELECT fecha_version FROM version_anterior) as fecha_version_anterior
FROM productos, version_anterior
WHERE productos.fecha_actualizacion > version_anterior.fecha_version;

-- 6. Ver los productos que deberían aparecer como modificados
WITH version_anterior AS (
    SELECT fecha_actualizacion as fecha_version
    FROM version_control
    WHERE version_hash = 'fe74b94e5312bf43a9b0814e424745ea'
    LIMIT 1
)
SELECT 
    '=== PRODUCTOS QUE DEBERÍAN APARECER COMO MODIFICADOS ===' as seccion,
    productos.codigo,
    productos.descripcion,
    productos.pvp,
    productos.fecha_actualizacion as fecha_producto,
    version_anterior.fecha_version as fecha_version_anterior,
    productos.fecha_actualizacion > version_anterior.fecha_version as deberia_aparecer,
    EXTRACT(EPOCH FROM (productos.fecha_actualizacion - version_anterior.fecha_version)) as segundos_diferencia
FROM productos, version_anterior
WHERE productos.fecha_actualizacion > version_anterior.fecha_version
LIMIT 10;
