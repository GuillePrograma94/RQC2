# Login y funcionalidades de comerciales

## Estructura de datos

Los comerciales existen en **dos tablas**:

- `usuarios_comerciales` — tabla principal del comercial: `id` (PK = `comercial_id`), `numero`, `nombre`, `password_hash`, `auth_user_id`, etc.
- `usuarios` — también tienen un registro con `tipo = 'COMERCIAL'` (generado automaticamente al crear el comercial).

El campo `usuarios_comerciales.password_hash` es el que se verifica en el login y el que se actualiza al cambiar la contrasena. Usa SHA-256 hex, igual que el resto de usuarios.

## Login

El login de comerciales usa el endpoint serverless `api/auth/login.js`:

1. Intenta `verificar_login_usuario` con el codigo introducido.
2. Si falla (el codigo de un comercial es su numero, sin guion), cae al bloque de `verificar_login_comercial`.
3. `verificar_login_comercial` verifica contra `usuarios_comerciales.password_hash`.
4. La respuesta incluye `es_comercial: true`, `comercial_id`, `comercial_numero` y **`user_id: null`** (el ID de `usuarios` no se expone en el login).

### Sincronizacion de password con Supabase Auth

`api/auth/login.js` no solo valida hash en BD (`usuarios` / `usuarios_comerciales`), tambien fuerza la sincronizacion de credenciales en Supabase Auth **antes** de devolver `success`.

- Si `auth_user_id` existe, actualiza password por `auth.admin.updateUserById`.
- Si falta o es invalido, crea usuario auth.
- Si el email ya estaba registrado, localiza el usuario existente, actualiza password y vuelve a enlazar `auth_user_id`.

Con esto se evita el caso de "password cambiada en BD pero `signInWithPassword` falla por credenciales desincronizadas".

En la app, `currentUser` queda con:
```
{
    is_comercial: true,
    comercial_id: <usuarios_comerciales.id>,
    comercial_numero: <usuarios_comerciales.numero>,
    user_id: null,
    ...
}
```

## Representar a un cliente

En `selectorClienteScreen` el comercial puede seleccionar a que cliente representa. Al hacerlo se almacenan en `currentUser`:
- `cliente_representado_id`
- `cliente_representado_nombre`
- `cliente_representado_almacen_habitual`
- `cliente_representado_grupo_cliente`

Los metodos `getEffectiveUserId()`, `getEffectiveAlmacenHabitual()` y `getEffectiveGrupoCliente()` devuelven los datos del cliente representado cuando existe, haciendo que todo el flujo (pedidos, precios, stock, historial) funcione como si el comercial fuera ese cliente.

## Dejar de representar a un cliente

Desde `selectorClienteScreen`, el bloque superior "Estas representando a X" incluye un boton cuadrado rojo con X a la derecha. Al pulsarlo se ejecuta `_dejarDeRepresentarCliente()`:
- Elimina los cuatro campos `cliente_representado_*` de `currentUser`.
- Guarda la sesion y actualiza el menu lateral.
- Muestra un toast de confirmacion.

## Cambiar contrasena del comercial

El comercial puede cambiar su contrasena desde `selectorClienteScreen` usando el boton "Cambiar mi contrasena" al final de la pantalla.

**Flujo:**
1. Se abre el modal `#cambiarPasswordComercialModal`.
2. El formulario recoge contrasena actual, nueva y confirmacion.
3. Se llama a `supabaseClient.cambiarPasswordComercial(comercial_id, actual, nueva)`.
4. Internamente usa la RPC `cambiar_password_comercial(p_comercial_id, p_password_actual_hash, p_password_nueva_hash)` que actualiza `usuarios_comerciales.password_hash`.

**Migracion necesaria:** ejecutar `scan_client_mobile/migration_cambiar_password_comercial.sql` en el SQL Editor de Supabase para crear la funcion `cambiar_password_comercial`.

## Pantalla Mi perfil (profileScreen)

Cuando la sesion es de un comercial, `renderProfileScreen()` muestra el nombre y numero del comercial pero **oculta** la seccion de cambio de contrasena del perfil y la seccion de operarios (esas secciones son exclusivas de clientes titulares). El cambio de contrasena del comercial se hace desde `selectorClienteScreen` tal como se describe arriba.

## Pantalla Mis pedidos (myOrders) para comerciales

El comercial puede abrir **Mis pedidos** siempre (con o sin cliente representado).

