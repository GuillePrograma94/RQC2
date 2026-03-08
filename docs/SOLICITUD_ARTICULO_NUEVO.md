# Solicitud de articulo nuevo (Dependiente / Comercial)

## Descripcion

Herramienta dentro de **Herramientas** en scan_client_mobile que permite a usuarios con rol **Dependiente** o **Comercial** solicitar la creacion de un articulo nuevo. Solo estos roles ven el boton y pueden enviar solicitudes.

## Quien puede usarla

- **Dependiente**: usuarios con `tipo = 'DEPENDIENTE'` en `public.usuarios`.
- **Comercial**: usuarios con `tipo = 'COMERCIAL'` en `public.usuarios` (o identificados por `app_metadata.comercial_id` segun configuracion del login).

La visibilidad del boton "Solicitar articulo nuevo" en la pantalla Herramientas se controla en frontend con `currentUser.is_dependiente || currentUser.is_comercial`. El INSERT en Supabase esta restringido por RLS al mismo criterio.

## Campos del formulario

| Campo | Obligatorio | Descripcion |
|-------|-------------|-------------|
| Proveedor | Si | Desplegable cargado desde la tabla `proveedores` (codigo + nombre). |
| Descripcion | Si | Texto libre (ej. "Pilar infinity 30x182 roble caledonia"). |
| Referencia del proveedor | No | Texto (ej. "97768"). |
| Tarifa | No | Texto (ej. "SUPER OFERTAS"). |
| Pagina | No | Numero entero (ej. 25). |
| Precio | Si | Numero mayor que 0 (ej. 209). |
| Fotografia adjunta | No | Archivo de imagen. Se sube a **Supabase Storage** (bucket `solicitudes-articulos-fotos`). |

## Modelo de datos

### Tabla `proveedores`

- **codigo_proveedor** (TEXT, PK): codigo unico del proveedor (ej. SALGAR).
- **nombre_proveedor** (TEXT NOT NULL): nombre para mostrar en listados y en el desplegable del formulario.

Los productos pueden asignarse a un proveedor mediante la columna `productos.codigo_proveedor` (FK a `proveedores.codigo_proveedor`). Ver `migration_proveedores_productos.sql`.

### Tabla `solicitudes_articulos_nuevos`

- **id** (UUID, PK)
- **codigo_proveedor** (TEXT NOT NULL, FK a `proveedores`)
- **descripcion** (TEXT NOT NULL)
- **ref_proveedor**, **tarifa**, **pagina** (opcionales)
- **precio** (NUMERIC NOT NULL, CHECK > 0)
- **foto_url** (TEXT, opcional; se rellena tras subir la imagen a Storage)
- **auth_uid** (UUID NOT NULL): Supabase Auth UUID del solicitante (para RLS UPDATE/SELECT)
- **user_id** (INTEGER, opcional): `usuarios.id` si el solicitante es Dependiente
- **comercial_id** (INTEGER, opcional): ID del comercial si aplica
- **created_at**, **estado** (default 'pendiente')

### Politicas RLS

- **INSERT**: solo si `(auth.jwt() -> 'app_metadata' ->> 'usuario_id')::int` esta en `(SELECT id FROM public.usuarios WHERE tipo IN ('DEPENDIENTE', 'COMERCIAL'))`.
- **UPDATE**: solo filas donde `auth_uid = auth.uid()` (permite al creador actualizar `foto_url` tras subir la foto). Los usuarios **ADMINISTRACION** tienen ademas una politica que les permite actualizar el `estado` (aprobado/rechazado) de cualquier solicitud (ver `migration_solicitudes_rls_administracion.sql` y [PANEL_ADMINISTRACION.md](PANEL_ADMINISTRACION.md)).
- **SELECT**: solo filas donde `auth_uid = auth.uid()`. Los usuarios con rol **ADMINISTRACION** tienen ademas una politica que les permite SELECT de todas las filas (ver `migration_solicitudes_rls_administracion.sql` y [PANEL_ADMINISTRACION.md](PANEL_ADMINISTRACION.md)).

## Gestion de las solicitudes

Las solicitudes creadas por Dependientes y Comerciales son gestionadas por usuarios con rol **ADMINISTRACION**. Estos usuarios ven un panel exclusivo en la misma app (vista distinta con Inicio, listado de solicitudes y detalle) donde pueden ver todas las solicitudes, el conteo de pendientes y aprobar o rechazar. Ver [PANEL_ADMINISTRACION.md](PANEL_ADMINISTRACION.md).

## Storage (fotografia)

- **Supabase Storage**: bucket `solicitudes-articulos-fotos`.
- **Ruta**: `{solicitud_id}/{nombre_archivo}`.
- En el formulario se muestra un texto aclaratorio: "La imagen se sube a Supabase Storage (bucket solicitudes-articulos-fotos). Opcional."
- La subida en `subirFotoSolicitudArticulo` usa `contentType: file.type` cuando el archivo es imagen para que Supabase guarde el tipo MIME correcto.
- La politica de INSERT del bucket debe limitar subidas al mismo criterio que el INSERT de la tabla (Dependiente o Comercial autenticado). El bucket y la politica se crean desde el dashboard de Supabase o en un script aparte.

## Migraciones

1. **migration_proveedores_productos.sql**: crea la tabla `proveedores`, anade `productos.codigo_proveedor` con FK e inserta al menos un proveedor de ejemplo (SALGAR).
2. **migration_solicitudes_articulos_nuevos.sql**: crea la tabla `solicitudes_articulos_nuevos` y las politicas RLS. Debe ejecutarse despues de la migracion de proveedores.
3. **migration_solicitudes_rls_administracion.sql**: anade politicas SELECT y UPDATE para usuarios con rol ADMINISTRACION (panel de gestion). Ver [PANEL_ADMINISTRACION.md](PANEL_ADMINISTRACION.md).

## Flujo en la app

1. El usuario (Dependiente o Comercial) abre **Herramientas** y pulsa **Solicitar articulo nuevo**.
2. Se carga la pantalla del formulario y se rellenan las opciones del desplegable de proveedores desde `getProveedores()`.
3. Si no hay proveedores, se muestra el mensaje "No hay proveedores configurados..."
4. Al enviar: se valida proveedor, descripcion y precio; se obtiene la sesion Supabase (auth_uid); se inserta la fila con `crearSolicitudArticuloNuevo`; si hay archivo de imagen, se sube a Storage y se actualiza `foto_url` con `updateSolicitudArticuloFotoUrl`.
5. Se muestra un toast de exito y se vuelve a la pantalla Herramientas.

## Archivos implicados

- **Frontend**: `index.html` (pantalla y formulario con clase `solicitud-articulo-screen`, bloque de foto con hint de Supabase Storage), `js/app.js` (visibilidad del boton, `initSolicitudArticuloScreen`, `handleSolicitudArticuloSubmit`), `js/supabase.js` (`getProveedores`, `crearSolicitudArticuloNuevo`, `subirFotoSolicitudArticulo`, `updateSolicitudArticuloFotoUrl`), `styles.css` (estilos `.solicitud-articulo-*`: formulario en tarjeta, responsive PC con max-width 520px, tablet con campos en 2 columnas, movil con areas seguras y toques minimos 44px).
- **Backend**: `migration_proveedores_productos.sql`, `migration_solicitudes_articulos_nuevos.sql`.
