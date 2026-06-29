# Auditoria: rendimiento del inicio de sesion (scan_client_mobile)

Fecha: junio 2026. Objetivo: explicar los ~10 s de espera al pulsar **Entrar** y las acciones tomadas.

## Flujo completo (orden real)

```
1. Carga pagina
   index.html (inline) -> gate visible si no hay sesion
   prefetch /api/config.js + OPTIONS /api/auth/login
   Carga scripts: supabase-esm-loader (CDN), config.js, supabase.js, app.js...

2. app.initialize()
   probeLocalAuthState() -> none/stale -> showLanding + init Supabase en background

3. Usuario pulsa Entrar -> handleLogin()
   a) resolveApiBaseUrl()          <- CRITICO (ver bug TiendaNative)
   b) Promise.all:
      - ensureSupabaseReady()     (cache config + createClient)
      - fetchLoginApi()           POST /api/auth/login
   c) completeLoginFromApi()       signInWithPassword (Supabase Auth)
   d) hideLanding + toast
   e) initializeApp() en background (carrito + pantalla Inicio)

4. Backend POST /api/auth/login
   verificar_login_usuario (RPC)
   SELECT auth_user_id FROM usuarios
   syncAuthUserCredentials (updateUserById o createUser)
   -> respuesta JSON con email + perfil
```

## Causa raiz encontrada: TiendaNative.whenReady() en navegador web

**Archivo:** `js/tienda-native.js`

`whenReady()` esperaba hasta **15 segundos** comprobando si existia `pywebview`, aunque la app se abriera en **PWA / Chrome / Safari** (donde pywebview nunca existe).

`config.js` -> `resolveApiBaseUrl()` llamaba siempre a `whenReady()` antes de cada fetch API.

**Efecto:** cada login en web bloqueaba ~10-15 s **antes** de lanzar `fetch('/api/auth/login')`, aunque la config estuviera en cache local.

**Correccion:** si `!window.pywebview`, `whenReady()` retorna al instante. `resolveApiBaseUrl()` usa `location.origin` de inmediato y solo consulta TiendaPC si `TiendaNative.isAvailable()`.

## Otras fuentes de latencia (secundarias)

| Paso | Tiempo tipico | Bloquea UI? | Notas |
|------|---------------|-------------|-------|
| Cold start Vercel `/api/auth/login` | 2-8 s | Si (fetch) | Mitigado con OPTIONS prefetch al cargar gate |
| `waitForSupabaseLibrary` (CDN jsdelivr) | 0-3 s | Si (Promise.all) | Mitigado con init en background al mostrar gate |
| `syncAuthUserCredentials` + `listUsers` paginado | 5-30 s | Si (fetch API) | Solo si falta `auth_user_id` y createUser falla; mitigado con signInWithPassword O(1) antes del fallback |
| `initializeApp` (IndexedDB carrito) | 0.5-2 s | Antes si, ahora no | Tras login corre en background (`void initializeApp()`) |
| `signInWithPassword` cliente | 0.3-1 s | Si | Necesario para JWT / RLS |

## Cambios aplicados (junio 2026)

1. **tienda-native.js:** no esperar 15 s en navegador sin pywebview.
2. **config.js:** `resolveApiBaseUrl()` con origin inmediato; TiendaPC solo si aplica.
3. **lib/auth-handlers/login.js:** lookup rapido por `signInWithPassword` antes de `listUsers` paginado.
4. **app.js:** `initializeApp()` no bloquea tras login exitoso; resuelve API base al mostrar gate.
5. Optimizaciones previas: cache config local, login API en paralelo con Supabase, gate instantaneo.

## Como verificar tras desplegar

1. Limpiar cache / hard reload.
2. Abrir DevTools -> Network, filtrar `login`.
3. Pulsar Entrar: la peticion POST a `/api/auth/login` debe aparecer en **menos de 1 s** (no 10 s despues).
4. Consola: orden esperado rapido:
   - `[Config] API base URL: ...`
   - `[Config] Configuracion cargada desde cache local` (si hay cache)
   - `Cliente de Supabase inicializado correctamente`
   - `Intentando login para usuario: ...`
   - (POST login en Network)
   - `Login exitoso (Supabase Auth): ...`

## Pendiente opcional (si sigue lento)

- Servir `@supabase/supabase-js` desde el propio dominio (evitar CDN jsdelivr en arranque).
- Vercel: cron cada 5 min a `/api/config.js` y `/api/auth/login` OPTIONS para evitar cold start en horario laboral.
- Comprobar en Supabase que `usuarios.auth_user_id` esta relleno para todos los clientes activos (evita ruta lenta de sync).
