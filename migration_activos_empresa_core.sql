-- Gestion de activos de empresa (mobiliario: vehiculos, impresoras, ordenadores, etc.)
-- Ejecutar en Supabase SQL Editor. Requiere JWT app_metadata (login API existente).
-- Referencia funcional: Flora/APP_GESTION (adaptado a Supabase + scan_client_mobile).

-- ============================================
-- 1) TABLAS NUCLEO
-- ============================================

CREATE TABLE IF NOT EXISTS activos_categorias (
    codigo TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    orden INTEGER NOT NULL DEFAULT 0,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE activos_categorias IS 'Catalogo de tipos de activo (vehiculo, impresora, ordenador, telefono, ...).';

CREATE TABLE IF NOT EXISTS activos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    categoria_codigo TEXT NOT NULL REFERENCES activos_categorias(codigo) ON UPDATE CASCADE,
    nombre TEXT NOT NULL,
    identificador TEXT,
    estado TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'inactivo', 'mantenimiento', 'averia')),
    datos JSONB NOT NULL DEFAULT '{}'::jsonb,
    factura_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activos_categoria ON activos(categoria_codigo);
CREATE INDEX IF NOT EXISTS idx_activos_estado ON activos(estado);

COMMENT ON TABLE activos IS 'Ficha maestra de cada activo. Campos especificos en datos (JSONB).';
COMMENT ON COLUMN activos.identificador IS 'Matricula, numero de serie, IMEI, etc.';
COMMENT ON COLUMN activos.datos IS 'Campos por categoria: kilometraje_actual, fecha_itv, modelo, contador_paginas, etc.';

CREATE TABLE IF NOT EXISTS activos_asignaciones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    activo_id UUID NOT NULL REFERENCES activos(id) ON DELETE CASCADE,
    auth_uid UUID NOT NULL,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    comercial_id INTEGER REFERENCES usuarios_comerciales(id) ON DELETE SET NULL,
    activa BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_desde TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fecha_hasta TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activos_asignaciones_auth ON activos_asignaciones(auth_uid) WHERE activa = TRUE;
CREATE INDEX IF NOT EXISTS idx_activos_asignaciones_activo ON activos_asignaciones(activo_id) WHERE activa = TRUE;

-- Solo una asignacion activa por activo
CREATE UNIQUE INDEX IF NOT EXISTS uq_activos_asignacion_activa
    ON activos_asignaciones(activo_id)
    WHERE activa = TRUE;

COMMENT ON TABLE activos_asignaciones IS 'Vinculo trabajador-activo. auth_uid del JWT Supabase Auth.';

CREATE TABLE IF NOT EXISTS activos_registros (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    activo_id UUID NOT NULL REFERENCES activos(id) ON DELETE CASCADE,
    auth_uid UUID NOT NULL,
    tipo TEXT NOT NULL,
    datos JSONB NOT NULL DEFAULT '{}'::jsonb,
    fecha DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activos_registros_activo_fecha ON activos_registros(activo_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_activos_registros_tipo ON activos_registros(tipo);

COMMENT ON TABLE activos_registros IS 'Historial: uso diario vehiculo, eventos impresora/ordenador, etc.';

-- ============================================
-- 2) SEED CATEGORIAS
-- ============================================

INSERT INTO activos_categorias (codigo, nombre, activo, orden, config) VALUES
    ('vehiculo', 'Vehiculos', TRUE, 10, '{"trabajadorPuedeRegistrar": true, "tiposRegistro": ["uso_vehiculo"]}'::jsonb),
    ('impresora', 'Impresoras', TRUE, 20, '{"trabajadorPuedeRegistrar": false, "tiposRegistro": ["evento_impresora"]}'::jsonb),
    ('ordenador', 'Ordenadores', TRUE, 30, '{"trabajadorPuedeRegistrar": false, "tiposRegistro": ["evento_ordenador"]}'::jsonb),
    ('telefono', 'Telefonos', TRUE, 40, '{"trabajadorPuedeRegistrar": false, "tiposRegistro": ["evento_telefono"]}'::jsonb)
ON CONFLICT (codigo) DO UPDATE SET
    nombre = EXCLUDED.nombre,
    activo = EXCLUDED.activo,
    orden = EXCLUDED.orden,
    config = EXCLUDED.config;

-- ============================================
-- 3) TRIGGER updated_at
-- ============================================

CREATE OR REPLACE FUNCTION activos_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_activos_updated_at ON activos;
CREATE TRIGGER trg_activos_updated_at
    BEFORE UPDATE ON activos
    FOR EACH ROW
    EXECUTE FUNCTION activos_set_updated_at();

-- ============================================
-- 4) HELPERS RLS
-- ============================================

CREATE OR REPLACE FUNCTION activos_es_administracion()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::boolean, FALSE);
$$;

CREATE OR REPLACE FUNCTION activos_es_trabajador()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(((auth.jwt() -> 'app_metadata') ->> 'es_dependiente')::boolean, FALSE)
        OR COALESCE(((auth.jwt() -> 'app_metadata') ->> 'es_comercial')::boolean, FALSE);
