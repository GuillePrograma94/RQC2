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
| Proveedor | Si | **Combobox con busqueda**: puedes escribir para filtrar por nombre, codigo o alias. Coincidencia flexible: orden de palabras indiferente (ej. "sanitario roca" o "roca sanitario"), y parcial (ej. "roc san" encuentra "Roca Sanitario"). Los alias se gestionan en Panel Administracion > Proveedores. |
| Descripcion | Si | Texto libre (ej. "Pilar infinity 30x182 roble caledonia"). |
| Referencia del proveedor | No | Texto (ej. "97768"). |
| Tarifa | No | Texto (ej. "SUPER OFERTAS"). |
| Pagina | No | Numero entero (ej. 25). |
| Precio | Si | Numero mayor que 0 (ej. 209). |
| Observaciones | No | Detalles opcionales: articulo similar ya creado, precio de compra fabricante, nombre del cliente que pide el articulo, etc. |
| Fotografia adjunta | No | Archivo de imagen. Se sube a **Supabase Storage** (bucket `solicitudes-articulos-fotos`). |

## Modelo de datos

### Tabla `proveedores`

- **codigo_proveedor** (TEXT, PK): codigo unico del proveedor (ej. SALGAR).
- **nombre_proveedor** (TEXT NOT NULL): nombre para mostrar en listados y en el desplegable del formulario.

Los productos pueden asignarse a un proveedor mediante la columna `productos.codigo_proveedor` (FK a `proveedores.codigo_proveedor`). Ver `migration_proveedores_productos.sql`.

### Tabla `proveedores_alias`

- **codigo_proveedor** (TEXT, FK a `proveedores`), **alias** (TEXT): pares proveedor-alias para busqueda flexible en el combobox de Solicitar articulo nuevo (ej. alias "sanitario roca", "roc san" para Roca Sanitario). Ver `migration_proveedores_alias.sql`. Solo ADMINISTRACION puede anadir o eliminar alias (Panel Administracion > Proveedores).

### Tabla `solicitudes_articulos_nuevos`

- **id** (UUID, PK)
- **codigo_proveedor** (TEXT NOT NULL, FK a `proveedores`)
- **descripcion** (TEXT NOT NULL)
- **ref_proveedor**, **tarifa**, **pagina** (opcionales)
- **precio** (NUMERIC NOT NULL, CHECK > 0)
- **observaciones** (TEXT, opcional): detalles que ayuden a administracion (articulo similar creado, precio compra fabricante, nombre del cliente que pide el articulo, etc.). Ver `migration_solicitudes_observaciones.sql`.
- **foto_url** (TEXT, opcional; se rellena tras subir la imagen a Storage)
- **codigo_producto** (TEXT, opcional): codigo del producto asignado por Administracion al completar la solicitud o al marcar "articulo ya existente" (el trabajador puede usar este codigo para anadir el articulo al carrito). Ver migracion `migration_solicitudes_codigo_producto.sql`.
- **auth_uid** (UUID NOT NULL): Supabase Auth UUID del solicitante (para RLS UPDATE/SELECT)
- **user_id** (INTEGER, opcional): `usuarios.id` si el solicitante es Dependiente
- **comercial_id** (INTEGER, opcional): ID del comercial si aplica
- **created_at**, **estado** (default 'pendiente'). Valores de estado: `pendiente`, `aprobado`, `rechazado`, `completo` (articulo creado y codigo asignado; la imagen se elimina del Storage), `articulo_ya_existente` (articulo ya existia, se indica codigo para que el trabajador lo anada al carrito).

### Politicas RLS

- **INSERT**: solo si `(auth.jwt() -> 'app_metadata' ->> 'usuario_id')::int` esta en `(SELECT id FROM public.usuarios WHERE tipo IN ('DEPENDIENTE', 'COMERCIAL'))`.
- **UPDATE**: solo filas donde `auth_uid = auth.uid()` (permite al creador actualizar `foto_url` tras subir la foto). Los usuarios **ADMINISTRACION** tienen ademas una politica que les permite actualizar cualquier campo de cualquier fila (estado, codigo_producto, foto_url, etc.).
- **SELECT**: solo filas donde `auth_uid = auth.uid()`. Los usuarios con rol **ADMINISTRACION** tienen ademas una politica que les permite SELECT de todas las filas (ver `migration_solicitudes_rls_administracion.sql` y [PANEL_ADMINISTRACION.md](PANEL_ADMINISTRACION.md)).

