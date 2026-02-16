-- ============================================================
-- TEST COMPLETO DE LA RPC upsert_productos_masivo_con_fecha
-- ============================================================
-- Este test valida que la RPC:
-- 1. Retorna filas para INSERT
-- 2. Retorna filas para UPDATE con cambios reales
-- 3. NO retorna filas para UPDATE con datos idénticos
-- ============================================================

-- Limpiar
DELETE FROM productos WHERE codigo IN ('__TEST_A__', '__TEST_B__', '__TEST_C__');

-- ============================================================
-- CASO 1: INSERT de 3 productos nuevos
-- Debe retornar 3 filas (todos son INSERT)
-- ============================================================
SELECT '============================================================' as info;
SELECT 'CASO 1: INSERT de 3 productos nuevos' as info;
SELECT '============================================================' as info;

WITH rpc_result AS (
    SELECT * FROM upsert_productos_masivo_con_fecha(
        '[
            {"codigo": "__TEST_A__", "descripcion": "Producto A", "pvp": 10.50},
            {"codigo": "__TEST_B__", "descripcion": "Producto B", "pvp": 20.99},
            {"codigo": "__TEST_C__", "descripcion": "Producto C", "pvp": 30.75}
        ]'::jsonb
    )
)
SELECT 
    'Resultado CASO 1' as test,
    COUNT(*) as filas_retornadas,
    SUM(CASE WHEN accion = 'INSERT' THEN 1 ELSE 0 END) as inserts,
    SUM(CASE WHEN accion = 'UPDATE' THEN 1 ELSE 0 END) as updates,
    CASE 
        WHEN COUNT(*) = 3 AND SUM(CASE WHEN accion = 'INSERT' THEN 1 ELSE 0 END) = 3
        THEN '✅ CORRECTO: 3 INSERT'
        ELSE '❌ ERROR: Debería retornar 3 INSERT'
    END as resultado
FROM rpc_result;

-- Esperar 2 segundos
SELECT pg_sleep(2);

-- ============================================================
-- CASO 2: UPDATE con datos IDÉNTICOS
-- Debe retornar 0 filas (no hay cambios)
-- ============================================================
SELECT '============================================================' as info;
SELECT 'CASO 2: UPDATE con datos IDÉNTICOS' as info;
SELECT '============================================================' as info;

WITH rpc_result AS (
    SELECT * FROM upsert_productos_masivo_con_fecha(
        '[
            {"codigo": "__TEST_A__", "descripcion": "Producto A", "pvp": 10.50},
            {"codigo": "__TEST_B__", "descripcion": "Producto B", "pvp": 20.99},
            {"codigo": "__TEST_C__", "descripcion": "Producto C", "pvp": 30.75}
        ]'::jsonb
    )
)
SELECT 
    'Resultado CASO 2' as test,
    COUNT(*) as filas_retornadas,
    CASE 
        WHEN COUNT(*) = 0
        THEN '✅ CORRECTO: 0 filas (datos idénticos, sin cambios)'
        ELSE '❌ ERROR: Debería retornar 0 filas (datos idénticos)'
    END as resultado
FROM rpc_result;

-- Esperar 2 segundos
SELECT pg_sleep(2);

-- ============================================================
-- CASO 3: UPDATE mixto - 1 con cambios, 2 sin cambios
-- Debe retornar 1 fila (solo el que cambió)
-- ============================================================
SELECT '============================================================' as info;
SELECT 'CASO 3: UPDATE mixto - 1 cambia, 2 NO cambian' as info;
SELECT '============================================================' as info;

WITH rpc_result AS (
    SELECT * FROM upsert_productos_masivo_con_fecha(
        '[
            {"codigo": "__TEST_A__", "descripcion": "Producto A", "pvp": 10.50},
            {"codigo": "__TEST_B__", "descripcion": "Producto B MODIFICADO", "pvp": 20.99},
            {"codigo": "__TEST_C__", "descripcion": "Producto C", "pvp": 30.75}
        ]'::jsonb
    )
)
SELECT 
    'Resultado CASO 3' as test,
    COUNT(*) as filas_retornadas,
    SUM(CASE WHEN accion = 'UPDATE' THEN 1 ELSE 0 END) as updates,
    STRING_AGG(codigo, ', ' ORDER BY codigo) as codigos_modificados,
    CASE 
        WHEN COUNT(*) = 1 
             AND SUM(CASE WHEN accion = 'UPDATE' THEN 1 ELSE 0 END) = 1
             AND EXISTS (SELECT 1 FROM rpc_result WHERE codigo = '__TEST_B__')
        THEN '✅ CORRECTO: Solo retornó el producto B que cambió'
        ELSE '❌ ERROR: Debería retornar solo 1 fila (__TEST_B__)'
    END as resultado
FROM rpc_result;

-- Esperar 2 segundos
SELECT pg_sleep(2);

-- ============================================================
-- CASO 4: Cambios de precio (todos cambian)
-- Debe retornar 3 filas (todos UPDATE)
-- ============================================================
SELECT '============================================================' as info;
SELECT 'CASO 4: Cambio de precio en todos' as info;
SELECT '============================================================' as info;

WITH rpc_result AS (
    SELECT * FROM upsert_productos_masivo_con_fecha(
        '[
            {"codigo": "__TEST_A__", "descripcion": "Producto A", "pvp": 11.00},
            {"codigo": "__TEST_B__", "descripcion": "Producto B MODIFICADO", "pvp": 21.00},
            {"codigo": "__TEST_C__", "descripcion": "Producto C", "pvp": 31.00}
        ]'::jsonb
    )
)
SELECT 
    'Resultado CASO 4' as test,
    COUNT(*) as filas_retornadas,
    SUM(CASE WHEN accion = 'UPDATE' THEN 1 ELSE 0 END) as updates,
    CASE 
        WHEN COUNT(*) = 3 AND SUM(CASE WHEN accion = 'UPDATE' THEN 1 ELSE 0 END) = 3
        THEN '✅ CORRECTO: 3 UPDATE (todos cambiaron precio)'
        ELSE '❌ ERROR: Debería retornar 3 UPDATE'
    END as resultado
FROM rpc_result;

-- ============================================================
-- RESUMEN FINAL
-- ============================================================
SELECT '============================================================' as info;
SELECT 'RESUMEN: Verificar fechas en BD' as info;
SELECT '============================================================' as info;

SELECT 
    codigo,
    descripcion,
    pvp,
    fecha_actualizacion,
    CASE 
        WHEN fecha_actualizacion > NOW() - INTERVAL '5 seconds'
        THEN 'Actualizado recientemente (CASO 4)'
        ELSE 'Fecha antigua (posible error)'
    END as estado_fecha
FROM productos 
WHERE codigo IN ('__TEST_A__', '__TEST_B__', '__TEST_C__')
ORDER BY codigo;

-- Limpiar
DELETE FROM productos WHERE codigo IN ('__TEST_A__', '__TEST_B__', '__TEST_C__');

SELECT '============================================================' as info;
SELECT '✅ Test completado - Productos de prueba eliminados' as info;
SELECT '============================================================' as info;
