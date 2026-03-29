-- Migracion: empresa GLOBAL para ADMINISTRADOR (sin depender de almacen_habitual en JWT)
-- Contenido alineado con migration_empresas_por_almacen_admin_rls.sql (version actual).
-- Ejecutar solo si desplegaste una version antigua de admin_rls basada en JWT y necesitas sustituir politicas.
--
-- Clave reservada: almacen = 'GLOBAL' (datos de empresa unicos para toda la organizacion).
-- es_administrador solo puede escribir filas donde upper(trim(almacen)) = 'GLOBAL'.

DROP POLICY IF EXISTS "empresas_por_almacen_insert_admin" ON empresas_por_almacen;
CREATE POLICY "empresas_por_almacen_insert_admin"
    ON empresas_por_almacen FOR INSERT
    TO authenticated
    WITH CHECK (
        ((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::BOOLEAN IS TRUE
        OR (
            ((auth.jwt() -> 'app_metadata') ->> 'es_administrador')::BOOLEAN IS TRUE
            AND upper(trim(almacen)) = 'GLOBAL'
        )
    );

DROP POLICY IF EXISTS "empresas_por_almacen_update_admin" ON empresas_por_almacen;
CREATE POLICY "empresas_por_almacen_update_admin"
    ON empresas_por_almacen FOR UPDATE
    TO authenticated
    USING (
        ((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::BOOLEAN IS TRUE
        OR (
            ((auth.jwt() -> 'app_metadata') ->> 'es_administrador')::BOOLEAN IS TRUE
            AND upper(trim(almacen)) = 'GLOBAL'
        )
    )
    WITH CHECK (
        ((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::BOOLEAN IS TRUE
        OR (
            ((auth.jwt() -> 'app_metadata') ->> 'es_administrador')::BOOLEAN IS TRUE
            AND upper(trim(almacen)) = 'GLOBAL'
        )
    );

DROP POLICY IF EXISTS "empresas_por_almacen_delete_admin" ON empresas_por_almacen;
CREATE POLICY "empresas_por_almacen_delete_admin"
    ON empresas_por_almacen FOR DELETE
    TO authenticated
    USING (
        ((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::BOOLEAN IS TRUE
        OR (
            ((auth.jwt() -> 'app_metadata') ->> 'es_administrador')::BOOLEAN IS TRUE
            AND upper(trim(almacen)) = 'GLOBAL'
        )
    );

DROP POLICY IF EXISTS "logos_empresa_insert_admin" ON storage.objects;
CREATE POLICY "logos_empresa_insert_admin"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'logos_empresa'
        AND (
            ((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::BOOLEAN IS TRUE
            OR (
                ((auth.jwt() -> 'app_metadata') ->> 'es_administrador')::BOOLEAN IS TRUE
                AND upper(trim(split_part(name, '/', 1))) = 'GLOBAL'
            )
        )
    );

DROP POLICY IF EXISTS "logos_empresa_update_admin" ON storage.objects;
CREATE POLICY "logos_empresa_update_admin"
    ON storage.objects FOR UPDATE
    TO authenticated
    USING (
        bucket_id = 'logos_empresa'
        AND (
            ((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::BOOLEAN IS TRUE
            OR (
                ((auth.jwt() -> 'app_metadata') ->> 'es_administrador')::BOOLEAN IS TRUE
                AND upper(trim(split_part(name, '/', 1))) = 'GLOBAL'
            )
        )
    );

DROP POLICY IF EXISTS "logos_empresa_delete_admin" ON storage.objects;
CREATE POLICY "logos_empresa_delete_admin"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'logos_empresa'
        AND (
            ((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::BOOLEAN IS TRUE
            OR (
                ((auth.jwt() -> 'app_metadata') ->> 'es_administrador')::BOOLEAN IS TRUE
                AND upper(trim(split_part(name, '/', 1))) = 'GLOBAL'
            )
        )
    );
