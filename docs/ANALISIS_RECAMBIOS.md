# Analisis: Recambios de productos (Panel de Control)

Objetivo: permitir al administrador indicar que un articulo es **recambio** de otro (relacion padre-hijo). La informacion se usara en dos sentidos: "Este producto tiene estos recambios" y "Este recambio sirve para estos productos".

---

## 1. Dominio

- **Producto padre**: articulo "principal" (ej. un grifo completo).
- **Recambio (hijo)**: articulo que es repuesto/recambio del padre (ej. cartucho del grifo).
- Relacion **muchos a muchos**: un mismo producto puede ser recambio de varios padres; un padre puede tener varios recambios.
- Se identifica por **codigo** de producto (misma convencion que WC: `productos.codigo` o codigo en IndexedDB).

Uso de la informacion:

1. **"Este producto tiene estos recambios"**: dado un producto (padre), listar sus recambios (hijos). Ej. en ficha de producto o en modal de anadir al carrito.
2. **"Este recambio sirve para estos productos"**: dado un recambio, listar los productos (padres) para los que sirve. Ej. en ficha del recambio.

---

## 2. Modelo de datos

Una sola tabla: `producto_recambios`.


| Columna                  | Tipo          | Descripcion                   |
| ------------------------ | ------------- | ----------------------------- |
| id                       | UUID PK       | Identificador de la fila      |
| producto_padre_codigo    | TEXT NOT NULL | Codigo del producto principal |
| producto_recambio_codigo | TEXT NOT NULL | Codigo del recambio (hijo)    |
| created_at               | TIMESTAMPTZ   | Opcional                      |


- **UNIQUE(producto_padre_codigo, producto_recambio_codigo)** para no duplicar la misma relacion.
- Indices: por `producto_padre_codigo` (recambios de un producto) y por `producto_recambio_codigo` (para que productos sirve un recambio).

Consultas tipicas:

- Recambios de un producto: `SELECT * FROM producto_recambios WHERE producto_padre_codigo = $codigo`
- Padres de un recambio: `SELECT * FROM producto_recambios WHERE producto_recambio_codigo = $codigo`

---

## 3. Panel de Control (admin)

Nueva herramienta **Configurar recambios** en el Panel de Control (junto a Configurar conjuntos WC).

Flujo:

1. Pantalla **Recambios**: campo "Buscar producto" (codigo o codigo secundario) + boton Buscar.
2. Al encontrar el producto se muestran dos bloques:
  - **Este producto tiene estos recambios**: lista de recambios (hijos) del producto actual. Anadir por codigo (buscar + confirmar), quitar con boton por fila.
  - **Este producto es recambio de**: lista de productos (padres) para los que el producto actual es recambio. Anadir por codigo (buscar + confirmar), quitar con boton por fila.
3. Resolucion de codigo igual que en WC: `cartManager.resolveToPrincipalCodeWithDetails(codigo)` para aceptar codigo principal o secundario (EAN) y mostrar descripcion antes de anadir.

RLS: lectura para autenticados (para poder mostrar recambios en fichas/modales); escritura (INSERT/UPDATE/DELETE) solo administrador.

---

## 4. Uso en la app (cliente)

### 4.1 Ventana de detalle de producto (carousel)

En la **ventana de detalle de producto** (overlay con carousel de imagenes, que se abre al pulsar la imagen en el modal de anadir al carrito):

- Si el producto **tiene recambios**: se muestra el boton **"Ver Recambios"**. Al pulsarlo se abre un modal con la lista de recambios (codigo y descripcion); al pulsar un recambio se cierra el modal y se abre el detalle de ese producto.
- Si el producto **es recambio** de otros: se muestra el boton **"Sirve para estos productos"**. Al pulsarlo se abre un modal con la lista de productos para los que sirve; al pulsar uno se cierra el modal y se abre el detalle de ese producto.

Ambos botones pueden mostrarse a la vez si el producto tiene recambios y ademas es recambio de otros.

### 4.2 Pagina Recambios (desde detalle de producto)

Desde la **ventana de detalle de producto** (overlay con carousel), al pulsar **"Ver Recambios"** o **"Sirve para estos productos"** se cierra el overlay y se abre una **pagina** dedicada:

- **Ver Recambios**: titulo "Recambios de este producto". Se muestra la tarjeta del producto actual (imagen, codigo, descripcion, mas pequena en movil) y un grid de tarjetas con imagen, descripcion, codigo y precio de cada recambio. **Clic en una tarjeta abre el modal de cantidad y anade el recambio al carrito directamente.**
- **Sirve para estos productos**: titulo "Sirve para estos productos". Se muestra la tarjeta del producto actual y un grid de los productos que se pueden reparar o completar con ese articulo. **Clic en una tarjeta abre el modal de cantidad y anade el producto al carrito directamente.**

**Layout del grid**: 2 columnas en movil, 4 columnas en escritorio (>=768px). La tarjeta del producto actual usa layout horizontal compacto (80px imagen + texto) en movil, y layout horizontal amplio (200px imagen + texto) en escritorio (>=480px).

