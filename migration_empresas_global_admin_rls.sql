-- Parche: sustituye politicas GLOBAL por catalogo ONTINYENT / GANDIA / ALZIRA / REQUENA
-- Ejecutar en Supabase si solo tenias aplicada la version GLOBAL.
-- Contenido equivalente a migration_empresas_por_almacen_admin_rls.sql (seccion RLS + storage).

DROP POLICY IF EXISTS "empresas_por_almacen_insert_admin" ON empresas_por_almacen;
CREATE POLICY "empresas_por_almacen_insert_admin"
    ON empresas_por_almacen FOR INSERT
    TO authenticated
    WITH CHECK (
        ((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::BOOLEAN IS TRUE
        OR (
            ((auth.jwt() -> 'app_metadata') ->> 'es_administrador')::BOOLEAN IS TRUE
            AND upper(trim(almacen)) IN ('ONTINYENT', 'GANDIA', 'ALZIRA', 'REQUENA')
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
            AND upper(trim(almacen)) IN ('ONTINYENT', 'GANDIA', 'ALZIRA', 'REQUENA')
        )
    )
    WITH CHECK (
        ((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::BOOLEAN IS TRUE
        OR (
            ((auth.jwt() -> 'app_metadata') ->> 'es_administrador')::BOOLEAN IS TRUE
            AND upper(trim(almacen)) IN ('ONTINYENT', 'GANDIA', 'ALZIRA', 'REQUENA')
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
            AND upper(trim(almacen)) IN ('ONTINYENT', 'GANDIA', 'ALZIRA', 'REQUENA')
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
                AND upper(trim(split_part(name, '/', 1))) IN ('ONTINYENT', 'GANDIA', 'ALZIRA', 'REQUENA')
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
                AND upper(trim(split_part(name, '/', 1))) IN ('ONTINYENT', 'GANDIA', 'ALZIRA', 'REQUENA')
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
                AND upper(trim(split_part(name, '/', 1))) IN ('ONTINYENT', 'GANDIA', 'ALZIRA', 'REQUENA')
            )
        )
    );
