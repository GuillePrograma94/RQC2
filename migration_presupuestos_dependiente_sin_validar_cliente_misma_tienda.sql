-- Parche: quitar validacion "cliente mismo almacen que tienda" en crear_presupuesto (dependiente).
-- Un cliente puede solicitar presupuesto en otra tienda; la empresa del PDF sigue siendo la del trabajador (almacen_tienda).
-- Ejecutar en Supabase si ya aplicaste migration_presupuestos_dependiente_creador.sql con la validacion antigua.
-- Si instalas desde cero, migration_presupuestos_dependiente_creador.sql ya incluye esta logica (no hace falta este archivo).

-- ---------------------------------------------------------------------------
-- crear_presupuesto
-- ---------------------------------------------------------------------------
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
    v_is_admin BOOLEAN := FALSE;
    v_tienda TEXT;
    v_alm_doc TEXT;
BEGIN
    IF p_usuario_id_cliente IS NULL THEN
        RETURN QUERY SELECT NULL::BIGINT, NULL::TEXT, FALSE, 'Usuario cliente no valido'::TEXT;
        RETURN;
    END IF;
    IF p_lineas IS NULL OR jsonb_typeof(p_lineas) <> 'array' OR jsonb_array_length(p_lineas) = 0 THEN
        RETURN QUERY SELECT NULL::BIGINT, NULL::TEXT, FALSE, 'El presupuesto no tiene lineas'::TEXT;
        RETURN;
    END IF;

    v_jwt_usuario_id := NULLIF((auth.jwt() -> 'app_metadata' ->> 'usuario_id'), '')::INTEGER;
    v_jwt_comercial_id := NULLIF((auth.jwt() -> 'app_metadata' ->> 'comercial_id'), '')::INTEGER;
    v_is_admin := ((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::BOOLEAN IS TRUE;

    IF p_comercial_id IS NULL THEN
        IF v_is_admin THEN
            v_allowed := TRUE;
        ELSE
            IF v_jwt_usuario_id IS NULL THEN
                RETURN QUERY SELECT NULL::BIGINT, NULL::TEXT, FALSE, 'Sesion no valida para dependiente'::TEXT;
                RETURN;
            END IF;
            SELECT ud.almacen_tienda INTO v_tienda
            FROM usuarios_dependientes ud
            WHERE ud.usuario_id = v_jwt_usuario_id
              AND ud.activo IS TRUE
            LIMIT 1;
            IF v_tienda IS NULL THEN
                RETURN QUERY SELECT NULL::BIGINT, NULL::TEXT, FALSE, 'No autorizado: dependiente no activo o sin tienda'::TEXT;
                RETURN;
            END IF;
            v_alm_doc := NULLIF(TRIM(UPPER(COALESCE(p_almacen_habitual, ''))), '');
            IF v_alm_doc IS NULL OR TRIM(UPPER(v_tienda)) IS DISTINCT FROM v_alm_doc THEN
                RETURN QUERY SELECT NULL::BIGINT, NULL::TEXT, FALSE, 'Almacen del documento debe coincidir con la tienda del dependiente'::TEXT;
                RETURN;
            END IF;
            v_allowed := TRUE;
        END IF;
    ELSE
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
        IF NOT v_allowed AND NOT v_is_admin THEN
            RETURN QUERY SELECT NULL::BIGINT, NULL::TEXT, FALSE, 'No autorizado para crear presupuestos con ese comercial_id'::TEXT;
            RETURN;
        END IF;
    END IF;

    IF NOT v_allowed AND NOT v_is_admin THEN
        RETURN QUERY SELECT NULL::BIGINT, NULL::TEXT, FALSE, 'No autorizado'::TEXT;
        RETURN;
    END IF;

    v_numero := generar_numero_presupuesto();

    IF p_comercial_id IS NULL AND v_is_admin THEN
        INSERT INTO presupuestos (
            numero_presupuesto,
            usuario_id_cliente,
            comercial_id,
            almacen_habitual,
            observaciones,
            creado_por_usuario_id
        ) VALUES (
            v_numero,
            p_usuario_id_cliente,
            NULL,
            NULLIF(TRIM(COALESCE(p_almacen_habitual, '')), ''),
            NULLIF(TRIM(COALESCE(p_observaciones, '')), ''),
            NULL
        )
        RETURNING id INTO v_presupuesto_id;
    ELSIF p_comercial_id IS NULL THEN
        INSERT INTO presupuestos (
            numero_presupuesto,
            usuario_id_cliente,
            comercial_id,
            almacen_habitual,
            observaciones,
            creado_por_usuario_id
        ) VALUES (
            v_numero,
            p_usuario_id_cliente,
            NULL,
            NULLIF(TRIM(COALESCE(p_almacen_habitual, '')), ''),
            NULLIF(TRIM(COALESCE(p_observaciones, '')), ''),
            v_jwt_usuario_id
        )
        RETURNING id INTO v_presupuesto_id;
    ELSE
        INSERT INTO presupuestos (
            numero_presupuesto,
            usuario_id_cliente,
            comercial_id,
            almacen_habitual,
            observaciones,
            creado_por_usuario_id
        ) VALUES (
            v_numero,
            p_usuario_id_cliente,
            p_comercial_id,
            NULLIF(TRIM(COALESCE(p_almacen_habitual, '')), ''),
            NULLIF(TRIM(COALESCE(p_observaciones, '')), ''),
            NULL
        )
        RETURNING id INTO v_presupuesto_id;
    END IF;

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
