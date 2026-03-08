-- Crea el producto en el catalogo al completar una solicitud de articulo nuevo (solo ADMINISTRACION).
-- Ejecutar DESPUES de migration_proveedores_productos.sql (productos.codigo_proveedor).
-- El JWT debe llevar app_metadata.es_administracion = true.

CREATE OR REPLACE FUNCTION crear_producto_desde_solicitud(
    p_codigo TEXT,
    p_descripcion TEXT,
    p_pvp NUMERIC,
    p_codigo_proveedor TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF (auth.jwt() -> 'app_metadata' ->> 'es_administracion')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'Solo Administracion puede crear productos desde solicitudes';
    END IF;
    IF trim(coalesce(p_codigo, '')) = '' THEN
        RAISE EXCEPTION 'El codigo del producto es obligatorio';
    END IF;
    IF trim(coalesce(p_descripcion, '')) = '' THEN
        RAISE EXCEPTION 'La descripcion es obligatoria';
    END IF;
    IF p_pvp IS NULL THEN
        RAISE EXCEPTION 'El PVP es obligatorio';
    END IF;

    INSERT INTO productos (codigo, descripcion, pvp, codigo_proveedor)
    VALUES (trim(p_codigo), trim(p_descripcion), p_pvp::real, nullif(trim(p_codigo_proveedor), ''));

    RETURN json_build_object('success', true);
EXCEPTION
    WHEN unique_violation THEN
        RAISE EXCEPTION 'El codigo del producto ya existe en el catalogo';
END;
$$;

COMMENT ON FUNCTION crear_producto_desde_solicitud(TEXT, TEXT, NUMERIC, TEXT) IS
'Crea un producto en productos con codigo, descripcion, pvp y opcional codigo_proveedor. Solo llamable por usuarios con es_administracion.';
