# Panel Administracion (rol ADMINISTRACION)

## Descripcion

Usuarios con rol **ADMINISTRACION** (`tipo = 'ADMINISTRACION'` en `public.usuarios`) ven una vista distinta de la app: un panel dedicado a la gestion de tareas de administracion. De momento incluye la gestion de **solicitudes de creacion de articulos nuevos** (creadas por Dependientes y Comerciales desde Herramientas).

La misma SPA (scan_client_mobile) muestra un contenedor distinto segun el tipo de usuario: los demas roles (CLIENTE, COMERCIAL, DEPENDIENTE, ADMINISTRADOR) ven la app de tienda; solo ADMINISTRACION ve el panel con Inicio, Solicitudes, **Proveedores** y Perfil.

## Login y seguridad

- El flujo de login es el mismo que el resto de usuarios: codigo y contrasena contra la API **POST /api/auth/login** (Vercel), que verifica con la RPC `verificar_login_usuario` y crea/actualiza el usuario en Supabase Auth.
- La API escribe en **app_metadata** del usuario de Auth el flag `es_administracion: true` cuando `usuarios.tipo = 'ADMINISTRACION'`. Solo la API (con `SUPABASE_SERVICE_ROLE_KEY`) puede escribir app_metadata; el cliente no puede falsificarlo.
- Tras el login, la app llama a `signInWithPassword` y obtiene un JWT que incluye ese `app_metadata`. Las politicas RLS en Supabase usan `(auth.jwt() -> 'app_metadata' ->> 'es_administracion')::boolean` para permitir a ADMINISTRACION leer y actualizar solicitudes.

Ver tambien [../../docs/SUPABASE_AUTH_VERCEL.md](../../docs/SUPABASE_AUTH_VERCEL.md). El JWT puede llevar tambien `es_administracion` para este rol.

## Vista exclusiva

- **Inicio**: pantalla de arranque con la estadistica de **solicitudes de creacion de articulos pendientes** (conteo de `solicitudes_articulos_nuevos` donde `estado = 'pendiente'`) y un boton para ir al listado.
- **Solicitudes**: listado de todas las solicitudes (fecha, estado, descripcion); al pulsar una se abre el detalle.
- **Detalle**: datos completos de la solicitud; **Estado** mostrado con etiquetas (Pendiente, Aprobado, Rechazado, **COMPLETO**, **Articulo ya existente**). Si la solicitud tiene `codigo_producto`, se muestra. Botones **Aprobar** / **Rechazar** (solo si `estado = 'pendiente'`). Ademas, bloque **Completar solicitud**: campo **Codigo del producto**, desplegable **Fabricante (proveedor)** (por defecto el de la solicitud; Administracion puede cambiarlo), checkbox **Articulo ya existente** (para indicar que el articulo ya existia y el trabajador podra anadirlo al carrito con ese codigo) y boton **Guardar respuesta**. Al guardar:
  - Si no se marca "Articulo ya existente": se **crea el producto** en `productos` (codigo, descripcion, PVP sin IVA, fabricante seleccionado), se pone estado **COMPLETO**, se guarda el codigo, se **elimina la imagen** del bucket Storage y se borra `foto_url` en la fila.
  - Si se marca "Articulo ya existente": no se crea producto; se pone estado **Articulo ya existente** y se guarda el codigo (la imagen no se elimina en este flujo; se puede dejar o eliminar segun criterio).
- **Proveedores (Alias)**: listado de proveedores; al pulsar uno se muestran sus **alias** para facilitar la busqueda en el combobox de Solicitar articulo nuevo (Dependiente/Comercial). Se pueden anadir y eliminar alias (ej. para "Roca Sanitario" anadir "sanitario roca", "roc san"). Solo ADMINISTRACION puede gestionar alias.
- **Perfil**: nombre y boton Cerrar sesion.

Navegacion inferior: Inicio, Solicitudes, Proveedores, Perfil.

## Backend

- **BD**: El tipo `ADMINISTRACION` debe estar permitido en `usuarios.tipo` (ver `migration_usuarios_tipo_administracion.sql`).
- **RLS**: En la tabla `solicitudes_articulos_nuevos`, las politicas que permiten a ADMINISTRACION SELECT de todas las filas y UPDATE de estado estan en `migration_solicitudes_rls_administracion.sql`. Se ejecutan despues de tener el tipo ADMINISTRACION y la tabla de solicitudes.
- **API login**: En la rama titular, la API incluye `es_administracion` en app_metadata y en la respuesta JSON cuando `tipo === 'ADMINISTRACION'`.

## Archivos implicados

- **Migraciones**: `migration_usuarios_tipo_administracion.sql`, `migration_solicitudes_rls_administracion.sql`, `migration_solicitudes_codigo_producto.sql`, `migration_proveedores_alias.sql` (tabla de alias de proveedores para busqueda en Solicitar articulo nuevo), `migration_crear_producto_desde_solicitud.sql` (RPC para crear producto al completar solicitud).
- **API**: `api/auth/login.js` (app_metadata y respuesta).
- **Frontend**: `index.html` (contenedor `#appContainerAdministracion` con pantallas Proveedores y bottom nav), `js/app.js` (rama en `initialize()`, `initializeAppAdministracion`, `setupScreensAdministracion`, `showScreenAdmin`, `loadAdminProveedores`, `renderAdminProveedorAliasBlock`, `renderAdminSolicitudDetail`, `getAdminSolicitudEstadoLabel`, carga de conteo/listado/detalle, logout), `js/supabase.js` (`getProveedores`, `getProveedoresAlias`, `addProveedorAlias`, `removeProveedorAlias`, `getSolicitudesPendientesCount`, `getSolicitudesArticulosNuevos`, `getSolicitudArticuloNuevoById`, `updateSolicitudArticuloEstado`, `crearProductoDesdeSolicitud`, `eliminarFotoSolicitudArticulo`, `updateSolicitudArticuloRespuesta`), `styles.css` (estilos del panel, bloque completar y pantalla Proveedores).

## Relacion con Solicitud de articulo nuevo

Los Dependientes y Comerciales crean solicitudes desde Herramientas; los usuarios ADMINISTRACION las gestionan (ver listado, aprobar/rechazar) desde este panel. Ver [SOLICITUD_ARTICULO_NUEVO.md](SOLICITUD_ARTICULO_NUEVO.md).
