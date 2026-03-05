-- Migracion: Rol DEPENDIENTE para atencion de clientes desde tienda
-- Fecha: 2026-03-05
-- Objetivo:
-- 1) Ampliar usuarios.tipo para incluir DEPENDIENTE
-- 2) Crear tabla usuarios_dependientes para definir el ambito por tienda
-- 3) Extender verificar_login_usuario para devolver tipo y almacen_tienda
-- 4) Crear RPCs para selector de clientes y Mis pedidos de dependiente

-- ============================================
-- 1. AMPLIAR TIPO EN USUARIOS
-- ============================================
ALTER TABLE usuarios
ADD COLUMN IF NOT EXISTS tipo TEXT DEFAULT 'CLIENTE';

UPDATE usuarios SET tipo = 'CLIENTE' WHERE tipo IS NULL;

ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_tipo_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_tipo_check
    CHECK (tipo IN ('CLIENTE', 'COMERCIAL', 'DEPENDIENTE', 'ADMINISTRADOR'));

COMMENT ON COLUMN usuarios.tipo IS 'CLIENTE = cliente/empresa; COMERCIAL = usuario comercial; DEPENDIENTE = personal de tienda; ADMINISTRADOR = panel avanzado.';

CREATE INDEX IF NOT EXISTS idx_usuarios_tipo ON usuarios(tipo);

-- ============================================
-- 2. TABLA DE DEPENDIENTES
-- ============================================
CREATE TABLE IF NOT EXISTS usuarios_dependientes (
    id BIGSERIAL PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    almacen_tienda TEXT NOT NULL CHECK (almacen_tienda IN ('ALZIRA', 'GANDIA', 'ONTINYENT', 'REQUENA')),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT usuarios_dependientes_usuario_unique UNIQUE (usuario_id)
);

COMMENT ON TABLE usuarios_dependientes IS 'Ambito de operacion de usuarios con tipo DEPENDIENTE.';
COMMENT ON COLUMN usuarios_dependientes.usuario_id IS 'FK a usuarios.id del dependiente.';
COMMENT ON COLUMN usuarios_dependientes.almacen_tienda IS 'Tienda/almacen desde el que el dependiente atiende clientes.';

CREATE INDEX IF NOT EXISTS idx_usuarios_dependientes_usuario_id ON usuarios_dependientes(usuario_id);
CREATE INDEX IF NOT EXISTS idx_usuarios_dependientes_almacen_tienda ON usuarios_dependientes(almacen_tienda) WHERE activo = TRUE;

-- ============================================
-- 3. LOGIN CON TIPO + ALMACEN_TIENDA
-- ============================================
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
    almacen_tienda TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_user RECORD;
    v_operario RECORD;
    v_dependiente RECORD;
    v_codigo_titular TEXT;
    v_codigo_op TEXT;
BEGIN
    -- Caso 1: Codigo SIN guion -> login como titular/comercial/dependiente
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
                NULL::TEXT;
            RETURN;
        END IF;

        UPDATE usuarios SET ultimo_acceso = NOW() WHERE id = v_user.id;

        IF COALESCE(v_user.tipo, 'CLIENTE') = 'DEPENDIENTE' THEN
            SELECT *
            INTO v_dependiente
            FROM usuarios_dependientes
            WHERE usuario_id = v_user.id
              AND activo = TRUE
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
                WHEN COALESCE(v_user.tipo, 'CLIENTE') = 'DEPENDIENTE' THEN v_dependiente.almacen_tienda::TEXT
                ELSE NULL::TEXT
            END;
        RETURN;
    END IF;

    -- Caso 2: Codigo con guion (ej: 1001-01) -> login como operario (siempre tipo CLIENTE)
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
        NULL::TEXT;
END;
$$;

COMMENT ON FUNCTION verificar_login_usuario IS 'Login titular, operario, comercial o dependiente. Devuelve tipo y, para DEPENDIENTE, almacen_tienda.';

-- ============================================
-- 4. RPCs PARA DEPENDIENTE
-- ============================================
DROP FUNCTION IF EXISTS get_clientes_dependiente(INTEGER);

CREATE OR REPLACE FUNCTION get_clientes_dependiente(p_dependiente_user_id INTEGER)
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
    WHERE ud.usuario_id = p_dependiente_user_id
      AND ud.activo = TRUE
      AND (u.activo IS NULL OR u.activo = TRUE)
      AND COALESCE(u.tipo, 'CLIENTE') IN ('CLIENTE', 'ADMINISTRADOR')
    ORDER BY u.nombre;
$$;

COMMENT ON FUNCTION get_clientes_dependiente(INTEGER) IS
'Devuelve los clientes del almacen_tienda del dependiente para selector de representacion en scan_client_mobile.';

DROP FUNCTION IF EXISTS get_pedidos_dependiente(INTEGER);

CREATE OR REPLACE FUNCTION get_pedidos_dependiente(p_dependiente_user_id INTEGER)
RETURNS TABLE (
    id                      INTEGER,
    usuario_id              INTEGER,
    codigo_qr               TEXT,
    tipo_pedido             TEXT,
    estado                  TEXT,
    estado_procesamiento    TEXT,
    almacen_destino         TEXT,
    fecha_creacion          TIMESTAMPTZ,
    total_productos         INTEGER,
    total_importe           NUMERIC,
    observaciones           TEXT,
    nombre_operario         TEXT,
    pedido_erp              TEXT,
    codigo_cliente_usuario  TEXT,
    cliente_nombre          TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT
        cc.id,
        cc.usuario_id,
        cc.codigo_qr,
        cc.tipo_pedido,
        cc.estado,
        cc.estado_procesamiento,
        cc.almacen_destino,
        cc.fecha_creacion,
        cc.total_productos,
        cc.total_importe,
        cc.observaciones,
        cc.nombre_operario,
        cc.pedido_erp,
        cc.codigo_cliente_usuario,
        u.nombre AS cliente_nombre
    FROM usuarios_dependientes ud
    JOIN usuarios u ON u.almacen_habitual = ud.almacen_tienda
    JOIN carritos_clientes cc ON cc.usuario_id = u.id
    WHERE ud.usuario_id = p_dependiente_user_id
      AND ud.activo = TRUE
      AND (u.activo IS NULL OR u.activo = TRUE)
      AND COALESCE(u.tipo, 'CLIENTE') IN ('CLIENTE', 'ADMINISTRADOR')
      AND cc.estado_procesamiento IN ('procesando', 'completado', 'pendiente_erp')
    ORDER BY
        CASE WHEN cc.estado_procesamiento = 'completado' THEN 1 ELSE 0 END ASC,
        cc.fecha_creacion DESC
    LIMIT 300;
$$;

COMMENT ON FUNCTION get_pedidos_dependiente(INTEGER) IS
'Devuelve pedidos de clientes del almacen del dependiente para la vista Mis pedidos en scan_client_mobile.';
