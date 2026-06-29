-- RPC de uso diario de vehiculo (logica simplificada desde Flora).
-- Ejecutar DESPUES de migration_activos_empresa_core.sql.

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
    ELSIF activos_es_trabajador() AND activos_tiene_asignacion_activa(p_activo_id) THEN
        NULL;
    ELSE
        RAISE EXCEPTION 'No autorizado para registrar uso de este vehiculo';
    END IF;

    v_km_anterior := COALESCE((v_datos ->> 'kilometraje_actual')::INTEGER, 0);

    IF p_km_actual < v_km_anterior THEN
        RAISE EXCEPTION 'El kilometraje no puede ser inferior al actual (%)', v_km_anterior;
    END IF;

    v_km_dia := p_km_actual - v_km_anterior;

    -- Actualizar km en ficha maestra
    UPDATE activos
    SET datos = jsonb_set(
        COALESCE(datos, '{}'::jsonb),
        '{kilometraje_actual}',
        to_jsonb(p_km_actual),
        TRUE
    )
    WHERE id = p_activo_id;

    -- Upsert registro del dia
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

COMMENT ON FUNCTION activos_registrar_uso_vehiculo IS 'Registra uso diario del vehiculo. Calcula km del dia. Trabajador asignado o ADMINISTRACION.';

-- RPC: registrar evento generico (admin: impresora, ordenador, telefono)
CREATE OR REPLACE FUNCTION activos_registrar_evento(
    p_activo_id UUID,
    p_tipo TEXT,
    p_datos JSONB DEFAULT '{}'::jsonb,
    p_fecha DATE DEFAULT CURRENT_DATE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id UUID;
    v_categoria TEXT;
BEGIN
    IF NOT activos_es_administracion() THEN
        RAISE EXCEPTION 'No autorizado';
    END IF;

    SELECT categoria_codigo INTO v_categoria FROM activos WHERE id = p_activo_id;
    IF v_categoria IS NULL THEN
        RAISE EXCEPTION 'Activo no encontrado';
    END IF;

    INSERT INTO activos_registros (activo_id, auth_uid, tipo, datos, fecha)
    VALUES (p_activo_id, auth.uid(), p_tipo, COALESCE(p_datos, '{}'::jsonb), COALESCE(p_fecha, CURRENT_DATE))
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

COMMENT ON FUNCTION activos_registrar_evento IS 'Registra evento de mantenimiento/contador. Solo ADMINISTRACION.';

-- RPC: listar activos por categoria con asignacion (admin)
CREATE OR REPLACE FUNCTION activos_listar_por_categoria(p_categoria TEXT)
RETURNS TABLE (
    id UUID,
    nombre TEXT,
    identificador TEXT,
    estado TEXT,
    datos JSONB,
    asignado_nombre TEXT,
    asignado_codigo TEXT,
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
        COALESCE(u.nombre, uc.nombre) AS asignado_nombre,
        COALESCE(u.codigo_usuario, uc.numero::TEXT) AS asignado_codigo,
        aa.auth_uid
    FROM activos a
    LEFT JOIN activos_asignaciones aa ON aa.activo_id = a.id AND aa.activa = TRUE
    LEFT JOIN usuarios u ON u.id = aa.usuario_id
    LEFT JOIN usuarios_comerciales uc ON uc.id = aa.comercial_id
    WHERE a.categoria_codigo = p_categoria
    ORDER BY a.nombre;
END;
$$;
