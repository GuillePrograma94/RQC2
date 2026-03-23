# Modo híbrido durante sincronización

## Objetivo

Permitir uso continuo de `scan_client_mobile` mientras se actualiza catálogo local, evitando huecos temporales de lectura en IndexedDB y evitando consultas remotas innecesarias de ofertas cuando la caché está al día.

## Comportamiento implementado

- `app.js` activa `isCatalogSyncInProgress` cuando hay actualización real de catálogo.
- Durante ese estado, las rutas críticas de búsqueda por código:
  - `performSearch` (búsqueda por código)
  - `scanner.js#searchProductExact`
  pueden usar Supabase cuando no hay resultado local.
- El estado híbrido se mantiene hasta finalizar también la descarga de ofertas.
- Al terminar, vuelve automáticamente a modo local.

## Regla de ofertas en cache miss

En `supabase.js#getOfertasProducto`:

- Si la caché tiene ofertas para el producto/grupo, se devuelve caché.
- Si no hay ofertas en caché:
  - si la caché de ofertas está completa y vigente (`ofertas_cache_status=complete` y `ofertas_cache_version_hash=version_hash_local`), se devuelve `[]` sin consultar Supabase;
  - si está en sync híbrido o la caché no está completa/vigente, se permite fallback remoto.

## Metadatos de estado (localStorage)

- `ofertas_cache_status`
- `ofertas_cache_version_hash`
- `ofertas_cache_completed_at`
- `ofertas_cache_target_version_hash`

## Referencia de implementación

- `js/app.js`
- `js/scanner.js`
- `js/supabase.js`
- `js/ui.js`
- `README_SINCRONIZACION_INCREMENTAL.md`
