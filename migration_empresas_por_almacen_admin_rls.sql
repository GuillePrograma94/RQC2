-- Migracion: empresas_por_almacen escritura para ADMINISTRADOR (catalogo ONTINYENT, GANDIA, ALZIRA, REQUENA) + Storage logos_empresa
-- Ejecutar en Supabase SQL Editor despues de migration_presupuestos.sql
--
-- Mismo criterio que almacen habitual del cliente en BD.
-- 1) RLS: INSERT/UPDATE/DELETE si es_administracion O (es_administrador y almacen en catalogo)

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

-- 2) Bucket publico para URLs en logo_url (lectura anonima para PDF / img src)

INSERT INTO storage.buckets (id, name, public)
VALUES ('logos_empresa', 'logos_empresa', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Politicas storage.objects (evitar duplicados si se re-ejecuta)

DROP POLICY IF EXISTS "logos_empresa_select_public" ON storage.objects;
CREATE POLICY "logos_empresa_select_public"
    ON storage.objects FOR SELECT
    TO public
    USING (bucket_id = 'logos_empresa');

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
