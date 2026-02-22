# Análisis: Página de detalle de producto (imagen + carousel + ficha técnica)

Objetivo: al pulsar sobre la **imagen grande** del modal "Añadir al carrito" (`#addToCartModal`), abrir una página/vista de detalle del producto con más imágenes (carousel 1–4) y enlace a ficha técnica PDF si existe.

---

## 1. Dónde estamos ahora

- **Modal de cantidad**: `#addToCartModal` (`index.html` ~664–690). Contiene:
  - `.add-to-cart-image-container` con `#addToCartImg` (imagen actual: `{sku}_1.JPG`).
  - Código, descripción, precio, oferta, controles de cantidad y "Añadir al Carrito".
- **URL de imagen actual**:  
  `https://www.saneamiento-martinez.com/imagenes/articulos/${producto.codigo}_1.JPG`
- **Apertura del modal**: `showAddToCartModal(producto)` en `app.js` (~2194). Se llama desde escáner, búsqueda e historial.

No hay actualmente ningún clic en la imagen que abra otra vista.

---

## 2. Comportamiento deseado

| Elemento | Regla |
|----------|--------|
| **Imágenes** | Hasta 4: `{sku}_1.JPG`, `{sku}_2.JPG`, `{sku}_3.JPG`, `{sku}_4.JPG`. Comprobar cuáles existen y mostrar solo esas en un carousel (1, 2, 3 o 4 imágenes). |
| **Ficha técnica** | PDF en `https://www.saneamiento-martinez.com/pdf/fichas/{sku}.PDF`. Comprobar si existe; si sí, mostrar enlace/botón "Ver ficha técnica". |

SKU = `producto.codigo` (ej. `0804904087`). Extensiones en mayúsculas: `.JPG` y `.PDF`.

---

## 3. Opciones de implementación

### 3.1. Opción A: Overlay a pantalla completa encima del modal (recomendada)

- **Qué es**: Un div a pantalla completa (como un modal) con z-index mayor que `#addToCartModal`, que se muestra al pulsar la imagen.
- **Flujo**: Modal abierto → usuario pulsa imagen → se abre overlay de detalle (carousel + ficha) → usuario cierra overlay → sigue en el mismo modal.
- **Ventajas**:
  - No toca la navegación por pantallas (`showScreen`).
  - El estado del modal (producto, cantidad) no se pierde.
  - Mismo patrón que otros modales (overlay + contenido + botón cerrar).
- **Desventajas**: Ninguna relevante para este caso.

### 3.2. Opción B: Nueva pantalla en la app (`productDetail`)

- Añadir `#productDetailScreen` y tratarlo como una pantalla más con `showScreen('productDetail')`.
- Al pulsar imagen: cerrar modal, guardar `producto` en estado, mostrar pantalla detalle. Al "Volver": volver a abrir el modal con ese producto.
- **Ventajas**: Integrado con el sistema de pantallas.
- **Desventajas**: Hay que guardar estado del modal (producto, cantidad), reabrir el modal al volver y coordinar con cámara/escáner si se sale de la pantalla actual. Más complejidad sin beneficio claro frente a A.

**Recomendación**: **Opción A** (overlay a pantalla completa).

---

## 4. Comprobar qué imágenes existen (1–4)

Las URLs son:

- `https://www.saneamiento-martinez.com/imagenes/articulos/{sku}_1.JPG`
- … `_2.JPG`, `_3.JPG`, `_4.JPG`

**En el front no podemos hacer HEAD a otro origen** sin CORS; el servidor de imágenes podría no permitirlo. Alternativa fiable en el cliente:

- Crear (en memoria) hasta 4 elementos `Image()`, asignar `src` a cada `_1` … `_4`.
- Usar **onload** / **onerror**: si `onload`, la imagen existe; si `onerror`, no (o no accesible).
- Lanzar las 4 peticiones en paralelo; cuando todas hayan terminado (load o error), tendremos la lista de URLs que sí cargaron.
- Construir el carousel solo con esas URLs (1, 2, 3 o 4).

Detalle: no hace falta insertar las imágenes en el DOM para el chequeo; basta crear `new Image()` y asignar `src`. El navegador hará la petición y disparará load/error.

Pseudocódigo:

```text
urls = []
for i in 1..4:
  url = baseUrl + sku + '_' + i + '.JPG'
  await checkImageExists(url)  // new Image(), onload -> push url, onerror -> no push
return urls
```

Mostrar en el carousel únicamente las URLs que hayan cargado correctamente.

---

## 5. Comprobar si existe la ficha técnica (PDF)

URL: `https://www.saneamiento-martinez.com/pdf/fichas/{sku}.PDF`

**Opción 1 – HEAD desde el front**

- `fetch(pdfUrl, { method: 'HEAD' })`. Si `response.ok` → existe; si 404 o error de red/CORS → no existe o no comprobable.
- Si el servidor no permite CORS para ese dominio, el `fetch` fallará y no sabremos si el PDF existe.

**Opción 2 – Mostrar enlace siempre**

