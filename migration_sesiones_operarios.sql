-- Migracion: Registro de sesiones para operarios (mismo log que titulares)
-- Ejecutar en el SQL Editor de Supabase DESPUES de migration_login_operarios.sql
--
-- Problema: crear_sesion_usuario(p_codigo_usuario) solo buscaba en usuarios.codigo_usuario.
-- Un operario entra con codigo "84845-12"; en usuarios solo existe "84845" (titular).
-- Resultado: la creacion de sesion fallaba y los operarios no quedaban registrados en sesiones_usuario.
--
-- Solucion: aceptar codigo con o sin guion. Si tiene guion (titular-operario), resolver
-- el usuario_id del titular y crear la sesion con ese id, guardando el codigo usado para auditoria.

-- 1. Columna opcional para auditoria: codigo con el que se inicio sesion (ej. 84845 o 84845-12)
ALTER TABLE sesiones_usuario
ADD COLUMN IF NOT EXISTS codigo_login TEXT;

COMMENT ON COLUMN sesiones_usuario.codigo_login IS
'Codigo usado al iniciar sesion (titular o titular-operario) para distinguir en el log quien entro.';

-- 2. Reemplazar crear_sesion_usuario para soportar codigo titular u operario
CREATE OR REPLACE FUNCTION crear_sesion_usuario(p_codigo_usuario TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_usuario_id INTEGER;
    v_sesion_id INTEGER;
    v_codigo_titular TEXT;
BEGIN
    v_codigo_titular := trim(p_codigo_usuario);

    -- Si el codigo contiene guion (ej: 84845-12), es login de operario: usar codigo del titular
    IF position('-' IN v_codigo_titular) > 0 THEN
        v_codigo_titular := trim(split_part(v_codigo_titular, '-', 1));
        IF v_codigo_titular = '' THEN
            RAISE EXCEPTION 'Codigo de operario invalido';
        END IF;
    END IF;

    -- Obtener usuario_id (titular) por codigo
    SELECT id INTO v_usuario_id
    FROM usuarios
    WHERE codigo_usuario = v_codigo_titular
      AND activo = TRUE;

    IF v_usuario_id IS NULL THEN
        RAISE EXCEPTION 'Usuario no encontrado o inactivo';
    END IF;

    -- Cerrar sesiones anteriores activas del mismo usuario
    UPDATE sesiones_usuario
    SET activa = FALSE,
        fecha_fin = NOW()
    WHERE usuario_id = v_usuario_id
      AND activa = TRUE;

    -- Crear nueva sesion (guardar codigo usado para auditoria si existe la columna)
    INSERT INTO sesiones_usuario (usuario_id, activa, codigo_login)
    VALUES (v_usuario_id, TRUE, NULLIF(trim(p_codigo_usuario), ''))
    RETURNING id INTO v_sesion_id;

    RETURN v_sesion_id;
END;
$$;

COMMENT ON FUNCTION crear_sesion_usuario IS
'Crea una sesion para el usuario. Acepta codigo titular (ej. 84845) o operario (ej. 84845-12); en ambos casos la sesion se asocia al usuario_id del titular. codigo_login guarda el codigo usado para auditoria.';
