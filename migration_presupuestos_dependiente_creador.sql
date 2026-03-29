-- Presupuestos creados por DEPENDIENTE (tienda)
-- Requiere: migration_presupuestos_pdf_cliente_imagenes.sql (y cadena previa de presupuestos).
-- Ejecutar en Supabase despues de las migraciones de presupuestos con imagen_url.
--
-- Cambios:
-- 1) Columna presupuestos.creado_por_usuario_id cuando comercial_id es NULL (dependiente).
-- 2) crear_presupuesto: p_comercial_id NULL solo si JWT es dependiente activo; almacen documento = almacen_tienda; cliente en ambito tienda.
-- 3) actualizar_presupuesto / cambiar_estado_presupuesto / eliminar_presupuesto: autorizacion dependiente + cierre de hueco p_comercial_id NULL.
-- 4) get_presupuestos_por_creador: listado cuando el dependiente no tiene cliente seleccionado.
-- 5) RLS: acceso por creado_por_usuario_id para dependientes.

ALTER TABLE presupuestos
    ADD COLUMN IF NOT EXISTS creado_por_usuario_id INTEGER NULL REFERENCES usuarios(id) ON UPDATE CASCADE ON DELETE SET NULL;

COMMENT ON COLUMN presupuestos.creado_por_usuario_id IS 'Usuario dependiente que creo el presupuesto si comercial_id es NULL.';

CREATE INDEX IF NOT EXISTS idx_presupuestos_creado_por_usuario
    ON presupuestos (creado_por_usuario_id)
    WHERE creado_por_usuario_id IS NOT NULL;

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
            IF NOT EXISTS (
                SELECT 1
                FROM usuarios_dependientes ud
                JOIN usuarios u ON u.id = p_usuario_id_cliente
                WHERE ud.usuario_id = v_jwt_usuario_id
                  AND ud.activo IS TRUE
                  AND TRIM(UPPER(u.almacen_habitual)) = TRIM(UPPER(ud.almacen_tienda))
                  AND (u.activo IS NULL OR u.activo IS TRUE)
                  AND COALESCE(u.tipo, 'CLIENTE') IN ('CLIENTE', 'ADMINISTRADOR')
            ) THEN
                RETURN QUERY SELECT NULL::BIGINT, NULL::TEXT, FALSE, 'Cliente fuera del ambito de tu tienda'::TEXT;
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

-- ---------------------------------------------------------------------------
-- actualizar_presupuesto
-- ---------------------------------------------------------------------------
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
    v_is_admin BOOLEAN := FALSE;
    v_row_ok BOOLEAN := FALSE;
    v_tienda TEXT;
    v_alm_new TEXT;
