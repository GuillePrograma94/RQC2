-- Fix RLS presupuestos:
-- Permite operar a comerciales autenticados por app_metadata.usuario_id
-- cuando existe vinculo usuarios_comerciales(usuario_id -> id comercial).
-- Ejecutar despues de migration_presupuestos.sql.

-- ============================================
-- PRESUPUESTOS
-- ============================================
DROP POLICY IF EXISTS "presupuestos_select_cliente_comercial_admin" ON presupuestos;
CREATE POLICY "presupuestos_select_cliente_comercial_admin"
    ON presupuestos FOR SELECT
    TO authenticated
    USING (
        usuario_id_cliente = NULLIF((auth.jwt() -> 'app_metadata' ->> 'usuario_id'), '')::INTEGER
        OR comercial_id = NULLIF((auth.jwt() -> 'app_metadata' ->> 'comercial_id'), '')::INTEGER
        OR EXISTS (
            SELECT 1
            FROM usuarios_comerciales uc
            WHERE uc.id = presupuestos.comercial_id
              AND uc.usuario_id = NULLIF((auth.jwt() -> 'app_metadata' ->> 'usuario_id'), '')::INTEGER
        )
        OR ((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::BOOLEAN IS TRUE
    );

DROP POLICY IF EXISTS "presupuestos_insert_comercial_admin" ON presupuestos;
CREATE POLICY "presupuestos_insert_comercial_admin"
    ON presupuestos FOR INSERT
    TO authenticated
    WITH CHECK (
        comercial_id = NULLIF((auth.jwt() -> 'app_metadata' ->> 'comercial_id'), '')::INTEGER
        OR EXISTS (
            SELECT 1
            FROM usuarios_comerciales uc
            WHERE uc.id = presupuestos.comercial_id
              AND uc.usuario_id = NULLIF((auth.jwt() -> 'app_metadata' ->> 'usuario_id'), '')::INTEGER
        )
        OR ((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::BOOLEAN IS TRUE
    );

DROP POLICY IF EXISTS "presupuestos_update_comercial_admin" ON presupuestos;
CREATE POLICY "presupuestos_update_comercial_admin"
    ON presupuestos FOR UPDATE
    TO authenticated
    USING (
        comercial_id = NULLIF((auth.jwt() -> 'app_metadata' ->> 'comercial_id'), '')::INTEGER
        OR EXISTS (
            SELECT 1
            FROM usuarios_comerciales uc
            WHERE uc.id = presupuestos.comercial_id
              AND uc.usuario_id = NULLIF((auth.jwt() -> 'app_metadata' ->> 'usuario_id'), '')::INTEGER
        )
        OR ((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::BOOLEAN IS TRUE
    )
    WITH CHECK (
        comercial_id = NULLIF((auth.jwt() -> 'app_metadata' ->> 'comercial_id'), '')::INTEGER
        OR EXISTS (
            SELECT 1
            FROM usuarios_comerciales uc
            WHERE uc.id = presupuestos.comercial_id
              AND uc.usuario_id = NULLIF((auth.jwt() -> 'app_metadata' ->> 'usuario_id'), '')::INTEGER
        )
        OR ((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::BOOLEAN IS TRUE
    );

DROP POLICY IF EXISTS "presupuestos_delete_comercial_admin" ON presupuestos;
CREATE POLICY "presupuestos_delete_comercial_admin"
    ON presupuestos FOR DELETE
    TO authenticated
    USING (
        comercial_id = NULLIF((auth.jwt() -> 'app_metadata' ->> 'comercial_id'), '')::INTEGER
        OR EXISTS (
            SELECT 1
            FROM usuarios_comerciales uc
            WHERE uc.id = presupuestos.comercial_id
              AND uc.usuario_id = NULLIF((auth.jwt() -> 'app_metadata' ->> 'usuario_id'), '')::INTEGER
        )
        OR ((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::BOOLEAN IS TRUE
    );

-- ============================================
-- PRESUPUESTOS_LINEAS
-- ============================================
DROP POLICY IF EXISTS "presupuestos_lineas_select_por_cabecera" ON presupuestos_lineas;
CREATE POLICY "presupuestos_lineas_select_por_cabecera"
    ON presupuestos_lineas FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM presupuestos p
            WHERE p.id = presupuestos_lineas.presupuesto_id
              AND (
                    p.usuario_id_cliente = NULLIF((auth.jwt() -> 'app_metadata' ->> 'usuario_id'), '')::INTEGER
                 OR p.comercial_id = NULLIF((auth.jwt() -> 'app_metadata' ->> 'comercial_id'), '')::INTEGER
                 OR EXISTS (
                    SELECT 1
                    FROM usuarios_comerciales uc
                    WHERE uc.id = p.comercial_id
                      AND uc.usuario_id = NULLIF((auth.jwt() -> 'app_metadata' ->> 'usuario_id'), '')::INTEGER
                 )
                 OR ((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::BOOLEAN IS TRUE
              )
        )
    );

DROP POLICY IF EXISTS "presupuestos_lineas_write_por_cabecera" ON presupuestos_lineas;
CREATE POLICY "presupuestos_lineas_write_por_cabecera"
    ON presupuestos_lineas FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM presupuestos p
            WHERE p.id = presupuestos_lineas.presupuesto_id
              AND (
                    p.comercial_id = NULLIF((auth.jwt() -> 'app_metadata' ->> 'comercial_id'), '')::INTEGER
                 OR EXISTS (
                    SELECT 1
                    FROM usuarios_comerciales uc
                    WHERE uc.id = p.comercial_id
                      AND uc.usuario_id = NULLIF((auth.jwt() -> 'app_metadata' ->> 'usuario_id'), '')::INTEGER
                 )
                 OR ((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::BOOLEAN IS TRUE
              )
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM presupuestos p
            WHERE p.id = presupuestos_lineas.presupuesto_id
              AND (
                    p.comercial_id = NULLIF((auth.jwt() -> 'app_metadata' ->> 'comercial_id'), '')::INTEGER
                 OR EXISTS (
                    SELECT 1
                    FROM usuarios_comerciales uc
                    WHERE uc.id = p.comercial_id
                      AND uc.usuario_id = NULLIF((auth.jwt() -> 'app_metadata' ->> 'usuario_id'), '')::INTEGER
                 )
                 OR ((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::BOOLEAN IS TRUE
              )
        )
    );
