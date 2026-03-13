-- Anade codigo_proveedor a las funciones RPC de upsert de productos.
-- Ejecutar DESPUES de migration_proveedores_productos.sql (columna productos.codigo_proveedor existe).
-- Compatible con migration_sincronizacion_incremental.sql: actualiza las mismas funciones.

-- Trigger: actualizar fecha_actualizacion cuando codigo_proveedor cambie (ademas de descripcion, pvp, sinonimos)
CREATE OR REPLACE FUNCTION actualizar_fecha_productos()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF TRIM(COALESCE(OLD.descripcion, '')) IS DISTINCT FROM TRIM(COALESCE(NEW.descripcion, ''))
           OR ROUND(OLD.pvp::numeric, 2) IS DISTINCT FROM ROUND(NEW.pvp::numeric, 2)
           OR TRIM(COALESCE(OLD.sinonimos, '')) IS DISTINCT FROM TRIM(COALESCE(NEW.sinonimos, ''))
           OR TRIM(COALESCE(OLD.codigo_proveedor, '')) IS DISTINCT FROM TRIM(COALESCE(NEW.codigo_proveedor, '')) THEN
            NEW.fecha_actualizacion = NOW();
        ELSE
            NEW.fecha_actualizacion = OLD.fecha_actualizacion;
        END IF;
        NEW.pvp = ROUND(NEW.pvp::numeric, 2)::real;
        NEW.fecha_creacion = OLD.fecha_creacion;
    ELSIF TG_OP = 'INSERT' THEN
        IF NEW.fecha_creacion IS NULL THEN
            NEW.fecha_creacion = NOW();
        END IF;
        IF NEW.fecha_actualizacion IS NULL THEN
            NEW.fecha_actualizacion = NOW();
        END IF;
        NEW.pvp = ROUND(NEW.pvp::numeric, 2)::real;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop version anterior (4 parametros sin codigo_proveedor)
DROP FUNCTION IF EXISTS upsert_producto_con_fecha(text, text, real, text);

-- Funcion para UPSERT de productos (incluye codigo_proveedor)
CREATE OR REPLACE FUNCTION upsert_producto_con_fecha(
    p_codigo TEXT,
    p_descripcion TEXT,
    p_pvp REAL,
    p_sinonimos TEXT DEFAULT NULL,
    p_codigo_proveedor TEXT DEFAULT NULL
)
RETURNS TABLE (
    codigo TEXT,
    descripcion TEXT,
    pvp REAL,
    sinonimos TEXT,
    fecha_creacion TIMESTAMP WITH TIME ZONE,
    fecha_actualizacion TIMESTAMP WITH TIME ZONE,
    accion TEXT
) AS $$
DECLARE
    v_existe BOOLEAN;
    v_fecha_creacion_original TIMESTAMP WITH TIME ZONE;
    v_accion TEXT;
    v_codigo_proveedor TEXT;
BEGIN
    v_codigo_proveedor := NULLIF(TRIM(COALESCE(p_codigo_proveedor, '')), '');

    SELECT EXISTS(SELECT 1 FROM productos WHERE productos.codigo = p_codigo) INTO v_existe;

    IF v_existe THEN
        SELECT productos.fecha_creacion INTO v_fecha_creacion_original
        FROM productos
        WHERE productos.codigo = p_codigo;

        UPDATE productos
        SET 
            descripcion = TRIM(COALESCE(p_descripcion, '')),
            pvp = ROUND(p_pvp::numeric, 2)::real,
            sinonimos = NULLIF(TRIM(COALESCE(p_sinonimos, '')), ''),
            codigo_proveedor = v_codigo_proveedor
        WHERE productos.codigo = p_codigo;

        v_accion := 'UPDATE';
    ELSE
        INSERT INTO productos (codigo, descripcion, pvp, sinonimos, codigo_proveedor, fecha_creacion, fecha_actualizacion)
        VALUES (p_codigo, TRIM(COALESCE(p_descripcion, '')), ROUND(p_pvp::numeric, 2)::real, NULLIF(TRIM(COALESCE(p_sinonimos, '')), ''), v_codigo_proveedor, NOW(), NOW());

        v_fecha_creacion_original := NOW();
        v_accion := 'INSERT';
    END IF;

    RETURN QUERY
    SELECT 
        prod.codigo::TEXT,
        prod.descripcion::TEXT,
        prod.pvp,
        prod.sinonimos::TEXT,
        prod.fecha_creacion,
        prod.fecha_actualizacion,
        v_accion::TEXT
    FROM productos prod
    WHERE prod.codigo = p_codigo;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION upsert_producto_con_fecha(text, text, real, text, text) IS 
