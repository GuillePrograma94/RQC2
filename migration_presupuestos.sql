-- Migracion: modulo de presupuestos comerciales + empresas por almacen
-- Fecha: 2026-03-27
-- Objetivo:
-- 1) Crear modulo separado de prepedidos para presupuestos
-- 2) Permitir configuracion de datos de empresa por almacen (ADMINISTRACION)
-- 3) Exponer RPC para crear/editar/listar/cambiar estado/eliminar presupuestos

-- ============================================
-- 1) TABLAS BASE
-- ============================================
CREATE TABLE IF NOT EXISTS presupuestos (
    id BIGSERIAL PRIMARY KEY,
    numero_presupuesto TEXT UNIQUE NOT NULL,
    fecha TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    estado TEXT NOT NULL DEFAULT 'BORRADOR' CHECK (estado IN ('BORRADOR', 'ENVIADO', 'ACEPTADO', 'RECHAZADO')),
    usuario_id_cliente INTEGER NOT NULL REFERENCES usuarios(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    comercial_id INTEGER NULL REFERENCES usuarios_comerciales(id) ON UPDATE CASCADE ON DELETE SET NULL,
    almacen_habitual TEXT NOT NULL,
    observaciones TEXT NULL,
    subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
    impuestos NUMERIC(14,2) NOT NULL DEFAULT 0,
    total NUMERIC(14,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_presupuestos_usuario_fecha ON presupuestos (usuario_id_cliente, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_presupuestos_comercial_fecha ON presupuestos (comercial_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_presupuestos_estado_fecha ON presupuestos (estado, fecha DESC);

CREATE TABLE IF NOT EXISTS presupuestos_lineas (
    id BIGSERIAL PRIMARY KEY,
    presupuesto_id BIGINT NOT NULL REFERENCES presupuestos(id) ON UPDATE CASCADE ON DELETE CASCADE,
    orden INTEGER NOT NULL DEFAULT 1,
    codigo TEXT NOT NULL,
    descripcion TEXT NOT NULL,
    cantidad NUMERIC(12,3) NOT NULL CHECK (cantidad > 0),
    precio_unitario NUMERIC(14,4) NOT NULL CHECK (precio_unitario >= 0),
    dto_pct NUMERIC(6,3) NOT NULL DEFAULT 0 CHECK (dto_pct >= 0 AND dto_pct <= 100),
    importe_linea NUMERIC(14,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_presupuestos_lineas_presupuesto ON presupuestos_lineas (presupuesto_id, orden);

CREATE TABLE IF NOT EXISTS empresas_por_almacen (
    almacen TEXT PRIMARY KEY,
    razon_social TEXT NOT NULL,
    cif TEXT NOT NULL,
    direccion TEXT NOT NULL,
    cp TEXT NOT NULL,
    poblacion TEXT NOT NULL,
    provincia TEXT NOT NULL,
    telefono TEXT NULL,
    email TEXT NULL,
    web TEXT NULL,
    logo_url TEXT NULL,
    condiciones_comerciales TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE presupuestos IS 'Cabecera de presupuestos comerciales (modulo separado de prepedidos).';
COMMENT ON TABLE presupuestos_lineas IS 'Lineas de producto por presupuesto.';
COMMENT ON TABLE empresas_por_almacen IS 'Datos fiscales/comerciales de empresa por almacen para PDF de presupuesto.';

-- ============================================
-- 2) SOPORTE NUMERACION + TIMESTAMPS
-- ============================================
CREATE SEQUENCE IF NOT EXISTS presupuestos_numero_seq START 1;

CREATE OR REPLACE FUNCTION set_updated_at_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_presupuestos_updated_at ON presupuestos;
CREATE TRIGGER trg_presupuestos_updated_at
BEFORE UPDATE ON presupuestos
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

DROP TRIGGER IF EXISTS trg_empresas_por_almacen_updated_at ON empresas_por_almacen;
CREATE TRIGGER trg_empresas_por_almacen_updated_at
BEFORE UPDATE ON empresas_por_almacen
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

CREATE OR REPLACE FUNCTION generar_numero_presupuesto()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    v_next BIGINT;
BEGIN
    SELECT nextval('presupuestos_numero_seq') INTO v_next;
    RETURN 'PRES-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(v_next::TEXT, 6, '0');
END;
$$;

-- ============================================
-- 3) RLS
-- ============================================
ALTER TABLE presupuestos ENABLE ROW LEVEL SECURITY;
ALTER TABLE presupuestos_lineas ENABLE ROW LEVEL SECURITY;
ALTER TABLE empresas_por_almacen ENABLE ROW LEVEL SECURITY;

-- Presupuestos: SELECT para cliente/comercial/admin
DROP POLICY IF EXISTS "presupuestos_select_cliente_comercial_admin" ON presupuestos;
CREATE POLICY "presupuestos_select_cliente_comercial_admin"
    ON presupuestos FOR SELECT
    TO authenticated
    USING (
        usuario_id_cliente = NULLIF((auth.jwt() -> 'app_metadata' ->> 'usuario_id'), '')::INTEGER
        OR comercial_id = NULLIF((auth.jwt() -> 'app_metadata' ->> 'comercial_id'), '')::INTEGER
        OR ((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::BOOLEAN IS TRUE
    );

-- Presupuestos: INSERT por comercial/admin
DROP POLICY IF EXISTS "presupuestos_insert_comercial_admin" ON presupuestos;
CREATE POLICY "presupuestos_insert_comercial_admin"
    ON presupuestos FOR INSERT
    TO authenticated
    WITH CHECK (
        comercial_id = NULLIF((auth.jwt() -> 'app_metadata' ->> 'comercial_id'), '')::INTEGER
        OR ((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::BOOLEAN IS TRUE
    );

-- Presupuestos: UPDATE por comercial owner/admin
DROP POLICY IF EXISTS "presupuestos_update_comercial_admin" ON presupuestos;
CREATE POLICY "presupuestos_update_comercial_admin"
    ON presupuestos FOR UPDATE
    TO authenticated
    USING (
        comercial_id = NULLIF((auth.jwt() -> 'app_metadata' ->> 'comercial_id'), '')::INTEGER
        OR ((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::BOOLEAN IS TRUE
    )
    WITH CHECK (
        comercial_id = NULLIF((auth.jwt() -> 'app_metadata' ->> 'comercial_id'), '')::INTEGER
        OR ((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::BOOLEAN IS TRUE
    );

-- Presupuestos: DELETE por comercial owner/admin
DROP POLICY IF EXISTS "presupuestos_delete_comercial_admin" ON presupuestos;
CREATE POLICY "presupuestos_delete_comercial_admin"
    ON presupuestos FOR DELETE
    TO authenticated
    USING (
        comercial_id = NULLIF((auth.jwt() -> 'app_metadata' ->> 'comercial_id'), '')::INTEGER
        OR ((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::BOOLEAN IS TRUE
    );

-- Lineas: acceso derivado de cabecera visible
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
                 OR ((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::BOOLEAN IS TRUE
              )
        )
    );

-- Empresas por almacen: lectura para autenticados, escritura solo ADMINISTRACION
DROP POLICY IF EXISTS "empresas_por_almacen_select_authenticated" ON empresas_por_almacen;
CREATE POLICY "empresas_por_almacen_select_authenticated"
    ON empresas_por_almacen FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "empresas_por_almacen_insert_admin" ON empresas_por_almacen;
CREATE POLICY "empresas_por_almacen_insert_admin"
    ON empresas_por_almacen FOR INSERT
    TO authenticated
    WITH CHECK (((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::BOOLEAN IS TRUE);

DROP POLICY IF EXISTS "empresas_por_almacen_update_admin" ON empresas_por_almacen;
CREATE POLICY "empresas_por_almacen_update_admin"
    ON empresas_por_almacen FOR UPDATE
    TO authenticated
    USING (((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::BOOLEAN IS TRUE)
    WITH CHECK (((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::BOOLEAN IS TRUE);

DROP POLICY IF EXISTS "empresas_por_almacen_delete_admin" ON empresas_por_almacen;
CREATE POLICY "empresas_por_almacen_delete_admin"
    ON empresas_por_almacen FOR DELETE
    TO authenticated
    USING (((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::BOOLEAN IS TRUE);

-- ============================================
-- 4) RPC PRESUPUESTOS
-- ============================================
DROP FUNCTION IF EXISTS crear_presupuesto(INTEGER, INTEGER, TEXT, TEXT, JSONB);
DROP FUNCTION IF EXISTS actualizar_presupuesto(BIGINT, INTEGER, TEXT, TEXT, JSONB);
DROP FUNCTION IF EXISTS get_presupuestos_comercial(INTEGER);
DROP FUNCTION IF EXISTS get_presupuestos_usuario(INTEGER);
DROP FUNCTION IF EXISTS cambiar_estado_presupuesto(BIGINT, TEXT, INTEGER);
DROP FUNCTION IF EXISTS eliminar_presupuesto(BIGINT, INTEGER);
DROP FUNCTION IF EXISTS get_presupuesto_detalle(BIGINT);

CREATE OR REPLACE FUNCTION crear_presupuesto(
    p_usuario_id_cliente INTEGER,
    p_comercial_id INTEGER,
    p_almacen_habitual TEXT,
    p_observaciones TEXT,
    p_lineas JSONB
)
RETURNS TABLE (
    presupuesto_id BIGINT,
    numero_presupuesto TEXT,
    success BOOLEAN,
    message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_presupuesto_id BIGINT;
    v_numero TEXT;
    v_linea JSONB;
    v_orden INTEGER := 0;
    v_jwt_usuario_id INTEGER;
    v_jwt_comercial_id INTEGER;
    v_allowed BOOLEAN := FALSE;
BEGIN
    IF p_usuario_id_cliente IS NULL OR p_comercial_id IS NULL THEN
        RETURN QUERY SELECT NULL::BIGINT, NULL::TEXT, FALSE, 'Usuario o comercial no valido'::TEXT;
        RETURN;
    END IF;
    IF p_lineas IS NULL OR jsonb_typeof(p_lineas) <> 'array' OR jsonb_array_length(p_lineas) = 0 THEN
        RETURN QUERY SELECT NULL::BIGINT, NULL::TEXT, FALSE, 'El presupuesto no tiene lineas'::TEXT;
        RETURN;
    END IF;

    v_jwt_usuario_id := NULLIF((auth.jwt() -> 'app_metadata' ->> 'usuario_id'), '')::INTEGER;
    v_jwt_comercial_id := NULLIF((auth.jwt() -> 'app_metadata' ->> 'comercial_id'), '')::INTEGER;

    IF v_jwt_comercial_id IS NOT NULL AND v_jwt_comercial_id = p_comercial_id THEN
        v_allowed := TRUE;
    ELSE
        SELECT EXISTS(
            SELECT 1
            FROM usuarios_comerciales uc
            WHERE uc.id = p_comercial_id
              AND uc.usuario_id = v_jwt_usuario_id
        ) INTO v_allowed;
    END IF;

    IF NOT v_allowed AND (((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::BOOLEAN IS DISTINCT FROM TRUE) THEN
        RETURN QUERY SELECT NULL::BIGINT, NULL::TEXT, FALSE, 'No autorizado para crear presupuestos con ese comercial_id'::TEXT;
        RETURN;
    END IF;

    v_numero := generar_numero_presupuesto();

    INSERT INTO presupuestos (
        numero_presupuesto,
        usuario_id_cliente,
        comercial_id,
        almacen_habitual,
        observaciones
    ) VALUES (
        v_numero,
        p_usuario_id_cliente,
        p_comercial_id,
        NULLIF(TRIM(COALESCE(p_almacen_habitual, '')), ''),
        NULLIF(TRIM(COALESCE(p_observaciones, '')), '')
    )
    RETURNING id INTO v_presupuesto_id;

    FOR v_linea IN SELECT * FROM jsonb_array_elements(p_lineas)
    LOOP
        v_orden := v_orden + 1;
        INSERT INTO presupuestos_lineas (
            presupuesto_id,
            orden,
            codigo,
            descripcion,
            cantidad,
            precio_unitario,
            dto_pct,
            importe_linea
        ) VALUES (
            v_presupuesto_id,
            v_orden,
            COALESCE(v_linea->>'codigo', ''),
            COALESCE(v_linea->>'descripcion', ''),
            COALESCE((v_linea->>'cantidad')::NUMERIC, 0),
            COALESCE((v_linea->>'precio_unitario')::NUMERIC, 0),
            COALESCE((v_linea->>'dto_pct')::NUMERIC, 0),
            ROUND(
                COALESCE((v_linea->>'cantidad')::NUMERIC, 0)
                * COALESCE((v_linea->>'precio_unitario')::NUMERIC, 0)
                * (1 - (COALESCE((v_linea->>'dto_pct')::NUMERIC, 0) / 100)),
                2
            )
        );
    END LOOP;

    UPDATE presupuestos p
    SET
        subtotal = COALESCE((SELECT SUM(l.importe_linea) FROM presupuestos_lineas l WHERE l.presupuesto_id = p.id), 0),
        impuestos = ROUND(COALESCE((SELECT SUM(l.importe_linea) FROM presupuestos_lineas l WHERE l.presupuesto_id = p.id), 0) * 0.21, 2),
        total = ROUND(COALESCE((SELECT SUM(l.importe_linea) FROM presupuestos_lineas l WHERE l.presupuesto_id = p.id), 0) * 1.21, 2)
    WHERE p.id = v_presupuesto_id;

    RETURN QUERY SELECT v_presupuesto_id, v_numero, TRUE, 'Presupuesto guardado correctamente'::TEXT;
EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT NULL::BIGINT, NULL::TEXT, FALSE, SQLERRM::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION actualizar_presupuesto(
    p_presupuesto_id BIGINT,
    p_comercial_id INTEGER,
    p_almacen_habitual TEXT,
    p_observaciones TEXT,
    p_lineas JSONB
)
RETURNS TABLE (
    presupuesto_id BIGINT,
    success BOOLEAN,
    message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_linea JSONB;
    v_orden INTEGER := 0;
    v_jwt_usuario_id INTEGER;
    v_jwt_comercial_id INTEGER;
    v_allowed BOOLEAN := FALSE;
BEGIN
    IF p_lineas IS NULL OR jsonb_typeof(p_lineas) <> 'array' OR jsonb_array_length(p_lineas) = 0 THEN
        RETURN QUERY SELECT NULL::BIGINT, FALSE, 'El presupuesto no tiene lineas'::TEXT;
        RETURN;
    END IF;

    v_jwt_usuario_id := NULLIF((auth.jwt() -> 'app_metadata' ->> 'usuario_id'), '')::INTEGER;
    v_jwt_comercial_id := NULLIF((auth.jwt() -> 'app_metadata' ->> 'comercial_id'), '')::INTEGER;

    IF v_jwt_comercial_id IS NOT NULL AND v_jwt_comercial_id = p_comercial_id THEN
        v_allowed := TRUE;
    ELSE
        SELECT EXISTS(
            SELECT 1
            FROM usuarios_comerciales uc
            WHERE uc.id = p_comercial_id
              AND uc.usuario_id = v_jwt_usuario_id
        ) INTO v_allowed;
    END IF;

    IF NOT v_allowed AND (((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::BOOLEAN IS DISTINCT FROM TRUE) THEN
        RETURN QUERY SELECT NULL::BIGINT, FALSE, 'No autorizado para actualizar presupuestos con ese comercial_id'::TEXT;
        RETURN;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM presupuestos p
        WHERE p.id = p_presupuesto_id
          AND (p_comercial_id IS NULL OR p.comercial_id = p_comercial_id)
    ) THEN
        RETURN QUERY SELECT NULL::BIGINT, FALSE, 'No se encontro el presupuesto o no se puede editar'::TEXT;
        RETURN;
    END IF;

    UPDATE presupuestos
    SET
        almacen_habitual = COALESCE(NULLIF(TRIM(COALESCE(p_almacen_habitual, '')), ''), almacen_habitual),
        observaciones = NULLIF(TRIM(COALESCE(p_observaciones, '')), ''),
        estado = CASE WHEN estado = 'ENVIADO' THEN 'BORRADOR' ELSE estado END
    WHERE id = p_presupuesto_id;

    DELETE FROM presupuestos_lineas pl WHERE pl.presupuesto_id = p_presupuesto_id;

    FOR v_linea IN SELECT * FROM jsonb_array_elements(p_lineas)
    LOOP
        v_orden := v_orden + 1;
        INSERT INTO presupuestos_lineas (
            presupuesto_id,
            orden,
            codigo,
            descripcion,
            cantidad,
            precio_unitario,
            dto_pct,
            importe_linea
        ) VALUES (
            p_presupuesto_id,
            v_orden,
            COALESCE(v_linea->>'codigo', ''),
            COALESCE(v_linea->>'descripcion', ''),
            COALESCE((v_linea->>'cantidad')::NUMERIC, 0),
            COALESCE((v_linea->>'precio_unitario')::NUMERIC, 0),
            COALESCE((v_linea->>'dto_pct')::NUMERIC, 0),
            ROUND(
                COALESCE((v_linea->>'cantidad')::NUMERIC, 0)
                * COALESCE((v_linea->>'precio_unitario')::NUMERIC, 0)
                * (1 - (COALESCE((v_linea->>'dto_pct')::NUMERIC, 0) / 100)),
                2
            )
        );
    END LOOP;

    UPDATE presupuestos p
    SET
        subtotal = COALESCE((SELECT SUM(l.importe_linea) FROM presupuestos_lineas l WHERE l.presupuesto_id = p.id), 0),
        impuestos = ROUND(COALESCE((SELECT SUM(l.importe_linea) FROM presupuestos_lineas l WHERE l.presupuesto_id = p.id), 0) * 0.21, 2),
        total = ROUND(COALESCE((SELECT SUM(l.importe_linea) FROM presupuestos_lineas l WHERE l.presupuesto_id = p.id), 0) * 1.21, 2)
    WHERE p.id = p_presupuesto_id;

    RETURN QUERY SELECT p_presupuesto_id, TRUE, 'Presupuesto actualizado correctamente'::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION get_presupuestos_usuario(p_usuario_id INTEGER)
RETURNS TABLE (
    id BIGINT,
    numero_presupuesto TEXT,
    fecha TIMESTAMPTZ,
    estado TEXT,
    usuario_id_cliente INTEGER,
    comercial_id INTEGER,
    almacen_habitual TEXT,
    observaciones TEXT,
    subtotal NUMERIC,
    impuestos NUMERIC,
    total NUMERIC,
    total_lineas INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT
        p.id,
        p.numero_presupuesto,
        p.fecha,
        p.estado,
        p.usuario_id_cliente,
        p.comercial_id,
        p.almacen_habitual,
        p.observaciones,
        p.subtotal,
        p.impuestos,
        p.total,
        COALESCE((SELECT COUNT(*)::INTEGER FROM presupuestos_lineas l WHERE l.presupuesto_id = p.id), 0) AS total_lineas
    FROM presupuestos p
    WHERE p.usuario_id_cliente = p_usuario_id
    ORDER BY p.fecha DESC
    LIMIT 500;
$$;

CREATE OR REPLACE FUNCTION get_presupuestos_comercial(p_comercial_id INTEGER)
RETURNS TABLE (
    id BIGINT,
    numero_presupuesto TEXT,
    fecha TIMESTAMPTZ,
    estado TEXT,
    usuario_id_cliente INTEGER,
    cliente_nombre TEXT,
    comercial_id INTEGER,
    almacen_habitual TEXT,
    observaciones TEXT,
    subtotal NUMERIC,
    impuestos NUMERIC,
    total NUMERIC,
    total_lineas INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT
        p.id,
        p.numero_presupuesto,
        p.fecha,
        p.estado,
        p.usuario_id_cliente,
        u.nombre AS cliente_nombre,
        p.comercial_id,
        p.almacen_habitual,
        p.observaciones,
        p.subtotal,
        p.impuestos,
        p.total,
        COALESCE((SELECT COUNT(*)::INTEGER FROM presupuestos_lineas l WHERE l.presupuesto_id = p.id), 0) AS total_lineas
    FROM presupuestos p
    JOIN usuarios u ON u.id = p.usuario_id_cliente
    WHERE p.comercial_id = p_comercial_id
    ORDER BY p.fecha DESC
    LIMIT 500;
$$;

CREATE OR REPLACE FUNCTION get_presupuesto_detalle(p_presupuesto_id BIGINT)
RETURNS TABLE (
    id BIGINT,
    numero_presupuesto TEXT,
    fecha TIMESTAMPTZ,
    estado TEXT,
    usuario_id_cliente INTEGER,
    cliente_nombre TEXT,
    cliente_codigo TEXT,
    cliente_direccion TEXT,
    cliente_cp TEXT,
    cliente_poblacion TEXT,
    cliente_provincia TEXT,
    cliente_cif TEXT,
    comercial_id INTEGER,
    almacen_habitual TEXT,
    observaciones TEXT,
    subtotal NUMERIC,
    impuestos NUMERIC,
    total NUMERIC,
    lineas JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT
        p.id,
        p.numero_presupuesto,
        p.fecha,
        p.estado,
        p.usuario_id_cliente,
        u.nombre AS cliente_nombre,
        u.codigo_usuario AS cliente_codigo,
        NULL::TEXT AS cliente_direccion,
        NULL::TEXT AS cliente_cp,
        u.poblacion AS cliente_poblacion,
        NULL::TEXT AS cliente_provincia,
        NULL::TEXT AS cliente_cif,
        p.comercial_id,
        p.almacen_habitual,
        p.observaciones,
        p.subtotal,
        p.impuestos,
        p.total,
        COALESCE(
            (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'id', l.id,
                        'orden', l.orden,
                        'codigo', l.codigo,
                        'descripcion', l.descripcion,
                        'cantidad', l.cantidad,
                        'precio_unitario', l.precio_unitario,
                        'dto_pct', l.dto_pct,
                        'importe_linea', l.importe_linea
                    )
                    ORDER BY l.orden
                )
                FROM presupuestos_lineas l
                WHERE l.presupuesto_id = p.id
            ),
            '[]'::JSONB
        ) AS lineas
    FROM presupuestos p
    JOIN usuarios u ON u.id = p.usuario_id_cliente
    WHERE p.id = p_presupuesto_id
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION cambiar_estado_presupuesto(
    p_presupuesto_id BIGINT,
    p_estado TEXT,
    p_comercial_id INTEGER
)
RETURNS TABLE (
    success BOOLEAN,
    message TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
    IF p_estado NOT IN ('BORRADOR', 'ENVIADO', 'ACEPTADO', 'RECHAZADO') THEN
        RETURN QUERY SELECT FALSE, 'Estado de presupuesto no valido'::TEXT;
        RETURN;
    END IF;

    UPDATE presupuestos
    SET estado = p_estado
    WHERE id = p_presupuesto_id
      AND (p_comercial_id IS NULL OR comercial_id = p_comercial_id);

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 'No se encontro el presupuesto o no se puede actualizar estado'::TEXT;
        RETURN;
    END IF;

    RETURN QUERY SELECT TRUE, 'Estado actualizado correctamente'::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION eliminar_presupuesto(
    p_presupuesto_id BIGINT,
    p_comercial_id INTEGER
)
RETURNS TABLE (
    success BOOLEAN,
    message TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
    DELETE FROM presupuestos
    WHERE id = p_presupuesto_id
      AND (p_comercial_id IS NULL OR comercial_id = p_comercial_id);

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 'No se encontro el presupuesto o no se puede eliminar'::TEXT;
        RETURN;
    END IF;

    RETURN QUERY SELECT TRUE, 'Presupuesto eliminado correctamente'::TEXT;
END;
$$;
