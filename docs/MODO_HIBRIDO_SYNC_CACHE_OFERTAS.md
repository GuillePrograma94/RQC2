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
  - si la cache lleva mas de 30 dias sin refrescarse (`ofertas_cache_completed_at`), se permite fallback remoto;
  - si esta en sync hibrido o la cache no esta completa/vigente, se permite fallback remoto.

Ademas, al arrancar `loadOfertasIfNeeded` re-descarga ofertas si la cache tiene mas de 30 dias.

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
- `scan_familias_total` / `scan_familias_asignadas_total` — conteos brutos de filas remotas (alineados con `manifest.familias_total`); se usan para omitir la descarga de `familias` / `familias_asignadas` cuando no cambia el total en servidor. Cambios de UI de familia (titulo, imagen) se refrescan con **Forzar cache de la app** en Mi perfil.
- `scan_manifest_domain_applied` — firma `version_hash:productos:codigos:claves` del ultimo manifest de dominio ya aplicado en cliente. Evita re-sync infinita cuando el servidor sigue reportando los mismos cambios incrementales sin bump de `version_control`.

## Indice de busqueda local en memoria

Para evitar `IndexedDB.getAll()` en cada busqueda (lento en WebView Android), `cart.js` mantiene indices en RAM:

### Productos

- Se construye una vez leyendo el catalogo y pre-normalizando descripcion + sinonimos (`_productSearchIndex`).
- Se invalida al guardar completo o purgar productos; en sync incremental se parchea con `patchProductSearchIndex` sin rebuild completo.
- Al arrancar se espera con `warmSearchIndicesCritical` (timeout 8 s) **antes** de `hideLoading()`.
- Flag `app._searchIndicesReady`: si el usuario busca antes de que termine, `performSearch` muestra aviso y espera el warm.
- Las busquedas por descripcion y codigo parcial usan solo memoria; no consultan Supabase.

### Ofertas por grupo_cliente

- `warmOfertasProductosIndex(grupo)` construye un `Set<codigo_articulo>` en RAM con una sola transaccion IndexedDB (3 x `getAll`, sin loop N+1).
- Clave de cache: `version_hash_local + ':' + grupo_cliente`.
- Lookup sincrono: `getOfertasSkuSetForGrupo(grupo)`.
- Se precarga en background al init (`preloadOfertasSearchIndex`); **no** bloquea la UI.
- `displaySearchResults` y filtro chip ofertas usan el Set RAM; no reconstruyen indice por busqueda.

### Invalidacion de indices RAM

| Evento | Productos | Ofertas |
|--------|-----------|---------|
| `saveProductsToStorage` / purge | invalidate + rebuild | - |
| Sync incremental productos | `patchProductSearchIndex` | - |
| `saveOfertas*ToCache` / `downloadOfertas` | - | invalidate + warm background |
| Cambio cliente representado | - | invalidate + warm nuevo grupo |

## Orquestacion al arrancar (indices antes de sync)

Secuencia en `initializeApp`:

1. `cartManager.initialize()`
2. `await preloadStockIndexFromLocal()` — stock en RAM
3. `await refreshClavesDescuentoCache()` + pactos
4. `await warmSearchIndicesCritical(8000)` — indice productos (critico busqueda)
5. `await loadOfertasIfNeeded()` — descarga/valida cache ofertas (refresco si >30 dias)
6. `preloadOfertasSearchIndex()` — ofertas en background (reintenta si indice vacio y cache antigua)
7. `hideLoading()` — UI usable
8. `void syncProductsInBackground()` — escrituras pesadas **despues** (evita contencion IDB)

Tras `downloadOfertas` (sync o completar cache): invalidar indice ofertas RAM y `preloadOfertasSearchIndex()`.

## Sync serializada al arrancar

- Stock local precargado desde IndexedDB al iniciar (`preloadStockIndexFromLocal`), sin esperar red.
- Catalogo/tarifas: `syncProductsInBackground`.
- Refresh remoto de stock diferido tras terminar sync de catalogo (`syncStockInBackground`). Si el manifest ya indica `stock_hash` distinto al local, la comprobacion se adelanta a ~250 ms; si no, espera ~5 s para no competir con escrituras pesadas en IndexedDB.
- Flag `_catalogSyncRunning`: stock remoto espera si catalogo sigue activo.

## Indicador de sync y ofertas

- El indicador se oculta al terminar la sync de catalogo (precios/productos). Las ofertas se descargan en segundo plano sin bloquear la UI ni mantener el spinner en 100%.
- Durante descarga, el texto del indicador muestra la fase (`Guardando productos...`, `productos_incremental 45%`, etc.) en lugar de quedarse en `100%` mientras se escribe en IndexedDB.

## Escritura chunked de ofertas

Los metodos `saveOfertas*ToCache` en `cart.js` usan `replaceStoreChunked` (lotes de 3000, yield cada 3 lotes) en lugar de inserts secuenciales uno a uno.

## Referencia de implementacion

- `js/app.js`
- `js/cart.js`
- `js/scanner.js`
- `js/supabase.js`
- `js/ui.js`
- `README_SINCRONIZACION_INCREMENTAL.md`
