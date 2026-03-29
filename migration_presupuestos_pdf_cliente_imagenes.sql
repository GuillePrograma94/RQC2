-- Migracion: datos fiscales/direccion en usuarios para PDF presupuesto + imagen_url por linea
-- Ejecutar en Supabase despues de migration_presupuestos.sql y migration_presupuestos_fix_security_definer.sql
-- Fecha: 2026-03-29

-- ============================================
-- 1) Columnas opcionales en usuarios (PDF cliente)
-- ============================================
ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS direccion TEXT,
    ADD COLUMN IF NOT EXISTS cp TEXT,
    ADD COLUMN IF NOT EXISTS provincia TEXT,
    ADD COLUMN IF NOT EXISTS cif TEXT;

COMMENT ON COLUMN usuarios.direccion IS 'Direccion fiscal/comercial (presupuesto PDF, etc.)';
COMMENT ON COLUMN usuarios.cp IS 'Codigo postal';
COMMENT ON COLUMN usuarios.provincia IS 'Provincia';
COMMENT ON COLUMN usuarios.cif IS 'CIF/NIF del cliente';

-- ============================================
-- 2) Miniatura por linea de presupuesto (URL publica)
-- ============================================
ALTER TABLE presupuestos_lineas
    ADD COLUMN IF NOT EXISTS imagen_url TEXT;

COMMENT ON COLUMN presupuestos_lineas.imagen_url IS 'URL publica de miniatura de producto para PDF/UI; opcional.';

-- ============================================
-- 3) RPC get_presupuesto_detalle: cliente + imagen en lineas
-- ============================================
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
SET search_path = public
AS $$
    SELECT
        p.id,
        p.numero_presupuesto,
        p.fecha,
        p.estado,
        p.usuario_id_cliente,
        u.nombre AS cliente_nombre,
        u.codigo_usuario AS cliente_codigo,
        NULLIF(TRIM(COALESCE(u.direccion, '')), '') AS cliente_direccion,
        NULLIF(TRIM(COALESCE(u.cp, '')), '') AS cliente_cp,
        NULLIF(TRIM(COALESCE(u.poblacion, '')), '') AS cliente_poblacion,
        NULLIF(TRIM(COALESCE(u.provincia, '')), '') AS cliente_provincia,
        NULLIF(TRIM(COALESCE(u.cif, '')), '') AS cliente_cif,
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
                        'importe_linea', l.importe_linea,
                        'imagen_url', l.imagen_url
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

-- ============================================
-- 4) crear_presupuesto / actualizar_presupuesto: persistir imagen_url (fix security definer)
-- ============================================
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
SET search_path = public
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
            importe_linea,
            imagen_url
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
            ),
            NULLIF(TRIM(COALESCE(v_linea->>'imagen_url', '')), '')
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
SET search_path = public
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

    DELETE FROM presupuestos_lineas pl
    WHERE pl.presupuesto_id = p_presupuesto_id;

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
            importe_linea,
            imagen_url
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
            ),
            NULLIF(TRIM(COALESCE(v_linea->>'imagen_url', '')), '')
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
