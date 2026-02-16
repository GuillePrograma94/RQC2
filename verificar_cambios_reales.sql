-- ============================================================
-- VERIFICACIÓN IGNORANDO PROBLEMAS DE ZONA HORARIA
-- ============================================================

-- 1. Ver la fecha ACTUAL del servidor de Supabase
SELECT 
    '=== HORA ACTUAL SERVIDOR SUPABASE ===' as seccion,
    NOW() as hora_utc,
    NOW() AT TIME ZONE 'Europe/Madrid' as hora_madrid,
    EXTRACT(TIMEZONE_HOUR FROM NOW()) as diferencia_horas;

-- 2. Ver los últimos 3 hashes con fechas
SELECT 
    '=== ÚLTIMOS 3 HASHES ===' as seccion,
    version_hash,
    fecha_actualizacion,
    EXTRACT(EPOCH FROM (NOW() - fecha_actualizacion)) / 60 as minutos_desde_creacion
FROM version_control
ORDER BY fecha_actualizacion DESC
LIMIT 3;

-- 3. Ver los productos MÁS RECIENTEMENTE actualizados (top 10)
SELECT 
    '=== TOP 10 PRODUCTOS MÁS RECIENTES ===' as seccion,
    codigo,
    descripcion,
    pvp,
    fecha_actualizacion,
    EXTRACT(EPOCH FROM (NOW() - fecha_actualizacion)) / 60 as minutos_desde_actualizacion
FROM productos
ORDER BY fecha_actualizacion DESC
LIMIT 10;

-- 4. ¿Hay productos modificados DESPUÉS del penúltimo hash?
-- (El último hash es el actual, el penúltimo es la versión anterior del cliente)
WITH hash_anterior AS (
    SELECT fecha_actualizacion
    FROM version_control
    ORDER BY fecha_actualizacion DESC
    OFFSET 1
    LIMIT 1
)
SELECT 
    '=== PRODUCTOS DESPUÉS DEL HASH ANTERIOR ===' as seccion,
    COUNT(*) as total_productos,
    MIN(fecha_actualizacion) as primera_actualizacion,
    MAX(fecha_actualizacion) as ultima_actualizacion,
    (SELECT fecha_actualizacion FROM hash_anterior) as fecha_hash_anterior
FROM productos
WHERE fecha_actualizacion > (SELECT fecha_actualizacion FROM hash_anterior);

-- 5. Ver específicamente qué productos cambiaron entre los dos últimos hashes
WITH hash_actual AS (
    SELECT fecha_actualizacion
    FROM version_control
    ORDER BY fecha_actualizacion DESC
    LIMIT 1
),
hash_anterior AS (
    SELECT fecha_actualizacion
    FROM version_control
    ORDER BY fecha_actualizacion DESC
    OFFSET 1
    LIMIT 1
)
SELECT 
    '=== PRODUCTOS QUE CAMBIARON ENTRE LOS 2 ÚLTIMOS HASHES ===' as seccion,
    codigo,
    descripcion,
    pvp,
    fecha_actualizacion,
    (SELECT fecha_actualizacion FROM hash_anterior) as desde_hash,
    (SELECT fecha_actualizacion FROM hash_actual) as hasta_hash,
    CASE 
        WHEN fecha_actualizacion > (SELECT fecha_actualizacion FROM hash_anterior)
             AND fecha_actualizacion <= (SELECT fecha_actualizacion FROM hash_actual)
        THEN '✅ SÍ'
        ELSE '❌ NO'
    END as esta_en_rango
FROM productos
WHERE fecha_actualizacion > (SELECT fecha_actualizacion FROM hash_anterior)
ORDER BY fecha_actualizacion DESC
LIMIT 20;