## Gestion de las solicitudes

Las solicitudes creadas por Dependientes y Comerciales son gestionadas por usuarios con rol **ADMINISTRACION**. En el panel (ver [PANEL_ADMINISTRACION.md](PANEL_ADMINISTRACION.md)) pueden:
- Ver listado con estado (Pendiente, Aprobado, Rechazado, **COMPLETO**, **Articulo ya existente**).
- Aprobar o Rechazar (estado pendiente).
- **Completar solicitud**: rellenar **Codigo del producto**, elegir **Fabricante (proveedor)** en un desplegable (por defecto viene el de la solicitud; Administracion puede cambiarlo) y opcionalmente marcar **Articulo ya existente**. Al guardar con estado **COMPLETO** se **crea el producto** en la tabla `productos` con: codigo (SKU indicado), descripcion (de la solicitud), PVP (precio de la solicitud, IVA no incluido) y codigo_proveedor (el seleccionado en el desplegable); a continuacion se elimina la imagen del bucket Storage y se actualiza la solicitud (estado, codigo_producto, foto_url = null). Con **Articulo ya existente** no se crea producto; solo se guarda el codigo para que el trabajador pueda buscar y anadir el articulo al carrito.

## Storage (fotografia)

- **Supabase Storage**: bucket **`solicitudes-articulos-fotos`** (el nombre debe ser exactamente este).
- **Ruta**: `{solicitud_id}/{nombre_archivo}`.
- En el formulario se muestra un texto aclaratorio: "La imagen se sube a Supabase Storage (bucket solicitudes-articulos-fotos). Opcional."
- La subida en `subirFotoSolicitudArticulo` usa `contentType: file.type` cuando el archivo es imagen para que Supabase guarde el tipo MIME correcto.
- **Visualizacion en panel Administracion**: las fotos se muestran mediante URL firmada (`getSolicitudFotoSignedUrl`), que funciona con bucket publico o privado. Si ves "Bucket not found" (404) al abrir la URL publica, el bucket aun no existe: crealo en Dashboard > Storage con el nombre exacto `solicitudes-articulos-fotos`. Para la URL firmada, el token debe ir en la query; si tu version del API devuelve el token por separado, la app lo anade automaticamente.

### Crear el bucket en Supabase

El bucket no se crea con las migraciones SQL; hay que crearlo en el proyecto de Supabase:

1. En el **Dashboard de Supabase**: **Storage** > **New bucket**.
2. **Name**: `solicitudes-articulos-fotos` (exactamente, sin espacios).
3. Opciones: puedes dejarlo **Public** si quieres que las URLs publicas de las fotos sean accesibles sin cabeceras, o **Private** si prefieres enlaces firmados (la app actual usa `getPublicUrl`, es decir, bucket publico).
4. Crear el bucket.
5. **Policies**: en el bucket recien creado, **Policies** > **New policy**. Para permitir solo subidas de usuarios Dependiente/Comercial autenticados, una politica de **INSERT** (Allow upload) con una condicion que use `auth.jwt() -> 'app_metadata' ->> 'usuario_id'` y compruebe que ese ID esta en `SELECT id FROM public.usuarios WHERE tipo IN ('DEPENDIENTE', 'COMERCIAL')`. En el editor de politicas de Storage de Supabase suele usarse una expresion tipo:
   - **Policy name**: p.ej. `Allow upload solicitudes fotos dependiente comercial`
   - **Allowed operation**: INSERT (upload).
   - **Target roles**: authenticated.
   - **Policy definition** (WITH CHECK): expresion que restrinja por `app_metadata.usuario_id` y tabla `usuarios`. Si tu proyecto ya tiene ese `app_metadata` en el JWT, la condicion seria equivalente a la RLS de la tabla (usuario_id en usuarios con tipo DEPENDIENTE o COMERCIAL).