$$;

CREATE OR REPLACE FUNCTION activos_tiene_asignacion_activa(p_activo_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM activos_asignaciones aa
        WHERE aa.activo_id = p_activo_id
          AND aa.activa = TRUE
          AND aa.auth_uid = auth.uid()
    );
$$;

-- ============================================
-- 5) RLS
-- ============================================

ALTER TABLE activos_categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE activos ENABLE ROW LEVEL SECURITY;
ALTER TABLE activos_asignaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE activos_registros ENABLE ROW LEVEL SECURITY;

-- Categorias: lectura para autenticados; escritura solo administracion
DROP POLICY IF EXISTS activos_categorias_select ON activos_categorias;
CREATE POLICY activos_categorias_select ON activos_categorias
    FOR SELECT TO authenticated
    USING (activo = TRUE OR activos_es_administracion());

DROP POLICY IF EXISTS activos_categorias_all_admin ON activos_categorias;
CREATE POLICY activos_categorias_all_admin ON activos_categorias
    FOR ALL TO authenticated
    USING (activos_es_administracion())
    WITH CHECK (activos_es_administracion());

-- Activos
DROP POLICY IF EXISTS activos_select_admin ON activos;
CREATE POLICY activos_select_admin ON activos
    FOR SELECT TO authenticated
    USING (activos_es_administracion());

DROP POLICY IF EXISTS activos_select_trabajador ON activos;
CREATE POLICY activos_select_trabajador ON activos
    FOR SELECT TO authenticated
    USING (activos_es_trabajador() AND activos_tiene_asignacion_activa(id));

DROP POLICY IF EXISTS activos_insert_admin ON activos;
CREATE POLICY activos_insert_admin ON activos
    FOR INSERT TO authenticated
    WITH CHECK (activos_es_administracion());

DROP POLICY IF EXISTS activos_update_admin ON activos;
CREATE POLICY activos_update_admin ON activos
    FOR UPDATE TO authenticated
    USING (activos_es_administracion())
    WITH CHECK (activos_es_administracion());

DROP POLICY IF EXISTS activos_delete_admin ON activos;
CREATE POLICY activos_delete_admin ON activos
    FOR DELETE TO authenticated
    USING (activos_es_administracion());

-- Asignaciones
DROP POLICY IF EXISTS activos_asignaciones_select_admin ON activos_asignaciones;
CREATE POLICY activos_asignaciones_select_admin ON activos_asignaciones
    FOR SELECT TO authenticated
    USING (activos_es_administracion());

DROP POLICY IF EXISTS activos_asignaciones_select_trabajador ON activos_asignaciones;
CREATE POLICY activos_asignaciones_select_trabajador ON activos_asignaciones
    FOR SELECT TO authenticated
    USING (activos_es_trabajador() AND auth_uid = auth.uid() AND activa = TRUE);

DROP POLICY IF EXISTS activos_asignaciones_all_admin ON activos_asignaciones;
CREATE POLICY activos_asignaciones_all_admin ON activos_asignaciones
    FOR ALL TO authenticated
    USING (activos_es_administracion())
    WITH CHECK (activos_es_administracion());

-- Registros
DROP POLICY IF EXISTS activos_registros_select_admin ON activos_registros;
CREATE POLICY activos_registros_select_admin ON activos_registros
    FOR SELECT TO authenticated
    USING (activos_es_administracion());

DROP POLICY IF EXISTS activos_registros_select_trabajador ON activos_registros;
CREATE POLICY activos_registros_select_trabajador ON activos_registros
    FOR SELECT TO authenticated
    USING (
        activos_es_trabajador()
        AND activos_tiene_asignacion_activa(activo_id)
    );

DROP POLICY IF EXISTS activos_registros_insert_admin ON activos_registros;
CREATE POLICY activos_registros_insert_admin ON activos_registros
    FOR INSERT TO authenticated
    WITH CHECK (activos_es_administracion());

DROP POLICY IF EXISTS activos_registros_insert_trabajador ON activos_registros;
CREATE POLICY activos_registros_insert_trabajador ON activos_registros
    FOR INSERT TO authenticated
    WITH CHECK (
        activos_es_trabajador()
        AND auth_uid = auth.uid()
        AND activos_tiene_asignacion_activa(activo_id)
        AND tipo = 'uso_vehiculo'
    );

DROP POLICY IF EXISTS activos_registros_update_admin ON activos_registros;
CREATE POLICY activos_registros_update_admin ON activos_registros
    FOR UPDATE TO authenticated
    USING (activos_es_administracion())
    WITH CHECK (activos_es_administracion());

-- ============================================
-- 6) RPC: trabajadores asignables
-- ============================================

