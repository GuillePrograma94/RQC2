-- =============================================================================
-- Familias: titulo e imagen para pantalla Inicio (bucket publico fotos_familias)
-- Storage: lectura publica; escritura solo JWT con app_metadata.es_administrador = true
-- Ejecutar en Supabase SQL Editor despues de crear el bucket "fotos_familias" (publico).
-- =============================================================================

ALTER TABLE familias
    ADD COLUMN IF NOT EXISTS titulo_inicio TEXT NULL;
ALTER TABLE familias
    ADD COLUMN IF NOT EXISTS imagen_storage_path TEXT NULL;

COMMENT ON COLUMN familias.titulo_inicio IS
    'Titulo opcional en Inicio; si tiene texto, sustituye a DESCRIPCION en la loseta y oculta el codigo bajo el titulo.';
COMMENT ON COLUMN familias.imagen_storage_path IS
    'Ruta dentro del bucket fotos_familias (ej. F00.jpg). Vacio: convencion externa legada opcional.';

-- Escritura catalogo UI: solo administrador (JWT del login de la app)
DROP POLICY IF EXISTS familias_update_admin_catalogo ON familias;
CREATE POLICY familias_update_admin_catalogo
    ON familias
    FOR UPDATE
    TO authenticated
    USING (
        ((auth.jwt() -> 'app_metadata') ->> 'es_administrador')::boolean IS TRUE
    )
    WITH CHECK (
        ((auth.jwt() -> 'app_metadata') ->> 'es_administrador')::boolean IS TRUE
    );

GRANT UPDATE ON familias TO authenticated;

-- -----------------------------------------------------------------------------
-- Storage: bucket "fotos_familias" (crear en el panel como Public si aun no existe)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS fotos_familias_select_public ON storage.objects;
CREATE POLICY fotos_familias_select_public
    ON storage.objects
    FOR SELECT
    USING (bucket_id = 'fotos_familias');

DROP POLICY IF EXISTS fotos_familias_insert_admin ON storage.objects;
CREATE POLICY fotos_familias_insert_admin
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'fotos_familias'
        AND ((auth.jwt() -> 'app_metadata') ->> 'es_administrador')::boolean IS TRUE
    );

DROP POLICY IF EXISTS fotos_familias_update_admin ON storage.objects;
CREATE POLICY fotos_familias_update_admin
    ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (
        bucket_id = 'fotos_familias'
        AND ((auth.jwt() -> 'app_metadata') ->> 'es_administrador')::boolean IS TRUE
    )
    WITH CHECK (
        bucket_id = 'fotos_familias'
        AND ((auth.jwt() -> 'app_metadata') ->> 'es_administrador')::boolean IS TRUE
    );

DROP POLICY IF EXISTS fotos_familias_delete_admin ON storage.objects;
CREATE POLICY fotos_familias_delete_admin
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'fotos_familias'
        AND ((auth.jwt() -> 'app_metadata') ->> 'es_administrador')::boolean IS TRUE
    );
