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

- **Ver Recambios**: titulo "Recambios de este producto". Se muestra la tarjeta del producto actual (imagen, codigo, descripcion) y un grid de tarjetas con imagen, descripcion, codigo y precio de cada recambio. Clic en una tarjeta abre el detalle de ese producto.
- **Sirve para estos productos**: titulo "Sirve para estos productos". Se muestra la tarjeta del producto actual y un grid de los productos que se pueden reparar o completar con ese articulo (imagen, descripcion, codigo, precio). Clic en una tarjeta abre el detalle de ese producto.

El boton **Volver** devuelve a la pantalla desde la que se habia abierto el detalle (busqueda, carrito, etc.). No hay boton "Recambios" en Herramientas; la unica forma de llegar a esta pagina es desde los botones del overlay de detalle.

---

## 5. Archivos


| Archivo                                | Uso                                                                                                                                 |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `migration_producto_recambios.sql`     | Crear tabla e indices (ejecutar en Supabase).                                                                                       |
| `migration_rls_producto_recambios.sql` | RLS (ejecutar despues de la migracion de tabla).                                                                                    |
| `supabase.js`                          | Metodos: getRecambiosDeProducto(codigo), getPadresDeRecambio(codigo), addRecambio(padreCodigo, recambioCodigo), removeRecambio(id). |
| `index.html`                           | Boton en Panel de Control + pantalla recambios (buscar producto + dos listas).                                                      |
| `app.js`                               | showScreen('recambios'), renderRecambios, anadir/quitar recambios y padres.                                                         |
| `styles.css`                           | Estilos para pantalla recambios (reutilizar .wc-piezas-* o .recambios-*).                                                           |