- Siempre mostrar "Ver ficha técnica" que abra el PDF en nueva pestaña. Si no existe, el usuario verá 404. Implementación simple, sin comprobación previa.

**Opción 3 – Proxy en backend**

- Endpoint en nuestro backend que haga HEAD al PDF y devuelva 200/404. El front solo llama a nuestro endpoint. Requiere backend.

**Recomendación**:

- Intentar primero **HEAD** en el front. Si tenemos respuesta (con o sin CORS permitido), mostrar el botón solo cuando `response.ok`.
- Si por CORS no podemos hacer HEAD: mostrar igual el enlace "Ver ficha técnica" (abre en nueva pestaña) y asumir que a veces puede ser 404. Opcional: texto del tipo "Puede no estar disponible" si se quiere ser explícito.

---

## 6. Carousel

- **1 imagen**: Mostrar una sola imagen, sin flechas ni puntos.
- **2, 3 o 4 imágenes**: Carousel con:
  - Flechas anterior/siguiente (o gestos táctiles si se quiere).
  - Puntos (dots) que indiquen la imagen actual.
  - Transición simple (por ejemplo cambio de `opacity` o desplazamiento horizontal con `transform`).

Se puede implementar con **CSS + JS mínimo** (clase activa, índice actual, botones que cambien el índice), sin librerías externas, igual que el resto del proyecto.

---

## 7. Resumen de tareas (cuando se implemente)

1. **HTML**
   - Añadir un overlay a pantalla completa para "detalle de producto" (ej. `#productDetailOverlay`), con:
     - Botón/área de cierre (X o "Volver").
     - Zona para el carousel (contenedor de imágenes + flechas + dots).
     - Zona para código/descripción (opcional, ya está en el modal).
     - Bloque para el enlace "Ver ficha técnica" (visible solo si el PDF existe o si se opta por mostrarlo siempre).

2. **CSS**
   - Estilos del overlay (full viewport, fondo semitransparente).
   - Estilos del carousel (imagen grande, flechas, dots).
   - Ocultar/mostrar según número de imágenes (1 vs 2+).

3. **JS**
   - En `showAddToCartModal`, asignar **click** a `.add-to-cart-image-container` (o a `#addToCartImg`): al pulsar, llamar a una función tipo `openProductDetail(producto)`.
   - `openProductDetail(producto)`:
     - Comprobar imágenes _1 … _4 (con `Image()` onload/onerror) y construir lista de URLs.
     - Opcional: comprobar PDF con `fetch(..., { method: 'HEAD' })` y decidir si se muestra el enlace.
     - Renderizar el carousel con las URLs obtenidas (1–4).
     - Mostrar el enlace al PDF si procede.
     - Mostrar el overlay (`#productDetailOverlay`).
   - Al cerrar el overlay, ocultarlo; el modal de añadir al carrito sigue visible con el mismo estado.

4. **URLs**
   - Imágenes: `https://www.saneamiento-martinez.com/imagenes/articulos/{codigo}_1.JPG` … `_4.JPG`.
   - PDF: `https://www.saneamiento-martinez.com/pdf/fichas/{codigo}.PDF`.

5. **Accesibilidad**
   - Botón cerrar con `aria-label`.
   - Carousel con `role="region"` y `aria-label` descriptivo; imagen activa con `aria-hidden` en las no visibles si se usa solo una visible a la vez.

---

## 8. Flujo de usuario final

1. Usuario escanea o busca y se abre el modal de "Añadir al carrito" con la imagen grande.
2. Usuario **pulsa la imagen**.
3. Se abre la vista de detalle (overlay):
   - Carousel con 1, 2, 3 o 4 imágenes según existan.
   - Si existe ficha técnica: botón/enlace "Ver ficha técnica" → abre PDF en nueva pestaña.
4. Usuario cierra el overlay (X o Volver).
5. Vuelve al mismo modal; puede seguir eligiendo cantidad y añadir al carrito.

Con esto se cumple la mejora de experiencia sin tocar el flujo actual del modal ni la navegación entre pantallas de la app.

---

## 9. Implementación realizada (Opción A)

- **HTML**: Overlay `#productDetailOverlay` con botón cerrar, cabecera (código/descripción), carousel (inner + prev/next + dots), bloque "Ver ficha técnica (PDF)".
- **CSS**: Estilos en `styles.css` (`.product-detail-overlay`, `.product-detail-carousel`, etc.). Contenedor de imagen del modal con `cursor: pointer`.
- **JS** (`app.js`): `getAvailableProductImageUrls(codigo)` (comprueba _1 a _4 con `Image()` onload/onerror), `checkProductPdfExists(codigo)` (HEAD al PDF), `openProductDetail(producto)` (renderiza carousel 1–4, muestra ficha si existe, cierra con botón/backdrop). En `showAddToCartModal` se asigna clic en `.add-to-cart-image-container` a `openProductDetail(producto)`.
- Al cerrar el overlay se vuelve al modal de añadir al carrito sin perder estado.