BEGIN
    IF p_lineas IS NULL OR jsonb_typeof(p_lineas) <> 'array' OR jsonb_array_length(p_lineas) = 0 THEN
        RETURN QUERY SELECT NULL::BIGINT, FALSE, 'El presupuesto no tiene lineas'::TEXT;
        RETURN;
    END IF;

    v_jwt_usuario_id := NULLIF((auth.jwt() -> 'app_metadata' ->> 'usuario_id'), '')::INTEGER;
    v_jwt_comercial_id := NULLIF((auth.jwt() -> 'app_metadata' ->> 'comercial_id'), '')::INTEGER;
    v_is_admin := ((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::BOOLEAN IS TRUE;

    IF v_is_admin THEN
        SELECT EXISTS(SELECT 1 FROM presupuestos p WHERE p.id = p_presupuesto_id) INTO v_row_ok;
    ELSIF p_comercial_id IS NOT NULL THEN
        IF v_jwt_comercial_id IS NOT NULL AND v_jwt_comercial_id = p_comercial_id THEN
            v_row_ok := TRUE;
        ELSE
            SELECT EXISTS(
                SELECT 1
                FROM usuarios_comerciales uc
                WHERE uc.id = p_comercial_id
                  AND uc.usuario_id = v_jwt_usuario_id
            ) INTO v_row_ok;
        END IF;
        IF v_row_ok THEN
            SELECT EXISTS(
                SELECT 1 FROM presupuestos p
                WHERE p.id = p_presupuesto_id AND p.comercial_id = p_comercial_id
            ) INTO v_row_ok;
        END IF;
    ELSE
        IF v_jwt_usuario_id IS NULL THEN
            RETURN QUERY SELECT NULL::BIGINT, FALSE, 'No autorizado'::TEXT;
            RETURN;
        END IF;
        SELECT ud.almacen_tienda INTO v_tienda
        FROM usuarios_dependientes ud
        WHERE ud.usuario_id = v_jwt_usuario_id AND ud.activo IS TRUE
        LIMIT 1;
        IF v_tienda IS NULL THEN
            RETURN QUERY SELECT NULL::BIGINT, FALSE, 'No autorizado'::TEXT;
            RETURN;
        END IF;
        v_alm_new := NULLIF(TRIM(UPPER(COALESCE(p_almacen_habitual, ''))), '');
        IF v_alm_new IS NOT NULL AND v_alm_new IS DISTINCT FROM TRIM(UPPER(v_tienda)) THEN
            RETURN QUERY SELECT NULL::BIGINT, FALSE, 'Almacen del documento debe coincidir con la tienda del dependiente'::TEXT;
            RETURN;
        END IF;
        SELECT EXISTS(
            SELECT 1 FROM presupuestos p
            WHERE p.id = p_presupuesto_id
              AND p.comercial_id IS NULL
              AND p.creado_por_usuario_id = v_jwt_usuario_id
        ) INTO v_row_ok;
    END IF;

    IF NOT v_row_ok THEN
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

-- ---------------------------------------------------------------------------
-- cambiar_estado_presupuesto
-- ---------------------------------------------------------------------------
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
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_jwt_usuario_id INTEGER;
    v_jwt_comercial_id INTEGER;
    v_is_admin BOOLEAN := FALSE;
    v_row_ok BOOLEAN := FALSE;
    v_tienda TEXT;
BEGIN
    IF p_estado NOT IN ('BORRADOR', 'ENVIADO', 'ACEPTADO', 'RECHAZADO') THEN
        RETURN QUERY SELECT FALSE, 'Estado de presupuesto no valido'::TEXT;
        RETURN;
    END IF;

    v_jwt_usuario_id := NULLIF((auth.jwt() -> 'app_metadata' ->> 'usuario_id'), '')::INTEGER;
    v_jwt_comercial_id := NULLIF((auth.jwt() -> 'app_metadata' ->> 'comercial_id'), '')::INTEGER;
    v_is_admin := ((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::BOOLEAN IS TRUE;

    IF v_is_admin THEN
        SELECT EXISTS(SELECT 1 FROM presupuestos p WHERE p.id = p_presupuesto_id) INTO v_row_ok;
    ELSIF p_comercial_id IS NOT NULL THEN
        IF v_jwt_comercial_id IS NOT NULL AND v_jwt_comercial_id = p_comercial_id THEN
            v_row_ok := TRUE;
        ELSE
            SELECT EXISTS(
                SELECT 1 FROM usuarios_comerciales uc
                WHERE uc.id = p_comercial_id AND uc.usuario_id = v_jwt_usuario_id
            ) INTO v_row_ok;
        END IF;
        IF v_row_ok THEN
            SELECT EXISTS(
                SELECT 1 FROM presupuestos p
                WHERE p.id = p_presupuesto_id AND p.comercial_id = p_comercial_id
            ) INTO v_row_ok;
        END IF;
    ELSE
        IF v_jwt_usuario_id IS NULL THEN
            RETURN QUERY SELECT FALSE, 'No autorizado'::TEXT;
            RETURN;
        END IF;
        SELECT ud.almacen_tienda INTO v_tienda
        FROM usuarios_dependientes ud
        WHERE ud.usuario_id = v_jwt_usuario_id AND ud.activo IS TRUE
        LIMIT 1;
        IF v_tienda IS NULL THEN
            RETURN QUERY SELECT FALSE, 'No autorizado'::TEXT;
            RETURN;
        END IF;
        SELECT EXISTS(
            SELECT 1 FROM presupuestos p
            WHERE p.id = p_presupuesto_id
              AND p.comercial_id IS NULL
              AND p.creado_por_usuario_id = v_jwt_usuario_id
        ) INTO v_row_ok;
    END IF;

    IF NOT v_row_ok THEN
        RETURN QUERY SELECT FALSE, 'No se encontro el presupuesto o no se puede actualizar estado'::TEXT;
        RETURN;
    END IF;

    UPDATE presupuestos
    SET estado = p_estado
    WHERE id = p_presupuesto_id;

    RETURN QUERY SELECT TRUE, 'Estado actualizado correctamente'::TEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- eliminar_presupuesto
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION eliminar_presupuesto(
    p_presupuesto_id BIGINT,
    p_comercial_id INTEGER
)
RETURNS TABLE (
    success BOOLEAN,
    message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_jwt_usuario_id INTEGER;
    v_jwt_comercial_id INTEGER;
    v_is_admin BOOLEAN := FALSE;
    v_row_ok BOOLEAN := FALSE;
    v_tienda TEXT;
BEGIN
    v_jwt_usuario_id := NULLIF((auth.jwt() -> 'app_metadata' ->> 'usuario_id'), '')::INTEGER;
    v_jwt_comercial_id := NULLIF((auth.jwt() -> 'app_metadata' ->> 'comercial_id'), '')::INTEGER;
    v_is_admin := ((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::BOOLEAN IS TRUE;

    IF v_is_admin THEN
        SELECT EXISTS(SELECT 1 FROM presupuestos p WHERE p.id = p_presupuesto_id) INTO v_row_ok;
    ELSIF p_comercial_id IS NOT NULL THEN
        IF v_jwt_comercial_id IS NOT NULL AND v_jwt_comercial_id = p_comercial_id THEN
            v_row_ok := TRUE;
        ELSE
            SELECT EXISTS(
                SELECT 1 FROM usuarios_comerciales uc
                WHERE uc.id = p_comercial_id AND uc.usuario_id = v_jwt_usuario_id
            ) INTO v_row_ok;
        END IF;
        IF v_row_ok THEN
            SELECT EXISTS(
                SELECT 1 FROM presupuestos p
                WHERE p.id = p_presupuesto_id AND p.comercial_id = p_comercial_id
            ) INTO v_row_ok;
        END IF;
    ELSE
        IF v_jwt_usuario_id IS NULL THEN
            RETURN QUERY SELECT FALSE, 'No autorizado'::TEXT;
            RETURN;
        END IF;
        SELECT ud.almacen_tienda INTO v_tienda
        FROM usuarios_dependientes ud
        WHERE ud.usuario_id = v_jwt_usuario_id AND ud.activo IS TRUE
        LIMIT 1;
        IF v_tienda IS NULL THEN
            RETURN QUERY SELECT FALSE, 'No autorizado'::TEXT;
            RETURN;
        END IF;
        SELECT EXISTS(
            SELECT 1 FROM presupuestos p
            WHERE p.id = p_presupuesto_id
              AND p.comercial_id IS NULL
              AND p.creado_por_usuario_id = v_jwt_usuario_id
        ) INTO v_row_ok;
    END IF;

    IF NOT v_row_ok THEN
        RETURN QUERY SELECT FALSE, 'No se encontro el presupuesto o no se puede eliminar'::TEXT;
        RETURN;
    END IF;

    DELETE FROM presupuestos
    WHERE id = p_presupuesto_id;

    RETURN QUERY SELECT TRUE, 'Presupuesto eliminado correctamente'::TEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- get_presupuestos_por_creador (dependiente sin cliente seleccionado)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_presupuestos_por_creador(p_creador_usuario_id INTEGER)
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
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_jwt INTEGER;
    v_admin BOOLEAN;
BEGIN
    v_jwt := NULLIF((auth.jwt() -> 'app_metadata' ->> 'usuario_id'), '')::INTEGER;
    v_admin := ((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::BOOLEAN IS TRUE;
    IF p_creador_usuario_id IS NULL OR (NOT v_admin AND v_jwt IS DISTINCT FROM p_creador_usuario_id) THEN
        RETURN;
    END IF;
    RETURN QUERY
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
    WHERE p.creado_por_usuario_id = p_creador_usuario_id
    ORDER BY p.fecha DESC
    LIMIT 500;
END;
$$;

GRANT EXECUTE ON FUNCTION get_presupuestos_por_creador(INTEGER) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS presupuestos y lineas (dependiente / creador)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "presupuestos_select_cliente_comercial_admin" ON presupuestos;
CREATE POLICY "presupuestos_select_cliente_comercial_admin"
    ON presupuestos FOR SELECT
    TO authenticated
    USING (
        usuario_id_cliente = NULLIF((auth.jwt() -> 'app_metadata' ->> 'usuario_id'), '')::INTEGER
        OR comercial_id = NULLIF((auth.jwt() -> 'app_metadata' ->> 'comercial_id'), '')::INTEGER
        OR creado_por_usuario_id = NULLIF((auth.jwt() -> 'app_metadata' ->> 'usuario_id'), '')::INTEGER
        OR ((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::BOOLEAN IS TRUE
    );

DROP POLICY IF EXISTS "presupuestos_insert_comercial_admin" ON presupuestos;
CREATE POLICY "presupuestos_insert_comercial_admin"
    ON presupuestos FOR INSERT
    TO authenticated
    WITH CHECK (
        comercial_id = NULLIF((auth.jwt() -> 'app_metadata' ->> 'comercial_id'), '')::INTEGER
        OR ((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::BOOLEAN IS TRUE
        OR (
            comercial_id IS NULL
            AND creado_por_usuario_id = NULLIF((auth.jwt() -> 'app_metadata' ->> 'usuario_id'), '')::INTEGER
            AND EXISTS (
                SELECT 1 FROM usuarios_dependientes ud
                WHERE ud.usuario_id = creado_por_usuario_id AND ud.activo IS TRUE
            )
        )
    );

DROP POLICY IF EXISTS "presupuestos_update_comercial_admin" ON presupuestos;
CREATE POLICY "presupuestos_update_comercial_admin"
    ON presupuestos FOR UPDATE
    TO authenticated
    USING (
        comercial_id = NULLIF((auth.jwt() -> 'app_metadata' ->> 'comercial_id'), '')::INTEGER
        OR ((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::BOOLEAN IS TRUE
        OR creado_por_usuario_id = NULLIF((auth.jwt() -> 'app_metadata' ->> 'usuario_id'), '')::INTEGER
    )
    WITH CHECK (
        comercial_id = NULLIF((auth.jwt() -> 'app_metadata' ->> 'comercial_id'), '')::INTEGER
        OR ((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::BOOLEAN IS TRUE
        OR creado_por_usuario_id = NULLIF((auth.jwt() -> 'app_metadata' ->> 'usuario_id'), '')::INTEGER
    );

DROP POLICY IF EXISTS "presupuestos_delete_comercial_admin" ON presupuestos;
CREATE POLICY "presupuestos_delete_comercial_admin"
    ON presupuestos FOR DELETE
    TO authenticated
    USING (
        comercial_id = NULLIF((auth.jwt() -> 'app_metadata' ->> 'comercial_id'), '')::INTEGER
        OR ((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::BOOLEAN IS TRUE
        OR creado_por_usuario_id = NULLIF((auth.jwt() -> 'app_metadata' ->> 'usuario_id'), '')::INTEGER
    );

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
                 OR p.creado_por_usuario_id = NULLIF((auth.jwt() -> 'app_metadata' ->> 'usuario_id'), '')::INTEGER
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
                 OR p.creado_por_usuario_id = NULLIF((auth.jwt() -> 'app_metadata' ->> 'usuario_id'), '')::INTEGER
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
                 OR p.creado_por_usuario_id = NULLIF((auth.jwt() -> 'app_metadata' ->> 'usuario_id'), '')::INTEGER
                 OR ((auth.jwt() -> 'app_metadata') ->> 'es_administracion')::BOOLEAN IS TRUE
              )
        )
    );
