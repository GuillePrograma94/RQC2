-- Migracion: Ranking de clientes por dependiente (selector hibrido local + busqueda)
-- Fecha: 2026-03-05
-- Objetivo:
-- 1) Tabla dependiente_cliente_uso para contador por par dependiente-cliente
-- 2) RPC get_clientes_dependiente_por_frecuencia: lista top N ordenada por uso
-- 3) RPC buscar_clientes_dependiente: busqueda por texto con mismo orden
-- 4) RPC registrar_representacion_dependiente: upsert al seleccionar cliente
-- Ver docs/SELECTOR_CLIENTES_DEPENDIENTE_HIBRIDO.md

-- ============================================
-- 1. TABLA DE USO POR DEPENDIENTE
-- ============================================
CREATE TABLE IF NOT EXISTS dependiente_cliente_uso (
    dependiente_user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    cliente_user_id     INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    veces_representado  INTEGER NOT NULL DEFAULT 0,
    ultima_representacion TIMESTAMPTZ,
    PRIMARY KEY (dependiente_user_id, cliente_user_id)
);

COMMENT ON TABLE dependiente_cliente_uso IS 'Contador de veces que cada dependiente ha representado a cada cliente. Ranking por usuario dependiente.';
COMMENT ON COLUMN dependiente_cliente_uso.veces_representado IS 'Numero de veces que el dependiente ha elegido representar a este cliente.';
COMMENT ON COLUMN dependiente_cliente_uso.ultima_representacion IS 'Ultima vez que el dependiente represento a este cliente.';

CREATE INDEX IF NOT EXISTS idx_dependiente_cliente_uso_dep ON dependiente_cliente_uso(dependiente_user_id);
CREATE INDEX IF NOT EXISTS idx_dependiente_cliente_uso_ultima ON dependiente_cliente_uso(dependiente_user_id, ultima_representacion DESC NULLS LAST);

ALTER TABLE dependiente_cliente_uso ENABLE ROW LEVEL SECURITY;

-- RLS: solo lectura via RPC SECURITY DEFINER; no exponer tabla directa a cliente si no aplica
CREATE POLICY dependiente_cliente_uso_select ON dependiente_cliente_uso FOR SELECT USING (true);
CREATE POLICY dependiente_cliente_uso_insert ON dependiente_cliente_uso FOR INSERT WITH CHECK (true);
CREATE POLICY dependiente_cliente_uso_update ON dependiente_cliente_uso FOR UPDATE USING (true);

-- ============================================
-- 2. RPC: CLIENTES POR FRECUENCIA (para lista local)
-- ============================================
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
    poblacion TEXT
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
        u.poblacion
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

COMMENT ON FUNCTION get_clientes_dependiente_por_frecuencia(INTEGER, INTEGER) IS
'Clientes del almacen del dependiente ordenados por uso (mas representados primero). Para lista local en selector.';

-- ============================================
-- 3. RPC: BUSCAR CLIENTES POR TEXTO
-- ============================================
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
        FROM usuarios_dependientes ud
        JOIN usuarios u ON u.almacen_habitual = ud.almacen_tienda
        LEFT JOIN dependiente_cliente_uso dcu ON dcu.dependiente_user_id = ud.usuario_id AND dcu.cliente_user_id = u.id
        WHERE ud.usuario_id = p_dependiente_user_id
          AND ud.activo = TRUE
          AND (u.activo IS NULL OR u.activo = TRUE)
          AND COALESCE(u.tipo, 'CLIENTE') IN ('CLIENTE', 'ADMINISTRADOR')
          AND (
              COALESCE(trim(p_query), '') = ''
              OR u.nombre ILIKE '%' || trim(p_query) || '%'
              OR u.codigo_usuario ILIKE '%' || trim(p_query) || '%'
              OR COALESCE(u.alias, '') ILIKE '%' || trim(p_query) || '%'
              OR COALESCE(u.poblacion, '') ILIKE '%' || trim(p_query) || '%'
          )
    )
    SELECT b.id, b.nombre, b.codigo_usuario, b.almacen_habitual, b.grupo_cliente, b.alias, b.poblacion
    FROM base b
    ORDER BY b.veces DESC, b.ultima DESC NULLS LAST, b.nombre
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 200));
$$;

COMMENT ON FUNCTION buscar_clientes_dependiente(INTEGER, TEXT, INTEGER) IS
'Busca clientes del dependiente por nombre/codigo/alias/poblacion. Orden: frecuencia luego nombre.';

-- ============================================
-- 4. RPC: REGISTRAR REPRESENTACION (upsert uso)
-- ============================================
DROP FUNCTION IF EXISTS registrar_representacion_dependiente(INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION registrar_representacion_dependiente(
    p_dependiente_user_id INTEGER,
    p_cliente_user_id INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO dependiente_cliente_uso (dependiente_user_id, cliente_user_id, veces_representado, ultima_representacion)
    VALUES (p_dependiente_user_id, p_cliente_user_id, 1, NOW())
    ON CONFLICT (dependiente_user_id, cliente_user_id)
    DO UPDATE SET
        veces_representado = dependiente_cliente_uso.veces_representado + 1,
        ultima_representacion = NOW();
END;
$$;

COMMENT ON FUNCTION registrar_representacion_dependiente(INTEGER, INTEGER) IS
'Incrementa el contador de uso cuando el dependiente elige representar a un cliente.';
