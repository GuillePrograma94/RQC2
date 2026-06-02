-- Preservar sinonimos (y codigo_proveedor) en UPDATE cuando no vienen en el JSON.
-- Sin esto, generate_supabase_file.py sin sinonimos.csv borraba sinonimos en Supabase.
-- Ejecutar en Supabase SQL Editor una vez.

-- Variante con catalogo ERP (clave_descuento, activo, activo_web)
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
    v_clave_descuento TEXT;
    v_activo BOOLEAN;
    v_activo_web BOOLEAN;
    v_cur_clave TEXT;
    v_cur_activo BOOLEAN;
    v_cur_activo_web BOOLEAN;
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

        SELECT EXISTS(SELECT 1 FROM productos pr WHERE pr.codigo = v_codigo_prod) INTO v_existe;

        IF v_existe THEN
            SELECT pr.fecha_actualizacion, pr.clave_descuento, pr.activo, pr.activo_web
            INTO v_fecha_antes, v_cur_clave, v_cur_activo, v_cur_activo_web
            FROM productos pr WHERE pr.codigo = v_codigo_prod;

            v_clave_descuento := CASE WHEN producto_item ? 'clave_descuento' THEN
                NULLIF(TRIM(COALESCE((producto_item->>'clave_descuento')::TEXT, '')), '')
            ELSE v_cur_clave END;
            v_activo := CASE WHEN producto_item ? 'activo' THEN
                COALESCE((producto_item->>'activo')::BOOLEAN, TRUE)
            ELSE v_cur_activo END;
            v_activo_web := CASE WHEN producto_item ? 'activo_web' THEN
                COALESCE((producto_item->>'activo_web')::BOOLEAN, TRUE)
            ELSE v_cur_activo_web END;

            UPDATE productos
            SET
                descripcion = TRIM(COALESCE(v_descripcion, '')),
                pvp = ROUND(v_pvp::numeric, 2)::real,
                sinonimos = CASE WHEN producto_item ? 'sinonimos' THEN
                    NULLIF(TRIM(COALESCE((producto_item->>'sinonimos')::TEXT, '')), '')
                ELSE productos.sinonimos END,
                codigo_proveedor = CASE WHEN producto_item ? 'codigo_proveedor' THEN
                    NULLIF(TRIM(COALESCE((producto_item->>'codigo_proveedor')::TEXT, '')), '')
                ELSE productos.codigo_proveedor END,
                clave_descuento = v_clave_descuento,
                activo = v_activo,
                activo_web = v_activo_web
            WHERE productos.codigo = v_codigo_prod;

            SELECT pr.fecha_actualizacion INTO v_fecha_actual FROM productos pr WHERE pr.codigo = v_codigo_prod;

            IF v_fecha_actual != v_fecha_antes THEN
                v_accion := 'UPDATE';
                RETURN QUERY
                SELECT v_codigo_prod::TEXT, v_accion::TEXT, v_fecha_actual;
            END IF;
        ELSE
            v_sinonimos := CASE WHEN producto_item ? 'sinonimos' THEN
                NULLIF(TRIM(COALESCE((producto_item->>'sinonimos')::TEXT, '')), '')
            ELSE NULL END;
            v_codigo_proveedor := CASE WHEN producto_item ? 'codigo_proveedor' THEN
                NULLIF(TRIM(COALESCE((producto_item->>'codigo_proveedor')::TEXT, '')), '')
            ELSE NULL END;
            v_clave_descuento := CASE WHEN producto_item ? 'clave_descuento' THEN
                NULLIF(TRIM(COALESCE((producto_item->>'clave_descuento')::TEXT, '')), '')
            ELSE NULL END;
            v_activo := CASE WHEN producto_item ? 'activo' THEN
                COALESCE((producto_item->>'activo')::BOOLEAN, TRUE)
            ELSE TRUE END;
            v_activo_web := CASE WHEN producto_item ? 'activo_web' THEN
                COALESCE((producto_item->>'activo_web')::BOOLEAN, TRUE)
            ELSE TRUE END;
            v_fecha_actual := NOW();
            INSERT INTO productos (
                codigo, descripcion, pvp, sinonimos, codigo_proveedor,
                clave_descuento, activo, activo_web,
                fecha_creacion, fecha_actualizacion
            )
            VALUES (
                v_codigo_prod,
                TRIM(COALESCE(v_descripcion, '')),
                ROUND(v_pvp::numeric, 2)::real,
                v_sinonimos,
                v_codigo_proveedor,
                v_clave_descuento,
                v_activo,
                v_activo_web,
                v_fecha_actual,
                v_fecha_actual
            );
            v_accion := 'INSERT';
            RETURN QUERY
            SELECT v_codigo_prod::TEXT, v_accion::TEXT, v_fecha_actual;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION upsert_productos_masivo_con_fecha(JSONB) IS
'UPSERT masivo productos. JSON: codigo, descripcion, pvp; sinonimos y codigo_proveedor opcionales (si no vienen en UPDATE, se conservan). clave_descuento, activo, activo_web opcionales.';
