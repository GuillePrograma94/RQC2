-- Solicitudes de articulos nuevos (Dependiente / Comercial).
-- Ejecutar DESPUES de migration_proveedores_productos.sql (depende de tabla proveedores).

-- ============================================
-- 1. TABLA SOLICITUDES_ARTICULOS_NUEVOS
-- ============================================
CREATE TABLE IF NOT EXISTS solicitudes_articulos_nuevos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo_proveedor TEXT NOT NULL REFERENCES proveedores(codigo_proveedor) ON UPDATE CASCADE ON DELETE RESTRICT,
    descripcion TEXT NOT NULL,
    ref_proveedor TEXT,
    tarifa TEXT,
    pagina INTEGER,
    precio NUMERIC NOT NULL CHECK (precio > 0),
    foto_url TEXT,
    auth_uid UUID NOT NULL,
    user_id INTEGER,
    comercial_id INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    estado TEXT NOT NULL DEFAULT 'pendiente'
);

COMMENT ON TABLE solicitudes_articulos_nuevos IS 'Solicitudes de creacion de articulos nuevos desde scan_client_mobile (solo Dependiente o Comercial).';
COMMENT ON COLUMN solicitudes_articulos_nuevos.codigo_proveedor IS 'Proveedor del articulo. FK a proveedores.';
COMMENT ON COLUMN solicitudes_articulos_nuevos.auth_uid IS 'Supabase Auth UUID del solicitante; usado en RLS UPDATE/SELECT.';
COMMENT ON COLUMN solicitudes_articulos_nuevos.user_id IS 'usuarios.id si el solicitante es DEPENDIENTE.';
COMMENT ON COLUMN solicitudes_articulos_nuevos.comercial_id IS 'usuarios_comerciales.id si el solicitante es COMERCIAL.';

CREATE INDEX IF NOT EXISTS idx_solicitudes_articulos_auth_uid ON solicitudes_articulos_nuevos(auth_uid);
CREATE INDEX IF NOT EXISTS idx_solicitudes_articulos_created_at ON solicitudes_articulos_nuevos(created_at DESC);

-- ============================================
-- 2. ROW LEVEL SECURITY
-- ============================================
ALTER TABLE solicitudes_articulos_nuevos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "solicitudes_articulos_insert_dependiente_comercial" ON solicitudes_articulos_nuevos;
CREATE POLICY "solicitudes_articulos_insert_dependiente_comercial"
    ON solicitudes_articulos_nuevos
    FOR INSERT
    WITH CHECK (
        (auth.jwt() -> 'app_metadata' ->> 'usuario_id')::int IN (
            SELECT id FROM public.usuarios WHERE tipo IN ('DEPENDIENTE', 'COMERCIAL')
        )
    );

DROP POLICY IF EXISTS "solicitudes_articulos_update_owner" ON solicitudes_articulos_nuevos;
CREATE POLICY "solicitudes_articulos_update_owner"
    ON solicitudes_articulos_nuevos
    FOR UPDATE
    USING (auth_uid = auth.uid())
    WITH CHECK (auth_uid = auth.uid());

DROP POLICY IF EXISTS "solicitudes_articulos_select_owner" ON solicitudes_articulos_nuevos;
CREATE POLICY "solicitudes_articulos_select_owner"
    ON solicitudes_articulos_nuevos
    FOR SELECT
    USING (auth_uid = auth.uid());

-- ============================================
-- 3. STORAGE BUCKET (crear en dashboard si no existe)
-- ============================================
-- Bucket: solicitudes-articulos-fotos
-- Ruta sugerida por solicitud: {solicitud_id}/{nombre_archivo}
-- Politica INSERT del bucket: mismo criterio que INSERT en la tabla:
--   (auth.jwt() -> 'app_metadata' ->> 'usuario_id')::int IN (SELECT id FROM public.usuarios WHERE tipo IN ('DEPENDIENTE', 'COMERCIAL'))
