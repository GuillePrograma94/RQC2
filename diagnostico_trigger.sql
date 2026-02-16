-- ============================================================
-- DIAGNÓSTICO DEL TRIGGER: Ver exactamente qué está pasando
-- ============================================================

-- Limpiar
DELETE FROM productos WHERE codigo = '__TEST_TRIGGER__';

-- 1) Insertar producto inicial
INSERT INTO productos (codigo, descripcion, pvp, fecha_creacion, fecha_actualizacion)
VALUES ('__TEST_TRIGGER__', 'Texto original', 50.00, NOW(), NOW());

-- Ver estado inicial
SELECT 
    'ESTADO INICIAL' as paso,
    codigo, 
    descripcion, 
    pvp,
    fecha_actualizacion
FROM productos 
WHERE codigo = '__TEST_TRIGGER__';

-- Esperar 2 segundos
SELECT pg_sleep(2);

-- 2) Hacer UPDATE con datos IDÉNTICOS (descripcion y pvp iguales)
-- El trigger NO debería cambiar fecha_actualizacion
UPDATE productos
SET 
    descripcion = 'Texto original',  -- Mismo texto
    pvp = 50.00                       -- Mismo precio
WHERE codigo = '__TEST_TRIGGER__';

-- Ver resultado
SELECT 
    'DESPUÉS UPDATE IDÉNTICO' as paso,
    codigo, 
    descripcion, 
    pvp,
    fecha_actualizacion,
    CASE 
        WHEN fecha_actualizacion < NOW() - INTERVAL '1 second' 
        THEN '✅ CORRECTO: Fecha NO cambió'
        ELSE '❌ ERROR: Fecha cambió cuando NO debía'
    END as test_resultado
FROM productos 
WHERE codigo = '__TEST_TRIGGER__';

-- Esperar 2 segundos
SELECT pg_sleep(2);

-- 3) Hacer UPDATE con descripción DIFERENTE
-- El trigger SÍ debe cambiar fecha_actualizacion
UPDATE productos
SET 
    descripcion = 'Texto MODIFICADO',  -- Texto diferente
    pvp = 50.00                         -- Mismo precio
WHERE codigo = '__TEST_TRIGGER__';

-- Ver resultado
SELECT 
    'DESPUÉS UPDATE DIFERENTE' as paso,
    codigo, 
    descripcion, 
    pvp,
    fecha_actualizacion,
    CASE 
        WHEN fecha_actualizacion > NOW() - INTERVAL '1 second' 
        THEN '✅ CORRECTO: Fecha SÍ cambió'
        ELSE '❌ ERROR: Fecha NO cambió cuando SÍ debía'
    END as test_resultado
FROM productos 
WHERE codigo = '__TEST_TRIGGER__';

-- Esperar 2 segundos
SELECT pg_sleep(2);

-- 4) Hacer UPDATE con PVP DIFERENTE
-- El trigger SÍ debe cambiar fecha_actualizacion
UPDATE productos
SET 
    descripcion = 'Texto MODIFICADO',  -- Mismo texto que antes
    pvp = 51.00                         -- Precio diferente
WHERE codigo = '__TEST_TRIGGER__';

-- Ver resultado final
SELECT 
    'DESPUÉS CAMBIO PVP' as paso,
    codigo, 
    descripcion, 
    pvp,
    fecha_actualizacion,
    CASE 
        WHEN fecha_actualizacion > NOW() - INTERVAL '1 second' 
        THEN '✅ CORRECTO: Fecha cambió por cambio de PVP'
        ELSE '❌ ERROR: Fecha NO cambió con cambio de PVP'
    END as test_resultado
FROM productos 
WHERE codigo = '__TEST_TRIGGER__';

-- Limpiar
DELETE FROM productos WHERE codigo = '__TEST_TRIGGER__';

-- ============================================================
-- INTERPRETACIÓN
-- ============================================================
-- Deberías ver 4 filas de resultado:
-- 1. ESTADO INICIAL
-- 2. DESPUÉS UPDATE IDÉNTICO → ✅ Fecha NO cambió
-- 3. DESPUÉS UPDATE DIFERENTE → ✅ Fecha SÍ cambió
-- 4. DESPUÉS CAMBIO PVP → ✅ Fecha cambió por cambio de PVP
--
-- Si alguno muestra ❌ ERROR, el trigger no funciona correctamente