El boton **Volver** devuelve a la pantalla desde la que se habia abierto el detalle (busqueda, carrito, etc.). No hay boton "Recambios" en Herramientas; la unica forma de llegar a esta pagina es desde los botones del overlay de detalle.

### 4.3 Gestion de listeners (comportamiento tecnico)

Tanto `showAddToCartModal` como `openProductDetail` utilizan un patron de limpieza externa para evitar la acumulacion de event listeners entre invocaciones:

- `this._addToCartModalCleanup`: referencia al `handleClose` de la ultima invocacion de `showAddToCartModal`. Al inicio de cada nueva llamada se ejecuta (cancela el modal anterior, limpia sus listeners) antes de registrar los nuevos.
- `this._productDetailCleanup`: referencia al `handleClose` de la ultima invocacion de `openProductDetail`. Al inicio de cada nueva llamada se ejecuta (cierra el overlay anterior, limpia sus listeners) antes de registrar los nuevos.

Este patron garantiza que nunca haya listeners huerfanos acumulados, lo que prevenia: anadir el articulo principal en vez del recambio, el boton "Volver" quedarse en la misma pantalla, y la imagen del overlay quedarse en cache.

---

## 5. Seguridad y RLS

### Modelo de autenticacion del proyecto

El proyecto usa autenticacion propia (tabla `usuarios` con campo `tipo = 'ADMINISTRADOR'`), no el sistema de email/password nativo de Supabase Auth. Sin embargo, la API de Vercel (`api/auth/login.js`) crea o actualiza el usuario correspondiente en Supabase Auth en cada login, escribiendo en su `app_metadata`:

```json
{ "usuario_id": 42, "es_administrador": true }
```

A continuacion, el frontend llama a `supabase.auth.signInWithPassword()` para obtener un JWT de Supabase Auth que contiene ese `app_metadata`. Este JWT se envia automaticamente en todas las peticiones al cliente Supabase del navegador.

### Sesion de Supabase Auth vs. sesion de la app

El cliente de la app guarda su propia sesion en `localStorage['current_user']` (sin expiry). La sesion de Supabase Auth (JWT) se guarda por separado por el cliente Supabase y tiene un tiempo de vida limitado (access token ~1h, refresh token ~7 dias). Si el usuario vuelve despues de que ambos tokens hayan expirado, el JWT es nulo y las operaciones escritura con RLS fallan con `42501`.

**Solucion implementada en `initialize()`** (desde marzo 2026): al restaurar la sesion de la app desde `localStorage`, se verifica inmediatamente si el JWT de Supabase Auth sigue activo con `auth.getSession()`. Si la sesion JWT ha expirado, se limpia el `localStorage` de la app y se fuerza al usuario a hacer login de nuevo. Esto garantiza que la sesion de la app y el JWT siempre esten sincronizados.

### Politicas RLS de producto_recambios

| Operacion | Quién puede | Condicion SQL |
|---|---|---|
| SELECT | Cualquier usuario (anon o autenticado) | `USING (true)` |
| INSERT | Solo administradores | `WITH CHECK (((auth.jwt() -> 'app_metadata') ->> 'es_administrador')::boolean IS TRUE)` |
| DELETE | Solo administradores | `USING (((auth.jwt() -> 'app_metadata') ->> 'es_administrador')::boolean IS TRUE)` |

**Lectura abierta** porque los recambios se muestran en fichas de producto para cualquier usuario, incluso invitados.

**Escritura restringida por JWT claim**: el RLS comprueba `app_metadata.es_administrador` del JWT emitido por Supabase Auth. Como ese claim solo lo escribe el servidor Vercel (con `service_role_key`) y solo cuando `usuarios.tipo = 'ADMINISTRADOR'` en la BD, no es falsificable desde el navegador.

### Como aplicar el RLS

Ejecutar `migration_rls_producto_recambios.sql` en el SQL Editor de Supabase. El script:
1. Habilita RLS en la tabla (si no estaba habilitado)
2. Elimina cualquier politica previa conflictiva
3. Crea las tres politicas descritas arriba
4. Devuelve un SELECT de verificacion de las politicas activas

No requiere cambios en el codigo frontend ni en las API routes.

---

## 6. Archivos


| Archivo                                | Uso                                                                                                                                 |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `migration_producto_recambios.sql`     | Crear tabla e indices (ejecutar en Supabase).                                                                                       |
| `migration_rls_producto_recambios.sql` | RLS definitivo: lectura abierta, escritura solo para JWT con es_administrador=true (ejecutar en Supabase SQL Editor).               |
| `supabase.js`                          | Metodos: getRecambiosDeProducto(codigo), getPadresDeRecambio(codigo), addRecambio(padreCodigo, recambioCodigo), removeRecambio(id). |
| `index.html`                           | Boton en Panel de Control + pantalla recambios (buscar producto + dos listas).                                                      |
| `app.js`                               | showScreen('recambios'), renderRecambios, anadir/quitar recambios y padres.                                                         |
| `styles.css`                           | Estilos para pantalla recambios (reutilizar .wc-piezas-* o .recambios-*).                                                           |


