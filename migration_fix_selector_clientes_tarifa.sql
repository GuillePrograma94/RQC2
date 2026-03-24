-- =============================================================================
-- Fix final RPC signatures for selector de clientes (Scan Client Mobile)
-- Ensure tarifa is returned for represented client pricing rules.
-- =============================================================================

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

GRANT EXECUTE ON FUNCTION get_clientes_dependiente(INTEGER) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_clientes_dependiente_por_frecuencia(INTEGER, INTEGER) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION buscar_clientes_dependiente(INTEGER, TEXT, INTEGER) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_clientes_asignados_comercial(INTEGER) TO anon, authenticated, service_role;
