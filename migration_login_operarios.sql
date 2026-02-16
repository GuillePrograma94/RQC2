-- Migracion: Login con codigo compuesto para operarios (1001-01)
-- Ejecutar en el SQL Editor de Supabase DESPUES de migration_perfil_operarios.sql
-- Permite que un operario entre con codigo titular-operario (ej: 1001-01) y su contrasena.
-- La respuesta es la misma que para el titular (user_id del titular, codigo_cliente, etc.)
-- y se anaden es_operario y nombre_operario para la app.

DROP FUNCTION IF EXISTS verificar_login_usuario(text, text);

CREATE OR REPLACE FUNCTION verificar_login_usuario(
    p_codigo_usuario TEXT,
    p_password_hash TEXT
)
RETURNS TABLE (
    success BOOLEAN,
    user_id INTEGER,
    user_name TEXT,
    codigo_cliente INTEGER,
    almacen_habitual TEXT,
    message TEXT,
    es_operario BOOLEAN,
    nombre_operario TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_user RECORD;
    v_operario RECORD;
    v_codigo_titular TEXT;
    v_codigo_op TEXT;
BEGIN
    -- Caso 1: Codigo SIN guion -> login como titular (usuario normal)
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
                NULL::TEXT;
            RETURN;
        END IF;

        UPDATE usuarios SET ultimo_acceso = NOW() WHERE id = v_user.id;

        RETURN QUERY SELECT
            TRUE,
            v_user.id,
            v_user.nombre,
            v_user.codigo_cliente,
            v_user.almacen_habitual,
            'Login exitoso'::TEXT,
            FALSE,
            NULL::TEXT;
        RETURN;
    END IF;

    -- Caso 2: Codigo con guion (ej: 1001-01) -> login como operario
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
            NULL::TEXT;
        RETURN;
    END IF;

    -- Obtener titular por codigo
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
            NULL::TEXT;
        RETURN;
    END IF;

    -- Obtener operario de ese titular y validar contrasena
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
            NULL::TEXT;
        RETURN;
    END IF;

    -- Exito: devolver datos del TITULAR para que la app funcione igual (mismo user_id, codigo_cliente, etc.)
    -- user_name para mostrar: "Maria (operario)"
    RETURN QUERY SELECT
        TRUE,
        v_user.id,
        (v_operario.nombre_operario || ' (operario)')::TEXT,
        v_user.codigo_cliente,
        v_user.almacen_habitual,
        'Login exitoso'::TEXT,
        TRUE,
        v_operario.nombre_operario;
END;
$$;

COMMENT ON FUNCTION verificar_login_usuario IS 'Login titular (codigo) u operario (codigo-operario). Devuelve es_operario y nombre_operario para la app.';
