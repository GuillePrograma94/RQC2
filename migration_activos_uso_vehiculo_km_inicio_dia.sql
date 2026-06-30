-- Corrige km_dia: acumulado desde la primera lectura del dia (no desde la ultima actualizacion).
-- Permite varias actualizaciones el mismo dia (ej. 84600 -> 84620 -> 84650 => km_dia = 50).

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
    v_km_stored INTEGER;
    v_km_inicio_dia INTEGER;
    v_km_dia INTEGER;
    v_registro_id UUID;
    v_registro_datos JSONB;
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

    v_km_stored := COALESCE((v_datos ->> 'kilometraje_actual')::INTEGER, 0);

    SELECT ar.id, ar.datos
    INTO v_registro_id, v_registro_datos
    FROM activos_registros ar
    WHERE ar.activo_id = p_activo_id
      AND ar.fecha = v_fecha
      AND ar.tipo = 'uso_vehiculo'
    LIMIT 1;

    IF v_registro_id IS NOT NULL THEN
        v_km_inicio_dia := COALESCE(
            (v_registro_datos ->> 'km_inicio_dia')::INTEGER,
            (v_registro_datos ->> 'km_anterior')::INTEGER,
            v_km_stored
        );
        IF p_km_actual < v_km_stored THEN
            RAISE EXCEPTION 'El kilometraje no puede ser inferior al ultimo registrado hoy (%)', v_km_stored;
        END IF;
    ELSE
        v_km_inicio_dia := v_km_stored;
        IF p_km_actual < v_km_inicio_dia THEN
            RAISE EXCEPTION 'El kilometraje no puede ser inferior al actual (%)', v_km_inicio_dia;
        END IF;
    END IF;

    v_km_dia := p_km_actual - v_km_inicio_dia;

    UPDATE activos
    SET datos = jsonb_set(
        COALESCE(datos, '{}'::jsonb),
        '{kilometraje_actual}',
        to_jsonb(p_km_actual),
        TRUE
    )
    WHERE id = p_activo_id;

    IF v_registro_id IS NOT NULL THEN
        UPDATE activos_registros
        SET
            auth_uid = auth.uid(),
            datos = jsonb_build_object(
                'km_inicio_dia', v_km_inicio_dia,
                'km_actual', p_km_actual,
                'km_anterior', v_km_inicio_dia,
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
                'km_inicio_dia', v_km_inicio_dia,
                'km_actual', p_km_actual,
                'km_anterior', v_km_inicio_dia,
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
        'km_inicio_dia', v_km_inicio_dia,
        'km_actual', p_km_actual,
        'km_dia', v_km_dia,
        'fecha', v_fecha
    );
END;
$$;

COMMENT ON FUNCTION activos_registrar_uso_vehiculo IS
    'Registra o actualiza el uso diario del vehiculo. km_dia = lectura actual - km al inicio del dia (primera lectura).';
