-- Busqueda de catalogo para modo hibrido durante sincronizacion local.
-- Cobertura: codigo, descripcion y sinonimos, insensible a acentos y mayusculas.

CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION buscar_productos_catalogo_hibrido(
    p_code TEXT DEFAULT NULL,
    p_description TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 200
)
RETURNS SETOF productos
LANGUAGE sql
STABLE
AS $$
    WITH params AS (
        SELECT
            COALESCE(NULLIF(TRIM(p_code), ''), '') AS code_term,
            ARRAY_REMOVE(
                regexp_split_to_array(
                    unaccent(lower(COALESCE(TRIM(p_description), ''))),
                    '\s+'
                ),
                ''
            ) AS desc_terms,
            GREATEST(1, LEAST(COALESCE(p_limit, 200), 500)) AS max_rows
    )
    SELECT p.*
    FROM productos p
    CROSS JOIN params prm
    WHERE
        (prm.code_term = '' OR p.codigo ILIKE '%' || prm.code_term || '%')
        AND (
            COALESCE(array_length(prm.desc_terms, 1), 0) = 0
            OR NOT EXISTS (
                SELECT 1
                FROM unnest(prm.desc_terms) AS t(term)
                WHERE term <> ''
                  AND NOT (
                      unaccent(lower(COALESCE(p.descripcion, ''))) LIKE '%' || t.term || '%'
                      OR unaccent(lower(COALESCE(p.sinonimos, ''))) LIKE '%' || t.term || '%'
                  )
            )
        )
    ORDER BY p.codigo ASC
    LIMIT (SELECT max_rows FROM params);
$$;

COMMENT ON FUNCTION buscar_productos_catalogo_hibrido(TEXT, TEXT, INTEGER) IS
'Busqueda de catalogo para modo hibrido. Coincide por codigo parcial y por todas las palabras de descripcion sobre descripcion/sinonimos, insensible a acentos y mayusculas.';

GRANT EXECUTE ON FUNCTION buscar_productos_catalogo_hibrido(TEXT, TEXT, INTEGER) TO anon, authenticated, service_role;
