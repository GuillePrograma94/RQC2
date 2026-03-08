-- RLS para que usuarios con rol ADMINISTRACION puedan ver y actualizar solicitudes de articulos nuevos.
-- Ejecutar DESPUES de migration_usuarios_tipo_administracion.sql y migration_solicitudes_articulos_nuevos.sql.
-- El JWT debe llevar app_metadata.es_administracion = true (API login).

-- SELECT: ADMINISTRACION ve todas las filas (para listado y conteo pendientes).
DROP POLICY IF EXISTS "solicitudes_articulos_select_administracion" ON solicitudes_articulos_nuevos;
CREATE POLICY "solicitudes_articulos_select_administracion"
    ON solicitudes_articulos_nuevos FOR SELECT
    USING (
        ((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::boolean IS TRUE
    );

-- UPDATE: ADMINISTRACION puede cambiar estado (aprobado/rechazado).
DROP POLICY IF EXISTS "solicitudes_articulos_update_administracion" ON solicitudes_articulos_nuevos;
CREATE POLICY "solicitudes_articulos_update_administracion"
    ON solicitudes_articulos_nuevos FOR UPDATE
    USING (
        ((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::boolean IS TRUE
    )
    WITH CHECK (
        ((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::boolean IS TRUE
    );
