-- ============================================================
-- Verificación: que la migración incremental está aplicada
-- Ejecuta esto en Supabase > SQL Editor
-- ============================================================
-- Si la función NO contiene 'TRIM' y 'IS DISTINCT FROM' para pvp,
-- ejecuta de nuevo migration_sincronizacion_incremental.sql completo.

-- 1) Ver definición de la función de productos (debe contener TRIM y 0.0001)
SELECT pg_get_functiondef(oid) AS definicion
FROM pg_proc
WHERE proname = 'upsert_productos_masivo_con_fecha';

-- 2) Ver definición del trigger de productos (debe contener TRIM y 0.0001)
SELECT pg_get_functiondef(oid) AS definicion
FROM pg_proc
WHERE proname = 'actualizar_fecha_productos';

-- 3) Ver definición del trigger de códigos (debe contener TRIM)
SELECT pg_get_functiondef(oid) AS definicion
FROM pg_proc
WHERE proname = 'actualizar_fecha_codigos_secundarios';
