# Modo hibrido durante sincronizacion

## Objetivo

Permitir uso continuo de `scan_client_mobile` mientras se actualiza catalogo local, evitando huecos temporales de lectura en IndexedDB y evitando consultas remotas innecesarias de ofertas cuando la cache esta al dia.

## Comportamiento implementado

- `app.js` activa `isCatalogSyncInProgress` cuando hay actualizacion real de **productos o codigos** (rama pesada de sync).
- **No** se activa modo hibrido en la rama solo tarifas (`claves_descuento` sin cambios en productos/codigos).
- Durante el estado hibrido, las rutas criticas de busqueda por codigo:
  - `performSearch` (busqueda por codigo)
  - `scanner.js#searchProductExact`
  pueden usar Supabase cuando no hay resultado local.
- El estado hibrido se mantiene hasta finalizar la descarga de ofertas **solo cuando** se invalido la cache de ofertas (cambio de `version_hash` o cambios en productos/codigos).
- Al terminar, vuelve automaticamente a modo local.

## Regla de ofertas en cache miss

En `supabase.js#getOfertasProducto`:

- Si la cache tiene ofertas para el producto/grupo, se devuelve cache.
- Si no hay ofertas en cache:
  - si la cache de ofertas esta completa y vigente (`ofertas_cache_status=complete` y `ofertas_cache_version_hash=version_hash_local`), se devuelve `[]` sin consultar Supabase;
  - si esta en sync hibrido o la cache no esta completa/vigente, se permite fallback remoto.

## Cuando se invalidan y descargan ofertas

`markOfertasCachePending` y `downloadOfertas` se ejecutan solo si:

- cambia `version_hash` de `version_control`, o
- hay cambios en productos o codigos secundarios.

Un cambio solo de tarifas (`claves_descuento`) **no** invalida ni re-descarga ofertas.

## Metadatos de estado (localStorage)

- `ofertas_cache_status`
- `ofertas_cache_version_hash`
- `ofertas_cache_completed_at`
- `ofertas_cache_target_version_hash`
- `scan_claves_descuento_max_fecha`
- `scan_pactos_max_fecha`
- `scan_familias_total` / `scan_familias_asignadas_total`

## Indice de busqueda local en memoria

Para evitar `IndexedDB.getAll()` en cada busqueda (lento en WebView2/TiendaPC), `cart.js` mantiene un indice en RAM:

- Se construye una vez leyendo el catalogo y pre-normalizando descripcion + sinonimos.
- Se invalida al guardar completo o purgar productos; en sync incremental se parchea con `patchProductSearchIndex` sin rebuild completo.
- Se precarga tras init y sync completa (`preloadLocalProductSearchIndex` en `app.js`).
- Las busquedas por descripcion y codigo parcial usan solo memoria; no consultan Supabase.

## Sync serializada al arrancar

- Catalogo/tarifas primero (`syncProductsInBackground`).
- Stock diferido ~45 s (`syncStockInBackground`) para no competir por IndexedDB en movil.
- Flag `_catalogSyncRunning`: stock espera si catalogo sigue activo.

## Escritura chunked de ofertas

Los metodos `saveOfertas*ToCache` en `cart.js` usan `replaceStoreChunked` (lotes de 3000, yield cada 3 lotes) en lugar de inserts secuenciales uno a uno.

## Referencia de implementacion

- `js/app.js`
- `js/cart.js`
- `js/scanner.js`
- `js/supabase.js`
- `js/ui.js`
- `README_SINCRONIZACION_INCREMENTAL.md`
