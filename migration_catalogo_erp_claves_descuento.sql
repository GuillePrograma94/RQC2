-- =============================================================================
-- Catalogo ERP: clave descuento, visibilidad, tarifas por clave, sync incremental
-- Ejecutar en Supabase SQL Editor DESPUES de:
--   migration_rpc_productos_codigo_proveedor.sql (o equivalente con codigo_proveedor)
--   migration_sincronizacion_incremental.sql (base de RPCs incrementales)
--   migration_dependientes_tienda.sql (verificar_login_usuario actual)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Columnas en productos (Codigo Familia ERP -> clave_descuento internamente)
-- -----------------------------------------------------------------------------
ALTER TABLE productos
    ADD COLUMN IF NOT EXISTS clave_descuento TEXT,
    ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS activo_web BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN productos.clave_descuento IS 'Clave de descuento (en ERP: Codigo Familia). Enlaza con claves_descuento.clave.';
COMMENT ON COLUMN productos.activo IS 'ERP Activo T/F; false junto activo_web y sin stock suele ocultarse en app.';
COMMENT ON COLUMN productos.activo_web IS 'ERP Activo Web T/F.';

UPDATE productos SET activo = TRUE WHERE activo IS NULL;
UPDATE productos SET activo_web = TRUE WHERE activo_web IS NULL;

