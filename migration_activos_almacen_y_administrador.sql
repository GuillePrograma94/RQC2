-- Activos: almacen (empresas_por_almacen) y asignacion a ADMINISTRADOR.
-- Ejecutar DESPUES de migration_activos_empresa_core.sql y migration_activos_vehiculo_rpc.sql.

-- ============================================
-- 1) COLUMNA almacen en activos
-- ============================================

ALTER TABLE activos
    ADD COLUMN IF NOT EXISTS almacen TEXT;

-- FK solo si no existe (idempotente)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'activos_almacen_fkey'
    ) THEN
        ALTER TABLE activos
            ADD CONSTRAINT activos_almacen_fkey
            FOREIGN KEY (almacen) REFERENCES empresas_por_almacen(almacen)
            ON UPDATE CASCADE
            ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_activos_almacen ON activos(almacen);

COMMENT ON COLUMN activos.almacen IS 'Almacen/tienda (empresas_por_almacen.almacen) al que pertenece el activo.';

-- ============================================
-- 2) Usuarios que pueden tener activos asignados
-- ============================================

CREATE OR REPLACE FUNCTION activos_es_usuario_asignable()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(((auth.jwt() -> 'app_metadata') ->> 'es_dependiente')::boolean, FALSE)
        OR COALESCE(((auth.jwt() -> 'app_metadata') ->> 'es_comercial')::boolean, FALSE)
        OR COALESCE(((auth.jwt() -> 'app_metadata') ->> 'es_administrador')::boolean, FALSE);
$$;

COMMENT ON FUNCTION activos_es_usuario_asignable IS 'DEPENDIENTE, COMERCIAL o ADMINISTRADOR (titular tienda) con activos asignados.';

-- Mantener nombre legacy usado en politicas
CREATE OR REPLACE FUNCTION activos_es_trabajador()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT activos_es_usuario_asignable();
$$;

-- ============================================
-- 3) RLS: politicas para usuarios asignados (incl. ADMINISTRADOR)
-- ============================================

DROP POLICY IF EXISTS activos_select_trabajador ON activos;
CREATE POLICY activos_select_trabajador ON activos
    FOR SELECT TO authenticated
    USING (activos_es_usuario_asignable() AND activos_tiene_asignacion_activa(id));

DROP POLICY IF EXISTS activos_asignaciones_select_trabajador ON activos_asignaciones;
CREATE POLICY activos_asignaciones_select_trabajador ON activos_asignaciones
    FOR SELECT TO authenticated
    USING (activos_es_usuario_asignable() AND auth_uid = auth.uid() AND activa = TRUE);

DROP POLICY IF EXISTS activos_registros_select_trabajador ON activos_registros;
CREATE POLICY activos_registros_select_trabajador ON activos_registros
    FOR SELECT TO authenticated
    USING (
        activos_es_usuario_asignable()
        AND activos_tiene_asignacion_activa(activo_id)
    );

DROP POLICY IF EXISTS activos_registros_insert_trabajador ON activos_registros;
CREATE POLICY activos_registros_insert_trabajador ON activos_registros
    FOR INSERT TO authenticated
    WITH CHECK (
        activos_es_usuario_asignable()
        AND auth_uid = auth.uid()
        AND activos_tiene_asignacion_activa(activo_id)
        AND tipo = 'uso_vehiculo'
    );

-- ============================================
-- 4) RPC: usuarios asignables (+ ADMINISTRADOR)
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
        u.auth_user_id AS auth_uid,
        u.id AS usuario_id,
        NULL::INTEGER AS comercial_id,
        'ADMINISTRADOR'::TEXT AS tipo,
        u.codigo_usuario AS codigo,
        COALESCE(u.nombre, u.codigo_usuario) AS nombre
    FROM usuarios u
    WHERE u.tipo = 'ADMINISTRADOR'
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

COMMENT ON FUNCTION activos_get_trabajadores_asignables IS 'DEPENDIENTE, ADMINISTRADOR y COMERCIAL con auth_user_id. Solo ADMINISTRACION.';

-- ============================================
-- 5) RPC: mis activos (incl. ADMINISTRADOR + almacen)
-- ============================================

-- Cambia el tipo de retorno (columna almacen): hay que eliminar antes
DROP FUNCTION IF EXISTS activos_get_mis_activos();

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
    almacen TEXT,
    asignacion_id UUID,
    fecha_asignacion TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT activos_es_usuario_asignable() AND NOT activos_es_administracion() THEN
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
        a.almacen,
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
-- 6) RPC: listado admin con almacen
-- ============================================

-- Cambia el tipo de retorno (almacen, asignado_tipo): hay que eliminar antes
DROP FUNCTION IF EXISTS activos_listar_por_categoria(TEXT);

