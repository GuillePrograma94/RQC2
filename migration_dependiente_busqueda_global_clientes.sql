-- Migracion: Busqueda global de clientes para dependientes
-- Fecha: 2026-03-20
-- Objetivo:
-- Permitir que un dependiente busque clientes de cualquier almacen, no solo de su tienda.

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
    poblacion TEXT
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
    SELECT b.id, b.nombre, b.codigo_usuario, b.almacen_habitual, b.grupo_cliente, b.alias, b.poblacion
    FROM base b
    ORDER BY b.veces DESC, b.ultima DESC NULLS LAST, b.nombre
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 200));
$$;

COMMENT ON FUNCTION buscar_clientes_dependiente(INTEGER, TEXT, INTEGER) IS
'Busca clientes globales para dependiente: cada palabra del query debe coincidir en nombre, codigo, alias o poblacion. Orden: frecuencia luego nombre.';