Si no configuras politicas, por defecto Storage puede denegar todo; con una politica demasiado amplia (p.ej. "authenticated puede subir") cualquier usuario autenticado podria subir. Lo ideal es replicar el criterio de la tabla: solo Dependiente y Comercial.

### Politicas del bucket (paso a paso)

En el bucket `solicitudes-articulos-fotos`, **Policies** > **New policy**. Crear **tres politicas** (una por operacion):

---

**1. Politica INSERT (upload) – solo Dependiente y Comercial**

- **Policy name**: `Upload fotos Dependiente Comercial` (o similar, max 50 caracteres).
- **Allowed operation**: marcar **upload** (o el equivalente a INSERT en la lista de operaciones de Storage).
- **Target roles**: dejar por defecto o elegir **authenticated** (la restriccion real va en la expresion).
- **Policy definition** (expresion que devuelve true cuando el usuario puede subir):

```sql
bucket_id = 'solicitudes-articulos-fotos'
AND (auth.jwt() -> 'app_metadata' ->> 'usuario_id')::int IN (
  SELECT id FROM public.usuarios WHERE tipo IN ('DEPENDIENTE', 'COMERCIAL')
)
```

Guardar.

---

**2. Politica DELETE (remove) – solo Administracion**

- **Policy name**: `Delete fotos solo Administracion`.
- **Allowed operation**: marcar **remove** (o DELETE).
- **Target roles**: **authenticated**.
- **Policy definition**:

```sql
bucket_id = 'solicitudes-articulos-fotos'
AND (
  (auth.jwt() -> 'app_metadata' ->> 'es_administracion')::boolean = true
  OR
  (auth.jwt() -> 'app_metadata' ->> 'usuario_id')::int IN (
    SELECT id FROM public.usuarios WHERE tipo = 'ADMINISTRACION'
  )
)
```

Si en tu JWT solo tienes `usuario_id` y no `es_administracion`, usa solo la parte `OR` con `usuario_id` y `tipo = 'ADMINISTRACION'`:

```sql
bucket_id = 'solicitudes-articulos-fotos'
AND (auth.jwt() -> 'app_metadata' ->> 'usuario_id')::int IN (
  SELECT id FROM public.usuarios WHERE tipo = 'ADMINISTRACION'
)
```

Guardar.

---

**3. Politica SELECT (download) – ver la imagen (Dependiente, Comercial y Administracion)**

Para que al generar una URL firmada puedan ver la foto quien subio o Administracion:

- **Policy name**: `Ver y seleccionar imagenes`.
- **Allowed operation**: marcar **download** (o SELECT).
- **Target roles**: **authenticated**.
- **Policy definition**:

```sql
bucket_id = 'solicitudes-articulos-fotos'
AND (auth.jwt() -> 'app_metadata' ->> 'usuario_id')::int IN (
  SELECT id FROM public.usuarios WHERE tipo IN ('DEPENDIENTE', 'COMERCIAL', 'ADMINISTRACION')
)
```

Guardar.

---

Resumen: una politica para **upload**, otra para **remove** y otra para **download**, cada una con la expresion anterior en **Policy definition**. El campo que ya tienes rellenado `bucket_id = 'solicitudes-articulos-fotos'` forma parte de esa expresion; si la interfaz lo anade sola, en la caja de texto solo necesitas el resto (la parte con `auth.jwt()` y `usuarios`).

## Migraciones

1. **migration_proveedores_productos.sql**: crea la tabla `proveedores`, anade `productos.codigo_proveedor` con FK e inserta al menos un proveedor de ejemplo (SALGAR).
2. **migration_proveedores_alias.sql**: crea la tabla `proveedores_alias` (codigo_proveedor, alias) y RLS (SELECT autenticados, INSERT/DELETE solo ADMINISTRACION). Permite busqueda flexible por alias en el combobox.
3. **migration_solicitudes_articulos_nuevos.sql**: crea la tabla `solicitudes_articulos_nuevos` y las politicas RLS. Debe ejecutarse despues de la migracion de proveedores.
4. **migration_solicitudes_rls_administracion.sql**: anade politicas SELECT y UPDATE para usuarios con rol ADMINISTRACION (panel de gestion). Ver [PANEL_ADMINISTRACION.md](PANEL_ADMINISTRACION.md).
5. **migration_solicitudes_codigo_producto.sql**: anade la columna `codigo_producto` para que Administracion pueda responder con el codigo al completar o marcar "articulo ya existente".
6. **migration_solicitudes_observaciones.sql**: anade la columna `observaciones` (TEXT, opcional) para detalles como articulo similar, precio compra, cliente que solicita, etc.
7. **migration_crear_producto_desde_solicitud.sql**: crea la funcion RPC `crear_producto_desde_solicitud(p_codigo, p_descripcion, p_pvp, p_codigo_proveedor)` que inserta un producto en `productos`; solo invocable por usuarios con `es_administracion`. Se usa al completar una solicitud con estado COMPLETO para generar el articulo en el catalogo.

