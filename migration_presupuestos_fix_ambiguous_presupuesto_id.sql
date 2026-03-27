-- Fix SQL 42702 en actualizar_presupuesto:
-- "column reference presupuesto_id is ambiguous"
-- Causa: la funcion retorna columna "presupuesto_id" y habia DELETE con identificador no calificado.
-- Ejecutar despues de migration_presupuestos.sql.

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
AS $$
DECLARE
    v_linea JSONB;
    v_orden INTEGER := 0;
BEGIN
    IF p_lineas IS NULL OR jsonb_typeof(p_lineas) <> 'array' OR jsonb_array_length(p_lineas) = 0 THEN
        RETURN QUERY SELECT NULL::BIGINT, FALSE, 'El presupuesto no tiene lineas'::TEXT;
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