CREATE OR REPLACE FUNCTION activos_listar_por_categoria(p_categoria TEXT)
RETURNS TABLE (
    id UUID,
    nombre TEXT,
    identificador TEXT,
    estado TEXT,
    datos JSONB,
    almacen TEXT,
    asignado_nombre TEXT,
    asignado_codigo TEXT,
    asignado_tipo TEXT,
    auth_uid UUID
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
        a.id,
        a.nombre,
        a.identificador,
        a.estado,
        a.datos,
        a.almacen,
        COALESCE(u.nombre, uc.nombre) AS asignado_nombre,
        COALESCE(u.codigo_usuario, uc.numero::TEXT) AS asignado_codigo,
        CASE
            WHEN u.id IS NOT NULL THEN u.tipo::TEXT
            WHEN uc.id IS NOT NULL THEN 'COMERCIAL'::TEXT
            ELSE NULL
        END AS asignado_tipo,
        aa.auth_uid
    FROM activos a
    LEFT JOIN activos_asignaciones aa ON aa.activo_id = a.id AND aa.activa = TRUE
    LEFT JOIN usuarios u ON u.id = aa.usuario_id
    LEFT JOIN usuarios_comerciales uc ON uc.id = aa.comercial_id
    WHERE a.categoria_codigo = p_categoria
    ORDER BY a.almacen NULLS LAST, a.nombre;
END;
$$;

-- ============================================
-- 7) RPC: uso vehiculo (ADMINISTRADOR asignado)
-- ============================================

CREATE OR REPLACE FUNCTION activos_registrar_uso_vehiculo(
    p_activo_id UUID,
    p_km_actual INTEGER,
    p_litros NUMERIC DEFAULT NULL,
    p_coste NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_categoria TEXT;
    v_datos JSONB;
    v_km_anterior INTEGER;
    v_km_dia INTEGER;
    v_registro_id UUID;
    v_fecha DATE := CURRENT_DATE;
BEGIN
    IF p_activo_id IS NULL THEN
        RAISE EXCEPTION 'activo_id obligatorio';
    END IF;

    IF p_km_actual IS NULL OR p_km_actual < 0 THEN
        RAISE EXCEPTION 'Kilometraje actual invalido';
    END IF;

    SELECT a.categoria_codigo, a.datos
    INTO v_categoria, v_datos
    FROM activos a
    WHERE a.id = p_activo_id;

    IF v_categoria IS NULL THEN
        RAISE EXCEPTION 'Activo no encontrado';
    END IF;

    IF v_categoria <> 'vehiculo' THEN
        RAISE EXCEPTION 'El activo no es un vehiculo';
    END IF;

    IF activos_es_administracion() THEN
        NULL;
    ELSIF activos_es_usuario_asignable() AND activos_tiene_asignacion_activa(p_activo_id) THEN
        NULL;
    ELSE
        RAISE EXCEPTION 'No autorizado para registrar uso de este vehiculo';
    END IF;

    v_km_anterior := COALESCE((v_datos ->> 'kilometraje_actual')::INTEGER, 0);

    IF p_km_actual < v_km_anterior THEN
        RAISE EXCEPTION 'El kilometraje no puede ser inferior al actual (%)', v_km_anterior;
    END IF;

    v_km_dia := p_km_actual - v_km_anterior;

    UPDATE activos
    SET datos = jsonb_set(
        COALESCE(datos, '{}'::jsonb),
        '{kilometraje_actual}',
        to_jsonb(p_km_actual),
        TRUE
    )
    WHERE id = p_activo_id;

    SELECT ar.id INTO v_registro_id
    FROM activos_registros ar
    WHERE ar.activo_id = p_activo_id
      AND ar.fecha = v_fecha
      AND ar.tipo = 'uso_vehiculo'
    LIMIT 1;

    IF v_registro_id IS NOT NULL THEN
        UPDATE activos_registros
        SET
            auth_uid = auth.uid(),
            datos = jsonb_build_object(
                'km_actual', p_km_actual,
                'km_anterior', v_km_anterior,
                'km_dia', v_km_dia,
                'litros', p_litros,
                'coste', p_coste
            )
        WHERE id = v_registro_id;
    ELSE
        INSERT INTO activos_registros (activo_id, auth_uid, tipo, datos, fecha)
        VALUES (
            p_activo_id,
            auth.uid(),
            'uso_vehiculo',
            jsonb_build_object(
                'km_actual', p_km_actual,
                'km_anterior', v_km_anterior,
                'km_dia', v_km_dia,
                'litros', p_litros,
                'coste', p_coste
            ),
            v_fecha
        )
        RETURNING id INTO v_registro_id;
    END IF;

    RETURN jsonb_build_object(
        'registro_id', v_registro_id,
        'km_actual', p_km_actual,
        'km_dia', v_km_dia,
        'fecha', v_fecha
    );
END;
$$;