'UPSERT de producto. Actualiza fecha_actualizacion cuando descripcion, pvp, sinonimos o codigo_proveedor cambian.';

-- Funcion para UPSERT masivo de productos (incluye codigo_proveedor)
CREATE OR REPLACE FUNCTION upsert_productos_masivo_con_fecha(
    productos_json JSONB
)
RETURNS TABLE (
    codigo TEXT,
    accion TEXT,
    fecha_actualizacion TIMESTAMP WITH TIME ZONE
) AS $$
DECLARE
    producto_item JSONB;
    v_codigo_prod TEXT;
    v_descripcion TEXT;
    v_pvp REAL;
    v_sinonimos TEXT;
    v_codigo_proveedor TEXT;
    v_existe BOOLEAN;
    v_accion TEXT;
    v_fecha_actual TIMESTAMP WITH TIME ZONE;
    v_fecha_antes TIMESTAMP WITH TIME ZONE;
BEGIN
    FOR producto_item IN SELECT * FROM jsonb_array_elements(productos_json)
    LOOP
        v_codigo_prod := (producto_item->>'codigo')::TEXT;
        v_descripcion := (producto_item->>'descripcion')::TEXT;
        v_pvp := (producto_item->>'pvp')::REAL;
        v_sinonimos := NULLIF(TRIM(COALESCE((producto_item->>'sinonimos')::TEXT, '')), '');
        v_codigo_proveedor := NULLIF(TRIM(COALESCE((producto_item->>'codigo_proveedor')::TEXT, '')), '');

        SELECT EXISTS(
            SELECT 1 
            FROM productos 
            WHERE productos.codigo = v_codigo_prod
        ) INTO v_existe;

        IF v_existe THEN
            SELECT productos.fecha_actualizacion INTO v_fecha_antes
            FROM productos WHERE productos.codigo = v_codigo_prod;

            UPDATE productos
            SET 
                descripcion = TRIM(COALESCE(v_descripcion, '')),
                pvp = ROUND(v_pvp::numeric, 2)::real,
                sinonimos = v_sinonimos,
                codigo_proveedor = v_codigo_proveedor
            WHERE productos.codigo = v_codigo_prod;

            SELECT productos.fecha_actualizacion INTO v_fecha_actual
            FROM productos WHERE productos.codigo = v_codigo_prod;

            IF v_fecha_actual != v_fecha_antes THEN
                v_accion := 'UPDATE';
                RETURN QUERY
                SELECT 
                    v_codigo_prod::TEXT,
                    v_accion::TEXT,
                    v_fecha_actual;
            END IF;
        ELSE
            v_fecha_actual := NOW();
            INSERT INTO productos (codigo, descripcion, pvp, sinonimos, codigo_proveedor, fecha_creacion, fecha_actualizacion)
            VALUES (v_codigo_prod, TRIM(COALESCE(v_descripcion, '')), ROUND(v_pvp::numeric, 2)::real, v_sinonimos, v_codigo_proveedor, v_fecha_actual, v_fecha_actual);
            v_accion := 'INSERT';

            RETURN QUERY
            SELECT 
                v_codigo_prod::TEXT,
                v_accion::TEXT,
                v_fecha_actual;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION upsert_productos_masivo_con_fecha(JSONB) IS 
'UPSERT masivo de productos. Actualiza fecha cuando descripcion, pvp, sinonimos o codigo_proveedor cambian.
Recibe JSONB con array de productos (codigo, descripcion, pvp, sinonimos opcional, codigo_proveedor opcional).';