## Flujo en la app

1. El usuario (Dependiente o Comercial) abre **Herramientas** y puede pulsar **Solicitar articulo nuevo** para crear una nueva solicitud.
2. **Solicitar articulo nuevo**: se carga la pantalla del formulario y se rellenan las opciones del combobox de proveedores desde `getProveedores()` y `getProveedoresAlias()`. Si no hay proveedores, se muestra el mensaje "No hay proveedores configurados...". Al enviar: se valida proveedor, descripcion y precio; se obtiene la sesion Supabase (auth_uid); se inserta la fila con `crearSolicitudArticuloNuevo`; si hay archivo de imagen, se sube a Storage y se actualiza `foto_url` con `updateSolicitudArticuloFotoUrl`. Se muestra un toast de exito y se vuelve a Herramientas.
3. **Mis solicitudes de articulos**: el trabajador ve un listado de **todas sus solicitudes** (pendientes y ya resueltas). Cada tarjeta muestra estado (Pendiente, Aprobado, Rechazado, **COMPLETO**, **Articulo ya existente**), fecha, descripcion y, si Administracion ha asignado codigo (estado completo o articulo ya existente), el **codigo del producto** y un boton **Anadir al carrito** para anadir ese articulo directamente al carrito. Las solicitudes se obtienen con `getSolicitudesArticulosNuevos(null)`; la RLS limita los resultados a las filas donde `auth_uid = auth.uid()` (solo las del usuario).

En la pantalla **Inicio** (accesible desde la navegacion inferior), los usuarios Dependiente y Comercial ven una **tarjeta** con el resumen: **Creaciones pendientes** (numero) y **Creaciones completadas** (numero). Al pulsar la tarjeta se abre la pantalla **Mis solicitudes de articulos** con el listado completo; desde ahi pueden anadir al carrito los articulos ya creados.

## Archivos implicados

- **Frontend**: `index.html` (pantalla y formulario con clase `solicitud-articulo-screen`, **combobox proveedor** con input + dropdown y hint de busqueda; pantalla **Mis solicitudes de articulos** con listado y boton Anadir al carrito; tarjeta en **Inicio** para acceder a Mis solicitudes), `js/app.js` (visibilidad del boton Solicitar articulo nuevo en Herramientas para Dependiente/Comercial, `initSolicitudArticuloScreen`, `filterProveedores`, `_setupProveedorCombobox`, `handleSolicitudArticuloSubmit`, `loadInicioCreacionesCard`, `initMisSolicitudesScreen`), `js/supabase.js` (`getProveedores`, `getProveedoresAlias`, `getSolicitudesArticulosNuevos`, `addProveedorAlias`, `removeProveedorAlias`, `crearSolicitudArticuloNuevo`, `crearProductoDesdeSolicitud`, `subirFotoSolicitudArticulo`, `updateSolicitudArticuloFotoUrl`, `eliminarFotoSolicitudArticulo`, `updateSolicitudArticuloRespuesta`), `styles.css` (estilos del panel, combobox, bloque completar en administracion y pantalla Mis solicitudes).
- **Backend**: `migration_proveedores_productos.sql`, `migration_proveedores_alias.sql`, `migration_solicitudes_articulos_nuevos.sql`, `migration_solicitudes_codigo_producto.sql`, `migration_solicitudes_observaciones.sql`, `migration_crear_producto_desde_solicitud.sql`.
