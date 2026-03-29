-- Fix robusto para crear/actualizar presupuestos con JWT comercial heterogeneo:
-- - Evita dependencia estricta de RLS en INSERT/UPDATE de presupuestos
-- - Autoriza por app_metadata.comercial_id o por vinculo usuarios_comerciales.usuario_id
-- Ejecutar despues de migration_presupuestos.sql.

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