CREATE OR REPLACE FUNCTION activos_get_trabajadores_asignables()
RETURNS TABLE (
    auth_uid UUID,
    usuario_id INTEGER,
    comercial_id INTEGER,
    tipo TEXT,
    codigo TEXT,
    nombre TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT activos_es_administracion() THEN
        RAISE EXCEPTION 'No autorizado';
    END IF;

    RETURN QUERY
    SELECT
        u.auth_user_id AS auth_uid,
        u.id AS usuario_id,
        NULL::INTEGER AS comercial_id,
        'DEPENDIENTE'::TEXT AS tipo,
        u.codigo_usuario AS codigo,
        COALESCE(u.nombre, u.codigo_usuario) AS nombre
    FROM usuarios u
    WHERE u.tipo = 'DEPENDIENTE'
      AND u.auth_user_id IS NOT NULL

    UNION ALL

    SELECT
        uc.auth_user_id AS auth_uid,
        NULL::INTEGER AS usuario_id,
        uc.id AS comercial_id,
        'COMERCIAL'::TEXT AS tipo,
        uc.numero::TEXT AS codigo,
        COALESCE(uc.nombre, uc.numero::TEXT) AS nombre
    FROM usuarios_comerciales uc
    WHERE uc.auth_user_id IS NOT NULL

    ORDER BY nombre;
END;
$$;

COMMENT ON FUNCTION activos_get_trabajadores_asignables IS 'Lista DEPENDIENTE y COMERCIAL con auth_user_id para asignar activos. Solo ADMINISTRACION.';

-- ============================================
-- 7) RPC: mis activos (trabajador)
-- ============================================

CREATE OR REPLACE FUNCTION activos_get_mis_activos()
RETURNS TABLE (
    id UUID,
    categoria_codigo TEXT,
    categoria_nombre TEXT,
    nombre TEXT,
    identificador TEXT,
    estado TEXT,
    datos JSONB,
    factura_url TEXT,
    asignacion_id UUID,
    fecha_asignacion TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT activos_es_trabajador() AND NOT activos_es_administracion() THEN
        RAISE EXCEPTION 'No autorizado';
    END IF;

    RETURN QUERY
    SELECT
        a.id,
        a.categoria_codigo,
        c.nombre AS categoria_nombre,
        a.nombre,
        a.identificador,
        a.estado,
        a.datos,
        a.factura_url,
        aa.id AS asignacion_id,
        aa.fecha_desde AS fecha_asignacion
    FROM activos a
    INNER JOIN activos_categorias c ON c.codigo = a.categoria_codigo
    INNER JOIN activos_asignaciones aa ON aa.activo_id = a.id AND aa.activa = TRUE
    WHERE aa.auth_uid = auth.uid()
    ORDER BY c.orden, a.nombre;
END;
$$;

-- ============================================
-- 8) RPC: asignar trabajador
-- ============================================

CREATE OR REPLACE FUNCTION activos_asignar_trabajador(
    p_activo_id UUID,
    p_auth_uid UUID,
    p_usuario_id INTEGER DEFAULT NULL,
    p_comercial_id INTEGER DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id UUID;
BEGIN
    IF NOT activos_es_administracion() THEN
        RAISE EXCEPTION 'No autorizado';
    END IF;

    IF p_activo_id IS NULL OR p_auth_uid IS NULL THEN
        RAISE EXCEPTION 'activo_id y auth_uid son obligatorios';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM activos WHERE id = p_activo_id) THEN
        RAISE EXCEPTION 'Activo no encontrado';
    END IF;

    UPDATE activos_asignaciones
    SET activa = FALSE, fecha_hasta = NOW()
    WHERE activo_id = p_activo_id AND activa = TRUE;

    INSERT INTO activos_asignaciones (activo_id, auth_uid, usuario_id, comercial_id, activa)
    VALUES (p_activo_id, p_auth_uid, p_usuario_id, p_comercial_id, TRUE)
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

-- ============================================
-- 9) RPC: desasignar
-- ============================================

CREATE OR REPLACE FUNCTION activos_desasignar(p_activo_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT activos_es_administracion() THEN
        RAISE EXCEPTION 'No autorizado';
    END IF;

    UPDATE activos_asignaciones
    SET activa = FALSE, fecha_hasta = NOW()
    WHERE activo_id = p_activo_id AND activa = TRUE;

    RETURN TRUE;
END;
$$;

-- ============================================
-- 10) RPC: conteo por categoria (admin hub)
-- ============================================

CREATE OR REPLACE FUNCTION activos_get_conteos_categorias()
RETURNS TABLE (
    codigo TEXT,
    nombre TEXT,
    total BIGINT,
    asignados BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT activos_es_administracion() THEN
        RAISE EXCEPTION 'No autorizado';
    END IF;

    RETURN QUERY
    SELECT
        c.codigo,
        c.nombre,
        COUNT(a.id) AS total,
        COUNT(aa.id) FILTER (WHERE aa.activa = TRUE) AS asignados
    FROM activos_categorias c
    LEFT JOIN activos a ON a.categoria_codigo = c.codigo
    LEFT JOIN activos_asignaciones aa ON aa.activo_id = a.id AND aa.activa = TRUE
    WHERE c.activo = TRUE
    GROUP BY c.codigo, c.nombre, c.orden
    ORDER BY c.orden;
END;
$$;
