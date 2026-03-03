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

## Nota sobre comerciales legacy

En la base de datos pueden existir referencias antiguas a un sistema de comerciales legacy que fue eliminado. Todos los comerciales actuales se crean nuevos en `usuarios_comerciales` y tienen su entrada en `usuarios` con `tipo = 'COMERCIAL'`. No hay comerciales del sistema antiguo activos.
