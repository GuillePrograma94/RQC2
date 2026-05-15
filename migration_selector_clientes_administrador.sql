-- Migracion: Selector de clientes para administrador de tienda (ADMINISTRADOR)
-- Fecha: 2026-05-15
-- Objetivo:
-- 1) Tabla administrador_cliente_uso (ranking por admin)
-- 2) RPC get_clientes_administrador_por_frecuencia
-- 3) RPC buscar_clientes_administrador
-- 4) RPC registrar_representacion_administrador
-- Solo usuarios con JWT app_metadata.es_administrador = true.

-- ============================================
-- 1. TABLA DE USO POR ADMINISTRADOR
-- ============================================
CREATE TABLE IF NOT EXISTS administrador_cliente_uso (
    administrador_user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    cliente_user_id       INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    veces_representado    INTEGER NOT NULL DEFAULT 0,
    ultima_representacion TIMESTAMPTZ,
    PRIMARY KEY (administrador_user_id, cliente_user_id)
);

COMMENT ON TABLE administrador_cliente_uso IS 'Contador de veces que cada administrador ha representado a cada cliente.';
COMMENT ON COLUMN administrador_cliente_uso.veces_representado IS 'Numero de veces que el administrador ha elegido representar a este cliente.';
COMMENT ON COLUMN administrador_cliente_uso.ultima_representacion IS 'Ultima vez que el administrador represento a este cliente.';

CREATE INDEX IF NOT EXISTS idx_administrador_cliente_uso_admin ON administrador_cliente_uso(administrador_user_id);
CREATE INDEX IF NOT EXISTS idx_administrador_cliente_uso_ultima ON administrador_cliente_uso(administrador_user_id, ultima_representacion DESC NULLS LAST);

ALTER TABLE administrador_cliente_uso ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS administrador_cliente_uso_select ON administrador_cliente_uso;
DROP POLICY IF EXISTS administrador_cliente_uso_insert ON administrador_cliente_uso;
DROP POLICY IF EXISTS administrador_cliente_uso_update ON administrador_cliente_uso;
CREATE POLICY administrador_cliente_uso_select ON administrador_cliente_uso FOR SELECT USING (true);
CREATE POLICY administrador_cliente_uso_insert ON administrador_cliente_uso FOR INSERT WITH CHECK (true);
CREATE POLICY administrador_cliente_uso_update ON administrador_cliente_uso FOR UPDATE USING (true);

-- ============================================
-- 2. RPC: CLIENTES POR FRECUENCIA (lista inicial)
-- ============================================
DROP FUNCTION IF EXISTS get_clientes_administrador_por_frecuencia(INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION get_clientes_administrador_por_frecuencia(
    p_administrador_user_id INTEGER,
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
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
BEGIN
    IF COALESCE(((auth.jwt() -> 'app_metadata') ->> 'es_administrador')::boolean, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'No autorizado';
    END IF;

    IF NULLIF((auth.jwt() -> 'app_metadata' ->> 'usuario_id'), '')::INTEGER IS NOT NULL
       AND NULLIF((auth.jwt() -> 'app_metadata' ->> 'usuario_id'), '')::INTEGER <> p_administrador_user_id THEN
        RAISE EXCEPTION 'No autorizado';
    END IF;

    RETURN QUERY
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
    LEFT JOIN administrador_cliente_uso acu
        ON acu.administrador_user_id = p_administrador_user_id
       AND acu.cliente_user_id = u.id
    WHERE (u.activo IS NULL OR u.activo = TRUE)
      AND COALESCE(u.tipo, 'CLIENTE') IN ('CLIENTE', 'ADMINISTRADOR')
    ORDER BY
        COALESCE(acu.veces_representado, 0) DESC,
        acu.ultima_representacion DESC NULLS LAST,
        u.nombre
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 500));
END;
$$;

COMMENT ON FUNCTION get_clientes_administrador_por_frecuencia(INTEGER, INTEGER) IS
'Clientes activos globales para administrador, ordenados por uso previo del admin. Requiere JWT es_administrador.';

-- ============================================
-- 3. RPC: BUSCAR CLIENTES POR TEXTO (global)
-- ============================================
DROP FUNCTION IF EXISTS buscar_clientes_administrador(INTEGER, TEXT, INTEGER);

CREATE OR REPLACE FUNCTION buscar_clientes_administrador(
    p_administrador_user_id INTEGER,
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
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
BEGIN
    IF COALESCE(((auth.jwt() -> 'app_metadata') ->> 'es_administrador')::boolean, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'No autorizado';
    END IF;

    IF NULLIF((auth.jwt() -> 'app_metadata' ->> 'usuario_id'), '')::INTEGER IS NOT NULL
       AND NULLIF((auth.jwt() -> 'app_metadata' ->> 'usuario_id'), '')::INTEGER <> p_administrador_user_id THEN
        RAISE EXCEPTION 'No autorizado';
    END IF;

    RETURN QUERY
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
            COALESCE(acu.veces_representado, 0) AS veces,
            acu.ultima_representacion AS ultima
        FROM usuarios u
        LEFT JOIN administrador_cliente_uso acu
            ON acu.administrador_user_id = p_administrador_user_id
           AND acu.cliente_user_id = u.id
        WHERE (u.activo IS NULL OR u.activo = TRUE)
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
END;
$$;

COMMENT ON FUNCTION buscar_clientes_administrador(INTEGER, TEXT, INTEGER) IS
'Busca clientes globales para administrador: cada palabra del query debe coincidir en nombre, codigo, alias o poblacion.';

-- ============================================
-- 4. RPC: REGISTRAR REPRESENTACION (upsert uso)
-- ============================================
DROP FUNCTION IF EXISTS registrar_representacion_administrador(INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION registrar_representacion_administrador(
    p_administrador_user_id INTEGER,
    p_cliente_user_id INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF COALESCE(((auth.jwt() -> 'app_metadata') ->> 'es_administrador')::boolean, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'No autorizado';
    END IF;

    IF NULLIF((auth.jwt() -> 'app_metadata' ->> 'usuario_id'), '')::INTEGER IS NOT NULL
       AND NULLIF((auth.jwt() -> 'app_metadata' ->> 'usuario_id'), '')::INTEGER <> p_administrador_user_id THEN
        RAISE EXCEPTION 'No autorizado';
    END IF;

    INSERT INTO administrador_cliente_uso (administrador_user_id, cliente_user_id, veces_representado, ultima_representacion)
    VALUES (p_administrador_user_id, p_cliente_user_id, 1, NOW())
    ON CONFLICT (administrador_user_id, cliente_user_id)
    DO UPDATE SET
        veces_representado = administrador_cliente_uso.veces_representado + 1,
        ultima_representacion = NOW();
END;
$$;

COMMENT ON FUNCTION registrar_representacion_administrador(INTEGER, INTEGER) IS
'Incrementa el contador de uso cuando el administrador elige representar a un cliente.';

GRANT EXECUTE ON FUNCTION get_clientes_administrador_por_frecuencia(INTEGER, INTEGER) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION buscar_clientes_administrador(INTEGER, TEXT, INTEGER) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION registrar_representacion_administrador(INTEGER, INTEGER) TO anon, authenticated, service_role;
