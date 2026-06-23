-- Fix: detectar cambios en claves_descuento (y otros dominios) aunque version_control no cambie.
-- Caso: panel admin actualiza tarifas en claves_descuento -> fecha_actualizacion sube,
-- pero version_hash_local del cliente sigue igual y la app abortaba la sync.
--
-- Ejecutar en Supabase SQL Editor despues de migration_sincronizacion_incremental.sql.

DROP FUNCTION IF EXISTS obtener_manifest_sync_cliente(TEXT);
CREATE OR REPLACE FUNCTION obtener_manifest_sync_cliente(
    p_version_hash_local TEXT DEFAULT NULL
)
RETURNS TABLE (
    version_hash_remota TEXT,
    version_fecha_remota TIMESTAMP WITH TIME ZONE,
    version_hash_local TEXT,
    version_local_encontrada BOOLEAN,
    hay_actualizacion BOOLEAN,
    productos_cambios INTEGER,
    codigos_cambios INTEGER,
    claves_descuento_cambios INTEGER,
    familias_total INTEGER,
    familias_asignadas_total INTEGER,
    stock_hash TEXT,
    server_timestamp TIMESTAMP WITH TIME ZONE
) AS $$
DECLARE
    v_hash_remota TEXT;
    v_fecha_remota TIMESTAMP WITH TIME ZONE;
    v_local_encontrada BOOLEAN := FALSE;
    v_hay_actualizacion BOOLEAN := TRUE;
    v_prod_changes INTEGER := 0;
    v_cod_changes INTEGER := 0;
    v_clave_changes INTEGER := 0;
    v_familias_total INTEGER := 0;
    v_familias_asignadas_total INTEGER := 0;
    v_stock_hash TEXT := NULL;
BEGIN
    SELECT vc.version_hash, vc.fecha_actualizacion
    INTO v_hash_remota, v_fecha_remota
    FROM version_control vc
    ORDER BY vc.id DESC
    LIMIT 1;

    IF p_version_hash_local IS NOT NULL AND p_version_hash_local <> '' THEN
        SELECT EXISTS(
            SELECT 1 FROM version_control vc WHERE vc.version_hash = p_version_hash_local
        ) INTO v_local_encontrada;
    END IF;

    IF p_version_hash_local IS NOT NULL AND p_version_hash_local <> '' THEN
        v_hay_actualizacion := COALESCE(v_hash_remota, '') <> p_version_hash_local;
    ELSIF v_hash_remota IS NULL THEN
        v_hay_actualizacion := FALSE;
    ELSE
        v_hay_actualizacion := TRUE;
    END IF;

    IF p_version_hash_local IS NOT NULL AND p_version_hash_local <> '' AND v_local_encontrada THEN
        SELECT
            COALESCE((row_to_json(est)->>'productos_modificados')::INTEGER, 0)
                + COALESCE((row_to_json(est)->>'productos_nuevos')::INTEGER, 0),
            COALESCE((row_to_json(est)->>'codigos_modificados')::INTEGER, 0)
                + COALESCE((row_to_json(est)->>'codigos_nuevos')::INTEGER, 0),
            COALESCE((row_to_json(est)->>'claves_descuento_modificadas')::INTEGER, 0)
                + COALESCE((row_to_json(est)->>'claves_descuento_nuevas')::INTEGER, 0)
        INTO v_prod_changes, v_cod_changes, v_clave_changes
        FROM obtener_estadisticas_cambios(p_version_hash_local) est
        LIMIT 1;
    ELSE
        SELECT COUNT(*)::INTEGER INTO v_prod_changes FROM productos;
        SELECT COUNT(*)::INTEGER INTO v_cod_changes FROM codigos_secundarios;
        IF to_regclass('public.claves_descuento') IS NOT NULL THEN
            SELECT COUNT(*)::INTEGER INTO v_clave_changes FROM claves_descuento;
        ELSE
            v_clave_changes := 0;
        END IF;
    END IF;

    IF to_regclass('public.familias') IS NOT NULL THEN
        SELECT COUNT(*)::INTEGER INTO v_familias_total FROM familias;
    END IF;

    IF to_regclass('public.familias_asignadas') IS NOT NULL THEN
        SELECT COUNT(*)::INTEGER INTO v_familias_asignadas_total FROM familias_asignadas;
    END IF;

    IF to_regclass('public.stock_meta') IS NOT NULL THEN
        SELECT sm.hash INTO v_stock_hash FROM stock_meta sm WHERE sm.id = 1;
    END IF;

    IF NOT v_hay_actualizacion
       AND p_version_hash_local IS NOT NULL
       AND p_version_hash_local <> ''
       AND v_local_encontrada
       AND (
           COALESCE(v_prod_changes, 0) > 0
           OR COALESCE(v_cod_changes, 0) > 0
           OR COALESCE(v_clave_changes, 0) > 0
       ) THEN
        v_hay_actualizacion := TRUE;
    END IF;

    RETURN QUERY
    SELECT
        v_hash_remota,
        v_fecha_remota,
        p_version_hash_local,
        v_local_encontrada,
        v_hay_actualizacion,
        COALESCE(v_prod_changes, 0),
        COALESCE(v_cod_changes, 0),
        COALESCE(v_clave_changes, 0),
        COALESCE(v_familias_total, 0),
        COALESCE(v_familias_asignadas_total, 0),
        v_stock_hash,
        NOW();
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION obtener_manifest_sync_cliente(TEXT) TO anon, authenticated, service_role;

COMMENT ON FUNCTION obtener_manifest_sync_cliente IS
'Manifest de sync cliente. hay_actualizacion=true si cambia version_control O hay cambios incrementales en productos/codigos/claves_descuento desde la version local.';