-- -----------------------------------------------------------------------------
-- 2. Tabla claves_descuento (tarifas en JSONB: {"00": 35, "01": 40})
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claves_descuento (
    clave TEXT PRIMARY KEY,
    tarifas JSONB NOT NULL DEFAULT '{}'::jsonb,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE claves_descuento IS 'Descuentos por clave (codigo familia ERP) y codigo de tarifa; tarifas es objeto JSON codigo_tarifa -> porcentaje.';

CREATE INDEX IF NOT EXISTS idx_claves_descuento_fecha_actualizacion
    ON claves_descuento (fecha_actualizacion DESC);

-- Trigger fecha en claves_descuento
CREATE OR REPLACE FUNCTION actualizar_fecha_claves_descuento()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF OLD.tarifas IS DISTINCT FROM NEW.tarifas OR TRIM(COALESCE(OLD.clave, '')) IS DISTINCT FROM TRIM(COALESCE(NEW.clave, '')) THEN
            NEW.fecha_actualizacion = NOW();
        ELSE
            NEW.fecha_actualizacion = OLD.fecha_actualizacion;
        END IF;
        NEW.fecha_creacion = OLD.fecha_creacion;
    ELSIF TG_OP = 'INSERT' THEN
        IF NEW.fecha_creacion IS NULL THEN NEW.fecha_creacion = NOW(); END IF;
        IF NEW.fecha_actualizacion IS NULL THEN NEW.fecha_actualizacion = NOW(); END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_actualizar_fecha_claves_descuento ON claves_descuento;
CREATE TRIGGER trigger_actualizar_fecha_claves_descuento
    BEFORE INSERT OR UPDATE ON claves_descuento
    FOR EACH ROW
    EXECUTE FUNCTION actualizar_fecha_claves_descuento();

-- -----------------------------------------------------------------------------
-- 3. Tarifa en usuarios (codigo tarifa ERP, ej. 00); null = sin dto por tarifa
-- -----------------------------------------------------------------------------
ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS tarifa TEXT;

COMMENT ON COLUMN usuarios.tarifa IS 'Codigo de tarifa ERP para aplicar % desde claves_descuento segun clave del producto; null = sin descuento por tarifa.';

-- -----------------------------------------------------------------------------
-- 4. Indice unico en familias_asignadas por codigo articulo (merge / upsert)
--     Nota: si falla por duplicados, ejecutar deduplicacion antes.
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_familias_asignadas_codigo_upper_unique
    ON familias_asignadas (UPPER(TRIM("Codigo")));

-- -----------------------------------------------------------------------------
-- 5. RLS claves_descuento (lectura catalogo para anon/authenticated)
-- -----------------------------------------------------------------------------
ALTER TABLE claves_descuento ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS claves_descuento_select_anon ON claves_descuento;
CREATE POLICY claves_descuento_select_anon ON claves_descuento
    FOR SELECT
    USING (true);

-- -----------------------------------------------------------------------------
-- 6. Trigger productos: incluir codigo_proveedor + clave_descuento + activo + activo_web
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION actualizar_fecha_productos()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF TRIM(COALESCE(OLD.descripcion, '')) IS DISTINCT FROM TRIM(COALESCE(NEW.descripcion, ''))
           OR ROUND(OLD.pvp::numeric, 2) IS DISTINCT FROM ROUND(NEW.pvp::numeric, 2)
           OR TRIM(COALESCE(OLD.sinonimos, '')) IS DISTINCT FROM TRIM(COALESCE(NEW.sinonimos, ''))
           OR TRIM(COALESCE(OLD.codigo_proveedor, '')) IS DISTINCT FROM TRIM(COALESCE(NEW.codigo_proveedor, ''))
           OR TRIM(COALESCE(OLD.clave_descuento, '')) IS DISTINCT FROM TRIM(COALESCE(NEW.clave_descuento, ''))
           OR OLD.activo IS DISTINCT FROM NEW.activo
           OR OLD.activo_web IS DISTINCT FROM NEW.activo_web
        THEN
            NEW.fecha_actualizacion = NOW();
        ELSE
            NEW.fecha_actualizacion = OLD.fecha_actualizacion;
        END IF;
        NEW.pvp = ROUND(NEW.pvp::numeric, 2)::real;
        NEW.fecha_creacion = OLD.fecha_creacion;
    ELSIF TG_OP = 'INSERT' THEN
        IF NEW.fecha_creacion IS NULL THEN NEW.fecha_creacion = NOW(); END IF;
        IF NEW.fecha_actualizacion IS NULL THEN NEW.fecha_actualizacion = NOW(); END IF;
        NEW.pvp = ROUND(NEW.pvp::numeric, 2)::real;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- 7. obtener_productos_modificados: nuevas columnas + codigo_proveedor
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS obtener_productos_modificados(text);

CREATE OR REPLACE FUNCTION obtener_productos_modificados(
    p_version_hash_local TEXT
)
RETURNS TABLE (
    codigo TEXT,
    descripcion TEXT,
    pvp REAL,
    sinonimos TEXT,
    codigo_proveedor TEXT,
    clave_descuento TEXT,
    activo BOOLEAN,
    activo_web BOOLEAN,
    fecha_actualizacion TIMESTAMP WITH TIME ZONE,
    accion TEXT
) AS $$
DECLARE
    v_fecha_version TIMESTAMP WITH TIME ZONE;
BEGIN
    SELECT vc.fecha_actualizacion INTO v_fecha_version
    FROM version_control vc
    WHERE vc.version_hash = p_version_hash_local
    ORDER BY vc.id DESC
    LIMIT 1;

    IF v_fecha_version IS NULL THEN
        RETURN QUERY
        SELECT
            p.codigo::TEXT,
            p.descripcion::TEXT,
            p.pvp,
            p.sinonimos::TEXT,
            p.codigo_proveedor::TEXT,
            p.clave_descuento::TEXT,
            p.activo,
            p.activo_web,
            p.fecha_actualizacion,
            'INSERT'::TEXT AS accion
        FROM productos p
        ORDER BY p.codigo;
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        p.codigo::TEXT,
        p.descripcion::TEXT,
        p.pvp,
        p.sinonimos::TEXT,
        p.codigo_proveedor::TEXT,
        p.clave_descuento::TEXT,
        p.activo,
        p.activo_web,
        p.fecha_actualizacion,
        CASE
            WHEN p.fecha_creacion > v_fecha_version THEN 'INSERT'::TEXT
            ELSE 'UPDATE'::TEXT
        END AS accion
    FROM productos p
    WHERE p.fecha_actualizacion > v_fecha_version
       OR p.fecha_creacion > v_fecha_version
    ORDER BY p.codigo;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION obtener_productos_modificados IS
'Productos modificados desde version_control; incluye codigo_proveedor, clave_descuento, activo, activo_web.';

-- -----------------------------------------------------------------------------
-- 8. upsert_productos_masivo_con_fecha: JSON opcional clave_descuento, activo, activo_web
-- -----------------------------------------------------------------------------
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
        v_sinonimos := NULLIF(TRIM(COALESCE((producto_item->>'sinonimos')::TEXT, '')), '');
        v_codigo_proveedor := NULLIF(TRIM(COALESCE((producto_item->>'codigo_proveedor')::TEXT, '')), '');

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
                sinonimos = v_sinonimos,
                codigo_proveedor = v_codigo_proveedor,
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
'UPSERT masivo productos. JSON: codigo, descripcion, pvp, sinonimos?, codigo_proveedor?, clave_descuento?, activo?, activo_web?.';

-- -----------------------------------------------------------------------------
-- 8b. Import ERP catalogo: solo flags (no tocar descripcion, pvp, sinonimos, etc.)
-- -----------------------------------------------------------------------------
-- Evita INSERT/upsert REST que puede proponer NULL en columnas NOT NULL y, en general,
-- limita el impacto a tres columnas. Filas sin codigo coincidente en productos: 0 updates.
CREATE OR REPLACE FUNCTION actualizar_productos_catalogo_erp_flags(filas_json JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    n INTEGER;
BEGIN
    WITH data AS (
        SELECT
            NULLIF(TRIM(UPPER(COALESCE(elem->>'codigo', ''))), '') AS codigo,
            NULLIF(TRIM(COALESCE(elem->>'clave_descuento', '')), '') AS clave_descuento,
            (elem->>'activo')::boolean AS activo,
            (elem->>'activo_web')::boolean AS activo_web
        FROM jsonb_array_elements(filas_json) AS t(elem)
        WHERE NULLIF(TRIM(UPPER(COALESCE(elem->>'codigo', ''))), '') IS NOT NULL
    )
    UPDATE productos p
    SET
        clave_descuento = d.clave_descuento,
        activo = d.activo,
        activo_web = d.activo_web
    FROM data d
    WHERE p.codigo = d.codigo;

    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END;
$$;

COMMENT ON FUNCTION actualizar_productos_catalogo_erp_flags(JSONB) IS
'Actualiza solo clave_descuento, activo y activo_web por codigo. No inserta filas ni modifica descripcion, pvp, sinonimos ni codigo_proveedor.';

GRANT EXECUTE ON FUNCTION actualizar_productos_catalogo_erp_flags(JSONB) TO service_role;

-- -----------------------------------------------------------------------------
-- 9. upsert_producto_con_fecha (unidad) alineado
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS upsert_producto_con_fecha(text, text, real, text, text);

CREATE OR REPLACE FUNCTION upsert_producto_con_fecha(
    p_codigo TEXT,
    p_descripcion TEXT,
    p_pvp REAL,
    p_sinonimos TEXT DEFAULT NULL,
    p_codigo_proveedor TEXT DEFAULT NULL,
    p_clave_descuento TEXT DEFAULT NULL,
    p_activo BOOLEAN DEFAULT TRUE,
    p_activo_web BOOLEAN DEFAULT TRUE
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
    v_clave_descuento TEXT;
BEGIN
    v_codigo_proveedor := NULLIF(TRIM(COALESCE(p_codigo_proveedor, '')), '');
    v_clave_descuento := NULLIF(TRIM(COALESCE(p_clave_descuento, '')), '');

    SELECT EXISTS(SELECT 1 FROM productos pr WHERE pr.codigo = p_codigo) INTO v_existe;

    IF v_existe THEN
        SELECT pr.fecha_creacion INTO v_fecha_creacion_original FROM productos pr WHERE pr.codigo = p_codigo;

        UPDATE productos
        SET
            descripcion = TRIM(COALESCE(p_descripcion, '')),
            pvp = ROUND(p_pvp::numeric, 2)::real,
            sinonimos = NULLIF(TRIM(COALESCE(p_sinonimos, '')), ''),
            codigo_proveedor = v_codigo_proveedor,
            clave_descuento = v_clave_descuento,
            activo = COALESCE(p_activo, TRUE),
            activo_web = COALESCE(p_activo_web, TRUE)
        WHERE productos.codigo = p_codigo;

        v_accion := 'UPDATE';
    ELSE
        INSERT INTO productos (
            codigo, descripcion, pvp, sinonimos, codigo_proveedor,
            clave_descuento, activo, activo_web,
            fecha_creacion, fecha_actualizacion
        )
        VALUES (
            p_codigo,
            TRIM(COALESCE(p_descripcion, '')),
            ROUND(p_pvp::numeric, 2)::real,
            NULLIF(TRIM(COALESCE(p_sinonimos, '')), ''),
            v_codigo_proveedor,
            v_clave_descuento,
            COALESCE(p_activo, TRUE),
            COALESCE(p_activo_web, TRUE),
            NOW(),
            NOW()
        );

        v_fecha_creacion_original := NOW();
        v_accion := 'INSERT';
    END IF;

    RETURN QUERY
    SELECT
        pr.codigo::TEXT,
        pr.descripcion::TEXT,
        pr.pvp,
        pr.sinonimos::TEXT,
        pr.fecha_creacion,
        pr.fecha_actualizacion,
        v_accion::TEXT
    FROM productos pr
    WHERE pr.codigo = p_codigo;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- 10. Estadisticas por dominio (sin sumar para umbral unico obligatorio)
-- -----------------------------------------------------------------------------
-- Cambian columnas OUT: CREATE OR REPLACE no altera el tipo de retorno en PG.
DROP FUNCTION IF EXISTS obtener_estadisticas_cambios(text);

CREATE OR REPLACE FUNCTION obtener_estadisticas_cambios(
    p_version_hash_local TEXT
)
RETURNS TABLE (
    productos_modificados INTEGER,
    productos_nuevos INTEGER,
    codigos_modificados INTEGER,
    codigos_nuevos INTEGER,
    claves_descuento_modificadas INTEGER,
    claves_descuento_nuevas INTEGER,
    total_cambios INTEGER
) AS $$
DECLARE
    v_fecha_version TIMESTAMP WITH TIME ZONE;
    v_productos_mod INTEGER;
    v_productos_nuevos INTEGER;
    v_codigos_mod INTEGER;
    v_codigos_nuevos INTEGER;
    v_claves_mod INTEGER;
    v_claves_nuevas INTEGER;
BEGIN
    SELECT vc.fecha_actualizacion INTO v_fecha_version
    FROM version_control vc
    WHERE vc.version_hash = p_version_hash_local
    ORDER BY vc.id DESC
    LIMIT 1;

    -- Misma semantica que migration_sincronizacion_incremental.sql: si no hay version,
    -- mod/nuevo por dominio = conteo total de filas (duplicado a proposito para umbrales en cliente).
    -- total_cambios = suma por tabla (una vez cada una), como en la migracion base + claves_descuento.
    IF v_fecha_version IS NULL THEN
        RETURN QUERY
        SELECT
            (SELECT COUNT(*)::INTEGER FROM productos),
            (SELECT COUNT(*)::INTEGER FROM productos),
            (SELECT COUNT(*)::INTEGER FROM codigos_secundarios),
            (SELECT COUNT(*)::INTEGER FROM codigos_secundarios),
            (SELECT COUNT(*)::INTEGER FROM claves_descuento),
            (SELECT COUNT(*)::INTEGER FROM claves_descuento),
            (
                (SELECT COUNT(*)::INTEGER FROM productos)
                + (SELECT COUNT(*)::INTEGER FROM codigos_secundarios)
                + (SELECT COUNT(*)::INTEGER FROM claves_descuento)
            );
        RETURN;
    END IF;

    SELECT
        COUNT(*) FILTER (WHERE fecha_actualizacion > v_fecha_version AND fecha_creacion <= v_fecha_version)::INTEGER,
        COUNT(*) FILTER (WHERE fecha_creacion > v_fecha_version)::INTEGER
    INTO v_productos_mod, v_productos_nuevos
    FROM productos
    WHERE fecha_actualizacion > v_fecha_version OR fecha_creacion > v_fecha_version;

    SELECT
        COUNT(*) FILTER (WHERE fecha_actualizacion > v_fecha_version AND fecha_creacion <= v_fecha_version)::INTEGER,
        COUNT(*) FILTER (WHERE fecha_creacion > v_fecha_version)::INTEGER
    INTO v_codigos_mod, v_codigos_nuevos
    FROM codigos_secundarios
    WHERE fecha_actualizacion > v_fecha_version OR fecha_creacion > v_fecha_version;

    SELECT
        COUNT(*) FILTER (WHERE fecha_actualizacion > v_fecha_version AND fecha_creacion <= v_fecha_version)::INTEGER,
        COUNT(*) FILTER (WHERE fecha_creacion > v_fecha_version)::INTEGER
    INTO v_claves_mod, v_claves_nuevas
    FROM claves_descuento
    WHERE fecha_actualizacion > v_fecha_version OR fecha_creacion > v_fecha_version;

    RETURN QUERY
    SELECT
        COALESCE(v_productos_mod, 0),
        COALESCE(v_productos_nuevos, 0),
        COALESCE(v_codigos_mod, 0),
        COALESCE(v_codigos_nuevos, 0),
        COALESCE(v_claves_mod, 0),
        COALESCE(v_claves_nuevas, 0),
        (
            COALESCE(v_productos_mod, 0) + COALESCE(v_productos_nuevos, 0)
            + COALESCE(v_codigos_mod, 0) + COALESCE(v_codigos_nuevos, 0)
            + COALESCE(v_claves_mod, 0) + COALESCE(v_claves_nuevas, 0)
        );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION obtener_estadisticas_cambios IS
'Conteos separados: productos, codigos secundarios, claves_descuento. Con version: total_cambios = suma de los seis contadores. Sin version (primera sync): mismos duplicados por dominio que la migracion incremental base; total_cambios = filas productos + codigos_secundarios + claves_descuento.';

-- -----------------------------------------------------------------------------
-- 11. Claves descuento incrementales por misma ancla version_control
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION obtener_claves_descuento_modificadas(
    p_version_hash_local TEXT
)
RETURNS TABLE (
    clave TEXT,
    tarifas JSONB,
    fecha_actualizacion TIMESTAMP WITH TIME ZONE,
    accion TEXT
) AS $$
DECLARE
    v_fecha_version TIMESTAMP WITH TIME ZONE;
BEGIN
    SELECT vc.fecha_actualizacion INTO v_fecha_version
    FROM version_control vc
    WHERE vc.version_hash = p_version_hash_local
    ORDER BY vc.id DESC
    LIMIT 1;

    IF v_fecha_version IS NULL THEN
        RETURN QUERY
        SELECT
            c.clave::TEXT,
            c.tarifas,
            c.fecha_actualizacion,
            'INSERT'::TEXT
        FROM claves_descuento c
        ORDER BY c.clave;
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        c.clave::TEXT,
        c.tarifas,
        c.fecha_actualizacion,
        CASE
            WHEN c.fecha_creacion > v_fecha_version THEN 'INSERT'::TEXT
            ELSE 'UPDATE'::TEXT
        END
    FROM claves_descuento c
    WHERE c.fecha_actualizacion > v_fecha_version
       OR c.fecha_creacion > v_fecha_version
    ORDER BY c.clave;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- 12. verificar_login_usuario + columna tarifa (usuarios.tarifa)
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS verificar_login_usuario(text, text);

CREATE OR REPLACE FUNCTION verificar_login_usuario(
    p_codigo_usuario TEXT,
    p_password_hash TEXT
)
RETURNS TABLE (
    success BOOLEAN,
    user_id INTEGER,
    user_name TEXT,
    grupo_cliente INTEGER,
    almacen_habitual TEXT,
    message TEXT,
    es_operario BOOLEAN,
    nombre_operario TEXT,
    codigo_usuario_titular TEXT,
    nombre_titular TEXT,
    tipo TEXT,
    almacen_tienda TEXT,
    tarifa TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_user RECORD;
    v_operario RECORD;
    v_almacen_tienda TEXT;
    v_codigo_titular TEXT;
    v_codigo_op TEXT;
BEGIN
    IF position('-' in trim(p_codigo_usuario)) = 0 THEN
        SELECT * INTO v_user
        FROM usuarios
        WHERE codigo_usuario = trim(p_codigo_usuario)
          AND password_hash = p_password_hash
          AND activo = TRUE;

        IF v_user IS NULL THEN
            RETURN QUERY SELECT
                FALSE,
                NULL::INTEGER,
                NULL::TEXT,
                NULL::INTEGER,
                NULL::TEXT,
                'Usuario o contrasena incorrectos'::TEXT,
                FALSE,
                NULL::TEXT,
                NULL::TEXT,
                NULL::TEXT,
                NULL::TEXT,
                NULL::TEXT,
                NULL::TEXT;
            RETURN;
        END IF;

        UPDATE usuarios SET ultimo_acceso = NOW() WHERE id = v_user.id;

        IF COALESCE(v_user.tipo, 'CLIENTE') = 'DEPENDIENTE' THEN
            SELECT ud.almacen_tienda
            INTO v_almacen_tienda
            FROM usuarios_dependientes ud
            WHERE ud.usuario_id = v_user.id
              AND ud.activo = TRUE
            LIMIT 1;
        END IF;

        RETURN QUERY SELECT
            TRUE,
            v_user.id,
            v_user.nombre,
            v_user.grupo_cliente,
            v_user.almacen_habitual,
            'Login exitoso'::TEXT,
            FALSE,
            NULL::TEXT,
            v_user.codigo_usuario,
            v_user.nombre,
            COALESCE(v_user.tipo, 'CLIENTE')::TEXT,
            CASE
                WHEN COALESCE(v_user.tipo, 'CLIENTE') = 'DEPENDIENTE' THEN v_almacen_tienda::TEXT
                ELSE NULL::TEXT
            END,
            v_user.tarifa::TEXT;
        RETURN;
    END IF;

    v_codigo_titular := trim(split_part(trim(p_codigo_usuario), '-', 1));
    v_codigo_op := trim(split_part(trim(p_codigo_usuario), '-', 2));

    IF v_codigo_titular = '' OR v_codigo_op = '' THEN
        RETURN QUERY SELECT
            FALSE,
            NULL::INTEGER,
            NULL::TEXT,
            NULL::INTEGER,
            NULL::TEXT,
            'Usuario o contrasena incorrectos'::TEXT,
            FALSE,
            NULL::TEXT,
            NULL::TEXT,
            NULL::TEXT,
            NULL::TEXT,
            NULL::TEXT,
            NULL::TEXT;
        RETURN;
    END IF;

    SELECT * INTO v_user
    FROM usuarios
    WHERE codigo_usuario = v_codigo_titular AND activo = TRUE;

    IF v_user IS NULL THEN
        RETURN QUERY SELECT
            FALSE,
            NULL::INTEGER,
            NULL::TEXT,
            NULL::INTEGER,
            NULL::TEXT,
            'Usuario o contrasena incorrectos'::TEXT,
            FALSE,
            NULL::TEXT,
            NULL::TEXT,
            NULL::TEXT,
            NULL::TEXT,
            NULL::TEXT,
            NULL::TEXT;
        RETURN;
    END IF;

    SELECT * INTO v_operario
    FROM usuarios_operarios
    WHERE usuario_id = v_user.id
      AND codigo_operario = v_codigo_op
      AND activo = TRUE
      AND password_hash = p_password_hash;

    IF v_operario IS NULL THEN
        RETURN QUERY SELECT
            FALSE,
            NULL::INTEGER,
            NULL::TEXT,
            NULL::INTEGER,
            NULL::TEXT,
            'Usuario o contrasena incorrectos'::TEXT,
            FALSE,
            NULL::TEXT,
            NULL::TEXT,
            NULL::TEXT,
            NULL::TEXT,
            NULL::TEXT,
            NULL::TEXT;
        RETURN;
    END IF;

    RETURN QUERY SELECT
        TRUE,
        v_user.id,
        (v_operario.nombre_operario || ' (operario)')::TEXT,
        v_user.grupo_cliente,
        v_user.almacen_habitual,
        'Login exitoso'::TEXT,
        TRUE,
        v_operario.nombre_operario,
        v_user.codigo_usuario,
        v_user.nombre,
        'CLIENTE'::TEXT,
        NULL::TEXT,
        v_user.tarifa::TEXT;
END;
$$;

COMMENT ON FUNCTION verificar_login_usuario IS
'Login titular/operario/dependiente/comercial. Devuelve tarifa del titular (dto por clave).';

-- -----------------------------------------------------------------------------
-- 13. RPCs selector clientes: incluir tarifa para precios con clave descuento
-- -----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS get_clientes_dependiente(INTEGER);

CREATE OR REPLACE FUNCTION get_clientes_dependiente(p_dependiente_user_id INTEGER)
RETURNS TABLE (
    id INTEGER,
    nombre TEXT,
    codigo_usuario TEXT,
    almacen_habitual TEXT,
    grupo_cliente INTEGER,
    alias TEXT,
    poblacion TEXT,
    tarifa TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT
        u.id,
        u.nombre,
        u.codigo_usuario,
        u.almacen_habitual,
        u.grupo_cliente,
        u.alias,
        u.poblacion,
        u.tarifa
    FROM usuarios_dependientes ud
    JOIN usuarios u ON u.almacen_habitual = ud.almacen_tienda
    WHERE ud.usuario_id = p_dependiente_user_id
      AND ud.activo = TRUE
      AND (u.activo IS NULL OR u.activo = TRUE)
      AND COALESCE(u.tipo, 'CLIENTE') IN ('CLIENTE', 'ADMINISTRADOR')
    ORDER BY u.nombre;
$$;

DROP FUNCTION IF EXISTS get_clientes_dependiente_por_frecuencia(INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION get_clientes_dependiente_por_frecuencia(
    p_dependiente_user_id INTEGER,
    p_limit INTEGER DEFAULT 200
)
RETURNS TABLE (
    id INTEGER,
    nombre TEXT,
    codigo_usuario TEXT,
    almacen_habitual TEXT,
    grupo_cliente INTEGER,
    alias TEXT,
    poblacion TEXT,
    tarifa TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT
        u.id,
        u.nombre,
        u.codigo_usuario,
        u.almacen_habitual,
        u.grupo_cliente,
        u.alias,
        u.poblacion,
        u.tarifa
    FROM usuarios_dependientes ud
    JOIN usuarios u ON u.almacen_habitual = ud.almacen_tienda
    LEFT JOIN dependiente_cliente_uso dcu ON dcu.dependiente_user_id = ud.usuario_id AND dcu.cliente_user_id = u.id
    WHERE ud.usuario_id = p_dependiente_user_id
      AND ud.activo = TRUE
      AND (u.activo IS NULL OR u.activo = TRUE)
      AND COALESCE(u.tipo, 'CLIENTE') IN ('CLIENTE', 'ADMINISTRADOR')
    ORDER BY
        COALESCE(dcu.veces_representado, 0) DESC,
        dcu.ultima_representacion DESC NULLS LAST,
        u.nombre
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 500));
$$;

DROP FUNCTION IF EXISTS buscar_clientes_dependiente(INTEGER, TEXT, INTEGER);

CREATE OR REPLACE FUNCTION buscar_clientes_dependiente(
    p_dependiente_user_id INTEGER,
    p_query TEXT,
    p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
    id INTEGER,
    nombre TEXT,
    codigo_usuario TEXT,
    almacen_habitual TEXT,
    grupo_cliente INTEGER,
    alias TEXT,
    poblacion TEXT,
    tarifa TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    WITH base AS (
        SELECT
            u.id,
            u.nombre,
            u.codigo_usuario,
            u.almacen_habitual,
            u.grupo_cliente,
            u.alias,
            u.poblacion,
            u.tarifa,
            COALESCE(dcu.veces_representado, 0) AS veces,
            dcu.ultima_representacion AS ultima
        FROM usuarios u
        JOIN usuarios_dependientes ud ON ud.usuario_id = p_dependiente_user_id
        LEFT JOIN dependiente_cliente_uso dcu ON dcu.dependiente_user_id = p_dependiente_user_id AND dcu.cliente_user_id = u.id
        WHERE ud.activo = TRUE
          AND (u.activo IS NULL OR u.activo = TRUE)
          AND COALESCE(u.tipo, 'CLIENTE') IN ('CLIENTE', 'ADMINISTRADOR')
          AND (
              NOT EXISTS (
                  SELECT 1
                  FROM unnest(regexp_split_to_array(trim(COALESCE(p_query, '')), '\s+')) AS w
                  WHERE length(trim(w)) > 0
              )
              OR (
                  SELECT bool_and(
                      u.nombre ILIKE '%' || trim(w) || '%'
                      OR u.codigo_usuario ILIKE '%' || trim(w) || '%'
                      OR COALESCE(u.alias, '') ILIKE '%' || trim(w) || '%'
                      OR COALESCE(u.poblacion, '') ILIKE '%' || trim(w) || '%'
                  )
                  FROM unnest(regexp_split_to_array(trim(COALESCE(p_query, '')), '\s+')) AS w
                  WHERE length(trim(w)) > 0
              ) = true
          )
    )
    SELECT b.id, b.nombre, b.codigo_usuario, b.almacen_habitual, b.grupo_cliente, b.alias, b.poblacion, b.tarifa
    FROM base b
    ORDER BY b.veces DESC, b.ultima DESC NULLS LAST, b.nombre
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 200));
$$;

DROP FUNCTION IF EXISTS get_clientes_asignados_comercial(INTEGER);

CREATE OR REPLACE FUNCTION get_clientes_asignados_comercial(p_comercial_numero INTEGER)
RETURNS TABLE (
    id INTEGER,
    nombre TEXT,
    codigo_usuario TEXT,
    almacen_habitual TEXT,
    grupo_cliente INTEGER,
    alias TEXT,
    poblacion TEXT,
    tarifa TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT
        u.id,
        u.nombre,
        u.codigo_usuario,
        u.almacen_habitual,
        u.grupo_cliente,
        u.alias,
        u.poblacion,
        u.tarifa
    FROM usuarios u
    WHERE u.comercial_asignado = p_comercial_numero
      AND (u.activo IS NULL OR u.activo = TRUE)
    ORDER BY u.nombre;
$$;

-- -----------------------------------------------------------------------------
-- Lectura catalogo: familias y familias_asignadas (navegacion Inicio + filtro busqueda)
-- -----------------------------------------------------------------------------
ALTER TABLE familias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS familias_select_catalogo ON familias;
CREATE POLICY familias_select_catalogo ON familias
    FOR SELECT
    USING (true);

ALTER TABLE familias_asignadas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS familias_asignadas_select_catalogo ON familias_asignadas;
CREATE POLICY familias_asignadas_select_catalogo ON familias_asignadas
    FOR SELECT
    USING (true);

GRANT SELECT ON familias TO anon, authenticated, service_role;
GRANT SELECT ON familias_asignadas TO anon, authenticated, service_role;
