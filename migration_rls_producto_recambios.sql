-- =============================================================================
-- RLS: tabla producto_recambios
-- =============================================================================
-- Contexto:
--   - El cliente Supabase del navegador usa la clave 'anon'.
--   - Al hacer login, la API de Vercel (api/auth/login.js) crea/actualiza el
--     usuario en Supabase Auth con app_metadata = { es_administrador: true/false }.
--   - El frontend llama a signInWithPassword y obtiene un JWT que incluye ese
--     claim en app_metadata.
--   - Las politicas de lectura deben ser abiertas (incluso invitados ven recambios
--     en las fichas de producto).
--   - Las politicas de escritura (INSERT, DELETE) solo deben permitirse cuando
--     el JWT lleva es_administrador = true en app_metadata.
-- =============================================================================

-- 1. Asegurarse de que RLS esta habilitado
ALTER TABLE producto_recambios ENABLE ROW LEVEL SECURITY;

-- 2. Eliminar politicas anteriores para partir de cero
DROP POLICY IF EXISTS "producto_recambios_select"        ON producto_recambios;
DROP POLICY IF EXISTS "producto_recambios_insert"        ON producto_recambios;
DROP POLICY IF EXISTS "producto_recambios_delete"        ON producto_recambios;
DROP POLICY IF EXISTS "producto_recambios_update"        ON producto_recambios;
DROP POLICY IF EXISTS "allow_write_anon"                 ON producto_recambios;
DROP POLICY IF EXISTS "admin_write_producto_recambios"   ON producto_recambios;
DROP POLICY IF EXISTS "Permitir lectura"                 ON producto_recambios;
DROP POLICY IF EXISTS "Solo administrador puede escribir" ON producto_recambios;

-- 3. Lectura: cualquier usuario (autenticado o invitado) puede leer
--    Necesario para mostrar recambios en fichas de producto sin login.
CREATE POLICY "producto_recambios_select"
    ON producto_recambios
    FOR SELECT
    USING (true);

-- 4. INSERT: solo si el JWT contiene app_metadata.es_administrador = true
--    Este claim lo escribe api/auth/login.js con service_role en cada login.
CREATE POLICY "producto_recambios_insert"
    ON producto_recambios
    FOR INSERT
    WITH CHECK (
        ((auth.jwt() -> 'app_metadata') ->> 'es_administrador')::boolean IS TRUE
    );

-- 5. DELETE: misma condicion que INSERT
CREATE POLICY "producto_recambios_delete"
    ON producto_recambios
    FOR DELETE
    USING (
        ((auth.jwt() -> 'app_metadata') ->> 'es_administrador')::boolean IS TRUE
    );

-- 6. Verificacion: muestra las politicas activas sobre la tabla
SELECT
    policyname,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE tablename = 'producto_recambios'
ORDER BY cmd;