- **Sin cliente representado:** Se muestran los pedidos de **todos sus clientes** (los asignados al comercial via `comercial_asignado`). Orden: de mas recientes a mas antiguos, con los pedidos en estado **COMPLETADO** siempre al final. En cada tarjeta aparece el **nombre del cliente** para identificar a quien pertenece el pedido.

- **Con cliente representado:** Se muestran solo los pedidos de ese cliente. En la parte superior de la pantalla se muestra el bloque **"Representando a [Nombre del cliente]"** para que el comercial sepa en todo momento a quien esta representando al revisar los pedidos. Las tarjetas no repiten el nombre del cliente (ya visible arriba).

La carga de pedidos sin cliente representado usa `getClientesAsignadosComercial(comercial_numero)` y luego `getUserRemoteOrders(usuario_id)` por cada cliente; no se usa cache local en esa vista.

**Detalle de lineas ("Volver a pedir todo" y reordenar una linea):** no incrustar JSON ni `JSON.stringify(codigo)` en atributos `onclick` (caracteres como `&`, comillas o saltos en codigo o descripcion rompen el HTML y disparan `SyntaxError: Unexpected end of input`). Los botones se enlazan en `renderOrderProducts` con `addEventListener`: el de todo el pedido con el array en cierre; cada `.btn-reorder-product` lee `data-reorder-codigo` / `data-reorder-cantidad` (valores escapados con `escapeForHtmlAttribute`).

## Prepedidos: Aceptar y Eliminar (comercial / dependiente sin cliente en el selector)

Las RPC `convertir_prepedido_a_pedido_remoto` y `eliminar_prepedido` exigen que el carrito cumpla `usuario_id = p_usuario_id` (el **titular** del prepedido en `carritos_clientes`, normalmente el cliente titular).

Si en la app se pasaba `getEffectiveUserId()` con sesion de comercial o dependiente **sin** `cliente_representado_id`, ese ID era el del representante, no el del cliente dueno del carrito, y la RPC respondia `success: false` con mensaje tipo **"Prepedido no disponible para aceptar"**. En `aceptarPrepedido` y `eliminarPrepedido` se pasa `prepedido.usuario_id` (o el obtenido con `getCart` al eliminar) como `p_usuario_id`.

**Aceptar prepedido (entrega):** al pulsar **Aceptar** se abre el mismo modal que "Enviar pedido" en caja (`openEnviarPedidoModal({ prepedidoAceptarId })`): el usuario elige **Recoger en almacen** (almacen + observaciones) o **Enviar en ruta** (observaciones). La conversion a pedido remoto y el ERP se ejecutan en `ejecutarAceptarPrepedidoRemoto` con ese almacen y el texto de observaciones (se anaden las notas guardadas en el prepedido y la linea de comercial si aplica). Se guarda `almacen_destino` del prepedido en `_pendingAceptarPrepedidoMeta` para **Enviar en ruta** cuando el representante no tiene cliente seleccionado (almacen habitual del titular del carrito). Si el usuario cierra modales sin confirmar, `_cancelFlujoAceptarPrepedidoEntrega` limpia el estado pendiente.

**Por que no sale el envio a WhatsApp de soporte:** ese mensaje viene de una respuesta RPC **prevista** (`success: false`), no de un `throw` ni de `window.onerror`. El modal de reporte a WhatsApp solo se engancha a errores globales de JavaScript / promesas no capturadas y a fallos criticos concretos (por ejemplo envio de pedido); un toast de error de negocio no abre ese modal.

**Error Postgres 42804** (`Returned type character(6) does not match expected type text in column 2`): la tabla `carritos_clientes.codigo_qr` puede ser `character(6)` y la funcion declara `codigo_qr TEXT` en `RETURNS TABLE`. Aplicar en Supabase el script `scan_client_mobile/migration_convertir_prepedido_return_text_cast.sql` (o la definicion actualizada en `migration_prepedidos.sql`), que hace `::TEXT` en el `RETURN QUERY` de `convertir_prepedido_a_pedido_remoto`.

## Nota sobre comerciales legacy

En la base de datos pueden existir referencias antiguas a un sistema de comerciales legacy que fue eliminado. Todos los comerciales actuales se crean nuevos en `usuarios_comerciales` y tienen su entrada en `usuarios` con `tipo = 'COMERCIAL'`. No hay comerciales del sistema antiguo activos.
